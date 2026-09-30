// The sun direction and the light projection fitted to the building.
import { sunDirection, lightProjection } from "../src/render3d/sun";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
const near = (a: number, b: number, t = 1e-9): boolean => Math.abs(a - b) <= t;

{
  const [x, y, z] = sunDirection(0);
  check("north up puts the 225 degree sun toward the lower left of the screen", x < 0 && y > 0, `${x},${y}`);
  check("the sun is above the horizon", z > 0);
  check("absent north reads as 0", sunDirection(undefined).every((c, i) => near(c, [x, y, z][i]!)));
  check("the vector is unit length", near(Math.hypot(x, y, z), 1));
  check("altitude is the elevation angle", near(Math.asin(z) * 180 / Math.PI, 35));
}
{
  // 225 + 90 = 315: north-west, the upper left of the screen.
  const [x, y] = sunDirection(90);
  check("north 90 rotates the sun a quarter turn clockwise", x < 0 && y < 0, `${x},${y}`);
  const [ux, uy] = sunDirection(0, 0, 0);
  check("bearing 0 points at screen-up", near(ux, 0) && near(uy, -1));
  const [rx, ry] = sunDirection(0, 90, 0);
  check("bearing 90 points at screen-right", near(rx, 1) && near(ry, 0));
  for (const n of [0, 45, 90, 200, -30]) check(`unit length at north ${n}`, near(Math.hypot(...sunDirection(n, 225, 50)), 1));
}
{
  const b = { min: [0, 0, 0] as [number, number, number], max: [8000, 5000, 6000] as [number, number, number] };
  const sun = sunDirection(30);
  const lp = lightProjection(b, sun);
  let inside = true;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
    const m = lp.matrix;
    for (let r = 0; r < 3; r++) {
      const c = m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!;
      if (c < -1 || c > 1) inside = false;
    }
  }
  check("every bounding-box corner lies inside the light frustum", inside);
  check("the light frustum has a positive depth range", lp.depthMm > 0 && lp.texelMm(2048) > 0);
}

if (failures > 0) { console.error(`${failures} FAILED`); process.exit(1); }
console.log("ALL SUN TESTS PASSED");
