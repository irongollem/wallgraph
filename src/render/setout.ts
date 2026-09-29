// The marks of a setting-out dimension (uitzetmaat) as recorder primitives, for
// the exports. The canvas draws the same line and ticks itself in screen-scaled
// units (drawSetOut in render/draw.ts).
import { SetOutDim } from "../core/setout";
import { Prim } from "../io/record";
import { Vec, add, sub, scale, norm, perp, mid } from "../geometry/vec";

/** Arrowhead length and figure height in the SVG and DXF, world mm. */
export const SET_OUT_TICK_MM = 90;
export const SET_OUT_TEXT_MM = 140;

/** The dimension line and an arrowhead at each end. */
export function setOutLines(d: SetOutDim, tick: number): Prim[] {
  const dir = norm(sub(d.to, d.from));
  const n = perp(dir);
  const head = (tip: Vec, back: Vec): Prim[] => [
    { kind: "line", a: tip, b: add(tip, add(scale(back, tick), scale(n, tick * 0.4))) },
    { kind: "line", a: tip, b: add(tip, sub(scale(back, tick), scale(n, tick * 0.4))) },
  ];
  return [
    { kind: "line", a: d.from, b: d.to },
    ...head(d.from, dir),
    ...head(d.to, scale(dir, -1)),
  ];
}

/** Lines plus the figure, lifted just off the line so both stay legible. */
export function setOutPrims(dims: readonly SetOutDim[]): Prim[] {
  const out: Prim[] = [];
  for (const d of dims) {
    out.push(...setOutLines(d, SET_OUT_TICK_MM));
    const n = perp(norm(sub(d.to, d.from)));
    out.push({
      kind: "text", at: add(mid(d.from, d.to), scale(n, SET_OUT_TEXT_MM * 0.7)),
      size: SET_OUT_TEXT_MM, text: String(d.lengthMm),
    });
  }
  return out;
}
