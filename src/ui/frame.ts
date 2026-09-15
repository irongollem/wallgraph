// The "Aanzicht" (elevation) dialog: one framed wall's members drawn to
// scale in the wall's own plane, opened from the wall's pane (panel.ts,
// under its "Materiaal" head). Follows the pasteDialog() overlay/dialog
// pattern in panel.ts rather than adding a second dialog shell.
//
// The dialog reads frameLayout() fresh on open and again on every store
// revision while it stays open (store.onChange), so editing the wall behind
// it -- post centres, post width, an opening -- redraws the elevation live,
// the same way the property pane itself never caches what it shows. A wall
// that stops existing closes the dialog; one that stops being framed (or
// loses its post width) swaps the canvas for the incomplete message rather
// than closing, since the fact that would restore it is one field away.
import { Store } from "../model/store";
import type { Id } from "../model/doc";
import { resolveFloor } from "../core/resolve";
import { frameLayout, type FrameLayout } from "../core/frame";
import type { WallTakeoff, MemberName } from "../core/materials";
import { drawFrame } from "../render/frame";
import { exportFrameSvg } from "../io/frame";
import { Viewport } from "../render/viewport";
import { v, type Vec } from "../geometry/vec";
import { COLORS } from "../render/draw";
import { t } from "../i18n";

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** Paper margin around the frame the view is fitted with, mm. */
const MARGIN_MM = 500;
/** Gap between the frame and a dimension line, mm. */
const DIM_GAP_MM = 220;

/**
 * The Aanzicht button, appended where the caller is already rendering the
 * wall's own Materiaal section (panel.ts). Shown only once the takeoff
 * counted this wall as a frame at all (framed-timber/-steel -- see
 * core/materials.ts's systemOf); disabled with a title where the frame
 * exists but has no post width to size members with, the one fact
 * frameLayout() itself refuses to draw without.
 */
export function renderFrameButton(
  p: HTMLElement, wt: WallTakeoff | undefined, open: () => void,
): void {
  if (!wt || (wt.system !== "framed-timber" && wt.system !== "framed-steel")) return;
  const incomplete = wt.incomplete.includes("postWidth");
  const b = el("button", "tool-btn small wide") as HTMLButtonElement;
  b.textContent = t("frame.open");
  b.title = incomplete ? t("frame.incomplete") : t("frame.openTitle");
  b.disabled = incomplete;
  b.onclick = open;
  p.append(b);
}

/** Every member family in the layout, counted -- the legend's rows. */
function memberCounts(layout: FrameLayout): Array<[MemberName, number]> {
  const counts = new Map<MemberName, number>();
  for (const m of layout.members) counts.set(m.name, (counts.get(m.name) ?? 0) + m.count);
  return [...counts.entries()];
}

function dimLine(ctx: CanvasRenderingContext2D, vp: Viewport, a: Vec, b: Vec): void {
  const p0 = vp.toScreen(a), p1 = vp.toScreen(b);
  ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
}

function dimLabel(ctx: CanvasRenderingContext2D, vp: Viewport, at: Vec, text: string): void {
  const s = vp.toScreen(at);
  ctx.save();
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(244,242,236,0.85)";
  ctx.fillRect(s.x - w / 2 - 3, s.y - 7, w + 6, 14);
  ctx.fillStyle = COLORS.dimension;
  ctx.fillText(text, s.x, s.y);
  ctx.restore();
}

/**
 * Frame length and height and every opening's width, as plain dimension
 * lines in screen space. Deliberately not core/dimensions.ts's dimension
 * chains: that machinery measures a run of walls across a floor plan, and
 * there is exactly one span to state in each direction here.
 */
function drawDimensions(ctx: CanvasRenderingContext2D, vp: Viewport, layout: FrameLayout): void {
  const belowY = layout.heightMm + DIM_GAP_MM;
  const leftX = -DIM_GAP_MM;
  const aboveY = -DIM_GAP_MM / 2;

  ctx.save();
  ctx.strokeStyle = COLORS.dimension;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  dimLine(ctx, vp, v(0, layout.heightMm), v(0, belowY));
  dimLine(ctx, vp, v(layout.lengthMm, layout.heightMm), v(layout.lengthMm, belowY));
  dimLine(ctx, vp, v(0, belowY), v(layout.lengthMm, belowY));

  dimLine(ctx, vp, v(0, 0), v(leftX, 0));
  dimLine(ctx, vp, v(0, layout.heightMm), v(leftX, layout.heightMm));
  dimLine(ctx, vp, v(leftX, 0), v(leftX, layout.heightMm));

  for (const o of layout.openings) {
    dimLine(ctx, vp, v(o.x, 0), v(o.x, aboveY));
    dimLine(ctx, vp, v(o.x + o.w, 0), v(o.x + o.w, aboveY));
    dimLine(ctx, vp, v(o.x, aboveY), v(o.x + o.w, aboveY));
  }
  ctx.restore();

  dimLabel(ctx, vp, v(layout.lengthMm / 2, belowY), `${Math.round(layout.lengthMm)} mm`);
  dimLabel(ctx, vp, v(leftX, layout.heightMm / 2), `${Math.round(layout.heightMm)} mm`);
  for (const o of layout.openings) {
    dimLabel(ctx, vp, v(o.x + o.w / 2, aboveY), `${Math.round(o.w)} mm`);
  }
}

/**
 * Opens the elevation overlay for `wallId`. `store` is read live: nothing
 * here holds on to a snapshot of the wall, the floor or the layout beyond
 * one redraw.
 */
export function openFrameDialog(store: Store, wallId: Id): void {
  document.querySelector(".overlay")?.remove();

  const overlay = el("div", "overlay frame-overlay");
  const dialog = el("div", "dialog frame-dialog");

  const head = el("div", "frame-head");
  head.append(Object.assign(el("div", "props-title"), { textContent: t("frame.title") }));

  const canvasWrap = el("div", "frame-canvas-wrap");
  const canvas = el("canvas") as HTMLCanvasElement;
  canvasWrap.append(canvas);

  const legend = el("div", "frame-legend");
  const message = el("div", "frame-incomplete");
  message.textContent = t("frame.incomplete");
  message.hidden = true;

  const row = el("div", "dialog-row");
  const svgBtn = el("button", "tool-btn small") as HTMLButtonElement;
  svgBtn.textContent = t("frame.svg");
  const closeBtn = el("button", "tool-btn small") as HTMLButtonElement;
  closeBtn.textContent = t("action.cancel");
  row.append(svgBtn, closeBtn);

  dialog.append(head, canvasWrap, legend, message, row);
  overlay.append(dialog);
  document.body.append(overlay);

  let current: FrameLayout | null = null;

  const redraw = (): void => {
    const wall = store.floor.walls.find(w => w.id === wallId);
    if (!wall) { close(); return; }
    const resolved = resolveFloor(store.floor);
    const rw = resolved.walls.get(wallId);
    const layout = rw ? frameLayout(store.floor, wall, rw) : null;
    current = layout;

    if (!layout) {
      canvasWrap.hidden = true;
      legend.hidden = true;
      message.hidden = false;
      svgBtn.disabled = true;
      return;
    }
    canvasWrap.hidden = false;
    legend.hidden = false;
    message.hidden = true;
    svgBtn.disabled = false;

    legend.replaceChildren(...memberCounts(layout).map(([name, count]) => {
      const item = el("span", "frame-legend-item");
      item.textContent = `${count} × ${t("materials.member." + name)}`;
      return item;
    }));

    const rectW = canvasWrap.clientWidth, rectH = canvasWrap.clientHeight;
    if (rectW < 1 || rectH < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rectW * dpr);
    canvas.height = Math.round(rectH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, rectW, rectH);

    const vp = new Viewport();
    vp.dpr = dpr;
    vp.fitBox(rectW, rectH, v(0, 0), v(layout.lengthMm, layout.heightMm), MARGIN_MM);

    ctx.save();
    ctx.scale(vp.pxPerMm, vp.pxPerMm);
    ctx.translate(-vp.origin.x, -vp.origin.y);
    ctx.strokeStyle = COLORS.wallStroke;
    ctx.fillStyle = ctx.strokeStyle;
    drawFrame(ctx, layout);
    ctx.restore();

    drawDimensions(ctx, vp, layout);
  };

  const onStoreChange = (): void => redraw();
  store.onChange(onStoreChange);

  const resizeObserver = new ResizeObserver(() => redraw());
  resizeObserver.observe(canvasWrap);

  function close(): void {
    store.offChange(onStoreChange);
    resizeObserver.disconnect();
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  overlay.onclick = e => { if (e.target === overlay) close(); };
  closeBtn.onclick = () => close();
  svgBtn.onclick = () => {
    if (!current) return;
    void exportFrameSvg(current, String(Math.round(current.lengthMm)));
  };

  redraw();
}
