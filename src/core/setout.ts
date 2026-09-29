// Setting-out dimensions (uitzetmaten): the distances from a placed item to the
// walls around it, for a builder locating a conduit or a floor socket before
// the screed. Derived on every revision; the item only states that it wants them.
import { Floor, SymbolInstance, Id } from "../model/doc";
import { Resolved } from "./resolve";
import { Vec, v, add, scale, fromAngle } from "../geometry/vec";
import { Edge, rayHits } from "../geometry/ray";

export interface SetOutDim {
  /** The item's own anchor. */
  from: Vec;
  /** Where the ray meets the wall face. */
  to: Vec;
  /** Whole millimetres. */
  lengthMm: number;
  wallId: Id;
}

/** Farthest wall a ray reaches, mm. */
export const SET_OUT_RANGE_MM = 20000;

/**
 * Rays leave the anchor along the item's own axes (its rotation and the three
 * quarter turns) and stop at the nearest STRUCTURAL face: the wall outline
 * with openings not carved, so a ray through a doorway measures to the wall
 * line, and without facade or build-up bands, which the screed precedes. Of
 * each opposite pair the shorter hit is kept, so at most one dimension per axis.
 */
export function setOutDims(_floor: Floor, resolved: Resolved, s: SymbolInstance): SetOutDim[] {
  const edges: Edge[] = [];
  const wallOf: Id[] = [];
  for (const rw of resolved.walls.values()) {
    const o = rw.outline;
    if (rw.wall.id === s.wallId) continue;
    for (let i = 0; i < o.length; i++) {
      edges.push([o[i]!, o[(i + 1) % o.length]!]);
      wallOf.push(rw.wall.id);
    }
  }
  const from = v(s.x, s.y);
  const out: SetOutDim[] = [];
  // A wall-snapped item stands on its host wall: the host is not a target and
  // the axis into the room (local y) is not dimensioned, only the run along it.
  for (const axis of s.wallId === undefined ? [0, 1] : [0]) {
    let best: SetOutDim | null = null;
    for (const k of [axis, axis + 2]) {
      const dir = fromAngle(s.rotation + (k * Math.PI) / 2);
      let near: { s: number; index: number } | null = null;
      for (const h of rayHits(edges, from, dir, 1)) {
        if (h.s <= SET_OUT_RANGE_MM && (!near || h.s < near.s)) near = h;
      }
      if (!near) continue;
      const lengthMm = Math.round(near.s);
      if (!best || lengthMm < best.lengthMm) {
        best = { from, to: add(from, scale(dir, near.s)), lengthMm, wallId: wallOf[near.index]! };
      }
    }
    if (best) out.push(best);
  }
  return out;
}
