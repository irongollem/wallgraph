// The pattern figures are TS constants that generate the GLSL; the shader
// source is read back to confirm both agree and every pattern has a branch.
import { PATTERN_IDS } from "../src/model/appearance";
import { TRI_FS } from "../src/render3d/gl";
import {
  BLOCK, BRICK, CONCRETE_NOISE_MM, PANEL, PATTERN_GLSL, PLASTER_NOISE_MM, SHADED_PATTERNS, TILE, TILE_SHADOW_MM, TILE_VARIATION, TIMBER_BOARD_MM,
} from "../src/render3d/patterns";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const num = (name: string): number | null => {
  const m = new RegExp(`const float ${name} = ([0-9.]+);`).exec(TRI_FS);
  return m ? Number(m[1]) : null;
};

check("TRI_FS carries the pattern source", TRI_FS.includes(PATTERN_GLSL));

PATTERN_IDS.forEach((id, i) => {
  const m = new RegExp(`const int P_${id.toUpperCase()} = (\\d+);`).exec(TRI_FS);
  check(`index of ${id} matches PATTERN_IDS`, m !== null && Number(m[1]) === i);
});

for (const id of PATTERN_IDS) {
  if (id === "none" || id === "steel") continue;
  check(`${id} has a shader branch`, TRI_FS.includes(`id == P_${id.toUpperCase()}`));
  check(`${id} is listed as shaded`, SHADED_PATTERNS.includes(id));
}
check("steel and none have no branch", !TRI_FS.includes("P_STEEL)") && !TRI_FS.includes("P_NONE)"));

for (const [name, u] of [["BRICK", BRICK], ["BLOCK", BLOCK], ["TILE", TILE]] as const) {
  check(`${name} width`, num(`${name}_W`) === u.w);
  check(`${name} height`, num(`${name}_H`) === u.h);
  check(`${name} joint`, num(`${name}_JOINT`) === u.joint);
}
check("brick figures", BRICK.w === 210 && BRICK.h === 50 && BRICK.joint === 12);
check("block figures", BLOCK.w === 440 && BLOCK.h === 290 && BLOCK.joint === 3);
check("timber board", num("TIMBER_BOARD") === TIMBER_BOARD_MM && TIMBER_BOARD_MM === 150);
check("panel rib and micro-profile",
  num("PANEL_RIB") === PANEL.ribMm && num("PANEL_MICRO") === PANEL.microMm && PANEL.ribMm === 1000 && PANEL.microMm === 100);
check("tile course and width", TILE.h === 300 && TILE.w === 200);
check("tile shadow band and tone variation",
  num("TILE_SHADOW") === TILE_SHADOW_MM && num("TILE_VARIATION") === TILE_VARIATION && TILE_VARIATION < 0.06
  && TRI_FS.includes("float tileTone"));
check("noise scales", num("CONCRETE_NOISE") === CONCRETE_NOISE_MM && num("PLASTER_NOISE") === PLASTER_NOISE_MM);
check("joints are anti-aliased with fwidth", TRI_FS.includes("fwidth(uv.x)") && TRI_FS.includes("jointCover"));
check("pattern multiplies the vertex colour", /albedo \*= patternTone/.test(TRI_FS) && /vec3 albedo = vColor/.test(TRI_FS));
check("frame is built from the z-up cross product", TRI_FS.includes("cross(vec3(0.0, 0.0, 1.0), n)"));

if (failures > 0) { console.error(`${failures} FAILED`); process.exit(1); }
console.log("ALL PATTERN TESTS PASSED");
