// One placed cabinet on the canvas.
//
// The carcass outline, a band for the front, and a mark saying what the front
// does: a diagonal to the hinged end for a door, a pair of them for two leaves,
// lines stepping back into the carcass for drawers, nothing at all for an open
// unit. A base unit's worktop adds the overhang line along its front.
//
// A wall unit draws dashed. It hangs entirely above the plan's section plane, so
// it is overhead work, and a plattegrond draws overhead work dashed — the same
// reason a vide is drawn with its diagonals rather than as a plain rectangle.
//
// Colours arrive as arguments, as they do for a stair and a vide, so this module
// and draw.ts need not import each other.
import { Cabinet, cabinetOverhead } from "../model/cabinet";
import {
  cabinetBox, cabinetOutline, cabinetFrontBand, cabinetFrontDivisions,
  cabinetDrawerLines, cabinetHingeMarks, cabinetSlideMark, cabinetWorktopEdge,
  cabinetLabelAt, CABINET_LABEL_SIZE,
} from "../core/cabinet";
import { Vec } from "../geometry/vec";
import { withCtx } from "./symbols/defs";

/** Grab margin around the carcass, mm — the symbols' and stairs' figure. */
const FRAME = 30;

/** Dash pattern for overhead work, in mm. */
const OVERHEAD_DASH = [90, 60];

export interface CabinetPaint {
  /** One screen pixel in mm, for line widths that must not scale with zoom. */
  px: number;
  ink: string;
  selected?: boolean;
  select?: string;
  wash?: string;
}

export function drawCabinet(ctx: CanvasRenderingContext2D, c: Cabinet, paint: CabinetPaint): void {
  const b = cabinetBox(c);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rotation);
  if (c.mirrored) ctx.scale(-1, 1);

  if (paint.selected && paint.wash) {
    ctx.fillStyle = paint.wash;
    ctx.fillRect(b.x0 - FRAME, b.y0 - FRAME, c.width + 2 * FRAME, c.depth + 2 * FRAME);
  }

  ctx.strokeStyle = paint.ink;
  ctx.fillStyle = ctx.strokeStyle;
  cabinetMark(ctx, c);

  if (paint.selected && paint.select) {
    ctx.strokeStyle = paint.select;
    ctx.lineWidth = 1.5 * paint.px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(b.x0 - FRAME, b.y0 - FRAME, c.width + 2 * FRAME, c.depth + 2 * FRAME);
    ctx.setLineDash([]);
  }
  ctx.restore();

  if (c.label) drawCabinetLabel(ctx, c, paint.ink);
}

/**
 * Everything the cabinet draws, in its own millimetres. Split out so the export
 * recorder replays exactly what the canvas shows.
 */
export function cabinetMark(ctx: CanvasRenderingContext2D, c: Cabinet): void {
  withCtx(ctx, () => {
    if (cabinetOverhead(c)) ctx.setLineDash(OVERHEAD_DASH);

    ctx.beginPath();
    poly(ctx, cabinetOutline(c), true);
    ctx.stroke();

    // An open unit has no front to draw; everything else gets the band.
    if (c.front !== "open") {
      ctx.beginPath();
      poly(ctx, cabinetFrontBand(c), true);
      ctx.stroke();
    }

    ctx.beginPath();
    for (const [a, z] of cabinetHingeMarks(c)) seg(ctx, a, z);
    for (const [a, z] of cabinetFrontDivisions(c)) seg(ctx, a, z);
    for (const [a, z] of cabinetDrawerLines(c)) seg(ctx, a, z);
    const slide = cabinetSlideMark(c);
    if (slide) seg(ctx, slide[0], slide[1]);
    ctx.stroke();

    if (c.worktop) {
      const [a, z] = cabinetWorktopEdge(c);
      ctx.beginPath();
      seg(ctx, a, z);
      ctx.stroke();
    }
  });
}

function poly(ctx: CanvasRenderingContext2D, pts: Vec[], closed: boolean): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  if (closed) ctx.closePath();
}

function seg(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

/** Upright in world space, as the stair and vide annotations are. */
function drawCabinetLabel(ctx: CanvasRenderingContext2D, c: Cabinet, ink: string): void {
  const at = cabinetLabelAt(c);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${CABINET_LABEL_SIZE}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(c.label!, at.x, at.y);
  ctx.restore();
}

/** The placement preview: the same mark, half transparent. */
export function drawCabinetGhost(ctx: CanvasRenderingContext2D, c: Cabinet, ink: string): void {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rotation);
  if (c.mirrored) ctx.scale(-1, 1);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ctx.strokeStyle;
  cabinetMark(ctx, c);
  ctx.restore();
}
