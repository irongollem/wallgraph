// Graph-maintenance operations shared by tools: node reuse, wall splitting,
// welded wall insertion, opening placement bounds, orphan cleanup. All take the
// floor mutably; callers wrap them in store.mutate().
import { Floor, PlanNode, Wall, Opening, Id, newId, roomNamesOf } from "./doc";
import { Vec, dist, distToSeg, v, add, sub, scale, dot, cross, norm, perp, lineIntersect } from "../geometry/vec";
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

/** Split a wall, or return null when the cut would pass through an opening. */
export function splitWall(f: Floor, w: Wall, tMm: number): PlanNode | null {
  const a = f.nodes.find(n => n.id === w.a)!;
  const b = f.nodes.find(n => n.id === w.b)!;
  const L = wallLength(f, w);
  const tt = Math.max(1, Math.min(L - 1, tMm));
  if (!openingsFitCuts(w, L, [tt])) return null;
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

/**
 * Where a ray from `origin` crosses a wall, taking the crossing nearest `near`
 * and only within `tol` of it.
 *
 * A wall drawn under the angle lock is aimed rather than placed: the drawer
 * points at the wall to be met, and the cursor lands wherever the pixel it is
 * over falls. Without this the quantised point stops short of that wall or runs
 * past it, leaving an end hanging in the room that no room detection can close.
 */
export function wallOnRay(
  f: Floor, origin: Vec, dir: Vec, near: Vec, tol: number,
): { wall: Wall; d: number; tMm: number; p: Vec } | null {
  let best: { wall: Wall; d: number; tMm: number; p: Vec } | null = null;
  const hit = (w: Wall, A: Vec, B: Vec, acc: number): void => {
    const seg = sub(B, A);
    const den = cross(dir, seg);
    if (Math.abs(den) < 1e-9) return;                 // parallel: nothing to meet
    const q = sub(A, origin);
    const s = cross(q, seg) / den;                    // along the ray
    const u = cross(q, dir) / den;                    // along the segment
    if (s <= WELD_TOL || u < 0 || u > 1) return;      // behind the origin, or past an end
    const p = add(origin, scale(dir, s));
    const d = dist(p, near);
    if (d <= tol && (!best || d < best.d)) best = { wall: w, d, tMm: acc + u * dist(A, B), p };
  };
  for (const w of f.walls) {
    const a = f.nodes.find(n => n.id === w.a)!;
    const b = f.nodes.find(n => n.id === w.b)!;
    const A = v(a.x, a.y), B = v(b.x, b.y);
    if (w.bulge === 0) { hit(w, A, B, 0); continue; }
    const pts = arcFlatten(A, B, w.bulge, 2);
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      hit(w, pts[i]!, pts[i + 1]!, acc);
      acc += dist(pts[i]!, pts[i + 1]!);
    }
  }
  return best;
}

/**
 * How far off a centerline a point may be and still count as on it. Stored
 * coordinates are integer millimetres, so a point meant to lie on a wall lies
 * on it to within rounding.
 */
export const WELD_TOL = 1; // mm

/** Shortest wall the tools create; below this the two ends are one node. */
export const MIN_WALL_MM = 10;

/** Clearance between an opening jamb and the end of the wall that carries it. */
const OPENING_END_CLEARANCE_MM = 10;

/** True when every opening remains wholly on one wall segment after these cuts. */
function openingsFitCuts(w: Wall, length: number, cuts: number[]): boolean {
  const stops = dedupe([0, length, ...cuts.filter(t => t > WELD_TOL && t < length - WELD_TOL)]);
  return w.openings.every(o => {
    const left = o.t - o.width / 2 - OPENING_END_CLEARANCE_MM;
    const right = o.t + o.width / 2 + OPENING_END_CLEARANCE_MM;
    return stops.some((start, i) => i + 1 < stops.length
      && left >= start - WELD_TOL && right <= stops[i + 1]! + WELD_TOL);
  });
}

/**
 * Add a wall from node a to node b, welded into what is already drawn.
 *
 * The document is a planar graph, so a new wall may not cross an existing one
 * without a node at the crossing, and two walls may not occupy the same stretch
 * of the same line. Three things therefore happen before anything is pushed:
 *
 * - every existing wall the new one crosses is split at the crossing, and the
 *   new wall is split there too;
 * - the new wall is split at any existing node it runs through;
 * - a stretch a collinear wall already carries is not drawn again; that wall is
 *   split at the new wall's ends instead, so two rooms drawn side by side share
 *   one wall rather than stacking two.
 *
 * The shared stretch keeps the thickness it had: an existing wall is not
 * rebuilt because something was drawn against it.
 *
 * Returns the walls created, which is none when the run was already there.
 */
export function insertWall(f: Floor, aId: Id, bId: Id, thickness: number, bulge = 0): Wall[] {
  if (aId === bId) return [];
  const na = f.nodes.find(n => n.id === aId), nb = f.nodes.find(n => n.id === bId);
  if (!na || !nb) return [];
  const A = v(na.x, na.y), B = v(nb.x, nb.y);
  const L = dist(A, B);
  if (L < MIN_WALL_MM) return [];
  if (bulge !== 0) return insertArc(f, aId, bId, thickness, bulge);

  const dir = norm(sub(B, A));
  const nrm = perp(dir);
  const along = (p: Vec): number => dot(sub(p, A), dir);
  const offset = (p: Vec): number => dot(sub(p, A), nrm);

  /** Where to cut the new wall, mm from A. */
  const cuts: number[] = [];
  /** Stretches of the new wall a collinear wall already carries. */
  const covered: Array<[number, number]> = [];
  /** Existing wall id -> where to cut it, mm from its own node a. */
  const splits = new Map<Id, number[]>();
  const cutExisting = (w: Wall, t: number): void => {
    const list = splits.get(w.id);
    if (list) list.push(t); else splits.set(w.id, [t]);
  };

  for (const w of f.walls) {
    // Arc walls are left alone. An arc-to-line intersection is the same
    // precision cut resolveFloor already documents, and a wrong weld is worse
    // than none: drawing across a curved wall still places its node by hand.
    if (w.bulge !== 0) continue;
    const p = f.nodes.find(n => n.id === w.a), q = f.nodes.find(n => n.id === w.b);
    if (!p || !q) continue;
    const P = v(p.x, p.y), Q = v(q.x, q.y);
    const Lw = dist(P, Q);
    if (Lw < WELD_TOL) continue;
    const sP = along(P), sQ = along(Q);

    if (Math.abs(offset(P)) <= WELD_TOL && Math.abs(offset(Q)) <= WELD_TOL) {
      // Collinear: whatever stretch the two share is already walled.
      const lo = Math.min(sP, sQ), hi = Math.max(sP, sQ);
      const c0 = Math.max(0, lo), c1 = Math.min(L, hi);
      if (c1 - c0 <= WELD_TOL) continue;   // meeting end to end is not an overlap
      covered.push([c0, c1]);
      if (c0 > WELD_TOL) cuts.push(c0);
      if (c1 < L - WELD_TOL) cuts.push(c1);
      // The existing wall gets a node wherever the new one starts or stops
      // inside it, so the two meet at a node instead of overlapping.
      for (const s of [0, L]) {
        if (s > lo + WELD_TOL && s < hi - WELD_TOL) cutExisting(w, sP < sQ ? s - lo : hi - s);
      }
      continue;
    }

    const x = lineIntersect(A, dir, P, norm(sub(Q, P)));
    if (!x) continue;                      // parallel without being collinear
    const s = along(x), u = dot(sub(x, P), norm(sub(Q, P)));
    if (s < -WELD_TOL || s > L + WELD_TOL) continue;
    if (u < -WELD_TOL || u > Lw + WELD_TOL) continue;
    if (u > WELD_TOL && u < Lw - WELD_TOL) cutExisting(w, u);
    if (s > WELD_TOL && s < L - WELD_TOL) cuts.push(s);
  }

  // A node the new wall runs through is a junction whether a wall crosses there
  // or not: an existing wall may simply end on it.
  for (const n of f.nodes) {
    if (n.id === aId || n.id === bId) continue;
    const P = v(n.x, n.y);
    if (Math.abs(offset(P)) > WELD_TOL) continue;
    const s = along(P);
    if (s > WELD_TOL && s < L - WELD_TOL) cuts.push(s);
  }

  // A split through an opening would leave its jambs outside the child wall, so
  // that weld is dropped — but the wall being drawn still goes in. Refusing the
  // whole insertion loses it silently, and a rectangle drawn across a door came
  // out with one or two of its sides simply absent. A wall that lands in a
  // doorway is a drawing to correct; one that never appeared is a drawing that
  // cannot be. The opening is left exactly as it was authored either way.
  for (const [id, ts] of [...splits]) {
    const w = f.walls.find(x => x.id === id);
    if (w && !openingsFitCuts(w, wallLength(f, w), ts)) splits.delete(id);
  }

  for (const [id, ts] of splits) {
    const w = f.walls.find(x => x.id === id);
    if (!w) continue;
    // splitWall keeps the near half in w, so cutting from the far end first
    // leaves the parameters of the cuts before it untouched.
    for (const t of dedupe(ts).reverse()) {
      const Lw = wallLength(f, w);
      if (t > WELD_TOL && t < Lw - WELD_TOL) splitWall(f, w, t);
    }
  }

  const stops = dedupe([0, L, ...cuts]);
  const made: Wall[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const t0 = stops[i]!, t1 = stops[i + 1]!;
    const m = (t0 + t1) / 2;
    if (covered.some(([c0, c1]) => m > c0 && m < c1)) continue;
    const n0 = nodeAt(f, add(A, scale(dir, t0)));
    const n1 = nodeAt(f, add(A, scale(dir, t1)));
    if (n0.id === n1.id) continue;
    if (f.walls.some(w => w.bulge === 0
      && ((w.a === n0.id && w.b === n1.id) || (w.a === n1.id && w.b === n0.id)))) continue;
    const w: Wall = { id: newId("w"), a: n0.id, b: n1.id, thickness, bulge: 0, openings: [] };
    f.walls.push(w);
    made.push(w);
  }
  return made;
}

/** An arc wall goes in as drawn; only an identical one is refused. */
function insertArc(f: Floor, aId: Id, bId: Id, thickness: number, bulge: number): Wall[] {
  const same = f.walls.some(w =>
    (w.a === aId && w.b === bId && Math.abs(w.bulge - bulge) < 1e-6)
    || (w.a === bId && w.b === aId && Math.abs(w.bulge + bulge) < 1e-6));
  if (same) return [];
  const w: Wall = { id: newId("w"), a: aId, b: bId, thickness, bulge, openings: [] };
  f.walls.push(w);
  return [w];
}

/**
 * A closed ring of walls: what the rectangle, circle and polygon shapes draw,
 * and what closing a wall chain completes. Every edge is welded in turn, so a
 * ring drawn against an existing one shares its walls rather than doubling them.
 */
export function insertRun(f: Floor, points: Vec[], bulges: number[], thickness: number): Wall[] {
  const ids = points.map(p => nodeAt(f, p).id);
  const made: Wall[] = [];
  for (let i = 0; i < ids.length; i++) {
    made.push(...insertWall(f, ids[i]!, ids[(i + 1) % ids.length]!, thickness, bulges[i] ?? 0));
  }
  // A ring drawn entirely on top of existing walls leaves its corner nodes
  // behind with nothing attached to them.
  cleanOrphanNodes(f);
  return made;
}

/** Sorted, with values within tol of the one before them dropped. */
function dedupe(values: number[], tol = WELD_TOL): number[] {
  const out: number[] = [];
  for (const x of [...values].sort((p, q) => p - q)) {
    if (out.length === 0 || x - out[out.length - 1]! > tol) out.push(x);
  }
  return out;
}

/**
 * Remove stored room names by id. What a wall edit hands in is the names its
 * merge left with nothing to name; see orphanedRoomNames() in core/rooms.ts for
 * which those are and why the larger room's name is the one that stays.
 */
export function deleteRoomNames(f: Floor, ids: readonly Id[]): void {
  if (ids.length === 0) return;
  const dead = new Set(ids);
  f.roomNames = roomNamesOf(f).filter(rn => !dead.has(rn.id));
}
