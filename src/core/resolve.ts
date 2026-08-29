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
import { Floor, Wall, Opening, Id } from "../model/doc";
import {
  Vec, add, sub, scale, norm, perp, dist, v, angleOf, lineIntersect,
} from "../geometry/vec";
import { arcFlatten, arcLength, arcPointAt, arcTangentAt } from "../geometry/arc";

export interface WallEndCorners { left: Vec; right: Vec } // relative to OUTGOING tangent at that end

export interface SolidPiece { poly: Vec[] } // closed polygon, flattened

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
  junctions: SolidPiece[];
}

interface End { wall: Wall; end: "a" | "b"; out: Vec; half: number }

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
    pushMap(byNode, w.a, { wall: w, end: "a", out: outA, half });
    pushMap(byNode, w.b, { wall: w, end: "b", out: outB, half });
  }

  // Resolve corners per node.
  const corners = new Map<string, WallEndCorners>(); // key: wallId + end
  const junctions: SolidPiece[] = [];
  for (const [nid, ends] of byNode) {
    const P = nodePos.get(nid)!;
    if (ends.length === 1) {
      const e = ends[0]!;
      const pl = perp(e.out);
      corners.set(key(e), { left: add(P, scale(pl, e.half)), right: add(P, scale(pl, -e.half)) });
      continue;
    }
    ends.sort((x, y) => angleOf(x.out) - angleOf(y.out));
    const n = ends.length;
    const ring: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const ei = ends[i]!, ej = ends[(i + 1) % n]!;
      // Corner between ei (its LEFT offset, toward ej) and ej (its RIGHT offset).
      const pi = add(P, scale(perp(ei.out), ei.half));
      const pj = add(P, scale(perp(ej.out), -ej.half));
      let corner = lineIntersect(pi, ei.out, pj, ej.out);
      if (corner) {
        const lim = MITER_LIMIT * Math.max(ei.half, ej.half) + Math.max(ei.half, ej.half);
        if (dist(corner, P) > lim) corner = clampLen(P, corner, lim);
      } else {
        // Parallel (collinear pass-through or hairpin): use midpoint of both offsets.
        corner = scale(add(pi, pj), 0.5);
      }
      setCorner(corners, ei, "left", corner);
      setCorner(corners, ej, "right", corner);
      ring.push(corner);
    }
    // Degree 1 has a square cap and degree 2 miters cleanly; only 3+ can gap.
    if (n >= 3) junctions.push({ poly: ring });
  }

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
    });
  }

  return { walls, junctions };
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
