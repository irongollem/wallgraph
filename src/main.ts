// Editor factory: builds the full editor inside a host element.
// Standalone page entry is src/boot.ts; frameworks call mountWallgraph directly.
import { Store } from "./model/store";
import { resolveFloor, Resolved } from "./core/resolve";
import { detectRooms, Room } from "./core/rooms";
import { Viewport } from "./render/viewport";
import { drawScene } from "./render/draw";
import { Tools } from "./input/tools";
import { Panel } from "./ui/panel";
import { tryLoadAutosave, scheduleAutosave } from "./io/json";
import { seedDoc } from "./seed";
import { v } from "./geometry/vec";

export function mountWallgraph(app: HTMLElement): void {
app.innerHTML = "";
app.classList.add("app");

const side = document.createElement("div");
side.className = "side";
const header = document.createElement("div");
header.className = "brand";
header.innerHTML = '<h1>Wallgraph</h1><p>mm-exact floorplans, drawn fast</p>';
side.append(header);
const canvasWrap = document.createElement("div");
canvasWrap.className = "canvas-wrap";
const canvas = document.createElement("canvas");
canvasWrap.append(canvas);
app.append(side, canvasWrap);

const store = new Store();
const vp = new Viewport();

// Derived-geometry cache keyed on revision.
let cachedRev = -1;
let cachedResolved: Resolved = { walls: new Map() };
let cachedRooms: Room[] = [];
function derived(): { resolved: Resolved; rooms: Room[] } {
  if (store.revision !== cachedRev) {
    cachedRev = store.revision;
    cachedResolved = resolveFloor(store.floor);
    cachedRooms = detectRooms(store.floor);
  }
  return { resolved: cachedResolved, rooms: cachedRooms };
}

let renderQueued = false;
function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

const tools = new Tools(store, vp, canvas, requestRender, () => derived().resolved, () => panel.refreshToolbar());
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
  const { resolved, rooms } = derived();
  drawScene(ctx, vp, rect.width, rect.height, store.floor, resolved, rooms, store.sel, {
    hoverSnap: tools.getSnap(),
    preview: (c, viewport) => tools.drawPreview(c, viewport),
  }, store.doc.gridMm);
}

store.onChange(() => { scheduleAutosave(store.doc); requestRender(); });
window.addEventListener("resize", requestRender);

// Initial document: autosave if present, else the demo plan.
const saved = tryLoadAutosave();
store.replace(saved ?? seedDoc());

// Fit the plan roughly into view.
(function fit(): void {
  const f = store.floor;
  if (f.nodes.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of f.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  const rect = canvasWrap.getBoundingClientRect();
  const w = maxX - minX + 2000, h = maxY - minY + 2000;
  vp.pxPerMm = Math.min(rect.width / w, rect.height / h);
  vp.origin = v(minX - 1000 - (rect.width / vp.pxPerMm - w) / 2, minY - 1000 - (rect.height / vp.pxPerMm - h) / 2);
})();

requestRender();
}
