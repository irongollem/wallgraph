// Dimension chains: the runs of dimensions a plan is actually read from.
//
// A single wall's length is what the editor needs to let you type a number. A
// drawing needs something else — one line along a facade with every opening and
// pier dimensioned in sequence, and an overall beneath it. That is what a
// builder sets out from, and it is why the two are separate here rather than
// one being a special case of the other.
//
// A chain measures in one of two conventions. Centerline runs axis to axis,
// which is what the graph stores and what the structure is set out from. Clear
// (dagmaat) puts every break on a wall face, which is what interior work is set
// out from: the span a kitchen run or a cupboard has to fit into. The two
// differ by half a wall at each junction, so a chain states which it is.
//
// A chain is a run of straight, collinear walls. Curved walls are excluded: a
// chain measures along a line, and a bowed wall has no single line to measure
// along. Its length still shows on the wall itself.
import { Floor, Wall, Id } from "../model/doc";
import { Vec, v, add, sub, scale, norm, dist, dot, cross, perp, pointInPolygon } from "../geometry/vec";
import { detectRooms } from "./rooms";

/** Which convention a chain's spans are measured in. */
export type ChainMode = "centerline" | "clear";

/** One measured span within a chain, as distances from the run's origin. */
export interface DimSpan {
  from: number;
  to: number;
  /** Rounded to whole millimetres, which is what the document stores anyway. */
  mm: number;
}

export interface DimChain {
  /** Start of the run, on the wall centerline. */
  origin: Vec;
  /** Unit direction along the run. */
  dir: Vec;
  /**
   * Unit normal pointing AWAY from the building, so the chain lands outside
   * rather than across the rooms it is measuring.
   */
  out: Vec;
  /** Half-thickness of the thickest wall in the run: how far the faces reach. */
  half: number;
  /**
   * Centerline length of the run. The measured extent is the spans: in clear
   * mode the first begins and the last ends on a wall face, inside `total`.
   */
  total: number;
  /** Openings and junctions, in order. */
  spans: DimSpan[];
  mode: ChainMode;
  wallIds: Id[];
}

/** Directions count as collinear within about a fifth of a degree. */
const PARALLEL_TOL = 0.003;
/** Ignore spans below this; they are miter slivers, not dimensions. */
const MIN_SPAN_MM = 20;
/** Below this sine a crossing wall is too near parallel to have a face across the run. */
const CROSS_TOL = 0.05;

interface Straight { wall: Wall; a: Vec; b: Vec; na: Id; nb: Id; dir: Vec; len: number }

/** The same wall traversed the other way. */
const flip = (s: Straight): Straight =>
  ({ ...s, a: s.b, b: s.a, na: s.nb, nb: s.na, dir: scale(s.dir, -1) });

/**
 * How far the faces of the walls crossing at `node` sit from it, measured along
 * `dir`. A wall meeting the run at an angle presents its face further along,
 * hence the 1/sin, capped the way resolve.ts caps a miter. Zero when nothing
 * crosses: a free end caps square on the node, so the face is the node.
 */
function faceOffset(floor: Floor, node: Id, dir: Vec, run: Set<Id>, pos: Map<Id, Vec>): number {
  const here = pos.get(node);
  if (!here) return 0;
  let off = 0;
  for (const w of floor.walls) {
    if (run.has(w.id)) continue;
    const other = w.a === node ? w.b : w.b === node ? w.a : undefined;
    if (other === undefined) continue;
    const p = pos.get(other);
    if (!p || dist(p, here) < 1) continue;
    // Chord direction. For an arc the tangent at the node differs slightly —
    // the same approximation resolve.ts makes at an arc miter.
    const sin = Math.abs(cross(norm(sub(p, here)), dir));
    if (sin < CROSS_TOL) continue;
    off = Math.max(off, Math.min(w.thickness / 2 / sin, w.thickness * 2));
  }
  return off;
}

/**
 * Every chain on a floor: one per run of collinear straight walls.
 *
 * Two walls continue the same run when they share a node and point the same
 * way. A T-junction does not break a run — the wall running through is still
 * one facade — which is why runs are grown from direction rather than from
 * node degree.
 */
export function dimensionChains(floor: Floor, mode: ChainMode = "centerline"): DimChain[] {
  const pos = new Map<Id, Vec>(floor.nodes.map(n => [n.id, v(n.x, n.y)] as const));
  const straights: Straight[] = [];
  for (const w of floor.walls) {
    if (w.bulge !== 0) continue;
    const a = pos.get(w.a), b = pos.get(w.b);
    if (!a || !b) continue;
    const len = dist(a, b);
    if (len < 1) continue;
    straights.push({ wall: w, a, b, na: w.a, nb: w.b, dir: norm(sub(b, a)), len });
  }
  if (straights.length === 0) return [];

  // Which side of a wall is "outside" is answered by the rooms, not by a
  // centroid: a centroid puts the chain on the wrong side of anything
  // non-convex, and cannot tell an interior wall from a facade at all.
  const rooms = detectRooms(floor).map(r => r.poly);
  const insideAnyRoom = (p: Vec): boolean => rooms.some(poly => pointInPolygon(p, poly));

  // Centroid, kept only as the fallback for a plan that encloses nothing yet.
  let cx = 0, cy = 0;
  for (const n of floor.nodes) { cx += n.x; cy += n.y; }
  const centre = v(cx / floor.nodes.length, cy / floor.nodes.length);

  const used = new Set<Id>();
  const chains: DimChain[] = [];

  for (const seed of straights) {
    if (used.has(seed.wall.id)) continue;
    const run: Straight[] = [seed];
    used.add(seed.wall.id);

    // Grow from both ends while the next wall is collinear and continues on.
    for (const forward of [true, false]) {
      for (;;) {
        const end = forward ? run[run.length - 1]! : run[0]!;
        const tip = forward ? end.b : end.a;
        const next = straights.find(s =>
          !used.has(s.wall.id)
          && Math.abs(cross(s.dir, end.dir)) < PARALLEL_TOL
          && (dist(s.a, tip) < 1 || dist(s.b, tip) < 1));
        if (!next) break;
        // Orient it to run the same way as the chain: growing forward it leaves
        // the tip, growing backward it arrives at it.
        const oriented = dist(forward ? next.a : next.b, tip) < 1 ? next : flip(next);
        if (dot(oriented.dir, end.dir) < 0) break;   // doubles back; not a run
        used.add(next.wall.id);
        if (forward) run.push(oriented);
        else run.unshift(oriented);
      }
    }

    const origin = run[0]!.a;
    const dir = run[0]!.dir;
    const runIds = new Set(run.map(s => s.wall.id));
    let cursor = 0;
    let half = 0;
    const joints: Array<{ d: number; node: Id }> = [{ d: 0, node: run[0]!.na }];
    const jambs: number[] = [];
    for (const s of run) {
      half = Math.max(half, s.wall.thickness / 2);
      // A wall whose stored a->b runs against the chain carries its openings
      // the other way round: `t` is measured from node a, so read it from the
      // far end.
      const flipped = s.na !== s.wall.a;
      for (const o of s.wall.openings) {
        const t = flipped ? s.len - o.t : o.t;
        jambs.push(cursor + t - o.width / 2, cursor + t + o.width / 2);
      }
      cursor += s.len;
      joints.push({ d: cursor, node: s.nb });
    }
    const total = cursor;

    // Opening jambs are already clear in either convention — an opening is
    // carved to its width — so only the junctions move.
    const breaks: number[] = [...jambs];
    for (const j of joints) {
      const off = mode === "clear" ? faceOffset(floor, j.node, dir, runIds, pos) : 0;
      if (off < 1) { breaks.push(j.d); continue; }
      // A junction inside the run contributes both faces of the wall crossing
      // there, which dimensions that wall between them; the run's own ends
      // contribute only the face that looks inward.
      if (j.d > 0) breaks.push(j.d - off);
      if (j.d < total) breaks.push(j.d + off);
    }

    const sorted = [...new Set(breaks.map(x => Math.round(x)))]
      .filter(x => x >= 0 && x <= Math.round(total))
      .sort((p, q) => p - q);
    const spans: DimSpan[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const from = sorted[i]!, to = sorted[i + 1]!;
      if (to - from < MIN_SPAN_MM) continue;
      spans.push({ from, to, mm: to - from });
    }
    if (spans.length === 0) continue;

    // A chain belongs on a facade. An interior wall has rooms on both sides,
    // and dimensioning it here would run the chain straight across the floor
    // it is measuring — so those are left to the selected wall's own dimension.
    const n = perp(dir);
    const mid = add(origin, scale(dir, total / 2));
    const probe = half + 120;
    const posSide = insideAnyRoom(add(mid, scale(n, probe)));
    const negSide = insideAnyRoom(add(mid, scale(n, -probe)));
    let out: Vec;
    if (rooms.length === 0) {
      // Nothing enclosed yet: fall back to pointing away from the plan's centre.
      out = dot(sub(centre, mid), n) > 0 ? scale(n, -1) : n;
    } else if (posSide && negSide) {
      continue;                                   // interior wall
    } else if (posSide) {
      out = scale(n, -1);
    } else if (negSide) {
      out = n;
    } else {
      continue;                                   // encloses nothing; not a facade
    }

    chains.push({ origin, dir, out, half, total, spans, mode, wallIds: run.map(s => s.wall.id) });
  }
  return chains;
}
