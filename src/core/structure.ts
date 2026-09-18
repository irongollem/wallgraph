// Derived structure geometry. Nothing here is stored: a column's outline, a
// beam's quad, where a railing's posts fall and where each label sits all
// follow from the figures in model/structure.ts.
//
// A beam and a railing are set out between two points but handled as a placed
// box like everything else: the box is the run's length by its breadth, placed
// at the midpoint and turned to the run's direction. One frame for the hit
// test, the marquee, the framing and the exports.
import { Floor, floorHeight, type BoardKind } from "../model/doc";
import { Structural, Column, Beam, Railing, ColumnShape } from "../model/structure";
import {
  Vec, v, sub, add, scale, norm, perp, dist, angleOf, mid, dot, cross, pointInPolygon, polygonCentroid,
} from "../geometry/vec";
import { boxCorners, boxHit, worldPoint, type LocalBox, type Placed } from "./placed";
import type { ResolvedWall } from "./resolve";

export type Span = Beam | Railing;

export const isSpan = (el: Structural): el is Span => el.kind !== "column";

/** Local bounds of a column: the anchor is the centre of the section. */
export function columnBox(c: Column): LocalBox {
  const depth = c.shape === "round" ? c.width : c.depth;
  return { x0: -c.width / 2, y0: -depth / 2, x1: c.width / 2, y1: depth / 2 };
}

/** The run's length, mm. */
export const spanLength = (s: Span): number => dist(s.a, s.b);

/** A span as a placed box: anchored at the midpoint, turned to the run. */
export function spanPlaced(s: Span): Placed {
  const m = mid(s.a, s.b);
  return { x: m.x, y: m.y, rotation: angleOf(sub(s.b, s.a)) };
}

/** Local bounds of a span: the run along x, the breadth across y. */
export function spanBox(s: Span): LocalBox {
  const half = spanLength(s) / 2;
  return { x0: -half, y0: -s.width / 2, x1: half, y1: s.width / 2 };
}

/**
 * The run's endpoints turned about its midpoint, rounded to whole mm. A
 * quarter turn on a span is a turn of the run itself, since its angle is not
 * stored but read off the ends.
 */
export function spanTurned(s: Span, radians: number): { a: Vec; b: Vec } {
  const m = mid(s.a, s.b);
  const turn = (p: Vec): Vec => {
    const d = sub(p, m);
    const c = Math.cos(radians), sn = Math.sin(radians);
    return v(Math.round(m.x + d.x * c - d.y * sn), Math.round(m.y + d.x * sn + d.y * c));
  };
  return { a: turn(s.a), b: turn(s.b) };
}

export const structurePlaced = (el: Structural): Placed =>
  el.kind === "column" ? el : spanPlaced(el);

export const structureBox = (el: Structural): LocalBox =>
  el.kind === "column" ? columnBox(el) : spanBox(el);

/** The element's four world corners, for framing and the marquee. */
export function structureCorners(el: Structural): Vec[] {
  return boxCorners(structurePlaced(el), structureBox(el));
}

export function structureHit(el: Structural, p: Vec, margin = 0): boolean {
  return boxHit(structurePlaced(el), structureBox(el), p, margin);
}

/** The run's footprint as a world quad, corners in traversal order. */
export function spanQuad(s: Span): Vec[] {
  const p = spanPlaced(s), b = spanBox(s);
  return [
    worldPoint(p, v(b.x0, b.y0)), worldPoint(p, v(b.x1, b.y0)),
    worldPoint(p, v(b.x1, b.y1)), worldPoint(p, v(b.x0, b.y1)),
  ];
}

/**
 * The drawn thickness of a rolled section's flange and web, mm, as a share of
 * its overall figures. A drawing convention rather than a catalogue value: the
 * document stores the section's breadth and height, and at plan scale the
 * difference between this and the table is under a line width.
 */
export const flangeMm = (depth: number): number => Math.max(4, Math.min(40, depth * 0.075));
export const webMm = (width: number): number => Math.max(3, Math.min(25, width * 0.05));

/**
 * A column's section in its own frame, clockwise on screen. A round column
 * is a 24-gon here; the canvas and the exports draw the true circle through
 * columnMark() and this serves the consumers that need a polygon — the IFC
 * body and the 3D mesh.
 */
export function columnProfile(shape: ColumnShape, width: number, depth: number): Vec[] {
  const bx = width / 2;
  if (shape === "round") {
    const n = 24, out: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push(v(bx * Math.cos(a), bx * Math.sin(a)));
    }
    return out;
  }
  const by = depth / 2;
  if (shape === "rect") return [v(-bx, -by), v(bx, -by), v(bx, by), v(-bx, by)];
  const tf = flangeMm(depth), tw = webMm(width) / 2;
  return [
    v(-bx, -by), v(bx, -by), v(bx, -by + tf), v(tw, -by + tf),
    v(tw, by - tf), v(bx, by - tf), v(bx, by), v(-bx, by),
    v(-bx, by - tf), v(-tw, by - tf), v(-tw, -by + tf), v(-bx, -by + tf),
  ];
}

/** The section in world millimetres. */
export function columnOutline(c: Column): Vec[] {
  return columnProfile(c.shape, c.width, c.shape === "round" ? c.width : c.depth).map(p => worldPoint(c, p));
}

/** Where the column stops, mm above the floor. Absent means the storey. */
export const columnHeight = (f: Floor, c: Column): number => c.height ?? floorHeight(f);

/** A beam's underside and top, mm above the floor. Absent means it carries
 *  the floor above: the top at the storey height. */
export const beamBottom = (f: Floor, b: Beam): number => b.bottomMm ?? floorHeight(f) - b.depth;
export const beamTop = (f: Floor, b: Beam): number => beamBottom(f, b) + b.depth;

/**
 * Post centres along a railing, as world points. Set out from both ends so
 * the two end posts always stand: the run is divided into equal bays no wider
 * than `postMm`, the way a wall's frame is. Empty where the railing states
 * no posts.
 */
export function railingPosts(r: Railing): Vec[] {
  const L = spanLength(r);
  if (r.postMm <= 0 || L <= 0) return [];
  const bays = Math.max(1, Math.ceil(L / r.postMm));
  const out: Vec[] = [];
  for (let i = 0; i <= bays; i++) out.push(add(r.a, scale(sub(r.b, r.a), i / bays)));
  return out;
}

/** Height of the designation on the drawing, mm. */
export const STRUCTURE_LABEL_SIZE = 150;

/** Nominal glyph advance as a share of the text height, for clearance only. */
const LABEL_ADVANCE = 0.6;

/**
 * Where the designation is written, upright in world space. Beside a span,
 * on its clockwise side; under a column. The text stays upright whatever the
 * run's direction, so the clearance along the normal is the upright text
 * box's half-extent projected onto it: a vertical run clears half the text's
 * width, a horizontal one half its height. Nothing is written where no label
 * is stated, so the position is only asked for one that is.
 */
export function structureLabelAt(el: Structural): Vec {
  if (el.kind === "column") {
    const b = columnBox(el);
    const reach = Math.max(b.x1, b.y1);
    return v(el.x, el.y + reach + STRUCTURE_LABEL_SIZE * 0.8);
  }
  const m = mid(el.a, el.b);
  const n = perp(norm(sub(el.b, el.a)));
  const halfW = STRUCTURE_LABEL_SIZE * LABEL_ADVANCE * (el.label?.length ?? 0) / 2;
  const halfH = STRUCTURE_LABEL_SIZE / 2;
  const reach = Math.abs(n.x) * halfW + Math.abs(n.y) * halfH;
  return add(m, scale(n, el.width / 2 + reach + STRUCTURE_LABEL_SIZE * 0.3));
}

export interface StructureSolid {
  kind: Structural["kind"];
  poly: Vec[];
  z0: number;
  z1: number;
  material?: Structural["material"];
}

/**
 * Each element as a prism above the storey floor. A column stands on the
 * floor to its height; a beam hangs between its underside and its top; a
 * railing is one slab to its guarding height, posts included in the slab.
 */
export function structureSolid(f: Floor, el: Structural): StructureSolid {
  const material = el.material !== undefined ? { material: el.material } : {};
  if (el.kind === "column") return { kind: el.kind, poly: columnOutline(el), z0: 0, z1: columnHeight(f, el), ...material };
  if (el.kind === "beam") return { kind: el.kind, poly: spanQuad(el), z0: beamBottom(f, el), z1: beamTop(f, el), ...material };
  return { kind: el.kind, poly: spanQuad(el), z0: 0, z1: el.height, ...material };
}

export function structureSolids(f: Floor): StructureSolid[] {
  return (f.structure ?? []).map(el => structureSolid(f, el));
}

/**
 * A casing ring's own material -- the voorzetwand zone, or one of the boards
 * stacked on it (see Column.casing).
 */
export type CasingPart = "frame" | BoardKind;

/** One band of a column's casing, as a flat quad in world millimetres: one
 *  EXPOSED sub-segment of the column's own section, offset outward to that
 *  band's inner and outer depth. See columnCasingPieces() for how the bands
 *  are built, and columnExposedSegments() for what "exposed" means here. */
export interface CasingPiece { kind: CasingPart; poly: Vec[] }

/** Where segment p->p+d crosses segment a->b, as p's own parameter in [0,1];
 *  null when they do not cross within both segments (including parallel). */
function segSegIntersectT(p: Vec, d: Vec, a: Vec, b: Vec): number | null {
  const e = sub(b, a);
  const denom = cross(d, e);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(a, p), e) / denom;
  const u = cross(sub(a, p), d) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** One exposed sub-segment of a column's own outline, with the edge's own
 *  outward normal (see columnExposedSegments()). */
interface ExposedSegment { a: Vec; b: Vec; normal: Vec }

/**
 * The part of a column's own outline (world mm) that is not inside any
 * wall's structural body -- the single fact columnCasingPieces() (what gets
 * drawn, meshed and exported) and columnExposedPerimeterMm() (what a casing
 * costs) both read, so the two cannot disagree about which face is buried.
 * Each edge is split at its intersection parameters with every wall's
 * ResolvedWall.outline (sorted), and a sub-segment survives only when its
 * own midpoint falls outside every wall (pointInPolygon()). A column
 * standing clear of every wall keeps every edge whole, one segment per edge.
 */
function columnExposedSegments(c: Column, walls: readonly ResolvedWall[]): ExposedSegment[] {
  const outline = columnOutline(c);
  const n = outline.length;
  const centroid = polygonCentroid(outline);
  const out: ExposedSegment[] = [];
  for (let i = 0; i < n; i++) {
    const P = outline[i]!, Q = outline[(i + 1) % n]!;
    const d = sub(Q, P);
    let normal = perp(norm(d));
    if (dot(normal, sub(mid(P, Q), centroid)) < 0) normal = scale(normal, -1);
    const ts = new Set<number>([0, 1]);
    for (const w of walls) {
      const poly = w.outline;
      for (let j = 0; j < poly.length; j++) {
        const t = segSegIntersectT(P, d, poly[j]!, poly[(j + 1) % poly.length]!);
        if (t !== null) ts.add(t);
      }
    }
    const sorted = [...ts].sort((x, y) => x - y);
    for (let k = 0; k < sorted.length - 1; k++) {
      const t0 = sorted[k]!, t1 = sorted[k + 1]!;
      if (t1 - t0 < 1e-9) continue;
      const midPt = add(P, scale(d, (t0 + t1) / 2));
      if (walls.some(w => pointInPolygon(midPt, w.outline))) continue;
      out.push({ a: add(P, scale(d, t0)), b: add(P, scale(d, t1)), normal });
    }
  }
  return out;
}

/**
 * A column's casing, innermost first: the voorzetwand's own zone where
 * `frame` is stated, then each board in turn (Column.casing), each as one
 * quad per EXPOSED sub-segment of the column's own section
 * (columnExposedSegments()) -- offset outward by the band's own cumulative
 * depth, in world millimetres already (columnOutline() maps through
 * worldPoint(), so a placed casing turns and moves with its column exactly
 * like the section itself). A face buried in a wall gets no casing at all,
 * at any depth: the wall is what stands there. Empty where the column
 * carries no casing.
 *
 * Each exposed sub-segment is offset on its own rather than mitered at the
 * corners: the outer corner of a band is left with a small triangular gap
 * the width of its own depth, imperceptible at an ordinary casing depth
 * against an ordinary column section, and it is what keeps this from having
 * to solve a true polygon offset -- a mitered join would self-intersect in
 * the narrow web notch of an "h" column at a depth an ordinary
 * stud-and-board casing already reaches. See CLAUDE.md's known limitations.
 * A pure translation does not change a segment's own length, so every band's
 * pieces cover exactly the same run as the base exposed segments -- which is
 * what lets columnExposedPerimeterMm() below read the same segments rather
 * than re-deriving them from whatever columnCasingPieces() draws.
 */
export function columnCasingPieces(c: Column, walls: readonly ResolvedWall[]): CasingPiece[] {
  const casing = c.casing;
  if (!casing) return [];
  const segments = columnExposedSegments(c, walls);
  const out: CasingPiece[] = [];
  let depth = 0;
  const pushBand = (kind: CasingPart, mm: number): void => {
    if (mm <= 0) return;
    const from = depth, to = depth + mm;
    for (const seg of segments) {
      const poly = [
        add(seg.a, scale(seg.normal, from)), add(seg.b, scale(seg.normal, from)),
        add(seg.b, scale(seg.normal, to)), add(seg.a, scale(seg.normal, to)),
      ];
      out.push({ kind, poly });
    }
    depth = to;
  };
  if (casing.frame) pushBand("frame", casing.frame.depthMm);
  for (const board of casing.boards) pushBand(board.kind, board.mm);
  return out;
}

/**
 * What a casing actually costs (core/materials.ts): the sum of the exposed
 * sub-segments columnCasingPieces() draws every band from, mm. Reads
 * columnExposedSegments() directly rather than columnCasingPieces() itself,
 * since a casing may state boards with no frame or vice versa and the
 * exposed run is the same either way -- but it is the identical clip, so the
 * two can never disagree about which face is buried. A column standing
 * clear of every wall gets its whole perimeter.
 */
export function columnExposedPerimeterMm(c: Column, walls: readonly ResolvedWall[]): number {
  return columnExposedSegments(c, walls).reduce((sum, seg) => sum + dist(seg.a, seg.b), 0);
}
