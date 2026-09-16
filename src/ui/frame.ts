// The "Aanzicht" (elevation) dialog: one wall's face drawn to scale in its
// own plane, opened from the wall's pane (panel.ts, under its "Materiaal"
// head). Follows the pasteDialog() overlay/dialog pattern in panel.ts rather
// than adding a second dialog shell.
//
// The button is always present and never disabled: every wall has a face to
// draw, whatever its material. The dialog reads wallElevation() fresh on
// open and again on every store revision while it stays open
// (store.onChange), so editing the wall behind it -- post centres, a block
// format, an opening -- redraws the elevation live, the same way the
// property pane itself never caches what it shows. A wall that stops
// existing closes the dialog; one that stops being able to state its own
// kind's one fact (a post width, a block format, a panel width) keeps
// drawing the face and gains a note in the legend instead, since the fact
// that would complete it is one field away.
import { Store } from "../model/store";
import type { Id } from "../model/doc";
import { resolveFloor } from "../core/resolve";
import { wallElevation, type WallElevation } from "../core/frame";
import type { MemberName } from "../core/materials";
import { drawElevation } from "../render/frame";
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

/** Paper margin around the elevation the view is fitted with, mm. */
const MARGIN_MM = 500;
/** Gap between the elevation and a dimension line, mm. */
const DIM_GAP_MM = 220;

/**
 * The Aanzicht button, appended where the caller is already rendering the
 * wall's own Materiaal section (panel.ts). Always present and never
 * disabled -- every wall has a face and openings to draw at minimum, so
 * there is nothing to disable it for; the dialog itself says what a
 * particular wall's kind is still missing.
 */
export function renderFrameButton(p: HTMLElement, open: () => void): void {
  const b = el("button", "tool-btn small wide") as HTMLButtonElement;
  b.textContent = t("frame.open");
  b.title = t("frame.openTitle");
  b.onclick = open;
  p.append(b);
}

/** Every member family in a framed elevation, counted -- the legend's rows. */
function memberCounts(members: WallElevation["members"]): Array<[MemberName, number]> {
  const counts = new Map<MemberName, number>();
  for (const m of members) counts.set(m.name, (counts.get(m.name) ?? 0) + m.count);
  return [...counts.entries()];
}

function legendRow(text: string, cls = "frame-legend-item"): HTMLElement {
  const item = el("span", cls);
  item.textContent = text;
  return item;
}

/**
 * The legend's own rows: member counts for a frame, whole and cut block
 * counts for a block wall, the panel count for a sandwich wall (only once a
 * panel width is stated -- otherwise there is nothing to count), and for
 * every entry in `notes` a line naming the missing field. A plain wall, or
 * any kind with nothing counted, gets only its notes (or no rows at all).
 */
function legendRows(e: WallElevation): HTMLElement[] {
  const rows: HTMLElement[] = [];
  if (e.kind === "frame") {
    rows.push(...memberCounts(e.members).map(([name, count]) =>
      legendRow(`${count} × ${t("materials.member." + name)}`)));
  } else if (e.kind === "block") {
    const whole = e.courses.reduce((n, c) => n + c.blocks.filter(b => !b.cut).length, 0);
    const cut = e.courses.reduce((n, c) => n + c.blocks.filter(b => b.cut).length, 0);
    if (whole > 0) rows.push(legendRow(t("frame.legendBlocks", { n: whole })));
    if (cut > 0) rows.push(legendRow(t("frame.legendCut", { n: cut })));
  } else if (e.kind === "panel" && e.notes.length === 0) {
    rows.push(legendRow(t("frame.legendPanels", { n: e.panelEdges.length + 1 })));
  }
  for (const note of e.notes) rows.push(legendRow(t("frame.note_" + note), "frame-legend-note"));
  return rows;
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
 * Elevation length and height and every opening's width, as plain dimension
 * lines in screen space. Deliberately not core/dimensions.ts's dimension
 * chains: that machinery measures a run of walls across a floor plan, and
 * there is exactly one span to state in each direction here.
 */
function drawDimensions(ctx: CanvasRenderingContext2D, vp: Viewport, e: WallElevation): void {
  const belowY = e.heightMm + DIM_GAP_MM;
  const leftX = -DIM_GAP_MM;
  // Opening widths stand above the elevation's highest point; half a gap put
  // the label on a gable's peak.
  const aboveY = -DIM_GAP_MM;

  ctx.save();
  ctx.strokeStyle = COLORS.dimension;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  dimLine(ctx, vp, v(0, e.heightMm), v(0, belowY));
  dimLine(ctx, vp, v(e.lengthMm, e.heightMm), v(e.lengthMm, belowY));
  dimLine(ctx, vp, v(0, belowY), v(e.lengthMm, belowY));

  dimLine(ctx, vp, v(0, 0), v(leftX, 0));
  dimLine(ctx, vp, v(0, e.heightMm), v(leftX, e.heightMm));
  dimLine(ctx, vp, v(leftX, 0), v(leftX, e.heightMm));

  for (const o of e.openings) {
    dimLine(ctx, vp, v(o.x, 0), v(o.x, aboveY));
    dimLine(ctx, vp, v(o.x + o.w, 0), v(o.x + o.w, aboveY));
    dimLine(ctx, vp, v(o.x, aboveY), v(o.x + o.w, aboveY));
  }
  ctx.restore();

  dimLabel(ctx, vp, v(e.lengthMm / 2, belowY), `${Math.round(e.lengthMm)} mm`);
  dimLabel(ctx, vp, v(leftX, e.heightMm / 2), `${Math.round(e.heightMm)} mm`);
  for (const o of e.openings) {
    dimLabel(ctx, vp, v(o.x + o.w / 2, aboveY), `${Math.round(o.w)} mm`);
  }
}

/**
 * Opens the elevation overlay for `wallId`. `store` is read live: nothing
 * here holds on to a snapshot of the wall, the floor or the elevation beyond
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

  const row = el("div", "dialog-row");
  const svgBtn = el("button", "tool-btn small") as HTMLButtonElement;
  svgBtn.textContent = t("frame.svg");
  const closeBtn = el("button", "tool-btn small") as HTMLButtonElement;
  closeBtn.textContent = t("action.cancel");
  row.append(svgBtn, closeBtn);

  dialog.append(head, canvasWrap, legend, row);
  overlay.append(dialog);
  document.body.append(overlay);

  let current: WallElevation | null = null;

  const redraw = (): void => {
    const wall = store.floor.walls.find(w => w.id === wallId);
    if (!wall) { close(); return; }
    const resolved = resolveFloor(store.floor);
    const rw = resolved.walls.get(wallId);
    if (!rw) { close(); return; }
    const elevation = wallElevation(store.floor, wall, rw);
    current = elevation;

    legend.replaceChildren(...legendRows(elevation));

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
    vp.fitBox(rectW, rectH, v(0, 0), v(elevation.lengthMm, elevation.heightMm), MARGIN_MM);

    ctx.save();
    ctx.scale(vp.pxPerMm, vp.pxPerMm);
    ctx.translate(-vp.origin.x, -vp.origin.y);
    ctx.strokeStyle = COLORS.wallStroke;
    ctx.fillStyle = ctx.strokeStyle;
    drawElevation(ctx, elevation);
    ctx.restore();

    drawDimensions(ctx, vp, elevation);
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
