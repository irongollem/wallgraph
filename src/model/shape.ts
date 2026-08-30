// The closed runs the wall tool draws in one gesture: a rectangle, a circle and
// a regular polygon. Each is two points plus a parameter or two, and what comes
// back is a ring of vertices with one bulge per edge -- insertRun() in ops.ts
// welds that into the graph as ordinary walls.
//
// Nothing here is stored. A drawn rectangle is four walls afterwards, not a
// rectangle: the document is a wall graph, and a shape is only how the walls
// were entered.
import { Vec, v, sub, add, dist, angleOf, fromAngle } from "../geometry/vec";

export type WallShape = "line" | "rect" | "circle" | "polygon";
export const WALL_SHAPES: readonly WallShape[] = ["line", "rect", "circle", "polygon"];

/**
 * Sides a regular polygon is offered at. Three is the smallest ring that
 * encloses anything; past two dozen it is a circle drawn the slow way, and the
 * circle is exact.
 */
export const POLYGON_MIN_SIDES = 3;
export const POLYGON_MAX_SIDES = 24;
export const POLYGON_DEFAULT_SIDES = 6;

/** Smallest span a shape is accepted at; below this the two points are one point. */
export const MIN_SHAPE_MM = 20;

export interface ShapeRun {
  /** Ring vertices, integer mm. */
  points: Vec[];
  /** bulges[i] belongs to the edge points[i] -> points[i + 1], wrapping. */
  bulges: number[];
}

export interface ShapeOpts {
  /** Rectangle only: take the longer side for both. */
  square?: boolean;
  /** Polygon only. */
  sides?: number;
}

export function clampSides(n: number): number {
  return Math.max(POLYGON_MIN_SIDES, Math.min(POLYGON_MAX_SIDES, Math.round(n)));
}

/**
 * The ring a shape spans between two points: corner to opposite corner for a
 * rectangle, centre to rim for a circle and a polygon. Null when the two points
 * are too close together to be a shape, which is what a stray double click is.
 */
export function shapeRun(shape: WallShape, from: Vec, to: Vec, opts: ShapeOpts = {}): ShapeRun | null {
  if (shape === "line") return null;
  if (shape === "rect") return rectRun(from, to, opts.square === true);

  const r = Math.round(dist(from, to));
  if (r < MIN_SHAPE_MM) return null;
  const n = shape === "circle" ? 4 : clampSides(opts.sides ?? POLYGON_DEFAULT_SIDES);
  // The point clicked is a vertex, so the ring passes through it: a radius is
  // aimed at something on the drawing far more often than it is typed.
  const start = angleOf(sub(to, from));
  const points: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = add(from, fromAngle(start + (i * 2 * Math.PI) / n, r));
    points.push(v(Math.round(p.x), Math.round(p.y)));
  }
  return { points, bulges: points.map(() => ringBulge(shape, n)) };
}

/**
 * A circle is four quarter arcs, not a polygon with many sides: a wall already
 * carries a bulge, so the curve is exact, the four quarters stay walls that can
 * be dragged and bowed afterwards, and every export draws a real arc.
 *
 * bulge = tan(theta/4) for an included angle of 2*pi/n, negative because a
 * positive bulge bows toward perp(chord) -- with y down and the ring traversed
 * in increasing angle, that is the inside of the ring.
 */
function ringBulge(shape: WallShape, n: number): number {
  return shape === "circle" ? -Math.tan(Math.PI / (2 * n)) : 0;
}

function rectRun(from: Vec, to: Vec, square: boolean): ShapeRun | null {
  let dx = Math.round(to.x - from.x), dy = Math.round(to.y - from.y);
  if (square) {
    // The longer side wins and both keep their sign, so the square stays in the
    // quadrant the cursor is in rather than jumping across the first corner.
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -s : s;
    dy = dy < 0 ? -s : s;
  }
  if (Math.abs(dx) < MIN_SHAPE_MM || Math.abs(dy) < MIN_SHAPE_MM) return null;
  const x0 = Math.round(from.x), y0 = Math.round(from.y);
  const x1 = x0 + dx, y1 = y0 + dy;
  return { points: [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)], bulges: [0, 0, 0, 0] };
}
