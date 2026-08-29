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
  | "pivot"        // tuimelraam, horizontal centre axis
  | "slide"        // horizontaal schuivend
  | "slide-vertical" // verticaal schuifraam
  | "turn-slide"   // draai-schuifraam
  | "fold";        // vouwwand

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
  switch (o.windowType ?? "fixed") {
    case "casement":  return { action: "turn", hinge: o.hinge ?? "a", outward };
    case "tilt-turn": return { action: "turn-tilt", hinge: o.hinge ?? "a", outward };
    case "sliding":   return { action: "slide", slideTo: o.slideTo ?? "b" };
    default:          return { action: "fixed" };
  }
}

export function findNode(f: Floor, id: Id): PlanNode | undefined { return f.nodes.find(n => n.id === id); }
export function findWall(f: Floor, id: Id): Wall | undefined { return f.walls.find(w => w.id === id); }
