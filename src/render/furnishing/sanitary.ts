// Sanitary marks. Fixtures are drawn as the standard's plan marks: an outline
// at the fixture's own size, an inner bowl or basin where the fixture has one,
// and a filled dot at the drain.
//
// Sizes are fractions of the stored width and depth, so a 1700 and an 1800 bath
// are one mark drawn to the size the bathroom is set out to. Where a part of a
// fixture is built to a fixed size regardless of the space around it -- a
// toilet bowl stays a toilet bowl on an 880-wide invalidentoilet -- the
// fraction is capped rather than scaled.
import type { Furnishing } from "../../model/furnishing";
import { furnishingBasins, showerTray, toiletCistern } from "../../model/furnishing";
import { circle, dot, rounded } from "../symbols/defs";

/** Toilet: cistern against the wall, bowl rounded at the free end. */
export function toiletMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const concealed = toiletCistern(f) === "concealed";
  // The ingebouwde stortbak is a shallow band the full width of the duct; an
  // exposed one is the deeper cistern box.
  const cistern = d * (concealed ? 0.194 : 0.277);
  const bowlW = Math.min(w * 0.9, 400);

  ctx.rect(-w / 2, 0, w, cistern);
  rounded(ctx, -bowlW / 2, cistern, bowlW, d - cistern, bowlW / 2);

  if (f.rails) {
    // Invalidentoilet: a grab rail either side, at the clearance the rails are
    // set out to -- which is what the extra width is.
    const x = w / 2 - w * 0.045;
    const cap = w * 0.045;
    for (const sx of [-x, x]) {
      for (const y of [d * 0.08, d - d * 0.067]) {
        ctx.moveTo(sx - cap, y);
        ctx.lineTo(sx + cap, y);
      }
      ctx.moveTo(sx, d * 0.08);
      ctx.lineTo(sx, d - d * 0.067);
    }
  }
  ctx.stroke();
}

/** Wandurinoir: flat against the wall, semicircular into the room. */
export function urinalMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const flat = d * 0.265;
  const r = Math.min(w / 2, d - flat);
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.lineTo(r, flat);
  ctx.arc(0, flat, r, 0, Math.PI);
  ctx.lineTo(-r, 0);
  ctx.stroke();
  dot(ctx, 0, flat * 1.33, Math.min(30, r * 0.18));
}

/**
 * Standurinoir: the trough, with the standing positions marked by the divider
 * zigzag along its length. The positions follow the width -- a longer trough is
 * a trough for more people, not a wider one for the same three.
 */
export function urinalTroughMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const bays = Math.max(2, Math.round(w / 400));
  const bay = w / bays;
  ctx.rect(-w / 2, 0, w, d);
  ctx.moveTo(-w / 2, 0);
  for (let i = 0; i < bays; i++) {
    const x0 = -w / 2 + i * bay;
    ctx.lineTo(x0 + bay / 2, d * 0.85);
    ctx.lineTo(x0 + bay, 0);
  }
  ctx.stroke();
  dot(ctx, w * 0.4, d * 0.75, 30);
}

/** Bidet: the outline with its bowl inset, drain at the wall end. */
export function bidetMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  rounded(ctx, -w / 2, 0, w, d, w * 0.395);
  rounded(ctx, -w * 0.342, d * 0.15, w * 0.684, d * 0.7, w * 0.29);
  ctx.stroke();
  dot(ctx, 0, d * 0.283, 30);
}

/** Wastafel: counter, inset basin, drain -- one bowl or two in one run. */
export function basinMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const bowls = furnishingBasins(f);
  const each = w / bowls;
  const inset = Math.min(60, each / 6, d / 6);
  ctx.rect(-w / 2, 0, w, d);
  for (let i = 0; i < bowls; i++) {
    const x0 = -w / 2 + i * each;
    ctx.rect(x0 + inset, inset, each - 2 * inset, d - 2 * inset);
  }
  ctx.stroke();
  for (let i = 0; i < bowls; i++) {
    dot(ctx, -w / 2 + (i + 0.5) * each, d / 2, Math.min(30, d * 0.07));
  }
}

/**
 * Wastafel, meervoudig (trog): one trough, a tap cross per position, one drain.
 * The positions follow the length, the way the trough is actually specified.
 */
export function basinTroughMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const taps = Math.max(2, Math.round(w / 600));
  ctx.rect(-w / 2, 0, w, d);
  for (let i = 0; i < taps; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / taps;
    ctx.moveTo(x - 50, d * 0.26);
    ctx.lineTo(x + 50, d * 0.26);
    ctx.moveTo(x, d * 0.16);
    ctx.lineTo(x, d * 0.36);
  }
  ctx.stroke();
  dot(ctx, w * 0.39, d * 0.74, 30);
}

/** Bad, badkuip: rim and inner tub, drain at the tap end. */
export function bathMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const rim = Math.min(80, d * 0.107);
  ctx.rect(-w / 2, 0, w, d);
  rounded(ctx, -w / 2 + rim, rim, w - 2 * rim, d - 2 * rim, Math.min(150, (d - 2 * rim) / 2));
  ctx.stroke();
  dot(ctx, -w * 0.376, d / 2, 35);
}

/**
 * Douchehoek, douchebak of douchebak met gootdrain: the wet area, the tray
 * inside it where there is one, and the drain -- a point, or the goot running
 * the depth of one side.
 */
export function showerMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const tray = showerTray(f);
  ctx.rect(-w / 2, 0, w, d);
  if (tray !== "none") {
    const rim = Math.min(60, w * 0.067, d * 0.067);
    rounded(ctx, -w / 2 + rim, rim, w - 2 * rim, d - 2 * rim, Math.min(100, (d - 2 * rim) / 4));
  }
  if (tray === "linear") {
    ctx.rect(-w * 0.4, d * 0.28, w * 0.1, d * 0.44);
    ctx.moveTo(-w * 0.55, d * 0.5);
    ctx.lineTo(-w * 0.22, d * 0.5);
    ctx.stroke();
    return;
  }
  ctx.stroke();
  dot(ctx, -w * 0.31, d * 0.22, Math.min(40, w * 0.045));
}

/** Douche: the head seen from above, spraying. */
export function showerHeadMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const cy = d / 2, r = Math.min(w, d) * 0.225;
  circle(ctx, 0, cy, r);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.moveTo(Math.cos(a) * (r + r * 0.33), cy + Math.sin(a) * (r + r * 0.33));
    ctx.lineTo(Math.cos(a) * (r + r * 1.17), cy + Math.sin(a) * (r + r * 1.17));
  }
  ctx.stroke();
}
