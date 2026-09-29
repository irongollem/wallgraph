// Per-material wall hatching (arcering). A material's mark is one or two
// families of parallel lines, generated as infinite lattices anchored to the
// world origin and clipped to a wall piece's own polygon at draw time.
//
// The figures below are this codebase's own choice, not a transcription of a
// published standard: they are picked to stay mutually distinguishable at
// plan scale and to read like the marks a Dutch bouwtekening uses, but they
// carry no claim of conformance to NEN or any other norm.
import { dot, fromAngle, perp, polygonArea, type Vec } from "../geometry/vec";
import { belowCutPlane } from "../model/structure";
import { WALL_MATERIALS, type Wall, type WallMaterial } from "../model/doc";

/** One family of parallel lines. */
export interface HatchLine {
  /** Direction in degrees CCW from +x in world space. */
  angleDeg: number;
  /** Perpendicular distance between adjacent lines, in mm. */
  spacingMm: number;
}

/** A material's mark: one family, or two crossed into a lattice. */
export interface HatchPattern {
  lines: readonly HatchLine[];
}

export interface HatchSeg { a: Vec; b: Vec }

const MASONRY_ANGLE_DEG = 45;
const MASONRY_SPACING_MM = 40;

const CONCRETE_ANGLE_A_DEG = 45;
const CONCRETE_ANGLE_B_DEG = 135;
const CONCRETE_SPACING_MM = 60;

const AERATED_ANGLE_DEG = 135;
const AERATED_SPACING_MM = 40;

const CALCIUMSILICATE_ANGLE_A_DEG = 0;
const CALCIUMSILICATE_ANGLE_B_DEG = 90;
const CALCIUMSILICATE_SPACING_MM = 60;

const TIMBER_ANGLE_DEG = 0;
const TIMBER_SPACING_MM = 30;

const STEEL_ANGLE_DEG = 90;
const STEEL_SPACING_MM = 25;

const SANDWICH_ANGLE_DEG = 0;
const SANDWICH_SPACING_MM = 50;

const PATTERNS: Record<WallMaterial, HatchPattern | null> = {
  masonry: { lines: [{ angleDeg: MASONRY_ANGLE_DEG, spacingMm: MASONRY_SPACING_MM }] },
  concrete: {
    lines: [
      { angleDeg: CONCRETE_ANGLE_A_DEG, spacingMm: CONCRETE_SPACING_MM },
      { angleDeg: CONCRETE_ANGLE_B_DEG, spacingMm: CONCRETE_SPACING_MM },
    ],
  },
  aerated: { lines: [{ angleDeg: AERATED_ANGLE_DEG, spacingMm: AERATED_SPACING_MM }] },
  calciumsilicate: {
    lines: [
      { angleDeg: CALCIUMSILICATE_ANGLE_A_DEG, spacingMm: CALCIUMSILICATE_SPACING_MM },
      { angleDeg: CALCIUMSILICATE_ANGLE_B_DEG, spacingMm: CALCIUMSILICATE_SPACING_MM },
    ],
  },
  timber: { lines: [{ angleDeg: TIMBER_ANGLE_DEG, spacingMm: TIMBER_SPACING_MM }] },
  steel: { lines: [{ angleDeg: STEEL_ANGLE_DEG, spacingMm: STEEL_SPACING_MM }] },
  sandwich: { lines: [{ angleDeg: SANDWICH_ANGLE_DEG, spacingMm: SANDWICH_SPACING_MM }] },
  glass: null,
};

/**
 * The pattern a material draws, or null where it carries none.
 *
 * An absent material draws the same body as `masonry`: `wallPen()`
 * (render/draw.ts) falls back to `MASONRY_PEN` whenever a wall states no
 * material and no colour, so an unstated body hatches the way it is already
 * drawn, not as an unmarked gap.
 */
export function hatchFor(m: WallMaterial | undefined): HatchPattern | null {
  return PATTERNS[m ?? "masonry"];
}

/**
 * The pattern a wall's body draws, or null where it takes none.
 *
 * Mirrors the two guards `wallPen()` applies before it paints poché, without
 * importing it: `hatch.ts` is meant to be imported BY the renderer, and
 * importing `wallPen` back from `draw.ts` here would cycle. Keep these two
 * checks in sync with `wallPen()` by hand.
 */
export function wallHatch(w: Pick<Wall, "material" | "color" | "height">): HatchPattern | null {
  // A wall stopping below the section plane is not cut, so it takes no poché
  // and no hatch either (see belowCutPlane() and wallPen()).
  if (belowCutPlane(w)) return null;
  // A wall stating its own colour is a statement in itself (typically red for
  // new work); hatching over it would be noise on top of that statement.
  // Duplicated from wallPen()'s HEX test rather than imported — see above.
  if (w.color && HEX.test(w.color)) return null;
  return hatchFor(w.material);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The body fill a wall takes where its hatch is drawn.
 *
 * A hatched wall is not also poché. The mark stands on paper -- which is how a
 * drawing shows a cut wall once it is large enough to hatch, and how the two
 * read on the sheets this set follows -- so the solid body would bury it: the
 * poché and the ink around it differ by a few percent of luminance, and lines
 * drawn in one over the other are invisible. An infill body (glass, a panel)
 * is already a light wash rather than poché and keeps its own fill.
 *
 * `paper` is passed rather than read from COLORS because the renderer imports
 * this module, so importing it back would cycle.
 */
export function hatchedFill(pen: { fill: string; infill: boolean }, paper: string): string {
  return pen.infill ? pen.fill : paper;
}

/** Tightest spacing in the table (steel). Used as the reference for
 *  `hatchVisible()` so every material's hatch appears at the same zoom
 *  instead of popping in one family at a time. */
const REFERENCE_SPACING_MM = STEEL_SPACING_MM;

/** Screen pixels the reference spacing must span before a hatch reads as
 *  lines rather than a smudge. Modelled on detailFor() in render/draw.ts. */
export const HATCH_VISIBLE_PX = 4;

/** Whether a hatch is legible at this zoom. `px` is millimetres per screen pixel. */
export function hatchVisible(px: number): boolean {
  if (!(px > 0) || !Number.isFinite(px)) return false;
  return REFERENCE_SPACING_MM / px >= HATCH_VISIBLE_PX;
}

/** Generous bound on the number of lines one family may need to cover a
 *  polygon's extent, the way gridSteps() bounds its own ladder at 24 rungs —
 *  a document with a pathological polygon (or a unit bug upstream) must not
 *  spend real time generating thousands of invisible lines. */
const MAX_LINES_PER_FAMILY = 2000;

/** Below this, a polygon is treated as degenerate (near-zero area, in mm²). */
const DEGENERATE_AREA_MM2 = 1e-6;

/** Below this length, a clipped span is treated as a ray grazing a vertex
 *  rather than a real span, and dropped. */
const MIN_SEGMENT_MM = 1e-6;

/**
 * Hatch segments clipped to one closed polygon, in world mm.
 *
 * Output coordinates are floats: this is derived render geometry, not
 * document data, so invariant 1 (integer mm) does not apply.
 *
 * Each family is an infinite lattice of lines perpendicular to a unit normal
 * `n`, at world-space offsets `k * spacingMm` along `n` for integer `k` —
 * anchored to the WORLD origin, not to this polygon's own bounding box. Two
 * pieces of the same wall split by an opening, or two abutting walls of the
 * same material, are hatched independently but read off the same lattice, so
 * their lines land on the same absolute positions and continue across the
 * seam instead of each piece starting its own phase.
 *
 * For each candidate line, every polygon edge is tested for a crossing using
 * the same even-odd rule pointInPolygon() uses on the y axis, generalised to
 * the family's own perpendicular: a vertex lying exactly on the line makes
 * one of the two adjoining edges register `> 0` and the other not, so it
 * crosses exactly once rather than twice or zero times. Crossings are sorted
 * by their position along the line and paired up as alternating inside/
 * outside spans, which is what makes this correct for a concave polygon
 * (a mitered wall piece with an opening can be concave) and not only for a
 * simple quad.
 */
export function hatchSegments(poly: readonly Vec[], pattern: HatchPattern): HatchSeg[] {
  if (poly.length < 3) return [];
  for (const p of poly) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return [];
  }
  const area = polygonArea([...poly]);
  if (!Number.isFinite(area) || Math.abs(area) < DEGENERATE_AREA_MM2) return [];

  const out: HatchSeg[] = [];
  for (const family of pattern.lines) {
    if (!(family.spacingMm > 0)) continue;
    const rad = (family.angleDeg * Math.PI) / 180;
    const dir = fromAngle(rad);
    const n = perp(dir);

    let minV = Infinity, maxV = -Infinity;
    for (const p of poly) {
      const proj = dot(p, n);
      if (proj < minV) minV = proj;
      if (proj > maxV) maxV = proj;
    }
    const kMin = Math.ceil(minV / family.spacingMm);
    const kMax = Math.floor(maxV / family.spacingMm);
    if (kMax < kMin) continue;
    if (kMax - kMin + 1 > MAX_LINES_PER_FAMILY) return [];

    for (let k = kMin; k <= kMax; k++) {
      const v0 = k * family.spacingMm;
      const crossings: number[] = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const pi = poly[i]!, pj = poly[j]!;
        const di = dot(pi, n) - v0;
        const dj = dot(pj, n) - v0;
        if ((di > 0) !== (dj > 0)) {
          const t = di / (di - dj);
          const ix = pi.x + (pj.x - pi.x) * t;
          const iy = pi.y + (pj.y - pi.y) * t;
          crossings.push(ix * dir.x + iy * dir.y);
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const u1 = crossings[i]!, u2 = crossings[i + 1]!;
        if (u2 - u1 < MIN_SEGMENT_MM) continue;
        out.push({
          a: { x: u1 * dir.x + v0 * n.x, y: u1 * dir.y + v0 * n.y },
          b: { x: u2 * dir.x + v0 * n.x, y: u2 * dir.y + v0 * n.y },
        });
      }
    }
  }
  return out;
}

/** What a junction wedge draws. See junctionHatch(). */
export interface JunctionHatch {
  /** True where every wall meeting here draws a hatch, so the wedge stands on
   *  paper with them rather than as poché between them. */
  paper: boolean;
  /** The pattern they all agree on, or null where they do not. */
  pattern: HatchPattern | null;
}

/**
 * What a junction wedge draws.
 *
 * A wedge belongs to no single wall, so it can only draw what its neighbours
 * agree on -- the rule junctionPen() already applies to the pen. Where every
 * wall meeting here states the same material, the wedge continues that hatch
 * and a mitered corner reads as one piece of material. Where they hatch
 * differently it takes the paper but no pattern, rather than claiming one of
 * their materials for a corner the document does not assign to either.
 */
export function junctionHatch(
  walls: readonly Pick<Wall, "material" | "color" | "height">[],
): JunctionHatch {
  if (walls.length === 0 || !walls.every(w => wallHatch(w))) {
    return { paper: false, pattern: null };
  }
  const first = walls[0]!.material ?? "masonry";
  const agreed = walls.every(w => (w.material ?? "masonry") === first);
  return { paper: true, pattern: agreed ? hatchFor(first) : null };
}

/** The materials on a storey that draw a hatch, in WALL_MATERIALS order. */
export function hatchLegend(walls: Iterable<Pick<Wall, "material" | "color" | "height">>): WallMaterial[] {
  const present = new Set<WallMaterial>();
  for (const w of walls) {
    if (wallHatch(w)) present.add(w.material ?? "masonry");
  }
  return WALL_MATERIALS.filter(m => present.has(m));
}
