// Tool state machine + snapping + typed-mm input. Owns pointer/keyboard handling
// for the canvas; rendering of previews goes through getPreview()/getSnap().
import { Store, MULTI_SELECT_KINDS, type Selection } from "../model/store";
import { marqueePick, type MarqueeRect } from "./marquee";
import {
  Floor, Wall, Opening, PlanNode, SymbolInstance, Id, newId, stairsOf, videsOf, furnishingsOf,
  routesOf, roomNamesOf, floorHeight, DOOR_DEFAULT_WIDTH, WINDOW_DEFAULT_WIDTH, PASSAGE_DEFAULT_WIDTH,
  OpeningKind, FireRating, dimModeOf, WallMaterial,
} from "../model/doc";
import type { RoomUse } from "../model/room";
import {
  Stair, ResolvedStair, StairKind, StairParams, stairDefaults, stairFields, clampStair,
  stairAngle, inheritsRise,
} from "../model/stair";
import { Vide, VideSize, VIDE_DEFAULT, clampVide } from "../model/vide";
import {
  Furnishing, FurnishingSpec, furnishingDefaults, furnishingPreset,
  furnishingWallMounted, clampFurnishing, writeSpec,
} from "../model/furnishing";
import {
  Route, RoutePoint, RouteSegment, Discipline, RouteKind, ROUTE_VEINS_DEFAULT, clampRouteVeins,
  RouteWater, routeWater, clampRouteDiameter, defaultRouteDiameter,
  RouteVent, VENT_DIAMETER_DEFAULT, clampDuctDiameter, clampRouteFlow,
  RouteHeat, HEAT_DIAMETER_DEFAULT, routeHeat,
  RouteInstallation, routeInstallation, routeVent, routeKind,
} from "../model/route";
import {
  resolveRoutePoints, resolveRoutes, routeDistance, defaultRouteHeight, ResolvedRoute,
} from "../core/route";
import {
  routeTakesSymbol, routeTakesFurnishing, connectDevice, deviceConnects, ROUTE_LINK_MM,
} from "../core/attach";
import { riserMarks, type ResolvedRiserMark } from "../core/continuation";
import { connectionPoint, type Device } from "../core/port";
import { resolveBoards } from "../core/board";
import { serviceKeyOf } from "../model/service";
import { autoRoutePath } from "../core/autoroute";
import { legAt, insertRoutePoint } from "../core/routegraph";
import {
  nodeAt, splitWall, nearestWall, wallOnRay, wallLength, mergeNodes, deleteWall, clampOpening,
  insertWall, insertRun, deleteRoomNames, cloneOnFloor, MIN_WALL_MM, SPLIT_END_MM,
  calibrateUnderlay, unanchorRoutePoints,
  type PlacedKind,
} from "../model/ops";
import {
  WallShape, WALL_SHAPES, ShapeRun, shapeRun, clampSides, POLYGON_DEFAULT_SIDES,
} from "../model/shape";
import { Viewport } from "../render/viewport";
import { Vec, v, add, sub, scale, norm, perp, dist, distToSeg, mid, angleOf, fromAngle, dot, pointInPolygon } from "../geometry/vec";
import { arcInfo, arcPointAt, arcTangentAt, bulgeFromSagitta } from "../geometry/arc";
import { getSymbol, SymbolDef, SYMBOL_TYPES } from "../render/symbols";
import { dot as drawDot, circle as drawOpenCircle } from "../render/symbols/defs";
import { stairHit, resolveStair, stairBox, stairCorners, stairIssues, gradient } from "../core/stair";
import { drawStairGhost } from "../render/stair";
import { videHit, videCorners } from "../core/vide";
import { drawVideGhost } from "../render/vide";
import { furnishingHit, furnishingBox, furnishingCorners } from "../core/furnishing";
import { turnAbout } from "../core/placed";
import { drawFurnishingGhost } from "../render/furnishing";
import { planBounds, polyBounds, Bounds } from "../core/bounds";
import { Room, roomAnchor, orphanedRoomNames } from "../core/rooms";
import { drawLabel, COLORS, symbolInk, routeInk } from "../render/draw";
import { ROUTE_VENT_EXTRA_MM, LINE_WIDTH_MM } from "../render/route";
import { removeNode } from "../core/join";
import { removeRoutePoint } from "../core/routegraph";
import {
  LAYER_KEYS, LAYER_OF_CATEGORY, allLayersOn, type LayerFlags, type LayerKey,
} from "../render/layers";
import { Resolved, ResolvedWall } from "../core/resolve";
import { dimensionChains, DimChain } from "../core/dimensions";
import { t } from "../i18n";

export type ToolName =
  | "select" | "wall" | "door" | "window" | "passage" | "symbol" | "stair" | "vide"
  | "furnishing" | "route" | "zoom";

/** Finger travel that still counts as a tap rather than a drag. */
const TAP_SLOP_PX = 10;
/** How near a neighbour's x or y a dragged node squares onto it. */
const ALIGN_TOL_PX = 12;
/** Longest press still read as a tap. */
const TAP_MS = 500;
/** Gap between two taps that makes them one double tap. */
const DOUBLE_TAP_MS = 300;
/** Smallest share of an axis a fit will frame into, whatever the chrome covers. */
const MIN_FIT_FRACTION = 0.5;
/** How far a second convention's chains sit outside the first's overall line. */
const DIM_CHAIN_LIFT = 840;
/** How far one chain reaches past the wall it measures: line, overall, labels. */
const DIM_CHAIN_REACH = 900;
/**
 * Half-size of a room label's clickable box on screen, in px. The label is
 * drawn at a constant pixel size rather than in world mm, so it is hit-tested
 * in the same space. A named room stacks a name over the area, so it is twice
 * as tall.
 */
const ROOM_LABEL_HIT_PX = { x: 52, y: 11 };

/**
 * How close a cabinet or a wall-mounted symbol has to be before the nearest
 * wall takes it, mm, when the screen distance works out smaller. Half of a
 * thick wall, so the face is still reachable from the middle of the masonry.
 */
const WALL_SNAP_MIN_MM = 150;

/** Shortest step the route tool accepts between two waypoints, mm -- same
 *  figure the wall tool uses for the same reason (MIN_WALL_MM). */
const MIN_ROUTE_STEP_MM = MIN_WALL_MM;

/** Grab radius for a riser mark, mm. The mark itself draws at r = 78. */
const RISER_PICK_MM = 90;

export interface SnapResult { p: Vec; kind: "node" | "wall" | "grid" | "free"; wall?: Wall; tMm?: number; node?: PlanNode }

interface DragState {
  kind: "node" | "wall" | "symbol" | "stair" | "vide" | "furnishing"
      | "bow" | "opening" | "pan" | "zoomBox" | "routeVertex" | "marquee";
  id?: string;
  wallId?: string;
  /** routeVertex only: which point in the route's own array is being moved. */
  pointIndex?: number;
  startWorld: Vec;
  orig?: unknown;
  moved: boolean;
  lastScreen?: Vec;
  /** Far corner of the zoom window, world mm. */
  boxEnd?: Vec;
  /** The room whose label this press landed on, when it landed on nothing else. */
  labelRoom?: Room;
  /** Alt was held: the first movement copies what is being dragged. */
  clone?: boolean;
  /** Where the press started on screen. A pan moves the world under a fixed
   *  cursor, so startWorld cannot answer "did this travel?". */
  startScreen?: Vec;
}

/**
 * Whether a drag kind is a handle on the currently selected object -- a
 * route's waypoint or a wall's bow handle -- rather than picking the object
 * up fresh. selectDownHold() uses this to skip arming the long-press hold:
 * the object (route/wall) stays `sel`, which IS in MULTI_SELECT_KINDS, so
 * without the check a still press aiming a handle would fire the hold timer
 * mid-aim. Exported for testing as a pure predicate, without faking timers.
 */
export function isHandleDrag(kind: DragState["kind"]): boolean {
  return kind === "routeVertex" || kind === "bow";
}

/**
 * A dragged node squared against the nodes it is walled to: where the cursor
 * comes within `tol` of a neighbour's x or y, that coordinate is taken exactly
 * and the other axis keeps the position the grid gave it (`fallback`).
 *
 * The grid cannot do this. A neighbour left off-grid by an earlier free
 * placement has no grid multiple to line up with, so a corner dragged against
 * it comes out a slant however carefully it is placed -- and the way around
 * that is to redraw over the wall with a shape, which is how a plan collects
 * stubs and dangling nodes in the first place. Each axis is decided on its own,
 * so one drag can square a corner against two different neighbours at once.
 *
 * Armed by the angle-snap toggle, which is what that toggle already means for a
 * wall being drawn. Exported as a pure function so the rule can be tested
 * without a canvas and pointers.
 */
export function alignToNeighbours(f: Floor, id: Id, raw: Vec, fallback: Vec, tol: number): Vec {
  let bx = tol, by = tol;
  let x = fallback.x, y = fallback.y;
  for (const w of f.walls) {
    const other = w.a === id ? w.b : w.b === id ? w.a : null;
    if (other === null) continue;
    const n = f.nodes.find(q => q.id === other);
    if (!n) continue;
    if (Math.abs(raw.x - n.x) < bx) { bx = Math.abs(raw.x - n.x); x = n.x; }
    if (Math.abs(raw.y - n.y) < by) { by = Math.abs(raw.y - n.y); y = n.y; }
  }
  return v(x, y);
}

export class Tools {
  tool: ToolName = "select";
  symbolType = "socket-single";
  ortho = true;
  snapGrid = true;  // round placements to doc.gridMm; off = free 1 mm placement
  /** Whether the wall pane's list of this storey's walls stands open. Editor
   *  state, like the snaps: nothing about it belongs in the document. */
  wallListOpen = false;
  showDims = false; // always show wall measurements (clickable), not only on selection
  lastThickness = 100;
  /**
   * What the wall tool draws: a chain of single walls, or a closed shape struck
   * out between two points. A room is four walls either way -- the shape is only
   * how they are entered, so nothing about it is stored (see model/shape.ts).
   */
  wallShape: WallShape = "line";
  /** Rectangle only: keep it square. Shift does the same while drawing. */
  squareLock = false;
  polygonSides = POLYGON_DEFAULT_SIDES;
  /**
   * Pen for the next symbol placed; null = the plan's default ink. Same idea as
   * lastThickness: the work is "place twenty sockets in red", so the colour is a
   * standing choice rather than something to set twenty times afterwards.
   */
  symbolColor: string | null = null;

  /**
   * What the next wall is built of and drawn in, armed the same way
   * lastThickness and symbolColor are. A glazed partition is a run of walls and
   * so is a demolition, so both are a standing choice rather than something to
   * set again on every wall struck out. null = the plan's default masonry, and
   * `wallPostWidthMm` is read only while `wallPostMm` states centres to put a
   * member on.
   */
  wallColor: string | null = null;
  wallMaterial: WallMaterial | null = null;
  wallPostMm: number | null = null;
  wallPostWidthMm: number | null = null;

  /**
   * The stair the tool will place next. Unlike a symbol, a stair carries its
   * size in the document, so the tool holds a full set of parameters rather
   * than just a type — and R/M turn the ghost BEFORE it is placed, because
   * which way a flight runs is the first thing decided about it, not the last.
   */
  stairKind: StairKind = "steektrap";
  stairSize: StairParams = stairDefaults("steektrap");
  stairRotation = 0;
  stairMirrored = false;

  /**
   * Told that a room's label on the canvas was clicked, so the panel can open
   * that room's name field. Rooms are derived and unselectable, so this is a
   * callback rather than a selection.
   */
  onRoomLabel: ((room: Room) => void) | null = null;

  /** The opening the vide tool will place next. */
  videSize: VideSize = { ...VIDE_DEFAULT };
  videRotation = 0;

  /**
   * What the route tool draws with next -- sticky like lastThickness, since
   * a plan is drawn discipline by discipline rather than one run at a time.
   */
  routeDiscipline: Discipline = "electrical";
  /**
   * Electrical-only fields for the next route -- sticky like routeDiscipline,
   * since a plan is wired groep by groep and kind by kind, not one run at a
   * time. Kept armed even while routeDiscipline is something else, so
   * switching back to electrical remembers the last choice.
   */
  routeKind: RouteKind = "power";
  routeVeins: number = ROUTE_VEINS_DEFAULT;
  routeGroup = "";
  routeSpec = "";
  /**
   * Water-only fields for the next route -- sticky like routeDiscipline, the
   * same way the electrical fields above are. Kept armed even while
   * routeDiscipline is something else, so switching back to water remembers
   * the last choice.
   */
  routeWater: RouteWater = "koud";
  routeDiameter: number = defaultRouteDiameter("koud");
  routeGasDiameter = 15;
  /**
   * Vent-only fields for the next route -- sticky like routeDiscipline, the
   * same way the electrical and water fields above are. `routeFlow` is the
   * one exception among every sticky route field: it stays `undefined` by
   * default and armed rather than reset after each run, because a flow
   * figure is specific to the one run it was designed for, not a plan-wide
   * choice the way a groep or a diameter is -- but once a person has typed
   * one, the next run is very often at the same figure (a row of identical
   * grilles), so it stays armed until changed rather than clearing itself.
   */
  /** Heating-only fields for the next run -- sticky like routeDiscipline. */
  routeHeat: RouteHeat = "aanvoer";
  routeHeatDiameter: number = HEAT_DIAMETER_DEFAULT;
  routeVent: RouteVent = "toevoer";
  routeDuctDiameter: number = VENT_DIAMETER_DEFAULT;
  routeFlow: number | undefined = undefined;
  routeInstallation: RouteInstallation = "concealed";
  routeHeight = 0;
  /**
   * Propose each leg along the walls instead of drawing it straight (issue
   * #29). An input convenience only: what lands in the document is an ordinary
   * Route whose waypoints can be dragged, added to or deleted afterwards, and
   * nothing remembers it was proposed. A leg with no path along the fabric --
   * either end too far from a wall, or nothing connecting them -- falls back to
   * the straight line the click asked for rather than refusing the click.
   */
  routeAuto = false;
  /** Stand-off from the wall centerline for a proposed leg, mm. */
  routeOffset = 0;
  /**
   * Mark every device whose declared services are not all connected, so a
   * socket nobody wired is visible rather than merely absent from a schedule
   * (see core/port.ts).
   *
   * Editor state, not a drawing convention: a pulse is a thing to notice while
   * working, and it has no meaning on paper -- so unlike `mountMarks` it lives
   * here and never reaches an export. Off by default, since a plattegrond
   * drawn before its services would otherwise light up entirely.
   */
  requireComplete = false;
  routeTag = "";
  routeName = "";
  routeBoard = "";
  /**
   * Per-discipline visibility. Editor state, like snapGrid -- not persisted,
   * no document impact, and no bearing on SVG/DXF exports (those draw every
   * discipline; see io/svg.ts and io/dxf.ts). All true by default: a floor
   * with routes on it opens showing them.
   */
  /**
   * Which layers the canvas draws. Off hides a layer outright; see
   * dimLayers() for the softer version the armed tool applies by itself.
   */
  layers: LayerFlags = allLayersOn();
  /** World point the in-progress route chain last placed a point at, or null
   *  when no chain is open. */
  private routeStart: Vec | null = null;
  /** Waypoints placed so far in the open chain; committed as one Route only
   *  when the chain ends (Esc, double-click, or the touch "Done" button) --
   *  see commitRoute(). Unlike the wall tool, nothing reaches the document
   *  until then, which is what makes the whole run one undo step. */
  private routePoints: RoutePoint[] = [];
  /** Existing network being extended from one of its points. */
  private routeTargetId: Id | null = null;
  private routeSplit: { routeId: Id; segmentId: Id; point: RoutePoint } | null = null;
  /** The route tool's own snap: symbols and wall-hugging on top of what
   *  computeSnap already does. Recomputed on every move; see computeRouteSnap. */
  private routeSnap: {
    p: Vec; anchor?: Id; wallId?: Id; wallT?: number; wallSide?: 1 | -1;
    routeId?: Id; routePointId?: Id;
    routeSegmentId?: Id;
  } | null = null;

  /**
   * The furnishing the tool will place next, and the named preset it came from.
   * Like a stair, a furnishing carries its size in the document, so the tool
   * holds a full specification rather than a type.
   */
  furnishingSpec: FurnishingSpec = furnishingDefaults("cabinet");
  furnishingPresetId = "onderkast";
  furnishingRotation = 0;
  furnishingMirrored = false;

  /**
   * What the next opening is placed at. Openings used to be placed at one fixed
   * width and edited afterwards, one at a time — walls have had lastThickness
   * for exactly this reason, and a run of eight identical doors is the same
   * job. A door also carries the properties that are decided once for a whole
   * plan rather than per leaf: which way it hangs, and its fire rating.
   */
  openingWidth: Record<OpeningKind, number> = {
    door: DOOR_DEFAULT_WIDTH,
    window: WINDOW_DEFAULT_WIDTH,
    passage: PASSAGE_DEFAULT_WIDTH,
  };
  doorHinge: "a" | "b" = "a";
  doorOutward = false;
  doorSelfClosing = false;
  doorFire: FireRating | null = null;

  private chainStart: Vec | null = null;
  private chainStartNode: string | null = null;
  /** Where the open chain began, so it can be closed back onto itself. */
  private chainFirstNode: string | null = null;
  /** First point of the shape being drawn; no document change until the second. */
  private shapeStart: Vec | null = null;
  /**
   * Whether a cabinet or a wall-mounted symbol takes hold of the nearest wall
   * face while it is placed or dragged. Editor state, like the grid snap, and
   * off means a free position to the millimetre.
   */
  snapWall = true;
  /**
   * Whether the active floor's trace-over image is drawn. Editor state, like
   * snapGrid — not persisted, no document impact. An export excludes the
   * underlay unconditionally regardless of this flag (see DrawExtras.showUnderlay).
   */
  showUnderlay = true;
  /**
   * Whether the 3D extrusion view covers the canvas. Editor state, like
   * snapGrid — a sheet has no 3D mode and no export reads it. While on, the
   * 3D canvas sits over the 2D one and takes the pointer; onKey() passes only
   * the keys that leave or reframe the view (see the view3d guard there).
   */
  view3d = false;
  /**
   * Storeys the 3D view leaves out, by floor id. Editor state, like the layer
   * toggles; an id left behind by a deleted floor matches nothing and is
   * harmless.
   */
  readonly view3dHidden = new Set<string>();
  /** Host hooks for the 3D view: show/hide it, reframe it on F, and redraw
   *  it when the scene selection above changes. */
  onView3d: ((on: boolean) => void) | null = null;
  onView3dFit: (() => void) | null = null;
  onView3dScene: (() => void) | null = null;
  /** Shift, as the last pointer or key event reported it. */
  private shiftKey = false;
  /** Alt at the last press: a drag that starts under it copies rather than moves. */
  private altKey = false;
  /** Cmd on a Mac, Ctrl elsewhere. Accepted either way: the OS menu a Mac's
   *  Ctrl-click would raise is already suppressed (see the contextmenu
   *  listener), so both reach the canvas as an ordinary press. */
  private modKey = false;
  private cursor: Vec = v(0, 0);
  lengthBuffer = "";
  private drag: DragState | null = null;
  private hoverSymbol: string | null = null;
  private hoverStair: string | null = null;
  private snap: SnapResult | null = null;
  private dimRects: Array<{ x: number; y: number; w: number; h: number; wallId: string }> = [];
  private dimInput: HTMLInputElement | null = null;
  hint = "";

  /**
   * Scale-calibration capture, armed from the Underlay panel section. NOT a
   * rail tool: it captures on top of whichever tool is active (see onDown/
   * onMove/onTap/onKey, each of which checks `calibArmed` before anything
   * tool-specific) and hands control straight back once it commits or is
   * cancelled — the point of calibrating is to keep tracing with the tool you
   * were already using. `calibP0`/`calibP1` are world mm, captured through the
   * same snap the active tool already computes. Once both are down,
   * `lengthBuffer` (shared with the wall tool's typed length, so the keypad
   * and Enter work unchanged) holds the typed real-world distance.
   */
  private calibArmed = false;
  private calibP0: Vec | null = null;
  private calibP1: Vec | null = null;

  /**
   * How much of the canvas the chrome covers, in CSS px, or null when it covers
   * none of it. Zero in the sidebar layout, where the panel is beside the
   * canvas; in the compact layout the chrome floats over a full-bleed canvas,
   * and a fit that ignored it would centre the plan behind the sheet. Set by
   * the host, which is what decides the layout.
   */
  viewInsets: (() => { top: number; right: number; bottom: number; left: number }) | null = null;

  /** Live pointers on the canvas. Two of them navigate instead of drawing. */
  private pointers = new Map<number, Vec>();
  /** Separation and midpoint of the two fingers at the previous move. */
  private pinch: { dist: number; mid: Vec } | null = null;
  /** Where a single touch went down, so a tap can be told from a drag. */
  private tapStart: { screen: Vec; time: number } | null = null;
  /** Where the first pointer went down, whatever device it was. */
  private pressScreen: Vec | null = null;
  /** True from the moment a second finger lands until the last one lifts. */
  private navigated = false;
  private lastTapTime = 0;
  /** Whether the previous tap selected nothing; both halves of a double tap must. */
  private lastTapOnNothing = false;
  /** Which device produced the most recent pointer event. */
  private lastPointerType = "mouse";
  /**
   * True when the editor is laid out for touch. Set by the host, which is what
   * decides the layout; it selects the gesture wording for every hint rather
   * than the click-and-key wording.
   */
  touchUi = false;

  /**
   * The iOS-style "edit mode" a touch/pen long-press (see selectDownHold()
   * below) drops the select tool into: a plain tap toggles
   * an object's membership through selectAlso() instead of replacing it, and a
   * tap on empty paper is a no-op rather than a deselect -- so a many-item
   * gather is never lost to a stray tap. Editor state, never the document;
   * setTool()/cancel() and a floor switch (see Panel's storey controls) all
   * exit it, same as any other armed gesture.
   */
  selectMode = false;
  /** Screen point of a press that might still become a long-press hold; null
   *  once the hold is no longer live (fired, cancelled, or released). */
  private longPressFrom: Vec | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * What the hold would toggle, and the selection to toggle it against.
   * selectDown() below always runs its ordinary replace-and-maybe-drag first
   * -- that is what makes a plain tap/click and a tap/click-then-drag work
   * completely unchanged -- so the selection from BEFORE that replace is
   * snapshotted here. Firing hands both to selectAlso(), which reproduces a
   * real shift-click instead of toggling the object against itself.
   */
  private longPressTarget: Selection | null = null;
  private longPressBase: { sel: Selection | null; selMore: string[] } | null = null;

  constructor(
    private store: Store,
    private vp: Viewport,
    private canvas: HTMLCanvasElement,
    private requestRender: () => void,
    private getResolved: () => Resolved,
    private onToolChange: () => void,
    private getRooms: () => Room[],
  ) {
    canvas.addEventListener("pointerdown", e => this.onDown(e));
    canvas.addEventListener("pointermove", e => this.onMove(e));
    canvas.addEventListener("pointerup", e => this.onUp(e));
    canvas.addEventListener("pointercancel", e => this.onCancelPointer(e));
    canvas.addEventListener("wheel", e => this.onWheel(e), { passive: false });
    // Double-click ends a route chain, the mouse-side twin of the touch
    // "Done" button -- both go through commitRoute() (see endChain()).
    canvas.addEventListener("dblclick", e => {
      // With the select tool, a double-click on a run adds a waypoint there --
      // the same thing a double-tap does with a finger, so the gesture is one
      // thing to learn rather than one per input device.
      if (this.tool === "select") {
        // screenOf takes the pointer/wheel events the rest of the input path
        // deals in; a dblclick is a plain MouseEvent, so the cursor the moves
        // before it already left is what says where it landed.
        if (this.addRouteNodeAt(this.cursor)) {
          e.preventDefault();
          this.updateHint();
        }
        return;
      }
      if (this.tool !== "route" || !this.routeStart) return;
      e.preventDefault();
      this.commitRoute();
      this.updateHint();
      this.onToolChange();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverSymbol = null; this.hoverStair = null; this.requestRender();
    });
    // A long press raises this on touch, where it means nothing: the gesture is
    // already the tool's, and cancelling a wall chain by resting a finger would
    // be a trap. Suppressed either way so the OS menu never covers the plan.
    canvas.addEventListener("contextmenu", e => {
      e.preventDefault();
      // A Mac's Ctrl-click raises this on the same press that just added a
      // waypoint and took hold of it; cancelling there would throw the point
      // away between creating it and placing it.
      if (this.lastPointerType === "mouse" && !this.drag) this.cancel();
    });
    window.addEventListener("keydown", e => this.onKey(e));
    // Shift squares off the rectangle being struck out and locks the angle of
    // the wall being chained, so letting go of it has to reach the ghost as
    // well as the commit.
    window.addEventListener("keyup", e => {
      if (e.key !== "Shift") return;
      this.shiftKey = false;
      this.shiftChanged();
    });
    // An empty selection ends the mode, wherever the emptying came from: a
    // press on empty paper (selectDown's last branch, the canvas's own way
    // out of the mode), or undo()/redo()/replace() clearing it directly --
    // e.g. undoing back past the object that was being bulk-edited. Noticing
    // it in one place is also what keeps the compact layout's "Done (n)" pill
    // and the canvas badge from lingering over nothing.
    store.onChange(() => {
      if (this.selectMode && !this.store.sel) this.exitSelectMode();
    });
  }

  setTool(t: ToolName, symbolType?: string): void {
    this.tool = t;
    if (t === "route" && this.store.sel?.kind === "route") {
      const route = routesOf(this.floor).find(r => r.id === this.store.sel!.id);
      if (route) this.routeDiscipline = route.discipline;
    }
    if (symbolType) this.symbolType = symbolType;
    // Armed with nothing would be a broken symbol tool: fall back to the first
    // palette entry if a type was never chosen.
    else if (t === "symbol" && !this.symbolType) this.symbolType = SYMBOL_TYPES[0] ?? "";
    this.cancel(false);
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /**
   * Arm a stair kind with the dimensions that kind ordinarily has. The rise
   * comes from the storey rather than the kind, since that is what a stair on
   * this floor climbs; a ramp keeps its own, which is not a storey height.
   */
  setStairKind(kind: StairKind, storeyHeight?: number): void {
    this.stairKind = kind;
    const d = stairDefaults(kind);
    this.stairSize = storeyHeight !== undefined && inheritsRise(kind)
      ? { ...d, rise: storeyHeight } : d;
    this.setTool("stair");
  }

  setStairSize(p: StairParams): void {
    this.stairSize = clampStair(p);
    this.onToolChange();
    this.requestRender();
  }

  /**
   * Follow a new storey height. The armed stair holds a concrete rise so the
   * ghost can be drawn, so it has to be told when the storey it will stand in
   * changes; without this the next stair placed would store the old height as a
   * deliberate override.
   */
  followStoreyHeight(mm: number): void {
    if (!inheritsRise(this.stairKind)) return;
    this.stairSize = clampStair({ ...this.stairSize, rise: mm });
    this.onToolChange();
    this.requestRender();
  }

  setVideSize(s: VideSize): void {
    this.videSize = clampVide(s);
    this.onToolChange();
    this.requestRender();
  }

  /**
   * The layers the armed tool cannot act on, faded rather than hidden so the
   * work keeps its context. Drawing walls with every socket, duct and radiator
   * at full ink is reading four drawings to edit one; a services run, on the
   * other hand, is set out against the fit-out, so that stays.
   *
   * The fabric itself is never dimmed -- it is what everything else is placed
   * against, which is why it has no layer key (see render/layers.ts).
   */
  dimLayers(): LayerKey[] {
    const services = LAYER_KEYS.filter(k => k !== "furnishing" && k !== "safety");
    switch (this.tool) {
      case "wall": case "door": case "window": case "passage": case "stair": case "vide":
        return [...LAYER_KEYS];
      case "furnishing":
        return services;
      case "route":
        return LAYER_KEYS.filter(k => k !== this.routeDiscipline && k !== "furnishing");
      case "symbol": {
        const cat = getSymbol(this.symbolType)?.category;
        if (!cat) return [];
        const key = LAYER_OF_CATEGORY[cat];
        // Safety equipment is placed with the fit-out, so it fades the same
        // things the fit-out tool does.
        if (key === "safety") return services;
        return LAYER_KEYS.filter(k => k !== key && k !== "furnishing");
      }
      default:
        return [];
    }
  }

  /** Arm a named piece: an onderkast, een bad, een tweepersoonsbed. */
  setFurnishingPreset(id: string): void {
    const p = furnishingPreset(id);
    if (!p) return;
    this.furnishingPresetId = id;
    const { id: _dropId, group: _dropGroup, ...spec } = p;
    this.furnishingSpec = spec;
    this.setTool("furnishing");
  }

  /** Tune the armed piece. The preset id follows what the fields now say. */
  setFurnishingSpec(spec: FurnishingSpec): void {
    this.furnishingSpec = clampFurnishing(spec);
    this.onToolChange();
    this.requestRender();
  }

  setFurnishingRotation(radians: number): void {
    this.furnishingRotation = stairAngle(radians);
    this.onToolChange();
    this.requestRender();
  }

  /**
   * Redraw the pane and the canvas after a standing choice changed. The tool
   * state is public and edited in place by the panes, so this is how they say
   * so — the store has not changed, and nothing here is undoable.
   */
  refresh(): void {
    this.onToolChange();
    this.requestRender();
  }

  setVideRotation(radians: number): void {
    this.videRotation = stairAngle(radians);
    this.onToolChange();
    this.requestRender();
  }

  /** Any angle, where R gives quarter turns. Both arm the same ghost. */
  setStairRotation(radians: number): void {
    this.stairRotation = stairAngle(radians);
    this.onToolChange();
    this.requestRender();
  }

  /** Arm a pen. Redraws so the placement ghost shows the colour it will land in. */
  setSymbolColor(hex: string | null): void {
    this.symbolColor = hex;
    this.onToolChange();
    this.requestRender();
  }

  /**
   * Stamp the armed pen onto walls that were just struck out.
   *
   * insertWall/insertRun return only the walls they CREATED — an existing wall
   * that was split to weld the new one into it stays in `f.walls` and never
   * appears here — so this cannot recolour work that was already on the plan.
   */
  private armWalls(made: Wall[]): void {
    for (const w of made) {
      if (this.wallColor) w.color = this.wallColor;
      if (this.wallMaterial) w.material = this.wallMaterial;
      if (this.wallPostMm) w.postMm = this.wallPostMm;
      if (this.wallPostMm && this.wallPostWidthMm) w.postWidthMm = this.wallPostWidthMm;
    }
  }

  /** Arm the wall pen. Redraws so the draft wall shows what it will land as. */
  setWallPen(
    patch: Partial<Pick<Tools, "wallColor" | "wallMaterial" | "wallPostMm" | "wallPostWidthMm">>,
  ): void {
    Object.assign(this, patch);
    // A profile with nothing to be a profile OF is not a state to arm: the
    // width goes with the centres rather than waiting for them to come back.
    if (this.wallPostMm === null) this.wallPostWidthMm = null;
    this.onToolChange();
    this.requestRender();
  }

  /**
   * Arm one of the wall shapes. W cycles through them, which is why the order
   * in WALL_SHAPES is the order they are offered in.
   */
  setWallShape(shape: WallShape): void {
    this.wallShape = shape;
    this.cancel(false);
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  cycleWallShape(): void {
    const i = WALL_SHAPES.indexOf(this.wallShape);
    this.setWallShape(WALL_SHAPES[(i + 1) % WALL_SHAPES.length]!);
  }

  setPolygonSides(n: number): void {
    this.polygonSides = clampSides(n);
    this.refresh();
  }

  cancel(render = true): void {
    this.chainStart = null;
    this.chainStartNode = null;
    this.chainFirstNode = null;
    this.shapeStart = null;
    this.routeStart = null;
    this.routePoints = [];
    this.routeTargetId = null;
    this.routeSplit = null;
    this.routeTag = "";
    this.routeName = "";
    this.lengthBuffer = "";
    this.drag = null;
    this.calibArmed = false;
    this.calibP0 = null;
    this.calibP1 = null;
    // setTool() runs this on every switch, and Escape runs it directly -- both
    // are named exits from selectMode (see the field comment).
    this.selectMode = false;
    this.cancelLongPress();
    if (render) this.requestRender();
  }

  /** True while a scale-calibration capture is armed, at any of its stages. */
  get calibrating(): boolean { return this.calibArmed; }

  /** True once both calibration points are down and a distance is being typed. */
  private get calibratingDistance(): boolean { return this.calibArmed && this.calibP1 !== null; }

  /**
   * Arm scale calibration from the panel: the next two clicks/taps on the
   * canvas mark a known distance, then the real length is typed. See the
   * `calibArmed` field comment for what this is and is not.
   */
  startCalibration(): void {
    if (!this.floor.underlay) return;
    this.calibArmed = true;
    this.calibP0 = null;
    this.calibP1 = null;
    this.lengthBuffer = "";
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /** Cancel an armed calibration capture: Esc, or the panel's own control. */
  cancelCalibration(): void {
    this.cancel();
    this.updateHint();
    this.onToolChange();
  }

  /**
   * One of calibration's two points landing — from the mouse path in onDown,
   * or from a tap via onTap. Uses whatever the active tool's own snap already
   * computed, so calibrating against a wall's known length snaps exactly the
   * way placing a door on that wall would.
   */
  private calibClick(): void {
    const snap = this.snap ?? this.computeSnap(this.cursor, false);
    if (!this.calibP0) {
      this.calibP0 = snap.p;
    } else if (!this.calibP1) {
      if (dist(snap.p, this.calibP0) < 1) return; // degenerate: the same point twice
      this.calibP1 = snap.p;
    }
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /**
   * Commit the typed real-world distance: rescale the underlay so the two
   * marked points read as that distance, keeping the first one fixed on
   * screen. The actual arithmetic is calibrateUnderlay() in model/ops.ts —
   * pure and unit-tested there, since Tools itself needs a live canvas to
   * construct.
   */
  private applyCalibration(): void {
    const p0 = this.calibP0, p1 = this.calibP1;
    const mm = parseFloat(this.lengthBuffer);
    this.calibArmed = false;
    this.calibP0 = null;
    this.calibP1 = null;
    this.lengthBuffer = "";
    if (p0 && p1) {
      this.store.mutate(doc => {
        const f = this.store.floorOf(doc);
        if (!f.underlay) return;
        const next = calibrateUnderlay(f.underlay, p0, p1, mm);
        if (next) f.underlay = next;
      });
    }
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /** True while a wall or route chain is open, so the host can offer a way
   *  to end it (touch has no Esc, and route chaining has no ring to close). */
  get chaining(): boolean { return this.chainStart !== null || this.routeStart !== null; }

  /** True while a shape has its first point down and is waiting for the second. */
  get shaping(): boolean { return this.shapeStart !== null; }

  /**
   * True when the chain has somewhere to close back to. Two points make a line,
   * not a ring, so the first wall of a chain cannot close it.
   */
  get canCloseChain(): boolean {
    return this.chainFirstNode !== null && this.chainStartNode !== null
        && this.chainFirstNode !== this.chainStartNode;
  }

  /**
   * Run a last wall from where the chain stands back to where it began, and end
   * it. Four clicks then draw a room rather than five, and the ring closes on
   * the node it started from rather than on a second node in the same place.
   */
  closeChain(): void {
    if (!this.canCloseChain) return;
    const from = this.chainStartNode!, to = this.chainFirstNode!;
    this.store.mutate(doc => {
      this.armWalls(insertWall(this.store.floorOf(doc), from, to, this.lastThickness));
    });
    this.endChain();
  }

  /**
   * True when a typed length would be acted on: a chain waiting for its next
   * point, or a selected wall waiting to be resized. These are the two states
   * the keyboard accepts digits in, and so the two the millimetre keypad
   * appears for.
   */
  get typingLength(): boolean {
    return this.calibratingDistance
        || (this.tool === "wall" && this.chainStart !== null)
        || (this.tool === "route" && this.routeStart !== null)
        || (this.tool === "select" && this.store.sel?.kind === "wall");
  }

  /**
   * Append one character to the typed length. Digits and the decimal point,
   * matching what the keyboard accepts; the keypad offers digits only, since
   * the document stores integer millimetres.
   */
  typeLength(ch: string): void {
    if (!this.typingLength || !/^[0-9.]$/.test(ch)) return;
    this.lengthBuffer += ch;
    this.afterTyping();
  }

  backspaceLength(): void {
    if (!this.lengthBuffer) return;
    this.lengthBuffer = this.lengthBuffer.slice(0, -1);
    this.afterTyping();
  }

  clearLength(): void {
    if (!this.lengthBuffer) return;
    this.lengthBuffer = "";
    this.afterTyping();
  }

  /** Act on the typed length: commit a calibration, place the next chain
   *  point, or resize the wall. */
  commitLength(): void {
    if (!this.lengthBuffer) return;
    if (this.calibratingDistance) { this.applyCalibration(); return; }
    if (this.tool === "wall" && this.chainStart) { this.wallClick(); return; }
    if (this.tool === "route" && this.routeStart) { this.routeClick(); return; }
    if (this.tool === "select" && this.store.sel?.kind === "wall") this.applyTypedLength();
  }

  private afterTyping(): void {
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /**
   * End an open chain. For a wall this abandons the pending point (every
   * wall already clicked is already in the document); for a route -- which
   * commits nothing until the chain ends -- this is what actually WRITES the
   * route, so it and Escape/double-click all go through commitRoute().
   */
  endChain(): void {
    if (this.tool === "route" && this.routeStart) {
      this.commitRoute();
      this.updateHint();
      this.onToolChange();
      return;
    }
    this.cancel();
    this.updateHint();
    this.onToolChange();
  }

  /**
   * Where to draw the magnified inset, or null when it would not help. At wall
   * scale a fingertip covers the point being placed, so a touch that is placing
   * or dragging gets the geometry under it shown beside the finger. A mouse has
   * a one-pixel hotspot and needs none.
   */
  loupeAt(): Vec | null {
    if (this.lastPointerType === "mouse" || this.navigated) return null;
    if (this.pointers.size !== 1) return null;
    if (this.tool === "select" && !this.drag) return null;
    return [...this.pointers.values()][0] ?? null;
  }

  private screenOf(e: PointerEvent | WheelEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return v(e.clientX - r.left, e.clientY - r.top);
  }

  private get floor(): Floor { return this.store.floor; }

  /** Quantisation step for placement: the document grid, or 1 mm when grid
   * snapping is off (coordinates stay integer mm either way). */
  private get gridStep(): number { return this.snapGrid ? this.store.doc.gridMm : 1; }

  // ---- snapping ----
  /**
   * `dragNode` is the node currently being dragged, when one is. It and the
   * walls it carries are left out of every target below: they sit wherever the
   * last move put them, so a node that snapped to itself would hold the drag
   * inside its own snap radius and move only in jumps -- and could never reach
   * another node to weld onto, since the two compete for the same radius and
   * the array order decides.
   */
  private computeSnap(raw: Vec, forWall: boolean, dragNode?: Id): SnapResult {
    const f = this.floor;
    // The walls a dragged node carries move with it, so they are no more a
    // target than the node itself.
    const sf = dragNode === undefined ? f
      : { ...f, walls: f.walls.filter(w => w.a !== dragNode && w.b !== dragNode) };
    const tolNode = 12 / this.vp.pxPerMm;
    // Drawing a wall, landing on one is the usual aim, so it is as sticky as a
    // node. Placing a symbol or an opening it stays tighter: there the wall
    // under the cursor decides what the thing is mounted on.
    const tolWall = (forWall ? 12 : 9) / this.vp.pxPerMm;
    let p = raw;

    // Ortho constraint first when chaining a wall (direction), then snap along it.
    // Shift locks it for as long as it is held, so the angle can be held to
    // the eighth it is already near without leaving the gesture to press O.
    let orthoDir: Vec | null = null;
    if (forWall && this.chainStart && (this.ortho || this.shiftKey)) {
      const d = sub(raw, this.chainStart);
      const ang = Math.round(angleOf(d) / (Math.PI / 4)) * (Math.PI / 4);
      orthoDir = fromAngle(ang);
      p = add(this.chainStart, scale(orthoDir, dot(d, orthoDir)));
    }

    // Node snap (on the constrained point OR raw — prefer raw so nodes win).
    for (const n of f.nodes) {
      if (n.id === dragNode) continue;
      if (dist(v(n.x, n.y), raw) <= tolNode) return { p: v(n.x, n.y), kind: "node", node: n };
    }
    // Under the angle lock the point that matters is where the locked ray meets
    // a wall: the drawer is aiming at that wall, and a grid point short of it
    // leaves an end hanging in the room.
    if (orthoDir && this.chainStart) {
      const ray = wallOnRay(sf, this.chainStart, orthoDir, p, tolWall);
      if (ray) return { p: ray.p, kind: "wall", wall: ray.wall, tMm: ray.tMm };
    }

    // Wall snap.
    const nw = nearestWall(sf, p, tolWall);
    if (nw) {
      const a = f.nodes.find(n => n.id === nw.wall.a)!;
      const b = f.nodes.find(n => n.id === nw.wall.b)!;
      const L = wallLength(f, nw.wall);
      const pos = arcPointAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, Math.max(0, Math.min(1, nw.tMm / L)));
      return { p: pos, kind: "wall", wall: nw.wall, tMm: nw.tMm };
    }
    // Grid snap (optional; off still lands on whole mm, per the doc invariant).
    const g = this.gridStep;
    const kind = this.snapGrid ? "grid" : "free";
    if (orthoDir) {
      // snap length along the ortho direction to grid
      const l = Math.round(dist(p, this.chainStart!) / g) * g;
      return { p: add(this.chainStart!, scale(orthoDir, l)), kind };
    }
    const gp = v(Math.round(p.x / g) * g, Math.round(p.y / g) * g);
    if (dragNode !== undefined && (this.ortho || this.shiftKey)) {
      return { p: alignToNeighbours(f, dragNode, raw, gp, ALIGN_TOL_PX / this.vp.pxPerMm), kind };
    }
    return { p: gp, kind };
  }


  getSnap(): Vec | null { return this.snap?.p ?? this.routeSnap?.p ?? null; }

  /**
   * World-mm point at the centre of the visible canvas — where a freshly
   * imported underlay should land (io/underlay.ts's initialUnderlay), and
   * generally "the middle of what the visitor is looking at".
   */
  viewportCenterWorld(): Vec {
    const { w, h } = this.canvasSize();
    return this.vp.toWorld(v(w / 2, h / 2));
  }

  /**
   * Shift went down or came up without the pointer moving. A shape only needs
   * redrawing, but a chained wall's constraint is applied in computeSnap, so
   * the snap has to be taken again from where the cursor already is.
   */
  private shiftChanged(): void {
    if (this.tool === "wall" && this.chainStart) this.snap = this.computeSnap(this.cursor, true);
    else if (!this.shapeStart) return;
    this.requestRender();
  }

  // ---- zoom ----
  /**
   * Canvas size in CSS pixels — what a fit has to frame into.
   *
   * Measured on the canvas's PARENT, not the canvas. The canvas carries no CSS
   * size until the first render sets one, so a fit at mount time — which is
   * every plan's opening view — would divide a plan into a zero-width box and
   * frame it into the corner. The parent is laid out by then.
   */
  private canvasSize(): { w: number; h: number } {
    const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  private applyFit(b: Bounds | null): boolean {
    if (!b) return false;
    const { w, h } = this.canvasSize();
    // The compact layout floats its chrome over a full-bleed canvas, so a fit
    // frames into what is left uncovered and then shifts by the top-left
    // margin: fitBox centres in the box it is handed, and that box is the
    // visible part rather than the whole canvas. Without this every zoom --
    // zoom-all, a room, the zoom window -- lands half behind the sheet.
    const pad = this.viewInsets?.() ?? null;
    if (!pad) {
      this.vp.fitBox(w, h, b.min, b.max);
    } else {
      // Never give back more than half of an axis. A sheet at its tallest
      // detent covers most of the canvas, and fitting into the ~50 px it leaves
      // would shrink the plan to a hairline; better to frame it into half the
      // canvas and let the sheet overlap the bottom of it.
      const boxW = Math.max(w * MIN_FIT_FRACTION, w - pad.left - pad.right);
      const boxH = Math.max(h * MIN_FIT_FRACTION, h - pad.top - pad.bottom);
      this.vp.fitBox(boxW, boxH, b.min, b.max);
      // Clamped, the box no longer starts at the inset, so keep it on screen.
      this.vp.panPx(Math.min(pad.left, w - boxW), Math.min(pad.top, h - boxH));
    }
    this.requestRender();
    return true;
  }

  /** Everything on this storey in view. The zoom-all a plan is read from. */
  fitAll(): boolean {
    const b = planBounds(this.floor, this.getResolved());
    if (!b) return false;
    // The chains are drawn outside the walls they measure, and two conventions
    // stack. Zoom-all is the view a plan is read from, so it frames what is
    // drawn rather than cropping the numbers off it. Nothing else grows: the
    // other fits frame something the user picked out, not the whole sheet.
    const reach = this.showDims
      ? DIM_CHAIN_REACH + (dimModeOf(this.store.doc) === "both" ? DIM_CHAIN_LIFT : 0)
      : 0;
    return this.applyFit(reach === 0 ? b : {
      min: v(b.min.x - reach, b.min.y - reach),
      max: v(b.max.x + reach, b.max.y + reach),
    });
  }

  /** Frame the selection. Falls back to the whole plan when nothing is selected. */
  fitSelection(): boolean {
    return this.applyFit(this.selectionBounds()) || this.fitAll();
  }

  /** Frame one detected room — a zone in the zoom pane, or a click on a room. */
  fitRoom(room: Room): boolean {
    return this.applyFit(polyBounds(room.poly));
  }

  /** Frame an arbitrary world box: what the zoom window drags out. */
  fitWorldBox(a: Vec, b: Vec): boolean {
    return this.applyFit({
      min: v(Math.min(a.x, b.x), Math.min(a.y, b.y)),
      max: v(Math.max(a.x, b.x), Math.max(a.y, b.y)),
    });
  }

  /** The rooms of the active storey, as the zoom pane lists them. */
  rooms(): Room[] { return this.getRooms(); }

  /** The detected room containing `w`, matched on the net boundary. */
  roomAt(w: Vec): Room | undefined {
    return this.getRooms().find(r => pointInPolygon(w, r.netPoly));
  }

  /**
   * World bounds of whatever is selected. Openings and nodes are points rather
   * than areas, so they frame the wall they belong to instead of a box of
   * nothing — zooming to a door means seeing the door in its wall.
   */
  private selectionBounds(): Bounds | null {
    const sel = this.store.sel;
    if (!sel) return null;
    const f = this.floor;
    if (sel.kind === "furnishing") {
      const group = this.store.selectedOf("furnishing");
      const pts = furnishingsOf(f).filter(c => group.includes(c.id)).flatMap(furnishingCorners);
      return pts.length > 0 ? polyBounds(pts) : null;
    }
    if (sel.kind === "stair") {
      const st = stairsOf(f).find(x => x.id === sel.id);
      return st ? polyBounds(stairCorners(resolveStair(f, st))) : null;
    }
    if (sel.kind === "vide") {
      const vd = videsOf(f).find(x => x.id === sel.id);
      return vd ? polyBounds(videCorners(vd)) : null;
    }
    if (sel.kind === "route") {
      const route = routesOf(f).find(x => x.id === sel.id);
      return route ? polyBounds(resolveRoutePoints(f, route)) : null;
    }
    if (sel.kind === "symbol") {
      const sym = f.symbols.find(x => x.id === sel.id);
      const def = sym && getSymbol(sym.type);
      if (!sym || !def) return null;
      const y0 = def.wallMounted ? 0 : -def.depth / 2;
      const pts: Vec[] = [];
      for (const lx of [-def.width / 2, def.width / 2])
        for (const ly of [y0, y0 + def.depth])
          pts.push(add(v(sym.x, sym.y), fromAngleRot(v(lx, ly), sym.rotation)));
      return polyBounds(pts);
    }
    const wallId = sel.kind === "wall" ? sel.id
      : sel.kind === "opening" ? (sel.wallId ?? f.walls.find(x => x.openings.some(o => o.id === sel.id))?.id)
      : undefined;
    if (wallId) {
      const rw = this.getResolved().walls.get(wallId);
      return rw ? polyBounds(rw.outline) : null;
    }
    if (sel.kind === "node") {
      const n = f.nodes.find(x => x.id === sel.id);
      return n ? polyBounds([v(n.x, n.y)]) : null;
    }
    return null;
  }

  /** Derived geometry for one wall; undefined for a degenerate (zero-length) wall. */
  resolvedWall(id: string): ResolvedWall | undefined {
    return this.getResolved().walls.get(id);
  }

  /** The whole storey's derived wall geometry, cached against the revision by
   *  the caller that supplied it (see derived() in main.ts). */
  resolvedFloor(): Resolved {
    return this.getResolved();
  }

  // ---- pointer handlers ----
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const s = this.screenOf(e);
    this.vp.zoomAt(s, Math.exp(-e.deltaY * 0.0015));
    this.requestRender();
  }

  /** Separation and midpoint of the first two live pointers. */
  private pinchState(): { dist: number; mid: Vec } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return { dist: dist(a, b), mid: v((a.x + b.x) / 2, (a.y + b.y) / 2) };
  }

  /**
   * Two-finger navigation: pan by the midpoint's travel and zoom by the change
   * in separation, applied together so the plan stays under both fingers. This
   * is what replaces the wheel — the one gesture a touch device has no other
   * way to spell.
   */
  private pinchMove(): void {
    const prev = this.pinch;
    const now = this.pinchState();
    this.pinch = now;
    if (!prev || !now) return;
    this.vp.panPx(now.mid.x - prev.mid.x, now.mid.y - prev.mid.y);
    if (prev.dist > 0 && now.dist > 0) this.vp.zoomAt(now.mid, now.dist / prev.dist);
    this.requestRender();
  }

  private onCancelPointer(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.navigated = false;
    this.tapStart = null;
    this.drag = null;
    this.cancelLongPress();
    this.requestRender();
  }

  /**
   * A tap that landed: the placement tools act here rather than on contact,
   * because until the finger lifts the gesture could still turn out to be the
   * first half of a pinch, and a wall placed on contact cannot be taken back by
   * lifting. Select is the exception — it acts on contact so a drag can start.
   */
  private onTap(time: number): void {
    if (this.calibArmed) { this.calibClick(); return; }
    if (this.tool === "select") {
      // Double tap on empty paper frames the plan. BOTH taps have to have hit
      // nothing: testing only the second one turns an ordinary tap-a-wall then
      // tap-away-to-deselect into a zoom-all, which throws away the view the
      // reader was working in.
      // A second tap on a run adds a waypoint there. Checked before the
      // frame-all below, which needs BOTH taps to have hit nothing and so
      // never competes for this one.
      if (this.store.sel?.kind === "route" && time - this.lastTapTime <= DOUBLE_TAP_MS
          && this.addRouteNodeAt(this.cursor)) {
        this.lastTapTime = 0;
        this.lastTapOnNothing = false;
        return;
      }
      const onNothing = this.store.sel === null;
      if (onNothing && this.lastTapOnNothing && time - this.lastTapTime <= DOUBLE_TAP_MS) {
        this.lastTapTime = 0;
        this.lastTapOnNothing = false;
        this.fitAll();
        return;
      }
      this.lastTapTime = time;
      this.lastTapOnNothing = onNothing;
      return;
    }
    switch (this.tool) {
      case "wall": this.wallClick(); break;
      case "door": case "window": case "passage": this.placeOpening(this.tool); break;
      case "symbol": this.placeSymbol(); break;
      case "stair": this.placeStair(); break;
      case "vide": this.placeVide(); break;
      case "furnishing": this.placeFurnishing(); break;
      case "route": this.routeClick(); break;
      // zoom acted on contact; its release is handled as a zoomBox drag.
      case "zoom": break;
    }
  }

  private onDown(e: PointerEvent): void {
    // Capture keeps a drag alive when the finger leaves the canvas. It throws
    // for a pointer id the browser has no active pointer for, which must not
    // take the rest of the gesture down with it.
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    this.lastPointerType = e.pointerType;
    this.shiftKey = e.shiftKey;
    this.altKey = e.altKey;
    this.modKey = e.metaKey || e.ctrlKey;
    this.hoverSymbol = null; // a name pill has no business sitting under a click or drag
    this.hoverStair = null;
    const s = this.screenOf(e);
    const w = this.vp.toWorld(s);
    this.pointers.set(e.pointerId, s);
    if (this.pointers.size === 1) this.pressScreen = s;

    // A second finger takes over as navigation. A drag already under way is
    // finished where it stands rather than dropped: dragMove commits as it
    // goes, so abandoning a node mid-drag would leave it sitting on top of
    // another one without the weld that onUp performs. A zoom window is the
    // exception — the second finger means "navigate", not "frame this box".
    if (this.pointers.size === 2) {
      this.navigated = true;
      const held = this.drag;
      this.drag = null;
      if (held && held.kind !== "zoomBox") this.finishDrag(held);
      this.tapStart = null;
      this.cancelLongPress();
      this.pinch = this.pinchState();
      this.requestRender();
      return;
    }
    if (this.pointers.size > 2) return;

    // Scale calibration captures on top of whatever tool is armed, so it is
    // checked before any of the tool-specific handling below -- including the
    // dimension-value click just after this, which would otherwise fire first
    // when calibrating from the select tool.
    if (this.calibArmed) {
      this.cursor = w;
      this.snap = this.computeSnap(w, false);
      if (e.pointerType !== "mouse") {
        this.tapStart = { screen: s, time: e.timeStamp };
        this.requestRender();
        return;
      }
      if (e.button !== 0) return;
      this.calibClick();
      return;
    }

    // A dimension value opens for editing however it was pressed. This sat in
    // the mouse path only, which left the touch hint ("tik de mm-waarde om te
    // bewerken") promising something a finger could not do.
    if (this.tool === "select") {
      const hit = this.dimRects.find(r => s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h);
      if (hit) {
        e.preventDefault();
        this.closeDimInput();
        this.openDimInput(hit);
        return;
      }
    }

    if (e.pointerType !== "mouse") {
      this.cursor = w;
      this.snap = this.tool === "select" || this.tool === "route" ? null : this.computeSnap(w, this.tool === "wall");
      this.routeSnap = this.tool === "route" ? this.computeRouteSnap(w) : null;
      this.tapStart = { screen: s, time: e.timeStamp };
      // Two tools need the press itself rather than the release: select, so a
      // drag can start, and zoom, so the window can be dragged out. Neither has
      // changed the document by the time a second finger could arrive, so both
      // are safe to abandon mid-gesture.
      if (this.tool === "select") this.selectDownHold(s, w);
      else if (this.tool === "zoom") this.zoomDown(s, w);
      this.requestRender();
      return;
    }

    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.getModifierState("Space"))) {
      this.drag = { kind: "pan", startWorld: w, moved: false, lastScreen: s };
      return;
    }
    if (e.button !== 0) return;
    switch (this.tool) {
      case "wall": this.wallClick(); break;
      case "door": this.placeOpening("door"); break;
      case "window": this.placeOpening("window"); break;
      case "passage": this.placeOpening("passage"); break;
      case "symbol": this.placeSymbol(); break;
      case "stair": this.placeStair(); break;
      case "vide": this.placeVide(); break;
      case "furnishing": this.placeFurnishing(); break;
      case "route": this.routeClick(); break;
      case "zoom": this.zoomDown(s, w); return;
      // No hold on the mouse path: a click that pauses before it moves -- press,
      // read the plan, then drag -- is an ordinary drag, and arming the hold here
      // fired mid-hesitation, abandoned the drag and toggled the object into a
      // mode instead. Desktop builds a group with Shift+click and Shift+drag,
      // which the touch path has no equivalent for; see selectDownHold().
      case "select": this.selectDown(s, w); break;
    }
  }

  private onMove(e: PointerEvent): void {
    const s = this.screenOf(e);
    const w = this.vp.toWorld(s);
    this.lastPointerType = e.pointerType;
    this.shiftKey = e.shiftKey;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);
    if (this.pointers.size >= 2) { this.pinchMove(); return; }
    this.cursor = w;

    // Movement past the drag threshold cancels a pending long-press hold
    // (see selectDownHold()) -- whatever selectDown() already started (a
    // drag, or nothing) proceeds exactly as it does today.
    if (this.longPressFrom && dist(s, this.longPressFrom) > TAP_SLOP_PX) this.cancelLongPress();

    if (this.drag) { this.dragMove(s, w); return; }

    if (this.calibArmed) {
      this.snap = this.computeSnap(w, false);
      this.requestRender();
      return;
    }

    // What is this thing? A placed symbol is a bare line drawing, so name the
    // one under the cursor (see drawPreview).
    this.hoverStair = this.tool === "select" ? this.stairAt(w)?.id ?? null : null;
    this.hoverSymbol = this.tool === "select" && !this.hoverStair
      ? this.symbolAt(w)?.id ?? null : null;
    this.snap = this.tool === "select" || this.tool === "route" ? null : this.computeSnap(w, this.tool === "wall");
    this.routeSnap = this.tool === "route" ? this.computeRouteSnap(w) : null;
    this.requestRender();
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    // A release before the delay is a plain tap/click, however brief --
    // never a fire, so the hold has nothing left to do.
    this.cancelLongPress();

    // The fingers of a pinch lift one at a time; neither is a tap.
    if (this.navigated) {
      if (this.pointers.size === 0) this.navigated = false;
      this.tapStart = null;
      this.drag = null;
      this.requestRender();
      return;
    }

    const tap = this.tapStart;
    this.tapStart = null;
    if (tap && e.pointerType !== "mouse") {
      const s = this.screenOf(e);
      const travelled = dist(s, tap.screen) > TAP_SLOP_PX;
      const held = e.timeStamp - tap.time > TAP_MS;
      if (!travelled && !held) this.onTap(e.timeStamp);
    }

    // A shape can be struck out in one gesture as well as clicked corner to
    // corner: with its first point already down, a release that travelled is
    // the second one. The first point is not a document change, so unlike a
    // placement this can safely begin on contact.
    if (this.tool === "wall" && this.shapeStart && !this.drag && this.pressScreen
        && dist(this.screenOf(e), this.pressScreen) > TAP_SLOP_PX) {
      this.pressScreen = null;
      this.cursor = this.vp.toWorld(this.screenOf(e));
      this.snap = this.computeSnap(this.cursor, false);
      this.shapeClick();
      return;
    }
    this.pressScreen = null;

    if (!this.drag) { this.requestRender(); return; }
    const d = this.drag;
    this.drag = null;
    if (d.kind === "zoomBox") { this.zoomUp(d); this.requestRender(); return; }
    if (d.kind === "marquee") { this.marqueeUp(d); this.requestRender(); return; }
    // `moved` is set by the first pointermove, which a mouse emits for a pixel
    // of jitter, so travel is what decides: a press that stayed put opened the
    // room's row, one that went somewhere panned.
    if (d.kind === "pan" && d.labelRoom && d.startScreen
        && dist(this.screenOf(e), d.startScreen) <= TAP_SLOP_PX) {
      // Not a press on empty paper, so it must not also count as half of the
      // double tap that frames the plan.
      this.lastTapOnNothing = false;
      this.onRoomLabel?.(d.labelRoom);
    }
    this.finishDrag(d);
    this.requestRender();
  }

  /**
   * The end of a drag, from a finger lifting or from a second finger taking
   * over. dragMove has already written the new position, so this is only the
   * part that cannot be done per move: a node dropped onto another has to weld,
   * or the graph keeps two coincident nodes and resolveFloor miters them as two
   * separate degree-1 ends -- and a device dropped on a run's loose end takes
   * that end over, the same rule its placement follows.
   */
  private finishDrag(d: DragState): void {
    if (!d.moved) return;
    if (d.kind === "symbol" || d.kind === "furnishing") { this.linkDroppedDevices(d); return; }
    if (d.kind !== "node") return;
    const before = this.rooms();
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      const me = f.nodes.find(n => n.id === d.id);
      if (!me) return;
      for (const n of f.nodes) {
        if (n.id !== me.id && dist(v(n.x, n.y), v(me.x, me.y)) <= 1) { mergeNodes(f, n.id, me.id); break; }
      }
      // Welding two nodes can collapse the wall between two rooms, which merges
      // them exactly as deleting that wall would.
      deleteRoomNames(f, orphanedRoomNames(f, before));
    }, "nodedrop");
  }

  /**
   * Every device the drag just moved picks up whatever loose route end it now
   * stands on. Its own mutation rather than part of the move's coalesced
   * gesture: the link is a topology change, and undoing it separately from the
   * move it arrived with is the behaviour that matches how it reads.
   *
   * A device already anchoring a point keeps it -- that run followed the drag
   * on its own (see model/route.ts) and needs nothing here.
   */
  private linkDroppedDevices(d: DragState): void {
    const group = this.store.selectedOf(d.kind === "symbol" ? "symbol" : "furnishing");
    const ids = group.length > 0 ? group : d.id ? [d.id] : [];
    // Asked before mutating: a drop that landed on nothing must not push an
    // empty undo step onto the stack.
    const live = this.floor;
    const lands = ids.some(id => {
      if (d.kind === "symbol") {
        const sym = live.symbols.find(x => x.id === id);
        return !!sym && deviceConnects(live, sym, key => routeTakesSymbol(key, sym.type));
      }
      const fn = furnishingsOf(live).find(x => x.id === id);
      return !!fn && deviceConnects(live, fn, key => routeTakesFurnishing(key, fn));
    });
    if (!lands) return;
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      for (const id of ids) {
        if (d.kind === "symbol") {
          const sym = f.symbols.find(x => x.id === id);
          if (sym) connectDevice(f, sym, key => routeTakesSymbol(key, sym.type));
        } else {
          const fn = furnishingsOf(f).find(x => x.id === id);
          if (fn) connectDevice(f, fn, key => routeTakesFurnishing(key, fn));
        }
      }
    });
  }

  // ---- wall tool ----
  private wallClick(): void {
    if (this.wallShape !== "line") { this.shapeClick(); return; }
    const snap = this.snap ?? this.computeSnap(this.cursor, true);
    let target = snap.p;
    if (this.chainStart && this.lengthBuffer) {
      const mm = parseFloat(this.lengthBuffer);
      if (isFinite(mm) && mm > 0) {
        const dir = norm(sub(target, this.chainStart));
        target = add(this.chainStart, scale(dir, mm));
      }
    }
    if (!this.chainStart) {
      this.store.mutate(doc => {
        const f = this.store.floorOf(doc);
        const n = this.anchorNode(f, snap, target);
        this.chainStart = v(n.x, n.y);
        this.chainStartNode = n.id;
        this.chainFirstNode = n.id;
      });
    } else {
      if (dist(target, this.chainStart) < MIN_WALL_MM) return;
      this.store.mutate(doc => {
        const f = this.store.floorOf(doc);
        const startId = this.chainStartNode!;
        const endSnap = this.lengthBuffer ? null : snap;
        const nEnd = endSnap ? this.anchorNode(f, endSnap, target) : nodeAt(f, target);
        if (nEnd.id === startId) return;
        this.armWalls(insertWall(f, startId, nEnd.id, this.lastThickness));
        this.chainStart = v(nEnd.x, nEnd.y);
        this.chainStartNode = nEnd.id;
      });
      this.lengthBuffer = "";
    }
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /**
   * The shape being struck out, or null when there is nothing to draw yet.
   * Both the ghost and the walls come from here, so what is drawn is what was
   * previewed.
   */
  private pendingShape(to?: Vec): ShapeRun | null {
    if (!this.shapeStart) return null;
    return shapeRun(this.wallShape, this.shapeStart, to ?? this.snap?.p ?? this.cursor, {
      square: this.squareLock || this.shiftKey,
      sides: this.polygonSides,
    });
  }

  /**
   * A shape takes two points: corner to opposite corner for a rectangle, centre
   * to rim for a circle and a polygon. The first only arms it -- nothing reaches
   * the document until the second, so a shape can be abandoned with Escape and
   * leaves no stray node behind.
   */
  private shapeClick(): void {
    const snap = this.snap ?? this.computeSnap(this.cursor, false);
    if (!this.shapeStart) {
      this.shapeStart = snap.p;
      this.updateHint();
      this.onToolChange();
      this.requestRender();
      return;
    }
    const run = this.pendingShape(snap.p);
    // Too small to be a shape: hold the first point rather than throwing the
    // gesture away, since this is what a double click on one spot produces.
    if (!run) return;
    this.store.mutate(doc => {
      this.armWalls(insertRun(this.store.floorOf(doc), run.points, run.bulges, this.lastThickness));
    });
    this.shapeStart = null;
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /** Node for a snap target: existing node, split wall, or new node. */
  private anchorNode(f: Floor, snap: SnapResult, p: Vec): PlanNode {
    if (snap.kind === "node" && snap.node) return f.nodes.find(n => n.id === snap.node!.id)!;
    if (snap.kind === "wall" && snap.wall && snap.tMm !== undefined) {
      const wall = f.walls.find(x => x.id === snap.wall!.id);
      if (wall) {
        const L = wallLength(f, wall);
        if (snap.tMm > SPLIT_END_MM && snap.tMm < L - SPLIT_END_MM) {
          const split = splitWall(f, wall, snap.tMm);
          if (split) return split;
        }
      }
    }
    return nodeAt(f, p);
  }

  // ---- openings ----
  private placeOpening(kind: OpeningKind): void {
    const f = this.floor;
    const nw = nearestWall(f, this.cursor, 30 / this.vp.pxPerMm);
    if (!nw) return;
    const o: Opening = {
      id: newId("o"), kind, t: Math.round(nw.tMm / 10) * 10, width: this.openingWidth[kind],
      sashes: kind === "door"
        ? [{ action: "turn", hinge: this.doorHinge, outward: this.doorOutward }]
        : kind === "window" ? [{ action: "fixed" }] : [],
      // A door takes the standing choices rather than one fixed default: hinge
      // side, swing and fire rating are decided once for a plan and then placed
      // over and over, the way lastThickness works for walls.
      ...(kind === "door" ? {
        ...(this.doorSelfClosing ? { selfClosing: true } : {}),
        ...(this.doorFire ? { fireRating: { ...this.doorFire } } : {}),
      } : {}),
    };
    this.store.mutate(doc => {
      const fl = this.store.floorOf(doc);
      const wall = fl.walls.find(x => x.id === nw.wall.id);
      if (!wall) return;
      clampOpening(fl, wall, o);
      wall.openings.push(o);
    });
    this.store.select({ kind: "opening", id: o.id, wallId: nw.wall.id });
  }

  // ---- symbols ----
  /**
   * Where a wall-mounted symbol lands for the current cursor: flush to the
   * nearest wall face, oriented outward. Split out of symbolPose() because the
   * preview needs `wall`/`tMm`/`side` to measure with, and those must not reach
   * the document — symbolPose()'s result is spread straight onto a symbol.
   */
  private wallSnap(): { wall: Wall; tMm: number; side: 1 | -1; x: number; y: number; rotation: number } | null {
    if (!this.snapWall) return null;
    const f = this.floor;
    // A screen distance rather than a distance on the plan, so the pull is the
    // same 30 px at every zoom. It used to carry a flat 500 mm on top of that,
    // which at ordinary zoom reached half a metre into the room and took hold
    // of anything put down near a wall. Openings are not placed through here;
    // a door lands on a wall whatever this says.
    const nw = nearestWall(f, this.cursor, Math.max(WALL_SNAP_MIN_MM, 30 / this.vp.pxPerMm));
    if (!nw) return null;
    const a = f.nodes.find(n => n.id === nw.wall.a)!;
    const b = f.nodes.find(n => n.id === nw.wall.b)!;
    const L = wallLength(f, nw.wall);
    const frac = Math.max(0, Math.min(1, nw.tMm / L));
    const pOn = arcPointAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, frac);
    const tan = arcTangentAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, frac);
    const n = perp(tan);
    const side = dot(sub(this.cursor, pOn), n) >= 0 ? 1 : -1;
    const anchor = add(pOn, scale(n, (nw.wall.thickness / 2) * side));
    const outN = scale(n, side);
    return {
      wall: nw.wall, tMm: frac * L, side,
      x: Math.round(anchor.x), y: Math.round(anchor.y), rotation: angleOf(outN) - Math.PI / 2,
    };
  }

  /** Which side of a wall the cursor is on at parameter `frac` (0..1). */
  private cursorSide(wall: Wall, frac: number): 1 | -1 {
    const f = this.floor;
    const a = f.nodes.find(n => n.id === wall.a), b = f.nodes.find(n => n.id === wall.b);
    if (!a || !b) return 1;
    const A = v(a.x, a.y), B = v(b.x, b.y);
    const pOn = arcPointAt(A, B, wall.bulge, frac);
    return dot(sub(this.cursor, pOn), perp(arcTangentAt(A, B, wall.bulge, frac))) >= 0 ? 1 : -1;
  }

  private symbolPose(): { x: number; y: number; rotation: number; wallId?: string } {
    if (getSymbol(this.symbolType)?.wallMounted) {
      const s = this.wallSnap();
      if (s) return { x: s.x, y: s.y, rotation: s.rotation, wallId: s.wall.id };
    }
    const g = this.gridStep;
    return { x: Math.round(this.cursor.x / g) * g, y: Math.round(this.cursor.y / g) * g, rotation: 0 };
  }

  private placeSymbol(): void {
    const pose = this.symbolPose();
    const id = newId("s");
    const sym: SymbolInstance = { id, type: this.symbolType, ...pose };
    // Only when a pen is armed: the default ink is stored as no colour at all.
    if (this.symbolColor) sym.color = this.symbolColor;
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      f.symbols.push(sym);
      connectDevice(f, sym, key => routeTakesSymbol(key, sym.type));
    });
    this.store.select({ kind: "symbol", id });
  }

  /**
   * The stair as it currently stands: what the ghost draws and what a click
   * places. Stairs quantise to the grid and take their direction from R
   * rather than snapping to a wall — the wide snap radius a symbol uses would
   * have a flight flipping around every wall the cursor passed near, and a
   * stair is placed inside a stairwell rather than against one face of it.
   */
  private draftStair(id: string): ResolvedStair {
    const g = this.gridStep;
    const p = clampStair(this.stairSize);
    const st: ResolvedStair = {
      id, kind: this.stairKind,
      x: Math.round(this.cursor.x / g) * g,
      y: Math.round(this.cursor.y / g) * g,
      rotation: this.stairRotation,
      width: p.width, going: p.going, treads: p.treads, rise: p.rise,
    };
    if (this.stairMirrored) st.mirrored = true;
    // Stored whenever the kind reads it, including a deliberate 0: leaving it
    // out means "the kind's own default", which is not the same statement.
    if (stairFields(st.kind).well) st.well = p.well;
    if (this.symbolColor) st.color = this.symbolColor;
    return st;
  }

  private placeStair(): void {
    const st: Stair = this.draftStair(newId("t"));
    // The rise is stored only where it differs from the storey: a stair that
    // climbs its floor should follow that floor when the storey height changes.
    if (inheritsRise(st.kind) && st.rise === floorHeight(this.floor)) delete st.rise;
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      (f.stairs ??= []).push(st);
    });
    this.store.select({ kind: "stair", id: st.id });
  }

  private draftVide(id: string): Vide {
    const g = this.gridStep;
    const s = clampVide(this.videSize);
    return {
      id,
      x: Math.round(this.cursor.x / g) * g,
      y: Math.round(this.cursor.y / g) * g,
      rotation: this.videRotation,
      width: s.width, depth: s.depth,
      ...(this.symbolColor ? { color: this.symbolColor } : {}),
    };
  }

  private placeVide(): void {
    const vd = this.draftVide(newId("v"));
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      (f.vides ??= []).push(vd);
    });
    this.store.select({ kind: "vide", id: vd.id });
  }

  // ---- routes ----
  /** Arm a discipline for the route tool. Sticky, like lastThickness. */
  setRouteDiscipline(d: Discipline): void {
    this.routeDiscipline = d;
    this.onToolChange();
    this.requestRender();
  }

  /** Arm what the next electrical run carries. Sticky, like routeDiscipline. */
  setRouteKind(k: RouteKind): void {
    this.routeKind = k;
    this.onToolChange();
    this.requestRender();
  }

  /**
   * Arm the aders count for the next power run. [2,3,4,5] are the chip row's
   * ordinary options; a typed value can go up to the schema's own maximum.
   */
  setRouteVeins(n: number): void {
    this.routeVeins = clampRouteVeins(n);
    this.onToolChange();
  }

  /** Arm the groep for the next power run. */
  setRouteGroup(s: string): void {
    this.routeGroup = s.trim();
    this.onToolChange();
  }

  /** Arm the cable spec for the next data run. */
  setRouteSpec(s: string): void {
    this.routeSpec = s.trim();
    this.onToolChange();
  }

  /**
   * Arm the water kind for the next run. When the armed diameter still sits
   * on the OLD kind's own default -- i.e. the user never typed or chipped a
   * diameter of their own -- it follows the new kind's default too, the same
   * "only reset when nothing was overridden" rule a placed route's diameter
   * field applies via its own absence (see ui/route.ts).
   */
  setRouteWater(w: RouteWater): void {
    if (this.routeDiameter === defaultRouteDiameter(this.routeWater)) {
      this.routeDiameter = defaultRouteDiameter(w);
    }
    this.routeWater = w;
    this.onToolChange();
    this.requestRender();
  }

  /** Arm the nominal diameter for the next water run. */
  setRouteDiameter(n: number): void {
    this.routeDiameter = clampRouteDiameter(n);
    this.onToolChange();
  }

  setRouteGasDiameter(n: number): void {
    this.routeGasDiameter = clampRouteDiameter(n);
    this.onToolChange();
  }

  /** Arm which CV leg the next heating run is. Sticky, like routeDiscipline. */
  setRouteHeat(v: RouteHeat): void {
    this.routeHeat = v;
    this.onToolChange();
    this.requestRender();
  }

  setRouteHeatDiameter(n: number): void {
    this.routeHeatDiameter = clampRouteDiameter(n);
    this.onToolChange();
    this.requestRender();
  }

  /** Arm the toevoer/afvoer kind for the next vent run. Sticky, like routeDiscipline. */
  setRouteVent(v: RouteVent): void {
    this.routeVent = v;
    this.onToolChange();
    this.requestRender();
  }

  /** Arm the nominal duct diameter for the next vent run. */
  setRouteDuctDiameter(n: number): void {
    this.routeDuctDiameter = clampDuctDiameter(n);
    this.onToolChange();
  }

  /** Arm the design flow for the next vent run, or clear it back to unstated. */
  setRouteFlow(n: number | undefined): void {
    this.routeFlow = n === undefined ? undefined : clampRouteFlow(n);
    this.onToolChange();
  }

  /**
   * Arm where the next run is installed. The armed height follows, but only
   * while it is still whatever the previous installation offered: switching to
   * "in / boven plafond" raises it to the storey height, and back down to the
   * floor again -- a figure the user actually typed is left alone. Same
   * "only reset when nothing was overridden" rule setRouteWater applies to the
   * water diameter.
   */
  setRouteInstallation(value: RouteInstallation): void {
    if (this.routeHeight === defaultRouteHeight(this.floor, this.routeInstallation)) {
      this.routeHeight = defaultRouteHeight(this.floor, value);
    }
    this.routeInstallation = value;
    this.onToolChange();
    this.requestRender();
  }

  setRouteHeight(n: number): void {
    this.routeHeight = Math.max(0, Math.round(n));
    this.onToolChange();
  }

  setRouteAuto(on: boolean): void { this.routeAuto = on; this.onToolChange(); this.requestRender(); }

  setRequireComplete(on: boolean): void {
    this.requireComplete = on;
    this.onToolChange();
    this.requestRender();
  }

  /** Flip one storey's presence in the 3D scene. */
  toggleFloor3d(id: string): void {
    if (!this.view3dHidden.delete(id)) this.view3dHidden.add(id);
    this.onToolChange();
    this.onView3dScene?.();
  }

  /** Enter or leave the 3D view. Cancels any half-made gesture first: the
   *  canvas it was drawing on is about to stop taking the pointer. */
  setView3d(on: boolean): void {
    if (this.view3d === on) return;
    this.cancel();
    this.view3d = on;
    this.updateHint();
    this.onToolChange();
    this.onView3d?.(on);
  }

  setRouteOffset(n: number): void {
    this.routeOffset = Math.max(0, Math.round(n));
    this.onToolChange();
    this.requestRender();
  }

  setRouteTag(value: string): void { this.routeTag = value.trim(); this.onToolChange(); }
  setRouteName(value: string): void { this.routeName = value.trim(); this.onToolChange(); }
  setRouteBoard(value: string): void { this.routeBoard = value.trim(); this.onToolChange(); }

  /**
   * A fixed 30 mm stand-off from the nearest wall's centerline, on the
   * cursor's side -- reusing wallSnap()'s own centerline-projection maths
   * (see its comment) rather than a symbol's half-thickness offset, since a
   * route is not mounted flush to the face the way a symbol is.
   */
  private routeWallHug(p: Vec, installation: RouteInstallation = this.routeInstallation): {
    p: Vec; wallId: Id; wallT: number; wallSide: 1 | -1;
  } | null {
    if (!this.snapWall || (installation !== "concealed" && installation !== "surface")) return null;
    const f = this.floor;
    const nw = nearestWall(f, p, Math.max(WALL_SNAP_MIN_MM, 30 / this.vp.pxPerMm));
    if (!nw) return null;
    const a = f.nodes.find(n => n.id === nw.wall.a)!, b = f.nodes.find(n => n.id === nw.wall.b)!;
    const L = wallLength(f, nw.wall);
    const frac = Math.max(0, Math.min(1, nw.tMm / L));
    const pOn = arcPointAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, frac);
    const n = perp(arcTangentAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, frac));
    const side: 1 | -1 = dot(sub(p, pOn), n) >= 0 ? 1 : -1;
    const snapped = installation === "surface"
      ? add(pOn, scale(n, (nw.wall.thickness / 2) * side))
      : pOn;
    return {
      p: snapped, wallId: nw.wall.id, wallT: Math.round(frac * L), wallSide: side,
    };
  }

  /**
   * The route tool's snap: a nearby symbol anchors the point to it (so the
   * run follows the symbol if it later moves); failing that, an existing
   * node gives an exact point to start or end on; failing that, the run hugs
   * the nearest wall (routeWallHug above); failing that, it falls back to
   * grid/whole-mm placement like every other tool. Ortho/45 lock applies
   * while a chain is open, the same rule computeSnap uses for a wall.
   *
   * A device sitting ON the selected run reports BOTH: the anchor and the leg
   * it stands on. That combination is the tap the drawing actually wants -- a
   * socket fed from a trunk that carries on past it, where the spur is a
   * centimetre and not a branch worth drawing. Clicking it inserts an anchored
   * junction into that leg (see routeClick/commitRoute), rather than choosing
   * between anchoring to the device and splitting the run.
   */
  private computeRouteSnap(
    raw: Vec,
    discipline: Discipline = this.routeDiscipline,
    waterKind: RouteWater = this.routeWater,
    installation: RouteInstallation = this.routeInstallation,
    ventKind: RouteVent = this.routeVent,
    kindOfRun: RouteKind = this.routeKind,
    heatLeg: RouteHeat = this.routeHeat,
  ): {
    p: Vec; anchor?: Id; wallId?: Id; wallT?: number; wallSide?: 1 | -1;
    routeId?: Id; routePointId?: Id;
    routeSegmentId?: Id;
  } {
    const f = this.floor;
    const tol = 12 / this.vp.pxPerMm;

    const selected = this.routeTargetId
      ? routesOf(f).find(r => r.id === this.routeTargetId)
      : this.store.sel?.kind === "route" ? routesOf(f).find(r => r.id === this.store.sel!.id) : undefined;
    const onSelected = selected !== undefined && selected.discipline === discipline;
    if (onSelected) {
      const points = resolveRoutePoints(f, selected);
      let best = -1, bestDistance = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = dist(points[i]!, raw);
        if (d <= tol && d < bestDistance) { best = i; bestDistance = d; }
      }
      if (best >= 0) return {
        p: points[best]!, routeId: selected.id, routePointId: selected.points[best]!.id,
      };
    }

    // What this discipline's run may end at: the symbols of its own trade, and
    // the fit-out that is plumbed or wired -- a run ends at a fornuis, a
    // wastafel or an afzuigkap as readily as at a socket. The rule itself
    // lives in core/attach.ts, because a device being PLACED asks the same
    // question from the other side. Alt overrides the check, for the run the
    // rule did not anticipate.
    // Measured at the PORT this run would reach, not at the device's anchor:
    // a douche's afvoer is in the middle of its tray, most of a tray away from
    // the wall it stands against. core/port.ts is the one answer to that.
    const key = serviceKeyOf(discipline,
      { water: waterKind, vent: ventKind, power: kindOfRun, heat: heatLeg });
    const anchors: Array<{ id: Id; x: number; y: number; d: number }> = [];
    const consider = (item: Device, compatible: boolean): void => {
      if (!compatible && !this.altKey) return;
      const at = connectionPoint(item, key);
      const d = dist(at, raw);
      if (d <= tol) anchors.push({ id: item.id, x: at.x, y: at.y, d });
    };
    for (const s of f.symbols) consider(s, routeTakesSymbol(key, s.type));
    for (const fn of furnishingsOf(f)) consider(fn, routeTakesFurnishing(key, fn));
    // A groep of a groepenkast is a connection point in its own right, and the
    // one a circuit is supposed to start at: anchoring there is what makes the
    // run's groep the kast's own label rather than a typed string.
    if (discipline === "electrical") {
      for (const resolved of resolveBoards(f)) {
        const d = dist(resolved.at, raw);
        if (d <= tol) anchors.push({ id: resolved.group.id, x: resolved.at.x, y: resolved.at.y, d });
      }
    }
    anchors.sort((a, b) => a.d - b.d);
    const anchorHit = anchors[0] ?? null;

    // The leg of the selected run under the cursor -- or, when a device was
    // found, under the DEVICE: a wall-mounted socket's anchor sits on the wall
    // face while a concealed run hugs the centerline, so the two are half a
    // wall apart and the cursor's own tolerance would not reach across it.
    const segmentAt = anchorHit ? v(anchorHit.x, anchorHit.y) : raw;
    const segmentTol = anchorHit ? Math.max(tol, ROUTE_LINK_MM) : tol;
    let bestSegment: {
      id: Id; p: Vec; d: number; wallId?: Id; wallT?: number; wallSide?: 1 | -1;
    } | undefined;
    if (onSelected) {
      const resolved = resolveRoutes(f).find(rr => rr.route.id === selected.id);
      for (const segment of resolved?.segments ?? []) {
        if (segment.bulge !== 0) continue;
        const hit = distToSeg(segmentAt, segment.a, segment.b);
        if (hit.d <= segmentTol && (!bestSegment || hit.d < bestSegment.d)) {
          const rawSegment = selected.segments.find(item => item.id === segment.id);
          const pointA = rawSegment && selected.points.find(point => point.id === rawSegment.a);
          const pointB = rawSegment && selected.points.find(point => point.id === rawSegment.b);
          const sameWall = pointA?.wallId && pointA.wallId === pointB?.wallId
            && pointA.wallT !== undefined && pointB.wallT !== undefined;
          bestSegment = {
            id: segment.id, d: hit.d,
            p: add(segment.a, scale(sub(segment.b, segment.a), hit.t)),
            ...(sameWall ? {
              wallId: pointA.wallId,
              wallT: Math.round(pointA.wallT! + (pointB!.wallT! - pointA.wallT!) * hit.t),
              wallSide: pointA.wallSide ?? pointB?.wallSide,
            } : {}),
          };
        }
      }
    }

    // A device wins the POSITION; the leg it stands on rides along, so the
    // click becomes a tap into the trunk rather than a new loose branch.
    if (anchorHit) return {
      p: v(anchorHit.x, anchorHit.y), anchor: anchorHit.id,
      ...(bestSegment && selected ? { routeId: selected.id, routeSegmentId: bestSegment.id } : {}),
    };
    if (bestSegment && selected) return {
      p: bestSegment.p, routeId: selected.id, routeSegmentId: bestSegment.id,
      wallId: bestSegment.wallId, wallT: bestSegment.wallT, wallSide: bestSegment.wallSide,
    };

    for (const n of f.nodes) {
      if (dist(v(n.x, n.y), raw) <= tol) return { p: v(n.x, n.y) };
    }

    let p = raw;
    if (this.routeStart && (this.ortho || this.shiftKey)) {
      const d = sub(raw, this.routeStart);
      const ang = Math.round(angleOf(d) / (Math.PI / 4)) * (Math.PI / 4);
      const dir = fromAngle(ang);
      p = add(this.routeStart, scale(dir, dot(d, dir)));
    }

    const hug = this.routeWallHug(p, installation);
    if (hug) return hug;

    const g = this.gridStep;
    return { p: v(Math.round(p.x / g) * g, Math.round(p.y / g) * g) };
  }

  /**
   * One click/tap of the route tool: arms the first waypoint, or appends the
   * next one to the open chain. Nothing reaches the document here -- see
   * commitRoute() -- so this can run freely without an undo entry per point.
   */
  private routeClick(): void {
    const snap = this.routeSnap ?? this.computeRouteSnap(this.cursor);
    let target = snap.p;
    let anchor = snap.anchor;
    let exactLength = false;
    if (this.routeStart && this.lengthBuffer) {
      const mm = parseFloat(this.lengthBuffer);
      if (isFinite(mm) && mm > 0) {
        target = add(this.routeStart, scale(norm(sub(target, this.routeStart)), mm));
        anchor = undefined; // a typed length overrides wherever the pointer landed
        exactLength = true;
      }
    }
    const pt: RoutePoint = {
      id: !exactLength && snap.routePointId ? snap.routePointId : newId("rp"),
      x: Math.round(target.x), y: Math.round(target.y),
    };
    if (!this.routeStart && snap.routeId) this.routeTargetId = snap.routeId;
    if (!this.routeStart && snap.routeId && snap.routeSegmentId) {
      this.routeSplit = { routeId: snap.routeId, segmentId: snap.routeSegmentId, point: pt };
    }
    if (anchor) pt.anchor = anchor;
    if (!exactLength && !anchor && snap.wallId && snap.wallT !== undefined) {
      pt.wallId = snap.wallId;
      pt.wallT = snap.wallT;
      pt.wallSide = snap.wallSide;
    }
    if (!this.routeStart) {
      this.routePoints = [pt];
    } else {
      if (dist(target, this.routeStart) < MIN_ROUTE_STEP_MM) return;
      // Auto mode fills the corners in between; the click's own point is still
      // the one that lands where it was asked for.
      for (const corner of this.autoCorners(this.routeStart, target)) {
        this.routePoints.push({ id: newId("rp"), x: corner.x, y: corner.y });
      }
      this.routePoints.push(pt);
    }
    this.routeStart = target;
    this.lengthBuffer = "";
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /**
   * The corners a proposed leg turns at between two points, or nothing when
   * auto mode is off or no path along the walls connects them. The endpoints
   * themselves are the caller's, so a leg proposed to a socket still ends AT
   * the socket rather than at the wall behind it.
   */
  private autoCorners(from: Vec, to: Vec): Vec[] {
    if (!this.routeAuto) return [];
    const path = autoRoutePath(this.floor, from, to, { offsetMm: this.routeOffset });
    return path === null ? [] : path.slice(1, -1);
  }

  /**
   * End the open chain: two or more waypoints become one Route, written in a
   * single mutate() call so the whole run is one undo step. Called by Escape,
   * double-click, and the touch "Done" button (endChain()).
   *
   * ONE point is committed too, but only when it splits a leg of an existing
   * run: that is a tap into a trunk -- a socket or a switch the run reaches on
   * its way past, where the spur is a centimetre and not a branch worth
   * drawing -- and it is a real edit to the network even though it drew no new
   * line. A single point anywhere else is nothing to draw and is dropped.
   */
  private commitRoute(): void {
    const tap = this.routePoints.length === 1 && this.routeSplit !== null;
    if (this.routePoints.length >= 2 || tap) {
      const segments: RouteSegment[] = [];
      for (let i = 0; i + 1 < this.routePoints.length; i++) {
        segments.push({ id: newId("rse"), a: this.routePoints[i]!.id, b: this.routePoints[i + 1]!.id });
      }
      const route: Route = {
        id: newId("rt"), discipline: this.routeDiscipline,
        points: this.routePoints, segments,
      };
      if (this.routeTag) route.tag = this.routeTag;
      if (this.routeName) route.name = this.routeName;
      if (this.routeBoard && this.routeDiscipline === "electrical") route.board = this.routeBoard;
      if (this.routeInstallation !== "concealed") route.installation = this.routeInstallation;
      if (this.routeHeight !== defaultRouteHeight(this.floor, this.routeInstallation))
        route.height = this.routeHeight;
      // Electrical vocabulary, only when it applies and only when it says
      // something a reader would not already assume -- the armed defaults
      // (power, 3 aders) are left unstated, the way an absent Cabinet.hinge
      // means "left" rather than being written out on every placement.
      if (this.routeDiscipline === "electrical") {
        if (this.routeKind !== "power") route.kind = this.routeKind;
        if (this.routeKind === "power") {
          if (this.routeVeins !== ROUTE_VEINS_DEFAULT) route.veins = this.routeVeins;
          if (this.routeGroup) route.group = this.routeGroup;
        } else if (this.routeSpec) {
          route.spec = this.routeSpec;
        }
      } else if (this.routeDiscipline === "water") {
        if (this.routeWater !== "koud") route.water = this.routeWater;
        if (this.routeDiameter !== defaultRouteDiameter(this.routeWater)) route.diameter = this.routeDiameter;
      } else if (this.routeDiscipline === "vent") {
        if (this.routeVent !== "toevoer") route.vent = this.routeVent;
        if (this.routeDuctDiameter !== VENT_DIAMETER_DEFAULT) route.ductDiameter = this.routeDuctDiameter;
        if (this.routeFlow !== undefined) route.flow = this.routeFlow;
      } else if (this.routeDiscipline === "heating") {
        if (this.routeHeat !== "aanvoer") route.heat = this.routeHeat;
        if (this.routeHeatDiameter !== HEAT_DIAMETER_DEFAULT) route.diameter = this.routeHeatDiameter;
      } else if (this.routeDiscipline === "gas") {
        if (this.routeGasDiameter !== 15) route.diameter = this.routeGasDiameter;
      }
      if (this.routeTargetId) {
        const targetId = this.routeTargetId;
        this.store.mutate(doc => {
          const target = routesOf(this.store.floorOf(doc)).find(r => r.id === targetId);
          if (!target) return;
          if (this.routeSplit?.routeId === targetId) {
            const index = target.segments.findIndex(s => s.id === this.routeSplit!.segmentId);
            const original = target.segments[index];
            if (original) {
              target.segments.splice(index, 1,
                { id: newId("rse"), a: original.a, b: this.routeSplit.point.id },
                { id: newId("rse"), a: this.routeSplit.point.id, b: original.b });
            }
          }
          const known = new Set(target.points.map(p => p.id));
          target.points.push(...route.points.filter(p => !known.has(p.id)));
          const edgeKeys = new Set(target.segments.map(s => [s.a, s.b].sort().join("|")));
          target.segments.push(...route.segments.filter(s => !edgeKeys.has([s.a, s.b].sort().join("|"))));
          const degree = new Map<Id, number>();
          for (const segment of target.segments) {
            degree.set(segment.a, (degree.get(segment.a) ?? 0) + 1);
            degree.set(segment.b, (degree.get(segment.b) ?? 0) + 1);
          }
          for (const point of target.points) if ((degree.get(point.id) ?? 0) !== 1) delete point.terminal;
        });
        this.store.select({ kind: "route", id: targetId });
      } else {
        this.store.mutate(doc => { (this.store.floorOf(doc).routes ??= []).push(route); });
        this.store.select({ kind: "route", id: route.id });
      }
    }
    this.routeStart = null;
    this.routePoints = [];
    this.routeTargetId = null;
    this.routeSplit = null;
    this.routeTag = "";
    this.routeName = "";
    this.lengthBuffer = "";
    this.requestRender();
  }

  /**
   * Add a waypoint to the run under `w`, and take hold of it.
   *
   * The gesture for taking a cable around something: a run drawn straight past
   * an obstacle needs a bend, and until now the only way to get one was to
   * arm the route tool and split the leg from there. Hit-tested against the
   * DRAWN line -- the corridor fan is what the reader clicked on -- and
   * inserted into the stored leg the drawn one came from, which is the same
   * segment either way since the fan only translates it.
   *
   * Returns false when the press was not on a run, so the caller falls through
   * to whatever it would otherwise have done.
   */
  /**
   * Cmd/Ctrl-click on a wall splits it there, the twin of the same press on a
   * run. The new node is selected, so the property pane's x and y set it to an
   * exact position immediately -- and so Delete acts on what was just made.
   *
   * The 40 mm margins are anchorNode()'s: a split closer than that to an end
   * leaves a sliver of wall nobody drew.
   */
  /**
   * The run whose waypoints are live: the selected route, or the run a selected
   * waypoint belongs to. Picking a point must not make its own run's other
   * points unreachable, which is what reading `sel.kind === "route"` alone did.
   */
  private get activeRouteId(): Id | null {
    const sel = this.store.sel;
    if (sel?.kind === "route") return sel.id;
    if (sel?.kind === "routePoint") return sel.routeId ?? null;
    return null;
  }

  private addWallNodeAt(w: Vec): boolean {
    const f = this.floor;
    const hit = nearestWall(f, w, 12 / this.vp.pxPerMm);
    if (!hit) return false;
    const L = wallLength(f, hit.wall);
    if (hit.tMm <= 40 || hit.tMm >= L - 40) return false;
    let made: Id | null = null;
    this.store.mutate(doc => {
      const fl = this.store.floorOf(doc);
      const wall = fl.walls.find(x => x.id === hit.wall.id);
      if (wall) made = splitWall(fl, wall, hit.tMm)?.id ?? null;
    });
    if (!made) return false;
    this.store.select({ kind: "node", id: made });
    this.requestRender();
    return true;
  }

  private addRouteNodeAt(w: Vec): boolean {
    const pick = this.routeAt(w);
    if (!pick) return false;
    const leg = legAt(this.floor, pick.route, w);
    if (!leg) return false;
    let added: Id | null = null;
    this.store.mutate(doc => {
      added = insertRoutePoint(this.store.floorOf(doc), pick.route.id, leg.segmentId, leg.t);
    });
    this.store.select({ kind: "route", id: pick.route.id });
    const index = routesOf(this.floor).find(r => r.id === pick.route.id)
      ?.points.findIndex(p => p.id === added) ?? -1;
    // Held straight away, so the point can be put where it is wanted in the
    // same gesture that created it rather than needing a second grab.
    if (index >= 0) {
      this.drag = { kind: "routeVertex", id: pick.route.id, pointIndex: index, startWorld: w, moved: false };
    }
    this.requestRender();
    return true;
  }

  /**
   * The route to select for a press on a cross-floor riser mark, or undefined
   * when the press is not on one. Coincident services share one mark with a
   * count badge, so the member selected is the one AFTER whatever is selected
   * now: pressing the mark again walks the group. The badge groups the
   * drawing; it is not a merged cable, and every member stays individually
   * selectable.
   */
  private riserPick(w: Vec): Id | undefined {
    const marks = riserMarks(this.store.doc, this.store.activeFloor);
    const tol = Math.max(RISER_PICK_MM, 14 / this.vp.pxPerMm);
    let best: ResolvedRiserMark | undefined, bestD = Infinity;
    for (const mark of marks) {
      const d = dist(mark.at, w);
      if (d <= tol && d < bestD) { best = mark; bestD = d; }
    }
    if (!best) return undefined;
    const ids = [...new Set(best.members.map(m => m.routeId))];
    const current = this.store.sel?.kind === "route" ? ids.indexOf(this.store.sel.id) : -1;
    return ids[(current + 1) % ids.length];
  }

  /** Visually nearest route within the grab margin. Corridor lanes often have
   * overlapping hit areas, so document order is only a final exact-tie break. */
  private routeAt(w: Vec): { route: Route; resolved: ResolvedRoute } | undefined {
    const all = resolveRoutes(this.floor);
    const tol = Math.max(15, 12 / this.vp.pxPerMm);
    let best: { route: Route; resolved: ResolvedRoute; distance: number } | undefined;
    for (let i = all.length - 1; i >= 0; i--) {
      const rr = all[i]!;
      // A cross-floor starter has one point and no local segment yet. Its
      // riser mark must still be selectable so the route tool can grow it.
      const pointDistance = resolveRoutePoints(this.floor, rr.route)
        .reduce((d, point) => Math.min(d, dist(point, w)), Infinity);
      const distance = Math.min(routeDistance(rr, w), pointDistance);
      if (distance <= tol && (!best || distance < best.distance)) {
        best = { route: rr.route, resolved: rr, distance };
      }
    }
    return best;
  }

  // ---- furnishings ----
  /**
   * Where the piece lands for the current cursor.
   *
   * Cabinetry, appliances and sanitair stand against a wall, so they take the
   * wall snap a wall-mounted symbol does, and then snap end-to-end with pieces
   * already placed: a kitchen is a RUN of units butted together, and lining
   * each one up by eye against the last is the work the module widths exist to
   * avoid. A free-standing piece -- a table, a bed -- has no wall to take and
   * no run to join, so it simply lands where the cursor is.
   */
  private furnishingPose(): { x: number; y: number; rotation: number; mirrored: boolean } {
    const g = this.gridStep;
    const loose = {
      x: Math.round(this.cursor.x / g) * g,
      y: Math.round(this.cursor.y / g) * g,
      rotation: this.furnishingRotation,
    };
    if (!furnishingWallMounted(this.furnishingSpec.form)) {
      return { ...loose, mirrored: this.furnishingMirrored };
    }
    const snap = this.wallSnap();
    const base = snap ? { x: snap.x, y: snap.y, rotation: snap.rotation } : loose;
    const run = this.runSnap(base, this.furnishingSpec.width);
    return { ...base, ...run, mirrored: this.furnishingMirrored };
  }

  /**
   * Pull the piece's end onto the end of one already placed, when the two face
   * the same way and the ends are close. Returns the corrected anchor, or
   * nothing when no run is within reach.
   *
   * Ends are compared in world space rather than along a wall parameter, so a
   * run also closes up across a wall join and against a unit that was placed
   * free-standing. Only wall-mounted pieces take part: a table butted against a
   * bath is not a run.
   */
  private runSnap(
    pose: { x: number; y: number; rotation: number }, width: number, skipId?: string,
  ): { x: number; y: number } | null {
    const tol = Math.max(120, 16 / this.vp.pxPerMm);
    // The two ends of the wall-touching edge, in world mm.
    const endsOf = (x: number, y: number, rot: number, w: number): Vec[] =>
      [-w / 2, w / 2].map(lx => add(v(x, y), fromAngleRot(v(lx, 0), rot)));
    const mine = endsOf(pose.x, pose.y, pose.rotation, width);
    let best: { d: number; shift: Vec } | null = null;
    for (const c of furnishingsOf(this.floor)) {
      if (c.id === skipId || !furnishingWallMounted(c.form)) continue;
      // Only units lying the same way: a run is collinear, and pulling a
      // cabinet onto one at right angles would fight the wall snap.
      const da = Math.abs(angleDelta(c.rotation, pose.rotation));
      if (da > 0.05 && Math.abs(da - Math.PI) > 0.05) continue;
      for (const theirs of endsOf(c.x, c.y, c.rotation, c.width)) {
        for (const own of mine) {
          const d = dist(own, theirs);
          if (d <= tol && (!best || d < best.d)) best = { d, shift: sub(theirs, own) };
        }
      }
    }
    if (!best) return null;
    return { x: Math.round(pose.x + best.shift.x), y: Math.round(pose.y + best.shift.y) };
  }

  private draftFurnishing(id: string): Furnishing {
    const spec = clampFurnishing(this.furnishingSpec);
    const pose = this.furnishingPose();
    const f: Furnishing = {
      id, form: spec.form,
      x: pose.x, y: pose.y, rotation: pose.rotation,
      width: spec.width, depth: spec.depth,
    };
    writeSpec(f, spec);
    if (pose.mirrored) f.mirrored = true;
    if (this.symbolColor) f.color = this.symbolColor;
    return f;
  }

  private placeFurnishing(): void {
    const c = this.draftFurnishing(newId("i"));
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      (f.furnishings ??= []).push(c);
      // A run ends at a fornuis or a wastafel as readily as at a socket, so
      // fit-out connects the same way a symbol does.
      connectDevice(f, c, key => routeTakesFurnishing(key, c));
    });
    this.store.select({ kind: "furnishing", id: c.id });
  }

  /** Topmost furnishing whose footprint (plus the 30 mm grab margin) covers `w`. */
  private furnishingAt(w: Vec): Furnishing | undefined {
    const list = furnishingsOf(this.floor);
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]!;
      if (furnishingHit(c, w, 30)) return c;
    }
    return undefined;
  }

  // ---- room names ----
  /**
   * Write, change or clear the name of a detected room.
   *
   * The document stores the word and the point it was written at; which room
   * carries it follows from that point, so a new name goes to the room's
   * interior anchor rather than to wherever a cursor happened to be. An empty
   * name deletes the record — a blank name is not a name, and leaving one
   * behind would keep the room from taking the next one written in it.
   */
  renameRoom(room: Room, name: string): void {
    const text = name.trim();
    const id = room.nameId;
    if (!id && !text) return;
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      if (id) {
        if (!text) { f.roomNames = roomNamesOf(f).filter(r => r.id !== id); return; }
        const rn = roomNamesOf(f).find(r => r.id === id);
        if (rn) rn.name = text;
        return;
      }
      const at = roomAnchor(room);
      (f.roomNames ??= []).push({ id: newId("r"), x: at.x, y: at.y, name: text });
    });
  }

  /** Rename or remove a stored label that is not attached to a detected room. */
  renameRoomName(id: string, name: string): void {
    const text = name.trim();
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      if (!text) { f.roomNames = roomNamesOf(f).filter(r => r.id !== id); return; }
      const rn = roomNamesOf(f).find(r => r.id === id);
      if (rn) rn.name = text;
    });
  }

  /**
   * Set or clear what a named room is used for. `use` rides on the RoomName
   * (see model/room.ts), so this needs the name's own id and does nothing for
   * a room that has not been named yet -- there is nowhere to store the use.
   */
  setRoomUse(id: string, use: RoomUse | undefined): void {
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      const rn = roomNamesOf(f).find(r => r.id === id);
      if (!rn) return;
      if (use) rn.use = use; else delete rn.use;
    });
  }

  /** This room's own finished ceiling height, or undefined to fall back to the
   *  storey's. Rides on the name for the reason the use does -- see RoomName. */
  setRoomCeiling(id: string, mm: number | undefined): void {
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      const rn = roomNamesOf(f).find(r => r.id === id);
      if (!rn) return;
      if (mm === undefined) delete rn.ceilingMm; else rn.ceilingMm = Math.max(100, Math.round(mm));
    });
  }

  /**
   * The room whose label on the canvas covers screen point `s`. The box is
   * generous horizontally because a label is as wide as the word in it, and
   * this is tested only after everything drawn has had its chance at the click.
   */
  private roomLabelAt(s: Vec): Room | undefined {
    for (const r of this.getRooms()) {
      const c = this.vp.toScreen(r.centroid);
      const halfY = ROOM_LABEL_HIT_PX.y * (r.name === undefined ? 1 : 2);
      if (Math.abs(s.x - c.x) <= ROOM_LABEL_HIT_PX.x && Math.abs(s.y - c.y) <= halfY) return r;
    }
    return undefined;
  }

  /** Topmost vide covering `w`. Picked after the walls: a vide is floor level. */
  private videAt(w: Vec): Vide | undefined {
    const list = videsOf(this.floor);
    for (let i = list.length - 1; i >= 0; i--) {
      const vd = list[i]!;
      if (videHit(vd, w, 30)) return vd;
    }
    return undefined;
  }

  // ---- select tool ----
  /**
   * True when a press on a selectable object should build the selection
   * rather than replace it -- the desktop shift-click, or a touch/pen hold
   * that has already dropped the tool into selectMode (see selectDownHold()).
   * One flag, so every kind below picks through the same helper instead of
   * cabinet alone special-casing shift the way it used to.
   */
  private get multiPick(): boolean { return this.shiftKey || this.selectMode; }

  /**
   * Picks `sel`: builds the group (selectAlso) under multiPick, otherwise
   * replaces it -- but keeps an already-grouped member selected rather than
   * collapsing to just this one, or a group could never be taken hold of to
   * drag. Returns whether the caller may still start a drag: multiPick never
   * does (building a group is the whole gesture, the way shift-click never
   * used to drag a cabinet), a plain pick always does.
   */
  private pick(sel: Selection): boolean {
    if (this.multiPick) { this.store.selectAlso(sel); this.requestRender(); return false; }
    if (!this.store.isSelected(sel.kind, sel.id)) this.store.select(sel);
    return true;
  }

  private selectDown(s: Vec, w: Vec): void {
    this.lengthBuffer = "";
    this.closeDimInput();
    // Cmd/Ctrl-click adds a waypoint to the run under the pointer -- the
    // desktop twin of the double-tap (see onTap). Checked before anything
    // else, since the modifier says what the press is FOR.
    if (this.modKey && (this.addRouteNodeAt(w) || this.addWallNodeAt(w))) return;
    const f = this.floor;
    const res = this.getResolved();
    const tol = 10 / this.vp.pxPerMm;

    // Bow handle of selected wall?
    const selWall = this.store.sel?.kind === "wall" ? f.walls.find(x => x.id === this.store.sel!.id) : undefined;
    if (selWall) {
      const a = f.nodes.find(n => n.id === selWall.a)!, b = f.nodes.find(n => n.id === selWall.b)!;
      const handle = arcPointAt(v(a.x, a.y), v(b.x, b.y), selWall.bulge, 0.5);
      if (dist(w, handle) <= tol * 1.5) {
        this.drag = { kind: "bow", id: selWall.id, startWorld: w, moved: false };
        return;
      }
    }

    // A waypoint of the SELECTED route: checked before the generic node loop,
    // since these are marks the route tool draws, not graph nodes. Dropping
    // one on a symbol re-anchors it -- dragMove's routeVertex branch runs
    // through the same computeRouteSnap() the tool itself draws with.
    const activeRoute = this.activeRouteId;
    const selRoute = activeRoute ? routesOf(f).find(x => x.id === activeRoute) : undefined;
    if (selRoute) {
      const marks = resolveRoutePoints(f, selRoute);
      for (let i = 0; i < marks.length; i++) {
        if (dist(marks[i]!, w) <= tol * 1.5) {
          // Picked as well as dragged, so Del takes out the point rather than
          // the run -- the twin of a wall node, which selects on the same press.
          const point = selRoute.points[i];
          if (point) this.store.select({ kind: "routePoint", id: point.id, routeId: selRoute.id });
          this.drag = { kind: "routeVertex", id: selRoute.id, pointIndex: i, startWorld: w, moved: false };
          return;
        }
      }
    }

    // Nodes. Never multi-picked: a node is a graph junction, not an object a
    // plan bulk-edits (see the comment on Selection in model/store.ts), so it
    // always replaces the selection and always starts its own drag, even
    // under multiPick.
    for (const n of f.nodes) {
      if (dist(v(n.x, n.y), w) <= tol) {
        this.store.select({ kind: "node", id: n.id });
        this.drag = { kind: "node", id: n.id, startWorld: w, moved: false };
        return;
      }
    }
    // Stairs, then symbols: picking follows the drawing order, topmost first.
    // A flight is drawn over the symbols it crosses, so a click on it must not
    // reach past it to something underneath.
    const stairPick = this.stairAt(w);
    if (stairPick) {
      if (this.pick({ kind: "stair", id: stairPick.id })) {
        this.drag = { kind: "stair", id: stairPick.id, startWorld: w, moved: false, clone: this.altKey };
      }
      return;
    }
    const symHit = this.symbolAt(w);
    if (symHit) {
      if (this.pick({ kind: "symbol", id: symHit.id })) {
        this.drag = { kind: "symbol", id: symHit.id, startWorld: w, moved: false, clone: this.altKey };
      }
      return;
    }
    // The fit-out after the symbols it holds: a socket drawn on a unit's front
    // has to stay clickable, and a carcass is the larger target underneath.
    const fitPick = this.furnishingAt(w);
    if (fitPick) {
      if (this.pick({ kind: "furnishing", id: fitPick.id })) {
        this.drag = { kind: "furnishing", id: fitPick.id, startWorld: w, moved: false, clone: this.altKey };
      }
      return;
    }
    // A riser mark, before the runs themselves: it is drawn on top of the point
    // it belongs to, and where several coincident services share one mark, a
    // repeated click steps through its members -- a shaft carrying five
    // circuits is reachable without pixel hunting for the fourth. The count
    // badge is a grouping of the drawing, never a merged cable.
    const riser = this.riserPick(w);
    if (riser) { this.pick({ kind: "route", id: riser }); return; }
    // Routes, over the masonry and under whatever stands on them -- the same
    // order they draw in (see render/draw.ts). Never draggable from a plain
    // press (see routeVertex above), grouped or not -- an anchored point
    // would fight a whole-route translation, so v1 leaves routes out of group
    // drag entirely.
    const routePick = this.routeAt(w);
    if (routePick) {
      this.pick({ kind: "route", id: routePick.route.id });
      return;
    }
    // Openings (near their centerline center). Not group-draggable: an
    // opening lives on its wall (t = distance from node a), so "move the
    // group" has no meaning independent of the walls underneath -- a press on
    // one still moves only that one, even with several selected.
    for (const rw of res.walls.values()) {
      for (const og of rw.openings) {
        if (dist(og.center, w) <= Math.max(og.opening.width / 2, tol)) {
          if (this.pick({ kind: "opening", id: og.opening.id, wallId: rw.wall.id })) {
            this.drag = { kind: "opening", id: og.opening.id, wallId: rw.wall.id, startWorld: w, moved: false };
          }
          return;
        }
      }
    }
    // Walls (point in outline). Not group-draggable either: a wall is two
    // shared nodes, and translating every selected wall independently would
    // tear the graph apart at whichever corners they share with a wall that
    // was not selected -- a press still moves only the one under the pointer.
    for (const rw of res.walls.values()) {
      if (pointInPolygon(w, rw.outline)) {
        if (this.pick({ kind: "wall", id: rw.wall.id })) {
          this.drag = { kind: "wall", id: rw.wall.id, startWorld: w, moved: false };
        }
        return;
      }
    }
    // A vide last of all: it is the floor, so anything standing on it wins the
    // click, and its own area is otherwise empty.
    const videPick = this.videAt(w);
    if (videPick) {
      if (this.pick({ kind: "vide", id: videPick.id })) {
        this.drag = { kind: "vide", id: videPick.id, startWorld: w, moved: false, clone: this.altKey };
      }
      return;
    }
    // Nothing drawn is under the pointer.
    if (this.shiftKey) {
      // A rubber-band marquee: world-space corners, so it tracks correctly
      // through a pan/zoom mid-drag. Resolved to a selection on release --
      // see marqueeUp(). Plain empty-space drag stays pan; this only takes
      // over once shift says "select a region" rather than "look around".
      this.drag = { kind: "marquee", startWorld: w, boxEnd: w, moved: false };
      return;
    }
    // A press on empty paper clears the selection, in selectMode as much as
    // out of it: pressing next to a thing to let go of it is what every other
    // tool does, and a mode that swallowed the press instead left no way out
    // of it on the canvas at all. Clearing `sel` also ends the mode -- the
    // constructor's store.onChange() exits it whenever the selection empties,
    // which is the same route undo already takes back past a gathered group.
    //
    // The one thing still worth a press here is the area figure, and the name
    // over it when there is one: it opens that room's row in the zoom pane,
    // which is where a name is written. Held until the release so a pan that
    // starts over a label is still a pan.
    this.store.select(null);
    this.drag = {
      kind: "pan", startWorld: w, moved: false, lastScreen: s, startScreen: s,
      labelRoom: this.roomLabelAt(s),
    };
  }

  /**
   * selectDown() plus the long-press hold: enters selectMode ~500ms into a
   * press that has not moved, on a selectable (non-node) object. selectDown()
   * always runs first and unchanged, so an ordinary tap and a tap-then-drag
   * are exactly what they were before; only a press that STAYS still for the
   * whole delay does anything extra.
   *
   * Reached from the touch/pen branch of onDown() only. The mouse ran through
   * here too and should not: a press that pauses before it moves is a normal
   * way to start a drag, and the timer fired mid-hesitation, so the drag was
   * abandoned and the object toggled into a mode the visitor had not asked
   * for. Shift+click and Shift+drag build a group on desktop; a finger has
   * neither, which is what the hold is for.
   */
  private selectDownHold(s: Vec, w: Vec): void {
    // Already in the mode: every tap already toggles (see pick()), so a
    // second hold has nothing to add.
    if (this.selectMode) { this.selectDown(s, w); return; }
    const base = { sel: this.store.sel, selMore: [...this.store.selMore] };
    this.selectDown(s, w);
    // A press that landed on a handle -- a selected route's waypoint or a
    // selected wall's bow handle -- is aiming that handle, not picking the
    // object up fresh; its owning object (route/wall) is still `sel` and IS
    // in MULTI_SELECT_KINDS, so without this guard the hold would fire
    // mid-aim, null the drag and toggle the selection out from under it (see
    // isHandleDrag() below).
    if (this.drag && isHandleDrag(this.drag.kind)) return;
    const target = this.store.sel;
    if (!target || !MULTI_SELECT_KINDS.has(target.kind)) return;
    this.longPressFrom = s;
    this.longPressBase = base;
    this.longPressTarget = target;
    this.longPressTimer = setTimeout(() => this.fireLongPress(), TAP_MS);
  }

  /** The hold fired: drop into selectMode with the pressed object toggled
   *  into whatever was selected before the press replaced it. */
  private fireLongPress(): void {
    this.longPressTimer = null;
    const target = this.longPressTarget, base = this.longPressBase;
    this.longPressFrom = null;
    this.longPressTarget = null;
    this.longPressBase = null;
    if (!target || !base) return;
    // A drag selectDown() may have started (e.g. a cabinet's re-pose) is
    // abandoned, not finished -- the hold means "start selecting", not "move
    // this" -- and this pointer's later movement must not resume one.
    this.drag = null;
    this.tapStart = null;
    this.store.sel = base.sel;
    this.store.selMore = base.selMore;
    this.store.selectAlso(target);
    this.selectMode = true;
    this.updateHint();
    this.requestRender();
  }

  /** Movement past the drag threshold, or a release, before the hold fires:
   *  falls through to today's drag/tap behavior, already under way. */
  private cancelLongPress(): void {
    if (this.longPressTimer !== null) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    this.longPressFrom = null;
    this.longPressTarget = null;
    this.longPressBase = null;
  }

  /** The "Done" affordance: leaves selectMode with the selection intact, so
   *  the visitor lands directly in its bulk-edit pane. */
  exitSelectMode(): void {
    if (!this.selectMode) return;
    this.selectMode = false;
    this.updateHint();
    this.onToolChange();
  }

  /**
   * The canvas's select-mode badge, or null while the mode is off: how many
   * are gathered, and the chrome inset it has to clear (the compact layout
   * floats its top bar over a full-bleed canvas -- see Panel.canvasInsets).
   * The mode changes what a tap does, so the surface the taps land on is
   * where it has to be legible: the panel's Done affordance can sit under a
   * peeking sheet, and the hint line reads as one more line of hint text.
   *
   * Read by the live canvas alone. The loupe and every export take their
   * DrawExtras from elsewhere and so never draw it -- an editor mode is not
   * part of the drawing.
   */
  selectModeBadge(): { n: number; top: number } | null {
    const sel = this.store.sel;
    if (!this.selectMode || !sel) return null;
    return { n: this.store.selectedOf(sel.kind).length, top: this.viewInsets?.().top ?? 0 };
  }

  /**
   * The rubber-band marquee's release: everything of the dominant kind fully
   * inside the dragged rect (see marquee.ts) replaces the selection outright.
   * A tiny drag (a shift-click that barely moved) resolves against a
   * zero-area rect, which simply catches nothing.
   */
  private marqueeUp(d: DragState): void {
    const end = d.boxEnd ?? d.startWorld;
    const rect: MarqueeRect = {
      min: v(Math.min(d.startWorld.x, end.x), Math.min(d.startWorld.y, end.y)),
      max: v(Math.max(d.startWorld.x, end.x), Math.max(d.startWorld.y, end.y)),
    };
    const picked = marqueePick(this.floor, rect);
    if (picked) this.store.selectMany(picked.kind, picked.ids);
    else this.store.select(null);
  }

  /**
   * The zoom tool's press: begin a window. A press that turns out to be a click
   * rather than a drag frames the room under it — see zoomUp().
   */
  private zoomDown(s: Vec, w: Vec): void {
    this.drag = { kind: "zoomBox", startWorld: w, boxEnd: w, moved: false, lastScreen: s };
  }

  /** The zoom tool's release: a dragged window, or a click on a room. */
  private zoomUp(d: DragState): void {
    const end = d.boxEnd ?? d.startWorld;
    // A window smaller than a few pixels is a click, not a drag.
    const small = dist(this.vp.toScreen(d.startWorld), this.vp.toScreen(end)) < 8;
    if (!small) { this.fitWorldBox(d.startWorld, end); return; }
    const room = this.roomAt(d.startWorld);
    if (room) this.fitRoom(room); else this.fitAll();
  }

  /** Topmost placed symbol whose footprint (plus a 30 mm grab margin) covers `w`. */
  private symbolAt(w: Vec): SymbolInstance | undefined {
    const f = this.floor;
    for (let i = f.symbols.length - 1; i >= 0; i--) {
      const sym = f.symbols[i]!;
      const def = getSymbol(sym.type);
      if (!def) continue;
      const local = this.toLocal(w, sym.x, sym.y, sym.rotation, !!sym.mirrored); // inverse transform
      const y0 = def.wallMounted ? 0 : -def.depth / 2;
      if (local.x >= -def.width / 2 - 30 && local.x <= def.width / 2 + 30 && local.y >= y0 - 30 && local.y <= y0 + def.depth + 30)
        return sym;
    }
    return undefined;
  }

  /** Topmost stair whose footprint (plus the same 30 mm grab margin) covers `w`. */
  private stairAt(w: Vec): Stair | undefined {
    const list = stairsOf(this.floor);
    for (let i = list.length - 1; i >= 0; i--) {
      const st = list[i]!;
      if (stairHit(resolveStair(this.floor, st), w, 30)) return st;
    }
    return undefined;
  }

  /** Where a symbol's name label points: the centre of its footprint. */
  private symbolLabelPoint(sym: SymbolInstance, def: SymbolDef): Vec {
    return add(v(sym.x, sym.y), fromAngleRot(v(0, def.wallMounted ? def.depth / 2 : 0), sym.rotation));
  }

  private toLocal(p: Vec, x: number, y: number, rot: number, mirrored: boolean): Vec {
    let d = sub(p, v(x, y));
    d = fromAngleRot(d, -rot);
    if (mirrored) d = v(-d.x, d.y);
    return d;
  }

  /**
   * Alt-drag: the gesture takes a copy and leaves the original where it was, so
   * something already turned, coloured and sized is placed again without any of
   * that being set up a second time. Several selected cabinets copy together.
   * Returns the id to go on dragging, or null when nothing was copied.
   *
   * The copy is made on the first movement rather than at the press, so alt
   * held over a click that goes nowhere leaves no duplicate on the original.
   */
  private cloneForDrag(kind: PlacedKind, id: Id): Id | null {
    const group = this.store.isSelected(kind, id) ? this.store.selectedOf(kind) : [id];
    let made = new Map<Id, Id>();
    this.store.mutate(doc => { made = cloneOnFloor(this.store.floorOf(doc), kind, group); });
    const dragId = made.get(id);
    if (dragId === undefined) return null;
    // The copy under the cursor leads, so the pane keeps showing what is being
    // dragged and a group of them stays a group.
    this.store.selectMany(kind, [dragId, ...group.flatMap(o => {
      const clone = made.get(o);
      return clone === undefined || clone === dragId ? [] : [clone];
    })]);
    return dragId;
  }

  /**
   * Group drag for the translatable placed kinds (symbol, cabinet, stair,
   * vide): several move by the same grid-quantised delta rather than each
   * taking its own snap, or a run/arrangement would pull itself apart under
   * the drag. Walls, nodes, openings and routes never call this -- see the
   * comments in selectDown() for why each is excluded.
   *
   * `always` is true for stair and vide, whose single-item drag was already a
   * delta nudge with no snap of its own -- one code path covers one selected
   * or several. It is false for symbol and furnishing, whose single-item drag
   * re-poses under the cursor (wall snap, run snap): with one selected this
   * returns false so the caller runs that logic unchanged, exactly as before
   * this generalised the fit-out-only group branch to every translatable
   * kind. Returns whether it handled the move.
   */
  private groupTranslate(
    d: DragState, w: Vec, g: number, group: readonly Id[],
    kind: "symbol" | "furnishing" | "stair" | "vide", always = false,
  ): boolean {
    const grouped = group.length > 1;
    if (!always && !grouped) return false;
    const delta = sub(w, d.startWorld);
    const dx = Math.round(delta.x / g) * g, dy = Math.round(delta.y / g) * g;
    if (dx === 0 && dy === 0) return true;
    d.startWorld = add(d.startWorld, v(dx, dy));
    const targets = grouped ? group : [d.id!];
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      const list: Array<{ id: Id; x: number; y: number }> =
        kind === "symbol" ? f.symbols
        : kind === "furnishing" ? furnishingsOf(f)
        : kind === "stair" ? stairsOf(f)
        : videsOf(f);
      for (const item of list) if (targets.includes(item.id)) { item.x += dx; item.y += dy; }
    }, "drag" + d.id);
    return true;
  }

  private dragMove(s: Vec, w: Vec): void {
    const d = this.drag!;
    d.moved = true;
    const g = this.gridStep;

    if (d.clone) {
      d.clone = false;
      const kind = d.kind === "symbol" || d.kind === "furnishing"
        || d.kind === "stair" || d.kind === "vide" ? d.kind : null;
      const copy = kind && d.id ? this.cloneForDrag(kind, d.id) : null;
      if (copy) d.id = copy;
    }

    if (d.kind === "pan") {
      if (d.lastScreen) this.vp.panPx(s.x - d.lastScreen.x, s.y - d.lastScreen.y);
      d.lastScreen = s;
      this.requestRender();
      return;
    }
    if (d.kind === "node") {
      const snap = this.computeSnap(w, false, d.id);
      this.store.mutate(doc => {
        const n = this.store.floorOf(doc).nodes.find(x => x.id === d.id);
        if (n) { n.x = Math.round(snap.p.x); n.y = Math.round(snap.p.y); }
      }, "drag" + d.id);
    } else if (d.kind === "wall") {
      const delta = sub(w, d.startWorld);
      const dx = Math.round(delta.x / g) * g, dy = Math.round(delta.y / g) * g;
      if (dx !== 0 || dy !== 0) {
        d.startWorld = add(d.startWorld, v(dx, dy));
        this.store.mutate(doc => {
          const f = this.store.floorOf(doc);
          const wall = f.walls.find(x => x.id === d.id);
          if (!wall) return;
          for (const nid of [wall.a, wall.b]) {
            const n = f.nodes.find(x => x.id === nid);
            if (n) { n.x += dx; n.y += dy; }
          }
        }, "drag" + d.id);
      }
    } else if (d.kind === "symbol") {
      const group = this.store.selectedOf("symbol");
      if (this.groupTranslate(d, w, g, group, "symbol")) return;
      this.store.mutate(doc => {
        const sym = this.store.floorOf(doc).symbols.find(x => x.id === d.id);
        if (!sym) return;
        const saveType = this.symbolType;
        this.symbolType = sym.type;
        const pose = this.symbolPose();
        this.symbolType = saveType;
        // A symbol that is not landing on a wall keeps the angle it was turned
        // to. symbolPose() answers for a placement, where zero is the right
        // default; a drag moves something that has already been aimed, and
        // dropping a desk back to square is not a move.
        Object.assign(sym, pose.wallId === undefined ? { ...pose, rotation: sym.rotation } : pose);
        if (!getSymbol(sym.type)?.wallMounted) delete sym.wallId;
      }, "drag" + d.id);
    } else if (d.kind === "stair") {
      // Moved by a quantised delta rather than re-posed under the cursor: the
      // anchor of a stair is the foot of the flight, not the point grabbed --
      // true of one stair or several, so groupTranslate() covers both.
      this.groupTranslate(d, w, g, this.store.selectedOf("stair"), "stair", true);
    } else if (d.kind === "vide") {
      this.groupTranslate(d, w, g, this.store.selectedOf("vide"), "vide", true);
    } else if (d.kind === "furnishing") {
      const group = this.store.selectedOf("furnishing");
      if (this.groupTranslate(d, w, g, group, "furnishing")) return;
      // One on its own is re-posed under the cursor rather than nudged by a
      // delta: a wall-mounted piece snaps to walls and to its neighbours, and a
      // dragged one has to take those snaps or a run cannot be rearranged once
      // built. A free-standing piece has neither, so it follows the cursor.
      this.store.mutate(doc => {
        const c = furnishingsOf(this.store.floorOf(doc)).find(x => x.id === d.id);
        if (!c) return;
        const loose = { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g, rotation: c.rotation };
        if (!furnishingWallMounted(c.form)) { Object.assign(c, loose); return; }
        const snap = this.wallSnap();
        const base = snap ? { x: snap.x, y: snap.y, rotation: snap.rotation } : loose;
        Object.assign(c, base, this.runSnap(base, c.width, c.id) ?? {});
      }, "drag" + d.id);
    } else if (d.kind === "zoomBox" || d.kind === "marquee") {
      d.boxEnd = w;
      this.requestRender();
    } else if (d.kind === "bow") {
      this.store.mutate(doc => {
        const f = this.store.floorOf(doc);
        const wall = f.walls.find(x => x.id === d.id);
        if (!wall) return;
        const a = f.nodes.find(n => n.id === wall.a)!, b = f.nodes.find(n => n.id === wall.b)!;
        const A = v(a.x, a.y), B = v(b.x, b.y);
        const chordDir = norm(sub(B, A));
        const sag = dot(sub(w, scale(add(A, B), 0.5)), perp(chordDir));
        const snapped = Math.abs(sag) < 60 ? 0 : Math.round(sag / 10) * 10;
        wall.bulge = bulgeFromSagitta(A, B, snapped);
      }, "bow" + d.id);
    } else if (d.kind === "opening") {
      this.store.mutate(doc => {
        const f = this.store.floorOf(doc);
        const wall = f.walls.find(x => x.id === d.wallId);
        const o = wall?.openings.find(x => x.id === d.id);
        if (!wall || !o) return;
        const nw = nearestWall(f, w, 1e9);
        if (nw && nw.wall.id === wall.id) {
          o.t = Math.round(nw.tMm / 10) * 10;
          clampOpening(f, wall, o);
        }
      }, "drag" + d.id);
    } else if (d.kind === "routeVertex") {
      const idx = d.pointIndex!;
      const currentRoute = routesOf(this.floor).find(route => route.id === d.id);
      const snap = this.computeRouteSnap(w, currentRoute?.discipline,
        currentRoute?.discipline === "water" ? routeWater(currentRoute) : this.routeWater,
        currentRoute ? routeInstallation(currentRoute) : this.routeInstallation,
        currentRoute?.discipline === "vent" ? routeVent(currentRoute) : this.routeVent,
        currentRoute?.discipline === "electrical" ? routeKind(currentRoute) : this.routeKind,
        currentRoute?.discipline === "heating" ? routeHeat(currentRoute) : this.routeHeat);
      this.store.mutate(doc => {
        const route = routesOf(this.store.floorOf(doc)).find(x => x.id === d.id);
        const pt = route?.points[idx];
        if (!pt) return;
        pt.x = Math.round(snap.p.x); pt.y = Math.round(snap.p.y);
        if (snap.anchor) {
          pt.anchor = snap.anchor;
          delete pt.wallId; delete pt.wallT; delete pt.wallSide;
        } else {
          delete pt.anchor;
          if (snap.wallId && snap.wallT !== undefined) {
            pt.wallId = snap.wallId; pt.wallT = snap.wallT; pt.wallSide = snap.wallSide;
          } else {
            delete pt.wallId; delete pt.wallT; delete pt.wallSide;
          }
        }
      }, "drag" + d.id + ":" + idx);
    }
  }

  // ---- keyboard ----
  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (e.shiftKey !== this.shiftKey) {
      this.shiftKey = e.shiftKey;
      this.shiftChanged();
    }

    // A calibration capture is modal: every key it does not itself use is
    // swallowed rather than falling through to a tool shortcut, so "typing 6
    // 0 0" while calibrating never also arms the cabinet tool via "c".
    if (this.calibArmed) {
      if (this.calibratingDistance) {
        if (/^[0-9.]$/.test(e.key)) { this.typeLength(e.key); return; }
        if (e.key === "Backspace" && this.lengthBuffer) { this.backspaceLength(); return; }
        if (e.key === "Enter" && this.lengthBuffer) { this.commitLength(); return; }
      }
      if (e.key === "Escape") { this.cancelCalibration(); return; }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.store.redo(); else this.store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this.store.redo(); return; }
    if (e.ctrlKey || e.metaKey) return;

    // The 3D view is modal for the keyboard the way calibration is: the plan
    // is not the thing on screen, so a tool shortcut would arm a tool nothing
    // can see. Undo/redo stay live above -- a mutation rebuilds the mesh.
    if (this.view3d) {
      if (e.key === "Escape" || e.key === "3") this.setView3d(false);
      else if (e.key === "f" || e.key === "F") this.onView3dFit?.();
      return;
    }

    // Typed mm entry, in the two states typingLength describes. The keypad
    // calls the same methods, so the keyboard and the touch pad cannot drift.
    if (this.typingLength) {
      if (/^[0-9.]$/.test(e.key)) { this.typeLength(e.key); return; }
      if (e.key === "Backspace" && (this.lengthBuffer || this.chainStart)) { this.backspaceLength(); return; }
      if (e.key === "Enter" && this.lengthBuffer) { this.commitLength(); return; }
      if (e.key === "Escape" && this.lengthBuffer) { this.clearLength(); return; }
    }

    switch (e.key) {
      // Escape ends a route chain by COMMITTING it (routeStart !== null means
      // there is something to commit): unlike a wall chain, nothing has
      // reached the document yet, so a bare cancel() here would silently
      // throw the whole run away. Every other cancel -- an unfinished wall
      // chain, a drag, a shape's first point -- still just unwinds.
      case "Escape":
        if (this.tool === "route" && this.routeStart) { this.commitRoute(); this.updateHint(); break; }
        this.cancel(); this.updateHint(); break;
      case "v": case "V": this.setTool("select"); break;
      // W arms the wall tool; pressing it again steps through the shapes it
      // draws, so the four live behind one key and one rail button.
      case "w": case "W":
        if (this.tool === "wall") this.cycleWallShape(); else this.setTool("wall");
        break;
      case "d": case "D": this.setTool("door"); break;
      case "n": case "N": this.setTool("window"); break;
      case "p": case "P": this.setTool("passage"); break;
      // Symbol tool used to be reachable only by clicking the palette; give it a shortcut too.
      case "s": case "S": this.setTool("symbol"); break;
      // T for trap: the stair tool, armed with whatever kind was last chosen.
      case "t": case "T": this.setTool("stair"); break;
      // H for the hole in the floor: the vide tool.
      case "h": case "H": this.setTool("vide"); break;
      // C for the fit-out — cabinetry and everything placed with it. Z for the
      // zoom window and the room list.
      case "c": case "C": this.setTool("furnishing"); break;
      // U for utiliteiten: the services tool -- the runs and the terminals they
      // end at. Every other short mnemonic it suggests is already spoken for --
      // R rotates, L is the measurements toggle, S arms the last symbol -- so
      // this reaches past the obvious "R" to the next free letter that reads.
      case "u": case "U": this.setTool("route"); break;
      case "z": case "Z": this.setTool("zoom"); break;
      // Fit, in any tool: the whole plan, or the selection with Shift. Zoom-all
      // is the move a drawing is read with, so it does not live behind a tool.
      case "f": case "F": if (e.shiftKey) this.fitSelection(); else this.fitAll(); break;
      case "o": case "O": this.ortho = !this.ortho; this.updateHint(); this.onToolChange(); break;
      case "g": case "G": this.snapGrid = !this.snapGrid; this.updateHint(); this.onToolChange(); this.requestRender(); break;
      case "l": case "L": this.showDims = !this.showDims; this.onToolChange(); this.requestRender(); break;
      case "r": case "R": this.rotateSelected(); break;
      case "m": case "M": this.mirrorSelected(); break;
      // 3 for the third dimension: the extruded view of the whole building.
      case "3": this.setView3d(true); break;
      // Nothing else reads Enter without a typed length in the buffer, and
      // closing the ring is what a chain is usually four clicks away from.
      case "Enter": if (this.tool === "wall") this.closeChain(); break;
      // preventDefault, or Backspace navigates the page back on browsers that
      // still bind it -- losing the drawing to a history entry.
      case "Delete": case "Backspace": e.preventDefault(); this.deleteSelected(); break;
    }
  }

  /** Resize the selected wall to the typed length. */
  private applyTypedLength(): void {
    const sel = this.store.sel;
    const mm = parseFloat(this.lengthBuffer);
    this.lengthBuffer = "";
    if (sel?.kind !== "wall" || !isFinite(mm) || mm < 50) { this.updateHint(); this.onToolChange(); return; }
    this.resizeWall(sel.id, mm);
    this.updateHint();
    this.onToolChange();
  }

  /** Set a wall's length to mm by moving its less-connected endpoint (the free
   * end), so the rest of the plan stays anchored. Ties move node b. */
  resizeWall(wallId: string, mm: number): void {
    if (!isFinite(mm) || mm < 50) return;
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      const wall = f.walls.find(x => x.id === wallId);
      if (!wall) return;
      const a = f.nodes.find(x => x.id === wall.a)!, b = f.nodes.find(x => x.id === wall.b)!;
      const degA = f.walls.filter(x => x.id !== wall.id && (x.a === wall.a || x.b === wall.a)).length;
      const degB = f.walls.filter(x => x.id !== wall.id && (x.a === wall.b || x.b === wall.b)).length;
      const [anchor, moving] = degB <= degA ? [a, b] : [b, a];
      const AA = v(anchor.x, anchor.y), MM = v(moving.x, moving.y);
      const L = wallLength(f, wall);
      const chord = dist(AA, MM);
      if (chord < 1) return;
      const dir = norm(sub(MM, AA));
      // Arcs: bulge is chord-proportional, so scaling the chord scales arc length.
      const newChord = wall.bulge === 0 ? mm : (chord * mm) / L;
      const np = add(AA, scale(dir, newChord));
      moving.x = Math.round(np.x); moving.y = Math.round(np.y);
    });
  }

  private openDimInput(rect: { x: number; y: number; w: number; h: number; wallId: string }): void {
    const f = this.floor;
    const wall = f.walls.find(x => x.id === rect.wallId);
    if (!wall) return;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "dim-input";
    input.value = String(Math.round(wallLength(f, wall)));
    input.style.left = `${rect.x - 8}px`;
    input.style.top = `${rect.y - 4}px`;
    const commit = (): void => {
      const mm = parseFloat(input.value);
      this.closeDimInput();
      if (isFinite(mm)) this.resizeWall(rect.wallId, mm);
    };
    input.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === "Enter") commit();
      if (ev.key === "Escape") this.closeDimInput();
    };
    input.onblur = () => this.closeDimInput();
    this.canvas.parentElement!.append(input);
    this.dimInput = input;
    // Focus after the pointer event's default action, so the canvas doesn't
    // immediately steal it back and blur-close the input.
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  private closeDimInput(): void {
    const input = this.dimInput;
    this.dimInput = null; // null first: removing a focused input re-fires blur
    input?.remove();
  }

  /**
   * A quarter turn for a stair, an eighth for a symbol. A flight follows the
   * stairwell, which follows the walls; a socket does not. The property pane
   * takes any angle either way.
   *
   * A placed object turns about the middle of its footprint, not about its
   * anchor: a stair and a cabinet are anchored to the edge that meets the wall,
   * so turning about the anchor would swing the object clear across the plan.
   */
  private rotateSelected(): void {
    // While the stair tool is armed, R turns the ghost rather than whatever is
    // still selected from the last placement.
    if (this.tool === "stair") {
      this.stairRotation = stairAngle(this.stairRotation + Math.PI / 2);
      this.onToolChange();
      this.requestRender();
      return;
    }
    if (this.tool === "vide") {
      this.videRotation = stairAngle(this.videRotation + Math.PI / 2);
      this.onToolChange();
      this.requestRender();
      return;
    }
    if (this.tool === "furnishing") {
      this.furnishingRotation = stairAngle(this.furnishingRotation + Math.PI / 2);
      this.onToolChange();
      this.requestRender();
      return;
    }
    const sel = this.store.sel;
    if (sel?.kind === "stair") {
      this.store.mutate(doc => {
        const floor = this.store.floorOf(doc);
        const st = stairsOf(floor).find(x => x.id === sel.id);
        if (!st) return;
        const turned = stairAngle(st.rotation + Math.PI / 2);
        Object.assign(st, turnAbout(st, stairBox(resolveStair(floor, st)), turned));
        st.rotation = turned;
      });
      return;
    }
    if (sel?.kind === "vide") {
      this.store.mutate(doc => {
        const vd = videsOf(this.store.floorOf(doc)).find(x => x.id === sel.id);
        if (vd) vd.rotation = stairAngle(vd.rotation + Math.PI / 2);
      });
      return;
    }
    if (sel?.kind === "furnishing") {
      const group = this.store.selectedOf("furnishing");
      this.store.mutate(doc => {
        for (const c of furnishingsOf(this.store.floorOf(doc))) {
          if (!group.includes(c.id)) continue;
          // Each about its own middle, so a row of units stays a row rather
          // than swinging around whichever one was clicked first.
          const turned = stairAngle(c.rotation + Math.PI / 2);
          Object.assign(c, turnAbout(c, furnishingBox(c), turned));
          c.rotation = turned;
        }
      });
      return;
    }
    if (sel?.kind !== "symbol") return;
    this.store.mutate(doc => {
      const s = this.store.floorOf(doc).symbols.find(x => x.id === sel.id);
      if (s && !getSymbol(s.type)?.wallMounted) s.rotation += Math.PI / 4;
    });
  }

  private mirrorSelected(): void {
    if (this.tool === "stair") {
      this.stairMirrored = !this.stairMirrored;
      this.onToolChange();
      this.requestRender();
      return;
    }
    // Mirroring a cabinet swaps the hinge side, which is the reason to reach
    // for M on one: the run turns the corner and the doors have to follow. The
    // same gesture puts a worktop's drainer on the other hand.
    if (this.tool === "furnishing") {
      this.furnishingMirrored = !this.furnishingMirrored;
      this.onToolChange();
      this.requestRender();
      return;
    }
    const sel = this.store.sel;
    if (sel?.kind === "furnishing") {
      const group = this.store.selectedOf("furnishing");
      this.store.mutate(doc => {
        for (const c of furnishingsOf(this.store.floorOf(doc))) {
          if (group.includes(c.id)) c.mirrored = !c.mirrored;
        }
      });
      return;
    }
    if (sel?.kind === "stair") {
      this.store.mutate(doc => {
        const st = stairsOf(this.store.floorOf(doc)).find(x => x.id === sel.id);
        if (st) st.mirrored = !st.mirrored;
      });
      return;
    }
    if (sel?.kind !== "symbol") return;
    this.store.mutate(doc => {
      const s = this.store.floorOf(doc).symbols.find(x => x.id === sel.id);
      if (s) s.mirrored = !s.mirrored;
    });
  }

  /**
   * Removes every selected member -- the whole group when several are
   * selected, one object otherwise -- through each kind's own delete path, in
   * ONE mutation, so undo restores the lot in a single step. Node is
   * intentionally not grouped (see selectDown()), so it always deletes alone.
   */
  deleteSelected(): void {
    const sel = this.store.sel;
    if (!sel) return;
    const group = this.store.selectedOf(sel.kind);
    // The rooms as they stand, for the names a merge is about to orphan: taking
    // a wall out joins two rooms, and the smaller one's name has nothing left
    // to name. Read before the mutation, since afterwards it is gone.
    const before = this.rooms();
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      if (sel.kind === "wall") {
        for (const id of group) deleteWall(f, id);
        deleteRoomNames(f, orphanedRoomNames(f, before));
      } else if (sel.kind === "node") {
        // Take out the NODE, not the walls it happens to join: a node between
        // two walls dissolves and they become one. See removeNode() in
        // core/join.ts, which follows removeRoutePoint()'s rule exactly so the
        // two halves of the editor behave the same way under the same key.
        removeNode(f, sel.id);
        deleteRoomNames(f, orphanedRoomNames(f, before));
      } else if (sel.kind === "routePoint") {
        if (sel.routeId) removeRoutePoint(doc, this.store.activeFloor, sel.routeId, sel.id);
      } else if (sel.kind === "symbol") {
        // Un-anchor every route point following any of these symbols, in the
        // SAME mutation that removes them -- see unanchorRoutePoints().
        for (const id of group) {
          const sym = f.symbols.find(s => s.id === id);
          if (sym) unanchorRoutePoints(f, sym);
        }
        f.symbols = f.symbols.filter(s => !group.includes(s.id));
      }
      else if (sel.kind === "stair") f.stairs = stairsOf(f).filter(s => !group.includes(s.id));
      else if (sel.kind === "vide") f.vides = videsOf(f).filter(s => !group.includes(s.id));
      else if (sel.kind === "route") {
        f.routes = routesOf(f).filter(r => !group.includes(r.id));
        if (doc.continuations) {
          for (const link of doc.continuations) {
            link.ports = link.ports.filter(p => p.floorId !== f.id || !group.includes(p.routeId));
          }
          doc.continuations = doc.continuations.filter(link => link.ports.length >= 2);
        }
      }
      else if (sel.kind === "furnishing") {
        // A run can end at a fornuis or a wastafel, so a furnishing is
        // un-anchored on the way out exactly as a symbol is.
        for (const id of group) {
          const fn = furnishingsOf(f).find(x => x.id === id);
          if (fn) unanchorRoutePoints(f, fn);
        }
        f.furnishings = furnishingsOf(f).filter(c => !group.includes(c.id));
      }
      else if (sel.kind === "opening") {
        for (const w of f.walls) w.openings = w.openings.filter(o => !group.includes(o.id));
      }
    });
    this.store.select(null);
  }

  /**
   * The hint key for `base`, in the voice of whatever is driving the editor.
   * The desktop wording names clicks and keys — "klik", "Del", "Esc" — none of
   * which a phone has, so every hint the two modes disagree about carries a
   * `touch` twin.
   */
  private hintKey(base: string): string {
    return this.touchUi
      ? `hint.touch${base[0]!.toUpperCase()}${base.slice(1)}`
      : `hint.${base}`;
  }

  updateHint(): void {
    const h = (base: string, vars?: Record<string, string | number>): string => t(this.hintKey(base), vars);
    // The 3D view replaces the canvas, so its navigation wording wins over
    // whatever tool stays armed underneath it.
    if (this.view3d) { this.hint = h("view3d"); return; }
    // Calibration overrides whatever the active tool would say: it captures
    // on top of it, so its own next-step instruction has to win.
    if (this.calibArmed) {
      this.hint = this.calibratingDistance
        ? h("calibrateDistance", { length: this.lengthBuffer || "0" })
        : this.calibP0 ? h("calibrateSecond") : h("calibrateFirst");
      return;
    }
    switch (this.tool) {
      case "wall": {
        if (this.wallShape !== "line") {
          const base = this.wallShape === "rect" ? "wallRect"
            : this.wallShape === "circle" ? "wallCircle" : "wallPolygon";
          this.hint = h(this.shapeStart ? base + "To" : base);
          break;
        }
        this.hint = this.chainStart
          ? (this.lengthBuffer ? h("wallTyped", { length: this.lengthBuffer }) : h("wallChain"))
          : h("wallStart");
        break;
      }
      case "select":
        this.hint = this.selectMode
          ? h("selectMode", { n: this.store.sel ? this.store.selectedOf(this.store.sel.kind).length : 0 })
          : this.store.sel?.kind === "wall"
          ? (this.lengthBuffer
            ? h("selectWallTyped", { length: this.lengthBuffer })
            : h("selectWall"))
          : this.store.sel?.kind === "furnishing" ? h("selectFurnishing")
          : this.store.sel?.kind === "route" ? h("selectRoute")
          : h("select");
        break;
      case "door": this.hint = h("door"); break;
      case "window": this.hint = h("window"); break;
      case "passage": this.hint = h("passage"); break;
      case "symbol": this.hint = h("symbol", { label: getSymbol(this.symbolType) ? t("symbol." + this.symbolType) : this.symbolType }); break;
      case "stair": this.hint = h("stair", { label: t("stair." + this.stairKind) }); break;
      case "vide": this.hint = h("vide"); break;
      case "route": this.hint = h("route"); break;
      case "furnishing": {
        const preset = furnishingPreset(this.furnishingPresetId);
        this.hint = h("furnishing", {
          label: preset ? t("furnishing." + preset.id) : t("panel.furnishingCustom"),
        });
        break;
      }
      case "zoom": this.hint = h("zoom"); break;
    }
  }

  /**
   * The shape about to be drawn, at the thickness it will have, labelled with
   * the figure being aimed for: the two sides of a rectangle, the diameter of a
   * circle, the side of a polygon.
   */
  private drawShapeGhost(ctx: CanvasRenderingContext2D, vp: Viewport, run: ShapeRun): void {
    const th = this.lastThickness;
    ctx.save();
    ctx.fillStyle = "rgba(61,65,72,0.35)";
    ctx.strokeStyle = "rgba(61,65,72,0.35)";
    ctx.lineWidth = th;
    for (let i = 0; i < run.points.length; i++) {
      const A = run.points[i]!, B = run.points[(i + 1) % run.points.length]!;
      const info = arcInfo(A, B, run.bulges[i] ?? 0);
      if (info) {
        ctx.beginPath();
        ctx.arc(info.center.x, info.center.y, info.radius, info.a0, info.a1, info.ccw);
        ctx.stroke();
      } else {
        const n = scale(perp(norm(sub(B, A))), th / 2);
        ctx.beginPath();
        ctx.moveTo(A.x + n.x, A.y + n.y);
        ctx.lineTo(B.x + n.x, B.y + n.y);
        ctx.lineTo(B.x - n.x, B.y - n.y);
        ctx.lineTo(A.x - n.x, A.y - n.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    const box = polyBounds(run.points);
    if (box) drawLabel(ctx, vp, mid(box.min, box.max), this.shapeFigure(run));
  }

  /** What the shape ghost is labelled with. */
  private shapeFigure(run: ShapeRun): string {
    const pts = run.points;
    if (this.wallShape === "rect") {
      return `${Math.abs(pts[1]!.x - pts[0]!.x)} \u00d7 ${Math.abs(pts[2]!.y - pts[1]!.y)} mm`;
    }
    if (this.wallShape === "circle" && this.shapeStart) {
      return `\u2300 ${Math.round(2 * dist(this.shapeStart, pts[0]!))} mm`;
    }
    return `${pts.length} \u00d7 ${Math.round(dist(pts[0]!, pts[1]!))} mm`;
  }

  /**
   * Distances from a point on a wall to both of that wall's ends, as dimension
   * lines. Drawn while something is being slid along a wall, so "150 mm from
   * the corner" is a thing you can hit by eye instead of by arithmetic.
   *
   * Distances are centerline-to-node, matching `t` and the panel's "from
   * corner" field — not to the finished inner corner. Like the wall dimension
   * layer, the line follows the chord on a curved wall while the numbers are
   * true arc lengths.
   */
  private drawWallOffsets(ctx: CanvasRenderingContext2D, vp: Viewport, px: number, wall: Wall, tMm: number, side: 1 | -1, clearMm = 0): void {
    const f = this.floor;
    const a = f.nodes.find(n => n.id === wall.a), b = f.nodes.find(n => n.id === wall.b);
    if (!a || !b) return;
    const A = v(a.x, a.y), B = v(b.x, b.y);
    const chord = dist(A, B);
    const L = wallLength(f, wall);
    if (chord < 1 || L < 1) return;
    const t = Math.max(0, Math.min(L, tMm));
    const dir = norm(sub(B, A));
    const n = scale(perp(dir), side);
    // On the cursor's side of the wall, past whatever is being placed there.
    // The far side is the wrong choice: zoomed in on an exterior wall from
    // inside, it lands outside the building and off the edge of the canvas.
    const off = wall.thickness / 2 + clearMm + 90 + 10 * px;
    const P = add(A, scale(dir, chord * (t / L)));
    const d0 = add(A, scale(n, off)), dP = add(P, scale(n, off)), d1 = add(B, scale(n, off));

    ctx.strokeStyle = COLORS.dimension;
    ctx.lineWidth = 1.2 * px;
    // Extension ticks from the wall face out past the dimension line.
    for (const [p, d] of [[A, d0], [P, dP], [B, d1]] as const) {
      const from = add(p, scale(n, wall.thickness / 2 + clearMm + 20)), to = add(d, scale(n, 60));
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.stroke();
    const ah = 9 * px;
    for (const [tip, back] of [[d0, dir], [dP, scale(dir, -1)], [dP, dir], [d1, scale(dir, -1)]] as const) {
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + back.x * ah - n.x * ah * 0.4, tip.y + back.y * ah - n.y * ah * 0.4);
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + back.x * ah + n.x * ah * 0.4, tip.y + back.y * ah + n.y * ah * 0.4);
      ctx.stroke();
    }
    // Numbers, dropped per segment when that segment has no room on screen.
    for (const [from, to, mm] of [[d0, dP, t], [dP, d1, L - t]] as const) {
      if (dist(vp.toScreen(from), vp.toScreen(to)) < 34) continue;
      const at = this.visibleMid(vp, from, to);
      if (at) drawLabel(ctx, vp, at, String(Math.round(mm)));
    }
  }

  /**
   * Midpoint of the on-screen part of a segment. Zooming in to place something
   * precisely is exactly when a wall end runs off the canvas, and a dimension
   * whose number sits three screens away is no dimension at all — so the label
   * slides along to stay visible. Null when the segment is off-screen entirely.
   */
  private visibleMid(vp: Viewport, p0: Vec, p1: Vec): Vec | null {
    const m = 30; // keep the whole pill inside, not just its anchor
    const lo = m, hiX = this.canvas.clientWidth - m, hiY = this.canvas.clientHeight - m;
    if (hiX <= lo || hiY <= lo) return null;
    const s0 = vp.toScreen(p0), s1 = vp.toScreen(p1);
    const dx = s1.x - s0.x, dy = s1.y - s0.y;
    // Liang-Barsky against the canvas rect.
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, s0.x - lo], [dx, hiX - s0.x], [-dy, s0.y - lo], [dy, hiY - s0.y]] as const) {
      if (p === 0) { if (q < 0) return null; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    const tm = (t0 + t1) / 2;
    return v(p0.x + (p1.x - p0.x) * tm, p0.y + (p1.y - p0.y) * tm);
  }

  /**
   * Dimension chains: one run per facade, with every opening and pier measured
   * in sequence and an overall beneath. Read-only — a segment spans whatever
   * the openings make it, so there is no single wall for a typed value to
   * resize; editing stays on the selected wall's own dimension.
   *
   * `lift` stacks a second convention's chains outside the first; `tag` names
   * the convention when both are drawn, where position alone would not say
   * which run is the dagmaat.
   */
  private drawDimChains(
    ctx: CanvasRenderingContext2D, vp: Viewport, px: number,
    chains: DimChain[], lift: number, tag: string,
  ): void {
    ctx.strokeStyle = COLORS.dimension;
    for (const c of chains) {
      // Skip a run too small on screen to read; at that size it is noise.
      if (c.total / px < 40) continue;
      const gap = c.half + 260 + lift;
      const at = (d: number, off: number): Vec =>
        add(add(c.origin, scale(c.dir, d)), scale(c.out, off));
      // The measured extent. In clear mode it starts and ends on a wall face,
      // inside the run's own nodes, so the line is drawn to the spans rather
      // than from 0 to total.
      const first = c.spans[0]!.from, last = c.spans[c.spans.length - 1]!.to;
      const ticks = [first, ...c.spans.map(s => s.to)];

      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.1 * px;
      // Extension lines from the wall face out past the chain.
      for (const d of ticks) {
        ctx.beginPath();
        const from = at(d, c.half + 60), to = at(d, gap + 90);
        ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      // The chain line, and a tick at every break.
      ctx.beginPath();
      const l0 = at(first, gap), l1 = at(last, gap);
      ctx.moveTo(l0.x, l0.y); ctx.lineTo(l1.x, l1.y);
      ctx.stroke();
      const tick = 7 * px;
      const slash = (d: number, off: number): void => {
        // A 45-degree slash, the surveyor's tick, rather than an arrowhead —
        // arrowheads collide once spans get short.
        const p = at(d, off);
        const m = add(scale(c.dir, tick), scale(c.out, tick));
        ctx.beginPath();
        ctx.moveTo(p.x - m.x, p.y - m.y); ctx.lineTo(p.x + m.x, p.y + m.y);
        ctx.stroke();
      };
      for (const d of ticks) slash(d, gap);
      // An overall line below, only when it says something the spans do not.
      if (c.spans.length > 1) {
        const o0 = at(first, gap + 420), o1 = at(last, gap + 420);
        ctx.beginPath();
        ctx.moveTo(o0.x, o0.y); ctx.lineTo(o1.x, o1.y);
        ctx.stroke();
        for (const d of [first, last]) slash(d, gap + 420);
      }
      ctx.globalAlpha = 1;

      // Labels in screen space so they stay one size at any zoom, but ROTATED
      // to run along their dimension line, as a drawing does. Kept horizontal
      // they collide on a vertical chain: consecutive labels sit only a few
      // hundred millimetres apart across the line, which at most zooms is
      // narrower than the text itself.
      ctx.save();
      ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = COLORS.dimension;
      // Flip anything past vertical so text is never upside down.
      let ang = Math.atan2(c.dir.y, c.dir.x);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const label = (text: string, alongMm: number, offMm: number, font: string): void => {
        const sp = vp.toScreen(at(alongMm, offMm));
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(ang);
        ctx.font = font;
        ctx.fillText(text, 0, 0);
        ctx.restore();
      };
      for (const span of c.spans) {
        // Only label what will fit; an unreadable smear helps nobody.
        if (span.mm / px < 26) continue;
        label(String(span.mm), (span.from + span.to) / 2, gap - 130, "500 10px system-ui, sans-serif");
      }
      if (c.spans.length > 1) {
        const overall = Math.round(last - first);
        label(tag ? `${tag} ${overall}` : String(overall),
          (first + last) / 2, gap + 420 - 130, "600 11px system-ui, sans-serif");
      }
      ctx.restore();
    }
  }

  /** One wall's dimension line + clickable value pill. Registers the pill in dimRects. */
  private drawDimension(
    ctx: CanvasRenderingContext2D, vp: Viewport, px: number, wall: Wall,
    emphasized: boolean, collectHits = true,
  ): void {
    const f = this.floor;
    const a = f.nodes.find(n => n.id === wall.a), b = f.nodes.find(n => n.id === wall.b);
    if (!a || !b) return;
    const A = v(a.x, a.y), B = v(b.x, b.y);
    if (dist(A, B) < 1) return;
    const dir = norm(sub(B, A));
    const n = perp(dir);
    const off = wall.thickness / 2 + 250 + 14 * px;
    const d0 = add(A, scale(n, off)), d1 = add(B, scale(n, off));
    ctx.strokeStyle = COLORS.dimension;
    ctx.globalAlpha = emphasized ? 1 : 0.55;
    ctx.lineWidth = 1.2 * px;
    for (const [p0, p1] of [[add(A, scale(n, wall.thickness / 2 + 60)), add(d0, scale(n, 60))],
                            [add(B, scale(n, wall.thickness / 2 + 60)), add(d1, scale(n, 60))]] as const) {
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.stroke();
    const ah = 9 * px;
    for (const [tip, back] of [[d0, dir], [d1, scale(dir, -1)]] as const) {
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + back.x * ah - n.x * ah * 0.4, tip.y + back.y * ah - n.y * ah * 0.4);
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + back.x * ah + n.x * ah * 0.4, tip.y + back.y * ah + n.y * ah * 0.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Clickable value pill (screen space). Skip the pill when the wall is too
    // short on screen for it to fit legibly — the line still shows.
    const wallPx = dist(vp.toScreen(A), vp.toScreen(B));
    if (wallPx < 46) return;
    const midW = scale(add(d0, d1), 0.5);
    const text = `${Math.round(wallLength(f, wall))}`;
    const sMid = vp.toScreen(midW);
    ctx.save();
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.font = "600 11px system-ui, sans-serif";
    const tw = ctx.measureText(text).width;
    const rx = sMid.x - tw / 2 - 6, ry = sMid.y - 9, rw = tw + 12, rh = 18;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = COLORS.dimension;
    ctx.globalAlpha = emphasized ? 1 : 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = COLORS.dimension;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, sMid.x, sMid.y + 1);
    ctx.restore();
    ctx.globalAlpha = 1;
    if (collectHits) this.dimRects.push({ x: rx, y: ry, w: rw, h: rh, wallId: wall.id });
  }

  /** World-space preview drawing, called inside the world transform. */
  /**
   * `collectHits` is false for a pass that is not the one being clicked on. The
   * dimension pills are hit-tested in canvas screen coordinates, so a second
   * pass through another viewport — the loupe — must draw them and leave
   * `dimRects` alone, or the rects end up in that viewport's space and tapping
   * a dimension to type a length hits nothing.
   */
  /** The marker + live line a calibration capture draws over the plan. */
  private drawCalibrationPreview(ctx: CanvasRenderingContext2D, vp: Viewport, px: number): void {
    const p0 = this.calibP0!;
    const p1 = this.calibP1 ?? this.snap?.p ?? this.cursor;
    ctx.save();
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 1.5 * px;
    // Solid once the second point is down and fixed; dashed while it is still
    // tracking the cursor, the same "not committed yet" convention the wall
    // preview uses.
    ctx.setLineDash(this.calibP1 ? [] : [40, 40]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.select;
    for (const p of this.calibP1 ? [p0, p1] : [p0]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    const L = Math.round(dist(p0, p1));
    drawLabel(ctx, vp, scale(add(p0, p1), 0.5), this.lengthBuffer ? `${this.lengthBuffer}▎mm` : `${L} mm`, COLORS.select);
  }

  drawPreview(ctx: CanvasRenderingContext2D, vp: Viewport, collectHits = true): void {
    const px = 1 / vp.pxPerMm;
    const f = this.floor;

    // Scale-calibration capture: a marker on the first point, a live (dashed,
    // while still following the cursor) line to the second, drawn regardless
    // of the active tool since calibration sits on top of it.
    if (this.calibArmed && this.calibP0) this.drawCalibrationPreview(ctx, vp, px);

    // Node handles in select mode. The SELECTED node is drawn in the selection
    // colour and larger: Delete acts on it, and a plan of identical white dots
    // does not say which one is about to go.
    if (this.tool === "select") {
      const selNode = this.store.sel?.kind === "node" ? this.store.sel.id : null;
      const handle = (x: number, y: number, on: boolean): void => {
        ctx.fillStyle = on ? COLORS.select : "#ffffff";
        ctx.strokeStyle = on ? COLORS.select : "#7a7f88";
        ctx.lineWidth = (on ? 1.5 : 1) * px;
        ctx.beginPath();
        ctx.arc(x, y, (on ? 5.5 : 3.5) * px, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      };
      for (const n of f.nodes) handle(n.x, n.y, n.id === selNode);
      // A selected route's own waypoints, drawable but not graph nodes, so
      // they get the same handle drawn on top of the route's own marks -- and
      // the picked one is marked the way a picked node is, since Del acts on it.
      const liveRoute = this.activeRouteId;
      if (liveRoute) {
        const selRoute = routesOf(f).find(x => x.id === liveRoute);
        const selPoint = this.store.sel?.kind === "routePoint" ? this.store.sel.id : null;
        if (selRoute) {
          const marks = resolveRoutePoints(f, selRoute);
          for (let i = 0; i < marks.length; i++) {
            handle(marks[i]!.x, marks[i]!.y, selRoute.points[i]?.id === selPoint);
          }
        }
      }
      if (collectHits) this.dimRects = [];
      // Dimension lines with editable values: all walls when toggled on,
      // otherwise only the selected wall.
      const selDim = this.store.sel;
      if (this.showDims) {
        // Chains, not one line per wall: a facade reads as a single run with
        // its openings and piers measured in sequence. The selected wall still
        // gets its own editable dimension below, since a chain segment has no
        // single wall to resize.
        // The clear chain sits nearest the building and the hart-op-hart one
        // outside it, the order a sheet stacks them in.
        const dimMode = dimModeOf(this.store.doc);
        const both = dimMode === "both";
        if (dimMode !== "centerline")
          this.drawDimChains(ctx, vp, px, dimensionChains(this.floor, "clear"), 0,
            both ? t("hint.dimTagClear") : "");
        if (dimMode !== "clear")
          this.drawDimChains(ctx, vp, px, dimensionChains(this.floor, "centerline"),
            both ? DIM_CHAIN_LIFT : 0, both ? t("hint.dimTagCenterline") : "");
        if (selDim?.kind === "wall") {
          const wall = f.walls.find(x => x.id === selDim.id);
          if (wall) this.drawDimension(ctx, vp, px, wall, true, collectHits);
        }
      } else if (selDim?.kind === "wall") {
        const wall = f.walls.find(x => x.id === selDim.id);
        if (wall) this.drawDimension(ctx, vp, px, wall, true, collectHits);
      }
      // Sliding something that is already on a wall: measure it the same way
      // the placement preview does.
      const drag = this.drag;
      if (drag?.kind === "symbol") {
        const sym = f.symbols.find(x => x.id === drag.id);
        const sDef = sym && getSymbol(sym.type);
        const snap = sDef && sDef.wallMounted ? this.wallSnap() : null;
        if (snap && sDef) this.drawWallOffsets(ctx, vp, px, snap.wall, snap.tMm, snap.side, sDef.depth);
      } else if (drag?.kind === "opening") {
        const wall = f.walls.find(x => x.id === drag.wallId);
        const o = wall?.openings.find(x => x.id === drag.id);
        if (wall && o) this.drawWallOffsets(ctx, vp, px, wall, o.t, this.cursorSide(wall, o.t / wallLength(f, wall)));
      }

      const sel = this.store.sel;
      // Name the symbol under the cursor, and the selected one — a placed
      // symbol is otherwise an unlabelled line drawing.
      const namedId = this.hoverSymbol;
      if (namedId) {
        const sym = f.symbols.find(x => x.id === namedId);
        const def = sym && getSymbol(sym.type);
        if (sym && def) drawLabel(ctx, vp, this.symbolLabelPoint(sym, def), t("symbol." + sym.type), symbolInk(sym));
      }

      // A hovered stair names itself, and says what is out of the ordinary about
      // it. The flag on the drawing is a mark; this is where the reason is,
      // without having to select the stair to find out.
      const stairId = this.hoverStair;
      if (stairId) {
        const raw = stairsOf(f).find(x => x.id === stairId);
        if (raw) {
          const st = resolveStair(f, raw);
          const box = stairBox(st);
          const at = add(v(st.x, st.y), fromAngleRot(v(0, (box.y0 + box.y1) / 2), st.rotation));
          const issues = stairIssues(st);
          // One reason, not all of them: the pill sits on the drawing and a
          // three-clause sentence would run off the canvas. The rest are in the
          // property pane, which is where a stair is being fixed anyway.
          const first = issues[0];
          const text = first === undefined ? t("stair." + st.kind)
            : t("stairIssue." + first.code, {
                value: first.code === "slopeSteep" ? `1:${gradient(first.value)}` : Math.round(first.value),
                limit: first.code === "slopeSteep" ? `1:${first.limit}` : first.limit,
              }) + (issues.length > 1 ? ` +${issues.length - 1}` : "");
          drawLabel(ctx, vp, at, text, issues.length > 0 ? COLORS.stairWarn : symbolInk(st));
        }
      }

      // Bow handle for selected wall.
      if (sel?.kind === "wall" && this.lengthBuffer) {
        const wall = f.walls.find(x => x.id === sel.id);
        if (wall) {
          const a = f.nodes.find(n => n.id === wall.a)!, b = f.nodes.find(n => n.id === wall.b)!;
          drawLabel(ctx, vp, arcPointAt(v(a.x, a.y), v(b.x, b.y), wall.bulge, 0.5), `${this.lengthBuffer}▎mm`);
        }
      }
      if (sel?.kind === "wall") {
        const wall = f.walls.find(x => x.id === sel.id);
        if (wall) {
          const a = f.nodes.find(n => n.id === wall.a)!, b = f.nodes.find(n => n.id === wall.b)!;
          const h = arcPointAt(v(a.x, a.y), v(b.x, b.y), wall.bulge, 0.5);
          ctx.fillStyle = COLORS.select;
          ctx.beginPath();
          const r = 5 * px;
          ctx.moveTo(h.x, h.y - r); ctx.lineTo(h.x + r, h.y); ctx.lineTo(h.x, h.y + r); ctx.lineTo(h.x - r, h.y);
          ctx.closePath(); ctx.fill();
        }
      }
    }

    // Wall drawing preview.
    if (this.tool === "wall" && this.chainStart) {
      const snap = this.snap ?? this.computeSnap(this.cursor, true);
      let target = snap.p;
      if (this.lengthBuffer) {
        const mm = parseFloat(this.lengthBuffer);
        if (isFinite(mm) && mm > 0) target = add(this.chainStart, scale(norm(sub(target, this.chainStart)), mm));
      }
      const th = this.lastThickness;
      const dir = norm(sub(target, this.chainStart));
      const n = perp(dir);
      ctx.fillStyle = "rgba(61,65,72,0.35)";
      ctx.beginPath();
      const c0 = add(this.chainStart, scale(n, th / 2)), c1 = add(target, scale(n, th / 2));
      const c2 = add(target, scale(n, -th / 2)), c3 = add(this.chainStart, scale(n, -th / 2));
      ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y);
      ctx.closePath(); ctx.fill();
      const L = Math.round(dist(this.chainStart, target));
      drawLabel(ctx, vp, scale(add(this.chainStart, target), 0.5),
        this.lengthBuffer ? `${this.lengthBuffer}▎mm` : `${L} mm`);
    }

    // Shape preview. Drawn from the same run that will be welded in, so what is
    // shown is what lands.
    if (this.tool === "wall" && this.shapeStart) {
      const run = this.pendingShape();
      if (run) this.drawShapeGhost(ctx, vp, run);
    }

    // Route chain preview: the committed waypoints, a live segment to the
    // cursor, and a mark at every point already placed -- open where it
    // anchors a symbol, filled where it stands free, the same convention
    // drawRoute() uses for a finished run (render/route.ts).
    if (this.tool === "route" && this.routeStart) {
      const snap = this.routeSnap ?? this.computeRouteSnap(this.cursor);
      let target = snap.p;
      if (this.lengthBuffer) {
        const mm = parseFloat(this.lengthBuffer);
        if (isFinite(mm) && mm > 0) target = add(this.routeStart, scale(norm(sub(target, this.routeStart)), mm));
      }
      const ink = routeInk(this.routeDiscipline, this.routeDiscipline === "water" ? this.routeWater : undefined);
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      // The draft has no Route to read a bore off yet, so it previews at the
      // discipline's line width; the footprint appears once the run is committed.
      ctx.lineWidth = this.routeDiscipline === "vent" ? LINE_WIDTH_MM + ROUTE_VENT_EXTRA_MM : LINE_WIDTH_MM;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const first = this.routePoints[0]!;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this.routePoints.length; i++) ctx.lineTo(this.routePoints[i]!.x, this.routePoints[i]!.y);
      // The leg about to be placed, as auto mode would lay it -- so the
      // proposal is visible before the click that accepts it.
      const corners = this.autoCorners(this.routeStart, target);
      for (const corner of corners) ctx.lineTo(corner.x, corner.y);
      ctx.lineTo(target.x, target.y);
      ctx.setLineDash([60, 60]); // the whole run is uncommitted until the chain ends
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of this.routePoints) {
        if (p.anchor) { ctx.beginPath(); drawOpenCircle(ctx, p.x, p.y, 45); ctx.stroke(); }
        else drawDot(ctx, p.x, p.y, 40);
      }
      if (snap.anchor) { ctx.beginPath(); drawOpenCircle(ctx, target.x, target.y, 45); ctx.stroke(); }
      else drawDot(ctx, target.x, target.y, 40);
      ctx.restore();
      // The length the leg will actually be: along the corners in auto mode,
      // straight otherwise. A proposed run reporting its straight-line distance
      // would understate every leg it turned.
      const legs = [this.routeStart, ...corners, target];
      let L = 0;
      for (let i = 0; i + 1 < legs.length; i++) L += dist(legs[i]!, legs[i + 1]!);
      L = Math.round(L);
      drawLabel(ctx, vp, scale(add(this.routeStart, target), 0.5),
        this.lengthBuffer ? `${this.lengthBuffer}▎mm` : `${L} mm`);
    }

    // Symbol placement ghost.
    if (this.tool === "symbol") {
      const def = getSymbol(this.symbolType);
      if (def) {
        // Wall-mounted: how far the anchor sits from each end of the wall.
        const snap = def.wallMounted ? this.wallSnap() : null;
        if (snap) this.drawWallOffsets(ctx, vp, px, snap.wall, snap.tMm, snap.side, def.depth);
        const pose = this.symbolPose();
        ctx.save();
        ctx.translate(pose.x, pose.y);
        ctx.rotate(pose.rotation);
        ctx.globalAlpha = 0.5;
        // Ghost in the armed pen, and fill with it too — the draw contract keeps
        // fill equal to stroke, so a symbol with a filled dot obeys it here as well.
        ctx.strokeStyle = this.symbolColor ?? COLORS.symbol;
        ctx.fillStyle = ctx.strokeStyle;
        def.draw(ctx);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // Stair placement ghost, in the armed pen and already turned by R/M.
    if (this.tool === "stair") {
      drawStairGhost(ctx, this.draftStair("ghost"), this.symbolColor ?? COLORS.symbol);
    }

    // Vide placement ghost.
    if (this.tool === "vide") {
      drawVideGhost(ctx, this.draftVide("ghost"), this.symbolColor ?? COLORS.symbol);
    }

    // Fit-out placement ghost, with the two distances to the wall ends when it
    // is snapped to one — the same measurement a symbol or an opening gets.
    if (this.tool === "furnishing") {
      const ghost = this.draftFurnishing("ghost");
      const snap = furnishingWallMounted(ghost.form) ? this.wallSnap() : null;
      if (snap) this.drawWallOffsets(ctx, vp, px, snap.wall, snap.tMm, snap.side, ghost.depth);
      drawFurnishingGhost(ctx, ghost, this.symbolColor ?? COLORS.symbol);
      const b = furnishingBox(ghost);
      drawLabel(ctx, vp,
        add(v(ghost.x, ghost.y), fromAngleRot(v(0, b.y1), ghost.rotation)),
        `${ghost.width} x ${ghost.depth}`);
    }

    // Zoom window. Drawn in screen-space line widths so it stays one pixel
    // wide however far the view is zoomed out while it is being dragged.
    if (this.drag?.kind === "zoomBox" && this.drag.boxEnd) {
      const a = this.drag.startWorld, b = this.drag.boxEnd;
      ctx.save();
      ctx.strokeStyle = COLORS.select;
      ctx.fillStyle = COLORS.selectWash;
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([30, 30]);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }

    // Marquee rect (shift+drag from empty space). Same screen-space idiom as
    // the zoom window above, undashed so the two read as distinct gestures.
    if (this.drag?.kind === "marquee" && this.drag.boxEnd) {
      const a = this.drag.startWorld, b = this.drag.boxEnd;
      ctx.save();
      ctx.strokeStyle = COLORS.select;
      ctx.fillStyle = COLORS.selectWash;
      ctx.lineWidth = 1.5 * px;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }

    // Opening placement ghost.
    if (this.tool === "door" || this.tool === "window" || this.tool === "passage") {
      const nw = nearestWall(f, this.cursor, 30 / vp.pxPerMm);
      if (nw) {
        const a = f.nodes.find(x => x.id === nw.wall.a)!, b = f.nodes.find(x => x.id === nw.wall.b)!;
        const L = wallLength(f, nw.wall);
        const width = this.openingWidth[this.tool];
        const offset = Math.max(width / 2, Math.min(L - width / 2, nw.tMm));
        const p0 = arcPointAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, (offset - width / 2) / L);
        const p1 = arcPointAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, (offset + width / 2) / L);
        ctx.strokeStyle = COLORS.snap;
        ctx.lineWidth = 2 * px;
        const half = nw.wall.thickness / 2 + 40;
        for (const p of [p0, p1]) {
          const tan = arcTangentAt(v(a.x, a.y), v(b.x, b.y), nw.wall.bulge, offset / L);
          const nn = perp(tan);
          ctx.beginPath();
          ctx.moveTo(p.x - nn.x * half, p.y - nn.y * half);
          ctx.lineTo(p.x + nn.x * half, p.y + nn.y * half);
          ctx.stroke();
        }
        // Both offsets, rather than the one "from corner" number this used to
        // show — placing a door 150 mm off a corner is the same job as a socket.
        this.drawWallOffsets(ctx, vp, px, nw.wall, offset, this.cursorSide(nw.wall, offset / L));
      }
    }
  }
}

/** Signed difference between two angles, wrapped to (-pi, pi]. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function fromAngleRot(p: Vec, ang: number): Vec {
  const c = Math.cos(ang), s = Math.sin(ang);
  return v(p.x * c - p.y * s, p.x * s + p.y * c);
}
