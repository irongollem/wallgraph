// Ray/segment intersection shared by the tape measure and the setting-out dimensions.
import { Vec, add, sub, scale, cross } from "./vec";

export type Edge = readonly [Vec, Vec];

export interface RayHit {
  p: Vec;
  /** Distance from the origin along `dir`, in units of |dir|. */
  s: number;
  /** Index into the edge list. */
  index: number;
}

/**
 * Every place the ray from `origin` along `dir` meets an edge, farther than
 * `minS` from the origin. Edges parallel to the ray are skipped.
 */
export function rayHits(edges: readonly Edge[], origin: Vec, dir: Vec, minS: number): RayHit[] {
  const hits: RayHit[] = [];
  edges.forEach(([a, b], index) => {
    const seg = sub(b, a);
    const den = cross(dir, seg);
    if (Math.abs(den) < 1e-9) return;
    const q = sub(a, origin);
    const s = cross(q, seg) / den;
    const u = cross(q, dir) / den;
    if (s <= minS || u < 0 || u > 1) return;
    hits.push({ p: add(origin, scale(dir, s)), s, index });
  });
  return hits;
}
