// Furniture marks: a bed made up for one or two, seating with its back and
// arms, tables, a desk with its pedestal, and open shelving divided into bays.
//
// A free-standing piece is anchored at the middle of its footprint, so these
// draw about the origin; the rack stands against a wall and runs y in [0, d].
import type { Furnishing } from "../../model/furnishing";
import { bedPlaces, rackBays } from "../../model/furnishing";
import { rounded } from "../symbols/defs";

/**
 * Bed: the mattress, a pillow per place at the head end, and the turn-down line
 * across it. The head is at -y, so a bed put against a wall is turned to face
 * the room the way every other piece is.
 */
export function bedMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const top = -d / 2;
  const places = bedPlaces(f);
  const gap = w * (places === 2 ? 0.056 : 0.111);
  const pillowW = (w - gap * (places + 1)) / places;
  const pillowD = d * 0.175;

  ctx.rect(-w / 2, top, w, d);
  for (let i = 0; i < places; i++) {
    ctx.rect(-w / 2 + gap + i * (pillowW + gap), top + d * 0.03, pillowW, pillowD);
  }
  // The turn-down, and -- on a bed made up for two -- the line between sides.
  ctx.moveTo(-w / 2, top + d * 0.3);
  ctx.lineTo(w / 2, top + d * 0.3);
  if (places === 2) {
    ctx.moveTo(0, top + d * 0.3);
    ctx.lineTo(0, d / 2);
  }
  ctx.stroke();
}

/**
 * Seating: the outline softened at the corners, the backrest along one side and
 * an armrest at each end. One mark for a bank and a fauteuil -- the difference
 * between them is the width, which is exactly what the model stores.
 */
export function seatMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const r = Math.min(w, d) * 0.13;
  rounded(ctx, -w / 2, -d / 2, w, d, r);
  ctx.stroke();

  ctx.beginPath();
  const backY = -d / 2 + d * 0.222;
  const armX = w / 2 - Math.min(200, w * 0.1);
  const front = d / 2 - d * 0.022;
  ctx.moveTo(-armX - r * 0.5, backY);
  ctx.lineTo(armX + r * 0.5, backY);
  for (const x of [-armX, armX]) {
    ctx.moveTo(x, backY);
    ctx.lineTo(x, front);
  }
  ctx.stroke();
}

/** Tafel: the top, as it is seen from above. */
export function tableMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  ctx.rect(-f.width / 2, -f.depth / 2, f.width, f.depth);
  ctx.stroke();
}

/**
 * Ronde tafel: round when width and depth agree, oval when they do not -- one
 * mark rather than two, since an ovale tafel is the same table drawn to the
 * size it is built at.
 */
export function tableRoundMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  ctx.ellipse(0, 0, f.width / 2, f.depth / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Bureau: the top with the pedestal under it, at the hand the piece is mirrored to. */
export function deskMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  ctx.rect(-w / 2, -d / 2, w, d);
  ctx.rect(w * 0.036, -d * 0.286, w * 0.357, d * 0.571);
  ctx.stroke();
}

/**
 * Stellage: the footprint with an upright between each bay. Shelving is
 * assembled from bays, so the divisions follow the length rather than being a
 * fixed count -- see rackBays().
 */
export function rackMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const bays = rackBays(f);
  ctx.rect(-w / 2, 0, w, d);
  for (let i = 1; i < bays; i++) {
    const x = -w / 2 + (w * i) / bays;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, d);
  }
  ctx.stroke();
}
