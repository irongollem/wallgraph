// One placed stair on the canvas: the instance transform, the kind's drawing,
// and the selection frame.
//
// Colours arrive as arguments rather than from the palette, so this module and
// draw.ts do not have to import each other. The palette stays in one place;
// this file only paints with what it is handed.
import { ResolvedStair } from "../model/stair";
import { stairBox, stairNote, stairNoteAt, stairIssues, NOTE_SIZE } from "../core/stair";
import { getStair } from "./stairs";

/** Grab margin around a footprint, mm — matches the symbols' selection frame. */
const FRAME = 30;

export interface StairPaint {
  /** One screen pixel in mm, for line widths that must not scale with zoom. */
  px: number;
  ink: string;
  selected?: boolean;
  select?: string;
  wash?: string;
  /** Translucent backing painted over whatever the flight crosses. */
  backing?: string;
  /** Ink for an annotation whose figures fall outside the ordinary. */
  warn?: string;
}

/** Place the drawing context in the stair's own millimetre space. */
function place(ctx: CanvasRenderingContext2D, s: ResolvedStair): void {
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rotation);
  if (s.mirrored) ctx.scale(-1, 1);
}

export function drawStair(ctx: CanvasRenderingContext2D, s: ResolvedStair, paint: StairPaint): void {
  const def = getStair(s.kind);
  if (!def) return;
  const b = stairBox(s);
  ctx.save();
  place(ctx, s);
  if (paint.backing) {
    ctx.fillStyle = paint.backing;
    if (def.region) {
      ctx.beginPath();
      def.region(ctx, s);
      ctx.fill();
    } else {
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
  }
  if (paint.selected && paint.wash) {
    ctx.fillStyle = paint.wash;
    ctx.fillRect(b.x0 - FRAME, b.y0 - FRAME, b.x1 - b.x0 + 2 * FRAME, b.y1 - b.y0 + 2 * FRAME);
  }
  // Selection marks the frame, not the drawing: a stair carries a pen colour of
  // its own, and repainting it orange would hide the colour being chosen for it.
  ctx.strokeStyle = paint.ink;
  ctx.fillStyle = ctx.strokeStyle;
  def.draw(ctx, s);
  if (paint.selected && paint.select) {
    ctx.strokeStyle = paint.select;
    ctx.lineWidth = 1.5 * paint.px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(b.x0 - FRAME, b.y0 - FRAME, b.x1 - b.x0 + 2 * FRAME, b.y1 - b.y0 + 2 * FRAME);
    ctx.setLineDash([]);
  }
  ctx.restore();
  drawNote(ctx, s, stairIssues(s).length > 0 && paint.warn ? paint.warn : paint.ink);
}

/**
 * How many risers at what optrede, or a ramp's gradient. Drawn after the
 * restore, in world space rather than the stair's own: a rotated stair must not
 * carry rotated text, the same reason the opening annotations are placed here.
 */
function drawNote(ctx: CanvasRenderingContext2D, s: ResolvedStair, ink: string): void {
  const note = stairNote(s);
  if (!note) return;
  const at = stairNoteAt(s);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${NOTE_SIZE}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(note, at.x, at.y);
  ctx.restore();
}

/** The placement preview: the same drawing, half transparent. */
export function drawStairGhost(ctx: CanvasRenderingContext2D, s: ResolvedStair, ink: string): void {
  const def = getStair(s.kind);
  if (!def) return;
  ctx.save();
  place(ctx, s);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ctx.strokeStyle;
  def.draw(ctx, s);
  ctx.restore();
}
