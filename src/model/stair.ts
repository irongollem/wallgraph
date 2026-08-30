// A stair as the document stores it.
//
// A stair is not a symbol. A socket is one fixed picture wherever it is placed,
// but the same steektrap is 900 mm wide in a house and 1200 in a bedrijfsunit,
// and its tread count follows the storey height. So a stair is a document
// object carrying parameters, and everything drawn from it — treads, the
// walking line, the arrow, the break line, the winder fan — is derived at
// render time, like every other visible thing here.
//
// The kinds are the NEN plan-symbol sheet for stairs. Every one of them reads
// the same four numbers, which is what keeps one property pane and one document
// shape working for a straight flight and a wenteltrap alike:
//
//   width   mm across the flight (for spiral kinds: the tread run, newel to rim)
//   going   mm per tread along the walking line (aantrede)
//   treads  how many treads are drawn
//   rise    mm of height the flight climbs, floor to floor
//   well    the gap the kind opens up: between the flights of a bordestrap,
//           around the newel of a spiltrap. 0 where the kind has none.
//
// The rise is what makes the rest of the numbers mean something. A flight of 15
// treads has 16 risers, so a 2800 mm rise puts the optrede at 175 and the
// loopvergelijking (2 x optrede + aantrede) at 570. It also decides where the
// break line falls on two flights over each other: at the tread the flight
// passes the section plane, not at the middle of the run. See core/stair.ts.
//
// The arrow always runs from the bottom of the flight to the top, as the sheet
// states ("de pijl geeft de richting aan van beneden naar boven"). A stair that
// descends from this storey is the same object turned around, so there is no
// direction flag to disagree with the geometry.
import type { Id } from "./doc";

/**
 * Anchor convention, shared with the symbol library so one hit-test and one
 * placement gesture serve both: (0,0) is the middle of the footprint's bottom
 * edge and +y runs into the room — which for a stair is the direction of
 * ascent. Local x therefore spans [-boxWidth/2, boxWidth/2] and y [0, boxDepth].
 */
export type StairKind =
  /** Straight flight. The plain one; everything else is a variation on it. */
  | "steektrap"
  /** Two flights over each other, separated by the break line at the cut. */
  | "steektrap-boven-elkaar"
  /** Raking treads (scheluw): the treads are not square to the stringers. */
  | "steektrap-scheluw"
  /** Two flights and a landing between them — a U with a half turn. */
  | "bordestrap"
  /** Straight flight, then a quarter of winders at the top. */
  | "bovenkwart"
  /** A quarter of winders at the bottom, then a straight flight. */
  | "onderkwart"
  /** A quarter at each end. */
  | "onder-bovenkwart"
  /** Flight with a wheeling gutter down each side (fietsenkelder). */
  | "rijstroken"
  /** Escalator: a flight between two balustrades. */
  | "roltrap"
  /** Loft ladder that slides out of its hatch (vlizotrap met luik). */
  | "vlizotrap"
  /** Spiral around a newel, inside a square well. */
  | "spiltrap-recht"
  /** Spiral around a newel, inside a round well. */
  | "spiltrap-rond"
  /** Helical stair around an open well — a wenteltrap has no newel to speak of. */
  | "wenteltrap"
  /** Climbing irons set into a wall (klimbeugels). */
  | "klimijzers"
  /** Ramp. No treads; the slope is the whole point. */
  | "hellingbaan";

/** Every kind, in the order the sheet lists them and the palette shows them. */
export const STAIR_KINDS: readonly StairKind[] = [
  "steektrap", "steektrap-boven-elkaar", "steektrap-scheluw", "bordestrap",
  "bovenkwart", "onderkwart", "onder-bovenkwart", "rijstroken", "roltrap",
  "vlizotrap", "spiltrap-recht", "spiltrap-rond", "wenteltrap", "klimijzers",
  "hellingbaan",
];

export interface Stair {
  id: Id;
  kind: StairKind;
  /** Anchor in world mm: middle of the footprint's bottom edge. Integer. */
  x: number;
  y: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  /** Handedness: which way a quarter or a spiral turns. */
  mirrored?: boolean;
  width: number;
  going: number;
  treads: number;
  /**
   * mm climbed. Absent means the storey height of the floor the stair stands on,
   * which is the usual case: a stair connects two floors, so its rise is a
   * property of the storey rather than of the stair. Stating it here overrides
   * that — a flight up to a mezzanine beside a vide climbs less than a storey.
   * A hellingbaan never inherits; see inheritsRise().
   */
  rise?: number;
  /** Absent where the kind opens no well; see the header. */
  well?: number;
  /** Pen colour "#rrggbb"; absent means the plan's default ink. */
  color?: string;
}

/**
 * A stair whose rise has been settled against the storey it stands on. The
 * document type leaves `rise` open; everything that draws, measures or checks a
 * stair takes this instead, so the question "which height is this?" is answered
 * once, at the boundary, by resolveStair().
 */
export type ResolvedStair = Stair & { rise: number };

/**
 * Whether the kind takes the storey height when it states no rise of its own.
 * A ramp does not: it bridges a level change — a threshold, a split level — and
 * a ramp that climbed a whole storey by default would be nonsense.
 */
export function inheritsRise(kind: StairKind): boolean {
  return kind !== "hellingbaan";
}

export interface StairParams {
  width: number;
  going: number;
  treads: number;
  rise: number;
  well: number;
}

/**
 * Where each kind starts. These are ordinary Dutch dimensions rather than
 * minima: a woningtrap is about 900 wide with a 220 aantrede over a 2800 storey,
 * which puts the optrede at 175 and the loopvergelijking at 570. A spiltrap
 * turns tighter and steps deeper, a vlizotrap is steep on purpose, and an
 * escalator climbs 200 per 400.
 */
const DEFAULTS: Record<StairKind, StairParams> = {
  "steektrap":              { width: 900,  going: 220, treads: 15, rise: 2800, well: 0 },
  "steektrap-boven-elkaar": { width: 900,  going: 220, treads: 15, rise: 2800, well: 0 },
  "steektrap-scheluw":      { width: 900,  going: 220, treads: 15, rise: 2800, well: 0 },
  "bordestrap":             { width: 900,  going: 220, treads: 15, rise: 2800, well: 200 },
  "bovenkwart":             { width: 900,  going: 220, treads: 15, rise: 2800, well: 0 },
  "onderkwart":             { width: 900,  going: 220, treads: 15, rise: 2800, well: 0 },
  "onder-bovenkwart":       { width: 900,  going: 220, treads: 15, rise: 2800, well: 0 },
  "rijstroken":             { width: 1400, going: 220, treads: 15, rise: 2800, well: 0 },
  "roltrap":                { width: 1600, going: 400, treads: 20, rise: 4200, well: 0 },
  "vlizotrap":              { width: 700,  going: 200, treads: 12, rise: 2800, well: 0 },
  "spiltrap-recht":         { width: 800,  going: 250, treads: 14, rise: 2800, well: 100 },
  "spiltrap-rond":          { width: 800,  going: 250, treads: 14, rise: 2800, well: 100 },
  "wenteltrap":             { width: 900,  going: 280, treads: 18, rise: 2800, well: 700 },
  "klimijzers":             { width: 400,  going: 300, treads: 7,  rise: 3000, well: 0 },
  "hellingbaan":            { width: 1200, going: 500, treads: 12, rise: 500,  well: 0 },
};

export function stairDefaults(kind: StairKind): StairParams { return { ...DEFAULTS[kind] }; }

/** A stair's numbers, with the kind's default filling in for an absent `well`. */
export function stairParams(s: ResolvedStair): StairParams {
  return {
    width: s.width,
    going: s.going,
    treads: s.treads,
    rise: s.rise,
    well: s.well ?? DEFAULTS[s.kind].well,
  };
}

/**
 * Hold the parameters inside what the geometry can draw, in whole millimetres.
 * The bounds are generous on purpose — this exists so a typed value or a pasted
 * document cannot produce a zero-width flight or a fan of 900 treads, not to
 * enforce the Bouwbesluit, which the editor does not check (see the disclaimer).
 */
export function clampStair(p: StairParams): StairParams {
  return {
    width: clampInt(p.width, 200, 20000),
    going: clampInt(p.going, 50, 5000),
    treads: clampInt(p.treads, 1, 60),
    rise: clampInt(p.rise, 50, 20000),
    well: clampInt(p.well, 0, 20000),
  };
}

/**
 * An angle in [0, 2pi). Both ways of turning a stair — the quarter turns R
 * gives and the rotation field's drag-scrub — go through this, so a few turns
 * of the scrub leave 30 degrees stored rather than 3990.
 */
export function stairAngle(radians: number): number {
  if (!isFinite(radians)) return 0;
  const full = Math.PI * 2;
  return ((radians % full) + full) % full;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(isFinite(n) ? n : lo)));
}

/**
 * Which parameters a kind actually reads. The property pane hides the rest, so
 * no field is offered that changes nothing: a set of klimijzers has no going and
 * no tread count, and only four kinds open a well. Every kind climbs, so every
 * kind has a rise.
 */
export function stairFields(kind: StairKind): Record<keyof StairParams, boolean> {
  const well = kind === "bordestrap" || kind === "spiltrap-recht"
    || kind === "spiltrap-rond" || kind === "wenteltrap";
  const irons = kind === "klimijzers";
  return { width: true, going: !irons, treads: !irons, rise: true, well };
}
