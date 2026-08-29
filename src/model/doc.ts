// The document is a planar graph of wall centerlines. All lengths/coords are
// integer millimetres. Everything visible is derived from this at render time.
export type Id = string;

export interface PlanNode { id: Id; x: number; y: number }

export type OpeningKind = "door" | "window" | "passage";
/** Legacy single-sash shorthand. New documents use `Opening.sashes`. */
export type WindowType = "fixed" | "casement" | "sliding" | "tilt-turn";

/**
 * What one movable pane does. Kept deliberately small: the NEN window sheets
 * distinguish far more named products than there are distinct motions, because
 * most of the difference is WHICH EDGE hinges and WHICH WAY it opens, not the
 * motion itself. So valraam and uitzetraam are both `tilt` — one hinged at the
 * sill opening in, the other at the head opening out — rather than two actions.
 */
export type SashAction =
  | "fixed"        // vast
  | "turn"         // draaiend, hinged at a jamb
  | "tilt"         // kiepend: valraam (sill, inward) or uitzetraam (head, outward)
  | "turn-tilt"    // draai-valraam / draai-kiep
  | "pivot"        // taatsraam/taatsdeur, VERTICAL centre axis — turns in plan
  | "tumble"       // tuimelraam, HORIZONTAL centre axis — section only
  | "project"      // projectieraam, leaf swings out on arms
  | "parallel"     // parallel afstelraam, leaf lifts straight off the frame
  | "double-acting" // doordraaiend: swings both ways (saloon / bommerscharnier)
  | "overhead"     // kanteldeur, tilts up overhead
  | "slide"        // horizontaal schuivend
  | "slide-vertical" // verticaal schuifraam
  | "turn-slide"   // draai-schuifraam
  | "fold"         // vouwwand
  | "revolve";     // tourniquet

/**
 * Which edge a sash hinges on. "a"/"b" are the jambs, in the wall's own a->b
 * direction, so they survive the wall being redrawn; "head" and "sill" are the
 * horizontal edges, which exist in the document but cannot be drawn in plan.
 */
export type HingeEdge = "a" | "b" | "head" | "sill";

/**
 * One pane within an opening. A combination window — fixed light beside a
 * draai-valraam, say — is ONE hole in the wall divided by mullions, not two
 * openings with a pier invented between them, so the panes live here.
 */
export interface Sash {
  /** mm. Omitted means "share what is left equally with other unsized sashes". */
  width?: number;
  action: SashAction;
  hinge?: HingeEdge;
  /** true = naar buiten draaiend (drawn solid), false/absent = naar binnen (dashed). */
  outward?: boolean;
  slideTo?: "a" | "b";
  /** Rotation sense, revolving doors only. Defaults to counter-clockwise. */
  spin?: "cw" | "ccw";
  /**
   * Roedeverdeling: how many glass panes the sash is divided into by glazing
   * bars. In plan the bars are seen edge-on, so they read as ticks across the
   * glass line rather than as a grid. 0 or absent = undivided.
   */
  bars?: number;
}

export interface Opening {
  id: Id;
  kind: OpeningKind;
  t: number;      // centre distance from node a along the centerline, mm
  width: number;  // mm
  hinge?: "a" | "b";
  /**
   * Opens toward the perp(a->b) side when true. Doors swing that way; for
   * windows it also picks the line style, since a NEN window sheet encodes
   * direction as solid = naar buiten, dashed = naar binnen draaiend.
   */
  swingIn?: boolean;
  /** Legacy single-sash shorthand; `sashes` wins when both are present. */
  windowType?: WindowType;
  /** Panes across the opening, in a->b order. Absent = one sash from windowType. */
  sashes?: Sash[];
  slideTo?: "a" | "b";
  /**
   * Glazed leaf (glaspartij). A glazed door reads as a frame with glass rather
   * than a solid panel, so its leaf is drawn as a thin double line.
   */
  glazed?: boolean;
  /** Electrically operated — drawn with a small circle at the drive point. */
  powered?: boolean;
  /** Self-closing, as a fire door must be. */
  selfClosing?: boolean;
  /**
   * Fire resistance. "wbd" is weerstand tegen branddoorslag, "wrd" weerstand
   * tegen rookdoorgang; minutes is the rating. Not a motion, so it lives on the
   * opening rather than a sash — a double door has one rating, not two.
   */
  fireRating?: { kind: "wbd" | "wrd"; minutes: number };
  sillHeight?: number;
  height?: number;
}

export interface Wall {
  id: Id;
  a: Id;
  b: Id;
  thickness: number; // mm
  bulge: number;     // 0 = straight
  openings: Opening[];
}

export interface SymbolInstance {
  id: Id;
  type: string;
  x: number; y: number;   // anchor, mm
  rotation: number;       // radians
  mirrored?: boolean;
  wallId?: Id;            // set when wall-snapped
  /**
   * Pen colour as "#rrggbb". Absent means the plan's default ink, which is why
   * it is optional rather than defaulted: a plan nobody has recoloured carries
   * no colour at all, and the default stays a render decision.
   *
   * Not decoration. A verbouwtekening says what is new by drawing it in red
   * over the existing work in black, so the colour carries the same kind of
   * meaning as a fire rating — it is part of what the symbol states.
   */
  color?: string;
}

export interface Floor {
  id: Id;
  name: string;
  nodes: PlanNode[];
  walls: Wall[];
  symbols: SymbolInstance[];
}

/**
 * How reported areas are measured. Plans are dimensioned both ways in practice
 * and the gap is large — a 4x3 m room with 300 mm walls is 12 m² centerline but
 * 9.99 m² net — so the document records which one its numbers mean rather than
 * leaving a reader to guess.
 *   net        inner wall faces (dagmaat); the usable floor, per NEN 2580
 *   centerline hart-op-hart; matches the stored wall graph directly
 */
export type AreaMode = "net" | "centerline";

export interface PlanDoc {
  version: 1;
  unit: "mm";
  gridMm: number;
  /** Absent on documents written before this existed; treat as "net". */
  areaMode?: AreaMode;
  floors: Floor[];
}

export const AREA_MODE_DEFAULT: AreaMode = "net";
export const areaModeOf = (d: PlanDoc): AreaMode => d.areaMode ?? AREA_MODE_DEFAULT;

let seq = 0;
export const newId = (p: string): Id => `${p}${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;

/** Default grid. 100 mm: building measurements are rarely finer, and it is
 * coarse enough to draw directly at ordinary zoom instead of stepping up. */
export const GRID_DEFAULT_MM = 100;

export function emptyDoc(): PlanDoc {
  return {
    version: 1, unit: "mm", gridMm: GRID_DEFAULT_MM,
    floors: [{ id: newId("f"), name: "Floor 1", nodes: [], walls: [], symbols: [] }],
  };
}

export const WALL_DEFAULT_INTERIOR = 100;
export const WALL_DEFAULT_EXTERIOR = 300;
export const DOOR_DEFAULT_WIDTH = 900;
export const WINDOW_DEFAULT_WIDTH = 1200;
export const PASSAGE_DEFAULT_WIDTH = 900;

/**
 * The sashes of an opening, left to right along a->b, each with a resolved
 * width in mm. Falls back to the legacy windowType so documents written before
 * sashes existed keep rendering exactly as they did.
 */
export function sashesOf(o: Opening, openingWidth: number): Array<Sash & { width: number }> {
  const list: Sash[] = o.sashes?.length
    ? o.sashes
    : [legacySash(o)];
  // Unsized sashes split whatever the sized ones leave.
  const sized = list.reduce((t, s) => t + (s.width ?? 0), 0);
  const unsized = list.filter(s => s.width === undefined).length;
  const each = unsized > 0 ? Math.max(0, openingWidth - sized) / unsized : 0;
  return list.map(s => ({ ...s, width: s.width ?? each }));
}

function legacySash(o: Opening): Sash {
  const outward = o.swingIn === false;
  // A door with no sashes is a single hinged leaf — windowType says nothing
  // about it, and defaulting to "fixed" would silently erase every door's swing.
  if (o.kind === "door") return { action: "turn", hinge: o.hinge ?? "a", outward };
  if (o.kind === "passage") return { action: "fixed" };
  switch (o.windowType ?? "fixed") {
    case "casement":  return { action: "turn", hinge: o.hinge ?? "a", outward };
    case "tilt-turn": return { action: "turn-tilt", hinge: o.hinge ?? "a", outward };
    case "sliding":   return { action: "slide", slideTo: o.slideTo ?? "b" };
    default:          return { action: "fixed" };
  }
}

/**
 * The named window products from the NEN sheets, each one a preset over
 * (action, hinge, outward).
 *
 * The model deliberately has fewer actions than the sheets have names — a
 * valraam and an uitzetraam are the same tilt, differing only in which edge
 * hinges and which way it opens. That is right for the geometry and wrong for
 * the person drawing: someone looking for "valraam" should not have to know it
 * is "kiepend + onderdorpel". So the panel picks from these names and writes
 * the parts.
 */
export interface WindowKind {
  id: string;
  action: SashAction;
  hinge?: HingeEdge;
  outward?: boolean;
  /**
   * Kinds that are not one pane. A stolpraam is two leaves closing against each
   * other, so picking it replaces the whole sash list rather than retyping one
   * pane. Matching ignores these — a stolpraam reads as two draairamen, which
   * is what it is.
   */
  expandsTo?: Sash[];
}

export const WINDOW_KINDS: WindowKind[] = [
  { id: "vast",        action: "fixed" },
  { id: "draai",       action: "turn",           hinge: "a",    outward: false },
  { id: "draaiVal",    action: "turn-tilt",      hinge: "a",    outward: false },
  { id: "val",         action: "tilt",           hinge: "sill", outward: false },
  { id: "uitzet",      action: "tilt",           hinge: "head", outward: true },
  { id: "tuimel",      action: "tumble" },
  { id: "taats",       action: "pivot" },
  { id: "projectie",   action: "project",  outward: true },
  { id: "parallel",    action: "parallel", outward: true },
  { id: "stolp",       action: "turn",     hinge: "a", outward: false,
    expandsTo: [{ action: "turn", hinge: "a" }, { action: "turn", hinge: "b" }] },
  { id: "schuifH",     action: "slide" },
  { id: "schuifV",     action: "slide-vertical" },
  { id: "draaiSchuif", action: "turn-slide",     hinge: "a",    outward: false },
  { id: "vouw",        action: "fold",           outward: false },
];

/**
 * Which named kind a sash currently matches, or null when the parts have been
 * tuned into a combination the sheets do not name (a side-hung sash opening
 * outward, say — real, just not one of the listed products).
 */
export function windowKindOf(sash: Sash): WindowKind | null {
  // Match on what the window IS, not how this one is tuned. Which jamb hinges
  // and which way it opens are per-sash settings — a draairaam hinged right is
  // still a draairaam. A HORIZONTAL hinge is different: it is the only thing
  // separating a valraam (sill) from an uitzetraam (head), both of them tilts,
  // so it stays part of the identity.
  const horizontal = (h?: HingeEdge): boolean => h === "head" || h === "sill";
  return WINDOW_KINDS.find(k =>
    k.action === sash.action
    && (!horizontal(k.hinge) || k.hinge === sash.hinge)) ?? null;
}

/**
 * Named door sets. Unlike a window kind, which describes one pane, a door kind
 * describes the whole opening — "dubbele deur" IS two leaves — so these presets
 * write the entire sash list.
 */
export interface DoorKind {
  id: string;
  sashes: Sash[];
}

export const DOOR_KINDS: DoorKind[] = [
  { id: "enkel",       sashes: [{ action: "turn", hinge: "a", outward: false }] },
  { id: "dubbel",      sashes: [{ action: "turn", hinge: "a", outward: false },
                                { action: "turn", hinge: "b", outward: false }] },
  { id: "schuif",      sashes: [{ action: "slide", slideTo: "b" }] },
  { id: "schuifDubbel", sashes: [{ action: "slide", slideTo: "a" },
                                 { action: "slide", slideTo: "b" }] },
  { id: "vouw",        sashes: [{ action: "fold", outward: false }] },
  { id: "taats",       sashes: [{ action: "pivot" }] },
  { id: "tourniquet",  sashes: [{ action: "revolve", spin: "ccw" }] },
  { id: "doordraai",   sashes: [{ action: "double-acting", hinge: "a" }] },
  { id: "saloon",      sashes: [{ action: "double-acting", hinge: "a" },
                                { action: "double-acting", hinge: "b" }] },
  { id: "kantel",      sashes: [{ action: "overhead" }] },
  // Puien. A pui is a kozijn holding fixed glazing beside opening parts, so it
  // is a sash list rather than an action — these are the common NL layouts.
  { id: "schuifpui",   sashes: [{ action: "fixed" }, { action: "slide", slideTo: "a" }] },
  { id: "schuifpui3",  sashes: [{ action: "fixed" }, { action: "slide", slideTo: "a" },
                                { action: "fixed" }] },
  { id: "draaipui",    sashes: [{ action: "fixed" }, { action: "turn", hinge: "b" }] },
];

/** Which named door set a sash list matches, or null for a tuned combination. */
export function doorKindOf(sashes: Sash[]): DoorKind | null {
  // Leaf count and what each leaf does identify the set; hinge side, swing
  // direction and slide direction are tunings on top of it. Matching those too
  // made every door whose hinge was not "a" read as "custom".
  return DOOR_KINDS.find(k =>
    k.sashes.length === sashes.length
    && k.sashes.every((ks, i) => ks.action === sashes[i]!.action)) ?? null;
}

export function findNode(f: Floor, id: Id): PlanNode | undefined { return f.nodes.find(n => n.id === id); }
export function findWall(f: Floor, id: Id): Wall | undefined { return f.walls.find(w => w.id === id); }
