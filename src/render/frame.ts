// One framed wall's elevation ("aanzicht"): the layout core/frame.ts builds,
// drawn as outlined member rectangles in the wall's own plane.
//
// Follows the symbol draw contract (see render/symbols/defs.ts): ctx arrives
// pre-transformed to 1 unit = 1 mm, the caller owns stroke/fill colour, and
// the drawing is wrapped in withCtx() -- which is what lets recordSymbol()
// replay it unchanged (io/frame.ts), the same way a stair or a vide extends
// the contract by exactly one argument (see CLAUDE.md, "Adding a symbol").
//
// FrameLayout.members and .openings run y UP from the floor, matching how a
// frame is set out; canvas y runs down. Every rectangle is flipped here,
// once, so nothing above this module has to hold both axes in mind at once.
import { withCtx, code } from "./symbols/defs";
import type { FrameLayout, PlacedMember } from "../core/frame";

interface Rect { x: number; y: number; w: number; h: number }

/** A layout rectangle (y up from the floor) as a canvas rectangle (y down
 *  from the frame's top). */
function flip(heightMm: number, r: { x: number; y: number; w: number; h: number }): Rect {
  return { x: r.x, y: heightMm - r.y - r.h, w: r.w, h: r.h };
}

/** Diagonal cross that marks a backing stud -- distinct from the plain
 *  rectangle every other member draws as. */
function crossOut(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.w, r.y + r.h);
  ctx.moveTo(r.x + r.w, r.y); ctx.lineTo(r.x, r.y + r.h);
}

/** Size of the "N×" mark on a doubled member, clamped to the rectangle it sits in. */
function markSize(r: Rect): number {
  return Math.max(30, Math.min(r.h * 0.8, r.w * 0.4, 160));
}

/**
 * A raked top plate's true shape: both its top and bottom edges run at
 * `m.slope`, `m.y` being the bottom edge's height at the LEFT edge -- see
 * PlacedMember.slope. Drawn as a parallelogram rather than through flip()'s
 * axis-aligned rect.
 */
function drawRakedPlate(ctx: CanvasRenderingContext2D, heightMm: number, m: PlacedMember): void {
  const slope = m.slope!;
  const cy = (layoutY: number): number => heightMm - layoutY;
  ctx.moveTo(m.x, cy(m.y));
  ctx.lineTo(m.x + m.w, cy(m.y + slope * m.w));
  ctx.lineTo(m.x + m.w, cy(m.y + m.h + slope * m.w));
  ctx.lineTo(m.x, cy(m.y + m.h));
  ctx.closePath();
}

/**
 * The roofline's actual cut across an otherwise flat member's top (a stud,
 * king, backing or cripple standing under a sloped top): a diagonal line
 * from the lower of its two edges up to the higher, which is exactly where
 * the member's own ordered length (ending at the higher edge, see
 * frameLayout()) already touches it -- see PlacedMember.slope.
 */
function drawCutLine(ctx: CanvasRenderingContext2D, heightMm: number, m: PlacedMember): void {
  const slope = m.slope!;
  const top = m.y + m.h;
  const left = top - Math.max(slope, 0) * m.w;
  const right = top + Math.min(slope, 0) * m.w;
  ctx.moveTo(m.x, heightMm - left);
  ctx.lineTo(m.x + m.w, heightMm - right);
}

/**
 * The elevation: the outline along the wall's top, every member as an outlined rectangle
 * (backing crossed out), and every opening as a thin-outlined hole. A member
 * whose rectangle stands for more than one piece -- today, only a doubled
 * header, see PlacedMember.count -- carries its count as text the way a
 * standard's own mark carries a character (code() in symbols/defs.ts). A
 * raked top plate draws as a parallelogram; any other sloped member keeps
 * its ordinary rectangle (already cut to its higher edge) and gains a
 * diagonal line showing where the roofline actually crosses it.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, layout: FrameLayout): void {
  const marks: { r: Rect; m: PlacedMember }[] = [];
  const H = layout.heightMm;
  withCtx(ctx, () => {
    // The outline follows the wall's top, so a gable reads as a gable.
    ctx.moveTo(0, H);
    for (const p of layout.topLine) ctx.lineTo(p.x, H - p.y);
    ctx.lineTo(layout.lengthMm, H);
    ctx.closePath();
    for (const m of layout.members) {
      const r = flip(H, m);
      if (m.slope !== undefined && (m.name === "plate" || m.name === "rail")) {
        drawRakedPlate(ctx, H, m);
      } else {
        ctx.rect(r.x, r.y, r.w, r.h);
        if (m.name === "backing") crossOut(ctx, r);
        if (m.slope !== undefined) drawCutLine(ctx, H, m);
      }
      if (m.count > 1) marks.push({ r, m });
    }
    ctx.stroke();
    // Openings last and separately: a thin outline rather than the member
    // weight, since a hole in the framing is not a member.
    ctx.lineWidth = Math.max(1, ctx.lineWidth / 2);
    for (const o of layout.openings) {
      const r = flip(layout.heightMm, o);
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.stroke();
    }
    for (const { r, m } of marks) {
      code(ctx, `${m.count}×`, r.x + r.w / 2, r.y + r.h / 2, markSize(r));
    }
  });
}
