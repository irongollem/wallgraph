// Derived cabinet geometry. Nothing here is stored: the carcass outline, where
// the front runs, the drawer divisions and the worktop overhang all follow from
// the anchor, the rotation and the stored dimensions.
import { Cabinet, cabinetHinge, cabinetDrawers } from "../model/cabinet";
import { Vec, v } from "../geometry/vec";
import { boxCorners, boxHit, worldPoint, type LocalBox } from "./placed";

/**
 * Local bounds. The anchor is the middle of the wall-touching edge with +y into
 * the room, so the box runs x in [-width/2, width/2] and y in [0, depth] — the
 * symbol library's wall-mounted footprint, shared deliberately.
 */
export function cabinetBox(c: Cabinet): LocalBox {
  return { x0: -c.width / 2, y0: 0, x1: c.width / 2, y1: c.depth };
}

export function cabinetCorners(c: Cabinet): Vec[] {
  return boxCorners(c, cabinetBox(c));
}

export function cabinetHit(c: Cabinet, p: Vec, margin = 0): boolean {
  return boxHit(c, cabinetBox(c), p, margin);
}

/** Thickness of the front panel, mm. Ordinary cabinet front stock. */
export const FRONT_THICKNESS = 20;

/** How far a worktop oversails the carcass front, mm. */
export const WORKTOP_OVERHANG = 20;

/**
 * The leg cut off each room-facing edge by a corner unit's diagonal front. Half
 * the smaller dimension puts a 636 mm door on a 900 square unit, which is the
 * size a diagonal corner unit is actually built to.
 */
export function cornerCut(c: Cabinet): number {
  return Math.min(c.width, c.depth) / 2;
}

/**
 * The carcass outline in the cabinet's own millimetres.
 *
 * A straight unit is the box. A corner unit fills the corner and has its
 * room-facing corner cut away by the diagonal front, which makes it a pentagon.
 * Which corner that is follows the handedness: unmirrored, the unit's other wall
 * is at -x, so the room-facing corner is at +x.
 */
export function cabinetOutline(c: Cabinet): Vec[] {
  const b = cabinetBox(c);
  if (!c.corner) {
    return [v(b.x0, b.y0), v(b.x1, b.y0), v(b.x1, b.y1), v(b.x0, b.y1)];
  }
  const cut = cornerCut(c);
  return [
    v(b.x0, b.y0), v(b.x1, b.y0),
    v(b.x1, b.y1 - cut), v(b.x1 - cut, b.y1),
    v(b.x0, b.y1),
  ];
}

/**
 * The open face, as a segment in local millimetres: where the door, the drawer
 * fronts or the shelf opening is. For a straight unit it is the front edge; for
 * a corner unit it is the diagonal.
 */
export function cabinetFront(c: Cabinet): [Vec, Vec] {
  const b = cabinetBox(c);
  if (!c.corner) return [v(b.x0, b.y1), v(b.x1, b.y1)];
  const cut = cornerCut(c);
  return [v(b.x1 - cut, b.y1), v(b.x1, b.y1 - cut)];
}

/**
 * The front panel as a quadrilateral: the open face, and the same segment
 * pushed FRONT_THICKNESS into the carcass. Drawn as a band so a door reads as a
 * front rather than as a line the eye takes for the carcass edge.
 */
export function cabinetFrontBand(c: Cabinet): Vec[] {
  const [p, q] = cabinetFront(c);
  const nx = q.y - p.y, ny = -(q.x - p.x);
  const len = Math.hypot(nx, ny) || 1;
  // Inward is -y for a straight unit; the sign below picks the same side for
  // the diagonal without a second case.
  const ux = (nx / len) * FRONT_THICKNESS, uy = (ny / len) * FRONT_THICKNESS;
  return [p, q, v(q.x + ux, q.y + uy), v(p.x + ux, p.y + uy)];
}

/**
 * Where the worktop's front edge runs: the open face pushed out by the
 * overhang. A blad oversails the carcass, which is what the line states.
 */
export function cabinetWorktopEdge(c: Cabinet): [Vec, Vec] {
  const [p, q] = cabinetFront(c);
  const nx = q.y - p.y, ny = -(q.x - p.x);
  const len = Math.hypot(nx, ny) || 1;
  const ux = -(nx / len) * WORKTOP_OVERHANG, uy = -(ny / len) * WORKTOP_OVERHANG;
  return [v(p.x + ux, p.y + uy), v(q.x + ux, q.y + uy)];
}

/**
 * The lines that divide the front into leaves or drawers, in local mm. Each is
 * a segment across the front band.
 *
 * A door has none. A double front is split once at the middle. Drawers are
 * divided across the DEPTH of the carcass rather than across the front, because
 * from above a stack of drawers is seen one behind the other — dividing the
 * front would draw a bank of doors instead.
 */
export function cabinetFrontDivisions(c: Cabinet): Array<[Vec, Vec]> {
  if (c.front !== "double") return [];
  const [p, q] = cabinetFront(c);
  const mid = v((p.x + q.x) / 2, (p.y + q.y) / 2);
  const nx = q.y - p.y, ny = -(q.x - p.x);
  const len = Math.hypot(nx, ny) || 1;
  // The meeting stile. Long enough to read past the band it sits in.
  const d = FRONT_THICKNESS * 2.5;
  return [[mid, v(mid.x + (nx / len) * d, mid.y + (ny / len) * d)]];
}

/** How far the carcass runs back from the front: the room for a drawer box. */
function frontDepth(c: Cabinet): number {
  return c.corner ? cornerCut(c) : c.depth;
}

/**
 * Lines parallel to the front, stepping back into the carcass: the drawer
 * boxes behind the front. `cabinetDrawers()` bounds the count, so this stays
 * legible at plan scale rather than turning a 600 unit into a hatch.
 */
export function cabinetDrawerLines(c: Cabinet): Array<[Vec, Vec]> {
  if (c.front !== "drawers") return [];
  const n = cabinetDrawers(c);
  const [p, q] = cabinetFront(c);
  const nx = q.y - p.y, ny = -(q.x - p.x);
  const len = Math.hypot(nx, ny) || 1;
  // Spread over the part of the depth behind the front panel.
  const usable = Math.max(0, frontDepth(c) - FRONT_THICKNESS * 2);
  const out: Array<[Vec, Vec]> = [];
  for (let i = 1; i < n; i++) {
    const off = FRONT_THICKNESS + (usable * i) / n;
    const ux = (nx / len) * off, uy = (ny / len) * off;
    out.push([v(p.x + ux, p.y + uy), v(q.x + ux, q.y + uy)]);
  }
  return out;
}

/**
 * The hinge mark: a diagonal from the hinged end of the front to the opposite
 * back corner of the carcass. It states which end the door is hung on, which is
 * the one thing a fitter reads off a cabinet in plan.
 *
 * "left" is the viewer's left standing in the room facing the unit, which is
 * local -x — see CabinetHinge. A mirrored cabinet is drawn through a flipped
 * transform, so the mark follows the handedness without being recomputed.
 */
export function cabinetHingeMarks(c: Cabinet): Array<[Vec, Vec]> {
  const b = cabinetBox(c);
  const [p, q] = cabinetFront(c);
  // A pair of doors is hung at its outer ends and meets in the middle, so both
  // diagonals run inward to the back of the carcass.
  if (c.front === "double") {
    const back = v(0, b.y0);
    return [[p, back], [q, back]];
  }
  if (c.front !== "door") return [];
  // p is the -x end of the front for a straight unit, and the end nearer -x for
  // a corner unit's diagonal, so the same choice serves both.
  const left = cabinetHinge(c) === "left";
  return [[left ? p : q, left ? v(b.x1, b.y0) : v(b.x0, b.y0)]];
}

/**
 * The sliding mark: a line along the front with the travel indicated, used when
 * the front slides rather than swings.
 */
export function cabinetSlideMark(c: Cabinet): [Vec, Vec] | null {
  if (c.front !== "slide") return null;
  const [p, q] = cabinetFront(c);
  const t = 0.25;
  return [
    v(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t),
    v(p.x + (q.x - p.x) * (1 - t), p.y + (q.y - p.y) * (1 - t)),
  ];
}

/** Height of the unit's annotation on the drawing, mm. */
export const CABINET_LABEL_SIZE = 140;

/**
 * Where the annotation goes: the middle of the carcass, drawn upright by the
 * caller so a turned cabinet does not carry turned text.
 */
export function cabinetLabelAt(c: Cabinet): Vec {
  return worldPoint({ ...c, mirrored: false }, v(0, c.depth / 2));
}
