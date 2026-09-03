// Derived structure geometry. Nothing here is stored: a column's outline, a
// beam's quad, where a railing's posts fall and where each label sits all
// follow from the figures in model/structure.ts.
//
// A beam and a railing are set out between two points but handled as a placed
// box like everything else: the box is the run's length by its breadth, placed
// at the midpoint and turned to the run's direction. One frame for the hit
// test, the marquee, the framing and the exports.
import { Floor, floorHeight } from "../model/doc";
import { Structural, Column, Beam, Railing, ColumnShape } from "../model/structure";
import { Vec, v, sub, add, scale, norm, perp, dist, angleOf, mid } from "../geometry/vec";
import { boxCorners, boxHit, worldPoint, type LocalBox, type Placed } from "./placed";

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
