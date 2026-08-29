// Circular-arc walls use the DXF "bulge" convention: bulge = tan(theta/4) where
// theta is the signed included angle. bulge 0 = straight. Positive bulge bows the
// wall toward perp(chord direction) (visually: to the right of a->b on screen,
// since y is down). One number, stable under node moves.
import { Vec, add, sub, scale, len, norm, perp, mid, angleOf, dist, v } from "./vec";

export interface ArcInfo {
  center: Vec;
  radius: number;
  a0: number;   // angle center->start
  a1: number;   // angle center->end
  ccw: boolean; // traversal direction start->end for canvas arc(anticlockwise=ccw)
  theta: number; // |included angle|
}

export function arcInfo(a: Vec, b: Vec, bulge: number): ArcInfo | null {
  if (bulge === 0) return null;
  const c = dist(a, b);
  if (c < 1e-9) return null;
  const m = mid(a, b);
  const pu = perp(norm(sub(b, a)));
  const g = bulge;
  // center offset from chord midpoint along pu (derivation: circle through a, b and
  // apex m + pu*(c*g/2)); radius = (c/4)|g + 1/g|.
  const k = (c / 4) * (g - 1 / g);
  const center = add(m, scale(pu, k));
  const radius = (c / 4) * Math.abs(g + 1 / g);
  const a0 = angleOf(sub(a, center));
  const a1 = angleOf(sub(b, center));
  // With y-down screen coords and positive bulge toward pu, traversal a->b
  // sweeps with decreasing canvas angle when bulge > 0.
  const ccw = g > 0;
  return { center, radius, a0, a1, ccw, theta: Math.abs(4 * Math.atan(g)) };
}

export function arcLength(a: Vec, b: Vec, bulge: number): number {
  const info = arcInfo(a, b, bulge);
  return info ? info.radius * info.theta : dist(a, b);
}

/** Point at fraction t (0..1 of arc length) from a to b. */
export function arcPointAt(a: Vec, b: Vec, bulge: number, t: number): Vec {
  const info = arcInfo(a, b, bulge);
  if (!info) return add(a, scale(sub(b, a), t));
  const sweep = sweepOf(info);
  const ang = info.a0 + sweep * t;
  return add(info.center, v(Math.cos(ang) * info.radius, Math.sin(ang) * info.radius));
}

/** Unit tangent in the direction of traversal at fraction t. */
export function arcTangentAt(a: Vec, b: Vec, bulge: number, t: number): Vec {
  const info = arcInfo(a, b, bulge);
  if (!info) return norm(sub(b, a));
  const sweep = sweepOf(info);
  const ang = info.a0 + sweep * t;
  const radial = v(Math.cos(ang), Math.sin(ang));
  const tang = info.ccw ? scale(perp(radial), -1) : perp(radial);
  return tang;
}

/** Signed sweep from a0 to a1 honouring direction (canvas y-down angles). */
function sweepOf(info: ArcInfo): number {
  let d = info.a1 - info.a0;
  const TAU = Math.PI * 2;
  if (info.ccw) { // decreasing canvas angle
    while (d > 0) d -= TAU;
  } else {
    while (d < 0) d += TAU;
  }
  return d;
}

/** Flatten to polyline including both endpoints. tol = max chord error, mm. */
export function arcFlatten(a: Vec, b: Vec, bulge: number, tol = 2): Vec[] {
  const info = arcInfo(a, b, bulge);
  if (!info) return [a, b];
  const maxStep = 2 * Math.acos(Math.max(0, Math.min(1, 1 - tol / info.radius)));
  const n = Math.max(1, Math.ceil(info.theta / Math.max(maxStep, 0.05)));
  const pts: Vec[] = [a];
  for (let i = 1; i < n; i++) pts.push(arcPointAt(a, b, bulge, i / n));
  pts.push(b);
  return pts;
}

/** Bulge for a given signed sagitta (apex offset toward perp(chord)), for editing. */
export function bulgeFromSagitta(a: Vec, b: Vec, sagitta: number): number {
  const c = dist(a, b);
  if (c < 1e-9) return 0;
  return (2 * sagitta) / c;
}

export function sagittaFromBulge(a: Vec, b: Vec, bulge: number): number {
  return (dist(a, b) * bulge) / 2;
}
