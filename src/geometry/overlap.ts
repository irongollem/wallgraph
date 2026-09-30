// Overlap tests between polygons and polylines, for layouts that must keep one
// mark clear of another. Polygons may be concave.
import { pointInPolygon, type Vec } from "./vec";

/** A closed polygon or an open polyline with its axis-aligned bounds. */
export interface Shape {
  pts: Vec[];
  closed: boolean;
  minX: number; minY: number; maxX: number; maxY: number;
}

export function shapeOf(pts: Vec[], closed: boolean): Shape {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { pts, closed, minX, minY, maxX, maxY };
}

const orient = (a: Vec, b: Vec, c: Vec): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** True when segments ab and cd share a point, endpoints and collinear overlap included. */
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  const on = (p: Vec, q: Vec, r: Vec, o: number): boolean =>
    o === 0 && r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x)
      && r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y);
  return on(a, b, c, o1) || on(a, b, d, o2) || on(c, d, a, o3) || on(c, d, b, o4);
}

/**
 * True when two shapes share a point: any pair of edges intersects, or a
 * vertex of one lies inside the other closed polygon. Concave polygons are
 * handled; an open shape only overlaps through its edges and its vertices.
 */
export function shapesOverlap(p: Shape, q: Shape): boolean {
  if (p.maxX < q.minX || q.maxX < p.minX || p.maxY < q.minY || q.maxY < p.minY) return false;
  const pe = p.closed ? p.pts.length : p.pts.length - 1;
  const qe = q.closed ? q.pts.length : q.pts.length - 1;
  for (let i = 0; i < pe; i++) {
    const a = p.pts[i]!, b = p.pts[(i + 1) % p.pts.length]!;
    for (let j = 0; j < qe; j++) {
      if (segmentsIntersect(a, b, q.pts[j]!, q.pts[(j + 1) % q.pts.length]!)) return true;
    }
  }
  if (q.closed && p.pts.length > 0 && pointInPolygon(p.pts[0]!, q.pts)) return true;
  if (p.closed && q.pts.length > 0 && pointInPolygon(q.pts[0]!, p.pts)) return true;
  return false;
}
