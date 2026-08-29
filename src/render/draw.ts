// Full scene render. Immediate mode: redraw everything on change (documents at
// this scale render in well under a frame). Layers: grid, rooms, walls,
// opening decorations, symbols, selection, labels (labels in screen space).
import { Floor, SymbolInstance } from "../model/doc";
import { Resolved, OpeningGeom } from "../core/resolve";
import { Room } from "../core/rooms";
import { Selection } from "../model/store";
import { Viewport } from "./viewport";
import { Vec, add, sub, scale, perp, v, angleOf, dist } from "../geometry/vec";
import { getSymbol } from "./symbols";
import { gridSteps, GridSteps } from "./grid";

export const COLORS = {
  bg: "#f4f2ec",
  grid: "#eae7dd",       // sub-grid: recedes, just enough to gauge a distance
  gridMajor: "#c3bfae",  // metre grid: a clearly heavier line, not a shade of the same
  roomFill: "#faf9f5",
  roomLabel: "#8a8577",
  hud: "#a7a293",
  wallFill: "#3d4148",
  wallStroke: "#26292e",
  opening: "#3d4148",
  symbol: "#4a5568",
  select: "#e05d2d",
  snap: "#2d7de0",
  dimension: "#2d7de0",
};

export interface DrawExtras {
  hoverSnap?: Vec | null;
  preview?: ((ctx: CanvasRenderingContext2D, vp: Viewport) => void) | null;
}

export function drawScene(
  ctx: CanvasRenderingContext2D, vp: Viewport, canvasW: number, canvasH: number,
  floor: Floor, resolved: Resolved, rooms: Room[], sel: Selection | null,
  extras: DrawExtras, gridMm: number,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const steps = drawGrid(ctx, vp, canvasW, canvasH, gridMm);

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
    ctx.fillText((r.areaMm2 / 1e6).toFixed(1) + " m²", c.x, c.y);
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

  drawGridLegend(ctx, canvasH, gridMm, steps);

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
function drawGridLegend(ctx: CanvasRenderingContext2D, h: number, gridMm: number, steps: GridSteps): void {
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.hud;
  const text = steps.stepped
    ? `grid ${fmtMm(gridMm)} · drawn ${fmtMm(steps.minor)} · major ${fmtMm(steps.major)}`
    : `grid ${fmtMm(gridMm)} · major ${fmtMm(steps.major)}`;
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
  const hingeAtStart = (o.hinge ?? "a") === "a";
  const hinge = hingeAtStart ? og.p0 : og.p1;
  const other = hingeAtStart ? og.p1 : og.p0;
  const along = scale(sub(other, hinge), 1 / w);      // hinge -> latch, unit
  const side = perp(along);                            // one side of the wall
  const swing = (o.swingIn ?? true) ? side : scale(side, -1);
  // Door leaf fully open (90°): from hinge, perpendicular to the wall.
  const tip = add(hinge, scale(swing, w));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4 * px;
  ctx.beginPath();
  ctx.moveTo(hinge.x, hinge.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  // Quarter-circle swing arc from latch jamb to leaf tip.
  const a0 = angleOf(sub(other, hinge));
  const a1 = angleOf(sub(tip, hinge));
  ctx.beginPath();
  ctx.setLineDash([40, 40]);
  // pick the short way round
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  ctx.arc(hinge.x, hinge.y, w, a0, a0 + d, d < 0);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWindow(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, color: string): void {
  const o = og.opening;
  const h = og.half;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * px;
  // Frame: lines along both wall faces + thin glass line in the middle.
  for (const off of [-h, h]) {
    ctx.beginPath();
    ctx.moveTo(og.p0.x + og.n0.x * off, og.p0.y + og.n0.y * off);
    ctx.lineTo(og.p1.x + og.n1.x * off, og.p1.y + og.n1.y * off);
    ctx.stroke();
  }
  const type = o.windowType ?? "fixed";
  if (type === "fixed" || type === "casement") {
    ctx.lineWidth = 0.8 * px;
    ctx.beginPath();
    ctx.moveTo(og.p0.x, og.p0.y);
    ctx.lineTo(og.p1.x, og.p1.y);
    ctx.stroke();
  }
  if (type === "sliding") {
    // Two offset panel lines, each covering ~60% of the width, arrow on the moving panel.
    const w = dist(og.p0, og.p1);
    const along = scale(sub(og.p1, og.p0), 1 / w);
    const n = og.n0;
    const off = h * 0.35;
    const toB = (o.slideTo ?? "b") === "b";
    ctx.lineWidth = 1 * px;
    // fixed panel
    line(ctx, add(og.p0, scale(n, -off)), add(add(og.p0, scale(along, w * 0.6)), scale(n, -off)));
    // sliding panel
    const s0 = add(add(og.p0, scale(along, w * 0.4)), scale(n, off));
    const s1 = add(add(og.p0, scale(along, w)), scale(n, off));
    line(ctx, s0, s1);
    // arrow indicating slide direction along the panel
    const arrowBase = toB ? add(add(og.p0, scale(along, w * 0.55)), scale(n, off * 2.2))
                          : add(add(og.p0, scale(along, w * 0.85)), scale(n, off * 2.2));
    const dir = toB ? along : scale(along, -1);
    const tip = add(arrowBase, scale(dir, w * 0.3));
    line(ctx, arrowBase, tip);
    const back = scale(dir, -60);
    line(ctx, tip, add(add(tip, back), scale(perp(dir), 40)));
    line(ctx, tip, add(add(tip, back), scale(perp(dir), -40)));
  }
  if (type === "casement") {
    // Small opening triangle on the outside (convention): leaf from p0 hinging out.
    const w = dist(og.p0, og.p1);
    const out = scale(og.n0, -1);
    const tipP = add(og.p0, add(scale(out, h + w * 0.35), scale(sub(og.p1, og.p0), 0.5)));
    ctx.setLineDash([30, 30]);
    ctx.lineWidth = 0.8 * px;
    line(ctx, add(og.p0, scale(out, h)), tipP);
    line(ctx, tipP, add(og.p1, scale(out, h)));
    ctx.setLineDash([]);
  }
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
  ctx.strokeStyle = selected ? COLORS.select : COLORS.symbol;
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
