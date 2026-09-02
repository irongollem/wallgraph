// Orbit camera over the building: a target in mesh space plus distance, yaw
// and pitch.
//
// Mesh space is document space with height: x right, y DOWN (matching the 2D
// canvas, invariant 2), z up in mm above Peil. That frame is left-handed
// against the right-handed math in mat4.ts, so the camera computes eye and
// basis vectors in a right-handed frame whose y axis is the document's y
// negated, and folds the y flip into the view matrix — one negated column in
// viewProjection(). This is the only place the two conventions meet; nothing
// else remaps axes, and a plan seen from above reads exactly like the 2D
// canvas: larger document y projects to smaller clip-space y (lower on
// screen), larger document x to larger clip-space x.
import { lookAt, multiply, perspective } from "./mat4";
import type { Bounds3 } from "./mesh";

/** Vertical field of view, radians. */
export const FOV_Y = (40 * Math.PI) / 180;
/** Pitch limits keep the view direction off the up axis, so lookAt() never
 *  degenerates and the camera cannot flip over the top. */
export const PITCH_MIN = 0.08;
export const PITCH_MAX = 1.48;
/** Distance limits, mm: closer than a doorway to farther than any plan. */
export const DIST_MIN = 500;
export const DIST_MAX = 500000;
/** Default 3/4 view: from the document-south side, well above the horizon,
 *  so the opening view reads as the plan tipped away rather than rotated. */
export const DEFAULT_YAW = -Math.PI / 2;
export const DEFAULT_PITCH = 0.9;

/** Extra distance past the exact bounding-sphere frame. */
const FIT_MARGIN = 1.15;

export class OrbitCamera {
  /** Orbit centre in mesh space, mm. */
  target: [number, number, number] = [0, 0, 0];
  /** Eye-to-target distance, mm. */
  distance = 15000;
  /** Azimuth, radians; DEFAULT_YAW puts the eye document-south of the target. */
  yaw = DEFAULT_YAW;
  /** Elevation above the horizon, radians, clamped to (0, pi/2) exclusive. */
  pitch = DEFAULT_PITCH;

  orbit(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, PITCH_MIN, PITCH_MAX);
  }

  dolly(factor: number): void {
    this.distance = clamp(this.distance * factor, DIST_MIN, DIST_MAX);
  }

  /**
   * Move the target in the view plane so the scene follows a drag of
   * (dxPx, dyPx) screen pixels. Scaled by the world height one pixel covers
   * at the target's depth, so the plan tracks the pointer at any distance.
   */
  pan(dxPx: number, dyPx: number, viewportHeightPx: number): void {
    const mmPerPx = (2 * this.distance * Math.tan(FOV_Y / 2)) / Math.max(1, viewportHeightPx);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // Screen-right and screen-up as unit vectors in mesh space (y down).
    const rx = -sy, ry = -cy;
    const ux = -sp * cy, uy = sp * sy, uz = cp;
    // The scene follows the pointer, so the target moves against the drag.
    this.target[0] += (-dxPx * rx + dyPx * ux) * mmPerPx;
    this.target[1] += (-dxPx * ry + dyPx * uy) * mmPerPx;
    this.target[2] += dyPx * uz * mmPerPx;
  }

  /**
   * Frame `b`: target at its centre, distance framing its bounding sphere
   * with FIT_MARGIN, orientation reset to the default 3/4 view. The limiting
   * half-angle is the smaller of the vertical and horizontal ones, so the
   * sphere fits both ways at any aspect.
   */
  fit(b: Bounds3, aspect: number): void {
    this.target = [
      (b.min[0] + b.max[0]) / 2,
      (b.min[1] + b.max[1]) / 2,
      (b.min[2] + b.max[2]) / 2,
    ];
    const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
    const a = isFinite(aspect) && aspect > 0 ? aspect : 1;
    const halfY = FOV_Y / 2;
    const half = Math.min(halfY, Math.atan(Math.tan(halfY) * a));
    this.distance = clamp((r * FIT_MARGIN) / Math.sin(half), DIST_MIN, DIST_MAX);
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
  }

  /**
   * Perspective times view, taking mesh-space mm to clip space. Near and far
   * scale with the distance so mm-scale scenes keep depth precision at any
   * zoom.
   */
  viewProjection(aspect: number): Float32Array {
    const a = isFinite(aspect) && aspect > 0 ? aspect : 1;
    const [tx, ty, tz] = this.target;
    // Right-handed working frame: document y negated.
    const tW: [number, number, number] = [tx, -ty, tz];
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye: [number, number, number] = [
      tW[0] + this.distance * cp * Math.cos(this.yaw),
      tW[1] + this.distance * cp * Math.sin(this.yaw),
      tW[2] + this.distance * sp,
    ];
    const view = lookAt(eye, tW, [0, 0, 1]);
    // Fold the mesh-space y flip into the view matrix: negating its second
    // column right-multiplies by diag(1,-1,1,1), mapping y-down document
    // coordinates into the right-handed frame the lookAt was built in.
    view[4] = -view[4]!; view[5] = -view[5]!; view[6] = -view[6]!; view[7] = -view[7]!;
    const proj = perspective(FOV_Y, a, this.distance / 100, this.distance * 40);
    return multiply(proj, view);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
