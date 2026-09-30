// Procedural surface patterns for the 3D fragment shader. The figures are
// this repository's own, in millimetres of the world; the GLSL below is
// generated from them so the two cannot disagree. Pattern indices follow
// PATTERN_IDS, which is also what the mesh carries per vertex.
import { PATTERN_IDS, type PatternId } from "../model/appearance";

/** A running-bond unit of `w` x `h` mm with a joint of `joint` mm. */
export interface UnitFigure { w: number; h: number; joint: number }

export const BRICK: UnitFigure = { w: 210, h: 50, joint: 12 };
export const BLOCK: UnitFigure = { w: 440, h: 290, joint: 3 };
export const TILE: UnitFigure = { w: 200, h: 300, joint: 8 };
/** Roof tile courses: a shadow band of `TILE_SHADOW_MM` under each course's lower edge where the course above overlaps it. */
export const TILE_SHADOW_MM = 30;
export const TILE_SHADOW_TONE = 0.7;
/** Vertical joints between tiles are fainter than a bonded unit's. */
export const TILE_JOINT_TONE = 0.93;
export const TILE_VARIATION = 0.025;
/** Timber board width across the face; the grain runs along u. */
export const TIMBER_BOARD_MM = 150;
/** Sandwich panel: a rib every `ribMm`, a micro-profile every `microMm`. */
export const PANEL = { ribMm: 1000, microMm: 100 };
/** Feature size of the value noise, in mm. */
export const CONCRETE_NOISE_MM = 900;
export const PLASTER_NOISE_MM = 25;
/** Share of the unit tone a per-unit hash may move. */
export const UNIT_VARIATION = 0.06;
/** Tone multiplier inside a joint. */
export const JOINT_TONE = 0.62;

/** Patterns with a shader branch; "none" and "steel" leave the colour alone. */
export const SHADED_PATTERNS: readonly PatternId[] =
  ["brick", "block", "concrete", "timber", "panel", "tile", "plaster"];

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

const unitConsts = (name: string, u: UnitFigure): string =>
  `const float ${name}_W = ${f(u.w)};\nconst float ${name}_H = ${f(u.h)};\nconst float ${name}_JOINT = ${f(u.joint)};`;

const indexConsts = PATTERN_IDS
  .map((id, i) => `const int P_${id.toUpperCase()} = ${i};`).join("\n");

/** GLSL spliced into TRI_FS after its declarations and before main(). */
export const PATTERN_GLSL = `${indexConsts}
${unitConsts("BRICK", BRICK)}
${unitConsts("BLOCK", BLOCK)}
${unitConsts("TILE", TILE)}
const float TIMBER_BOARD = ${f(TIMBER_BOARD_MM)};
const float PANEL_RIB = ${f(PANEL.ribMm)};
const float PANEL_MICRO = ${f(PANEL.microMm)};
const float CONCRETE_NOISE = ${f(CONCRETE_NOISE_MM)};
const float PLASTER_NOISE = ${f(PLASTER_NOISE_MM)};
const float TILE_SHADOW = ${f(TILE_SHADOW_MM)};
const float TILE_SHADOW_TONE = ${f(TILE_SHADOW_TONE)};
const float TILE_JOINT_TONE = ${f(TILE_JOINT_TONE)};
const float TILE_VARIATION = ${f(TILE_VARIATION)};
const float UNIT_VARIATION = ${f(UNIT_VARIATION)};
const float JOINT_TONE = ${f(JOINT_TONE)};
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), w.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), w.x), w.y);
}
// Fraction of a pixel-wide filter [x - w/2, x + w/2] inside the joint that
// starts each period at 0 and is j wide; past a pixel the joint's average.
float jointCover(float x, float period, float j, float w) {
  float sharp = 1.0 - smoothstep(j - 0.5 * w, j + 0.5 * w, x);
  return mix(sharp, j / period, clamp(w / j - 0.5, 0.0, 1.0));
}
// Running bond: rows of w x h units, every other row shifted half a unit.
float bondTone(vec2 uv, float w, float h, float j, float fw) {
  float row = floor(uv.y / h);
  float cu = uv.x + mod(row, 2.0) * 0.5 * w;
  float cover = jointCover(mod(cu, w), w, j, fw);
  float coverV = jointCover(mod(uv.y, h), h, j, fw);
  float joint = 1.0 - (1.0 - cover) * (1.0 - coverV);
  float vary = 1.0 + UNIT_VARIATION * (hash21(vec2(floor(cu / w), row)) * 2.0 - 1.0)
                     * (1.0 - smoothstep(0.5, 1.5, fw / h));
  return mix(1.0, JOINT_TONE, joint) * vary;
}
// Roof tiles: courses of h with a running-bond vertical joint, a shadow band
// along each course's lower edge and a small per-tile tone change.
float tileTone(vec2 uv, float fw) {
  float row = floor(uv.y / TILE_H);
  float cu = uv.x + mod(row, 2.0) * 0.5 * TILE_W;
  float joint = jointCover(mod(cu, TILE_W), TILE_W, TILE_JOINT, fw);
  float shadow = jointCover(mod(uv.y, TILE_H), TILE_H, TILE_SHADOW, fw);
  float vary = 1.0 + TILE_VARIATION * (hash21(vec2(floor(cu / TILE_W), row)) * 2.0 - 1.0)
                     * (1.0 - smoothstep(0.5, 1.5, fw / TILE_H));
  return mix(1.0, TILE_JOINT_TONE, joint) * mix(1.0, TILE_SHADOW_TONE, shadow) * vary;
}
float noiseTone(vec2 uv, float cell, float amp, float fw) {
  float a = amp * (1.0 - smoothstep(0.5, 1.5, fw / cell));
  return 1.0 + a * (vnoise(uv / cell) * 2.0 - 1.0);
}
float timberTone(vec2 uv, float fw) {
  float board = floor(uv.y / TIMBER_BOARD);
  float seam = jointCover(mod(uv.y, TIMBER_BOARD), TIMBER_BOARD, 3.0, fw);
  // Grain: noise stretched along u, offset per board.
  float g = vnoise(vec2(uv.x / 500.0 + board * 7.3, uv.y / 5.0));
  float grain = 1.0 + 0.07 * (g * 2.0 - 1.0) * (1.0 - smoothstep(2.0, 6.0, fw));
  float vary = 1.0 + UNIT_VARIATION * (hash21(vec2(board, 3.0)) * 2.0 - 1.0)
                     * (1.0 - smoothstep(0.5, 1.5, fw / TIMBER_BOARD));
  return mix(1.0, JOINT_TONE, seam) * grain * vary;
}
float panelTone(vec2 uv, float fw) {
  float rib = jointCover(mod(uv.x, PANEL_RIB), PANEL_RIB, 20.0, fw);
  float micro = 0.5 + 0.5 * sin(6.2831853 * uv.x / PANEL_MICRO);
  float m = 1.0 - 0.05 * micro * (1.0 - smoothstep(0.2, 0.5, fw / PANEL_MICRO));
  return mix(1.0, JOINT_TONE, rib) * mix(m, 0.975, smoothstep(0.2, 0.5, fw / PANEL_MICRO));
}
// Tone multiplier for pattern index \`id\` at (u, v) mm; 1.0 leaves the colour.
float patternTone(int id, vec2 uv, float fw) {
  if (id == P_BRICK) return bondTone(uv, BRICK_W, BRICK_H, BRICK_JOINT, fw);
  if (id == P_BLOCK) return bondTone(uv, BLOCK_W, BLOCK_H, BLOCK_JOINT, fw);
  if (id == P_TILE) return tileTone(uv, fw);
  if (id == P_CONCRETE) return noiseTone(uv, CONCRETE_NOISE, 0.03, fw) * noiseTone(uv, CONCRETE_NOISE * 0.15, 0.012, fw);
  if (id == P_TIMBER) return timberTone(uv, fw);
  if (id == P_PANEL) return panelTone(uv, fw);
  if (id == P_PLASTER) return noiseTone(uv, PLASTER_NOISE, 0.025, fw);
  return 1.0;
}
// Surface frame from the face normal, in mesh space (y down, z up): t runs
// horizontally along a vertical face and along the eave of a pitched one,
// b runs up the face. Horizontal faces take t = +x.
vec2 surfaceUV(vec3 n, vec3 p) {
  vec3 t = (n.z > 0.99 || n.z < -0.99) ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 0.0, 1.0), n));
  vec3 b = cross(n, t);
  return vec2(dot(p, t), dot(p, b));
}`;
