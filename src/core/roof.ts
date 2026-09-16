// Derived roof geometry: the underside a room, a wall or a stair actually
// meets, read off the authored planes (model/roof.ts) rather than the other
// way round. Pure and uncached, like the rest of core/ -- callers cache
// against store.revision.
//
// A plane's own underside is an affine function of plan position: distance
// from the eave -- the infinite line through the eave edge, not the segment,
// measured INTO the outline -- times tan(pitch), added to the eave height.
// `roofUndersideAt` takes the LOWEST of every plane whose outline contains a
// point, which is what makes a ridge or a hip come out right without the
// planes having to meet exactly (see model/roof.ts).
import { Floor, Id, PlanDoc, Wall, findNode, floorHeight } from "../model/doc";
import { RoofPlane, roofPlanesOf, roofThicknessOf } from "../model/roof";
import { wallLength } from "../model/ops";
import { wallTopAt, wallTopPolyline } from "../model/profile";
import type { ProfilePoint } from "../model/doc";
import {
  Vec, v, add, sub, scale, dot, norm, perp, polygonArea, polygonCentroid, pointInPolygon, clipHalfPlane,
} from "../geometry/vec";
import { arcPointAt } from "../geometry/arc";
import { outerBoundary } from "./rooms";

const DEG = Math.PI / 180;

/** The eave edge's own geometry: a point on it, its own unit direction, and
 *  the perpendicular direction the outline is read into (away from the
 *  eave). */
export interface EaveGeom { a: Vec; dir: Vec; inward: Vec }

/**
 * The eave edge of a plane, and which perpendicular direction points into its
 * own outline. Determined against the outline's centroid rather than assumed
 * from winding, so a plane authored with the wrong winding (a pasted or
 * hand-built document) still reads its own eave the right way round. Shared
 * with core/headroom.ts, which clips a room against the same eave-parallel
 * line at the 1500 mm underside, and io/ifc.ts, which builds the plane's own
 * placement from `a`/`dir`/`inward` directly.
 */
/** The eave edge's own two endpoints, in outline order -- the segment
 *  eaveLineOf's `a`/`dir` describe only as an infinite line. Shared by the
 *  plan drawing (canvas, SVG, DXF), which draws this edge solid while the
 *  rest of a plane's outline is dashed (see render/roof.ts). */
export function eaveSegment(plane: RoofPlane): { a: Vec; b: Vec } {
  const n = plane.outline.length;
  const idx = n > 0 ? Math.max(0, Math.min(n - 1, Math.round(plane.eaveEdge))) : 0;
  const a = plane.outline[idx] ?? { x: 0, y: 0 };
  const b = plane.outline[(idx + 1) % Math.max(1, n)] ?? a;
  return { a: v(a.x, a.y), b: v(b.x, b.y) };
}

export function eaveLineOf(plane: RoofPlane): EaveGeom {
  const { a: A, b: B } = eaveSegment(plane);
  const dir = norm(sub(B, A));
  const cand = perp(dir);
  const centroid = plane.outline.length >= 3 ? polygonCentroid(plane.outline.map(p => v(p.x, p.y))) : A;
  const inward = dot(cand, sub(centroid, A)) >= 0 ? cand : scale(cand, -1);
  return { a: A, dir, inward };
}

/** Signed distance from `p` to the infinite eave line, positive INTO the
 *  outline (the direction the plane rises). */
function distanceIntoOutline(p: Vec, eave: EaveGeom): number {
  return dot(sub(p, eave.a), eave.inward);
}

/**
 * The height of one plane's own underside at `p`, mm above this storey's
 * floor -- extrapolated past the plane's own outline, since callers that want
 * it clipped to the outline check `pointInPolygon` themselves (roofUndersideAt
 * below) or clip the geometry directly (roofRidges below).
 */
export function planeUndersideAt(plane: RoofPlane, p: Vec): number {
  const eave = eaveLineOf(plane);
  const d = distanceIntoOutline(p, eave);
  return plane.eaveMm + d * Math.tan(plane.pitchDeg * DEG);
}

/**
 * The underside a point actually meets: the LOWEST underside of every plane
 * whose outline contains it, or null outside every plane. Taking the lowest
 * where outlines overlap is what makes a ridge or a hip come out right
 * without requiring the planes to meet exactly (see model/roof.ts).
 */
export function roofUndersideAt(f: Floor, p: Vec): number | null {
  let best: number | null = null;
  for (const plane of roofPlanesOf(f)) {
    if (plane.outline.length < 3) continue;
    if (!pointInPolygon(p, plane.outline.map(q => v(q.x, q.y)))) continue;
    const h = planeUndersideAt(plane, p);
    if (best === null || h < best) best = h;
  }
  return best;
}

/** Sloped area of one plane, mm²: plan area / cos(pitch). */
export function roofPlaneArea(plane: RoofPlane): number {
  const poly = plane.outline.map(p => v(p.x, p.y));
  const planMm2 = Math.abs(polygonArea(poly));
  const c = Math.cos(plane.pitchDeg * DEG);
  return c > 1e-6 ? planMm2 / c : planMm2;
}

// ── wall geometry along a centerline ────────────────────────────────────────

/** A point at `s` mm from node a, arc-aware like wallTopAt(). */
function wallPointAt(A: Vec, B: Vec, bulge: number, L: number, s: number): Vec {
  if (L <= 0) return A;
  const t = Math.max(0, Math.min(1, s / L));
  return bulge === 0 ? add(A, scale(sub(B, A), t)) : arcPointAt(A, B, bulge, t);
}

/** Sampling step for locating where a wall's centerline crosses a plane
 *  outline's edge, mm -- refined by bisection, not the precision itself. */
const SPAN_SAMPLE_MM = 100;
const BISECT_ITERS = 24;

/** The s-intervals over [0, L] where the wall's centerline lies inside
 *  `outline`, found by sampling plus bisection -- exact for a straight wall
 *  within floating-point tolerance, and the same tangent-line-at-sample
 *  approximation the rest of the codebase accepts for an arc (see the module
 *  comment on resolveFloor() in CLAUDE.md). */
function wallPlaneSpans(A: Vec, B: Vec, bulge: number, L: number, outline: { x: number; y: number }[]): Array<{ s0: number; s1: number }> {
  const poly = outline.map(p => v(p.x, p.y));
  if (poly.length < 3) return [];
  if (L <= 0) return pointInPolygon(A, poly) ? [{ s0: 0, s1: 0 }] : [];
  const inside = (s: number): boolean => pointInPolygon(wallPointAt(A, B, bulge, L, s), poly);
  const n = Math.max(1, Math.ceil(L / SPAN_SAMPLE_MM));
  const spans: Array<{ s0: number; s1: number }> = [];
  let curStart: number | null = inside(0) ? 0 : null;
  let prevS = 0, prevIn = inside(0);
  for (let i = 1; i <= n; i++) {
    const s = Math.min(L, (L * i) / n);
    const isIn = inside(s);
    if (isIn !== prevIn) {
      let lo = prevS, hi = s;
      for (let k = 0; k < BISECT_ITERS; k++) {
        const mid = (lo + hi) / 2;
        if (inside(mid) === prevIn) lo = mid; else hi = mid;
      }
      const cross = (lo + hi) / 2;
      if (curStart === null) curStart = cross; else { spans.push({ s0: curStart, s1: cross }); curStart = null; }
    }
    prevS = s; prevIn = isIn;
  }
  if (curStart !== null) spans.push({ s0: curStart, s1: L });
  return spans;
}

// ── wall / roof consistency ─────────────────────────────────────────────────

export interface RoofWallMismatch {
  wallId: Id;
  /** roofUnderside - wallTop at the worst sampled point, mm. Positive: the
   *  wall falls short of the roof (a gap). Negative: the wall pokes through
   *  the roof's underside (a clash). */
  gapMm: number;
  /** Where the worst gap was sampled, mm from node a. */
  atT: number;
}

/** Beyond this the wall and the roof over it are read as disagreeing. */
const ROOF_MISMATCH_TOL_MM = 20;
/** Fixed sampling step along the wall, mm -- coarser than SPAN_SAMPLE_MM
 *  since this reports a mismatch, not a breakpoint location. */
const MISMATCH_SAMPLE_MM = 250;

/**
 * Every wall whose centerline passes under a roof plane, sampled at its own
 * profile breakpoints and every MISMATCH_SAMPLE_MM against the roof
 * underside there: the worst gap, when it exceeds ROOF_MISMATCH_TOL_MM.
 * Reported, never repaired -- a wall's own top stays its own statement (see
 * model/profile.ts).
 */
export function roofWallMismatches(f: Floor): RoofWallMismatch[] {
  if (roofPlanesOf(f).length === 0) return [];
  const out: RoofWallMismatch[] = [];
  for (const w of f.walls) {
    const L = wallLength(f, w);
    if (L <= 0) continue;
    const stops = new Set<number>([0, L]);
    for (const bp of wallTopPolyline(f, w, L)) stops.add(bp.s);
    for (let s = 0; s <= L; s += MISMATCH_SAMPLE_MM) stops.add(s);
    const na = findNode(f, w.a), nb = findNode(f, w.b);
    if (!na || !nb) continue;
    const A = v(na.x, na.y), B = v(nb.x, nb.y);
    let worst: { gapMm: number; atT: number } | null = null;
    for (const s of stops) {
      if (s < 0 || s > L) continue;
      const p = wallPointAt(A, B, w.bulge, L, s);
      const underside = roofUndersideAt(f, p);
      if (underside === null) continue;
      const gap = underside - wallTopAt(f, w, s);
      if (!worst || Math.abs(gap) > Math.abs(worst.gapMm)) worst = { gapMm: gap, atT: s };
    }
    if (worst && Math.abs(worst.gapMm) > ROOF_MISMATCH_TOL_MM) {
      out.push({ wallId: w.id, gapMm: Math.round(worst.gapMm), atT: Math.round(worst.atT) });
    }
  }
  return out;
}

// ── profile proposed from the roof ──────────────────────────────────────────

/**
 * The ProfilePoint[] that makes `w`'s top follow the roof over it: the wall's
 * own centerline sampled at every point the active roof plane changes --
 * entering or leaving a plane's outline, or crossing from one plane to
 * another inside an overlap (a ridge or a hip) -- so the result is linear,
 * and therefore exact, between consecutive points. Null when the wall passes
 * under no plane at all. Points where the wall is not under any plane are
 * left out; the wall's own end there falls back to wallHeight() the way an
 * unstated profile point always does (model/profile.ts).
 */
export function profileFromRoof(f: Floor, w: Wall): ProfilePoint[] | null {
  const planes = roofPlanesOf(f);
  if (planes.length === 0) return null;
  const na = findNode(f, w.a), nb = findNode(f, w.b);
  if (!na || !nb) return null;
  const A = v(na.x, na.y), B = v(nb.x, nb.y);
  const L = wallLength(f, w);
  if (L <= 0) return null;

  const perPlane = planes.map(plane => ({ plane, spans: wallPlaneSpans(A, B, w.bulge, L, plane.outline) }));
  if (perPlane.every(p => p.spans.length === 0)) return null;

  const stops = new Set<number>([0, L]);
  for (const { spans } of perPlane) for (const sp of spans) { stops.add(sp.s0); stops.add(sp.s1); }

  // Ridge/hip crossings: where two planes' spans overlap, their (locally
  // affine) undersides may cross inside the overlap -- solve it directly
  // rather than sampling, since both sides are exactly linear in s for a
  // straight wall (the same tangent-line approximation applies on an arc).
  for (let i = 0; i < perPlane.length; i++) {
    for (let j = i + 1; j < perPlane.length; j++) {
      for (const si of perPlane[i]!.spans) {
        for (const sj of perPlane[j]!.spans) {
          const lo = Math.max(si.s0, sj.s0), hi = Math.min(si.s1, sj.s1);
          if (hi - lo <= 1e-6) continue;
          const p0 = wallPointAt(A, B, w.bulge, L, lo), p1 = wallPointAt(A, B, w.bulge, L, hi);
          const d0 = planeUndersideAt(perPlane[i]!.plane, p0) - planeUndersideAt(perPlane[j]!.plane, p0);
          const d1 = planeUndersideAt(perPlane[i]!.plane, p1) - planeUndersideAt(perPlane[j]!.plane, p1);
          if ((d0 >= 0) === (d1 >= 0)) continue; // no sign change inside the overlap
          const frac = d0 / (d0 - d1);
          stops.add(lo + frac * (hi - lo));
        }
      }
    }
  }

  const pts: ProfilePoint[] = [];
  for (const s of [...stops].filter(s => s >= -1e-6 && s <= L + 1e-6).sort((a, b) => a - b)) {
    const clamped = Math.max(0, Math.min(L, s));
    const p = wallPointAt(A, B, w.bulge, L, clamped);
    const h = roofUndersideAt(f, p);
    if (h === null) continue;
    pts.push({ t: Math.round(clamped), height: Math.round(h) });
  }
  // Points sharing a `t` after rounding collapse to the last write, mirroring
  // clampProfile(); keep the sorted order clampProfile() itself expects.
  const byT = new Map<number, number>();
  for (const p of pts) byT.set(p.t, p.height);
  const out = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, height]) => ({ t, height }));
  return out.length > 0 ? out : null;
}

// ── ridges, for the plan drawing ────────────────────────────────────────────

export interface RoofRidge {
  a: Vec;
  b: Vec;
  planeIds: [Id, Id];
}

/** planeUndersideAt as an affine form h(p) = c + nx*p.x + ny*p.y. */
function linearForm(plane: RoofPlane): { c: number; nx: number; ny: number } {
  const eave = eaveLineOf(plane);
  const k = Math.tan(plane.pitchDeg * DEG);
  const nx = k * eave.inward.x, ny = k * eave.inward.y;
  const c = plane.eaveMm - (nx * eave.a.x + ny * eave.a.y);
  return { c, nx, ny };
}

/**
 * Where the infinite line `p0 + t*dir` stays inside `poly`: the intersection
 * of the half-planes of its edges (inward = +perp(edge direction), the
 * winding model/roof.ts's RoofPlane.outline states). Exact for a convex
 * outline; for a concave one this is the same convex-clip approximation
 * core/solids.ts's plateHoles() already accepts for a building outline. Null
 * when the line never enters the polygon's half-plane intersection at all.
 */
function clipLineToPolygon(p0: Vec, dir: Vec, poly: { x: number; y: number }[]): { t0: number; t1: number } | null {
  let t0 = -Infinity, t1 = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = v(poly[i]!.x, poly[i]!.y), b = v(poly[(i + 1) % n]!.x, poly[(i + 1) % n]!.y);
    const edgeDir = sub(b, a);
    if (Math.hypot(edgeDir.x, edgeDir.y) < 1e-9) continue;
    const nrm = perp(norm(edgeDir)); // inward, per RoofPlane.outline's winding
    const f0 = dot(sub(p0, a), nrm);
    const fd = dot(dir, nrm);
    if (Math.abs(fd) < 1e-9) {
      if (f0 < -1e-6) return null; // parallel to this edge and outside it: never inside
      continue;
    }
    const t = -f0 / fd;
    if (fd > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  return t1 - t0 > 1e-6 ? { t0, t1 } : null;
}

/**
 * Segments where two planes' undersides meet -- a ridge or a hip -- for the
 * plan drawing. Two planes at the same pitch and eave direction never meet
 * (their undersides differ by a constant, or agree everywhere) and are
 * skipped; a ridge that runs exactly along a shared outline edge (the gable
 * case core/roofsuggest.ts builds by splitting the storey's outline) and one
 * that only meets inside an overlap (a hip) are both found the same way,
 * since neither the planes' adjacency nor their overlap is otherwise assumed.
 */
export function roofRidges(f: Floor): RoofRidge[] {
  const planes = roofPlanesOf(f).filter(p => p.outline.length >= 3);
  const out: RoofRidge[] = [];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const pi = planes[i]!, pj = planes[j]!;
      const li = linearForm(pi), lj = linearForm(pj);
      const nx = li.nx - lj.nx, ny = li.ny - lj.ny;
      const c = lj.c - li.c; // nx*x + ny*y = c along the equal-height line
      const len2 = nx * nx + ny * ny;
      if (len2 < 1e-9) continue; // parallel planes: no ridge
      const dir = norm(v(-ny, nx));
      const p0 = v((nx * c) / len2, (ny * c) / len2);
      const ri = clipLineToPolygon(p0, dir, pi.outline);
      const rj = clipLineToPolygon(p0, dir, pj.outline);
      if (!ri || !rj) continue;
      const t0 = Math.max(ri.t0, rj.t0), t1 = Math.min(ri.t1, rj.t1);
      if (t1 - t0 < 1) continue;
      out.push({ a: add(p0, scale(dir, t0)), b: add(p0, scale(dir, t1)), planeIds: [pi.id, pj.id] });
    }
  }
  return out;
}

// ── roof vs. the storey above ───────────────────────────────────────────────

export interface RoofStoreyClash {
  planeId: Id;
  /** How far the plane's top rises above this storey's own height, mm. */
  overMm: number;
  /** Where, in world mm: the highest covered point of the plane. */
  at: { x: number; y: number };
}

/** Beyond this the plane's top is read as genuinely rising into the floor
 *  above rather than finishing at it -- the ordinary case for a flat roof
 *  under a set-back, whose top lands within rounding of the floor height. */
const ROOF_CLASH_TOL_MM = 10;

/** `outline` re-wound counter-clockwise under y-down like a roof plane's own
 *  outline -- outerBoundary() returns the unbounded face's own (opposite)
 *  winding (see core/rooms.ts). The same local helper core/energy.ts's
 *  ccwOuter and core/roofsuggest.ts's ccwOutline already are, kept private
 *  to each file rather than shared. */
function ccwOuter(outline: Vec[] | null): Vec[] | null {
  if (!outline || outline.length < 3) return null;
  return polygonArea(outline) < 0 ? [...outline].reverse() : outline;
}

/** `subject` clipped to `clip`, one half-plane per edge of `clip` (inward =
 *  +perp(edge direction), the CCW-under-y-down winding a roof outline and a
 *  re-wound storey outline share). Exact for a convex `clip`; the same
 *  convex-clip approximation core/headroom.ts's clipToOutline and
 *  core/energy.ts's clipToPolygon already accept for a storey outline. */
function clipToOuter(subject: Vec[], clip: readonly Vec[]): Vec[] {
  let out = subject;
  const n = clip.length;
  for (let i = 0; i < n && out.length >= 3; i++) {
    const a = clip[i]!, b = clip[(i + 1) % n]!;
    const edge = sub(b, a);
    if (Math.hypot(edge.x, edge.y) < 1e-9) continue;
    out = clipHalfPlane(out, a, perp(norm(edge)));
  }
  return out;
}

/**
 * Every roof plane on floor `floorIndex` whose top -- underside plus its own
 * roof build-up, measured vertically (thickness / cos(pitch), the same
 * figure core/solids.ts's roofSlabSolids() builds) -- rises more than
 * ROOF_CLASH_TOL_MM past THIS storey's own height (floorHeight(f), not the
 * storey above's), within the part of the plan the storey above actually
 * covers (outerBoundary() in core/rooms.ts). A set-back roof beside the
 * storey above is not a clash: the plane's outline there clips to nothing.
 *
 * Empty on the top storey (nothing stands on it) and wherever the storey
 * above has no closed wall loop of its own -- outerBoundary() returns null
 * there, and reporting a clash against an undefined covered area would be a
 * guess, not a fact read off the document.
 *
 * The plane's top is affine in plan position (planeUndersideAt() plus a
 * pitch-only constant added by the roof build-up), so its maximum over the
 * covered region is always a vertex of the clipped outline; no sampling. The
 * clip itself is the same convex-clip approximation the rest of this module
 * and core/headroom.ts already accept for a plane or a storey outline --
 * exact for a convex storey outline, an under-cut for a concave one, which
 * can only miss a clash outside the approximated region, never invent one.
 * Reported, never repaired: the fix is the storey's height, the pitch or the
 * eave, and the document does not say which.
 */
export function roofStoreyClashes(doc: PlanDoc, floorIndex: number): RoofStoreyClash[] {
  const f = doc.floors[floorIndex];
  const above = doc.floors[floorIndex + 1];
  if (!f || !above) return [];
  const aboveOuter = ccwOuter(outerBoundary(above));
  if (!aboveOuter) return [];
  const storeyH = floorHeight(f);
  const out: RoofStoreyClash[] = [];
  for (const plane of roofPlanesOf(f)) {
    if (plane.outline.length < 3) continue;
    const outline = plane.outline.map(p => v(p.x, p.y));
    const clipped = clipToOuter(outline, aboveOuter);
    if (clipped.length < 3) continue;
    const cosPitch = Math.cos(plane.pitchDeg * DEG);
    const vertical = cosPitch > 1e-6 ? roofThicknessOf(plane) / cosPitch : roofThicknessOf(plane);
    let best: { top: number; at: Vec } | null = null;
    for (const p of clipped) {
      const top = planeUndersideAt(plane, p) + vertical;
      if (!best || top > best.top) best = { top, at: p };
    }
    if (!best) continue;
    const overMm = best.top - storeyH;
    if (overMm > ROOF_CLASH_TOL_MM) {
      out.push({
        planeId: plane.id,
        overMm: Math.round(overMm),
        at: { x: Math.round(best.at.x), y: Math.round(best.at.y) },
      });
    }
  }
  return out;
}
