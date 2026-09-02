// Derived stepped stair geometry for the 3D view: one vertical prism per
// tread, landing, ramp slice or climbing iron, laid out to match the plan
// drawing of each kind (src/render/stairs/) so the 3D body and the 2D mark
// cannot disagree about which way a flight runs or where its winders fan.
//
// Footprints are built in the stair's local frame — x symmetric about the
// anchor, y from 0 at the anchor increasing in the direction of ascent, the
// frame stairBox() uses — and mapped through worldPoint(), so rotation and
// mirroring follow the placed object exactly as the 2D drawing does.
//
// z is mm above the stair's own storey floor. The arrival floor is the final
// riser, so the top tread's top is `treads * riser` (= rise - riser), never
// `rise`. The mesh builder normalizes winding; polygon orientation is not
// significant here.
import { Floor } from "../model/doc";
import { Stair, ResolvedStair, stairParams } from "../model/stair";
import { Vec, v, dist, fromAngle, polygonArea } from "../geometry/vec";
import {
  resolveStair, stairMetrics, stairRun, straightTreads, landingSplit, quarters,
  WINDERS_PER_QUARTER, spiralOf,
} from "./stair";
import { worldPoint } from "./placed";
import { rayExit } from "../render/stairs/defs";

/** One vertical prism of a stair: a world-space footprint over a z-band,
 *  z in mm above the stair's own storey floor. */
export interface StairStep { poly: Vec[]; z0: number; z1: number }

/** Ramp plate thickness, mm: the slab each hellingbaan slice is cut from. */
export const RAMP_PLATE = 100;
/** Klimijzer bar: projection from the wall and bar height, mm. */
export const RUNG_DEPTH = 40;
export const RUNG_HEIGHT = 30;
/** Vertical pitch klimijzers aim for, mm; the exact pitch divides the rise. */
export const RUNG_SPACING = 290;

/** Free height ordinarily kept above a flight, mm. A step closer than this to
 *  the slab's underside cannot have floor over it, which is what sizes the
 *  stairwell; reported geometry, not a compliance check. */
export const STAIR_HEADROOM_MM = 2300;

/** Footprints under this area (mm²) are dropped rather than emitted. */
const AREA_EPS = 1;
const EPS = 1e-6;
/** Chord step for flattening a spiral tread's arcs, radians. */
const ARC_CHORD = Math.PI / 24;
const DEG = Math.PI / 180;

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * The prisms one stair contributes to the scene mesh, in walking order: the
 * entry step first, climbing one riser per step. Degenerate footprints and
 * empty z-bands are skipped rather than emitted.
 */
export function stairSteps(f: Floor, s: Stair): StairStep[] {
  const r = resolveStair(f, s);
  const out: StairStep[] = [];
  for (const st of localSteps(r)) {
    if (!(st.z1 - st.z0 > 0)) continue;
    if (st.poly.length < 3 || Math.abs(polygonArea(st.poly)) <= AREA_EPS) continue;
    out.push({ poly: st.poly.map(q => worldPoint(r, q)), z0: st.z0, z1: st.z1 });
  }
  return out;
}

/**
 * The opening a stair asks of the slab it climbs through: the bounding box,
 * in the stair's own frame, of every step within STAIR_HEADROOM_MM of the
 * soffit, as a world-space quad. Null when the rise stays at or under the
 * soffit — a flight to a mezzanine cuts nothing. `soffit` is the slab
 * underside's height above this stair's own storey floor, mm.
 */
export function stairwellHole(f: Floor, s: Stair, soffit: number): Vec[] | null {
  const r = resolveStair(f, s);
  if (r.rise <= soffit) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of localSteps(r)) {
    if (st.z1 <= soffit - STAIR_HEADROOM_MM) continue;
    for (const p of st.poly) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  return [
    worldPoint(r, v(x0, y0)), worldPoint(r, v(x1, y0)),
    worldPoint(r, v(x1, y1)), worldPoint(r, v(x0, y1)),
  ];
}

function localSteps(s: ResolvedStair): StairStep[] {
  switch (s.kind) {
    case "bordestrap": return bordesSteps(s);
    case "onderkwart":
    case "bovenkwart":
    case "onder-bovenkwart": return quarterSteps(s);
    case "spiltrap-recht":
    case "spiltrap-rond":
    case "wenteltrap": return spiralSteps(s);
    case "hellingbaan": return rampSlices(s);
    case "klimijzers": return rungSteps(s);
    default: return straightSteps(s);
  }
}

/** Riser height, mm — stairMetrics' optrede. Every kind routed here has one. */
function riserOf(s: ResolvedStair): number {
  return stairMetrics(s).riser ?? s.rise / (s.treads + 1);
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] =>
  [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];

/** Equal rectangular treads marching up local +y: every straight kind. */
function straightSteps(s: ResolvedStair): StairStep[] {
  const p = stairParams(s);
  const r = riserOf(s);
  const half = p.width / 2;
  const out: StairStep[] = [];
  for (let k = 0; k < s.treads; k++) {
    out.push({
      poly: rect(-half, k * p.going, half, (k + 1) * p.going),
      z0: k * r, z1: (k + 1) * r,
    });
  }
  return out;
}

/**
 * Bordestrap: the lower flight left of the well, the landing across the head
 * of both flights, the upper flight right of the well walking back toward
 * y = 0 with its treads measured from the landing — the layout the 2D drawing
 * uses (render/stairs/turned.ts).
 *
 * The landing takes the riser above the lower flight and shares its level
 * with the first upper tread: stairMetrics() counts treads + 1 risers for
 * every kind, so a landing climbing a riser of its own would top the flight
 * out at `rise` instead of `treads * riser`.
 */
function bordesSteps(s: ResolvedStair): StairStep[] {
  const p = stairParams(s);
  const r = riserOf(s);
  const split = landingSplit(s);
  const half = p.width + p.well / 2;
  const headY = split.lower * p.going;
  const out: StairStep[] = [];
  for (let k = 0; k < split.lower; k++) {
    out.push({
      poly: rect(-half, k * p.going, -p.well / 2, (k + 1) * p.going),
      z0: k * r, z1: (k + 1) * r,
    });
  }
  out.push({
    poly: rect(-half, headY, half, headY + p.width),
    z0: split.lower * r, z1: (split.lower + 1) * r,
  });
  for (let j = 0; j < split.upper; j++) {
    out.push({
      poly: rect(p.well / 2, headY - (j + 1) * p.going, half, headY - j * p.going),
      z0: (split.lower + j) * r, z1: (split.lower + 1 + j) * r,
    });
  }
  return out;
}

/**
 * Quarter kinds: a straight flight with WINDERS_PER_QUARTER winders fanning
 * through a square the width of the flight at one or both ends. Pivots,
 * angles and the counter-turned exit side are the 2D fans' exactly
 * (render/stairs/turned.ts): the bottom quarter fans from (half, w) between
 * -90° and -180°, the top from (exit·half, top) between (90 + exit·90)° and
 * 90°.
 */
function quarterSteps(s: ResolvedStair): StairStep[] {
  const p = stairParams(s);
  const r = riserOf(s);
  const w = p.width, half = w / 2;
  const q = quarters(s.kind);
  const run = stairRun(s);
  const y0 = q.bottom ? w : 0;
  const out: StairStep[] = [];
  let k = 0;
  if (q.bottom) {
    k = fan(out, v(half, w), -90 * DEG, -180 * DEG,
      { x0: -half, y0: 0, x1: half, y1: w }, k, r);
  }
  for (let i = 0; i < straightTreads(s); i++, k++) {
    out.push({
      poly: rect(-half, y0 + i * p.going, half, y0 + (i + 1) * p.going),
      z0: k * r, z1: (k + 1) * r,
    });
  }
  if (q.top) {
    const top = y0 + run;
    const exit = s.kind === "onder-bovenkwart" && s.counterTurn ? -1 : 1;
    fan(out, v(exit * half, top), (90 + exit * 90) * DEG, 90 * DEG,
      { x0: -half, y0: top, x1: half, y1: top + w }, k, r);
  }
  return out;
}

/** One quarter of winders in walking order: the entry slice is on the
 *  `from` side, matching winderFan()'s sweep. */
function fan(
  out: StairStep[], pivot: Vec, from: number, to: number, b: Box, k: number, r: number,
): number {
  for (let i = 0; i < WINDERS_PER_QUARTER; i++) {
    const a0 = from + ((to - from) * i) / WINDERS_PER_QUARTER;
    const a1 = from + ((to - from) * (i + 1)) / WINDERS_PER_QUARTER;
    out.push({ poly: pieSlice(pivot, a0, a1, b), z0: k * r, z1: (k + 1) * r });
    k++;
  }
  return k;
}

/**
 * The footprint one winder occupies: the region between two rays from the
 * pivot, clipped to the quarter's square. Box corners the sweep passes stay
 * vertices, so the fan tiles the square exactly.
 */
function pieSlice(pivot: Vec, a0: number, a1: number, b: Box): Vec[] {
  const e0 = rayExit(pivot, fromAngle(a0), b);
  const e1 = rayExit(pivot, fromAngle(a1), b);
  if (!e0 || !e1) return [];
  const sweep = wrapPi(a1 - a0);
  const corners = [v(b.x0, b.y0), v(b.x1, b.y0), v(b.x1, b.y1), v(b.x0, b.y1)]
    .map(c => ({ c, d: wrapPi(Math.atan2(c.y - pivot.y, c.x - pivot.x) - a0) }))
    .filter(({ c, d }) => dist(c, pivot) > EPS
      && (sweep > 0 ? d > EPS && d < sweep - EPS : d < -EPS && d > sweep + EPS))
    .sort((m, n) => (sweep > 0 ? m.d - n.d : n.d - m.d))
    .map(({ c }) => c);
  return [pivot, e0, ...corners, e1];
}

/** An angle wrapped into (-π, π]. */
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Spiral kinds: tread k is the annular sector spiralOf() states, between the
 * inner and outer radii from start + k·step to start + (k+1)·step, flattened
 * to chords. Positive step winds the canonical (clockwise) way; `mirrored`
 * reverses the whole flight through worldPoint(), as the 2D drawing does.
 */
function spiralSteps(s: ResolvedStair): StairStep[] {
  const g = spiralOf(s);
  const r = riserOf(s);
  const segs = Math.max(2, Math.ceil(g.step / ARC_CHORD));
  const out: StairStep[] = [];
  for (let k = 0; k < s.treads; k++) {
    const a0 = g.start + k * g.step;
    const poly: Vec[] = [];
    for (let i = 0; i <= segs; i++) poly.push(arcPt(g.c, g.outer, a0 + (g.step * i) / segs));
    if (g.inner > EPS) {
      for (let i = segs; i >= 0; i--) poly.push(arcPt(g.c, g.inner, a0 + (g.step * i) / segs));
    } else {
      poly.push(g.c);
    }
    out.push({ poly, z0: k * r, z1: (k + 1) * r });
  }
  return out;
}

const arcPt = (c: Vec, radius: number, a: number): Vec =>
  v(c.x + Math.cos(a) * radius, c.y + Math.sin(a) * radius);

/**
 * Hellingbaan: no risers. The sloping plate is approximated as one thin slice
 * per going of run, each reaching the ramp's height at its far edge; the last
 * slice tops out at `rise` because a ramp arrives at the floor rather than
 * one riser below it.
 */
function rampSlices(s: ResolvedStair): StairStep[] {
  const p = stairParams(s);
  const half = p.width / 2;
  const out: StairStep[] = [];
  for (let i = 0; i < s.treads; i++) {
    const h = (s.rise * (i + 1)) / s.treads;
    out.push({
      poly: rect(-half, i * p.going, half, (i + 1) * p.going),
      z0: Math.max(0, h - RAMP_PLATE), z1: h,
    });
  }
  return out;
}

/**
 * Klimijzers: rungs, not treads — thin bars against the anchor line at the
 * even pitch nearest RUNG_SPACING that divides the rise, the top rung one
 * pitch below the arrival floor. The stored tread count is not read, matching
 * stairFields().
 */
function rungSteps(s: ResolvedStair): StairStep[] {
  const p = stairParams(s);
  const half = p.width / 2;
  const n = Math.max(1, Math.round(s.rise / RUNG_SPACING) - 1);
  const pitch = s.rise / (n + 1);
  const out: StairStep[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      poly: rect(-half, 0, half, RUNG_DEPTH),
      z0: Math.max(0, i * pitch - RUNG_HEIGHT), z1: i * pitch,
    });
  }
  return out;
}
