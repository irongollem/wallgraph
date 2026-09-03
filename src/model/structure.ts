// Load-bearing and guarding elements that are not walls: columns, beams and
// railings, as the document stores them.
//
// None of these enters the wall graph. A column stands free of the centerline
// graph even where it sits in a wall, a beam spans between whatever carries it,
// and a railing guards an edge without bounding a room. Each is a placed object
// carrying its own dimensions, like a stair or a vide: the drawing is derived
// (core/structure.ts, render/structure.ts) from the figures here.
//
// The section plane is what separates the three on a plan. A column is cut by
// it and drawn with poché; a railing stands below it and is drawn in outline;
// a beam runs above it and is drawn dashed. See CUT_PLANE_MM.
import type { Id, WallMaterial } from "./doc";

export type StructureKind = "column" | "beam" | "railing";

export const STRUCTURE_KINDS: readonly StructureKind[] = ["column", "beam", "railing"];

/**
 * Height of the conventional horizontal section plane above the finished
 * floor, mm. A wall or column whose stated height is at or below it is not cut
 * by the plan and is drawn in outline rather than with poché: a borstwering, a
 * kniemuur, a plinth. Openings are unaffected — a wall that low carries none.
 */
export const CUT_PLANE_MM = 1200;

/** A wall whose stated height stays below the section plane. */
export const belowCutPlane = (o: { height?: number }): boolean =>
  o.height !== undefined && o.height <= CUT_PLANE_MM;

/**
 * A column's section in plan. "h" is a rolled H- or I-profile: the flanges
 * run along the column's local x, so `width` is the flange breadth and
 * `depth` the profile height, the way a steel table lists b and h.
 */
export type ColumnShape = "rect" | "round" | "h";

export const COLUMN_SHAPES: readonly ColumnShape[] = ["rect", "round", "h"];

interface StructuralBase {
  id: Id;
  /** Designation written on the drawing — "HEA 200", "K1". Absent means none. */
  label?: string;
  /** Pen colour "#rrggbb"; absent means the plan's default ink. */
  color?: string;
  /**
   * What it is built of. Absent means not stated, the same tri-state fact a
   * wall's material carries, and draws as masonry either way.
   */
  material?: WallMaterial;
}

export interface Column extends StructuralBase {
  kind: "column";
  /** Centre of the section in world mm. Integer. */
  x: number;
  y: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  shape: ColumnShape;
  /** Along local x, mm. A round column's diameter. */
  width: number;
  /** Along local y, mm. Read as `width` for a round column. */
  depth: number;
  /**
   * Height above this storey's floor the column stops at, mm. Absent means
   * the storey height: a column carries the floor above unless it states
   * otherwise. A column under a vide's edge beam, or a plinth, states its own.
   */
  height?: number;
}

/**
 * A beam between two free points in world mm. The endpoints are integer
 * coordinates of its own rather than graph nodes: a beam spans between whatever
 * supports it, and moving a wall does not move a beam that happens to rest on
 * it.
 */
export interface Beam extends StructuralBase {
  kind: "beam";
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Breadth in plan, mm — a steel section's flange width. */
  width: number;
  /** Section height, mm, vertical. */
  depth: number;
  /**
   * Underside above this storey's floor, mm (OK balk). Absent means the beam
   * carries the floor above: its top is at the storey height.
   */
  bottomMm?: number;
}

/**
 * A railing (balustrade, leuning) along a free edge: a vide, a landing, a
 * stair. Drawn below the section plane, so in outline.
 */
export interface Railing extends StructuralBase {
  kind: "railing";
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Breadth in plan, mm — the handrail. */
  width: number;
  /** Height above the floor, mm. */
  height: number;
  /** Post (baluster) centres along the run, mm. 0 means no posts drawn. */
  postMm: number;
}

export type Structural = Column | Beam | Railing;

/** What the tool places next, for the two kinds set out between two clicks. */
export interface SpanSize { width: number; depth: number }

export interface ColumnSize { shape: ColumnShape; width: number; depth: number }

/** An ordinary square concrete column. */
export const COLUMN_DEFAULT: ColumnSize = { shape: "rect", width: 300, depth: 300 };
/** HEA 200, the section a ground-floor opening in a house is most often spanned with. */
export const BEAM_DEFAULT: SpanSize = { width: 200, depth: 190 };
export const BEAM_LABEL_DEFAULT = "HEA 200";
/** A 50 wide handrail at the Bouwbesluit's 1000 guarding height, posts at 1000 centres. */
export const RAILING_WIDTH_DEFAULT = 50;
export const RAILING_HEIGHT_DEFAULT = 1000;
export const RAILING_POST_DEFAULT = 1000;

/**
 * Rolled steel sections by their catalogue figures: flange breadth `width` and
 * profile height `depth`, mm. Picking one arms the tool's size and label; the
 * document stores the two figures and the designation, not the table row, so a
 * section edited afterwards is whatever its figures say.
 */
export interface SteelProfile { label: string; width: number; depth: number }

const series = (name: string, rows: readonly [number, number, number][]): SteelProfile[] =>
  rows.map(([size, depth, width]) => ({ label: `${name} ${size}`, width, depth }));

export const STEEL_PROFILES: readonly SteelProfile[] = [
  ...series("HEA", [
    [100, 96, 100], [120, 114, 120], [140, 133, 140], [160, 152, 160], [180, 171, 180],
    [200, 190, 200], [220, 210, 220], [240, 230, 240], [260, 250, 260], [280, 270, 280],
    [300, 290, 300],
  ]),
  ...series("HEB", [
    [100, 100, 100], [120, 120, 120], [140, 140, 140], [160, 160, 160], [180, 180, 180],
    [200, 200, 200], [220, 220, 220], [240, 240, 240], [260, 260, 260], [280, 280, 280],
    [300, 300, 300],
  ]),
  ...series("IPE", [
    [100, 100, 55], [120, 120, 64], [140, 140, 73], [160, 160, 82], [180, 180, 91],
    [200, 200, 100], [220, 220, 110], [240, 240, 120], [270, 270, 135], [300, 300, 150],
    [330, 330, 160], [360, 360, 170], [400, 400, 180],
  ]),
];

export const STRUCTURE_LIMITS = {
  /** A section side, mm: a 50 timber post up to a 2000 concrete pier. */
  section: { min: 50, max: 2000 },
  /** A beam's section height, mm. */
  beamDepth: { min: 50, max: 2000 },
  /** A handrail's breadth, mm. */
  railWidth: { min: 10, max: 300 },
  /** A railing's height, mm. */
  railHeight: { min: 100, max: 3000 },
  /** Post centres, mm; 0 means none. */
  post: { min: 0, max: 5000 },
  /** A stated height above the floor, mm. */
  height: { min: 50, max: 20000 },
} as const;

const clampInt = (n: number, lim: { min: number; max: number }): number =>
  Math.max(lim.min, Math.min(lim.max, Math.round(isFinite(n) ? n : lim.min)));

export function clampColumnSize(s: ColumnSize): ColumnSize {
  const width = clampInt(s.width, STRUCTURE_LIMITS.section);
  return {
    shape: s.shape,
    width,
    depth: s.shape === "round" ? width : clampInt(s.depth, STRUCTURE_LIMITS.section),
  };
}

export function clampBeamSize(s: SpanSize): SpanSize {
  return {
    width: clampInt(s.width, STRUCTURE_LIMITS.section),
    depth: clampInt(s.depth, STRUCTURE_LIMITS.beamDepth),
  };
}

export const clampRailWidth = (n: number): number => clampInt(n, STRUCTURE_LIMITS.railWidth);
export const clampRailHeight = (n: number): number => clampInt(n, STRUCTURE_LIMITS.railHeight);
export const clampPostMm = (n: number): number => clampInt(n, STRUCTURE_LIMITS.post);
export const clampStructureHeight = (n: number): number => clampInt(n, STRUCTURE_LIMITS.height);

/** The shortest run a beam or railing can be set out at, mm. */
export const SPAN_MIN_MM = 100;

/** Translate in place by whole millimetres: a column's centre, a span's two ends. */
export function moveStructure(el: Structural, dx: number, dy: number): void {
  if (el.kind === "column") { el.x += dx; el.y += dy; return; }
  el.a.x += dx; el.a.y += dy;
  el.b.x += dx; el.b.y += dy;
}
