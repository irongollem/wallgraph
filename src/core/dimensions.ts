// Dimension chains: the runs of dimensions a plan is actually read from.
//
// A single wall's length is what the editor needs to let you type a number. A
// drawing needs something else — one line along a facade with every opening and
// pier dimensioned in sequence, and an overall beneath it. That is what a
// builder sets out from, and it is why the two are separate here rather than
// one being a special case of the other.
//
// A chain is a run of straight, collinear walls. Curved walls are excluded: a
// chain measures along a line, and a bowed wall has no single line to measure
// along. Its length still shows on the wall itself.
import { Floor, Wall, Id } from "../model/doc";
import { Vec, v, add, sub, scale, norm, dist, dot, cross, perp, pointInPolygon } from "../geometry/vec";
import { detectRooms } from "./rooms";

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
  total: number;
  /** Openings and junctions, in order. Always includes 0 and `total`. */
  spans: DimSpan[];
  wallIds: Id[];
}

/** Directions count as collinear within about a fifth of a degree. */
const PARALLEL_TOL = 0.003;
/** Ignore spans below this; they are miter slivers, not dimensions. */
const MIN_SPAN_MM = 20;

interface Straight { wall: Wall; a: Vec; b: Vec; dir: Vec; len: number }

/**
 * Every chain on a floor: one per run of collinear straight walls.
 *
 * Two walls continue the same run when they share a node and point the same
 * way. A T-junction does not break a run — the wall running through is still
 * one facade — which is why runs are grown from direction rather than from
 * node degree.
 */
export function dimensionChains(floor: Floor): DimChain[] {
  const pos = new Map<Id, Vec>(floor.nodes.map(n => [n.id, v(n.x, n.y)] as const));
  const straights: Straight[] = [];
  for (const w of floor.walls) {
    if (w.bulge !== 0) continue;
    const a = pos.get(w.a), b = pos.get(w.b);
    if (!a || !b) continue;
    const len = dist(a, b);
    if (len < 1) continue;
    straights.push({ wall: w, a, b, dir: norm(sub(b, a)), len });
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
        // Orient it to run the same way as the chain.
        const oriented: Straight = dist(next.a, tip) < 1
          ? next
          : { ...next, a: next.b, b: next.a, dir: scale(next.dir, -1) };
        if (dot(oriented.dir, end.dir) < 0) break;   // doubles back; not a run
        used.add(next.wall.id);
        if (forward) run.push(oriented);
        else run.unshift({ ...oriented, a: oriented.b, b: oriented.a, dir: oriented.dir });
      }
    }

    // The first wall may itself need flipping so the run reads start to end.
    const origin = run[0]!.a;
    const dir = run[0]!.dir;
    let cursor = 0;
    const breaks: number[] = [0];
    let half = 0;
    for (const s of run) {
      half = Math.max(half, s.wall.thickness / 2);
      // Openings: a jamb on each side of the centre, in run distance.
      const flipped = dot(s.dir, dir) < 0;
      for (const o of s.wall.openings) {
        const t = flipped ? s.len - o.t : o.t;
        breaks.push(cursor + t - o.width / 2, cursor + t + o.width / 2);
      }
      cursor += s.len;
      breaks.push(cursor);                    // the junction with the next wall
    }
    const total = cursor;

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

    chains.push({ origin, dir, out, half, total, spans, wallIds: run.map(s => s.wall.id) });
  }
  return chains;
}
