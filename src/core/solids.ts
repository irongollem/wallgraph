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
} from "../model/doc";
import { Vec, add, sub, scale, pointInPolygon, distToSeg } from "../geometry/vec";
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
   */
  junctions: Prism[];
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
  const junctions: Prism[] = resolved.junctions.map(j => {
    let h = Infinity;
    for (const id of j.walls) {
      const w = wallById.get(id);
      if (w) h = Math.min(h, wallHeight(f, w));
    }
    return { poly: j.poly, z0: 0, z1: isFinite(h) ? h : floorHeight(f) };
  });

  const outline = outerBoundary(f);
  const holes = videsOf(f).map(vd => videHole(vd));
  const slab: SlabSolid | null = outline === null ? null : {
    outline, holes, z0: -SLAB_DEFAULT_MM, z1: 0,
  };

  const below = floorIndex > 0 ? doc.floors[floorIndex - 1] : undefined;
  const belowOutline = below && below.walls.length > 0 ? outerBoundary(below) : null;
  let terrace: SlabSolid | null = null;
  if (belowOutline && !(outline && coveredBy(belowOutline, outline))) {
    terrace = {
      outline: belowOutline,
      holes: outline && coveredBy(outline, belowOutline) ? [outline, ...holes] : [...holes],
      z0: -SLAB_DEFAULT_MM, z1: 0,
    };
  }

  return { walls, spaces, slab, junctions, terrace };
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
function videHole(vd: Vide): Vec[] {
  const b = videBox(vd);
  return [
    worldPoint(vd, { x: b.x0, y: b.y0 }),
    worldPoint(vd, { x: b.x1, y: b.y0 }),
    worldPoint(vd, { x: b.x1, y: b.y1 }),
    worldPoint(vd, { x: b.x0, y: b.y1 }),
  ];
}
