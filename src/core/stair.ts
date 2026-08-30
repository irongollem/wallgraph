// Derived stair geometry: the numbers every stair drawing, hit-test and export
// works out from the four stored parameters.
//
// Nothing here is stored. A stair's footprint, the split of its treads between
// flights, and the radii of a spiral all follow from (width, going, treads,
// well) and the kind, so they are computed where they are needed rather than
// written into the document — the same rule wall faces and room polygons follow.
import { Floor, floorHeight } from "../model/doc";
import {
  Stair, ResolvedStair, StairKind, stairParams, stairDefaults, inheritsRise,
} from "../model/stair";
import { Vec, v } from "../geometry/vec";
import { boxCorners, boxHit, worldPoint, type LocalBox } from "./placed";

/**
 * Treads in one quarter turn. Three is the ordinary Dutch winder set: it turns
 * 90 degrees in 30-degree steps, which keeps a usable tread at the walking line.
 */
export const WINDERS_PER_QUARTER = 3;

/** How many quarters a kind turns through, and where they sit along the flight. */
export function quarters(kind: StairKind): { bottom: boolean; top: boolean } {
  return {
    bottom: kind === "onderkwart" || kind === "onder-bovenkwart",
    top: kind === "bovenkwart" || kind === "onder-bovenkwart",
  };
}

/**
 * Settle a stair's rise against the storey it stands on. Everything that draws,
 * measures or checks a stair goes through here first, so the question is
 * answered once at the boundary instead of at every call site.
 */
export function resolveStair(f: Floor, s: Stair): ResolvedStair {
  if (s.rise !== undefined) return s as ResolvedStair;
  return { ...s, rise: inheritsRise(s.kind) ? floorHeight(f) : stairDefaults(s.kind).rise };
}

/** Treads left over for the straight part, after the winders take theirs. */
export function straightTreads(s: ResolvedStair): number {
  const q = quarters(s.kind);
  const turned = (q.bottom ? WINDERS_PER_QUARTER : 0) + (q.top ? WINDERS_PER_QUARTER : 0);
  return Math.max(1, s.treads - turned);
}

/** Length of the straight run, mm. */
export function stairRun(s: ResolvedStair): number {
  return straightTreads(s) * stairParams(s).going;
}

/** How a bordestrap's treads divide over its two flights, lower flight first. */
export function landingSplit(s: ResolvedStair): { lower: number; upper: number } {
  const lower = Math.max(1, Math.ceil(s.treads / 2));
  return { lower, upper: Math.max(1, s.treads - lower) };
}

/**
 * A spiral's geometry in local space. The steps fan from a centre on the
 * footprint's axis, and the angle each one takes is what the going asks for at
 * the walking line — the line two thirds out, where a winding stair is
 * measured. A deeper tread therefore takes a wider bite of the circle, and the
 * same number of them comes round further.
 */
export interface SpiralGeom {
  /** Centre of the fan, local mm. */
  c: Vec;
  inner: number;
  outer: number;
  /** Radius the going is measured at. */
  walk: number;
  /** Radians per tread, always positive; `mirrored` reverses the whole drawing. */
  step: number;
  /** First tread's angle. The entry faces the anchor, so the flight starts there. */
  start: number;
  sweep: number;
}

export function spiralOf(s: ResolvedStair): SpiralGeom {
  const p = stairParams(s);
  const inner = p.well;
  const outer = inner + p.width;
  const walk = inner + p.width * 0.6;
  const step = p.going / Math.max(1, walk);
  // Angles are in the document's y-down space, so -90 degrees points from the
  // centre toward the anchor: the entry tread is the one nearest the person
  // walking in, and the flight winds away from it.
  return { c: v(0, outer), inner, outer, walk, step, start: -Math.PI / 2, sweep: step * s.treads };
}

/** Local-space bounds. x is symmetric about the anchor for every kind. */
export type StairBox = LocalBox;

export function stairBox(s: ResolvedStair): StairBox {
  const p = stairParams(s);
  const box = (w: number, d: number): StairBox => ({ x0: -w / 2, y0: 0, x1: w / 2, y1: d });
  const run = stairRun(s);

  switch (s.kind) {
    case "bordestrap": {
      const split = landingSplit(s);
      // Two flights side by side with the well between them, and a landing
      // across the head of both. The landing is as deep as a flight is wide,
      // which is the shallowest one a half turn can be made on.
      return box(2 * p.width + p.well, split.lower * p.going + p.width);
    }
    case "bovenkwart":
    case "onderkwart":
      // A quarter turns inside a square the width of the flight, so the
      // footprint stays a rectangle and only gets longer.
      return box(p.width, run + p.width);
    case "onder-bovenkwart":
      return box(p.width, run + 2 * p.width);
    case "spiltrap-recht":
    case "spiltrap-rond":
    case "wenteltrap": {
      const r = spiralOf(s).outer;
      return box(2 * r, 2 * r);
    }
    case "klimijzers":
      // Irons in a wall are seen end-on: a mark, not a footprint.
      return box(p.width, KLIMIJZER_DEPTH);
    default:
      return box(p.width, s.treads * p.going);
  }
}

/** Depth of the klimijzer mark, mm — what the irons project from the wall. */
export const KLIMIJZER_DEPTH = 250;

/**
 * Height of the section plane above the floor, mm. A plan is a horizontal cut
 * through the storey at about a metre, which is where two flights over each
 * other are broken: below it the lower flight is drawn, above it the upper one.
 */
export const CUT_HEIGHT = 1000;

/**
 * What the rise makes calculable. Null where a kind has no such number — a ramp
 * has no riser, a set of climbing irons has neither riser nor slope worth
 * stating in plan.
 *
 * These are reported, not enforced. Wallgraph draws what it is given and does
 * not check regulations; the loopvergelijking is stated so the number is in
 * front of whoever is drawing, not as a verdict on the stair.
 */
export interface StairMetrics {
  /** A flight of n treads has n+1 risers: the last one lands on the floor above. */
  risers: number | null;
  /** mm per riser (optrede). */
  riser: number | null;
  /** The loopvergelijking, 2 x optrede + aantrede, mm. */
  walkRule: number | null;
  /** Run over rise for a ramp, as the N of 1:N. */
  slope: number | null;
  /** Length of the walking line, mm. */
  run: number;
}

export function stairMetrics(s: ResolvedStair): StairMetrics {
  const p = stairParams(s);
  const run = p.treads * p.going;
  if (s.kind === "hellingbaan") {
    return { risers: null, riser: null, walkRule: null, slope: p.rise > 0 ? run / p.rise : null, run };
  }
  if (s.kind === "klimijzers") {
    return { risers: null, riser: null, walkRule: null, slope: null, run: 0 };
  }
  const risers = p.treads + 1;
  const riser = p.rise / risers;
  return { risers, riser, walkRule: 2 * riser + p.going, slope: null, run };
}

/**
 * Which tread the section plane cuts. Derived from the riser rather than taken
 * as the middle of the flight: where the break falls is a fact about the stair's
 * height, and on a shallow flight it is nowhere near halfway.
 */
export function cutTread(s: ResolvedStair): number {
  const { riser } = stairMetrics(s);
  if (!riser || !(riser > 0)) return Math.max(1, Math.round(s.treads / 2));
  return Math.max(1, Math.min(s.treads - 1, Math.round(CUT_HEIGHT / riser)));
}

/**
 * Where the annotation goes: just off the foot of the flight, clear of the
 * treads and of the arrow, and inside the margin every export already leaves
 * around the plan. Text itself is drawn upright in world space by the caller,
 * as the opening annotations are — a rotated stair must not carry rotated text.
 */
export function stairNoteAt(s: ResolvedStair): Vec {
  return worldPoint({ ...s, mirrored: false }, v(0, -NOTE_OFFSET));
}

/** How far off the foot of the flight the annotation sits, mm. */
export const NOTE_OFFSET = 260;

/** Height of the annotation, mm — the opening annotations' size, a size up. */
export const NOTE_SIZE = 160;

/**
 * The stair's own annotation: how a flight is dimensioned on a Dutch drawing —
 * the number of risers and the optrede, or a ramp's gradient. One function, so
 * the canvas and the exports state the same thing.
 */
export function stairNote(s: ResolvedStair): string | null {
  const m = stairMetrics(s);
  const base = m.slope !== null ? `1:${gradient(m.slope)}`
    : m.risers === null || m.riser === null ? null
    : `${m.risers} \u00d7 ${Math.round(m.riser)}`;
  if (base === null) return null;
  // The flag is in the text, not only in the colour: an export can lose the
  // colour, and a stair already drawn in the new-work red would swallow it.
  return stairIssues(s).length > 0 ? `${base} !` : base;
}

/**
 * The N of a 1:N gradient. Ramps are specified as whole ratios, so a computed
 * one keeps a decimal only when it is not one.
 */
export function gradient(slope: number): string {
  return String(Math.round(slope * 10) / 10);
}

/** The footprint's four corners in world mm, for framing and cropping. */
export function stairCorners(s: ResolvedStair): Vec[] {
  return boxCorners(s, stairBox(s));
}

/** True when `p` (world mm) is inside the footprint, grown by `margin` mm. */
export function stairHit(s: ResolvedStair, p: Vec, margin = 0): boolean {
  return boxHit(s, stairBox(s), p, margin);
}

/**
 * What a stair is ordinarily built to in the Netherlands. These are stated so
 * the figures are in front of whoever is drawing, and reported against — they
 * are not enforced and are not a compliance check. Wallgraph draws what it is
 * given; verification of a drawing remains the user's (see the disclaimer).
 *
 * The woningtrap figures are the familiar ones: an optrede of at most 188, an
 * aantrede of at least 220, a free width of at least 800. The `any` pair is a
 * far looser sanity bound that holds for every kind — a 4-tread flight climbing
 * 4 m gives an 800 mm optrede, which is not a stair whatever it is called.
 */
export const STAIR_LIMITS = {
  riserMax: 188,
  goingMin: 220,
  widthMin: 800,
  walkRuleMin: 570,
  walkRuleMax: 630,
  riserMaxAny: 300,
  riserMinAny: 80,
  /** Ramps: 1:12 is the steepest ordinarily built. */
  slopeMin: 12,
} as const;

export type StairIssueCode =
  | "riserHigh" | "riserLow" | "goingShort" | "widthNarrow" | "slopeSteep";

export interface StairIssue {
  code: StairIssueCode;
  /** The figure as drawn, mm (or the N of a 1:N gradient). */
  value: number;
  /** What it is being read against. */
  limit: number;
}

/**
 * Kinds the woningtrap figures are the yardstick for. The rest are left to the
 * loose bound: a vlizotrap is steep by definition, a spiltrap turns tighter than
 * a straight flight is allowed to, and an escalator is machinery with a fixed
 * geometry of its own.
 */
function isWalkingStair(kind: StairKind): boolean {
  return kind === "steektrap" || kind === "steektrap-boven-elkaar"
    || kind === "steektrap-scheluw" || kind === "bordestrap" || kind === "bovenkwart"
    || kind === "onderkwart" || kind === "onder-bovenkwart" || kind === "rijstroken";
}

/** Where the stair as drawn falls outside the figures above. Empty is ordinary. */
export function stairIssues(s: ResolvedStair): StairIssue[] {
  const out: StairIssue[] = [];
  const p = stairParams(s);
  const m = stairMetrics(s);
  const L = STAIR_LIMITS;

  if (m.slope !== null) {
    if (m.slope < L.slopeMin) out.push({ code: "slopeSteep", value: m.slope, limit: L.slopeMin });
    return out;
  }
  if (m.riser === null) return out;   // klimijzers: nothing in plan to read

  const strict = isWalkingStair(s.kind);
  const riserMax = strict ? L.riserMax : L.riserMaxAny;
  if (m.riser > riserMax) out.push({ code: "riserHigh", value: m.riser, limit: riserMax });
  if (m.riser < L.riserMinAny) out.push({ code: "riserLow", value: m.riser, limit: L.riserMinAny });
  if (strict) {
    if (p.going < L.goingMin) out.push({ code: "goingShort", value: p.going, limit: L.goingMin });
    if (p.width < L.widthMin) out.push({ code: "widthNarrow", value: p.width, limit: L.widthMin });
  }
  return out;
}
