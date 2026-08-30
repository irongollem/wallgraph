// Tool state machine + snapping + typed-mm input. Owns pointer/keyboard handling
// for the canvas; rendering of previews goes through getPreview()/getSnap().
import { Store } from "../model/store";
import {
  Floor, Wall, Opening, PlanNode, SymbolInstance, newId, stairsOf, videsOf, cabinetsOf,
  roomNamesOf, floorHeight, DOOR_DEFAULT_WIDTH, WINDOW_DEFAULT_WIDTH, PASSAGE_DEFAULT_WIDTH,
  OpeningKind, FireRating,
} from "../model/doc";
import {
  Stair, ResolvedStair, StairKind, StairParams, stairDefaults, stairFields, clampStair,
  stairAngle, inheritsRise,
} from "../model/stair";
import { Vide, VideSize, VIDE_DEFAULT, clampVide } from "../model/vide";
import {
  Cabinet, CabinetSpec, cabinetDefaults, cabinetPreset, clampCabinet,
} from "../model/cabinet";
import { RoomName } from "../model/room";
import { nodeAt, splitWall, nearestWall, wallLength, mergeNodes, deleteWall, clampOpening, cleanOrphanNodes } from "../model/ops";
import { Viewport } from "../render/viewport";
import { Vec, v, add, sub, scale, norm, perp, dist, angleOf, fromAngle, dot, pointInPolygon } from "../geometry/vec";
import { arcPointAt, arcTangentAt, bulgeFromSagitta } from "../geometry/arc";
import { getSymbol, SymbolDef, SYMBOL_TYPES } from "../render/symbols";
import { stairHit, resolveStair, stairBox, stairCorners, stairIssues, gradient } from "../core/stair";
import { drawStairGhost } from "../render/stair";
import { videHit, videCorners } from "../core/vide";
import { drawVideGhost } from "../render/vide";
import { cabinetHit, cabinetBox, cabinetCorners } from "../core/cabinet";
import { drawCabinetGhost } from "../render/cabinet";
import { planBounds, polyBounds, Bounds } from "../core/bounds";
import { Room } from "../core/rooms";
import { drawLabel, COLORS, symbolInk } from "../render/draw";
import { Resolved, ResolvedWall } from "../core/resolve";
import { dimensionChains } from "../core/dimensions";
import { t } from "../i18n";

export type ToolName =
  | "select" | "wall" | "door" | "window" | "passage" | "symbol" | "stair" | "vide"
  | "cabinet" | "roomName" | "zoom";

/** Finger travel that still counts as a tap rather than a drag. */
const TAP_SLOP_PX = 10;
/** Longest press still read as a tap. */
const TAP_MS = 500;
/** Gap between two taps that makes them one double tap. */
const DOUBLE_TAP_MS = 300;
/** Smallest share of an axis a fit will frame into, whatever the chrome covers. */
const MIN_FIT_FRACTION = 0.5;

export interface SnapResult { p: Vec; kind: "node" | "wall" | "grid" | "free"; wall?: Wall; tMm?: number; node?: PlanNode }

interface DragState {
  kind: "node" | "wall" | "symbol" | "stair" | "vide" | "cabinet" | "roomName"
      | "bow" | "opening" | "pan" | "zoomBox";
  id?: string;
  wallId?: string;
  startWorld: Vec;
  orig?: unknown;
  moved: boolean;
  lastScreen?: Vec;
  /** Far corner of the zoom window, world mm. */
  boxEnd?: Vec;
}

export class Tools {
  tool: ToolName = "select";
  symbolType = "socket-single";
  ortho = true;
  snapGrid = true;  // round placements to doc.gridMm; off = free 1 mm placement
  showDims = false; // always show wall measurements (clickable), not only on selection
  lastThickness = 100;
  /**
   * Pen for the next symbol placed; null = the plan's default ink. Same idea as
   * lastThickness: the work is "place twenty sockets in red", so the colour is a
   * standing choice rather than something to set twenty times afterwards.
   */
  symbolColor: string | null = null;

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

  /** The opening the vide tool will place next. */
  videSize: VideSize = { ...VIDE_DEFAULT };
  videRotation = 0;

  /**
   * The cabinet the tool will place next, and the named preset it came from.
   * Like a stair, a cabinet carries its size in the document, so the tool holds
   * a full specification rather than a type.
   */
  cabinetSpec: CabinetSpec = cabinetDefaults("base");
  cabinetPresetId = "onderkast";
  cabinetRotation = 0;
  cabinetMirrored = false;

  /** The name the room tool will write next. */
  roomNameText = "";

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
    canvas.addEventListener("pointerleave", () => {
      this.hoverSymbol = null; this.hoverStair = null; this.requestRender();
    });
    // A long press raises this on touch, where it means nothing: the gesture is
    // already the tool's, and cancelling a wall chain by resting a finger would
    // be a trap. Suppressed either way so the OS menu never covers the plan.
    canvas.addEventListener("contextmenu", e => {
      e.preventDefault();
      if (this.lastPointerType === "mouse") this.cancel();
    });
    window.addEventListener("keydown", e => this.onKey(e));
  }

  setTool(t: ToolName, symbolType?: string): void {
    this.tool = t;
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

  /** Arm a named unit: an onderkast, a ladenkast, a garderobekast. */
  setCabinetPreset(id: string): void {
    const p = cabinetPreset(id);
    if (!p) return;
    this.cabinetPresetId = id;
    const { id: _drop, ...spec } = p;
    this.cabinetSpec = spec;
    this.setTool("cabinet");
  }

  /** Tune the armed unit. The preset id follows what the fields now say. */
  setCabinetSpec(spec: CabinetSpec): void {
    this.cabinetSpec = clampCabinet(spec);
    this.onToolChange();
    this.requestRender();
  }

  setCabinetRotation(radians: number): void {
    this.cabinetRotation = stairAngle(radians);
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

  setRoomNameText(name: string): void {
    this.roomNameText = name;
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

  cancel(render = true): void {
    this.chainStart = null;
    this.chainStartNode = null;
    this.lengthBuffer = "";
    this.drag = null;
    if (render) this.requestRender();
  }

  /** True while a wall chain is open, so the host can offer a way to close it. */
  get chaining(): boolean { return this.chainStart !== null; }

  /**
   * True when a typed length would be acted on: a chain waiting for its next
   * point, or a selected wall waiting to be resized. These are the two states
   * the keyboard accepts digits in, and so the two the millimetre keypad
   * appears for.
   */
  get typingLength(): boolean {
    return (this.tool === "wall" && this.chainStart !== null)
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

  /** Act on the typed length: place the next chain point, or resize the wall. */
  commitLength(): void {
    if (!this.lengthBuffer) return;
    if (this.tool === "wall" && this.chainStart) { this.wallClick(); return; }
    if (this.tool === "select" && this.store.sel?.kind === "wall") this.applyTypedLength();
  }

  private afterTyping(): void {
    this.updateHint();
    this.onToolChange();
    this.requestRender();
  }

  /** Close an open wall chain. What Escape and the right mouse button do. */
  endChain(): void {
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
  private computeSnap(raw: Vec, forWall: boolean): SnapResult {
    const f = this.floor;
    const tolNode = 12 / this.vp.pxPerMm;
    const tolWall = 9 / this.vp.pxPerMm;
    let p = raw;

    // Ortho constraint first when chaining a wall (direction), then snap along it.
    let orthoDir: Vec | null = null;
    if (forWall && this.chainStart && this.ortho) {
      const d = sub(raw, this.chainStart);
      const ang = Math.round(angleOf(d) / (Math.PI / 4)) * (Math.PI / 4);
      orthoDir = fromAngle(ang);
      p = add(this.chainStart, scale(orthoDir, dot(d, orthoDir)));
    }

    // Node snap (on the constrained point OR raw — prefer raw so nodes win).
    for (const n of f.nodes) {
      if (dist(v(n.x, n.y), raw) <= tolNode) return { p: v(n.x, n.y), kind: "node", node: n };
    }
    // Wall snap.
    const nw = nearestWall(f, p, tolWall);
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
    return { p: v(Math.round(p.x / g) * g, Math.round(p.y / g) * g), kind };
  }

  getSnap(): Vec | null { return this.snap?.p ?? null; }

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
    return this.applyFit(planBounds(this.floor, this.getResolved()));
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
    if (sel.kind === "cabinet") {
      const c = cabinetsOf(f).find(x => x.id === sel.id);
      return c ? polyBounds(cabinetCorners(c)) : null;
    }
    if (sel.kind === "stair") {
      const st = stairsOf(f).find(x => x.id === sel.id);
      return st ? polyBounds(stairCorners(resolveStair(f, st))) : null;
    }
    if (sel.kind === "vide") {
      const vd = videsOf(f).find(x => x.id === sel.id);
      return vd ? polyBounds(videCorners(vd)) : null;
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
    if (sel.kind === "roomName") {
      const rn = roomNamesOf(f).find(x => x.id === sel.id);
      if (!rn) return null;
      // A name is a point. Frame the room it names, which is what was meant.
      const room = this.roomAt(v(rn.x, rn.y));
      return room ? polyBounds(room.poly) : polyBounds([v(rn.x, rn.y)]);
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
    this.requestRender();
  }

  /**
   * A tap that landed: the placement tools act here rather than on contact,
   * because until the finger lifts the gesture could still turn out to be the
   * first half of a pinch, and a wall placed on contact cannot be taken back by
   * lifting. Select is the exception — it acts on contact so a drag can start.
   */
  private onTap(time: number): void {
    if (this.tool === "select") {
      // Double tap on empty paper frames the plan. BOTH taps have to have hit
      // nothing: testing only the second one turns an ordinary tap-a-wall then
      // tap-away-to-deselect into a zoom-all, which throws away the view the
      // reader was working in.
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
      case "cabinet": this.placeCabinet(); break;
      case "roomName": this.placeRoomName(); break;
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
    this.hoverSymbol = null; // a name pill has no business sitting under a click or drag
    this.hoverStair = null;
    const s = this.screenOf(e);
    const w = this.vp.toWorld(s);
    this.pointers.set(e.pointerId, s);

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
      this.pinch = this.pinchState();
      this.requestRender();
      return;
    }
    if (this.pointers.size > 2) return;

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
      this.snap = this.tool === "select" ? null : this.computeSnap(w, this.tool === "wall");
      this.tapStart = { screen: s, time: e.timeStamp };
      // Two tools need the press itself rather than the release: select, so a
      // drag can start, and zoom, so the window can be dragged out. Neither has
      // changed the document by the time a second finger could arrive, so both
      // are safe to abandon mid-gesture.
      if (this.tool === "select") this.selectDown(s, w);
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
      case "cabinet": this.placeCabinet(); break;
      case "roomName": this.placeRoomName(); break;
      case "zoom": this.zoomDown(s, w); return;
      case "select": this.selectDown(s, w); break;
    }
  }

  private onMove(e: PointerEvent): void {
    const s = this.screenOf(e);
    const w = this.vp.toWorld(s);
    this.lastPointerType = e.pointerType;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);
    if (this.pointers.size >= 2) { this.pinchMove(); return; }
    this.cursor = w;

    if (this.drag) { this.dragMove(s, w); return; }

    // What is this thing? A placed symbol is a bare line drawing, so name the
    // one under the cursor (see drawPreview).
    this.hoverStair = this.tool === "select" ? this.stairAt(w)?.id ?? null : null;
    this.hoverSymbol = this.tool === "select" && !this.hoverStair
      ? this.symbolAt(w)?.id ?? null : null;
    this.snap = this.tool === "select" ? null : this.computeSnap(w, this.tool === "wall");
    this.requestRender();
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;

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

    if (!this.drag) { this.requestRender(); return; }
    const d = this.drag;
    this.drag = null;
    if (d.kind === "zoomBox") { this.zoomUp(d); this.requestRender(); return; }
    this.finishDrag(d);
    this.requestRender();
  }

  /**
   * The end of a drag, from a finger lifting or from a second finger taking
   * over. dragMove has already written the new position, so this is only the
   * part that cannot be done per move: a node dropped onto another has to weld,
   * or the graph keeps two coincident nodes and resolveFloor miters them as two
   * separate degree-1 ends.
   */
  private finishDrag(d: DragState): void {
    if (d.kind !== "node" || !d.moved) return;
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      const me = f.nodes.find(n => n.id === d.id);
      if (!me) return;
      for (const n of f.nodes) {
        if (n.id !== me.id && dist(v(n.x, n.y), v(me.x, me.y)) <= 1) { mergeNodes(f, n.id, me.id); break; }
      }
    }, "nodedrop");
  }

  // ---- wall tool ----
  private wallClick(): void {
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
      });
    } else {
      if (dist(target, this.chainStart) < 10) return;
      this.store.mutate(doc => {
        const f = this.store.floorOf(doc);
        const startId = this.chainStartNode!;
        const endSnap = this.lengthBuffer ? null : snap;
        const nEnd = endSnap ? this.anchorNode(f, endSnap, target) : nodeAt(f, target);
        if (nEnd.id === startId) return;
        f.walls.push({ id: newId("w"), a: startId, b: nEnd.id, thickness: this.lastThickness, bulge: 0, openings: [] });
        this.chainStart = v(nEnd.x, nEnd.y);
        this.chainStartNode = nEnd.id;
      });
      this.lengthBuffer = "";
    }
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
        if (snap.tMm > 40 && snap.tMm < L - 40) return splitWall(f, wall, snap.tMm);
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
      // A door takes the standing choices rather than one fixed default: hinge
      // side, swing and fire rating are decided once for a plan and then placed
      // over and over, the way lastThickness works for walls.
      ...(kind === "door" ? {
        hinge: this.doorHinge,
        swingIn: !this.doorOutward,
        ...(this.doorSelfClosing ? { selfClosing: true } : {}),
        ...(this.doorFire ? { fireRating: { ...this.doorFire } } : {}),
      } : {}),
      ...(kind === "window" ? { windowType: "fixed" as const } : {}),
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
    const f = this.floor;
    const nw = nearestWall(f, this.cursor, 60 / this.vp.pxPerMm + 500);
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
      this.store.floorOf(doc).symbols.push(sym);
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

  // ---- cabinets ----
  /**
   * Where the cabinet lands for the current cursor.
   *
   * Cabinetry stands against a wall, so it takes the wall snap a wall-mounted
   * symbol does. On top of that it snaps end-to-end with cabinets already
   * placed: a kitchen is a RUN of units butted together, and lining each one up
   * by eye against the last is the work the module widths exist to avoid.
   */
  private cabinetPose(): { x: number; y: number; rotation: number; mirrored: boolean } {
    const snap = this.wallSnap();
    const base = snap
      ? { x: snap.x, y: snap.y, rotation: snap.rotation }
      : (() => {
          const g = this.gridStep;
          return {
            x: Math.round(this.cursor.x / g) * g,
            y: Math.round(this.cursor.y / g) * g,
            rotation: this.cabinetRotation,
          };
        })();
    const run = this.runSnap(base, this.cabinetSpec.width);
    return { ...base, ...run, mirrored: this.cabinetMirrored };
  }

  /**
   * Pull the cabinet's end onto the end of one already placed, when the two
   * face the same way and the ends are close. Returns the corrected anchor, or
   * nothing when no run is within reach.
   *
   * Ends are compared in world space rather than along a wall parameter, so a
   * run also closes up across a wall join and against a unit that was placed
   * free-standing.
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
    for (const c of cabinetsOf(this.floor)) {
      if (c.id === skipId) continue;
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

  private draftCabinet(id: string): Cabinet {
    const spec = clampCabinet(this.cabinetSpec);
    const pose = this.cabinetPose();
    const c: Cabinet = {
      id, kind: spec.kind,
      x: pose.x, y: pose.y, rotation: pose.rotation,
      width: spec.width, depth: spec.depth, height: spec.height,
      front: spec.front, hinge: spec.hinge,
    };
    if (pose.mirrored) c.mirrored = true;
    if (spec.front === "drawers") c.drawers = spec.drawers;
    if (spec.corner) c.corner = true;
    if (spec.worktop) c.worktop = true;
    if (this.symbolColor) c.color = this.symbolColor;
    return c;
  }

  private placeCabinet(): void {
    const c = this.draftCabinet(newId("k"));
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      (f.cabinets ??= []).push(c);
    });
    this.store.select({ kind: "cabinet", id: c.id });
  }

  /** Topmost cabinet whose carcass (plus the 30 mm grab margin) covers `w`. */
  private cabinetAt(w: Vec): Cabinet | undefined {
    const list = cabinetsOf(this.floor);
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]!;
      if (cabinetHit(c, w, 30)) return c;
    }
    return undefined;
  }

  // ---- room names ----
  private placeRoomName(): void {
    const name = this.roomNameText.trim();
    if (!name) return;
    const g = this.gridStep;
    const rn: RoomName = {
      id: newId("r"),
      x: Math.round(this.cursor.x / g) * g,
      y: Math.round(this.cursor.y / g) * g,
      name,
      ...(this.symbolColor ? { color: this.symbolColor } : {}),
    };
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      (f.roomNames ??= []).push(rn);
    });
    this.store.select({ kind: "roomName", id: rn.id });
  }

  /** The room name nearest `w`, within a grab radius that follows the zoom. */
  private roomNameAt(w: Vec): RoomName | undefined {
    const tol = 14 / this.vp.pxPerMm;
    const list = roomNamesOf(this.floor);
    for (let i = list.length - 1; i >= 0; i--) {
      const rn = list[i]!;
      if (dist(v(rn.x, rn.y), w) <= tol) return rn;
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
  private selectDown(s: Vec, w: Vec): void {
    this.lengthBuffer = "";
    this.closeDimInput();
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

    // Nodes.
    for (const n of f.nodes) {
      if (dist(v(n.x, n.y), w) <= tol) {
        this.store.select({ kind: "node", id: n.id });
        this.drag = { kind: "node", id: n.id, startWorld: w, moved: false };
        return;
      }
    }
    // A room name sits over everything and is small, so it is offered first;
    // its grab radius is tight enough not to shadow what it labels.
    const namePick = this.roomNameAt(w);
    if (namePick) {
      this.store.select({ kind: "roomName", id: namePick.id });
      this.drag = { kind: "roomName", id: namePick.id, startWorld: w, moved: false };
      return;
    }
    // Stairs, then symbols: picking follows the drawing order, topmost first.
    // A flight is drawn over the symbols it crosses, so a click on it must not
    // reach past it to something underneath.
    const stairPick = this.stairAt(w);
    if (stairPick) {
      this.store.select({ kind: "stair", id: stairPick.id });
      this.drag = { kind: "stair", id: stairPick.id, startWorld: w, moved: false };
      return;
    }
    const symHit = this.symbolAt(w);
    if (symHit) {
      this.store.select({ kind: "symbol", id: symHit.id });
      this.drag = { kind: "symbol", id: symHit.id, startWorld: w, moved: false };
      return;
    }
    // Cabinetry after the symbols it holds: a socket drawn on a unit's front
    // has to stay clickable, and a carcass is the larger target underneath.
    const cabPick = this.cabinetAt(w);
    if (cabPick) {
      this.store.select({ kind: "cabinet", id: cabPick.id });
      this.drag = { kind: "cabinet", id: cabPick.id, startWorld: w, moved: false };
      return;
    }
    // Openings (near their centerline center).
    for (const rw of res.walls.values()) {
      for (const og of rw.openings) {
        if (dist(og.center, w) <= Math.max(og.opening.width / 2, tol)) {
          this.store.select({ kind: "opening", id: og.opening.id, wallId: rw.wall.id });
          this.drag = { kind: "opening", id: og.opening.id, wallId: rw.wall.id, startWorld: w, moved: false };
          return;
        }
      }
    }
    // Walls (point in outline).
    for (const rw of res.walls.values()) {
      if (pointInPolygon(w, rw.outline)) {
        this.store.select({ kind: "wall", id: rw.wall.id });
        this.drag = { kind: "wall", id: rw.wall.id, startWorld: w, moved: false };
        return;
      }
    }
    // A vide last of all: it is the floor, so anything standing on it wins the
    // click, and its own area is otherwise empty.
    const videPick = this.videAt(w);
    if (videPick) {
      this.store.select({ kind: "vide", id: videPick.id });
      this.drag = { kind: "vide", id: videPick.id, startWorld: w, moved: false };
      return;
    }
    this.store.select(null);
    this.drag = { kind: "pan", startWorld: w, moved: false, lastScreen: s };
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

  private dragMove(s: Vec, w: Vec): void {
    const d = this.drag!;
    d.moved = true;
    const g = this.gridStep;

    if (d.kind === "pan") {
      if (d.lastScreen) this.vp.panPx(s.x - d.lastScreen.x, s.y - d.lastScreen.y);
      d.lastScreen = s;
      this.requestRender();
      return;
    }
    if (d.kind === "node") {
      const snap = this.computeSnap(w, false);
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
      this.store.mutate(doc => {
        const sym = this.store.floorOf(doc).symbols.find(x => x.id === d.id);
        if (!sym) return;
        const saveType = this.symbolType;
        this.symbolType = sym.type;
        const pose = this.symbolPose();
        this.symbolType = saveType;
        Object.assign(sym, pose);
        if (!getSymbol(sym.type)?.wallMounted) delete sym.wallId;
      }, "drag" + d.id);
    } else if (d.kind === "stair") {
      // Moved by a quantised delta rather than re-posed under the cursor: the
      // anchor of a stair is the foot of the flight, not the point grabbed.
      const delta = sub(w, d.startWorld);
      const dx = Math.round(delta.x / g) * g, dy = Math.round(delta.y / g) * g;
      if (dx !== 0 || dy !== 0) {
        d.startWorld = add(d.startWorld, v(dx, dy));
        this.store.mutate(doc => {
          const st = stairsOf(this.store.floorOf(doc)).find(x => x.id === d.id);
          if (st) { st.x += dx; st.y += dy; }
        }, "drag" + d.id);
      }
    } else if (d.kind === "vide") {
      const delta = sub(w, d.startWorld);
      const dx = Math.round(delta.x / g) * g, dy = Math.round(delta.y / g) * g;
      if (dx !== 0 || dy !== 0) {
        d.startWorld = add(d.startWorld, v(dx, dy));
        this.store.mutate(doc => {
          const vd = videsOf(this.store.floorOf(doc)).find(x => x.id === d.id);
          if (vd) { vd.x += dx; vd.y += dy; }
        }, "drag" + d.id);
      }
    } else if (d.kind === "cabinet") {
      // Re-posed under the cursor rather than nudged by a delta: a cabinet
      // snaps to walls and to its neighbours, and a dragged one has to take
      // those snaps or a run cannot be rearranged once it is built.
      this.store.mutate(doc => {
        const c = cabinetsOf(this.store.floorOf(doc)).find(x => x.id === d.id);
        if (!c) return;
        const snap = this.wallSnap();
        const base = snap
          ? { x: snap.x, y: snap.y, rotation: snap.rotation }
          : { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g, rotation: c.rotation };
        Object.assign(c, base, this.runSnap(base, c.width, c.id) ?? {});
      }, "drag" + d.id);
    } else if (d.kind === "roomName") {
      const delta = sub(w, d.startWorld);
      const dx = Math.round(delta.x / g) * g, dy = Math.round(delta.y / g) * g;
      if (dx !== 0 || dy !== 0) {
        d.startWorld = add(d.startWorld, v(dx, dy));
        this.store.mutate(doc => {
          const rn = roomNamesOf(this.store.floorOf(doc)).find(x => x.id === d.id);
          if (rn) { rn.x += dx; rn.y += dy; }
        }, "drag" + d.id);
      }
    } else if (d.kind === "zoomBox") {
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
    }
  }

  // ---- keyboard ----
  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.store.redo(); else this.store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this.store.redo(); return; }
    if (e.ctrlKey || e.metaKey) return;

    // Typed mm entry, in the two states typingLength describes. The keypad
    // calls the same methods, so the keyboard and the touch pad cannot drift.
    if (this.typingLength) {
      if (/^[0-9.]$/.test(e.key)) { this.typeLength(e.key); return; }
      if (e.key === "Backspace" && (this.lengthBuffer || this.chainStart)) { this.backspaceLength(); return; }
      if (e.key === "Enter" && this.lengthBuffer) { this.commitLength(); return; }
      if (e.key === "Escape" && this.lengthBuffer) { this.clearLength(); return; }
    }

    switch (e.key) {
      case "Escape": this.cancel(); this.updateHint(); break;
      case "v": case "V": this.setTool("select"); break;
      case "w": case "W": this.setTool("wall"); break;
      case "d": case "D": this.setTool("door"); break;
      case "n": case "N": this.setTool("window"); break;
      case "p": case "P": this.setTool("passage"); break;
      // Symbol tool used to be reachable only by clicking the palette; give it a shortcut too.
      case "s": case "S": this.setTool("symbol"); break;
      // T for trap: the stair tool, armed with whatever kind was last chosen.
      case "t": case "T": this.setTool("stair"); break;
      // H for the hole in the floor: the vide tool.
      case "h": case "H": this.setTool("vide"); break;
      // C for cabinetry, K for kamer, Z for the zoom window.
      case "c": case "C": this.setTool("cabinet"); break;
      case "k": case "K": this.setTool("roomName"); break;
      case "z": case "Z": this.setTool("zoom"); break;
      // Fit, in any tool: the whole plan, or the selection with Shift. Zoom-all
      // is the move a drawing is read with, so it does not live behind a tool.
      case "f": case "F": if (e.shiftKey) this.fitSelection(); else this.fitAll(); break;
      case "o": case "O": this.ortho = !this.ortho; this.updateHint(); this.onToolChange(); break;
      case "g": case "G": this.snapGrid = !this.snapGrid; this.updateHint(); this.onToolChange(); this.requestRender(); break;
      case "l": case "L": this.showDims = !this.showDims; this.onToolChange(); this.requestRender(); break;
      case "r": case "R": this.rotateSelected(); break;
      case "m": case "M": this.mirrorSelected(); break;
      case "Delete": case "Backspace": this.deleteSelected(); break;
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
    if (this.tool === "cabinet") {
      this.cabinetRotation = stairAngle(this.cabinetRotation + Math.PI / 2);
      this.onToolChange();
      this.requestRender();
      return;
    }
    const sel = this.store.sel;
    if (sel?.kind === "stair") {
      this.store.mutate(doc => {
        const st = stairsOf(this.store.floorOf(doc)).find(x => x.id === sel.id);
        if (st) st.rotation = stairAngle(st.rotation + Math.PI / 2);
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
    if (sel?.kind === "cabinet") {
      this.store.mutate(doc => {
        const c = cabinetsOf(this.store.floorOf(doc)).find(x => x.id === sel.id);
        if (c) c.rotation = stairAngle(c.rotation + Math.PI / 2);
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
    // for M on one: the run turns the corner and the doors have to follow.
    if (this.tool === "cabinet") {
      this.cabinetMirrored = !this.cabinetMirrored;
      this.onToolChange();
      this.requestRender();
      return;
    }
    const sel = this.store.sel;
    if (sel?.kind === "cabinet") {
      this.store.mutate(doc => {
        const c = cabinetsOf(this.store.floorOf(doc)).find(x => x.id === sel.id);
        if (c) c.mirrored = !c.mirrored;
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

  deleteSelected(): void {
    const sel = this.store.sel;
    if (!sel) return;
    this.store.mutate(doc => {
      const f = this.store.floorOf(doc);
      if (sel.kind === "wall") deleteWall(f, sel.id);
      else if (sel.kind === "node") {
        f.walls = f.walls.filter(w => w.a !== sel.id && w.b !== sel.id);
        cleanOrphanNodes(f);
      } else if (sel.kind === "symbol") f.symbols = f.symbols.filter(s => s.id !== sel.id);
      else if (sel.kind === "stair") f.stairs = stairsOf(f).filter(s => s.id !== sel.id);
      else if (sel.kind === "vide") f.vides = videsOf(f).filter(s => s.id !== sel.id);
      else if (sel.kind === "cabinet") f.cabinets = cabinetsOf(f).filter(c => c.id !== sel.id);
      else if (sel.kind === "roomName") f.roomNames = roomNamesOf(f).filter(r => r.id !== sel.id);
      else if (sel.kind === "opening") {
        for (const w of f.walls) w.openings = w.openings.filter(o => o.id !== sel.id);
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
    switch (this.tool) {
      case "wall":
        this.hint = this.chainStart
          ? (this.lengthBuffer ? h("wallTyped", { length: this.lengthBuffer }) : h("wallChain"))
          : h("wallStart");
        break;
      case "select":
        this.hint = this.store.sel?.kind === "wall"
          ? (this.lengthBuffer
            ? h("selectWallTyped", { length: this.lengthBuffer })
            : h("selectWall"))
          : h("select");
        break;
      case "door": this.hint = h("door"); break;
      case "window": this.hint = h("window"); break;
      case "passage": this.hint = h("passage"); break;
      case "symbol": this.hint = h("symbol", { label: getSymbol(this.symbolType) ? t("symbol." + this.symbolType) : this.symbolType }); break;
      case "stair": this.hint = h("stair", { label: t("stair." + this.stairKind) }); break;
      case "vide": this.hint = h("vide"); break;
      case "cabinet": {
        const preset = cabinetPreset(this.cabinetPresetId);
        this.hint = h("cabinet", {
          label: preset ? t("cabinet." + preset.id) : t("panel.cabinetCustom"),
        });
        break;
      }
      case "roomName":
        this.hint = this.roomNameText.trim()
          ? h("roomName", { label: this.roomNameText.trim() })
          : h("roomNameEmpty");
        break;
      case "zoom": this.hint = h("zoom"); break;
    }
  }

  /**
   * Distances from a point on a wall to both of that wall's ends, as dimension
   * lines. Drawn while something is being slid along a wall, so "150 mm from
   * the corner" is a thing you can hit by eye instead of by arithmetic.
   *
   * Distances are centerline-to-node, matching `t` and the panel's "from
   * corner" field — not to the finished inner corner (see the net-area cut in
   * PLAN.md). Like the wall dimension layer, the line follows the chord on a
   * curved wall while the numbers are true arc lengths.
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
   */
  private drawDimChains(ctx: CanvasRenderingContext2D, vp: Viewport, px: number): void {
    const chains = dimensionChains(this.floor);
    ctx.strokeStyle = COLORS.dimension;
    for (const c of chains) {
      // Skip a run too small on screen to read; at that size it is noise.
      if (c.total / px < 40) continue;
      const gap = c.half + 260;
      const at = (d: number, off: number): Vec =>
        add(add(c.origin, scale(c.dir, d)), scale(c.out, off));

      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.1 * px;
      // Extension lines from the wall face out past the chain.
      for (const d of [0, ...c.spans.map(s => s.to)]) {
        ctx.beginPath();
        const from = at(d, c.half + 60), to = at(d, gap + 90);
        ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      // The chain line, and a tick at every break.
      ctx.beginPath();
      const l0 = at(0, gap), l1 = at(c.total, gap);
      ctx.moveTo(l0.x, l0.y); ctx.lineTo(l1.x, l1.y);
      ctx.stroke();
      const tick = 7 * px;
      for (const d of [0, ...c.spans.map(s => s.to)]) {
        // A 45-degree slash, the surveyor's tick, rather than an arrowhead —
        // arrowheads collide once spans get short.
        const p = at(d, gap);
        const m = add(scale(c.dir, tick), scale(c.out, tick));
        ctx.beginPath();
        ctx.moveTo(p.x - m.x, p.y - m.y); ctx.lineTo(p.x + m.x, p.y + m.y);
        ctx.stroke();
      }
      // An overall line below, only when it says something the spans do not.
      if (c.spans.length > 1) {
        const o0 = at(0, gap + 420), o1 = at(c.total, gap + 420);
        ctx.beginPath();
        ctx.moveTo(o0.x, o0.y); ctx.lineTo(o1.x, o1.y);
        ctx.stroke();
        for (const d of [0, c.total]) {
          const p = at(d, gap + 420);
          const m = add(scale(c.dir, tick), scale(c.out, tick));
          ctx.beginPath();
          ctx.moveTo(p.x - m.x, p.y - m.y); ctx.lineTo(p.x + m.x, p.y + m.y);
          ctx.stroke();
        }
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
      if (c.spans.length > 1)
        label(String(Math.round(c.total)), c.total / 2, gap + 420 - 130, "600 11px system-ui, sans-serif");
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
  drawPreview(ctx: CanvasRenderingContext2D, vp: Viewport, collectHits = true): void {
    const px = 1 / vp.pxPerMm;
    const f = this.floor;

    // Node handles in select mode.
    if (this.tool === "select") {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#7a7f88";
      ctx.lineWidth = 1 * px;
      for (const n of f.nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3.5 * px, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
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
        this.drawDimChains(ctx, vp, px);
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

    // Cabinet placement ghost, with the two distances to the wall ends when it
    // is snapped to one — the same measurement a symbol or an opening gets.
    if (this.tool === "cabinet") {
      const ghost = this.draftCabinet("ghost");
      const snap = this.wallSnap();
      if (snap) this.drawWallOffsets(ctx, vp, px, snap.wall, snap.tMm, snap.side, ghost.depth);
      drawCabinetGhost(ctx, ghost, this.symbolColor ?? COLORS.symbol);
      const b = cabinetBox(ghost);
      drawLabel(ctx, vp,
        add(v(ghost.x, ghost.y), fromAngleRot(v(0, b.y1), ghost.rotation)),
        `${ghost.width} x ${ghost.depth}`);
    }

    // Room-name ghost: the word where the click would write it.
    if (this.tool === "roomName" && this.roomNameText.trim()) {
      const g = this.gridStep;
      drawLabel(ctx, vp,
        v(Math.round(this.cursor.x / g) * g, Math.round(this.cursor.y / g) * g),
        this.roomNameText.trim(), COLORS.roomLabel);
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
