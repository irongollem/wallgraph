// wallElevation()'s drawing ("aanzicht"): the layout core/frame.ts builds for
// any wall, drawn in the wall's own plane -- a framed wall's members, a
// block wall's courses, a sandwich wall's panel lines, or the plain face and
// openings any other wall (or one missing its own kind's one fact) gets.
//
// Follows the symbol draw contract (see render/symbols/defs.ts): ctx arrives
// pre-transformed to 1 unit = 1 mm, the caller owns stroke/fill colour, and
// the drawing is wrapped in withCtx() -- which is what lets recordSymbol()
// replay it unchanged (io/frame.ts), the same way a stair or a vide extends
// the contract by exactly one argument (see CLAUDE.md, "Adding a symbol").
//
// WallElevation.members/courses/openings run y UP from the floor, matching
// how a frame is set out; canvas y runs down. Every rectangle is flipped
// here, once, so nothing above this module has to hold both axes in mind at
// once.
import { withCtx, code } from "./symbols/defs";
import type { WallElevation, PlacedMember } from "../core/frame";

interface Rect { x: number; y: number; w: number; h: number }

/** A layout rectangle (y up from the floor) as a canvas rectangle (y down
 *  from the elevation's own top). */
function flip(heightMm: number, r: { x: number; y: number; w: number; h: number }): Rect {
  return { x: r.x, y: heightMm - r.y - r.h, w: r.w, h: r.h };
}

/** Diagonal cross that marks a backing stud -- distinct from the plain
 *  rectangle every other member draws as. */
function crossOut(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.w, r.y + r.h);
  ctx.moveTo(r.x + r.w, r.y); ctx.lineTo(r.x, r.y + r.h);
}

/** Light diagonal hatching over a cut block: several thin strokes rather
 *  than backing's single cross, so a block that is merely not a whole unit
 *  -- cut at a wall end, an opening jamb, or the sloped top -- reads
 *  differently from a member that is doubled or crossed out. Drawn within
 *  the block's own (uncut) rectangle rather than a geometrically clipped
 *  shape: like a raked member's slope line (drawCutLine(), below), it marks
 *  the fact rather than re-deriving the exact cut edge at render time. */
function hatch(ctx: CanvasRenderingContext2D, r: Rect): void {
  if (r.w <= 0 || r.h <= 0) return;
  const n = 3;
  for (let i = 1; i <= n; i++) {
    const x = r.x + r.w * (i / (n + 1));
    ctx.moveTo(Math.max(r.x, x - r.h / 2), r.y + r.h);
    ctx.lineTo(Math.min(r.x + r.w, x + r.h / 2), r.y);
  }
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

/** `topLine`'s own height at `x`, by linear interpolation between its
 *  breakpoints (the same ones model/profile.ts's wallTopAt() reads) --
 *  carried on WallElevation so the renderer never needs the floor or wall
 *  themselves, per the draw(ctx) contract. Flat before the first point and
 *  after the last. */
function topAt(topLine: readonly { x: number; y: number }[], x: number): number {
  if (topLine.length === 0) return 0;
  const first = topLine[0]!, last = topLine[topLine.length - 1]!;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 0; i + 1 < topLine.length; i++) {
    const p0 = topLine[i]!, p1 = topLine[i + 1]!;
    if (x <= p1.x) {
      if (p1.x === p0.x) return p1.y;
      const frac = (x - p0.x) / (p1.x - p0.x);
      return p0.y + frac * (p1.y - p0.y);
    }
  }
  return last.y;
}

/**
 * The elevation: the outline along the wall's top, then whichever of
 * members/courses/panelEdges the wall's own kind populated (a wall missing
 * its kind's one fact -- WallElevation.notes -- simply has none, and draws
 * as the face and its openings alone), and every opening as a thin-outlined
 * hole.
 *
 * A member whose rectangle stands for more than one piece -- today, only a
 * doubled header, see PlacedMember.count -- carries its count as text the
 * way a standard's own mark carries a character (code() in
 * symbols/defs.ts). A raked top plate draws as a parallelogram; any other
 * sloped member keeps its ordinary rectangle (already cut to its higher
 * edge) and gains a diagonal line showing where the roofline actually
 * crosses it. A course block is its own rectangle, hatched when cut; a
 * panel edge is a full-height line, clipped to the wall's own top at that x
 * -- the only place this module reads `topLine` for anything other than the
 * outer outline, since a straight vertical line is cheap to clip exactly
 * where a filled block rectangle is not (see hatch()'s own comment).
 */
export function drawElevation(ctx: CanvasRenderingContext2D, e: WallElevation): void {
  const marks: { r: Rect; m: PlacedMember }[] = [];
  const H = e.heightMm;
  withCtx(ctx, () => {
    // The outline follows the wall's top, so a gable reads as a gable.
    ctx.moveTo(0, H);
    for (const p of e.topLine) ctx.lineTo(p.x, H - p.y);
    ctx.lineTo(e.lengthMm, H);
    ctx.closePath();

    for (const m of e.members) {
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

    for (const c of e.courses) {
      for (const b of c.blocks) {
        const r = flip(H, { x: b.x, y: c.y, w: b.w, h: b.h ?? c.h });
        ctx.rect(r.x, r.y, r.w, r.h);
        if (b.cut) hatch(ctx, r);
      }
    }

    for (const x of e.panelEdges) {
      const top = topAt(e.topLine, x);
      ctx.moveTo(x, H); ctx.lineTo(x, H - top);
    }

    ctx.stroke();
    // Openings last and separately: a thin outline rather than the member
    // weight, since a hole in the framing is not a member.
    ctx.lineWidth = Math.max(1, ctx.lineWidth / 2);
    for (const o of e.openings) {
      const r = flip(H, o);
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.stroke();
    }
    for (const { r, m } of marks) {
      code(ctx, `${m.count}×`, r.x + r.w / 2, r.y + r.h / 2, markSize(r));
    }
  });
}
