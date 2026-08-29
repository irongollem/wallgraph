// The document is a planar graph of wall centerlines. All lengths/coords are
// integer millimetres. Everything visible is derived from this at render time.
export type Id = string;

export interface PlanNode { id: Id; x: number; y: number }

export type OpeningKind = "door" | "window" | "passage";
/**
 * "tilt-turn" is the Dutch draai-kiep: hinged at one jamb to swing in, and at
 * the sill to tilt. By far the most common opening window in NL housing.
 */
export type WindowType = "fixed" | "casement" | "sliding" | "tilt-turn";

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
  windowType?: WindowType;
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

export function findNode(f: Floor, id: Id): PlanNode | undefined { return f.nodes.find(n => n.id === id); }
export function findWall(f: Floor, id: Id): Wall | undefined { return f.walls.find(w => w.id === id); }
