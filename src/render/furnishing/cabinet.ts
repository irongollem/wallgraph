// The cabinet mark: the carcass outline, a band for the front, and a mark
// saying what the front does -- a diagonal to the hinged end for a door, a pair
// of them for two leaves, lines stepping back into the carcass for drawers,
// nothing at all for an open unit. A worktop adds the overhang line along the
// front.
import type { Furnishing } from "../../model/furnishing";
import { furnishingFront } from "../../model/furnishing";
import {
  cabinetOutline, cabinetFrontBand, cabinetFrontDivisions, cabinetDrawerLines,
  cabinetHingeMarks, cabinetSlideMark, cabinetWorktopEdge,
} from "../../core/furnishing";
import { poly, seg } from "./path";

export function cabinetMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  ctx.beginPath();
  poly(ctx, cabinetOutline(f), true);
  ctx.stroke();

  // An open unit has no front to draw; everything else gets the band.
  if (furnishingFront(f) !== "open") {
    ctx.beginPath();
    poly(ctx, cabinetFrontBand(f), true);
    ctx.stroke();
  }

  ctx.beginPath();
  for (const [a, z] of cabinetHingeMarks(f)) seg(ctx, a, z);
  for (const [a, z] of cabinetFrontDivisions(f)) seg(ctx, a, z);
  for (const [a, z] of cabinetDrawerLines(f)) seg(ctx, a, z);
  const slide = cabinetSlideMark(f);
  if (slide) seg(ctx, slide[0], slide[1]);
  ctx.stroke();

  if (f.worktop) {
    const [a, z] = cabinetWorktopEdge(f);
    ctx.beginPath();
    seg(ctx, a, z);
    ctx.stroke();
  }
}
