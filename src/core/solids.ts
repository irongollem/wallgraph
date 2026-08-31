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
import { Vec, add, sub, scale } from "../geometry/vec";
import { resolveFloor } from "./resolve";
import { detectRooms, outerBoundary } from "./rooms";
import { videBox } from "./vide";
import { worldPoint } from "./placed";
import type { Vide } from "../model/vide";

export interface Prism { poly: Vec[]; z0: number; z1: number }

export interface OpeningVoid { openingId: Id; kind: OpeningKind; poly: Vec[]; z0: number; z1: number }

export interface WallSolid { wallId: Id; body: Prism[]; voids: OpeningVoid[] }

export interface SpaceSolid { name?: string; poly: Vec[]; z0: 0; z1: number }

export interface SlabSolid { outline: Vec[]; holes: Vec[][]; z0: number; z1: 0 }

export interface FloorSolids { walls: WallSolid[]; spaces: SpaceSolid[]; slab: SlabSolid | null }

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
    walls.push({ wallId: rw.wall.id, body, voids });
  }

  const fh = floorHeight(f);
  const spaces: SpaceSolid[] = detectRooms(f).map(r => ({
    ...(r.name !== undefined ? { name: r.name } : {}),
    poly: r.netPoly, z0: 0, z1: fh,
  }));

  const outline = outerBoundary(f);
  const slab: SlabSolid | null = outline === null ? null : {
    outline,
    holes: videsOf(f).map(vd => videHole(vd)),
    z0: -SLAB_DEFAULT_MM, z1: 0,
  };

  return { walls, spaces, slab };
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
