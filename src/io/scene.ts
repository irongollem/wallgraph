// The drawing as a styled tree, built once for every renderer that lays it out.
//
// io/svg.ts and io/pdf.ts put the same drawing on paper -- the plan, the sheet
// furniture, the dimension chains -- and building it twice is how the two come
// to disagree about what a plan contains. It is built once, here, from the
// primitives io/record.ts already defines, grouped and styled; each renderer
// walks the tree and paints it in its own idiom.
//
// Style inherits down the tree with SVG's rules and SVG's initial values: fill
// black, no stroke. "none" is a value rather than an absence, because a child
// has to be able to switch a parent's stroke or fill off.
import { Vec } from "../geometry/vec";
import { Prim } from "./record";

export interface Style {
  /** The pen: the stroke colour, and the fill of any text drawn with it. */
  ink?: string;
  /** Area fill. */
  fill?: string;
  /** Stroke width, in the units of the enclosing coordinate system. */
  width?: number;
  /** Dash pattern in the same units; an empty array is solid. */
  dash?: readonly number[];
  cap?: "butt" | "round";
  join?: "miter" | "round";
  bold?: boolean;
  /** CSS font stack for text; "" leaves it to the renderer's own default. */
  family?: string;
  anchor?: "start" | "middle";
  baseline?: "alphabetic" | "central";
  /** Degrees clockwise, about each text primitive's own anchor point. */
  rotate?: number;
}

/** Uniform scale about the origin, then a translation. */
export interface Placement { kind: "place"; k: number; tx: number; ty: number }
/**
 * Rotation in degrees about a point. y is down, so a positive angle turns
 * clockwise on paper -- the same direction SVG's rotate() turns.
 */
export interface Turn { kind: "turn"; deg: number; cx: number; cy: number }
export type Transform = Placement | Turn;

export interface Group {
  kind: "group";
  id?: string;
  style?: Style;
  transform?: Transform;
  items: Item[];
}

export type Item = Group | Prim;

export function group(items: Item[], style?: Style, id?: string, transform?: Transform): Group {
  return { kind: "group", items, style, id, transform };
}

export const place = (k: number, tx: number, ty: number): Placement => ({ kind: "place", k, tx, ty });
export const turn = (deg: number, cx: number, cy: number): Turn => ({ kind: "turn", deg, cx, cy });

export const line = (a: Vec, b: Vec): Prim => ({ kind: "line", a, b });
export const poly = (pts: Vec[], closed = true): Prim => ({ kind: "poly", pts, closed });
export const text = (at: Vec, size: number, body: string): Prim => ({ kind: "text", at, size, text: body });
/** A full circle as one arc; both renderers split a sweep past a half turn. */
export const circle = (c: Vec, r: number): Prim => ({ kind: "arc", c, r, start: 0, sweep: 360 });
export const rect = (x: number, y: number, w: number, h: number): Prim =>
  poly([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);

/** A style with every field decided -- what a renderer actually paints with. */
export interface Look {
  ink: string;
  fill: string;
  width: number;
  dash: readonly number[];
  cap: "butt" | "round";
  join: "miter" | "round";
  bold: boolean;
  family: string;
  anchor: "start" | "middle";
  baseline: "alphabetic" | "central";
  rotate: number;
}

/** SVG's initial values, which both renderers start from. */
export const ROOT: Look = {
  ink: "none", fill: "#000000", width: 1, dash: [],
  cap: "butt", join: "miter", bold: false, family: "",
  anchor: "start", baseline: "alphabetic", rotate: 0,
};

export function resolve(parent: Look, s?: Style): Look {
  if (!s) return parent;
  return {
    ink: s.ink ?? parent.ink,
    fill: s.fill ?? parent.fill,
    width: s.width ?? parent.width,
    dash: s.dash ?? parent.dash,
    cap: s.cap ?? parent.cap,
    join: s.join ?? parent.join,
    bold: s.bold ?? parent.bold,
    family: s.family ?? parent.family,
    anchor: s.anchor ?? parent.anchor,
    baseline: s.baseline ?? parent.baseline,
    rotate: s.rotate ?? parent.rotate,
  };
}

/**
 * An arc split into sweeps of at most a half turn. A full circle has identical
 * endpoints, which is a degenerate SVG arc and an ambiguous Bezier; splitting
 * is what makes `circle()` above drawable in both renderers.
 */
export function arcSteps(startDeg: number, sweepDeg: number, maxDeg: number): Array<{ from: number; sweep: number }> {
  const count = Math.max(1, Math.ceil(Math.abs(sweepDeg) / maxDeg));
  const step = sweepDeg / count;
  const out: Array<{ from: number; sweep: number }> = [];
  for (let i = 0; i < count; i++) out.push({ from: startDeg + step * i, sweep: step });
  return out;
}

export const onCircle = (c: Vec, r: number, deg: number): Vec => ({
  x: c.x + Math.cos((deg * Math.PI) / 180) * r,
  y: c.y + Math.sin((deg * Math.PI) / 180) * r,
});
