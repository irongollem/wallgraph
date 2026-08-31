// Path helpers shared by the furnishing marks.
import type { Vec } from "../../geometry/vec";

export function poly(ctx: CanvasRenderingContext2D, pts: Vec[], closed: boolean): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  if (closed) ctx.closePath();
}

export function seg(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

/** A rectangle inset by `dx`/`dy` from a box that runs x in [-w/2, w/2], y in [0, d]. */
export function insetRect(
  ctx: CanvasRenderingContext2D, w: number, d: number, dx: number, dy: number,
): void {
  ctx.rect(-w / 2 + dx, dy, w - 2 * dx, d - 2 * dy);
}
