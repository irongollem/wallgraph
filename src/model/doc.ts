// The document is a planar graph of wall centerlines. All lengths/coords are
// integer millimetres. Everything visible is derived from this at render time.
import type { Stair } from "./stair";
import type { Vide } from "./vide";
import type { Cabinet } from "./cabinet";
import type { RoomName } from "./room";

export type Id = string;

export interface PlanNode { id: Id; x: number; y: number }

export type OpeningKind = "door" | "window" | "passage";

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
  /** Panes across the opening, in a->b order. Empty for an open passage. */
  sashes: Sash[];
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
   * Fire resistance. Not a motion, so it lives on the opening rather than a
   * sash — a double door has one rating, not two. See FireKind.
   */
  fireRating?: FireRating;
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
  /**
   * Placed stairs. Optional because a plan drawn before stairs existed simply
   * has none, the way `areaMode` is optional — read it through stairsOf().
   */
  stairs?: Stair[];
  /**
   * Openings in this floor's slab, open to the storey below. A vide is a
   * feature of the floor rather than a storey of its own: the slab has a hole,
   * and the plan of this storey is where it is drawn.
   */
  vides?: Vide[];
  /**
   * Placed cabinetry. Like stairs, a cabinet stores its dimensions because the
   * same kastje is built 400, 600 or 800 wide; see model/cabinet.ts.
   */
  cabinets?: Cabinet[];
  /**
   * What the rooms are called. A name is authored, so it is stored; which room
   * it names is derived from its point. See model/room.ts.
   */
  roomNames?: RoomName[];
  /**
   * Storey height in mm, floor to floor. This is what a stair on this floor
   * climbs unless it states otherwise, so changing it moves every stair that
   * follows it. Absent means the default: a plan nobody has given a storey
   * height to carries no number the drawer did not choose.
   */
  height?: number;
}

/** A floor's stairs. Absent means none, not an error. */
export function stairsOf(f: Floor): Stair[] { return f.stairs ?? []; }

/** A floor's vides. Absent means none, not an error. */
export function videsOf(f: Floor): Vide[] { return f.vides ?? []; }

/** A floor's cabinets. Absent means none, not an error. */
export function cabinetsOf(f: Floor): Cabinet[] { return f.cabinets ?? []; }

/** A floor's room names. Absent means none, not an error. */
export function roomNamesOf(f: Floor): RoomName[] { return f.roomNames ?? []; }

/**
 * Storey height, floor to floor. 2800 is the ordinary Dutch new-build figure and
 * gives a 15-tread flight a 175 optrede.
 */
export const FLOOR_HEIGHT_DEFAULT = 2800;
export const floorHeight = (f: Floor): number => f.height ?? FLOOR_HEIGHT_DEFAULT;

/**
 * How reported areas are measured. Plans are dimensioned both ways in practice
 * and the gap is large — a 4x3 m room with 300 mm walls is 12 m² centerline but
 * 9.99 m² net — so the document records which one its numbers mean rather than
 * leaving a reader to guess.
 *   net        inner wall faces (dagmaat); the usable floor, per NEN 2580
 *   centerline hart-op-hart; matches the stored wall graph directly
 */
export type AreaMode = "net" | "centerline";

/**
 * Which convention the LINEAR dimensions use. Separate from `areaMode` because
 * the two answer different questions: a drawing states one area per room, but
 * it can carry two dimension chains, and interior work is set out from the
 * clear span while the structure is set out hart-op-hart.
 *   centerline axis to axis; one break per junction, as the graph stores it
 *   clear      face to face (dagmaat); breaks move onto the wall faces
 *   both       both chains, the clear one nearest the building
 */
export type DimMode = "centerline" | "clear" | "both";

/**
 * What the sheet's title block states about the plan. All fields are authored
 * and optional: an empty title block is a statement nobody made, not an error.
 * The permit checklist reports which fields a submission ordinarily needs.
 */
export interface ProjectMeta {
  /** Project name as the title block states it. */
  name?: string;
  /** Site address (straat, huisnummer, plaats). */
  address?: string;
  /** Drawing number (tekeningnummer). */
  number?: string;
  /** Who drew it (getekend). */
  author?: string;
  /** Date as written on the sheet. Absent means the export date. */
  date?: string;
}

export interface PlanDoc {
  version: 1;
  unit: "mm";
  gridMm: number;
  /** Absent on documents written before this existed; treat as "net". */
  areaMode?: AreaMode;
  /** Absent means "centerline": the convention the editor drew before this. */
  dimMode?: DimMode;
  /** Title-block data. Absent means nothing has been filled in. */
  project?: ProjectMeta;
  /**
   * Where north points: degrees clockwise from screen-up, an integer 0-359.
   * Authored, because the drawing cannot know its own orientation. Absent
   * means the direction has not been stated, so no north arrow is drawn —
   * a guessed arrow would be a false statement on a sheet.
   */
  northDeg?: number;
  floors: Floor[];
}

/** Title-block data. Absent fields read as empty, not as an error. */
export const projectOf = (d: PlanDoc): ProjectMeta => d.project ?? {};

export const AREA_MODE_DEFAULT: AreaMode = "net";
export const areaModeOf = (d: PlanDoc): AreaMode => d.areaMode ?? AREA_MODE_DEFAULT;

export const DIM_MODE_DEFAULT: DimMode = "centerline";
export const dimModeOf = (d: PlanDoc): DimMode => d.dimMode ?? DIM_MODE_DEFAULT;

let seq = 0;
export const newId = (p: string): Id => `${p}${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;

/** Default grid. 100 mm: building measurements are rarely finer, and it is
 * coarse enough to draw directly at ordinary zoom instead of stepping up. */
export const GRID_DEFAULT_MM = 100;

export function emptyDoc(): PlanDoc {
  return {
    version: 1, unit: "mm", gridMm: GRID_DEFAULT_MM,
    floors: [{
      id: newId("f"), name: "Floor 1",
      nodes: [], walls: [], symbols: [], stairs: [], vides: [], cabinets: [], roomNames: [],
    }],
  };
}

/**
 * What a rating measures.
 *   wbdbo  weerstand tegen branddoorslag en brandoverslag — the Bouwbesluit
 *          figure for a door in a compartment wall, and the one written on a
 *          Dutch drawing. The usual choice, so it is listed first.
 *   wbd    branddoorslag only, without the overslag half
 *   wrd    weerstand tegen rookdoorgang: smoke, not fire
 */
export type FireKind = "wbdbo" | "wbd" | "wrd";

export const FIRE_KINDS: readonly FireKind[] = ["wbdbo", "wbd", "wrd"];

export interface FireRating { kind: FireKind; minutes: number }

/**
 * The ratings doors are specified at. Anything else stays typeable — the field
 * is a number — but a list of five covers what is actually drawn.
 */
export const FIRE_MINUTES: readonly number[] = [20, 30, 60, 90, 120];

export const FIRE_MINUTES_DEFAULT = 30;

/**
 * The rating as it goes on the drawing: "WBDBO 30". The acronym is uppercase
 * because that is how it is written and how it is read aloud on site, and it
 * is built here rather than at each call site so the canvas and the exports
 * cannot drift apart.
 */
export function fireLabel(r: FireRating): string {
  return `${r.kind.toUpperCase()} ${r.minutes}`;
}

export const WALL_DEFAULT_INTERIOR = 100;
export const WALL_DEFAULT_EXTERIOR = 300;
export const DOOR_DEFAULT_WIDTH = 830;
export const WINDOW_DEFAULT_WIDTH = 1200;
export const PASSAGE_DEFAULT_WIDTH = 900;

/**
 * Standard opening widths, in millimetres of hole in the wall.
 *
 * `Opening.width` is the dagmaat — the clear opening the kozijn is set in — not
 * the deurblad, which is narrower by the frame. These are the Dutch
 * binnendeurkozijn sizes a door is ordered at (a 830 dagmaat takes the common
 * 780 x 2015 blad), plus the wider outer and double leaves. Anything else stays
 * typeable; the list exists because cabinetry and doors are ordered in steps
 * rather than measured, and 900 for every door was a number nobody builds to.
 */
export const DOOR_WIDTHS: readonly number[] = [730, 780, 830, 880, 930, 1010];

/** Double-leaf and pui widths, offered under their own heading. */
export const DOOR_WIDTHS_DOUBLE: readonly number[] = [1500, 1800, 2100, 2400];

/** Standard window widths. Coarser than doors: a raam is made to size. */
export const WINDOW_WIDTHS: readonly number[] = [600, 900, 1200, 1500, 1800, 2400];

/** Clear widths a doorway is set out to. A doorway has no kozijn to allow for. */
export const PASSAGE_WIDTHS: readonly number[] = [800, 900, 1000, 1200, 1500, 1800];

/** The widths offered for an opening of this kind. */
export function widthsFor(kind: OpeningKind): readonly number[] {
  return kind === "door" ? DOOR_WIDTHS
       : kind === "window" ? WINDOW_WIDTHS
       : PASSAGE_WIDTHS;
}

/**
 * The sashes of an opening, left to right along a->b, each with a resolved
 * width in mm.
 */
export function sashesOf(o: Opening, openingWidth: number): Array<Sash & { width: number }> {
  const list = sashSpecsOf(o);
  // Unsized sashes split whatever the sized ones leave.
  const sized = list.reduce((t, s) => t + (s.width ?? 0), 0);
  const unsized = list.filter(s => s.width === undefined).length;
  const each = unsized > 0 ? Math.max(0, openingWidth - sized) / unsized : 0;
  return list.map(s => ({ ...s, width: s.width ?? each }));
}

/**
 * Editable sash specifications, retaining omitted widths as automatic.
 *
 * An opening that arrives without the array carries no panes rather than
 * bringing the drawing down. This runs on every frame, for every opening, so a
 * single document that does not match the type — pasted, linked, or written by
 * something else — would otherwise throw mid-render and leave every wall after
 * it, and the storey's rooms, symbols and stairs, undrawn with nothing said.
 * No panes is a state the model already has: a passage has none.
 */
export function sashSpecsOf(o: Opening): Sash[] {
  return Array.isArray(o.sashes) ? o.sashes.map(s => ({ ...s })) : [];
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

/** Named door and window presets exposed by the editor and documentation. */
export const OPENING_TYPE_COUNT = WINDOW_KINDS.length + DOOR_KINDS.length;

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
