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
  PlanDoc, Floor, Id, OpeningKind, wallHeight, floorHeight, openingSill, openingHeight, videsOf,
  stairsOf, type WallMaterial,
} from "../model/doc";
import {
  Vec, v, add, sub, scale, pointInPolygon, distToSeg, clipHalfPlane, polygonArea, perp, norm, cross,
} from "../geometry/vec";
import { stairwellHole } from "./stair3d";
import { resolveFloor } from "./resolve";
import { detectRooms, outerBoundary } from "./rooms";
import { videBox } from "./vide";
import { worldPoint } from "./placed";
import type { Vide } from "../model/vide";

export interface Prism { poly: Vec[]; z0: number; z1: number }

export interface OpeningVoid { openingId: Id; kind: OpeningKind; poly: Vec[]; z0: number; z1: number }

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
    const h = wallHeight(f, rw.wall);
    const body: Prism[] = rw.pieces.map(p => ({ poly: p.poly, z0: 0, z1: h }));
    const voids: OpeningVoid[] = rw.openings.map(og => {
      const o = og.opening;
      const sill = openingSill(o);
      const z1 = Math.min(sill + openingHeight(o), h);
      const z0 = Math.min(sill, z1);
      // Same quad the wall's own pieces are built from: left side (+half)
      // start->end, then right side (-half) end->start.
      const poly: Vec[] = [
        add(og.p0, scale(og.n0, og.half)),
        add(og.p1, scale(og.n1, og.half)),
        sub(og.p1, scale(og.n1, og.half)),
        sub(og.p0, scale(og.n0, og.half)),
      ];
      return { openingId: o.id, kind: o.kind, poly, z0, z1 };
    });
    const posts: Prism[] = [];
    for (const pm of rw.posts) if (pm.poly) posts.push({ poly: pm.poly, z0: 0, z1: h });
    walls.push({ wallId: rw.wall.id, body, voids, posts });
  }

  const fh = floorHeight(f);
  const spaces: SpaceSolid[] = detectRooms(f).map(r => ({
    ...(r.name !== undefined ? { name: r.name } : {}),
    poly: r.netPoly, z0: 0, z1: fh,
  }));

  const wallById = new Map(f.walls.map(w => [w.id, w] as const));
  const junctions: JunctionSolid[] = resolved.junctions.map(j => {
    let h = Infinity;
    for (const id of j.walls) {
      const w = wallById.get(id);
      if (w) h = Math.min(h, wallHeight(f, w));
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
