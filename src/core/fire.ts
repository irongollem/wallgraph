// Compartment boundaries: the rated walls of a storey chained into runs of
// centerline, so the canvas and the exports draw one dashed line per boundary
// with the rating repeated along it. Derived per revision, never stored.
import { arcFlatten } from "../geometry/arc";
import { shapeOf, shapesOverlap, type Shape } from "../geometry/overlap";
import { add, dist, norm, perp, scale, sub, type Vec } from "../geometry/vec";
import { fireLabel, stairsOf, structureOf, furnishingsOf, type FireRating, type Floor, type Id } from "../model/doc";
import { getSymbol } from "../render/symbols";
import { textWidth } from "../render/textwidth";
import { furnishingCorners } from "./furnishing";
import { symbolFootprintCorners } from "./placed";
import type { Resolved } from "./resolve";
import { looseRoomNames, type Room } from "./rooms";
import { resolveStair, stairCorners } from "./stair";
import { structureCorners } from "./structure";

/** Chord tolerance for flattening an arc wall; the figure `detectRooms()` uses. */
const FLATTEN_MM = 5;

/** Text height of a compartment label, world mm. Every renderer draws at this size. */
export const FIRE_LABEL_SIZE_MM = 120;
/** Distance along a run between nominal label positions. */
export const FIRE_LABEL_MM = 4000;

/** Margin kept between a label rectangle and anything else drawn, mm. */
const CLEARANCE_MM = 60;
/** Step of the slide along the run when a nominal position is blocked, mm. */
const SLIDE_STEP_MM = 250;
/** Step of the perpendicular offset from the line, mm. */
const OFFSET_STEP_MM = 100;
/** Largest perpendicular offset tried, mm. */
const MAX_OFFSET_MM = 1500;
/** Room label text sizes in the exports (io/svg.ts), mm. */
const ROOM_NAME_SIZE_MM = 220;
/** Width of a room's area or size line, which is not measured, mm. */
const ROOM_LINE_WIDTH_MM = 1300;
/** Extent of a room's label stack about its centroid: name above, lines below, mm. */
const ROOM_BLOCK_ABOVE_MM = 300 + 220;
const ROOM_BLOCK_BELOW_MM = 300 + 60;

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

/** One placement of a run's label. */
export interface FireLabel {
  /** Centre of the text, world mm. */
  at: Vec;
  /** The text, from fireLabel(). */
  text: string;
  /**
   * Degrees clockwise in y-down world space, in [-90, 90): the run's local
   * direction turned so the text never reads upside down; a vertical run
   * reads bottom to top.
   */
  angleDeg: number;
}

export interface FireLayout { runs: FireRun[]; labels: FireLabel[] }

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
 * A direction's angle in degrees clockwise (y-down), turned into [-90, 90).
 * A vertical run reads bottom to top, the drafting convention. permit.ts turns
 * dimension text on a different boundary; the two are independent.
 */
export function readableAngleDeg(dir: Vec): number {
  let deg = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
  if (deg >= 90) deg -= 180;
  else if (deg < -90) deg += 180;
  return deg;
}

/** Closed ring from the four corners `boxCorners()` returns (x0y0, x0y1, x1y0, x1y1). */
const ringOfBox = (c: Vec[]): Vec[] => [c[0]!, c[2]!, c[3]!, c[1]!];

/** Everything a label must stay clear of, built once per layout. */
function obstaclesOf(floor: Floor, resolved: Resolved, rooms: readonly Room[], runs: FireRun[]): Shape[] {
  const out: Shape[] = [];
  const poly = (pts: Vec[]): void => { if (pts.length >= 3) out.push(shapeOf(pts, true)); };

  for (const rw of resolved.walls.values()) {
    for (const p of rw.pieces) poly(p.poly);
    for (const p of rw.facade) poly(p.poly);
    for (const face of rw.boards) for (const band of face) for (const p of band.pieces) poly(p.poly);
    for (const face of rw.frame) for (const p of face) poly(p.poly);
  }
  for (const j of resolved.junctions) poly(j.poly);

  for (const run of runs) {
    for (let i = 1; i < run.pts.length; i++) out.push(shapeOf([run.pts[i - 1]!, run.pts[i]!], false));
  }

  // The canvas draws room labels at a constant screen size; these boxes are the
  // world-space layout the exports use, and a conservative figure at ordinary zoom.
  const box = (cx: number, w: number, y0: number, y1: number): void =>
    poly([{ x: cx - w / 2, y: y0 }, { x: cx + w / 2, y: y0 }, { x: cx + w / 2, y: y1 }, { x: cx - w / 2, y: y1 }]);
  for (const r of rooms) {
    const nameW = r.name === undefined ? 0 : textWidth(r.name, true) * ROOM_NAME_SIZE_MM;
    box(r.centroid.x, Math.max(nameW, ROOM_LINE_WIDTH_MM),
      r.centroid.y - ROOM_BLOCK_ABOVE_MM, r.centroid.y + ROOM_BLOCK_BELOW_MM);
  }
  for (const rn of looseRoomNames(floor, rooms as Room[])) {
    box(rn.x, textWidth(rn.name, true) * ROOM_NAME_SIZE_MM, rn.y - ROOM_NAME_SIZE_MM, rn.y);
  }

  for (const s of floor.symbols) {
    const def = getSymbol(s.type);
    if (def) poly(symbolFootprintCorners(def, s));
  }
  for (const f of furnishingsOf(floor)) poly(ringOfBox(furnishingCorners(f)));
  for (const st of stairsOf(floor)) poly(ringOfBox(stairCorners(resolveStair(floor, st))));
  for (const el of structureOf(floor)) poly(ringOfBox(structureCorners(el)));
  return out;
}

/** A run with its cumulative length at each vertex. */
interface Walk { run: FireRun; cum: number[] }

/** The point and unit direction at arc length `s` along a run. */
function locate(w: Walk, s: number): { p: Vec; dir: Vec } {
  const { pts } = w.run, { cum } = w;
  let i = 1;
  while (i < pts.length - 1 && cum[i]! < s) i++;
  const a = pts[i - 1]!, b = pts[i]!;
  const seg = cum[i]! - cum[i - 1]!;
  const dir = norm(sub(b, a));
  const t = seg > 0 ? Math.min(1, Math.max(0, (s - cum[i - 1]!) / seg)) : 0;
  return { p: add(a, scale(sub(b, a), t)), dir };
}

/** Arc-length targets: the middle of each interval, or the midpoint of a short run. */
function targetsOf(lengthMm: number): number[] {
  const out: number[] = [];
  for (let t = FIRE_LABEL_MM / 2; t < lengthMm; t += FIRE_LABEL_MM) out.push(t);
  if (out.length === 0) out.push(lengthMm / 2);
  return out;
}

/** Slides along the run from a target: 0, +S, -S, +2S, -2S, ... within half an interval. */
const SLIDES: number[] = (() => {
  const out = [0];
  for (let k = 1; k * SLIDE_STEP_MM <= FIRE_LABEL_MM / 2; k++) out.push(k * SLIDE_STEP_MM, -k * SLIDE_STEP_MM);
  return out;
})();

/** Perpendicular offsets from the line, nearest first. */
const OFFSETS: number[] = (() => {
  const out: number[] = [];
  for (let o = FIRE_LABEL_SIZE_MM / 2 + CLEARANCE_MM; o <= MAX_OFFSET_MM; o += OFFSET_STEP_MM) out.push(o);
  return out;
})();

/**
 * The runs of a storey and where their labels go, clear of what is drawn.
 *
 * Each run is labelled at nominal positions every `FIRE_LABEL_MM`, starting
 * half an interval in. A position is tried first as is, then slid along the
 * run, and at each slide on both sides of the line (the `perp` side first) at
 * growing distance. The first rectangle that overlaps no wall body or skin, no
 * run line (its own included), no room label block, fixture, stair or
 * structural element and no label already placed is taken; a position with no
 * clear rectangle is skipped. A run left with no label takes the candidate
 * that overlaps the fewest obstacles, the first in search order on a tie.
 * Output order is run order, then along the run.
 */
export function fireLayout(floor: Floor, resolved: Resolved, rooms: readonly Room[]): FireLayout {
  const runs = fireRuns(floor, resolved);
  const labels: FireLabel[] = [];
  if (runs.length === 0) return { runs, labels };

  const obstacles = obstaclesOf(floor, resolved, rooms, runs);

  interface Candidate { at: Vec; angleDeg: number; rect: Shape }
  /** Candidates for one target, in search order. */
  function* candidates(w: Walk, target: number, half: number): Generator<Candidate> {
    for (const slide of SLIDES) {
      const s = Math.min(w.run.lengthMm, Math.max(0, target + slide));
      const { p, dir } = locate(w, s);
      const n = perp(dir);
      const angleDeg = readableAngleDeg(dir);
      for (const side of [1, -1]) {
        for (const off of OFFSETS) {
          const at = add(p, scale(n, side * off));
          const u = scale(dir, half + CLEARANCE_MM);
          const v = scale(n, FIRE_LABEL_SIZE_MM / 2 + CLEARANCE_MM);
          const rect = shapeOf([
            add(add(at, u), v), add(sub(at, u), v), sub(sub(at, u), v), sub(add(at, u), v),
          ], true);
          yield { at, angleDeg, rect };
        }
      }
    }
  }

  const clear = (rect: Shape, placed: Shape[]): boolean =>
    !obstacles.some(o => shapesOverlap(rect, o)) && !placed.some(o => shapesOverlap(rect, o));
  const hits = (rect: Shape, placed: Shape[]): number =>
    obstacles.reduce((n, o) => n + (shapesOverlap(rect, o) ? 1 : 0), 0)
    + placed.reduce((n, o) => n + (shapesOverlap(rect, o) ? 1 : 0), 0);

  const placed: Shape[] = [];
  for (const run of runs) {
    if (run.pts.length < 2 || !(run.lengthMm > 0)) continue;
    const cum = [0];
    for (let i = 1; i < run.pts.length; i++) cum.push(cum[i - 1]! + dist(run.pts[i - 1]!, run.pts[i]!));
    const w: Walk = { run, cum };
    const text = fireLabel(run.rating);
    const half = textWidth(text, false) * FIRE_LABEL_SIZE_MM / 2;
    const targets = targetsOf(run.lengthMm);
    const before = labels.length;

    for (const target of targets) {
      for (const c of candidates(w, target, half)) {
        if (!clear(c.rect, placed)) continue;
        labels.push({ at: c.at, text, angleDeg: c.angleDeg });
        placed.push(c.rect);
        break;
      }
    }

    if (labels.length === before) {
      // Every candidate is blocked: keep one label, at the candidate that
      // overlaps the fewest obstacles.
      let best: Candidate | null = null;
      let bestHits = Infinity;
      for (const target of targets) {
        for (const c of candidates(w, target, half)) {
          const h = hits(c.rect, placed);
          if (h < bestHits) { best = c; bestHits = h; }
        }
      }
      if (best) {
        labels.push({ at: best.at, text, angleDeg: best.angleDeg });
        placed.push(best.rect);
      }
    }
  }
  return { runs, labels };
}
