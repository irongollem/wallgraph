// A cabinet as the document stores it.
//
// A cabinet is not a symbol, for the same reason a stair is not: a socket is one
// fixed picture wherever it is placed, but a kastje is 400, 600 or 800 wide
// depending on what fits the run, and the front, the hinge side and the worktop
// follow from the unit rather than from the drawing. So the dimensions are
// stored and the carcass, the front band, the door or drawer mark and the
// worktop overhang are derived at render time.
//
// It is cabinetry rather than kitchen furniture. The same object is an
// onderkast, a badkamermeubel, a garderobekast and a kantoorkast — those differ
// in size, height class and front, all of which are fields here. The Dutch
// names live in CABINET_PRESETS, which write these fields.
import type { Id } from "./doc";

/**
 * Height class. It decides the default depth, the default carcass height and —
 * the part that matters on a plattegrond — how the unit meets the cut plane.
 * A plan is a horizontal section at about 1200 mm:
 *
 *   base  under the plane; seen from above, drawn solid
 *   tall  cut by the plane, drawn solid
 *   wall  entirely above the plane, so drawn dashed like anything overhead
 */
export type CabinetKind = "base" | "wall" | "tall";

export const CABINET_KINDS: readonly CabinetKind[] = ["base", "wall", "tall"];

/** What closes the front. `open` is a set of shelves with no front at all. */
export type CabinetFront = "door" | "double" | "drawers" | "open" | "slide";

export const CABINET_FRONTS: readonly CabinetFront[] = [
  "door", "double", "drawers", "open", "slide",
];

/**
 * Which side the door is hung, as seen by someone in the room facing the unit.
 *
 * That viewer looks along -y in the cabinet's own frame (the anchor's +y runs
 * into the room), so their left hand is at local -x and their right at +x.
 * Storing the side the way it is spoken rather than as a local axis is what
 * keeps it right after a mirror: `localPoint()` negates x for a mirrored
 * object, so the drawn hinge follows the handedness without a second field.
 */
export type CabinetHinge = "left" | "right";

export interface Cabinet {
  id: Id;
  kind: CabinetKind;
  /**
   * Anchor in world mm: the middle of the wall-touching edge, with +y into the
   * room. The symbol library's wall-mounted convention, shared so that one
   * hit-test, one placement gesture and one wall snap serve both.
   */
  x: number;
  y: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  /** Handedness. Flips the hinge side and the diagonal of a corner unit. */
  mirrored?: boolean;
  /** mm along the wall. */
  width: number;
  /** mm into the room. */
  depth: number;
  /**
   * Carcass height in mm, plinth and worktop excluded. Nothing in plan draws
   * it: it is here because a cabinet schedule needs it, and because the wall
   * graph already extrudes. Absent means the height class's usual figure.
   */
  height?: number;
  front: CabinetFront;
  /** Absent means "left". Read through cabinetHinge(). */
  hinge?: CabinetHinge;
  /** How many drawers the front is divided into. Only read when front is "drawers". */
  drawers?: number;
  /**
   * Diagonal-front corner unit. The carcass fills the corner and the front runs
   * across the two open edges, so a corner unit is square in practice — the
   * derived geometry uses the smaller of width and depth for the return.
   */
  corner?: boolean;
  /** Blad over the carcass, drawn as an overhang line along the front. */
  worktop?: boolean;
  /** What the unit is called on the drawing. Absent means no annotation. */
  label?: string;
  /** Pen colour "#rrggbb"; absent means the plan's default ink. */
  color?: string;
}

/** The fields a preset or the tool carries — a cabinet minus its identity. */
export interface CabinetSpec {
  kind: CabinetKind;
  width: number;
  depth: number;
  height: number;
  front: CabinetFront;
  hinge: CabinetHinge;
  drawers: number;
  corner: boolean;
  worktop: boolean;
}

/**
 * Module widths. Cabinetry is ordered in these steps rather than measured, which
 * is the whole point of offering them: a run is assembled from stock widths and
 * a filler, not drawn to whatever the wall happens to be. The list is the
 * ordinary Dutch/European kitchen module ladder, and the small sizes are what a
 * filler or an apothekerskast uses.
 */
export const CABINET_WIDTHS: readonly number[] = [
  150, 200, 300, 400, 450, 500, 600, 800, 900, 1000, 1200,
];

/** Depths that go with each height class. Offered, not enforced. */
export const CABINET_DEPTHS: Record<CabinetKind, readonly number[]> = {
  base: [400, 460, 500, 600, 700],
  wall: [300, 330, 350, 400],
  tall: [400, 500, 600, 700],
};

/**
 * Where each height class starts. A base unit is the 720 carcass that stands on
 * a 150 plinth and carries a 40 blad, which is the 910 worktop height every
 * Dutch kitchen is set out to; a wall unit hangs at 700; a tall unit runs to the
 * top of the run.
 */
const KIND_DEFAULTS: Record<CabinetKind, { depth: number; height: number }> = {
  base: { depth: 600, height: 720 },
  wall: { depth: 350, height: 700 },
  tall: { depth: 600, height: 2000 },
};

export function cabinetDefaults(kind: CabinetKind): CabinetSpec {
  const d = KIND_DEFAULTS[kind];
  return {
    kind, width: 600, depth: d.depth, height: d.height,
    front: "door", hinge: "left", drawers: 3, corner: false,
    // A base unit carries the worktop; a wall or tall unit does not.
    worktop: kind === "base",
  };
}

/**
 * Named units. The object underneath is generic, but nobody orders a "base
 * cabinet, 600, drawers": they order a ladenkast. These write the fields, in the
 * order the palette lists them.
 *
 * The ids are translation keys (`cabinet.<id>`), so adding one needs its name in
 * both languages or the i18n test fails.
 */
export interface CabinetPreset extends CabinetSpec { id: string }

const preset = (id: string, kind: CabinetKind, over: Partial<CabinetSpec> = {}): CabinetPreset =>
  ({ id, ...cabinetDefaults(kind), ...over });

export const CABINET_PRESETS: readonly CabinetPreset[] = [
  // Keuken — onder.
  preset("onderkast", "base"),
  preset("ladenkast", "base", { front: "drawers", drawers: 3 }),
  preset("spoelkast", "base", { front: "double" }),
  preset("hoekkast-onder", "base", { corner: true, width: 900, depth: 900 }),
  preset("vulpaneel", "base", { width: 150, front: "open" }),
  // Keuken — boven.
  preset("bovenkast", "wall"),
  preset("bovenkast-open", "wall", { front: "open" }),
  preset("hoekkast-boven", "wall", { corner: true, width: 600, depth: 600 }),
  // Keuken — hoog.
  preset("hoge-kast", "tall", { front: "double" }),
  preset("apparatenkast", "tall", { front: "open" }),
  preset("koelkast-ombouw", "tall"),
  // Buiten de keuken. Same object, other rooms — which is why the model is
  // cabinetry rather than a kitchen library.
  preset("garderobekast", "tall", { width: 1000, front: "double" }),
  preset("badkamermeubel", "base", { width: 800, depth: 460, front: "drawers", drawers: 2 }),
  preset("kantoorkast", "tall", { width: 800, depth: 400, front: "double" }),
  preset("wandschap", "wall", { width: 800, depth: 300, front: "open" }),
];

export function cabinetPreset(id: string): CabinetPreset | undefined {
  return CABINET_PRESETS.find(p => p.id === id);
}

/**
 * Which named unit a cabinet currently matches, or null once it has been tuned
 * into something the list does not name. Matched on what the unit IS — height
 * class, size, front, corner — and not on hinge side or drawer count, which are
 * tunings: a ladenkast with four drawers hung the other way is still a
 * ladenkast, the way doorKindOf() ignores which jamb a leaf hangs on.
 */
export function cabinetPresetOf(c: Cabinet): CabinetPreset | null {
  return CABINET_PRESETS.find(p =>
    p.kind === c.kind
    && p.width === c.width
    && p.depth === c.depth
    && p.front === c.front
    && p.corner === !!c.corner
    && p.worktop === !!c.worktop) ?? null;
}

/** Hinge side, defaulted. */
export const cabinetHinge = (c: Cabinet): CabinetHinge => c.hinge ?? "left";

/** Carcass height, defaulted from the height class. */
export const cabinetHeight = (c: Cabinet): number =>
  c.height ?? KIND_DEFAULTS[c.kind].height;

/** Drawer count, defaulted and bounded to what is drawable at plan scale. */
export const cabinetDrawers = (c: Cabinet): number =>
  Math.max(1, Math.min(8, Math.round(c.drawers ?? 3)));

/**
 * Whether the unit sits entirely above the section plane, and so is drawn
 * dashed. This is the one place the drawing depends on the height class.
 */
export const cabinetOverhead = (c: Cabinet): boolean => c.kind === "wall";

/** Whole millimetres, and within what a cabinet can be built to. */
export function clampCabinet(s: CabinetSpec): CabinetSpec {
  return {
    ...s,
    width: clampInt(s.width, 100, 3000),
    depth: clampInt(s.depth, 100, 1200),
    height: clampInt(s.height, 100, 3000),
    drawers: clampInt(s.drawers, 1, 8),
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(isFinite(n) ? n : lo)));
}

/** The nearest module width at or below `mm`, for snapping a dragged width. */
export function nearestModule(mm: number): number {
  let best = CABINET_WIDTHS[0]!;
  for (const w of CABINET_WIDTHS) if (Math.abs(w - mm) < Math.abs(best - mm)) best = w;
  return best;
}
