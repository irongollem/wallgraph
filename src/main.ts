// Editor factory: builds the full editor inside a host element.
// Standalone page entry is src/boot.ts; frameworks call mountWallgraph directly.
import { Store } from "./model/store";
import { resolveFloor, Resolved } from "./core/resolve";
import { detectRooms, Room } from "./core/rooms";
import { Viewport } from "./render/viewport";
import { drawScene, COLORS, type GhostFloor } from "./render/draw";
import { Tools } from "./input/tools";
import { Panel } from "./ui/panel";
import { tryLoadAutosave, scheduleAutosave } from "./io/json";
import { seedDoc } from "./seed";
import { areaModeOf, dimModeOf, PlanDoc } from "./model/doc";
import { riserMarks } from "./core/continuation";
import { v } from "./geometry/vec";
import { language, on as onI18n } from "./i18n";

/**
 * What a caller holds after mounting: enough to put a plan in and take one out,
 * and nothing else. The editor's internals stay private — an embedder that
 * wants to drive it programmatically needs exactly these two verbs, and every
 * further one would be a promise about the state machine we do not want to make.
 *
 * `load` goes through `Store.replace(doc, true)`, so it lands as an undoable
 * step: Ctrl+Z after a programmatic load restores what the visitor had.
 */
export interface Wallgraph {
  /** Replace the document. Returns false if `doc` is not a plan. */
  load(doc: PlanDoc): boolean;
  /** The current document. A deep copy — mutating it does not touch the editor. */
  save(): PlanDoc;
}

export function mountWallgraph(app: HTMLElement): Wallgraph {
  app.innerHTML = "";
  app.classList.add("app");

  const side = document.createElement("div");
  side.className = "side";
  // The wordmark moved into Panel's own header; main owns only the shell.
  // <html lang> follows the UI language so hyphens:auto breaks Dutch compounds
  // with the right dictionary -- it has to track changes, not just the mount.
  const syncLang = (): void => {
    try { document.documentElement.lang = language(); } catch { /* no DOM in tests */ }
  };
  syncLang();
  onI18n("languageChanged", syncLang);
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  const canvas = document.createElement("canvas");
  // The magnified inset a touch gesture gets, so the point being placed is not
  // the one under the fingertip. Hidden — and never rendered — for a mouse.
  const loupe = document.createElement("canvas");
  loupe.className = "loupe";
  loupe.hidden = true;
  canvasWrap.append(canvas, loupe);
  app.append(side, canvasWrap);

  const store = new Store();
  const vp = new Viewport();

  // Derived-geometry cache keyed on revision. Switching storey goes through
  // Store.setActiveFloor, which notifies and so bumps revision — that is what
  // keeps this cache honest across floors without a second key.
  let cachedRev = -1;
  let cachedResolved: Resolved = { walls: new Map(), junctions: [] };
  let cachedRooms: Room[] = [];
  let cachedGhost: GhostFloor | null = null;
  function derived(): { resolved: Resolved; rooms: Room[]; ghost: GhostFloor | null } {
    if (store.revision !== cachedRev) {
      cachedRev = store.revision;
      cachedResolved = resolveFloor(store.floor);
      cachedRooms = detectRooms(store.floor);
      const below = store.floorBelow;
      cachedGhost = below ? { floor: below, resolved: resolveFloor(below) } : null;
    }
    return { resolved: cachedResolved, rooms: cachedRooms, ghost: cachedGhost };
  }

  let renderQueued = false;
  function requestRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  const tools = new Tools(
    store, vp, canvas, requestRender,
    () => derived().resolved, () => panel.refreshToolbar(), () => derived().rooms,
  );
  const panel = new Panel(side, store, tools);

  function render(): void {
    const ctx = canvas.getContext("2d")!;
    const rect = canvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    vp.dpr = dpr;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { resolved, rooms, ghost } = derived();
    drawScene(ctx, vp, rect.width, rect.height, store.floor, resolved, rooms, store.sel, {
      hoverSnap: tools.getSnap(),
      ghost,
      selMore: store.selMore,
      riserMarks: riserMarks(store.doc, store.activeFloor),
      showUnderlay: tools.showUnderlay,
      layers: tools.layers,
      dimLayers: tools.dimLayers(),
      requestRedraw: requestRender,
      selectMode: tools.selectModeBadge(),
      preview: (c, viewport) => tools.drawPreview(c, viewport),
    }, store.doc.gridMm, areaModeOf(store.doc), dimModeOf(store.doc));
    renderLoupe(rect, dpr, resolved, rooms, ghost);
  }

  /** Side of the square magnifier, in CSS px. */
  const LOUPE_PX = 92;
  /** How much closer the inset sits than the plan itself. */
  const LOUPE_ZOOM = 4;
  /** Gap between the fingertip and the inset's near edge. */
  const LOUPE_LIFT = 84;

  /**
   * The magnified inset. A second pass of the same renderer through a viewport
   * centred on the touch point — not a copy of pixels from the main canvas,
   * which at four times the size would be four times as blurry, and would show
   * the plan at the zoom the finger is already covering.
   */
  function renderLoupe(
    rect: DOMRect, dpr: number, resolved: Resolved, rooms: Room[], ghost: GhostFloor | null,
  ): void {
    const at = tools.loupeAt();
    if (!at) { loupe.hidden = true; return; }
    loupe.hidden = false;
    if (loupe.width !== Math.round(LOUPE_PX * dpr)) {
      loupe.width = loupe.height = Math.round(LOUPE_PX * dpr);
      loupe.style.width = loupe.style.height = LOUPE_PX + "px";
    }
    // Above the finger where there is room, below it near the top edge.
    const below = at.y - LOUPE_LIFT - LOUPE_PX / 2 < 0;
    const cx = Math.max(LOUPE_PX / 2, Math.min(rect.width - LOUPE_PX / 2, at.x));
    const cy = at.y + (below ? LOUPE_LIFT : -LOUPE_LIFT);
    loupe.style.left = Math.round(cx - LOUPE_PX / 2) + "px";
    loupe.style.top = Math.round(cy - LOUPE_PX / 2) + "px";

    const world = vp.toWorld(at);
    const lens = new Viewport();
    lens.dpr = dpr;
    lens.pxPerMm = vp.pxPerMm * LOUPE_ZOOM;
    lens.origin = v(world.x - LOUPE_PX / 2 / lens.pxPerMm, world.y - LOUPE_PX / 2 / lens.pxPerMm);

    const lctx = loupe.getContext("2d")!;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(lctx, lens, LOUPE_PX, LOUPE_PX, store.floor, resolved, rooms, store.sel, {
      hoverSnap: tools.getSnap(),
      ghost,
      selMore: store.selMore,
      riserMarks: riserMarks(store.doc, store.activeFloor),
      // Draws the preview, but leaves the dimension hit rects to the canvas
      // pass: they are tested in canvas screen coordinates, not the lens's.
      preview: (c, viewport) => tools.drawPreview(c, viewport, false),
      showGrid: false,
      showUnderlay: tools.showUnderlay,
      layers: tools.layers,
      dimLayers: tools.dimLayers(),
    }, store.doc.gridMm, areaModeOf(store.doc), dimModeOf(store.doc));
    // Crosshair at the exact point, drawn last so nothing covers it.
    lctx.strokeStyle = COLORS.snap;
    lctx.lineWidth = 1;
    lctx.beginPath();
    lctx.moveTo(LOUPE_PX / 2, LOUPE_PX / 2 - 12); lctx.lineTo(LOUPE_PX / 2, LOUPE_PX / 2 + 12);
    lctx.moveTo(LOUPE_PX / 2 - 12, LOUPE_PX / 2); lctx.lineTo(LOUPE_PX / 2 + 12, LOUPE_PX / 2);
    lctx.stroke();
  }

  store.onChange(() => { scheduleAutosave(store.doc); requestRender(); });
  window.addEventListener("resize", requestRender);

  // Initial document: autosave if present, else the demo plan.
  const saved = tryLoadAutosave();
  store.replace(saved ?? seedDoc());

  // Frame the plan on open, and again whenever one arrives programmatically —
  // a plan from a link would otherwise land somewhere off screen. This is the
  // same zoom-all F reaches, so the opening view and the one the reader can get
  // back to are the same view, and both frame what planBounds() reports rather
  // than the node positions alone.
  //
  // In the compact layout the chrome floats over a full-bleed canvas, so every
  // fit has to aim at the uncovered part of it. The panel is what knows how
  // much that is; Tools applies it to all of them at once.
  tools.viewInsets = () => panel.canvasInsets();
  // A room's area figure on the canvas is the way into that room's row in the
  // panel, where its name is written. Rooms are derived and so cannot be
  // selected; this is the whole of the connection between the two.
  tools.onRoomLabel = room => panel.editRoom(room);
  // A shell change re-frames: what was centred beside a sidebar is centred
  // under a sheet.
  panel.onLayoutChange = () => { tools.fitAll(); };
  tools.fitAll();

  requestRender();

  return {
    load(doc: PlanDoc): boolean {
      if (!doc || doc.version !== 1 || !Array.isArray(doc.floors) || !doc.floors[0]) return false;
      store.replace(doc, true);
      tools.fitAll();
      requestRender();
      return true;
    },
    save(): PlanDoc {
      return JSON.parse(JSON.stringify(store.doc)) as PlanDoc;
    },
  };
}
