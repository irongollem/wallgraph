// Stair drawing contract and the marks every kind is built from.
//
// The contract is the symbol library's, deliberately: `ctx` is pre-transformed
// so one unit is one millimetre, the origin is the anchor, +y runs into the
// room, and the caller owns the colour. That is what lets a stair be replayed
// through the same recorder the symbols use, so SVG and DXF get stairs without
// a second, hand-kept outline of each one.
//
// What differs is the second argument. A symbol draws itself; a stair draws
// itself AT a size, because its width, going and tread count are properties of
// the plan rather than of the kind.
import { ResolvedStair, StairKind } from "../../model/stair";
import { Vec, v } from "../../geometry/vec";
import { withCtx } from "../symbols/defs";

export { withCtx };

export interface StairDef {
  kind: StairKind;
  /** Short English label, as SymbolDef.label is; the palette shows a translation. */
  label: string;
  draw(ctx: CanvasRenderingContext2D, s: ResolvedStair): void;
  /**
   * Traces the floor the stair occupies, for the wash drawn behind it. Absent
   * means the footprint rectangle, which is the shape of every kind that is not
   * round — only the winding stairs need to say otherwise, and a square wash
   * behind a round one would look like a mistake.
   */
  region?(ctx: CanvasRenderingContext2D, s: ResolvedStair): void;
}

/** Arrowhead length and half-width, mm. Sized to read at a 900 mm flight. */
const HEAD_LEN = 170;
const HEAD_HALF = 65;
/** Half-length of the bar across the tail of the walking line. */
const TAIL_HALF = 90;

export function seg(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
}

export function circle(ctx: CanvasRenderingContext2D, c: Vec, r: number): void {
  if (!(r > 0)) return;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

export function arcPath(ctx: CanvasRenderingContext2D, c: Vec, r: number, a0: number, a1: number): void {
  if (!(r > 0)) return;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, a0, a1, a1 < a0);
  ctx.stroke();
}

/** A run of tread lines square to the flight: `n` gaps of `going` from `y0`. */
export function treadLines(
  ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, going: number, n: number,
): void {
  for (let i = 1; i < n; i++) {
    const y = y0 + i * going;
    seg(ctx, x0, y, x1, y);
  }
}

/**
 * The walking line, from the foot of the flight to its head. The sheet's own
 * note is the rule here: the arrow always points from below to above, so a
 * descending stair is this same drawing turned around rather than a second
 * convention that could disagree with the geometry.
 */
export function walkArrow(ctx: CanvasRenderingContext2D, pts: Vec[]): void {
  if (pts.length < 2) return;
  const first = pts[0]!, second = pts[1]!;
  const tip = pts[pts.length - 1]!, prev = pts[pts.length - 2]!;

  // Tail bar: where the flight starts, square to it.
  const t = unit(sub(second, first));
  seg(ctx, first.x - t.y * TAIL_HALF, first.y + t.x * TAIL_HALF,
           first.x + t.y * TAIL_HALF, first.y - t.x * TAIL_HALF);

  const d = unit(sub(tip, prev));
  const base = v(tip.x - d.x * HEAD_LEN, tip.y - d.y * HEAD_LEN);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const p of pts.slice(1, -1)) ctx.lineTo(p.x, p.y);
  ctx.lineTo(base.x, base.y);
  ctx.stroke();

  // Solid head. fill() takes the stroke colour by the drawing contract, so it
  // highlights with the rest of the stair on selection.
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(base.x - d.y * HEAD_HALF, base.y + d.x * HEAD_HALF);
  ctx.lineTo(base.x + d.y * HEAD_HALF, base.y - d.x * HEAD_HALF);
  ctx.closePath();
  ctx.fill();
}

/** The same arrow, following an arc: a spiral's walking line. */
export function walkArrowArc(
  ctx: CanvasRenderingContext2D, c: Vec, r: number, a0: number, a1: number,
): void {
  const steps = Math.max(2, Math.round((Math.abs(a1 - a0) / (Math.PI / 12))));
  const pts: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push(v(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));
  }
  walkArrow(ctx, pts);
}

/**
 * The break line at a cut: where two flights pass over each other, the drawing
 * shows only the lower one below the cut and only the upper one above it. Two
 * parallel strokes, raked across the flight, are the conventional mark.
 */
export function breakLine(
  ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, rake: number,
): void {
  const gap = 140;
  for (const off of [-gap / 2, gap / 2]) {
    seg(ctx, x0, y + off + rake / 2, x1, y + off - rake / 2);
  }
}

/**
 * A quarter of winders: `n` treads fanning from the inside corner of the turn,
 * between the two edges that meet there. Rays are cut off at the far side of
 * the square, so the fan fills it however wide the flight is.
 */
export function winderFan(
  ctx: CanvasRenderingContext2D, pivot: Vec, fromAngle: number, toAngle: number, n: number,
  b: { x0: number; y0: number; x1: number; y1: number },
): void {
  for (let i = 1; i < n; i++) {
    const a = fromAngle + ((toAngle - fromAngle) * i) / n;
    const hit = rayExit(pivot, v(Math.cos(a), Math.sin(a)), b);
    if (hit) seg(ctx, pivot.x, pivot.y, hit.x, hit.y);
  }
}

/** Where a ray from inside a box leaves it. Null if the direction is degenerate. */
export function rayExit(
  p: Vec, d: Vec, b: { x0: number; y0: number; x1: number; y1: number },
): Vec | null {
  let t = Infinity;
  const consider = (num: number, den: number): void => {
    if (Math.abs(den) < 1e-9) return;
    const tt = num / den;
    if (tt > 1e-9 && tt < t) t = tt;
  };
  consider(b.x0 - p.x, d.x);
  consider(b.x1 - p.x, d.x);
  consider(b.y0 - p.y, d.y);
  consider(b.y1 - p.y, d.y);
  return isFinite(t) ? v(p.x + d.x * t, p.y + d.y * t) : null;
}

/**
 * A segment clipped to a box (Liang-Barsky). Raking treads run off the sides of
 * the flight they belong to, and a scheluw stair is exactly that drawing.
 */
export function clipSeg(
  a: Vec, bb: Vec, box2: { x0: number; y0: number; x1: number; y1: number },
): [Vec, Vec] | null {
  const dx = bb.x - a.x, dy = bb.y - a.y;
  let t0 = 0, t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - box2.x0], [dx, box2.x1 - a.x],
    [-dy, a.y - box2.y0], [dy, box2.y1 - a.y],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [v(a.x + dx * t0, a.y + dy * t0), v(a.x + dx * t1, a.y + dy * t1)];
}

function sub(a: Vec, b: Vec): Vec { return v(a.x - b.x, a.y - b.y); }
function unit(a: Vec): Vec {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-9 ? v(0, 1) : v(a.x / l, a.y / l);
}
