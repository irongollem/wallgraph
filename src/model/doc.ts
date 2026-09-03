// The document is a planar graph of wall centerlines. All lengths/coords are
// integer millimetres. Everything visible is derived from this at render time.
import type { Stair } from "./stair";
import type { BoardData } from "./board";
import type { Vide } from "./vide";
import type { Structural } from "./structure";
import type { Furnishing } from "./furnishing";
import type { Route } from "./route";
import type { RouteContinuation } from "./continuation";
import type { RoomName } from "./room";
import { newDocGuid } from "./guid";

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
  /** mm above the floor. Windows default to WINDOW_SILL_DEFAULT; read via openingSill(). */
  sillHeight?: number;
  /** mm. Absent means the kind's default; read via openingHeight(). */
  height?: number;
}

/**
 * What a wall's body is built of.
 *
 * Two of these are infill rather than masonry — `glass` and `sandwich` — and
 * they are drawn as a light body between two faces rather than as poché,
 * because that is what separates a glazen wand or a beplating from a stud wall
 * on a plan. The other four draw as poché and exist so the wall can state its
 * material to IFC, where a name is the whole answer.
 *
 * This is a single material, not a build-up: a sandwich panel is named as one
 * thing rather than modelled as facing/core/facing. See the known limitations
 * in CLAUDE.md, and `postMm` below for the frame that carries an infill.
 */
export type WallMaterial =
  | "masonry" | "concrete" | "timber" | "steel" | "glass" | "sandwich";

export const WALL_MATERIALS: readonly WallMaterial[] =
  ["masonry", "concrete", "timber", "steel", "glass", "sandwich"];

/** The materials drawn as a light infill body rather than as poché. */
export const wallInfill = (w: Pick<Wall, "material">): boolean =>
  w.material === "glass" || w.material === "sandwich";

export interface Wall {
  id: Id;
  a: Id;
  b: Id;
  thickness: number; // mm
  bulge: number;     // 0 = straight
  openings: Opening[];
  /** mm, floor to floor. Absent means the storey height; read via wallHeight(). */
  height?: number;
  /**
   * Authored, and deliberately tri-state: absent means "not stated", which is
   * a different fact from `false` for IFC (Pset_WallCommon.LoadBearing has no
   * "unknown" of its own otherwise). Never collapsed by an accessor.
   */
  loadBearing?: boolean;
  /** Same FireRating an opening carries — a fire compartment wall has one. */
  fireRating?: FireRating;
  /**
   * What the body is built of. Absent means not stated, which is a different
   * fact from "masonry" for the same reason `loadBearing` is tri-state, and
   * draws the same as masonry either way.
   */
  material?: WallMaterial;
  /**
   * Post (stijl) centres in mm — the frame the wall's body is carried on.
   *
   * One field for what is one thing seen in plan: the mullions of a glazed
   * wall, the columns of a steel frame carrying sandwich panels, and the studs
   * of a timber wall are all vertical members at centres, and a plan shows a
   * vertical member. Dutch says stijl for every one of them.
   *
   * Read as a MAXIMUM bay width rather than as a fixed grid: each run of body
   * between openings is divided into equal bays no wider than this. A door set
   * into the wall therefore pushes the posts of its own run aside instead of
   * one landing in the doorway, and its jambs read as the posts they are in a
   * real pui. Absent means none — a frameless pane, or a wall whose frame is
   * not being drawn.
   */
  postMm?: number;
  /**
   * The post's own width along the wall, mm. Its depth is not stored because
   * the wall already carries it: a post runs through the thickness.
   *
   * Absent means the members are at these centres but their profile is not
   * stated, which is an ordinary thing for a drawing to say before the supplier
   * is chosen; a post with no width is drawn as a line. Read through
   * wallPostWidthMm(), which is also what keeps it from outgrowing its bay.
   */
  postWidthMm?: number;
  /**
   * Cladding outside the structural body, mm. `thickness` stays the STRUCTURE:
   * a sandwich wall built 100 + 100 is `thickness: 100, facadeMm: 100`.
   *
   * A skin, not a build-up. It lies wholly outside the structural faces, so it
   * changes neither the wall graph, nor room detection, nor the net area — the
   * three things a real layer set would reach into. What it does change is the
   * gross area, which is measured to its outer face (see AreaMode "bvo").
   *
   * Absent means none. A wall with no facade is an internal or party wall.
   */
  facadeMm?: number;
  /**
   * Which side of the wall's own a->b direction the facade is on: "left" is
   * +perp(tangent), the clockwise visual side (invariant 2). Stored rather than
   * derived from which side the rooms are on, because that probe flips as soon
   * as a wall is redrawn or a room stops closing. Absent means "left".
   */
  facadeSide?: "left" | "right";
  /**
   * Pen colour as "#rrggbb", the same statement SymbolInstance.color makes:
   * black is what is there, red what is to be built, yellow what goes. Absent
   * means the plan's default masonry ink, so a plan nobody has recoloured
   * carries no colour at all.
   *
   * Read through wallPen() in render/draw.ts, never directly — canvas ignores
   * an invalid fillStyle rather than throwing, so one bad value out of a pasted
   * document would silently paint the wall in the previous one's colour.
   */
  color?: string;
}

/** True when the wall's body is glazed, and so drawn as faces rather than fill. */
export const wallGlazed = (w: Wall): boolean => w.material === "glass";

/**
 * The post spacing that actually applies. Absent and zero both mean no frame,
 * so the render and both exporters ask this rather than reading `postMm` and
 * repeating the check three times.
 *
 * Deliberately NOT restricted to one material. A frame carrying an infill is
 * the same drawing whether the infill is glass or beplating, and a masonry wall
 * on penanten is a real thing too; what a post is called changes, what it is
 * does not.
 */
export function wallPostMm(w: Wall): number | undefined {
  return w.postMm !== undefined && w.postMm > 0 ? w.postMm : undefined;
}

/**
 * The post profile width that actually applies, mm, or undefined for a post
 * drawn as a line. Never wider than `cap` (the bay it sits in), because a post
 * that fills its own bay leaves no body either side of it and the profiles of
 * two neighbours would overlap into one block.
 */
export function wallPostWidthMm(w: Wall, cap = Infinity): number | undefined {
  if (wallPostMm(w) === undefined) return undefined;
  if (w.postWidthMm === undefined || w.postWidthMm <= 0) return undefined;
  return Math.min(w.postWidthMm, cap);
}

/**
 * The facade thickness that actually applies. Absent and zero both mean a wall
 * with no cladding, so the render, the exporters and the gross-area sum ask
 * this rather than each repeating the check.
 */
export function wallFacadeMm(w: Wall): number | undefined {
  return w.facadeMm !== undefined && w.facadeMm > 0 ? w.facadeMm : undefined;
}

/** Which side the facade is on, defaulting to the wall's own left. */
export const facadeSideOf = (w: Wall): "left" | "right" => w.facadeSide ?? "left";

/** An ordinary outer leaf or cladding thickness, mm. */
export const FACADE_DEFAULT_MM = 100;

/** Ordinary curtain-walling / portal-frame centres, offered when posts go on. */
export const POST_DEFAULT_MM = 1200;
/** An ordinary mullion or column face width, mm. */
export const POST_WIDTH_DEFAULT = 60;

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
  /**
   * Mounting height above this storey's finished floor, mm. Absent means the
   * type's own conventional height (SymbolDef.mountHeight), which is what the
   * panel shows and the cable takeoff assumes; a socket above a worktop or a
   * light on a lowered ceiling states its own. Absent is not "zero": a device
   * whose type carries no convention either reads as unstated, and the takeoff
   * says so rather than guessing.
   */
  height?: number;
  /**
   * What this kast is called and the groepen it distributes. Only read for
   * type "dist-board" — the same "a field the form has no use for is simply
   * not read" shape Furnishing uses for a toilet's cistern or a basin's bowl
   * count. See model/board.ts.
   */
  board?: BoardData;
}

/**
 * A raster image traced over while drawing a storey -- a scanned or
 * photographed existing plan, placed and scaled so the walls can be drawn
 * over it. A tracing aid, not part of the drawing: it never appears in an
 * export (io/image.ts's PNG path never sets DrawExtras.showUnderlay; SVG,
 * DXF, IFC and the permit sheet never read Floor.underlay at all) and never
 * travels in a share link (io/link.ts's encodePlan strips it from every
 * floor before encoding -- a multi-hundred-KB data URL would break the URL
 * fragment, and a share link carries the drawing, not the scan).
 */
export interface Underlay {
  /** The image, downscaled and re-encoded on import (see io/underlay.ts). */
  dataUrl: string;
  /** mm. Top-left corner of the image in world space. */
  x: number;
  /** mm, positive down. Top-left corner of the image in world space. */
  y: number;
  /**
   * World mm per image pixel. A ratio, not a length or a coordinate, so a
   * float here is consistent with invariant 1 (integer mm) rather than a
   * violation of it -- nothing about "integer millimetres" constrains a
   * scale factor. Set imprecisely on import and corrected by calibration.
   */
  mmPerPixel: number;
  /** 0 (invisible) to 1 (opaque). */
  opacity: number;
}

export interface Floor {
  id: Id;
  name: string;
  nodes: PlanNode[];
  walls: Wall[];
  symbols: SymbolInstance[];
  /**
   * Trace-over image for this storey, absent until one is loaded. Per floor,
   * because each storey traces its own scan: Store.duplicateFloor() drops it
   * from the copy for the same reason it resets `roomNames` rather than
   * carrying them up -- a scan of this floor is not a fact about the next
   * one, and duplicating it would double the document's size for nothing.
   */
  underlay?: Underlay;
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
   * Columns, beams and railings: the structure that is not a wall. Placed
   * objects carrying their own dimensions, outside the wall graph; see
   * model/structure.ts.
   */
  structure?: Structural[];
  /**
   * What the storey is fitted out with: cabinetry, appliances, sanitary
   * fixtures and furniture. Like stairs, a furnishing stores its dimensions
   * because the same kastje is built 400, 600 or 800 wide and the same table is
   * whatever the room takes; see model/furnishing.ts.
   */
  furnishings?: Furnishing[];
  /**
   * Manually drawn service runs -- electrical, water, ventilation -- as
   * switchable layers over the plan. Absent means the plan predates them, or
   * simply has none; see model/route.ts and routesOf() below.
   */
  routes?: Route[];
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
  /**
   * Finished ceiling height in mm above this storey's floor: the height a wall
   * FACE is finished to where a suspended ceiling has been dropped under the
   * slab. Absent means none, so a face is finished floor to floor.
   *
   * A finish, not structure. It changes nothing a stair climbs, nothing IFC
   * says a space is, and nothing about the wall graph -- only the face area
   * core/surface.ts reports. A room states its own under its name
   * (RoomName.ceilingMm); this is what the rest of the storey falls back to.
   */
  ceilingMm?: number;
}

/** A floor's stairs. Absent means none, not an error. */
export function stairsOf(f: Floor): Stair[] { return f.stairs ?? []; }

/** A floor's vides. Absent means none, not an error. */
export function videsOf(f: Floor): Vide[] { return f.vides ?? []; }

/** A floor's columns, beams and railings. Absent means none, not an error. */
export function structureOf(f: Floor): Structural[] { return f.structure ?? []; }

/** A floor's furnishings. Absent means none, not an error. */
export function furnishingsOf(f: Floor): Furnishing[] { return f.furnishings ?? []; }

/** A floor's routes. Absent means none, not an error. */
export function routesOf(f: Floor): Route[] { return f.routes ?? []; }

/** A floor's room names. Absent means none, not an error. */
export function roomNamesOf(f: Floor): RoomName[] { return f.roomNames ?? []; }

/**
 * Storey height, floor to floor. 2800 is the ordinary Dutch new-build figure and
 * gives a 15-tread flight a 175 optrede.
 */
export const FLOOR_HEIGHT_DEFAULT = 2800;
export const floorHeight = (f: Floor): number => f.height ?? FLOOR_HEIGHT_DEFAULT;

/** A wall's own height, mm. Absent means the storey height it stands on. */
export const wallHeight = (f: Floor, w: Wall): number => w.height ?? floorHeight(f);

/**
 * The storey's finished ceiling height, mm, or undefined where no suspended
 * ceiling is stated. A figure at or above the storey height states nothing a
 * face is not already finished to, so it reads as absent rather than as a
 * ceiling inside the slab.
 */
/**
 * The ceiling height a suspended ceiling is first offered at, mm. Under the
 * ordinary 2800 storey it leaves the 200 a plenum needs for ducts and downlights;
 * a room finished lower than the rest -- a badkamer, usually -- states its own.
 */
export const CEILING_DEFAULT_MM = 2600;

export function storeyCeiling(f: Floor): number | undefined {
  const c = f.ceilingMm;
  return c !== undefined && c > 0 && c < floorHeight(f) ? c : undefined;
}

/**
 * How reported areas are measured. Plans are dimensioned both ways in practice
 * and the gap is large — a 4x3 m room with 300 mm walls is 12 m² centerline but
 * 9.99 m² net — so the document records which one its numbers mean rather than
 * leaving a reader to guess.
 *   net        inner wall faces (dagmaat); the usable floor, per NEN 2580
 *   centerline hart-op-hart; matches the stored wall graph directly
 *   bvo        gross floor area, per NEN 2580: to the OUTER face of the facade
 *              where the bounding wall has one, and to the centreline where it
 *              does not — which is what that standard says about a party wall
 *              shared with a neighbour. A plan with no facade anywhere reports
 *              the same figure as centerline, because that is what it is.
 */
export type AreaMode = "net" | "centerline" | "bvo";

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
  /** Write each device's mounting height beside it. See mountMarksOn(). */
  mountMarks?: boolean;
  /** Title-block data. Absent means nothing has been filled in. */
  project?: ProjectMeta;
  /**
   * Where north points: degrees clockwise from screen-up, an integer 0-359.
   * Authored, because the drawing cannot know its own orientation. Absent
   * means the direction has not been stated, so no north arrow is drawn —
   * a guessed arrow would be a false statement on a sheet.
   */
  northDeg?: number;
  /**
   * Per-document seed for IFC GlobalIds (32 lowercase hex chars). Combined
   * with each element's own id by ifcGuid() in guid.ts, so a re-export keeps
   * every element's identity and two documents cannot collide. Absent on
   * documents written before this existed.
   */
  guid?: string;
  /**
   * Elevation of the ground floor (floors[0]) above project zero (Peil), mm,
   * may be negative. Absent means 0. See floorElevation().
   */
  groundMm?: number;
  /** Authored vertical links between floor-local route endpoints. */
  continuations?: RouteContinuation[];
  /** Storeys, lowest first: floors[0] is the ground floor, the storey picker
   *  and floorElevation() both rely on that order. */
  floors: Floor[];
}

/** Title-block data. Absent fields read as empty, not as an error. */
export const projectOf = (d: PlanDoc): ProjectMeta => d.project ?? {};

/**
 * Elevation of floor `index` above project zero (Peil), mm: the ground
 * floor's own elevation plus the storey height of every floor below it.
 */
export function floorElevation(d: PlanDoc, index: number): number {
  let z = d.groundMm ?? 0;
  for (let i = 0; i < index; i++) z += floorHeight(d.floors[i]!);
  return z;
}

export const AREA_MODE_DEFAULT: AreaMode = "net";
export const areaModeOf = (d: PlanDoc): AreaMode => d.areaMode ?? AREA_MODE_DEFAULT;

export const DIM_MODE_DEFAULT: DimMode = "centerline";
export const dimModeOf = (d: PlanDoc): DimMode => d.dimMode ?? DIM_MODE_DEFAULT;

/**
 * Whether the plan writes each device's mounting height beside it. A drawing
 * convention like `areaMode` and `dimMode`, and stored for the same reason: an
 * export has no editor to ask, and a sheet that shows the heights on screen
 * and not on paper is two different drawings. Absent means off -- a
 * plattegrond is not an installatietekening until someone says it is.
 */
export const mountMarksOn = (d: PlanDoc): boolean => d.mountMarks === true;

let seq = 0;
export const newId = (p: string): Id => `${p}${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;

/** Default grid. 100 mm: building measurements are rarely finer, and it is
 * coarse enough to draw directly at ordinary zoom instead of stepping up. */
export const GRID_DEFAULT_MM = 100;

export function emptyDoc(): PlanDoc {
  return {
    version: 1, unit: "mm", gridMm: GRID_DEFAULT_MM, guid: newDocGuid(),
    continuations: [],
    floors: [{
      id: newId("f"), name: "Floor 1",
      nodes: [], walls: [], symbols: [], stairs: [], vides: [], structure: [], furnishings: [], routes: [], roomNames: [],
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
 * Default opening heights, mm, dagmaat (the standard NL binnendeurkozijn head
 * height). A door or open passage reaches the same head; a window's is lower
 * because it sits on a borstwering rather than the floor.
 */
export const DOOR_HEIGHT_DEFAULT = 2315;
export const PASSAGE_HEIGHT_DEFAULT = 2315;
export const WINDOW_HEIGHT_DEFAULT = 1415;
/** Default sill height, mm: the ordinary borstwering under a window. */
export const WINDOW_SILL_DEFAULT = 900;

/** An opening's sill height, mm above the floor. Only a window has one that
 *  is not the floor itself. */
export function openingSill(o: Opening): number {
  return o.kind === "window" ? o.sillHeight ?? WINDOW_SILL_DEFAULT : o.sillHeight ?? 0;
}

/** An opening's height, mm, defaulted per kind when not stated. */
export function openingHeight(o: Opening): number {
  if (o.height !== undefined) return o.height;
  return o.kind === "window" ? WINDOW_HEIGHT_DEFAULT
       : o.kind === "door" ? DOOR_HEIGHT_DEFAULT
       : PASSAGE_HEIGHT_DEFAULT;
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
