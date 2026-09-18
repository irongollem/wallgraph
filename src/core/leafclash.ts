// A column that reaches past a wall's structural face into the zone a
// voorzetwand would occupy, or already occupies. Nothing here is stored: a
// protrusion, a proposed stand-off and a build-up clash are all reports,
// derived fresh from the document and its resolve on every call -- the same
// "proposes, never owns" stance core/autoroute.ts and core/roofsuggest.ts
// take. Nothing writes a FaceFrame.gapMm or refuses a build-up because of
// what is found here.
import { Floor, Id, Wall, buildUpOf, faceRunsOf, FaceRun, normalizeFaceRuns } from "../model/doc";
import type { Column } from "../model/structure";
import { columnOutline } from "./structure";
import type { Resolved } from "./resolve";
import { Vec, dist, dot, sub, norm, perp, distToSeg, pointInPolygon, angleOf } from "../geometry/vec";
import { arcInfo, sweepOf, type ArcInfo } from "../geometry/arc";

/** How far past a wall's structural face the voorzetwand zone reaches, mm --
 *  a column standing clear of this can never be a candidate for either
 *  face's build-up, so it is not worth reporting. */
const ZONE_REACH_MM = 1000;

export interface ColumnProtrusion {
  columnId: Id;
  wallId: Id;
  side: "left" | "right";
  /** Extent along the host centerline the column's footprint spans, mm from
   *  node a. */
  tFromMm: number;
  tToMm: number;
  /** Beyond the structural face, mm. Always > 0. */
  protrusionMm: number;
}

/** A column's footprint projected onto one wall's own (t, s) frame: t is mm
 *  from node a along the centerline (arc length on a bulged wall), s is mm
 *  from the centerline, positive toward "left" -- +perp(tangent), the
 *  clockwise visual side (invariant 2), the same sign facadeSide uses. */
interface Projection { tMin: number; tMax: number; sMin: number; sMax: number }

/** t (mm from node a) of a point near a bulged wall's own arc: the angle from
 *  the arc's centre, expressed as a fraction of the wall's own sweep and
 *  scaled to its length -- the same angular projection leaf.ts's hostMmAt()
 *  uses to place a leaf's ends against its host. */
function arcMmAt(info: ArcInfo, length: number, p: Vec): number {
  const sweep = sweepOf(info);
  if (sweep === 0) return 0;
  const TAU = Math.PI * 2;
  let d = (angleOf(sub(p, info.center)) - info.a0) % TAU;
  if (info.ccw) { if (d > 0) d -= TAU; if (d <= -TAU) d += TAU; }
  else { if (d < 0) d += TAU; if (d >= TAU) d -= TAU; }
  return (d / sweep) * length;
}

/**
 * Project a polygon onto a straight wall's (t, s) frame. t and s are both
 * linear in world coordinates on a straight wall, so the extremes of a
 * polygon -- convex or not -- are always at its vertices.
 */
function projectStraight(poly: readonly Vec[], A: Vec, B: Vec): Projection {
  const tan = norm(sub(B, A));
  const nrm = perp(tan); // "left" positive
  let tMin = Infinity, tMax = -Infinity, sMin = Infinity, sMax = -Infinity;
  for (const p of poly) {
    const t = dot(sub(p, A), tan), s = dot(sub(p, A), nrm);
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    sMin = Math.min(sMin, s); sMax = Math.max(sMax, s);
  }
  return { tMin, tMax, sMin, sMax };
}

/**
 * Project a polygon onto a bulged wall's (t, s) frame, measured radially: s
 * is the signed distance from the arc, `sign(bulge) * (r - radius)`, which
 * is +perp(tangent) at any point ON the arc (see arcTangentAt) and extends
 * that same sense to a point off it. A linear functional's max over a
 * segment is always at an endpoint, so the polygon's greatest radius is a
 * vertex maximum; its least radius is not (a segment can pass closest to the
 * centre at an interior point), so that one edge is checked properly with
 * distToSeg rather than sampled only at corners.
 */
function projectArc(poly: readonly Vec[], info: ArcInfo, length: number): Projection {
  let rMin = Infinity, rMax = -Infinity;
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i]!, p1 = poly[(i + 1) % poly.length]!;
    rMax = Math.max(rMax, dist(p0, info.center));
    rMin = Math.min(rMin, distToSeg(info.center, p0, p1).d);
    const t = arcMmAt(info, length, p0);
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
  }
  if (pointInPolygon(info.center, poly as Vec[])) rMin = 0;
  const outward = info.ccw; // bulge > 0: perp(tangent) ("left") points away from the centre
  const sMax = outward ? rMax - info.radius : info.radius - rMin;
  const sMin = outward ? rMin - info.radius : info.radius - rMax;
  return { tMin, tMax, sMin, sMax };
}

function project(poly: readonly Vec[], w: Wall, A: Vec, B: Vec, length: number): Projection {
  if (w.bulge === 0) return projectStraight(poly, A, B);
  const info = arcInfo(A, B, w.bulge);
  if (!info) return projectStraight(poly, A, B);
  return projectArc(poly, info, length);
}

interface Entry { columnId: Id; wallId: Id; side: "left" | "right"; tFrom: number; tTo: number; protrusion: number }

/**
 * Every column-face pair whose footprint overlaps the band from the
 * structural face out to ZONE_REACH_MM on that side, within the wall's own
 * t range -- raw (unrounded) figures, shared by columnProtrusions() (which
 * rounds each entry) and proposedGapMm() (which needs the unrounded value so
 * its ceiling always clears).
 */
function protrusionEntries(f: Floor, resolved: Resolved): Entry[] {
  const columns = (f.structure ?? []).filter((s): s is Column => s.kind === "column");
  if (columns.length === 0) return [];
  const out: Entry[] = [];
  for (const w of f.walls) {
    const rw = resolved.walls.get(w.id);
    if (!rw) continue;
    const half = w.thickness / 2;
    for (const c of columns) {
      const poly = columnOutline(c);
      const proj = project(poly, w, rw.a, rw.b, rw.length);
      if (proj.tMax <= 0 || proj.tMin >= rw.length) continue; // beyond the wall's own ends
      for (const side of ["left", "right"] as const) {
        const sMax = side === "left" ? proj.sMax : -proj.sMin;
        const sMin = side === "left" ? proj.sMin : -proj.sMax;
        if (sMax <= half) continue;                    // does not reach the structural face
        if (sMin >= half + ZONE_REACH_MM) continue;     // wholly clear of the zone
        out.push({
          columnId: c.id, wallId: w.id, side,
          tFrom: Math.max(0, proj.tMin), tTo: Math.min(rw.length, proj.tMax),
          protrusion: sMax - half,
        });
      }
    }
  }
  return out;
}

/** Every column that reaches past a wall's structural face into the zone a
 *  voorzetwand would occupy. */
export function columnProtrusions(f: Floor, resolved: Resolved): ColumnProtrusion[] {
  return protrusionEntries(f, resolved).map(e => ({
    columnId: e.columnId, wallId: e.wallId, side: e.side,
    tFromMm: Math.round(e.tFrom), tToMm: Math.round(e.tTo), protrusionMm: Math.round(e.protrusion),
  }));
}

/** How far short of a protruding column a proposed run stops, mm, on either
 *  side of it -- room for the frame to be cut square and closed off (an end
 *  stud, a plate end) beside the column, not to touch it. */
const RUN_CLEARANCE_MM = 50;

/**
 * The face split around each column that protrudes into it, with
 * RUN_CLEARANCE_MM clearance either side: the alternative to standing the
 * whole face off (proposedGapMm) -- stop the voorzetwand either side of the
 * column and case it separately instead. Reads protrusionEntries() (the same
 * raw, unrounded data proposedGapMm() reads, and the query columnProtrusions()
 * itself is built from), so the two proposals cannot disagree about which
 * columns are in the way; the clearance is added to the raw figures for the
 * same reason proposedGapMm() ceils on them rather than on the rounded
 * columnProtrusions() -- so the proposed run always clears the column it was
 * measured from.
 *
 * Null where nothing protrudes -- a face with no columns in it is not a face
 * with no runs. Where a column (with its clearance) covers the whole face,
 * this returns an empty array rather than null: something did protrude, and
 * the split leaves no run to build.
 */
export function proposedRuns(
  f: Floor, resolved: Resolved, wallId: Id, side: "left" | "right",
): FaceRun[] | null {
  const rw = resolved.walls.get(wallId);
  if (!rw) return null;
  const matching = protrusionEntries(f, resolved).filter(e => e.wallId === wallId && e.side === side);
  if (matching.length === 0) return null;

  const gaps = matching
    .map(e => ({
      from: Math.max(0, e.tFrom - RUN_CLEARANCE_MM),
      to: Math.min(rw.length, e.tTo + RUN_CLEARANCE_MM),
    }))
    .sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const g of gaps) {
    const last = merged[merged.length - 1];
    if (last && g.from <= last.to) last.to = Math.max(last.to, g.to);
    else merged.push({ ...g });
  }

  const runs: FaceRun[] = [];
  let cursor = 0;
  for (const g of merged) {
    if (g.from > cursor) runs.push({ fromMm: cursor, toMm: g.from });
    cursor = Math.max(cursor, g.to);
  }
  if (cursor < rw.length) runs.push({ fromMm: cursor, toMm: rw.length });
  return normalizeFaceRuns(runs, rw.length);
}

/** The stand-off a face would need to clear its columns: the ceiling of the
 *  largest protrusion, or null where nothing protrudes. Ceils on the raw
 *  (unrounded) figure, not columnProtrusions()'s already-rounded one, so the
 *  proposal always clears the column it was measured from. */
export function proposedGapMm(f: Floor, resolved: Resolved, wallId: Id, side: "left" | "right"): number | null {
  const matching = protrusionEntries(f, resolved).filter(e => e.wallId === wallId && e.side === side);
  if (matching.length === 0) return null;
  return Math.ceil(Math.max(...matching.map(e => e.protrusion)));
}

/** Protrusions that still reach into a stated build-up: past `gapMm` on a
 *  framed face, past the structural face at all on an unframed board stack.
 *  A face that states no build-up at all cannot clash. */
export function buildUpClashes(f: Floor, resolved: Resolved): ColumnProtrusion[] {
  const walls = new Map(f.walls.map(w => [w.id, w]));
  return columnProtrusions(f, resolved).filter(p => {
    const w = walls.get(p.wallId);
    if (!w) return false;
    const fu = buildUpOf(w, p.side);
    if (!fu) return false;
    // A column standing where the face states no build-up is not a clash:
    // there is nothing there to clash with. This is what makes proposedRuns()
    // an actual answer to a clash rather than a second opinion about it --
    // splitting the face around the column clears the report the same way
    // standing the whole face off does.
    const rw = resolved.walls.get(p.wallId);
    const stated = faceRunsOf(w, p.side);
    if (stated && rw) {
      const runs = normalizeFaceRuns(stated, rw.length);
      if (!runs.some(r => r.fromMm < p.tToMm && r.toMm > p.tFromMm)) return false;
    }
    const frame = fu.frame;
    if (!frame) return true; // unframed board stack: any protrusion clashes
    return p.protrusionMm > frame.gapMm;
  });
}
