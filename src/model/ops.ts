// Graph-maintenance operations shared by tools: node reuse, wall splitting,
// opening placement bounds, orphan cleanup. All take the floor mutably; callers
// wrap them in store.mutate().
import { Floor, PlanNode, Wall, Opening, Id, newId } from "./doc";
import { Vec, dist, distToSeg, v } from "../geometry/vec";
import { arcLength, arcPointAt, arcFlatten } from "../geometry/arc";

export const NODE_MERGE_TOL = 1; // mm

export function wallLength(f: Floor, w: Wall): number {
  const a = f.nodes.find(n => n.id === w.a)!;
  const b = f.nodes.find(n => n.id === w.b)!;
  return arcLength(v(a.x, a.y), v(b.x, b.y), w.bulge);
}

/** Get or create a node at p (mm, rounded to integers). Reuses a node within tol. */
export function nodeAt(f: Floor, p: Vec, tol = NODE_MERGE_TOL): PlanNode {
  const x = Math.round(p.x), y = Math.round(p.y);
  for (const n of f.nodes) if (dist(v(n.x, n.y), v(x, y)) <= tol) return n;
  const n: PlanNode = { id: newId("n"), x, y };
  f.nodes.push(n);
  return n;
}

/** Split wall w at parameter t (mm along centerline) into two walls sharing a new node. */
export function splitWall(f: Floor, w: Wall, tMm: number): PlanNode {
  const a = f.nodes.find(n => n.id === w.a)!;
  const b = f.nodes.find(n => n.id === w.b)!;
  const L = wallLength(f, w);
  const tt = Math.max(1, Math.min(L - 1, tMm));
  // Split point on the centerline (arc-aware).
  const frac = tt / L;
  const p = arcPointAt(v(a.x, a.y), v(b.x, b.y), w.bulge, frac);
  const mid = nodeAt(f, p, 0.5);
  // Bulge split: approximate by preserving sagitta proportionally. For straight walls this is exact (0).
  let bulge1 = 0, bulge2 = 0;
  if (w.bulge !== 0) {
    // Keep each half's included angle = theta * frac -> bulge = tan(theta_half/4)
    const theta = 4 * Math.atan(w.bulge);
    bulge1 = Math.tan((theta * frac) / 4);
    bulge2 = Math.tan((theta * (1 - frac)) / 4);
  }
  const w2: Wall = { id: newId("w"), a: mid.id, b: w.b, thickness: w.thickness, bulge: bulge2, openings: [] };
  w.b = mid.id;
  w.bulge = bulge1;
  // Redistribute openings by centre position.
  const keep: Opening[] = [], moved: Opening[] = [];
  for (const o of w.openings) {
    if (o.t <= tt) keep.push(o);
    else { o.t = o.t - tt; moved.push(o); }
  }
  w.openings = keep;
  w2.openings = moved;
  f.walls.push(w2);
  return mid;
}

/** Clamp an opening so both jambs stay on the wall. */
export function clampOpening(f: Floor, w: Wall, o: Opening): void {
  const L = wallLength(f, w);
  o.width = Math.max(100, Math.min(o.width, L - 20));
  o.t = Math.max(o.width / 2 + 10, Math.min(L - o.width / 2 - 10, o.t));
}

export function deleteWall(f: Floor, id: Id): void {
  f.walls = f.walls.filter(w => w.id !== id);
  cleanOrphanNodes(f);
}

export function cleanOrphanNodes(f: Floor): void {
  const used = new Set<Id>();
  for (const w of f.walls) { used.add(w.a); used.add(w.b); }
  f.nodes = f.nodes.filter(n => used.has(n.id));
}

/** Merge node b into node a (used when dragging one node onto another). */
export function mergeNodes(f: Floor, aId: Id, bId: Id): void {
  if (aId === bId) return;
  for (const w of f.walls) {
    if (w.a === bId) w.a = aId;
    if (w.b === bId) w.b = aId;
  }
  // Remove degenerate walls (both ends same node).
  f.walls = f.walls.filter(w => w.a !== w.b);
  f.nodes = f.nodes.filter(n => n.id !== bId);
}

/** Nearest wall to p within tol (mm): returns wall, distance, and mm offset along it. */
export function nearestWall(f: Floor, p: Vec, tol: number): { wall: Wall; d: number; tMm: number } | null {
  let best: { wall: Wall; d: number; tMm: number } | null = null;
  for (const w of f.walls) {
    const a = f.nodes.find(n => n.id === w.a)!;
    const b = f.nodes.find(n => n.id === w.b)!;
    const A = v(a.x, a.y), B = v(b.x, b.y);
    if (w.bulge === 0) {
      const { d, t } = distToSeg(p, A, B);
      if (d <= tol && (!best || d < best.d)) best = { wall: w, d, tMm: t * dist(A, B) };
    } else {
      // Sample the flattened arc.
      const pts = arcFlatten(A, B, w.bulge, 2);
      let acc = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const s0 = pts[i]!, s1 = pts[i + 1]!;
        const segLen = dist(s0, s1);
        const { d, t } = distToSeg(p, s0, s1);
        if (d <= tol && (!best || d < best.d)) best = { wall: w, d, tMm: acc + t * segLen };
        acc += segLen;
      }
    }
  }
  return best;
}
