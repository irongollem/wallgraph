// How a part of the building looks in 3D: colour, surface roughness and a
// pattern. A built-in table answers from what the plan already states (a wall's
// material, a board's kind); an optional authored override per element replaces
// the colour and the pattern. Separate from the `color` pen fields, which
// belong to the 2D drawing.
import type { BoardKind, Id, PlanDoc, WallMaterial } from "./doc";

export type Rgb = readonly [number, number, number];

export type PatternId = "none" | "brick" | "block" | "concrete" | "timber" | "panel" | "tile" | "plaster" | "steel";

export const PATTERN_IDS: readonly PatternId[] =
  ["none", "brick", "block", "concrete", "timber", "panel", "tile", "plaster", "steel"];

/** What a fit-out part is made of; core/furnishing3d.ts states it per part. */
export type FitoutMaterial = "casework" | "worktop" | "appliance" | "sanitary" | "soft";

export const FITOUT_MATERIALS: readonly FitoutMaterial[] = ["casework", "worktop", "appliance", "sanitary", "soft"];

/** Authored per element; absent fields fall back to the table. */
export interface AppearanceOverride {
  /** "#rrggbb"; anything else is ignored. */
  color?: string;
  pattern?: PatternId;
  /** A plan texture (`PlanDoc.textures`). It replaces the pattern and is not
   *  tinted; naming a texture the plan no longer holds leaves colour and
   *  pattern standing. */
  texture?: Id;
}

/** An image the user loaded, tiled over a surface at its real size. */
export interface Texture {
  id: Id;
  name: string;
  /** JPEG data URL, at most TEXTURE_MAX_EDGE px on the long side. */
  dataUrl: string;
  /** Real-world size one image covers, integer mm > 0. */
  widthMm: number;
  heightMm: number;
}

/** Longest edge of a stored texture, px. */
export const TEXTURE_MAX_EDGE = 512;
/** Textures the renderer holds at once; a plan may store more, the rest render by pattern. */
export const TEXTURE_LIMIT = 32;
/** Real size assumed for a new texture: a Dutch waalformaat brick face, mm. */
export const TEXTURE_DEFAULT_MM = { widthMm: 215, heightMm: 65 } as const;

export const texturesOf = (d: PlanDoc): readonly Texture[] => d.textures ?? [];
export const textureById = (d: PlanDoc, id: Id | undefined): Texture | undefined =>
  id === undefined ? undefined : texturesOf(d).find(x => x.id === id);

export interface Appearance {
  color: Rgb;
  /** 0 (mirror) to 1 (fully matte). */
  roughness: number;
  pattern: PatternId;
  /** The override's texture id, unchecked; the consumer looks it up and falls
   *  back to colour and pattern when it is not held. */
  texture?: Id;
}

/** The parts a mesh vertex can belong to, as keys of the default table. */
export type AppearanceKey =
  | { part: "wall"; material?: WallMaterial }
  | { part: "facade" }
  | { part: "board"; kind: BoardKind }
  | { part: "frame"; material: "timber" | "steel" }
  | { part: "fitout"; material: FitoutMaterial }
  | { part: "post" | "junction" | "casing" | "slab" | "terrace" | "roof" | "stair" | "deck" | "structure" | "door" | "glass" };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Wall prisms: light warm grey, reading against the #f4f2ec canvas ground. */
export const WALL_COLOR: Rgb = [0.93, 0.92, 0.9];
/** Slab prisms: a step darker than the walls they carry. */
export const SLAB_COLOR: Rgb = [0.8, 0.79, 0.77];
/** Roof plane slabs: dark tile. */
export const ROOF_COLOR: Rgb = [0.4, 0.32, 0.3];
/** Stair steps: muted warm tone. */
export const STAIR_COLOR: Rgb = [0.85, 0.8, 0.72];
/** Door leaves: timber, told from wall and stair at a glance. */
export const DOOR_COLOR: Rgb = [0.78, 0.71, 0.6];
/** Window panes and glazed wall bodies: the cool wash the 2D glassFill uses. */
export const GLASS_COLOR: Rgb = [0.875, 0.91, 0.933];
/** Sandwich-panel wall bodies: the 2D panelFill's warm band. */
export const PANEL_COLOR: Rgb = [0.906, 0.882, 0.827];
/** A face's board stack: pale plasterboard. */
export const BOARD_COLOR: Rgb = [0.88, 0.85, 0.78];
/** A voorzetwand's own stud zone: a darker timber tone than a door leaf. */
export const FRAME_COLOR: Rgb = [0.65, 0.55, 0.42];
/** A facade skin: a neutral brick tone. */
export const FACADE_COLOR: Rgb = [0.72, 0.5, 0.42];
/** Steel structure: a cool mid grey. */
export const STEEL_COLOR: Rgb = [0.62, 0.64, 0.67];
/** Fit-out casework: cabinet carcasses, fronts, table tops, shelving. */
export const CASEWORK_COLOR: Rgb = [0.74, 0.65, 0.52];
/** The blad over a run: darker than the casework it rests on. */
export const WORKTOP_COLOR: Rgb = [0.42, 0.41, 0.4];
/** A fixed appliance: darker than STEEL_COLOR. */
export const APPLIANCE_COLOR: Rgb = [0.52, 0.55, 0.58];
/** Sanitary fixtures: porcelain, the lightest thing in the scene. */
export const SANITARY_COLOR: Rgb = [0.97, 0.97, 0.96];
/** Mattresses and upholstery. */
export const SOFT_COLOR: Rgb = [0.68, 0.7, 0.74];

const BRICK_COLOR: Rgb = [0.7, 0.4, 0.32];
const CALCIUM_SILICATE_COLOR: Rgb = [0.95, 0.94, 0.91];
const AERATED_COLOR: Rgb = [0.84, 0.84, 0.83];
const CONCRETE_COLOR: Rgb = [0.66, 0.66, 0.65];
const TIMBER_COLOR: Rgb = [0.72, 0.56, 0.38];
const PLASTER_COLOR: Rgb = [0.94, 0.93, 0.9];
const OSB_COLOR: Rgb = [0.75, 0.6, 0.38];
const PLYWOOD_COLOR: Rgb = [0.8, 0.66, 0.45];
const CEMENT_BOARD_COLOR: Rgb = [0.62, 0.62, 0.6];

const ap = (color: Rgb, roughness: number, pattern: PatternId): Appearance => ({ color, roughness, pattern });

/** Wall body by material. A wall stating none keeps the neutral tone with no
 *  pattern: a brick look there would claim a fact the plan does not state. */
const WALL_TABLE: Record<WallMaterial, Appearance> = {
  masonry: ap(BRICK_COLOR, 0.9, "brick"),
  calciumsilicate: ap(CALCIUM_SILICATE_COLOR, 0.9, "block"),
  aerated: ap(AERATED_COLOR, 0.9, "block"),
  concrete: ap(CONCRETE_COLOR, 0.9, "concrete"),
  timber: ap(TIMBER_COLOR, 0.6, "timber"),
  steel: ap(STEEL_COLOR, 0.35, "steel"),
  sandwich: ap(PANEL_COLOR, 0.9, "panel"),
  glass: ap(GLASS_COLOR, 0.2, "none"),
};
const WALL_UNSTATED = ap(WALL_COLOR, 0.9, "none");

const BOARD_TABLE: Record<BoardKind, Appearance> = {
  gypsum: ap(PLASTER_COLOR, 0.9, "plaster"),
  gypsumFibre: ap(PLASTER_COLOR, 0.9, "plaster"),
  osb: ap(OSB_COLOR, 0.6, "timber"),
  plywood: ap(PLYWOOD_COLOR, 0.6, "timber"),
  cement: ap(CEMENT_BOARD_COLOR, 0.9, "none"),
};

const FRAME_TABLE: Record<"timber" | "steel", Appearance> = {
  timber: ap(FRAME_COLOR, 0.6, "timber"),
  steel: ap(STEEL_COLOR, 0.35, "steel"),
};

const FITOUT_TABLE: Record<FitoutMaterial, Appearance> = {
  casework: ap(CASEWORK_COLOR, 0.6, "none"),
  worktop: ap(WORKTOP_COLOR, 0.5, "none"),
  appliance: ap(APPLIANCE_COLOR, 0.5, "none"),
  sanitary: ap(SANITARY_COLOR, 0.3, "none"),
  soft: ap(SOFT_COLOR, 0.9, "none"),
};

/** The built-in look of a part. Figures are this repository's own choices. */
export function defaultAppearance(key: AppearanceKey): Appearance {
  let a: Appearance;
  switch (key.part) {
    case "wall": a = key.material ? WALL_TABLE[key.material] : WALL_UNSTATED; break;
    case "board": a = BOARD_TABLE[key.kind]; break;
    case "frame": a = FRAME_TABLE[key.material]; break;
    case "fitout": a = FITOUT_TABLE[key.material]; break;
    case "facade": a = ap(FACADE_COLOR, 0.9, "brick"); break;
    case "post": case "junction": case "structure": a = WALL_UNSTATED; break;
    case "casing": a = BOARD_TABLE.gypsum; break;
    case "slab": case "terrace": a = ap(SLAB_COLOR, 0.9, "concrete"); break;
    case "roof": a = ap(ROOF_COLOR, 0.8, "tile"); break;
    case "stair": a = ap(STAIR_COLOR, 0.6, "timber"); break;
    case "deck": a = ap(DOOR_COLOR, 0.6, "timber"); break;
    case "door": a = ap(DOOR_COLOR, 0.6, "timber"); break;
    case "glass": a = ap(GLASS_COLOR, 0.2, "none"); break;
  }
  return { color: a.color, roughness: a.roughness, pattern: a.pattern };
}

/** "#rrggbb" to 0..1 channels; null for anything that is not that form. */
export function parseHexColor(hex: string | undefined): Rgb | null {
  if (hex === undefined || !HEX.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** The table entry with the override's colour and pattern applied. A malformed
 *  colour or an unknown pattern is ignored, the table's value standing. */
export function resolveAppearance(key: AppearanceKey, override?: AppearanceOverride): Appearance {
  const base = defaultAppearance(key);
  if (!override) return base;
  const color = parseHexColor(override.color) ?? base.color;
  const pattern = override.pattern !== undefined && PATTERN_IDS.includes(override.pattern) ? override.pattern : base.pattern;
  return {
    color, roughness: base.roughness, pattern,
    ...(typeof override.texture === "string" && override.texture !== "" ? { texture: override.texture } : {}),
  };
}

/** Every element that carries an `AppearanceOverride`, on every storey. */
function appearanceHolders(doc: PlanDoc): Array<{ [k: string]: unknown }> {
  const out: Array<{ [k: string]: unknown }> = [];
  for (const f of doc.floors) {
    for (const w of f.walls) {
      out.push(w as never);
      for (const side of [w.buildUp?.left, w.buildUp?.right]) if (side) out.push(side as never);
      for (const o of w.openings) out.push(o as never);
    }
    for (const list of [f.roofPlanes, f.furnishings, f.stairs, f.structure, f.decks]) {
      for (const e of list ?? []) out.push(e as never);
    }
  }
  return out;
}

/** Deletes texture `id` and every override naming it, in one pass. An
 *  override left with no field is removed. Mutate through `store.mutate()`. */
export function removeTexture(doc: PlanDoc, id: Id): void {
  for (const holder of appearanceHolders(doc)) {
    for (const field of ["appearance", "facadeAppearance"]) {
      const ov = holder[field] as AppearanceOverride | undefined;
      if (!ov || ov.texture !== id) continue;
      delete ov.texture;
      if (ov.color === undefined && ov.pattern === undefined) delete holder[field];
    }
  }
  doc.textures = texturesOf(doc).filter(x => x.id !== id);
  if (doc.textures.length === 0) delete doc.textures;
}
