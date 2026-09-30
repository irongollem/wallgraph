// The 3D renderer's shader sources: GLSL ES 3.00 only. There is no GL in node,
// so the sources are checked as text; importing gl.ts must not touch the DOM.
import { TRI_VS, TRI_FS, LINE_VS, LINE_FS, DEPTH_VS, DEPTH_FS } from "../src/render3d/gl";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const shaders: [string, string, boolean][] = [
  ["TRI_VS", TRI_VS, false], ["TRI_FS", TRI_FS, true],
  ["LINE_VS", LINE_VS, false], ["LINE_FS", LINE_FS, true],
  ["DEPTH_VS", DEPTH_VS, false], ["DEPTH_FS", DEPTH_FS, false],
];
for (const [name, src, fragment] of shaders) {
  check(`${name} starts with #version 300 es`, src.startsWith("#version 300 es"));
  check(`${name} has no attribute`, !/\battribute\b/.test(src));
  check(`${name} has no varying`, !/\bvarying\b/.test(src));
  check(`${name} has no gl_FragColor`, !src.includes("gl_FragColor"));
  if (fragment) check(`${name} declares an out vec4`, /\bout\s+vec4\s+\w+\s*;/.test(src));
}

check("TRI_FS uses roughness and a shadow comparison sampler",
  TRI_FS.includes("vSurface.x") && TRI_FS.includes("sampler2DShadow") && !TRI_FS.includes("abs("));

check("TRI_FS keeps its main and splices patterns before it",
  TRI_FS.indexOf("float patternTone") > 0 && TRI_FS.indexOf("float patternTone") < TRI_FS.indexOf("void main()"));
check("TRI_FS reads the pattern index", TRI_FS.includes("int(vSurface.y + 0.5)"));

if (failures > 0) { console.error(`${failures} FAILED`); process.exit(1); }
console.log("ALL GL SHADER TESTS PASSED");
