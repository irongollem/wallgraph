// A timber floor as the document stores it: a balklaag between its supports,
// or a loft (vliering, entresol) at a height inside a storey.
//
// The counterpart of a vide: a vide takes floor out of the slab, a deck puts
// a floor where the storey has none. Rectangular and placed at its centre for
// the reason a vide is. The box is the clear span between the supports; each
// joist bears `bearingMm` beyond it at both ends.
import type { Id } from "./doc";

export interface Deck {
  id: Id;
  /** Anchor in world mm: the centre of the platform. Integer. */
  x: number;
  y: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  width: number;
  depth: number;
  /** Joists run along local x (span = width) or local y (span = depth). */
  joistAxis: "x" | "y";
  /** Joist centres, mm. */
  joistMm: number;
  /** Joist section, mm. Absent means not stated: the check proposes one. */
  joist?: { w: number; d: number };
  /** Bearing at each joist end, mm. Absent means BEARING_DEFAULT_MM. */
  bearingMm?: number;
  /** Decking sheet thickness, mm. Absent means no decking counted. */
  deckingMm?: number;
  /** Top of the deck above this storey's floor, mm. Absent means the storey's own
   *  floor: an ordinary balklaag. A vliering states one. */
  topMm?: number;
  /** Permanent and variable load, N/m² as integers (1750 = 1.75 kN/m²). Absent means
   *  not stated; the checks report incomplete. A use preset fills both. */
  loadG?: number;
  loadQ?: number;
  /** What the deck is called on the drawing. Absent means the plain word. */
  label?: string;
  /** Pen colour "#rrggbb"; absent means the plan's default ink. */
  color?: string;
}

/** The figures the next deck is placed with. */
export interface DeckSize { width: number; depth: number; joistAxis: "x" | "y"; joistMm: number }

/** A small balklaag: joists spanning the 3600 depth at ordinary 600 centres. */
export const DECK_DEFAULT: DeckSize = { width: 2400, depth: 3600, joistAxis: "y", joistMm: 600 };

/** Bearing at each joist end when the deck states none, mm. */
export const BEARING_DEFAULT_MM = 100;

export const DECK_LIMITS = {
  size: { min: 300, max: 20000 },
  joistMm: { min: 200, max: 1200 },
  section: { min: 30, max: 400 },
  bearing: { min: 50, max: 300 },
  decking: { min: 0, max: 50 },
} as const;

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(isFinite(n) ? n : min)));
}

export function clampDeckSize(s: DeckSize): DeckSize {
  const L = DECK_LIMITS;
  return {
    width: clampInt(s.width, L.size.min, L.size.max),
    depth: clampInt(s.depth, L.size.min, L.size.max),
    joistAxis: s.joistAxis === "x" ? "x" : "y",
    joistMm: clampInt(s.joistMm, L.joistMm.min, L.joistMm.max),
  };
}

export const clampSection = (n: number): number =>
  clampInt(n, DECK_LIMITS.section.min, DECK_LIMITS.section.max);
export const clampBearing = (n: number): number =>
  clampInt(n, DECK_LIMITS.bearing.min, DECK_LIMITS.bearing.max);
export const clampDecking = (n: number): number =>
  clampInt(n, DECK_LIMITS.decking.min, DECK_LIMITS.decking.max);
/** A deck's top stays inside its storey. */
export const clampDeckTop = (n: number, storeyMm: number): number =>
  clampInt(n, 0, Math.max(0, storeyMm));

/**
 * Every stated figure brought into range, whole millimetres. A decking of 0
 * states nothing and is dropped, so absent stays the one way of saying "no
 * decking counted".
 */
export function clampDeck(d: Deck, storeyMm: number): Deck {
  const out: Deck = { ...d, ...clampDeckSize(d) };
  if (d.joist) out.joist = { w: clampSection(d.joist.w), d: clampSection(d.joist.d) };
  if (d.bearingMm !== undefined) out.bearingMm = clampBearing(d.bearingMm);
  if (d.deckingMm !== undefined) {
    const k = clampDecking(d.deckingMm);
    if (k > 0) out.deckingMm = k; else delete out.deckingMm;
  }
  if (d.topMm !== undefined) out.topMm = clampDeckTop(d.topMm, storeyMm);
  if (d.loadG !== undefined) out.loadG = Math.max(0, Math.round(isFinite(d.loadG) ? d.loadG : 0));
  if (d.loadQ !== undefined) out.loadQ = Math.max(0, Math.round(isFinite(d.loadQ) ? d.loadQ : 0));
  return out;
}

export const bearingOf = (d: Deck): number => d.bearingMm ?? BEARING_DEFAULT_MM;

export type DeckUseId = "wonen" | "berging" | "balkon";

/**
 * Indicative use presets, N/m². A preset only fills `loadG` and `loadQ`; it
 * stores nothing of itself, and the select reads back whichever preset the
 * figures happen to match.
 */
export const DECK_USES: readonly { id: DeckUseId; loadG: number; loadQ: number }[] = [
  { id: "wonen", loadG: 500, loadQ: 1750 },
  { id: "berging", loadG: 500, loadQ: 2000 },
  { id: "balkon", loadG: 500, loadQ: 2500 },
];

/** The preset the deck's loads match, "custom" when they match none, "" when unstated. */
export function deckUseOf(d: Pick<Deck, "loadG" | "loadQ">): DeckUseId | "custom" | "" {
  if (d.loadG === undefined && d.loadQ === undefined) return "";
  return DECK_USES.find(u => u.loadG === d.loadG && u.loadQ === d.loadQ)?.id ?? "custom";
}
