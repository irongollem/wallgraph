// Full scene render. Immediate mode: redraw everything on change (documents at
// this scale render in well under a frame). Layers: grid, rooms, walls,
// opening decorations, symbols, selection, labels (labels in screen space).
import { Floor, SymbolInstance, AreaMode, Sash, sashesOf } from "../model/doc";
import { Resolved, OpeningGeom } from "../core/resolve";
import { Room } from "../core/rooms";
import { Selection } from "../model/store";
import { Viewport } from "./viewport";
import { Vec, add, sub, scale, perp, v, angleOf, dist, fromAngle } from "../geometry/vec";
import { getSymbol } from "./symbols";
import { t } from "../i18n";
import { gridSteps, GridSteps } from "./grid";

export const COLORS = {
  bg: "#f4f2ec",
  grid: "#eae7dd",       // sub-grid: recedes, just enough to gauge a distance
  gridMajor: "#c3bfae",  // metre grid: a clearly heavier line, not a shade of the same
  roomFill: "#faf9f5",
  roomLabel: "#8a8577",
  ghost: "#9aa0a8",   // storey below, drawn under the active one
  hud: "#a7a293",
  wallFill: "#3d4148",
  wallStroke: "#26292e",
  opening: "#3d4148",
  symbol: "#4a5568",
  select: "#e05d2d",
  snap: "#2d7de0",
  dimension: "#2d7de0",
};

/**
 * The pens a plan is annotated with, offered as presets by the colour picker.
 *
 * A verbouwtekening states the status of the work in colour rather than in
 * words: what is there in black, what is to be built in red, what is to be
 * removed in yellow. That is drawing-office convention (it is what a bouwaanvraag
 * set is read with), not a NEN symbol rule, so these are a starting point and
 * any colour is allowed — the picker's free swatch is not an escape hatch.
 *
 * `hex: null` is the default ink, stored as no colour at all: a plan nobody has
 * recoloured keeps clean JSON, and COLORS.symbol stays changeable afterwards.
 * Yellow is drawn as amber because true yellow on the paper-coloured background
 * is a line you cannot see.
 */
export const INKS: ReadonlyArray<{ id: string; hex: string | null }> = [
  { id: "default", hex: null },
  { id: "new",     hex: "#d0342c" },
  { id: "remove",  hex: "#c58a10" },
  { id: "service", hex: "#2d7de0" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The colour one symbol draws in. Validated rather than trusted: a document can
 * arrive by paste or by hand-editing, and assigning an invalid string to
 * `strokeStyle` is silently ignored by canvas — one bad value would repaint the
 * symbol in whatever colour happened to be set last.
 */
export function symbolInk(s: SymbolInstance): string {
  return s.color && HEX.test(s.color) ? s.color : COLORS.symbol;
}

export interface DrawExtras {
  hoverSnap?: Vec | null;
  /**
   * The storey below, drawn faintly beneath the active one so walls can be
   * lined up between floors. Resolved geometry only — it is never hit-tested
   * or selectable, so an underlay can't be edited by accident.
   */
  ghost?: Resolved | null;
  /** False for exports: no grid, and no legend describing one. */
  showGrid?: boolean;
  preview?: ((ctx: CanvasRenderingContext2D, vp: Viewport) => void) | null;
}

export function drawScene(
  ctx: CanvasRenderingContext2D, vp: Viewport, canvasW: number, canvasH: number,
  floor: Floor, resolved: Resolved, rooms: Room[], sel: Selection | null,
  extras: DrawExtras, gridMm: number, areaMode: AreaMode,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const steps = extras.showGrid === false ? null : drawGrid(ctx, vp, canvasW, canvasH, gridMm);

  // World-space transform.
  ctx.save();
  ctx.scale(vp.pxPerMm, vp.pxPerMm);
  ctx.translate(-vp.origin.x, -vp.origin.y);
  const px = 1 / vp.pxPerMm; // 1 screen px in mm

  // Rooms.
  for (const r of rooms) {
    ctx.beginPath();
    tracePoly(ctx, r.poly);
    ctx.fillStyle = COLORS.roomFill;
    ctx.fill();
  }

  // Ghost underlay first, so the active storey draws over it.
  if (extras.ghost) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (const rw of extras.ghost.walls.values()) {
      for (const piece of rw.pieces) {
        ctx.beginPath();
        tracePoly(ctx, piece.poly);
        ctx.fillStyle = COLORS.ghost;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Walls.
  for (const rw of resolved.walls.values()) {
    const isSel = sel?.kind === "wall" && sel.id === rw.wall.id;
    for (const piece of rw.pieces) {
      ctx.beginPath();
      tracePoly(ctx, piece.poly);
      ctx.fillStyle = isSel ? "#5a4638" : COLORS.wallFill;
      ctx.fill();
      ctx.strokeStyle = isSel ? COLORS.select : COLORS.wallStroke;
      ctx.lineWidth = (isSel ? 2 : 1) * px;
      ctx.stroke();
    }
    for (const og of rw.openings) drawOpening(ctx, og, px, sel);
  }

  // Junction fill goes on top of the wall pieces: it closes the wedge a T-shaped
  // junction leaves between two slanted end-caps, and covers the seam strokes
  // that bounded it. Fill only — every edge of it is interior to the masonry.
  for (const j of resolved.junctions) {
    ctx.beginPath();
    tracePoly(ctx, j.poly);
    ctx.fillStyle = COLORS.wallFill;
    ctx.fill();
  }

  // Symbols.
  for (const s of floor.symbols) drawSymbol(ctx, s, px, sel?.kind === "symbol" && sel.id === s.id);

  // Tool preview (world space).
  extras.preview?.(ctx, vp);

  ctx.restore(); // back to screen space

  // Room labels (constant px size).
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.roomLabel;
  for (const r of rooms) {
    const c = vp.toScreen(r.centroid);
    // Which number this is, is stated in the legend — a bare "12.0 m²" that
    // silently means centerline is the whole problem this addresses.
    const mm2 = areaMode === "net" ? r.netAreaMm2 : r.areaMm2;
    ctx.fillText((mm2 / 1e6).toFixed(1) + " m²", c.x, c.y);
  }

  // Snap marker.
  if (extras.hoverSnap) {
    const s = vp.toScreen(extras.hoverSnap);
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (steps) drawGridLegend(ctx, canvasH, gridMm, steps, areaMode);

  // Selected node handle & wall handles drawn by tools layer via preview.
  ctx.restore();
}

function tracePoly(ctx: CanvasRenderingContext2D, poly: Vec[]): void {
  if (poly.length === 0) return;
  ctx.moveTo(poly[0]!.x, poly[0]!.y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y);
  ctx.closePath();
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number, gridMm: number): GridSteps {
  // Both spacings are whole multiples of gridMm (see grid.ts), so a square on
  // screen is always a whole number of grid cells.
  const steps = gridSteps(gridMm, vp.pxPerMm);
  const tl = vp.toWorld(v(0, 0)), br = vp.toWorld(v(w, h));
  const drawLines = (stepMm: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / stepMm) * stepMm; x <= br.x; x += stepMm) {
      const sx = (x - vp.origin.x) * vp.pxPerMm;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(tl.y / stepMm) * stepMm; y <= br.y; y += stepMm) {
      const sy = (y - vp.origin.y) * vp.pxPerMm;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();
  };
  drawLines(steps.minor, COLORS.grid);
  drawLines(steps.major, COLORS.gridMajor);
  return steps;
}

/** Bottom-left legend naming the document grid and, when the zoom forced a
 * coarser spacing, what the lines on screen actually measure. */
function drawGridLegend(ctx: CanvasRenderingContext2D, h: number, gridMm: number, steps: GridSteps, areaMode: AreaMode): void {
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.hud;
  const grid = steps.stepped
    ? t("hint.gridLegendStepped", { grid: fmtMm(gridMm), minor: fmtMm(steps.minor), major: fmtMm(steps.major) })
    : t("hint.gridLegend", { grid: fmtMm(gridMm), major: fmtMm(steps.major) });
  // Always name the area convention: an unlabelled figure is the ambiguity.
  const text = grid + " · " +
    t(areaMode === "net" ? "hint.areaLegendNet" : "hint.areaLegendCenterline");
  ctx.fillText(text, 10, h - 10);
}

function fmtMm(mm: number): string {
  return mm >= 1000 ? `${+(mm / 1000).toFixed(2)} m` : `${mm} mm`;
}

function drawOpening(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, sel: Selection | null): void {
  const o = og.opening;
  const isSel = sel?.kind === "opening" && sel.id === o.id;
  const color = isSel ? COLORS.select : COLORS.opening;
  ctx.strokeStyle = color;
  ctx.lineWidth = (isSel ? 2 : 1.2) * px;

  const h = og.half;
  // Jamb lines across the wall.
  for (const [p, n] of [[og.p0, og.n0], [og.p1, og.n1]] as const) {
    ctx.beginPath();
    ctx.moveTo(p.x - n.x * h, p.y - n.y * h);
    ctx.lineTo(p.x + n.x * h, p.y + n.y * h);
    ctx.stroke();
  }

  if (o.kind === "door") drawDoor(ctx, og, px, color);
  else if (o.kind === "window") drawWindow(ctx, og, px, color);
  else drawPassage(ctx, og, px, color);
}

function drawDoor(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, color: string): void {
  const o = og.opening;
  const w = dist(og.p0, og.p1);
  if (w <= 1) return;
  const along = scale(sub(og.p1, og.p0), 1 / w);
  ctx.strokeStyle = color;
  const sashes = sashesOf(o, w);
  let cursor = 0;
  for (const leaf of sashes) {
    const a = add(og.p0, scale(along, cursor));
    const b = add(og.p0, scale(along, cursor + leaf.width));
    cursor += leaf.width;
    drawDoorLeaf(ctx, leaf, a, b, along, og.n0, og.half, px, o.glazed);
    drawBars(ctx, leaf, a, b, og.n0, og.half, px);
  }
}

/**
 * One door leaf. Drawn heavier than a window sash and with the swing arc dashed,
 * which is the usual weight difference between a door and a window on a plan.
 */
function drawDoorLeaf(
  ctx: CanvasRenderingContext2D, leaf: Sash & { width: number },
  a: Vec, b: Vec, along: Vec, n: Vec, h: number, px: number, glazedLeaf?: boolean,
): void {
  const w = leaf.width;
  if (w <= 1) return;
  const outward = leaf.outward === true;

  if (leaf.action === "slide") {
    drawSlideArrow(ctx, a, b, along, n, h, px, leaf.slideTo ?? "b");
    return;
  }
  if (leaf.action === "fold") {
    drawFold(ctx, leaf, a, along, n, px, outward);
    return;
  }
  if (leaf.action === "revolve") {
    // Tourniquet. The drum spans the opening, so its radius is half the width.
    // Two arcs form the enclosure along the wall; the quadrants facing each side
    // of the wall stay open, which is where people walk through. Four leaves sit
    // at 45 degrees so none of them blocks an opening in the drawn position.
    const mid = add(a, scale(sub(b, a), 0.5));
    const rad = w * 0.5;
    const base = angleOf(along);
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([]);
    const QUARTER = Math.PI / 2;
    const SPAN = QUARTER * 1.1;            // enclosure wall, a little over 90 degrees
    for (const centre of [base, base + Math.PI]) {
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, rad, centre - SPAN / 2, centre + SPAN / 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1.4 * px;
    for (let i = 0; i < 4; i++) {
      const ang = base + QUARTER / 2 + i * QUARTER;
      line(ctx, mid, add(mid, fromAngle(ang, rad)));
    }
    // Rotation arrow: a short arc inside the drum with a head on its leading end.
    const cw = (leaf.spin ?? "ccw") === "cw";
    const r2 = rad * 0.45;
    const from = base + QUARTER / 2;
    const sweep = cw ? QUARTER * 1.2 : -QUARTER * 1.2;
    ctx.lineWidth = 1 * px;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, r2, from, from + sweep, !cw);
    ctx.stroke();
    const tipAng = from + sweep;
    const tip = add(mid, fromAngle(tipAng, r2));
    // Tangent at the tip, pointing the way it turns.
    const tangent = fromAngle(tipAng + (cw ? QUARTER : -QUARTER), 1);
    const head = Math.min(rad * 0.22, 220);
    const backTip = add(tip, scale(tangent, -head));
    line(ctx, tip, add(backTip, scale(perp(tangent), head * 0.45)));
    line(ctx, tip, add(backTip, scale(perp(tangent), -head * 0.45)));
    return;
  }
  if (leaf.action === "double-acting") {
    // Doordraaiend: no fixed side, so both swings are drawn — the tapered leaf
    // on the sheets is the same leaf shown at both extremes.
    const hingeAtA = (leaf.hinge ?? "a") !== "b";
    const hinge = hingeAtA ? a : b;
    const other = hingeAtA ? b : a;
    const dir = scale(sub(other, hinge), 1 / w);
    const a0 = angleOf(sub(other, hinge));
    for (const sign of [1, -1]) {
      const tip = add(hinge, scale(scale(perp(dir), sign), w));
      ctx.lineWidth = 1.4 * px;
      ctx.setLineDash([]);
      line(ctx, hinge, tip);
      const a1 = angleOf(sub(tip, hinge));
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      ctx.lineWidth = 1 * px;
      ctx.setLineDash([40, 40]);
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, w, a0, a0 + d, d < 0);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    return;
  }
  if (leaf.action === "overhead") {
    // Kanteldeur tilts up out of the plan entirely; in plan it is a panel
    // filling the opening, marked with the axis it tilts about.
    const face = outward ? scale(n, -1) : n;
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([]);
    const off = scale(face, h * 0.45);
    line(ctx, add(a, off), add(b, off));
    line(ctx, a, add(a, off));
    line(ctx, b, add(b, off));
    ctx.setLineDash([30, 30]);
    line(ctx, add(a, scale(face, h * 0.9)), add(b, scale(face, h * 0.9)));
    ctx.setLineDash([]);
    return;
  }
  if (leaf.action === "pivot") {
    // Taatsdeur: turns about its own centre, so the leaf is drawn across the
    // opening through the pivot rather than hinged at a jamb.
    const mid = add(a, scale(sub(b, a), 0.5));
    const face = outward ? scale(n, -1) : n;
    ctx.lineWidth = 1.4 * px;
    ctx.setLineDash([]);
    line(ctx, add(mid, scale(face, w * 0.5)), add(mid, scale(face, -w * 0.5)));
    ctx.setLineDash([40, 40]);
    ctx.lineWidth = 1 * px;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, w * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  // Hinged leaf: fully open at 90 degrees, plus its quarter swing arc.
  const glazed = glazedLeaf === true;
  const hingeAtA = (leaf.hinge ?? "a") !== "b";
  const hinge = hingeAtA ? a : b;
  const other = hingeAtA ? b : a;
  const dir = scale(sub(other, hinge), 1 / w);
  const swing = outward ? scale(perp(dir), -1) : perp(dir);
  const tip = add(hinge, scale(swing, w));
  ctx.setLineDash([]);
  if (glazed) {
    // Two thin lines with a gap: a glazed leaf, not a solid panel.
    const across = scale(perp(scale(sub(tip, hinge), 1 / w)), Math.min(w * 0.04, 40));
    ctx.lineWidth = 0.9 * px;
    line(ctx, add(hinge, across), add(tip, across));
    line(ctx, sub(hinge, across), sub(tip, across));
  } else {
    ctx.lineWidth = 1.4 * px;
    line(ctx, hinge, tip);
  }
  const a0 = angleOf(sub(other, hinge));
  const a1 = angleOf(sub(tip, hinge));
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (detailFor(w, px).arcs) {
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([40, 40]);
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, w, a0, a0 + d, d < 0);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Concertina leaves, shared by vouwwand windows and folding doors. */
function drawFold(
  ctx: CanvasRenderingContext2D, sash: Sash & { width: number },
  a: Vec, along: Vec, n: Vec, px: number, outward: boolean,
): void {
  const w = sash.width;
  const face = outward ? scale(n, -1) : n;
  const leaves = Math.max(2, Math.round(w / 700));
  const step = w / leaves;
  const depth = Math.min(step * 0.8, 500);
  ctx.lineWidth = 1.2 * px;
  ctx.setLineDash(outward ? [] : [30, 30]);
  for (let i = 0; i < leaves; i++) {
    const p0 = add(a, scale(along, i * step));
    const p1 = add(a, scale(along, (i + 1) * step));
    const peak = add(add(p0, scale(along, step * 0.5)),
                     scale(face, i % 2 === 0 ? depth : depth * 0.25));
    line(ctx, p0, peak);
    line(ctx, peak, p1);
  }
  ctx.setLineDash([]);
}

function drawWindow(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, color: string): void {
  const o = og.opening;
  const h = og.half;
  const w = dist(og.p0, og.p1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * px;
  // Frame: a line along each wall face, spanning the whole opening.
  for (const off of [-h, h]) {
    ctx.beginPath();
    ctx.moveTo(og.p0.x + og.n0.x * off, og.p0.y + og.n0.y * off);
    ctx.lineTo(og.p1.x + og.n1.x * off, og.p1.y + og.n1.y * off);
    ctx.stroke();
  }
  // Glass line down the middle of the whole opening.
  ctx.lineWidth = 0.8 * px;
  line(ctx, og.p0, og.p1);

  const along = w > 0 ? scale(sub(og.p1, og.p0), 1 / w) : og.tan0;
  const sashes = sashesOf(o, w);
  let cursor = 0;
  for (let i = 0; i < sashes.length; i++) {
    const sash = sashes[i]!;
    const a = add(og.p0, scale(along, cursor));
    const b = add(og.p0, scale(along, cursor + sash.width));
    cursor += sash.width;
    // Mullion between panes — a combination window is one hole subdivided, so
    // the divider is a frame member, not a wall return.
    if (i > 0) {
      ctx.lineWidth = 1.2 * px;
      ctx.setLineDash([]);
      line(ctx, add(a, scale(og.n0, -h)), add(a, scale(og.n0, h)));
    }
    drawSash(ctx, sash, a, b, along, og.n0, h, px);
    drawBars(ctx, sash, a, b, og.n0, h, px);
  }
}

/**
 * How much of an opening symbol is worth drawing at the current zoom.
 *
 * The sheets show a door three ways — at 1:100 a plain gap, at 1:50 leaf and
 * arc, at 1:20 the frame too. A zoomable editor has no single scale, so the
 * same idea is expressed against how large the leaf actually lands on screen:
 * below about a centimetre of screen a swing arc is an illegible squiggle that
 * only adds noise, and glazing bars closer than a few pixels merge into a
 * smudge. `px` is millimetres per screen pixel, so w / px is the leaf's size in
 * pixels.
 */
function detailFor(widthMm: number, px: number): { arcs: boolean; fine: boolean } {
  const screenPx = widthMm / px;
  return { arcs: screenPx >= 14, fine: screenPx >= 40 };
}

/**
 * Roedeverdeling. Glazing bars lie in the plane of the glass, so a plan sees
 * them edge-on: they read as short ticks across the glass line, not as the grid
 * an elevation shows.
 */
function drawBars(
  ctx: CanvasRenderingContext2D, sash: Sash & { width: number },
  a: Vec, b: Vec, n: Vec, h: number, px: number,
): void {
  const panes = sash.bars ?? 0;
  if (panes < 2 || !detailFor(sash.width, px).fine) return;
  ctx.lineWidth = 0.8 * px;
  ctx.setLineDash([]);
  for (let i = 1; i < panes; i++) {
    const p = add(a, scale(sub(b, a), i / panes));
    line(ctx, add(p, scale(n, -h * 0.4)), add(p, scale(n, h * 0.4)));
  }
}

/** One pane's opening symbol, drawn between jamb points a and b along the wall. */
function drawSash(
  ctx: CanvasRenderingContext2D, sash: Sash & { width: number },
  a: Vec, b: Vec, along: Vec, n: Vec, h: number, px: number,
): void {
  const w = sash.width;
  if (w <= 1 || sash.action === "fixed") return;
  if (!detailFor(w, px).arcs) return;   // too small on screen to read
  const outward = sash.outward === true;
  // Legend on the NEN sheets: solid = naar buiten, dashed = naar binnen.
  const dash: number[] = outward ? [] : [30, 30];
  const face = outward ? scale(n, -1) : n;

  if (sash.action === "slide" || sash.action === "turn-slide") {
    drawSlideArrow(ctx, a, b, along, n, h, px, sash.slideTo ?? "b");
  }
  if (sash.action === "turn" || sash.action === "turn-tilt" || sash.action === "turn-slide") {
    // A side-hung sash swings like a door: leaf perpendicular to the wall at the
    // hinge jamb, plus its quarter arc.
    const hingeAtA = (sash.hinge ?? "a") !== "b";
    const hinge = hingeAtA ? a : b;
    const other = hingeAtA ? b : a;
    const swing = outward ? scale(perp(scale(sub(other, hinge), 1 / w)), -1)
                          : perp(scale(sub(other, hinge), 1 / w));
    const tip = add(hinge, scale(swing, w));
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash(dash);
    line(ctx, hinge, tip);
    const a0 = angleOf(sub(other, hinge));
    const a1 = angleOf(sub(tip, hinge));
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, w, a0, a0 + d, d < 0);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (sash.action === "tilt" || sash.action === "turn-tilt" || sash.action === "tumble"
      || sash.action === "project" || sash.action === "parallel") {
    // A horizontal hinge does not exist in plan — these are section symbols on
    // the sheets. A small chevron at mid-span marks that the pane opens at all,
    // so a valraam is not silently identical to a vast raam. Not NEN; an aid.
    const mid = add(a, scale(sub(b, a), 0.5));
    const depth = Math.min(w * 0.28, 300);
    const apex = add(mid, scale(face, depth * 0.35));
    const arm = scale(along, depth * 0.5);
    ctx.lineWidth = 1 * px;
    ctx.setLineDash(dash);
    line(ctx, add(add(mid, arm), scale(face, depth)), apex);
    line(ctx, add(sub(mid, arm), scale(face, depth)), apex);
    ctx.setLineDash([]);
  }
  if (sash.action === "pivot") {
    // Taatsraam: vertical axis, so it DOES turn in plan. Leaf drawn across the
    // opening through its centre, with the swept circle dashed.
    const mid = add(a, scale(sub(b, a), 0.5));
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([]);
    line(ctx, add(mid, scale(face, w * 0.45)), add(mid, scale(face, -w * 0.45)));
    ctx.setLineDash([30, 30]);
    ctx.lineWidth = 0.8 * px;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, w * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (sash.action === "slide-vertical") {
    // Vertical slide is invisible in plan too; mark it with a short bar so it
    // reads as "moves" rather than "fixed".
    const mid = add(a, scale(sub(b, a), 0.5));
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([]);
    line(ctx, add(mid, scale(n, -h * 0.5)), add(mid, scale(n, h * 0.5)));
  }
  if (sash.action === "fold") drawFold(ctx, sash, a, along, n, px, outward);
}

/** Sliding-panel marks: two offset panels and an arrow on the moving one. */
function drawSlideArrow(
  ctx: CanvasRenderingContext2D, a: Vec, b: Vec, along: Vec, n: Vec,
  h: number, px: number, slideTo: "a" | "b",
): void {
  const w = dist(a, b);
  const off = h * 0.35;
  const toB = slideTo === "b";
  ctx.lineWidth = 1 * px;
  ctx.setLineDash([]);
  line(ctx, add(a, scale(n, -off)), add(add(a, scale(along, w * 0.6)), scale(n, -off)));
  line(ctx, add(add(a, scale(along, w * 0.4)), scale(n, off)), add(add(a, scale(along, w)), scale(n, off)));
  const base = add(add(a, scale(along, toB ? w * 0.55 : w * 0.85)), scale(n, off * 2.2));
  const dir = toB ? along : scale(along, -1);
  const tip = add(base, scale(dir, w * 0.3));
  line(ctx, base, tip);
  const back = scale(dir, -Math.min(60, w * 0.12));
  line(ctx, tip, add(add(tip, back), scale(perp(dir), Math.min(40, w * 0.08))));
  line(ctx, tip, add(add(tip, back), scale(perp(dir), -Math.min(40, w * 0.08))));
}

function drawPassage(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, color: string): void {
  const h = og.half;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8 * px;
  ctx.setLineDash([50, 50]);
  for (const off of [-h, h]) {
    ctx.beginPath();
    ctx.moveTo(og.p0.x + og.n0.x * off, og.p0.y + og.n0.y * off);
    ctx.lineTo(og.p1.x + og.n1.x * off, og.p1.y + og.n1.y * off);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function line(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawSymbol(ctx: CanvasRenderingContext2D, s: SymbolInstance, px: number, selected: boolean): void {
  const def = getSymbol(s.type);
  if (!def) return;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rotation);
  if (s.mirrored) ctx.scale(-1, 1);
  // fill follows stroke: a symbol's filled parts -- a position dot, a standard's
  // code character -- have to highlight with the rest of it on selection.
  // Selection still overrides the symbol's own pen: the marching-ants box alone
  // is a weak signal, and a red symbol has to look picked like any other.
  ctx.strokeStyle = selected ? COLORS.select : symbolInk(s);
  ctx.fillStyle = ctx.strokeStyle;
  def.draw(ctx);
  if (selected) {
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(-def.width / 2 - 30, (def.wallMounted ? 0 : -def.depth / 2) - 30, def.width + 60, def.depth + 60);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Label helper for tools: draw text at world point in screen space. */
export function drawLabel(ctx: CanvasRenderingContext2D, vp: Viewport, world: Vec, text: string, color = COLORS.dimension): void {
  const s = vp.toScreen(world);
  ctx.save();
  ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  ctx.font = "12px system-ui, sans-serif";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(s.x - w / 2 - 4, s.y - 18, w + 8, 16);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, s.x, s.y - 6);
  ctx.restore();
}
