// 2D vector math. World units are millimetres, x right, y down (canvas orientation).
export interface Vec { x: number; y: number }

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
/** 90° rotation (x,y) -> (-y,x). With y-down this is the CLOCKWISE visual side. */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x);
export const fromAngle = (t: number, l = 1): Vec => ({ x: Math.cos(t) * l, y: Math.sin(t) * l });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec, b: Vec): Vec => lerp(a, b, 0.5);
export const eq = (a: Vec, b: Vec, tol = 1e-6): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** Intersection of infinite lines p1 + t·d1 and p2 + s·d2; null if parallel. */
export function lineIntersect(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, scale(d1, t));
}

/** Distance from p to segment ab, plus the clamped parameter along ab. */
export function distToSeg(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { d: dist(p, add(a, scale(ab, t))), t };
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!, pj = poly[j]!;
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Vec[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!, pj = poly[j]!;
    s += pj.x * pi.y - pi.x * pj.y;
  }
  return s / 2; // signed; positive = counterclockwise in y-down screen terms
}

/** The part of `poly` on the side of the line through `o` that `n` points
 *  into, closed along the line — Sutherland–Hodgman against one half-plane. */
export function clipHalfPlane(poly: Vec[], o: Vec, n: Vec): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const dp = (p.x - o.x) * n.x + (p.y - o.y) * n.y;
    const dq = (q.x - o.x) * n.x + (q.y - o.y) * n.y;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push(v(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t));
    }
  }
  return out;
}

export function polygonCentroid(poly: Vec[]): Vec {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!, pj = poly[j]!;
    const f = pj.x * pi.y - pi.x * pj.y;
    a += f; cx += (pj.x + pi.x) * f; cy += (pj.y + pi.y) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) return poly[0] ?? v(0, 0);
  return { x: cx / (6 * a), y: cy / (6 * a) };
}
