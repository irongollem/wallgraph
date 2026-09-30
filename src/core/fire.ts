// Compartment boundaries: the rated walls of a storey chained into runs of
// centerline, so the canvas and the exports draw one dashed line per boundary
// with the rating repeated along it. Derived per revision, never stored.
import { arcFlatten } from "../geometry/arc";
import { add, dist, norm, perp, scale, sub, type Vec } from "../geometry/vec";
import { fireLabel, type FireRating, type Floor, type Id } from "../model/doc";
import type { Resolved } from "./resolve";

/** Chord tolerance for flattening an arc wall; the figure `detectRooms()` uses. */
const FLATTEN_MM = 5;

/** Distance along a run between repeated labels. */
export const FIRE_LABEL_MM = 4000;
/**
 * Offset of a label from the line, along the perpendicular of the local
 * direction.
 *
 * Sized against the label's WIDTH, not its height: the text is drawn upright
 * whatever the run's direction, so a vertical run puts roughly half of
 * "WBDBO 60" at 120 mm across the line, while a horizontal one puts only half
 * a line of text. One figure has to clear the worse case, which is the
 * vertical one.
 */
export const FIRE_LABEL_OFFSET_MM = 420;

/** One connected run of walls that all state the same rating. */
export interface FireRun {
  /** The rating every wall in the run states. */
  rating: FireRating;
  /** The run's centerline, walls chained end to end, arcs flattened. */
  pts: Vec[];
  /** The walls in the run, in path order. */
  wallIds: Id[];
  /** Length along `pts`, mm. */
  lengthMm: number;
}

/** One placement of the run's label. */
export interface FireLabel {
  /** Where the text sits, offset clear of the line. */
  at: Vec;
  /** The text, from fireLabel(). */
  text: string;
}

interface Edge {
  id: Id;
  a: Id;
  b: Id;
  rating: FireRating;
  /** Flattened centerline from node `a` to node `b`. */
  pts: Vec[];
}

const ratingKey = (r: FireRating): string => `${r.kind}:${r.minutes}`;

function pathLength(pts: Vec[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

/**
 * The compartment boundaries a storey states. Walls join only at a node shared
 * with another rated wall of the same rating; a node where three or more such
 * walls meet ends every run there. A closed compartment yields one polyline
 * whose last point equals its first. Empty where no wall is rated.
 */
export function fireRuns(floor: Floor, resolved: Resolved): FireRun[] {
  const nodeIds = new Set(floor.nodes.map(n => n.id));
  const edges = new Map<Id, Edge>();
  for (const w of floor.walls) {
    if (!w.fireRating || w.a === w.b) continue;
    if (!nodeIds.has(w.a) || !nodeIds.has(w.b)) continue;
    const rw = resolved.walls.get(w.id);
    if (!rw) continue;
    edges.set(w.id, {
      id: w.id, a: w.a, b: w.b, rating: w.fireRating,
      pts: arcFlatten(rw.a, rw.b, w.bulge, FLATTEN_MM),
    });
  }

  // Same-rating rated walls incident to each node, built once.
  const at = new Map<string, Edge[]>();
  const slot = (e: Edge, node: Id): string => `${ratingKey(e.rating)}|${node}`;
  for (const e of edges.values()) {
    for (const node of [e.a, e.b]) {
      const k = slot(e, node);
      const list = at.get(k);
      if (list) list.push(e); else at.set(k, [e]);
    }
  }
  const incident = (e: Edge, node: Id): Edge[] => at.get(slot(e, node)) ?? [];

  const sorted = [...edges.values()].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const used = new Set<Id>();
  const runs: FireRun[] = [];

  /** Walk from `first`, entering at `from`, until a node that is not a plain pass-through. */
  const walk = (first: Edge, from: Id): FireRun => {
    const wallIds: Id[] = [];
    const pts: Vec[] = [];
    let e = first;
    let entry = from;
    for (;;) {
      used.add(e.id);
      wallIds.push(e.id);
      const oriented = entry === e.a ? e.pts : [...e.pts].reverse();
      for (let i = pts.length === 0 ? 0 : 1; i < oriented.length; i++) pts.push(oriented[i]!);
      const exit = entry === e.a ? e.b : e.a;
      const here = incident(e, exit);
      if (here.length !== 2) break;
      const next = here[0] === e ? here[1]! : here[0]!;
      if (used.has(next.id)) break;
      e = next;
      entry = exit;
    }
    return { rating: first.rating, pts, wallIds, lengthMm: pathLength(pts) };
  };

  // Open runs first: start at every wall end that is not a pass-through node.
  for (const e of sorted) {
    if (used.has(e.id)) continue;
    for (const node of [e.a, e.b]) {
      if (incident(e, node).length === 2) continue;
      runs.push(walk(e, node));
      break;
    }
  }
  // What remains lies on cycles, every node having exactly two walls.
  for (const e of sorted) {
    if (used.has(e.id)) continue;
    runs.push(walk(e, e.a));
  }

  return runs.sort((p, q) => (p.wallIds[0]! < q.wallIds[0]! ? -1 : p.wallIds[0]! > q.wallIds[0]! ? 1 : 0));
}

/**
 * Where a run repeats its label: every `FIRE_LABEL_MM`, starting half an
 * interval in, so a short run carries one label near its middle. A degenerate
 * run yields none.
 */
export function fireLabels(run: FireRun): FireLabel[] {
  const { pts } = run;
  if (pts.length < 2 || !(run.lengthMm > 0)) return [];
  const text = fireLabel(run.rating);
  const out: FireLabel[] = [];
  let walked = 0;
  let target = FIRE_LABEL_MM / 2;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!, q = pts[i]!;
    const seg = dist(p, q);
    if (seg === 0) continue;
    const dir = norm(sub(q, p));
    const off = scale(perp(dir), FIRE_LABEL_OFFSET_MM);
    while (target <= walked + seg && target < run.lengthMm) {
      out.push({ at: add(add(p, scale(dir, target - walked)), off), text });
      target += FIRE_LABEL_MM;
    }
    walked += seg;
  }
  if (out.length === 0) {
    // Floating-point shortfall on a very short run: fall back to the midpoint.
    const p = pts[0]!, q = pts[pts.length - 1]!;
    const dir = norm(sub(q, p));
    out.push({ at: add({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, scale(perp(dir), FIRE_LABEL_OFFSET_MM)), text });
  }
  return out;
}
