// Tool state machine + snapping + typed-mm input. Owns pointer/keyboard handling
// for the canvas; rendering of previews goes through getPreview()/getSnap().
import { Store } from "../model/store";
import { Floor, Wall, Opening, PlanNode, SymbolInstance, newId, stairsOf, floorHeight, DOOR_DEFAULT_WIDTH, WINDOW_DEFAULT_WIDTH, PASSAGE_DEFAULT_WIDTH, OpeningKind } from "../model/doc";
import {
  Stair, ResolvedStair, StairKind, StairParams, stairDefaults, stairFields, clampStair,
  stairAngle, inheritsRise,
} from "../model/stair";
import { nodeAt, splitWall, nearestWall, wallLength, mergeNodes, deleteWall, clampOpening, cleanOrphanNodes } from "../model/ops";
import { Viewport } from "../render/viewport";
import { Vec, v, add, sub, scale, norm, perp, dist, angleOf, fromAngle, dot, pointInPolygon } from "../geometry/vec";
import { arcPointAt, arcTangentAt, bulgeFromSagitta } from "../geometry/arc";
import { getSymbol, SymbolDef, SYMBOL_TYPES } from "../render/symbols";
import { stairHit, resolveStair, stairBox, stairIssues, gradient } from "../core/stair";
import { drawStairGhost } from "../render/stair";
import { drawLabel, COLORS, symbolInk } from "../render/draw";
import { Resolved, ResolvedWall } from "../core/resolve";
import { dimensionChains } from "../core/dimensions";
import { t } from "../i18n";

export type ToolName = "select" | "wall" | "door" | "window" | "passage" | "symbol" | "stair";

export interface SnapResult { p: Vec; kind: "node" | "wall" | "grid" | "free"; wall?: Wall; tMm?: number; node?: PlanNode }

interface DragState {
  kind: "node" | "wall" | "symbol" | "stair" | "bow" | "opening" | "pan";
  id?: string;
  wallId?: string;
  startWorld: Vec;
  orig?: unknown;
  moved: boolean;
  lastScreen?: Vec;
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

  constructor(
    private store: Store,
    private vp: Viewport,
    private canvas: HTMLCanvasElement,
    private requestRender: () => void,
    private getResolved: () => Resolved,
    private onToolChange: () => void,
  ) {
    canvas.addEventListener("pointerdown", e => this.onDown(e));
    canvas.addEventListener("pointermove", e => this.onMove(e));
    canvas.addEventListener("pointerup", () => this.onUp());
    canvas.addEventListener("wheel", e => this.onWheel(e), { passive: false });
    canvas.addEventListener("pointerleave", () => {
      this.hoverSymbol = null; this.hoverStair = null; this.requestRender();
    });
    canvas.addEventListener("contextmenu", e => { e.preventDefault(); this.cancel(); });
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

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.hoverSymbol = null; // a name pill has no business sitting under a click or drag
    this.hoverStair = null;
    const s = this.screenOf(e);
    const w = this.vp.toWorld(s);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.getModifierState("Space"))) {
      this.drag = { kind: "pan", startWorld: w, moved: false, lastScreen: s };
      return;
    }
    if (e.button !== 0) return;

    if (this.tool === "select") {
      const hit = this.dimRects.find(r => s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h);
      if (hit) {
        e.preventDefault();
        this.closeDimInput();
        this.openDimInput(hit);
        return;
      }
    }
    switch (this.tool) {
      case "wall": this.wallClick(); break;
      case "door": this.placeOpening("door"); break;
      case "window": this.placeOpening("window"); break;
      case "passage": this.placeOpening("passage"); break;
      case "symbol": this.placeSymbol(); break;
      case "stair": this.placeStair(); break;
      case "select": this.selectDown(s, w); break;
    }
  }

  private onMove(e: PointerEvent): void {
    const s = this.screenOf(e);
    const w = this.vp.toWorld(s);
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

  private onUp(): void {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.kind === "node" && d.moved) {
      // Merge if dropped onto another node.
      this.store.mutate(doc => {
        const f = this.store.floorOf(doc);
        const me = f.nodes.find(n => n.id === d.id);
        if (!me) return;
        for (const n of f.nodes) {
          if (n.id !== me.id && dist(v(n.x, n.y), v(me.x, me.y)) <= 1) { mergeNodes(f, n.id, me.id); break; }
        }
      }, "nodedrop");
    }
    this.requestRender();
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
    const width = kind === "door" ? DOOR_DEFAULT_WIDTH : kind === "window" ? WINDOW_DEFAULT_WIDTH : PASSAGE_DEFAULT_WIDTH;
    const o: Opening = {
      id: newId("o"), kind, t: Math.round(nw.tMm / 10) * 10, width,
      ...(kind === "door" ? { hinge: "a" as const, swingIn: true } : {}),
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
    this.store.select(null);
    this.drag = { kind: "pan", startWorld: w, moved: false, lastScreen: s };
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

    // Typed mm entry during wall drawing.
    if (this.tool === "wall" && this.chainStart) {
      if (/^[0-9.]$/.test(e.key)) { this.lengthBuffer += e.key; this.updateHint(); this.onToolChange(); this.requestRender(); return; }
      if (e.key === "Backspace") { this.lengthBuffer = this.lengthBuffer.slice(0, -1); this.updateHint(); this.onToolChange(); this.requestRender(); return; }
      if (e.key === "Enter" && this.lengthBuffer) { this.wallClick(); return; }
    }

    // Typed mm entry with a wall selected: type digits, Enter resizes it.
    if (this.tool === "select" && this.store.sel?.kind === "wall") {
      if (/^[0-9.]$/.test(e.key)) { this.lengthBuffer += e.key; this.updateHint(); this.onToolChange(); this.requestRender(); return; }
      if (e.key === "Backspace" && this.lengthBuffer) { this.lengthBuffer = this.lengthBuffer.slice(0, -1); this.updateHint(); this.onToolChange(); this.requestRender(); return; }
      if (e.key === "Enter" && this.lengthBuffer) { this.applyTypedLength(); return; }
      if (e.key === "Escape" && this.lengthBuffer) { this.lengthBuffer = ""; this.updateHint(); this.onToolChange(); this.requestRender(); return; }
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
    const sel = this.store.sel;
    if (sel?.kind === "stair") {
      this.store.mutate(doc => {
        const st = stairsOf(this.store.floorOf(doc)).find(x => x.id === sel.id);
        if (st) st.rotation = stairAngle(st.rotation + Math.PI / 2);
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
    const sel = this.store.sel;
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
      else if (sel.kind === "opening") {
        for (const w of f.walls) w.openings = w.openings.filter(o => o.id !== sel.id);
      }
    });
    this.store.select(null);
  }

  updateHint(): void {
    switch (this.tool) {
      case "wall":
        this.hint = this.chainStart
          ? (this.lengthBuffer ? t("hint.wallTyped", { length: this.lengthBuffer }) : t("hint.wallChain"))
          : t("hint.wallStart");
        break;
      case "select":
        this.hint = this.store.sel?.kind === "wall"
          ? (this.lengthBuffer
            ? t("hint.selectWallTyped", { length: this.lengthBuffer })
            : t("hint.selectWall"))
          : t("hint.select");
        break;
      case "door": this.hint = t("hint.door"); break;
      case "window": this.hint = t("hint.window"); break;
      case "passage": this.hint = t("hint.passage"); break;
      case "symbol": this.hint = t("hint.symbol", { label: getSymbol(this.symbolType) ? t("symbol." + this.symbolType) : this.symbolType }); break;
      case "stair": this.hint = t("hint.stair", { label: t("stair." + this.stairKind) }); break;
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
  private drawDimension(ctx: CanvasRenderingContext2D, vp: Viewport, px: number, wall: Wall, emphasized: boolean): void {
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
    this.dimRects.push({ x: rx, y: ry, w: rw, h: rh, wallId: wall.id });
  }

  /** World-space preview drawing, called inside the world transform. */
  drawPreview(ctx: CanvasRenderingContext2D, vp: Viewport): void {
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
      this.dimRects = [];
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
          if (wall) this.drawDimension(ctx, vp, px, wall, true);
        }
      } else if (selDim?.kind === "wall") {
        const wall = f.walls.find(x => x.id === selDim.id);
        if (wall) this.drawDimension(ctx, vp, px, wall, true);
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

    // Opening placement ghost.
    if (this.tool === "door" || this.tool === "window" || this.tool === "passage") {
      const nw = nearestWall(f, this.cursor, 30 / vp.pxPerMm);
      if (nw) {
        const a = f.nodes.find(x => x.id === nw.wall.a)!, b = f.nodes.find(x => x.id === nw.wall.b)!;
        const L = wallLength(f, nw.wall);
        const width = this.tool === "door" ? DOOR_DEFAULT_WIDTH : this.tool === "window" ? WINDOW_DEFAULT_WIDTH : PASSAGE_DEFAULT_WIDTH;
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

function fromAngleRot(p: Vec, ang: number): Vec {
  const c = Math.cos(ang), s = Math.sin(ang);
  return v(p.x * c - p.y * s, p.x * s + p.y * c);
}
