// A roof plane on the canvas: dashed outline (above the section plane, the
// same convention a wall cabinet draws under -- see
// render/furnishing/index.ts), a solid eave edge, and the ridge where two
// planes meet.
//
// A plane's outline is already in the document's own millimetres -- unlike a
// symbol or a stair, it carries no separate x/y/rotation placement -- so this
// draws directly in world space rather than through recordSymbol's local
// frame, the way a room polygon or a wall's facade band does.
import type { RoofPlane } from "../model/roof";
import { eaveSegment, type RoofRidge } from "../core/roof";
import { withCtx } from "./symbols/defs";

/** Dash pattern for a roof outline, mm on/off -- building scale, the same
 *  "overhead work" convention as render/structure.ts's BEAM_DASH. */
export const ROOF_DASH: readonly number[] = [200, 120];

/**
 * Every edge but the eave, dashed; the eave itself solid, since the low edge
 * is what a fascia is actually built at.
 */
export function drawRoofPlane(ctx: CanvasRenderingContext2D, plane: RoofPlane, ink: string): void {
  const poly = plane.outline;
  const n = poly.length;
  if (n < 2) return;
  const eaveIdx = Math.max(0, Math.min(n - 1, Math.round(plane.eaveEdge)));
  withCtx(ctx, () => {
    ctx.strokeStyle = ink;
    ctx.setLineDash([...ROOF_DASH]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === eaveIdx) continue;
      const a = poly[i]!, b = poly[(i + 1) % n]!;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const { a, b } = eaveSegment(plane);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
}

/** The ridge or hip where two planes meet (core/roof.ts's roofRidges()), solid. */
export function drawRoofRidge(ctx: CanvasRenderingContext2D, ridge: RoofRidge, ink: string): void {
  withCtx(ctx, () => {
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.moveTo(ridge.a.x, ridge.a.y);
    ctx.lineTo(ridge.b.x, ridge.b.y);
    ctx.stroke();
  });
}
