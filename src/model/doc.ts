// The document is a planar graph of wall centerlines. All lengths/coords are
// integer millimetres. Everything visible is derived from this at render time.
export type Id = string;

export interface PlanNode { id: Id; x: number; y: number }

export type OpeningKind = "door" | "window" | "passage";
export type WindowType = "fixed" | "casement" | "sliding";

export interface Opening {
  id: Id;
  kind: OpeningKind;
  t: number;      // centre distance from node a along the centerline, mm
  width: number;  // mm
  hinge?: "a" | "b";
  swingIn?: boolean;       // door opens toward perp(a->b) side when true
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

export interface PlanDoc {
  version: 1;
  unit: "mm";
  gridMm: number;
  floors: Floor[];
}

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
