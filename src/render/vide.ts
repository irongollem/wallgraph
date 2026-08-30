// One placed vide on the canvas.
//
// The mark is the conventional one: the outline of the opening with a diagonal
// from each corner, which on a floor plan reads as "no floor here". The word
// goes inside the top edge, clear of where the diagonals cross.
//
// Colours arrive as arguments, as they do for a stair, so this module and
// draw.ts need not import each other.
import { Vide } from "../model/vide";
import { videBox, videLabelAt, VIDE_LABEL_SIZE } from "../core/vide";
import { withCtx } from "./symbols/defs";

/** Grab margin around the opening, mm — the symbols' and stairs' figure. */
const FRAME = 30;

export interface VidePaint {
  /** One screen pixel in mm, for line widths that must not scale with zoom. */
  px: number;
  ink: string;
  /** The word drawn when the vide carries no label of its own. */
  fallbackLabel: string;
  /** Paper colour, painted over the room tint: a vide is not floor. */
  cut?: string;
  selected?: boolean;
  select?: string;
  wash?: string;
}

export function drawVide(ctx: CanvasRenderingContext2D, vd: Vide, paint: VidePaint): void {
  const b = videBox(vd);
  ctx.save();
  ctx.translate(vd.x, vd.y);
  ctx.rotate(vd.rotation);

  if (paint.cut) {
    ctx.fillStyle = paint.cut;
    ctx.fillRect(b.x0, b.y0, vd.width, vd.depth);
  }
  if (paint.selected && paint.wash) {
    ctx.fillStyle = paint.wash;
    ctx.fillRect(b.x0 - FRAME, b.y0 - FRAME, vd.width + 2 * FRAME, vd.depth + 2 * FRAME);
  }

  ctx.strokeStyle = paint.ink;
  ctx.fillStyle = ctx.strokeStyle;
  videMark(ctx, vd);

  if (paint.selected && paint.select) {
    ctx.strokeStyle = paint.select;
    ctx.lineWidth = 1.5 * paint.px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(b.x0 - FRAME, b.y0 - FRAME, vd.width + 2 * FRAME, vd.depth + 2 * FRAME);
    ctx.setLineDash([]);
  }
  ctx.restore();

  drawVideLabel(ctx, vd, paint.ink, paint.fallbackLabel);
}

/** The outline and its diagonals, in the vide's own millimetres. */
export function videMark(ctx: CanvasRenderingContext2D, vd: Vide): void {
  const b = videBox(vd);
  withCtx(ctx, () => {
    ctx.beginPath();
    ctx.rect(b.x0, b.y0, vd.width, vd.depth);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1);
    ctx.moveTo(b.x1, b.y0); ctx.lineTo(b.x0, b.y1);
    ctx.stroke();
  });
}

/** Upright in world space, as the stair annotation and the opening labels are. */
function drawVideLabel(
  ctx: CanvasRenderingContext2D, vd: Vide, ink: string, fallback: string,
): void {
  const text = vd.label ?? fallback;
  if (!text) return;
  const at = videLabelAt(vd);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${VIDE_LABEL_SIZE}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

/** The placement preview: the same mark, half transparent. */
export function drawVideGhost(ctx: CanvasRenderingContext2D, vd: Vide, ink: string): void {
  ctx.save();
  ctx.translate(vd.x, vd.y);
  ctx.rotate(vd.rotation);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ctx.strokeStyle;
  videMark(ctx, vd);
  ctx.restore();
}
