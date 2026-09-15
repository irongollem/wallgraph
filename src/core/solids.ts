// Derived 3D solids for one storey: the prisms an IFC element export and a
// future 3D view both consume, built from the same resolved 2D geometry the
// canvas and the exporters already draw from.
//
// Pure and uncached — like the rest of core/, this recomputes from `doc` on
// every call. Callers cache against `store.revision`, same as resolveFloor()
// and detectRooms().
//
// Units: millimetres throughout; floats are fine here (only the document
// itself is integer mm, per invariant 1). x/y stay document space (y down) —
// this module does no axis remapping, exactly like the DXF and SVG writers;
// an IFC exporter maps axes itself. z is height above THIS STOREY'S OWN floor
// level, positive up; a caller placing a storey in the building adds
// floorElevation(doc, floorIndex).
import {
  PlanDoc, Floor, Id, OpeningKind, Wall, wallHeight, floorHeight, openingSill, openingHeight, videsOf,
  stairsOf, type WallMaterial,
} from "../model/doc";
import { wallTopAt, wallTopPolyline } from "../model/profile";
import { roofPlanesOf, roofThicknessOf } from "../model/roof";
import {
  Vec, v, add, sub, scale, dot, mid, pointInPolygon, distToSeg, clipHalfPlane, polygonArea, perp, norm, cross,
  angleOf,
} from "../geometry/vec";
import { arcInfo, arcPointAt, arcTangentAt, sweepOf } from "../geometry/arc";
import { stairwellHole } from "./stair3d";
import { resolveFloor, type ResolvedWall } from "./resolve";
import { detectRooms, outerBoundary } from "./rooms";
import { planeUndersideAt } from "./roof";
import { videBox } from "./vide";
import { worldPoint } from "./placed";
import type { Vide } from "../model/vide";

export interface Prism {
  poly: Vec[];
  z0: number;
  /** The top -- the highest point when `top` is present. */
  z1: number;
  /**
   * Per-vertex top height, parallel to `poly`, present only where the wall
   * states a profile (model/profile.ts). Absent means flat at `z1`, which is
   * what every consumer that predates the profile still reads. A wall piece
   * carrying one is split at every profile breakpoint strictly inside its own
   * span (see wallBodyPrisms() below), so the top is linear across each
   * piece and a straight piece's roof is planar.
   */
  top?: number[];
}

export interface OpeningVoid {
  openingId: Id; kind: OpeningKind; poly: Vec[]; z0: number; z1: number;
  /** The wall above the head on a sloped wall: the void's footprint split at
   *  the profile breakpoints, from `z1` up to the top per vertex. Absent on a
   *  flat wall, where the band above a head ends at the wall's one height. */
  above?: Prism[];
}

export interface WallSolid {
  wallId: Id;
  body: Prism[];
  voids: OpeningVoid[];
  /**
   * The wall's posts (stijlen) as full-height prisms, present only where the
   * wall states a profile width (Wall.postMm) — resolveFloor() derives their
   * footprints. The frame of an infill wall; solid regardless of what the
   * body is filled with.
   */
  posts: Prism[];
}

export interface SpaceSolid { name?: string; poly: Vec[]; z0: 0; z1: number }

export interface SlabSolid { outline: Vec[]; holes: Vec[][]; z0: number; z1: 0 }

export interface JunctionSolid extends Prism { material?: WallMaterial }

export interface FloorSolids {
  walls: WallSolid[];
  spaces: SpaceSolid[];
  slab: SlabSolid | null;
  /**
   * Junction filler wedges as prisms: the polygons resolveFloor() derives for
   * nodes where three or more walls meet, which belong to no single wall. As
   * tall as the SHORTEST wall at the node — the filler can only cover a gap,
   * and material above the lowest meeting wall would invent fabric no wall
   * states.
   * `material` is present only when all meeting walls state the same material;
   * a mixed junction falls back to masonry in consumers.
   */
  junctions: JunctionSolid[];
  /**
   * The plate over the storey BELOW where this storey does not itself cover
   * it: the roof of a set-back lower storey, which is this storey's outdoor
   * floor (a dakterras). Same z-band as `slab`. Null on the ground floor, when
   * the storey below has no boundary, or when this storey's own boundary
   * already covers it. Where this storey's boundary lies strictly inside the
   * plate, it is carried as a hole so the plate and the slab tile the level
   * rather than overlap.
   */
  terrace: SlabSolid | null;
}

/**
 * Slab thickness, mm — a derived-side constant rather than a stored per-floor
 * value; a stored thickness is a later issue.
 */
export const SLAB_DEFAULT_MM = 200;

/**
 * The solids for one storey, or null when the floor index is out of range or
 * the floor carries no walls at all — there is nothing to build a body from.
 * A floor whose walls don't enclose anything still returns walls and spaces;
 * only `slab` goes null in that case (see outerBoundary()).
 */
export function floorSolids(doc: PlanDoc, floorIndex: number): FloorSolids | null {
  const f: Floor | undefined = doc.floors[floorIndex];
  if (!f || f.walls.length === 0) return null;

  const resolved = resolveFloor(f);
  const walls: WallSolid[] = [];
  for (const rw of resolved.walls.values()) {
    const body: Prism[] = wallBodyPrisms(f, rw);
    const voids: OpeningVoid[] = rw.openings.map(og => {
      const o = og.opening;
      const sill = openingSill(o);
      // Clipped to the lowest point of the wall's own top over the opening's
      // span, not to the flat height -- a void above a sloped top is not there.
      const top = minTopOver(f, rw.wall, rw.length, o.t - o.width / 2, o.t + o.width / 2);
      const z1 = Math.min(sill + openingHeight(o), top);
      const z0 = Math.min(sill, z1);
      // Same quad the wall's own pieces are built from: left side (+half)
      // start->end, then right side (-half) end->start.
      const poly: Vec[] = [
        add(og.p0, scale(og.n0, og.half)),
        add(og.p1, scale(og.n1, og.half)),
        sub(og.p1, scale(og.n1, og.half)),
        sub(og.p0, scale(og.n0, og.half)),
      ];
      if (!rw.wall.profile || rw.wall.profile.length === 0) return { openingId: o.id, kind: o.kind, poly, z0, z1 };
      const L = rw.length;
      const breaks = wallTopPolyline(f, rw.wall, L).map(p => p.s).filter(b => b > 0.5 && b < L - 0.5);
      const above: Prism[] = splitAtBreaks(poly, rw.a, rw.b, rw.wall.bulge, L, breaks).map(part => {
        const tops = part.map(p => wallTopAt(f, rw.wall, projectS(rw.a, rw.b, rw.wall.bulge, L, p)));
        return { poly: part, z0: z1, z1: Math.max(...tops), top: tops };
      });
      return { openingId: o.id, kind: o.kind, poly, z0, z1, above };
    });
    const posts: Prism[] = [];
    for (const pm of rw.posts) {
      if (!pm.poly) continue;
      const s = projectS(rw.a, rw.b, rw.wall.bulge, rw.length, mid(pm.a, pm.b));
      posts.push({ poly: pm.poly, z0: 0, z1: wallTopAt(f, rw.wall, s) });
    }
    walls.push({ wallId: rw.wall.id, body, voids, posts });
  }

  const fh = floorHeight(f);
  const spaces: SpaceSolid[] = detectRooms(f).map(r => ({
    ...(r.name !== undefined ? { name: r.name } : {}),
    poly: r.netPoly, z0: 0, z1: fh,
  }));

  const wallById = new Map(f.walls.map(w => [w.id, w] as const));
  const junctions: JunctionSolid[] = resolved.junctions.map(j => {
    // As tall as the LOWEST top the meeting walls state AT THIS NODE -- the
    // end height (wallTopAt(0) or wallTopAt(L)), not the walls' flat
    // wallHeight(), so a gable end meeting a flat wall at its low end takes
    // that low end, not the gable's own peak.
    let h = Infinity;
    for (const id of j.walls) {
      const w = wallById.get(id);
      const rw = resolved.walls.get(id);
      if (!w || !rw) continue;
      const s = w.a === j.node ? 0 : w.b === j.node ? rw.length : undefined;
      if (s !== undefined) h = Math.min(h, wallTopAt(f, w, s));
    }
    const first = wallById.get(j.walls[0] ?? "");
    const material = first && j.walls.every(id => wallById.get(id)?.material === first.material)
      ? first.material : undefined;
    return {
      poly: j.poly, z0: 0, z1: isFinite(h) ? h : floorHeight(f),
      ...(material !== undefined ? { material } : {}),
    };
  });

  const outline = outerBoundary(f);
  const holes = videsOf(f).map(vd => videHole(vd));

  const below = floorIndex > 0 ? doc.floors[floorIndex - 1] : undefined;
  // The stairwells: where a flight on the storey below climbs through this
  // level, the envelope of its headroom-critical steps (stairwellHole) is cut
  // from the slab and the terrace plate the way a vide is. Wells that meet
  // each other merge into one; a well that meets an authored hole is dropped,
  // the drawn vide being taken as the trapgat.
  let wells: Vec[][] = [];
  if (below) {
    const soffit = floorHeight(below) - SLAB_DEFAULT_MM;
    for (const s of stairsOf(below)) {
      const hole = stairwellHole(below, s, soffit);
      if (hole) wells = mergeWells(wells, hole);
    }
  }

  const slab: SlabSolid | null = outline === null ? null : {
    outline,
    holes: plateHoles(wells, outline, holes),
    z0: -SLAB_DEFAULT_MM, z1: 0,
  };

  const belowOutline = below && below.walls.length > 0 ? outerBoundary(below) : null;
  let terrace: SlabSolid | null = null;
  if (belowOutline && !(outline && coveredBy(belowOutline, outline))) {
    // Vides inside the upper outline are already outside the terrace material;
    // passing them as nested holes would make the triangulation self-cross.
    const terraceVides = outline ? holes.filter(h => !coveredBy(h, outline)) : holes;
    const tHoles = outline && coveredBy(outline, belowOutline) ? [outline, ...terraceVides] : terraceVides;
    terrace = {
      outline: belowOutline,
      holes: plateHoles(wells, belowOutline, tHoles),
      z0: -SLAB_DEFAULT_MM, z1: 0,
    };
  }

  return { walls, spaces, slab, junctions, terrace };
}

/**
 * The wall's own pieces (ResolvedWall.pieces, already split at every opening)
 * extruded to its top profile: a wall stating none produces exactly the flat
 * prisms floorSolids() always has, with no `top` field. A wall stating one
 * gets each piece split again at every profile breakpoint strictly inside its
 * own span, so within one resulting piece the top is linear along the wall —
 * planar for a straight piece — and every vertex carries the top height at
 * its own projection onto the centerline.
 */
function wallBodyPrisms(f: Floor, rw: ResolvedWall): Prism[] {
  const w = rw.wall;
  if (!w.profile || w.profile.length === 0) {
    const h = wallHeight(f, w);
    return rw.pieces.map(p => ({ poly: p.poly, z0: 0, z1: h }));
  }
  const L = rw.length;
  const breaks = wallTopPolyline(f, w, L).map(p => p.s).filter(s => s > 0.5 && s < L - 0.5);
  const out: Prism[] = [];
  for (const piece of rw.pieces) {
    for (const poly of splitAtBreaks(piece.poly, rw.a, rw.b, w.bulge, L, breaks)) {
      const top = poly.map(p => wallTopAt(f, w, projectS(rw.a, rw.b, w.bulge, L, p)));
      out.push({ poly, z0: 0, z1: Math.max(...top), top });
    }
  }
  return out;
}

/** `poly` cut at every `s` in `breaks` by the line through the wall's
 *  centerline point there, perpendicular to the wall (arc-aware: the normal
 *  is the outgoing tangent at that point, so the cut follows the local width
 *  direction rather than the chord). Degenerate slivers are dropped. */
function splitAtBreaks(poly: Vec[], A: Vec, B: Vec, bulge: number, L: number, breaks: readonly number[]): Vec[][] {
  if (breaks.length === 0 || L <= 0) return poly.length >= 3 ? [poly] : [];
  const out: Vec[][] = [];
  let remainder = poly;
  for (const s of [...breaks].sort((a, b) => a - b)) {
    const t = Math.max(0, Math.min(1, s / L));
    const o = arcPointAt(A, B, bulge, t);
    const n = arcTangentAt(A, B, bulge, t);
    const before = clipHalfPlane(remainder, o, scale(n, -1));
    const after = clipHalfPlane(remainder, o, n);
    if (before.length >= 3) out.push(before);
    remainder = after;
  }
  if (remainder.length >= 3) out.push(remainder);
  return out;
}

/**
 * Where a point projects onto the wall's centerline, mm from node a, clamped
 * to [0, L]: the dot-product parameter for a straight wall, or the point's
 * angle about the arc centre mapped to arc length for a bulged one.
 */
function projectS(A: Vec, B: Vec, bulge: number, L: number, p: Vec): number {
  if (L <= 0) return 0;
  if (bulge === 0) {
    const ab = sub(B, A);
    const l2 = dot(ab, ab) || 1;
    return Math.max(0, Math.min(L, (dot(sub(p, A), ab) / l2) * L));
  }
  const info = arcInfo(A, B, bulge);
  if (!info) return 0;
  const sweep = sweepOf(info);
  const TAU = Math.PI * 2;
  let d = angleOf(sub(p, info.center)) - info.a0;
  if (sweep < 0) { while (d > 0) d -= TAU; while (d < sweep) d += TAU; } else { while (d < 0) d += TAU; while (d > sweep) d -= TAU; }
  const t = sweep === 0 ? 0 : Math.max(0, Math.min(1, d / sweep));
  return t * L;
}

/** The lowest point of the wall's own top over [s0, s1] -- a piecewise-linear
 *  function's minimum over an interval is always at one of its breakpoints or
 *  the interval's own ends. Mirrors core/surface.ts's localTop() without the
 *  ceiling cap, which is a finish concern this module has no notion of. */
function minTopOver(f: Floor, w: Wall, L: number, s0: number, s1: number): number {
  const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(L, Math.max(s0, s1));
  let m = Math.min(wallTopAt(f, w, lo), wallTopAt(f, w, hi));
  for (const p of wallTopPolyline(f, w, L)) if (p.s > lo && p.s < hi) m = Math.min(m, p.h);
  return m;
}

interface Box2 { x0: number; y0: number; x1: number; y1: number }

function ringBox(poly: Vec[]): Box2 {
  const b: Box2 = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of poly) {
    if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x;
    if (p.y < b.y0) b.y0 = p.y; if (p.y > b.y1) b.y1 = p.y;
  }
  return b;
}

const boxesOverlap = (a: Box2, b: Box2): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/**
 * Fold one well into the set: wells whose bounds meet merge into their shared
 * bounding quad — two flights side by side share one clean hole, because
 * overlapping hole rings cannot be triangulated. Merging is by axis-aligned
 * bounds, which over-cuts for rotated flights that touch; it errs open.
 */
function mergeWells(wells: Vec[][], hole: Vec[]): Vec[][] {
  let merged = hole;
  let rest = wells;
  for (let grew = true; grew;) {
    grew = false;
    const keep: Vec[][] = [];
    for (const w of rest) {
      if (boxesOverlap(ringBox(w), ringBox(merged))) {
        const a = ringBox(w), b = ringBox(merged);
        const u: Box2 = {
          x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
          x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
        };
        merged = [v(u.x0, u.y0), v(u.x1, u.y0), v(u.x1, u.y1), v(u.x0, u.y1)];
        grew = true;
      } else keep.push(w);
    }
    rest = keep;
  }
  return [...rest, merged];
}

/**
 * All holes a plate at this level actually takes. Each stairwell is trimmed
 * to the plate boundary and merged with any authored hole it touches, because
 * the cap triangulator requires disjoint, non-nested hole rings.
 */
function plateHoles(wells: Vec[][], outline: Vec[], holes: Vec[][]): Vec[][] {
  let out = holes.slice();
  const n = outline.length;
  const sign = polygonArea(outline) >= 0 ? 1 : -1;
  for (const well of wells) {
    let w = well;
    const wb = ringBox(well);
    const near: Box2 = { x0: wb.x0 - 1, y0: wb.y0 - 1, x1: wb.x1 + 1, y1: wb.y1 + 1 };
    for (let i = 0; i < n && w.length >= 3; i++) {
      const a = outline[i]!, b = outline[(i + 1) % n]!;
      if (!boxesOverlap(near, ringBox([a, b]))) continue;
      // Interior is left of travel for a positive ring, right for a negative.
      const inward = scale(perp(norm(sub(b, a))), sign);
      w = clipHalfPlane(w, a, inward);
    }
    if (w.length < 3 || Math.abs(polygonArea(w)) < 1) continue;
    let cx = 0, cy = 0;
    for (const p of w) { cx += p.x; cy += p.y; }
    const c = v(cx / w.length, cy / w.length);
    if (!pointInPolygon(c, outline)) continue;
    // Hole rings may neither overlap nor nest when they are bridged for cap
    // triangulation. Fold a partially covered stairwell into the authored
    // opening instead of dropping the uncovered part. The convex hull can
    // over-cut a concave union, which is preferable to putting slab back over
    // headroom-critical steps.
    let merged = w;
    for (let changed = true; changed;) {
      changed = false;
      const keep: Vec[][] = [];
      for (const h of out) {
        if (ringsMeet(merged, h)) {
          merged = convexHull([...merged, ...h]);
          changed = true;
        } else keep.push(h);
      }
      out = keep;
    }
    out.push(merged);
  }
  return out;
}

function ringsMeet(a: Vec[], b: Vec[]): boolean {
  if (!boxesOverlap(ringBox(a), ringBox(b))) return false;
  if (a.some(p => pointInOrOn(p, b)) || b.some(p => pointInOrOn(p, a))) return true;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!, a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsMeet(a0, a1, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}

function pointInOrOn(p: Vec, poly: Vec[]): boolean {
  if (pointInPolygon(p, poly)) return true;
  return poly.some((q, i) => distToSeg(p, q, poly[(i + 1) % poly.length]!).d <= COVER_TOL);
}

function segmentsMeet(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const ab = sub(b, a), cd = sub(d, c);
  const den = cross(ab, cd);
  if (Math.abs(den) <= 1e-9) {
    return distToSeg(a, c, d).d <= COVER_TOL || distToSeg(b, c, d).d <= COVER_TOL
      || distToSeg(c, a, b).d <= COVER_TOL || distToSeg(d, a, b).d <= COVER_TOL;
  }
  const ac = sub(c, a);
  const t = cross(ac, cd) / den;
  const u = cross(ac, ab) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Smallest convex ring containing the points, in y-down document space. */
function convexHull(points: Vec[]): Vec[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((p, i) => i === 0 || p.x !== sorted[i - 1]!.x || p.y !== sorted[i - 1]!.y);
  if (unique.length < 3) return unique;
  const half = (pts: Vec[]): Vec[] => {
    const out: Vec[] = [];
    for (const p of pts) {
      while (out.length >= 2
        && cross(sub(out[out.length - 1]!, out[out.length - 2]!), sub(p, out[out.length - 1]!)) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out;
  };
  const lower = half(unique);
  const upper = half(unique.slice().reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Tolerance for a boundary vertex lying on the other boundary, mm. The face
 *  walk quantises vertices to whole mm, so identical outlines land exactly. */
const COVER_TOL = 1.5;

/**
 * Whether every vertex of `inner` lies inside `outer` or on its boundary — a
 * vertex test, not a full polygon containment, which is enough for building
 * outlines: the stacked-identical and set-back cases it decides are the ones
 * that occur, and a false positive needs boundaries that interleave without
 * placing a vertex outside.
 */
function coveredBy(inner: Vec[], outer: Vec[]): boolean {
  const n = outer.length;
  return inner.every(p => {
    if (pointInPolygon(p, outer)) return true;
    for (let i = 0; i < n; i++) {
      if (distToSeg(p, outer[i]!, outer[(i + 1) % n]!).d <= COVER_TOL) return true;
    }
    return false;
  });
}

/**
 * One roof plane as a slab standing on its own underside: `poly` is the
 * plane's own outline, `bottom` its underside per vertex (this plane's own
 * formula -- see core/roof.ts's planeUndersideAt(), not the lowest-of-all
 * roofUndersideAt() a ridge reads), `top` the same vertices offset VERTICALLY
 * by thickness/cos(pitch). That vertical offset is exactly a prism of
 * `thicknessMm` (or the ROOF_THICKNESS_DEFAULT_MM placeholder) measured
 * SQUARE TO THE PLANE: moving every point of a tilted plane the same amount
 * straight up puts the two planes a perpendicular distance of
 * (vertical offset) x cos(pitch) apart, which is `thicknessMm` exactly when
 * the vertical offset is thicknessMm / cos(pitch). Parallel arrays, like
 * Prism.top, so a renderer or exporter can build the six faces directly
 * without re-deriving the plane's own equation.
 */
export interface RoofSlabSolid {
  planeId: Id;
  poly: Vec[];
  bottom: number[];
  top: number[];
}

/**
 * Every roof plane on this storey as a slab. Standalone rather than folded
 * into FloorSolids: a roof plane is authored independently of the wall graph
 * (model/roof.ts) and can exist on a floor with no walls at all, where
 * floorSolids() returns null outright.
 */
export function roofSlabSolids(f: Floor): RoofSlabSolid[] {
  const out: RoofSlabSolid[] = [];
  for (const plane of roofPlanesOf(f)) {
    if (plane.outline.length < 3) continue;
    const poly = plane.outline.map(p => v(p.x, p.y));
    const cosPitch = Math.cos((plane.pitchDeg * Math.PI) / 180);
    const vertical = cosPitch > 1e-6 ? roofThicknessOf(plane) / cosPitch : roofThicknessOf(plane);
    const bottom = poly.map(p => planeUndersideAt(plane, p));
    const top = bottom.map(h => h + vertical);
    out.push({ planeId: plane.id, poly, bottom, top });
  }
  return out;
}

/** A vide's footprint as a world-space quad, corners in traversal order —
 *  the rectangle cut from the slab. */
export function videHole(vd: Vide): Vec[] {
  const b = videBox(vd);
  return [
    worldPoint(vd, { x: b.x0, y: b.y0 }),
    worldPoint(vd, { x: b.x1, y: b.y0 }),
    worldPoint(vd, { x: b.x1, y: b.y1 }),
    worldPoint(vd, { x: b.x0, y: b.y1 }),
  ];
}
