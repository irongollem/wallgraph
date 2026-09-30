// The sun that lights the 3D view and the light projection its shadow map is
// rendered through. The light is fixed to the building, so the direction
// depends on the plan's north arrow and never on the camera.
import type { Bounds3 } from "./mesh";

export type Vec3T = [number, number, number];

/**
 * Unit vector toward the sun in mesh space (x right, y down, z up).
 * `azimuthDeg` is a compass bearing (225 = south-west). `northDeg` is the
 * plan's clockwise-from-screen-up convention (core/energy.ts), so the sun's
 * screen bearing is `northDeg + azimuthDeg` clockwise from up; absent reads
 * as 0. `altitudeDeg` is the elevation above the horizon.
 */
export function sunDirection(northDeg: number | undefined, azimuthDeg = 225, altitudeDeg = 35): Vec3T {
  const bearing = (((northDeg ?? 0) + azimuthDeg) * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  const h = Math.cos(alt);
  // Screen-up is -y in mesh space, screen-right is +x.
  return [h * Math.sin(bearing), -h * Math.cos(bearing), Math.sin(alt)];
}

export interface LightProjection {
  /** Column-major mesh-space mm to clip space; depth 0..1 after the viewport transform. */
  matrix: Float32Array;
  /** Mesh-space mm covered by one shadow-map texel at `size` texels across. */
  texelMm: (size: number) => number;
  /** Extent of the depth range along the light, mm. */
  depthMm: number;
}

/** Margin added around the fitted box, mm, so an edge texel never clips a caster. */
const FIT_PAD_MM = 100;

/** Orthographic projection along -`sun`, fitted to the box `b`. */
export function lightProjection(b: Bounds3, sun: Vec3T): LightProjection {
  const f: Vec3T = [-sun[0], -sun[1], -sun[2]];
  const up: Vec3T = Math.abs(f[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1];
  const s = unit(cross(f, up));
  const u = cross(s, f);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p: Vec3T = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
    const c = [dot(p, s), dot(p, u), dot(p, f)];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, c[k]!); hi[k] = Math.max(hi[k]!, c[k]!); }
  }
  for (let k = 0; k < 3; k++) { lo[k]! -= FIT_PAD_MM; hi[k]! += FIT_PAD_MM; }
  const w = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
  const m = new Float32Array(16);
  const axes: Vec3T[] = [s, u, f];
  for (let r = 0; r < 3; r++) {
    const a = 2 / w[r]!;
    for (let c = 0; c < 3; c++) m[c * 4 + r] = axes[r]![c]! * a;
    m[12 + r] = -2 * lo[r]! / w[r]! - 1;
  }
  m[15] = 1;
  return { matrix: m, texelMm: size => Math.max(w[0]!, w[1]!) / size, depthMm: w[2]! };
}

function dot(a: Vec3T, b: Vec3T): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3T, b: Vec3T): Vec3T {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function unit(a: Vec3T): Vec3T {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
