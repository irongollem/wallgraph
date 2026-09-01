// Derived wall geometry. For each node we resolve the mitered corners between
// incident walls; for each wall we build its outline polygon(s), split into
// solid intervals between openings so doors/windows genuinely cut the wall
// (no overdraw tricks — room fills underneath stay intact).
//
// Junction algorithm: collect each incident wall-end's outgoing tangent (arc-
// aware) and half-thickness; sort by angle; the corner between two angularly
// adjacent wall-ends is the intersection of the two offset lines that face each
// other. Arc offsets use the tangent-line approximation at the endpoint, which
// is exact in the limit and visually correct at wall scale.
import {
  Floor, Wall, Opening, Id, wallPostMm, wallPostWidthMm, wallFacadeMm, facadeSideOf,
} from "../model/doc";
import {
  Vec, add, sub, scale, norm, perp, dist, v, angleOf, lineIntersect,
} from "../geometry/vec";
import { arcFlatten, arcLength, arcPointAt, arcTangentAt } from "../geometry/arc";

export interface WallEndCorners { left: Vec; right: Vec } // relative to OUTGOING tangent at that end

export interface SolidPiece { poly: Vec[] } // closed polygon, flattened

/**
 * A junction wedge, carrying the walls that meet there. The polygon belongs to
 * no single wall, so a renderer cannot read a pen off it the way it can off a
 * wall piece: with glazed and coloured walls the wedge has to be drawn in
 * whatever its neighbours agree on, and it can only ask that of the walls
 * themselves. Order matches the angular sort the corners were built in.
 */
export interface Junction extends SolidPiece { walls: Id[] }

/**
 * One post (stijl) of a wall's frame, face to face across the body.
 *
 * `poly` is the member's own footprint, present only where the wall states a
 * profile width; without one the post is a line, which is what a drawing that
 * has not chosen a section says. Both are carried so a renderer never has to
 * rebuild the quad from the centreline and a tangent it does not have.
 */
export interface PostMark { a: Vec; b: Vec; poly?: Vec[] }

export interface OpeningGeom {
  opening: Opening;
  wall: Wall;
  p0: Vec; p1: Vec;         // centerline points at jambs (start/end along wall)
  n0: Vec; n1: Vec;         // unit normals (perp of tangent) at jambs
  tan0: Vec; tan1: Vec;     // unit tangents at jambs (a->b direction)
  center: Vec;
  half: number;             // half thickness
}

export interface ResolvedWall {
  wall: Wall;
  a: Vec; b: Vec;
  /** Centerline length (hart-op-hart) — the length the document stores. */
  length: number;
  /**
   * The two mitered face lengths. Where a wall meets thicker walls at its ends,
   * the inner face is eaten into and the outer face runs long, so these differ
   * from `length` and from each other.
   */
  faces: { left: number; right: number };
  /**
   * Clear span (dagmaat): the shorter face. For a wall bounding a room this is
   * the inner face — the number an interior dimension on a plan refers to —
   * while `length` is measured axis-to-axis.
   */
  clearLength: number;
  pieces: SolidPiece[];     // solid wall polygons (1 + number of openings, roughly)
  outline: Vec[];           // full outline ignoring openings (for hit-testing/selection)
  openings: OpeningGeom[];
  /**
   * The wall's posts, empty where it states no frame. Derived here rather than
   * in each renderer because the canvas, the SVG and the DXF must place them
   * identically, and because the division depends on the same solid intervals
   * `pieces` is built from — see Wall.postMm.
   */
  posts: PostMark[];
  /**
   * The cladding band outside the structural body, empty where the wall states
   * no facade. Split by the same openings the pieces are — a window goes
   * through the cladding as well as the structure.
   */
  facade: SolidPiece[];
}

export interface Resolved {
  walls: Map<Id, ResolvedWall>;
  /**
   * Filler polygons for junctions of three or more walls.
   *
   * A wall's end is drawn as a single straight edge between its two mitered
   * corners. At a T where the through-wall is thicker than the branch, those
   * two corners sit on opposite sides of the node — outer face at the node,
   * inner face pushed out by the branch's half-thickness — so the end cuts
   * diagonally and the wedge between the two diagonals belongs to no wall at
   * all. That is the white triangle it used to leave behind.
   *
   * The corners around a node are already computed in angular order, so the
   * polygon through them is exactly the junction interior. Filling it is purely
   * additive: it can only cover a gap, never remove geometry.
   */
  junctions: Junction[];
}

/**
 * One wall-end at a node, with its offsets in the END's own outgoing frame.
 *
 * `halfL`/`halfR` are separate because a facade is one-sided: the outer pass
 * below pushes only the clad side out, so an end can be 100 to its left and 200
 * to its right. At end "b" the outgoing tangent is reversed, so the end's left
 * is the WALL's right — mapped once, where the ends are built.
 */
interface End { wall: Wall; end: "a" | "b"; out: Vec; half: number; halfL: number; halfR: number }

const MITER_LIMIT = 4;

export function resolveFloor(f: Floor): Resolved {
  const nodePos = new Map<Id, Vec>();
  for (const n of f.nodes) nodePos.set(n.id, v(n.x, n.y));

  // Group wall-ends by node.
  const byNode = new Map<Id, End[]>();
  for (const w of f.walls) {
    const A = nodePos.get(w.a), B = nodePos.get(w.b);
    if (!A || !B || dist(A, B) < 1) continue;
    const outA = arcTangentAt(A, B, w.bulge, 0);
    const outB = scale(arcTangentAt(A, B, w.bulge, 1), -1);
    const half = w.thickness / 2;
    // Structural pass: symmetric. The facade pass re-runs the same solver with
    // the clad side pushed out, which is what keeps the two sets of corners
    // mitered by identical rules instead of by a second approximation.
    pushMap(byNode, w.a, { wall: w, end: "a", out: outA, half, halfL: half, halfR: half });
    pushMap(byNode, w.b, { wall: w, end: "b", out: outB, half, halfL: half, halfR: half });
  }

  /** The same ends with the clad side pushed out by the facade thickness. */
  const outerEnds = new Map<Id, End[]>();
  for (const [nid, ends] of byNode) {
    outerEnds.set(nid, ends.map(e => {
      const fm = wallFacadeMm(e.wall);
      if (fm === undefined) return e;
      // At end "b" the frame is reversed, so a facade on the wall's left is on
      // that end's right.
      const onEndLeft = (facadeSideOf(e.wall) === "left") === (e.end === "a");
      return {
        ...e,
        halfL: e.half + (onEndLeft ? fm : 0),
        halfR: e.half + (onEndLeft ? 0 : fm),
      };
    }));
  }

  // Resolve corners per node, twice: once for the structural body and once for
  // the outer face of the cladding. `wedges` is filled only by the structural
  // pass -- a junction is masonry geometry, and a facade wraps the outside of a
  // building rather than filling the middle of a T.
  const solveCorners = (
    byNodeEnds: Map<Id, End[]>, wedges: Junction[] | null,
  ): Map<string, WallEndCorners> => {
    const out = new Map<string, WallEndCorners>();
    for (const [nid, ends] of byNodeEnds) {
      const P = nodePos.get(nid)!;
      if (ends.length === 1) {
        const e = ends[0]!;
        const pl = perp(e.out);
        out.set(key(e), { left: add(P, scale(pl, e.halfL)), right: add(P, scale(pl, -e.halfR)) });
        continue;
      }
      ends.sort((x, y) => angleOf(x.out) - angleOf(y.out));
      const n = ends.length;
      const ring: Vec[] = [];
      for (let i = 0; i < n; i++) {
        const ei = ends[i]!, ej = ends[(i + 1) % n]!;
        // Corner between ei (its LEFT offset, toward ej) and ej (its RIGHT offset).
        const pi = add(P, scale(perp(ei.out), ei.halfL));
        const pj = add(P, scale(perp(ej.out), -ej.halfR));
        let corner = lineIntersect(pi, ei.out, pj, ej.out);
        if (corner) {
          const reach = Math.max(ei.halfL, ej.halfR);
          const lim = MITER_LIMIT * reach + reach;
          if (dist(corner, P) > lim) corner = clampLen(P, corner, lim);
        } else {
          // Parallel (collinear pass-through or hairpin): midpoint of both offsets.
          corner = scale(add(pi, pj), 0.5);
        }
        setCorner(out, ei, "left", corner);
        setCorner(out, ej, "right", corner);
        ring.push(corner);
      }
      // Degree 1 has a square cap and degree 2 miters cleanly; only 3+ can gap.
      if (wedges && n >= 3) wedges.push({ poly: ring, walls: ends.map(e => e.wall.id) });
    }
    return out;
  };

  const junctions: Junction[] = [];
  const corners = solveCorners(byNode, junctions);
  const outerCorners = solveCorners(outerEnds, null);

  // Build wall outlines.
  const walls = new Map<Id, ResolvedWall>();
  for (const w of f.walls) {
    const A = nodePos.get(w.a), B = nodePos.get(w.b);
    if (!A || !B || dist(A, B) < 1) continue;
    const ca = corners.get(w.id + ":a")!;
    const cb = corners.get(w.id + ":b")!;
    const half = w.thickness / 2;
    const L = arcLength(A, B, w.bulge);

    // Centerline flattening with per-point normals ("left" = perp(tangent) side).
    const flat = arcFlatten(A, B, w.bulge, 1.5);
    const params = cumulative(flat, L);

    // Traversal-left side runs A->B; note end-b corners are relative to the
    // OUTGOING (reversed) tangent there, so traversal-left at b = cb.right.
    const leftSide = offsetSide(flat, params, w, A, B, half, ca.left, cb.right);
    const rightSide = offsetSide(flat, params, w, A, B, -half, ca.right, cb.left);

    const outline: Vec[] = [...leftSide, ...rightSide.slice().reverse()];
    const faces = { left: polylineLength(leftSide), right: polylineLength(rightSide) };

    // Opening geometry + solid intervals.
    const sorted = [...w.openings].sort((o1, o2) => o1.t - o2.t);
    const ogs: OpeningGeom[] = [];
    for (const o of sorted) {
      const t0 = (o.t - o.width / 2) / L, t1 = (o.t + o.width / 2) / L;
      const p0 = arcPointAt(A, B, w.bulge, t0), p1 = arcPointAt(A, B, w.bulge, t1);
      const tan0 = arcTangentAt(A, B, w.bulge, t0), tan1 = arcTangentAt(A, B, w.bulge, t1);
      ogs.push({
        opening: o, wall: w, p0, p1, n0: perp(tan0), n1: perp(tan1), tan0, tan1,
        center: arcPointAt(A, B, w.bulge, o.t / L), half,
      });
    }

    const pieces: SolidPiece[] = [];
    let cursor = 0; // mm
    const cuts: Array<{ from: number; to: number }> = [];
    for (const o of sorted) cuts.push({ from: o.t - o.width / 2, to: o.t + o.width / 2 });
    const intervals: Array<{ from: number; to: number }> = [];
    for (const c of cuts) {
      if (c.from > cursor + 1) intervals.push({ from: cursor, to: c.from });
      cursor = Math.max(cursor, c.to);
    }
    if (cursor < L - 1) intervals.push({ from: cursor, to: L });
    if (intervals.length === 0) intervals.push({ from: 0, to: L });

    for (const iv of intervals) {
      const isStart = iv.from <= 1, isEnd = iv.to >= L - 1;
      const sub = subFlat(flat, params, iv.from, iv.to, A, B, w);
      const subParams = cumulative(sub, iv.to - iv.from);
      const sL = offsetPolyline(sub, subParams, half);
      const sR = offsetPolyline(sub, subParams, -half);
      // Use mitered corners at true wall ends; square cuts at opening jambs.
      if (isStart) { sL[0] = ca.left; sR[0] = ca.right; }
      if (isEnd) { sL[sL.length - 1] = cb.right; sR[sR.length - 1] = cb.left; }
      pieces.push({ poly: [...sL, ...sR.slice().reverse()] });
    }

    walls.set(w.id, {
      wall: w, a: A, b: B, length: L,
      faces, clearLength: Math.min(faces.left, faces.right),
      pieces, outline, openings: ogs,
      posts: postsFor(w, A, B, L, half, intervals),
      facade: facadeFor(w, A, B, L, half, flat, params, intervals, ca, cb,
        outerCorners.get(w.id + ":a"), outerCorners.get(w.id + ":b")),
    });
  }

  return { walls, junctions };
}

/**
 * One wall's posts, per run of body between its openings.
 *
 * The spacing is a maximum bay width, not a grid pitch: each run is divided
 * into `ceil(run / spacing)` equal bays, so a run shorter than the spacing gets
 * none and a door pushes the posts of its own run aside rather than having one
 * land in the doorway. `intervals` are the same solid runs the wall's pieces
 * are built from, which is what makes that true without the openings being
 * consulted again here.
 *
 * A stated profile width also produces the member's footprint, built the way
 * an opening's void quad is (core/solids.ts): each side of the post's own
 * centre offset by the normal AT THAT POINT, so a post in a bowed wall sits
 * square to the wall rather than to its neighbour.
 */
function postsFor(
  w: Wall, A: Vec, B: Vec, L: number, half: number,
  intervals: ReadonlyArray<{ from: number; to: number }>,
): PostMark[] {
  const spacing = wallPostMm(w);
  if (spacing === undefined || L <= 0) return [];
  const out: PostMark[] = [];
  const at = (s: number): { p: Vec; n: Vec } => {
    const t = s / L;
    return { p: arcPointAt(A, B, w.bulge, t), n: perp(arcTangentAt(A, B, w.bulge, t)) };
  };
  for (const iv of intervals) {
    const run = iv.to - iv.from;
    // Rounded before the ceiling so a run that divides exactly — a 3600 run at
    // 1200 — takes 3 bays rather than 4 on a floating-point hair.
    const bays = Math.max(1, Math.ceil(Number((run / spacing).toFixed(6))));
    const width = wallPostWidthMm(w, run / bays);
    for (let i = 1; i < bays; i++) {
      const s = iv.from + (run * i) / bays;
      const { p, n } = at(s);
      const mark: PostMark = { a: add(p, scale(n, half)), b: add(p, scale(n, -half)) };
      if (width !== undefined) {
        const lo = at(Math.max(iv.from, s - width / 2));
        const hi = at(Math.min(iv.to, s + width / 2));
        mark.poly = [
          add(lo.p, scale(lo.n, half)), add(hi.p, scale(hi.n, half)),
          add(hi.p, scale(hi.n, -half)), add(lo.p, scale(lo.n, -half)),
        ];
      }
      out.push(mark);
    }
  }
  return out;
}

/**
 * The cladding band on one wall: between its structural face on the clad side
 * and the same centerline offset by half + facadeMm.
 *
 * The inner edge reuses the structural corners the body is already built from,
 * so the band cannot part company with the wall it clads; the outer edge uses
 * the second corner pass, so two clad walls miter their skins at a corner while
 * an unclad wall teeing into one leaves the skin to run straight past.
 * Split by the same `intervals` the pieces are: an opening goes through the
 * cladding as well as the structure.
 */
function facadeFor(
  w: Wall, A: Vec, B: Vec, L: number, half: number,
  flat: Vec[], params: number[],
  intervals: ReadonlyArray<{ from: number; to: number }>,
  ca: WallEndCorners, cb: WallEndCorners,
  oa: WallEndCorners | undefined, ob: WallEndCorners | undefined,
): SolidPiece[] {
  const fm = wallFacadeMm(w);
  if (fm === undefined || !oa || !ob) return [];
  const left = facadeSideOf(w) === "left";
  const sgn = left ? 1 : -1;
  // Traversal-left runs A->B, and end-b corners are relative to the reversed
  // tangent there, so the wall's left face is ca.left -> cb.right.
  const innerStart = left ? ca.left : ca.right;
  const innerEnd = left ? cb.right : cb.left;
  const outerStart = left ? oa.left : oa.right;
  const outerEnd = left ? ob.right : ob.left;

  const out: SolidPiece[] = [];
  for (const iv of intervals) {
    const isStart = iv.from <= 1, isEnd = iv.to >= L - 1;
    const sub = subFlat(flat, params, iv.from, iv.to, A, B, w);
    const subParams = cumulative(sub, iv.to - iv.from);
    const inner = offsetPolyline(sub, subParams, sgn * half);
    const outer = offsetPolyline(sub, subParams, sgn * (half + fm));
    if (isStart) { inner[0] = innerStart; outer[0] = outerStart; }
    if (isEnd) { inner[inner.length - 1] = innerEnd; outer[outer.length - 1] = outerEnd; }
    out.push({ poly: [...inner, ...outer.slice().reverse()] });
  }
  return out;
}

function polylineLength(pts: Vec[]): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) acc += dist(pts[i - 1]!, pts[i]!);
  return acc;
}

function key(e: End): string { return e.wall.id + ":" + e.end; }
function pushMap<K, T>(m: Map<K, T[]>, k: K, t: T): void {
  const arr = m.get(k);
  if (arr) arr.push(t); else m.set(k, [t]);
}
function setCorner(map: Map<string, WallEndCorners>, e: End, side: "left" | "right", p: Vec): void {
  let c = map.get(key(e));
  if (!c) { c = { left: p, right: p }; map.set(key(e), c); }
  c[side] = p;
}
function clampLen(from: Vec, to: Vec, maxLen: number): Vec {
  const d = sub(to, from);
  const l = dist(from, to);
  return l <= maxLen ? to : add(from, scale(d, maxLen / l));
}

function cumulative(pts: Vec[], total: number): number[] {
  const out: number[] = [0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) { acc += dist(pts[i - 1]!, pts[i]!); out.push(acc); }
  const scaleF = acc > 0 ? total / acc : 1;
  return out.map(x => x * scaleF);
}

/** Offset a polyline by d along per-vertex normals (averaged at interior vertices). */
function offsetPolyline(pts: Vec[], _params: number[], d: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const t0 = i > 0 ? norm(sub(p, pts[i - 1]!)) : norm(sub(pts[i + 1]!, p));
    const t1 = i + 1 < pts.length ? norm(sub(pts[i + 1]!, p)) : t0;
    let nrm = norm(add(perp(t0), perp(t1)));
    if (!isFinite(nrm.x) || (nrm.x === 0 && nrm.y === 0)) nrm = perp(t0);
    // Miter-correct so the offset distance stays d at kinks.
    const cosHalf = Math.max(0.2, Math.sqrt(Math.max(0, (1 + (t0.x * t1.x + t0.y * t1.y)) / 2)));
    out.push(add(p, scale(nrm, d / cosHalf)));
  }
  return out;
}

/** Side of a wall from resolved corner to resolved corner along its offset curve. */
function offsetSide(
  flat: Vec[], params: number[], _w: Wall, _A: Vec, _B: Vec,
  d: number, cornerStart: Vec, cornerEnd: Vec,
): Vec[] {
  const side = offsetPolyline(flat, params, d);
  side[0] = cornerStart;
  side[side.length - 1] = cornerEnd;
  return side;
}

/** Sub-polyline of the flattened centerline between mm positions from..to. */
function subFlat(flat: Vec[], params: number[], from: number, to: number, A: Vec, B: Vec, w: Wall): Vec[] {
  const L = params[params.length - 1]!;
  const p = (mm: number): Vec => arcPointAt(A, B, w.bulge, Math.max(0, Math.min(1, mm / L)));
  const out: Vec[] = [p(from)];
  for (let i = 0; i < flat.length; i++) {
    const s = params[i]!;
    if (s > from + 0.5 && s < to - 0.5) out.push(flat[i]!);
  }
  out.push(p(to));
  return out;
}
