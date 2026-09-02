// Matrix and orbit-camera math for the 3D view: multiply order, projection
// and view sanity, the clamps, the fit framing, and the y-down convention —
// the camera maps document space (x right, y down, z up) into clip space
// without mirroring the plan.
import { identity, multiply, perspective, lookAt } from "../src/render3d/mat4";
import {
  OrbitCamera, PITCH_MIN, PITCH_MAX, DIST_MIN, DIST_MAX, DEFAULT_YAW, DEFAULT_PITCH,
} from "../src/render3d/camera";
import type { Bounds3 } from "../src/render3d/mesh";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1e-4): boolean { return Math.abs(a - b) <= tol; }

/** m·(x,y,z,1) as clip-space [x,y,z,w]. */
function apply(m: Float32Array, p: [number, number, number]): { x: number; y: number; z: number; w: number } {
  const at = (r: number): number => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2] + m[12 + r]!;
  return { x: at(0), y: at(1), z: at(2), w: at(3) };
}
function ndc(m: Float32Array, p: [number, number, number]): { x: number; y: number; z: number } {
  const c = apply(m, p);
  return { x: c.x / c.w, y: c.y / c.w, z: c.z / c.w };
}
/** In front of the camera and inside all six clip planes. */
function inClip(m: Float32Array, p: [number, number, number]): boolean {
  const c = apply(m, p);
  return c.w > 0 && Math.abs(c.x) <= c.w && Math.abs(c.y) <= c.w && Math.abs(c.z) <= c.w;
}
function sameMat(m: Float32Array, expected: number[]): boolean {
  return expected.every((v, i) => near(m[i]!, v, 1e-6));
}

// ── identity and multiply ──────────────────────────────────────────────────

{
  const p = apply(identity(), [3, -5, 7]);
  check("identity leaves a point unchanged",
    p.x === 3 && p.y === -5 && p.z === 7 && p.w === 1, JSON.stringify(p));

  // T = translate(1,2,3), S = scale(2,3,4), both column-major.
  const T = identity();
  T[12] = 1; T[13] = 2; T[14] = 3;
  const S = identity();
  S[0] = 2; S[5] = 3; S[10] = 4;
  check("T·S scales first, then translates",
    sameMat(multiply(T, S), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]),
    String(multiply(T, S)));
  check("S·T translates first, then scales",
    sameMat(multiply(S, T), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 2, 6, 12, 1]),
    String(multiply(S, T)));
}

// ── perspective ────────────────────────────────────────────────────────────

{
  const P = perspective((40 * Math.PI) / 180, 1.5, 100, 10000);
  check("a point in front of the camera lands inside clip space", inClip(P, [0, 0, -1000]));
  check("clip w is the view depth", near(apply(P, [0, 0, -1000]).w, 1000, 1e-3));
  check("a point behind the camera lands outside (negative w)",
    !inClip(P, [0, 0, 1000]) && apply(P, [0, 0, 1000]).w < 0);
  check("a point far off axis lands outside", !inClip(P, [10000, 0, -1000]));
  check("a point nearer than the near plane lands outside", !inClip(P, [0, 0, -50]));
}

// ── lookAt ─────────────────────────────────────────────────────────────────

{
  const V = lookAt([0, 0, 1000], [0, 0, 0], [0, 1, 0]);
  const origin = apply(V, [0, 0, 0]);
  check("lookAt puts the target on the -z view axis",
    near(origin.x, 0) && near(origin.y, 0) && near(origin.z, -1000, 1e-3) && near(origin.w, 1));

  const PV = multiply(perspective((40 * Math.PI) / 180, 1, 100, 100000), V);
  check("the target is inside clip space through P·V", inClip(PV, [0, 0, 0]));
  check("a point behind the eye is outside through P·V", !inClip(PV, [0, 0, 2000]));
  check("with up +y, world +x projects to the right",
    ndc(PV, [200, 0, 0]).x > 0 && ndc(PV, [-200, 0, 0]).x < 0);
}

// ── camera clamps ──────────────────────────────────────────────────────────

{
  const cam = new OrbitCamera();
  cam.orbit(0.3, 100);
  check("pitch clamps at the top", cam.pitch === PITCH_MAX, String(cam.pitch));
  cam.orbit(0, -100);
  check("pitch clamps at the bottom", cam.pitch === PITCH_MIN, String(cam.pitch));
  cam.dolly(1e12);
  check("distance clamps far", cam.distance === DIST_MAX, String(cam.distance));
  cam.dolly(1e-12);
  check("distance clamps near", cam.distance === DIST_MIN, String(cam.distance));
}

// ── fit frames the box ─────────────────────────────────────────────────────

{
  const b: Bounds3 = { min: [0, 0, 0], max: [8000, 6000, 2800] };
  const corners: [number, number, number][] = [];
  for (const x of [b.min[0], b.max[0]]) {
    for (const y of [b.min[1], b.max[1]]) {
      for (const z of [b.min[2], b.max[2]]) corners.push([x, y, z]);
    }
  }
  for (const aspect of [1.6, 0.6]) {
    const cam = new OrbitCamera();
    cam.orbit(2.1, 0.4);
    cam.dolly(9);
    cam.pan(300, -200, 800);
    cam.fit(b, aspect);
    check(`fit(${aspect}) targets the centre`,
      near(cam.target[0], 4000) && near(cam.target[1], 3000) && near(cam.target[2], 1400),
      JSON.stringify(cam.target));
    check(`fit(${aspect}) resets the default orientation`,
      cam.yaw === DEFAULT_YAW && cam.pitch === DEFAULT_PITCH);
    const vp = cam.viewProjection(aspect);
    check(`fit(${aspect}) frames all eight corners`,
      corners.every(c => inClip(vp, c)),
      JSON.stringify(corners.map(c => ndc(vp, c))));
  }
}

// ── the y-down convention: no mirroring ────────────────────────────────────
// Mesh y grows toward the bottom of the plan; clip y grows toward the top of
// the screen. Non-mirrored therefore means: larger document y projects to
// SMALLER clip-space y (lower on screen, as on the 2D canvas), and larger
// document x to larger clip-space x. This holds at any pitch in range; it is
// asserted looking near-straight-down and at the default 3/4 view.

{
  for (const pitch of [PITCH_MAX, DEFAULT_PITCH]) {
    const cam = new OrbitCamera();
    cam.target = [0, 0, 0];
    cam.distance = 10000;
    cam.yaw = DEFAULT_YAW;
    cam.pitch = pitch;
    const vp = cam.viewProjection(1);
    const south = ndc(vp, [0, 1000, 0]);   // larger document y: bottom of the plan
    const north = ndc(vp, [0, -1000, 0]);
    check(`pitch ${pitch}: larger document y projects to smaller clip y`,
      south.y < north.y, JSON.stringify({ south, north }));
    const east = ndc(vp, [1000, 0, 0]);
    const west = ndc(vp, [-1000, 0, 0]);
    check(`pitch ${pitch}: larger document x projects to larger clip x`,
      east.x > west.x, JSON.stringify({ east, west }));
  }

  // At the default view the camera sits document-south above the plan, so
  // height rises on screen.
  const cam = new OrbitCamera();
  cam.target = [0, 0, 0];
  cam.distance = 10000;
  const vp = cam.viewProjection(1);
  check("at the default view, +z projects above the ground point",
    ndc(vp, [0, 0, 1000]).y > ndc(vp, [0, 0, 0]).y);
}

console.log(failures === 0 ? "ALL MAT4 TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
