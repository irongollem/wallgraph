// The 3D view controller: owns its canvas and the orbit gestures, caches the
// scene mesh against the document revision, and coalesces redraws through one
// requestAnimationFrame — the render3d counterpart of main.ts's derived() and
// requestRender() pair. All listeners sit on the canvas; nothing here touches
// window or document beyond creating the element and reading the pixel ratio.
import type { PlanDoc } from "../model/doc";
import { buildSceneMesh, Mesh3D } from "./mesh";
import { OrbitCamera } from "./camera";
import { GLRenderer } from "./gl";

/** Orbit speed: radians of yaw/pitch per pixel of drag. */
const ORBIT_RAD_PER_PX = 0.008;
/** Wheel dolly: distance factor exp(deltaY * this). */
const WHEEL_DOLLY = 0.0011;
/** A press that stays within this many pixels of its start is a tap. */
const TAP_SLOP_PX = 8;
/** Two taps this close in time and space fit the view. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;
/** Match the 2D fit rule: very tall compact chrome may overlap the frame, but
 * never shrink it below half of either canvas axis. */
const MIN_FIT_FRACTION = 0.5;

interface Pointer {
  x: number;
  y: number;
  pan: boolean;
  button: number;
  downX: number;
  downY: number;
  moved: boolean;
}

export class View3D {
  /** The caller appends this; it fills its parent and starts hidden. */
  readonly canvas: HTMLCanvasElement;

  private readonly docFn: () => PlanDoc;
  private readonly revisionFn: () => number;
  private readonly insetsFn: (() => { top: number; right: number; bottom: number; left: number }) | null;
  private readonly hiddenFn: (() => ReadonlySet<string>) | null;
  private readonly cam = new OrbitCamera();
  private renderer: GLRenderer | null = null;
  private mesh: Mesh3D | null = null;
  private meshKey: string | null = null;
  private generation = 0;
  private on = false;
  private queued = false;
  private readonly pointers = new Map<number, Pointer>();
  private lastTap: { t: number; x: number; y: number } | null = null;

  constructor(opts: {
    doc: () => PlanDoc;
    revision: () => number;
    /** Chrome cover in CSS px, the same figure the 2D fits inset by — in the
     *  compact layout the sheet floats over the canvas, and a fit centred on
     *  the full box would centre the building behind it. */
    insets?: () => { top: number; right: number; bottom: number; left: number };
    /** Floor ids the 3D scene leaves out — the per-storey toggles. Part of
     *  the mesh cache key alongside the revision. */
    hidden?: () => ReadonlySet<string>;
  }) {
    this.docFn = opts.doc;
    this.revisionFn = opts.revision;
    this.insetsFn = opts.insets ?? null;
    this.hiddenFn = opts.hidden ?? null;
    const c = document.createElement("canvas");
    this.canvas = c;
    c.style.position = "absolute";
    c.style.left = "0";
    c.style.top = "0";
    c.style.width = "100%";
    c.style.height = "100%";
    c.style.touchAction = "none";
    c.hidden = true;
    c.addEventListener("contextmenu", e => e.preventDefault());
    c.addEventListener("pointerdown", e => this.onPointerDown(e));
    c.addEventListener("pointermove", e => this.onPointerMove(e));
    c.addEventListener("pointerup", e => this.onPointerUp(e));
    c.addEventListener("pointercancel", e => this.onPointerCancel(e));
    c.addEventListener("wheel", e => this.onWheel(e), { passive: false });
  }

  get active(): boolean {
    return this.on;
  }

  /**
   * Show or hide the view. Turning it on rebuilds a stale mesh, reframes the
   * building and renders; turning it off only hides the canvas — the mesh
   * cache stays for the next activation. Returns false and leaves the canvas
   * hidden when WebGL is unavailable, so the caller can reset its mode state.
   */
  setActive(on: boolean): boolean {
    this.on = on;
    this.canvas.hidden = !on;
    if (!on) return true;
    if (!this.renderer) {
      try {
        this.renderer = new GLRenderer(this.canvas, () => this.requestRender());
      } catch {
        this.on = false;
        this.canvas.hidden = true;
        this.canvas.dataset["webgl"] = "unavailable";
        return false;
      }
    }
    delete this.canvas.dataset["webgl"];
    this.refreshMesh();
    this.fit();
    return true;
  }

  /** Reframe the building — the zoom-all analog. Centres in the part of the
   *  canvas the chrome leaves visible, like Tools.applyFit() does in 2D. */
  fit(): void {
    const mesh = this.on ? this.refreshMesh() : this.mesh;
    const b = mesh?.bounds;
    if (b) {
      const rect = this.canvas.parentElement?.getBoundingClientRect();
      const w = rect?.width ?? 0, h = rect?.height ?? 0;
      const ins = this.insetsFn?.();
      const boxW = ins && w > 0 ? Math.max(w * MIN_FIT_FRACTION, w - ins.left - ins.right) : w;
      const boxH = ins && h > 0 ? Math.max(h * MIN_FIT_FRACTION, h - ins.top - ins.bottom) : h;
      this.cam.fit(b, w > 0 && h > 0 ? w / h : 1, w > 0 ? boxW / w : 1, h > 0 ? boxH / h : 1);
      if (ins && w > 0 && h > 0) {
        const left = Math.min(ins.left, w - boxW);
        const top = Math.min(ins.top, h - boxH);
        this.cam.pan(left + boxW / 2 - w / 2, top + boxH / 2 - h / 2, h);
      }
    }
    this.requestRender();
  }

  /** Coalesced redraw; a no-op while inactive. The frame itself rebuilds the
   *  mesh when revision() moved, exactly like the 2D derived() cache. */
  requestRender(): void {
    if (!this.on || this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.renderFrame();
    });
  }

  private refreshMesh(): Mesh3D {
    const hidden = this.hiddenFn?.();
    const key = this.revisionFn() + ":" + (hidden ? [...hidden].sort().join("|") : "");
    if (!this.mesh || key !== this.meshKey) {
      this.meshKey = key;
      this.mesh = buildSceneMesh(this.docFn(), hidden);
      this.generation++;
    }
    return this.mesh;
  }

  private renderFrame(): void {
    if (!this.on) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = rect.width + "px";
      this.canvas.style.height = rect.height + "px";
    }
    if (!this.renderer) return;
    this.renderer.upload(this.refreshMesh(), this.generation);
    this.renderer.draw(this.cam.viewProjection(w / h));
  }

  // ── gestures ──────────────────────────────────────────────────────────────
  // One pointer drags orbit; shift, middle or right button drags pan; two
  // pointers pinch-dolly and pan by their midpoint at once; wheel dollies;
  // a double click or double tap refits.

  private onPointerDown(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const pan = e.shiftKey || e.button === 1 || e.button === 2;
    this.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, pan, button: e.button,
      downX: e.clientX, downY: e.clientY, moved: false,
    });
    if (this.pointers.size > 1) {
      // A multi-pointer gesture is never a tap.
      this.lastTap = null;
      for (const p of this.pointers.values()) p.moved = true;
    }
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const h = this.canvas.clientHeight || 1;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const prevMidX = (a.x + b.x) / 2, prevMidY = (a.y + b.y) / 2;
      const prevSpan = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX;
      p.y = e.clientY;
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      this.cam.pan(midX - prevMidX, midY - prevMidY, h);
      if (prevSpan > 1 && span > 1) this.cam.dolly(prevSpan / span);
      this.requestRender();
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.abs(e.clientX - p.downX) > TAP_SLOP_PX || Math.abs(e.clientY - p.downY) > TAP_SLOP_PX) {
      p.moved = true;
    }
    if (this.pointers.size !== 1) return;
    if (p.pan) this.cam.pan(dx, dy, h);
    // Dragging right spins the building right, dragging down tips it toward
    // a top view: yaw runs against dx, pitch with dy.
    else this.cam.orbit(-dx * ORBIT_RAD_PER_PX, dy * ORBIT_RAD_PER_PX);
    this.requestRender();
  }

  private onPointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.moved || p.button !== 0 || this.pointers.size > 0) return;
    const now = performance.now();
    const prior = this.lastTap;
    if (prior && now - prior.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - prior.x, e.clientY - prior.y) < DOUBLE_TAP_PX) {
      this.lastTap = null;
      this.fit();
    } else {
      this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }

  private onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.lastTap = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // deltaMode 1 is lines (Firefox wheels); scale to a pixel-like figure.
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.cam.dolly(Math.exp(dy * WHEEL_DOLLY));
    this.requestRender();
  }
}
