// Kitchen marks: the fixed appliance in the standard's "toestel" outline, and
// the worktop run with its bowl.
//
// Every figure below is a fraction of the stored width and depth rather than a
// millimetre count, which is the point of the furnishing model: a 600 fornuis
// and an 800 fornuis are the same mark drawn to the size the run is built to.
// The fractions are read off the sizes the marks were originally drawn at.
import type { Furnishing } from "../../model/furnishing";
import { applianceMark, furnishingBasins } from "../../model/furnishing";
import { applianceBox, asterisk, circle, dot, wave } from "../symbols/defs";

/** A fixed appliance: the footprint box, its connection stub, and the mark. */
export function applianceMarkDraw(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const mark = applianceMark(f);
  const unit = Math.min(w, d);

  // An afzuigkap hangs above the worktop rather than standing on the floor, so
  // it carries no connection stub and is the one appliance drawn as a plain
  // outline. Its dashed line comes from furnishingOverhead().
  if (mark === "hood") {
    const r = unit * 0.28;
    ctx.rect(-w / 2, 0, w, d);
    circle(ctx, 0, d / 2, r);
    const k = r * 0.707;
    ctx.moveTo(-k, d / 2 - k);
    ctx.lineTo(k, d / 2 + k);
    ctx.moveTo(k, d / 2 - k);
    ctx.lineTo(-k, d / 2 + k);
    ctx.stroke();
    return;
  }

  applianceBox(ctx, w, d);

  if (mark === "oven") {
    // Oven (elektrisch): the box divided off along the wall edge, one filled
    // mark in the cavity.
    ctx.moveTo(-w / 2, d * 0.3);
    ctx.lineTo(w / 2, d * 0.3);
  }
  if (mark === "microwave") {
    // Magnetron: two waves.
    wave(ctx, 0, d * 0.4, w * 0.545, 2, d * 0.1375);
    wave(ctx, 0, d * 0.65, w * 0.545, 2, d * 0.1375);
  }
  if (mark === "fridge") asterisk(ctx, 0, d * 0.5, unit * 0.2);
  if (mark === "freezer") {
    // Vriezer: three asterisks. The count is what separates it from the
    // koelkast, so the row is drawn small enough to stay three marks.
    for (const x of [-w * 0.283, 0, w * 0.283]) asterisk(ctx, x, d * 0.5, unit * 0.125);
  }
  ctx.stroke();

  if (mark === "cooktop") {
    // Fornuis: three filled burner marks, one back, two front.
    const r = unit * 0.108;
    dot(ctx, w * 0.2, d * 0.35, r);
    dot(ctx, -w * 0.2, d * 0.667, r);
    dot(ctx, w * 0.2, d * 0.667, r);
  }
  if (mark === "oven") dot(ctx, 0, d * 0.65, unit * 0.125);
}

/**
 * Aanrecht: the worktop run, one or two bowls with their drains, and the
 * drainer grooves over whatever length is left. The bowls sit at the -x end so
 * a mirrored run puts the drainer on the other hand, which is the choice a
 * kitchen drawing actually records.
 */
export function counterMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  const w = f.width, d = f.depth;
  const bowls = furnishingBasins(f);
  const inset = Math.min(d * 0.16, w * 0.1);
  const bowlD = d - 2 * inset;
  // Bowls are built to a size; the drainer takes the length that is left.
  const bowlW = Math.min(bowlD * 1.05, (w - inset * (bowls + 1)) / bowls);

  ctx.rect(-w / 2, 0, w, d);
  for (let i = 0; i < bowls; i++) {
    const x0 = -w / 2 + inset + i * (bowlW + inset);
    ctx.rect(x0, inset, bowlW, bowlD);
  }

  const drainerFrom = -w / 2 + inset + bowls * (bowlW + inset);
  const grooves = Math.floor((w / 2 - drainerFrom) / (w * 0.07));
  for (let i = 1; i <= grooves; i++) {
    const x = drainerFrom + i * (w * 0.07);
    ctx.moveTo(x, d * 0.24);
    ctx.lineTo(x, d * 0.76);
  }
  ctx.stroke();

  for (let i = 0; i < bowls; i++) {
    const x0 = -w / 2 + inset + i * (bowlW + inset);
    dot(ctx, x0 + bowlW / 2, d / 2, Math.min(30, bowlW * 0.1));
  }
}
