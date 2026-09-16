// Derived deck geometry. Nothing here is stored: the platform's corners, where
// its joists stand, the heights it occupies and the prisms it is built from all
// follow from the anchor, the rotation and the figures in model/deck.ts.
import { Deck, bearingOf } from "../model/deck";
import type { Floor, Id } from "../model/doc";
import { liningSideOf, wallLiningMm } from "../model/doc";
import { Vec, v, add, scale, norm, perp, distToSeg } from "../geometry/vec";
import { boxCorners, boxHit, worldPoint, type LocalBox } from "./placed";
import type { DeckJoistLayout, JoistSegment } from "./trimmer";

/** Local bounds. The anchor is the centre, so the box is symmetric both ways. */
export function deckBox(d: Deck): LocalBox {
  return { x0: -d.width / 2, y0: -d.depth / 2, x1: d.width / 2, y1: d.depth / 2 };
}

export function deckCorners(d: Deck): Vec[] { return boxCorners(d, deckBox(d)); }

export function deckHit(d: Deck, p: Vec, margin = 0): boolean {
  return boxHit(d, deckBox(d), p, margin);
}

/** Meets-tolerance for deckMeetsWall(): a deck sits INSET from the walls it
 *  spans between (its outline is the clear platform, not the wall faces), so
 *  "touches" allows a small gap rather than requiring an exact crossing. */
const DECK_WALL_TOL_MM = 60;

/**
 * Whether this deck's outline meets a wall's centerline, within
 * DECK_WALL_TOL_MM -- offered as the default height for "at deck height" in
 * the wall pane's frame-break row (ui/panel.ts). Checked as the closest
 * distance between the wall's segment and each of the deck's four edges,
 * both ways (endpoint to segment), which is enough for the near-rectangular,
 * near-axis-aligned case this is used for without a general segment-segment
 * distance routine.
 */
export function deckMeetsWall(d: Deck, a: Vec, b: Vec, tolMm = DECK_WALL_TOL_MM): boolean {
  const poly = deckCorners(d);
  for (let i = 0; i < poly.length; i++) {
    const c0 = poly[i]!, c1 = poly[(i + 1) % poly.length]!;
    const dists = [
      distToSeg(a, c0, c1).d, distToSeg(b, c0, c1).d,
      distToSeg(c0, a, b).d, distToSeg(c1, a, b).d,
    ];
    if (Math.min(...dists) <= tolMm) return true;
  }
  return false;
}

/** Tolerance for a resize handle snapping to a wall FACE, mm (issue #65):
 *  tighter than DECK_WALL_TOL_MM, which asks "does this deck touch that wall
 *  at all", not "is the pointer close enough to snap to it". */
const WALL_FACE_SNAP_TOL_MM = 40;

/**
 * The nearest point on a wall's own FACE -- half its thickness off the
 * centerline, plus a stated lining (the lined face is where a floor bears,
 * per CLAUDE.md's "A lining is a skin ... measured only by the net area") --
 * within `tolMm`, or null. Read by the deck/vide resize handle (issue #65) to
 * let an edge dragged toward a wall land on it instead of stopping a
 * millimetre short, the same reason deckMeetsWall() reads a tolerance rather
 * than requiring an exact crossing.
 *
 * Walked the same way deckMeetsWall() walks a deck's own outline: per wall,
 * both faces as offset segments, closest point via distToSeg(). Arcs are not
 * special-cased -- straight per-face segments through the endpoints, the same
 * simplification deckMeetsWall() already makes for "near-axis-aligned" work.
 */
export function nearestWallFace(f: Floor, p: Vec, tolMm = WALL_FACE_SNAP_TOL_MM): { p: Vec; wallId: Id } | null {
  let best: { p: Vec; wallId: Id; d: number } | null = null;
  for (const w of f.walls) {
    const a = f.nodes.find(n => n.id === w.a), b = f.nodes.find(n => n.id === w.b);
    if (!a || !b) continue;
    const A = v(a.x, a.y), B = v(b.x, b.y);
    const dir = norm({ x: B.x - A.x, y: B.y - A.y });
    if (dir.x === 0 && dir.y === 0) continue;
    const nrm = perp(dir);
    for (const side of ["left", "right"] as const) {
      const off = w.thickness / 2 + (liningSideOf(w, side) ? wallLiningMm(w) : 0);
      const faceDir = side === "left" ? nrm : scale(nrm, -1);
      const A2 = add(A, scale(faceDir, off)), B2 = add(B, scale(faceDir, off));
      const { d, t } = distToSeg(p, A2, B2);
      if (d <= tolMm && (!best || d < best.d)) {
        best = { p: add(A2, scale({ x: B2.x - A2.x, y: B2.y - A2.y }, t)), wallId: w.id, d };
      }
    }
  }
  return best ? { p: best.p, wallId: best.wallId } : null;
}

/** Height of the word on the drawing, mm. */
export const DECK_LABEL_SIZE = 200;

/** Where the word goes: inside the top edge, upright, as a vide's does. */
export function deckLabelAt(d: Deck): Vec {
  const inset = Math.min(DECK_LABEL_SIZE, d.depth / 3);
  return worldPoint({ ...d, mirrored: false }, v(0, -d.depth / 2 + inset));
}

/** The clear span the joists cross, mm: the box dimension along the joists. */
export const deckSpanMm = (d: Deck): number => (d.joistAxis === "x" ? d.width : d.depth);

/** The box dimension the joists are set out across, mm. */
export const deckAcrossMm = (d: Deck): number => (d.joistAxis === "x" ? d.depth : d.width);

/**
 * Joist centrelines in the deck's own millimetres, each across the clear span.
 * Set out from both edges the way railingPosts() sets out posts: equal bays no
 * wider than `joistMm`, so the two edge joists always stand. With a stated
 * section the edge joists sit inside the box, their centres half a joist in.
 */
export function deckJoistsLocal(d: Deck): { a: Vec; b: Vec }[] {
  const half = (d.joist?.w ?? 0) / 2;
  const across = deckAcrossMm(d) - 2 * half;
  const span = deckSpanMm(d);
  if (d.joistMm <= 0 || across < 0 || span <= 0) return [];
  const bays = Math.max(1, Math.ceil(across / d.joistMm));
  const out: { a: Vec; b: Vec }[] = [];
  for (let i = 0; i <= bays; i++) {
    const c = -across / 2 + (across * i) / bays;
    out.push(d.joistAxis === "x"
      ? { a: v(-span / 2, c), b: v(span / 2, c) }
      : { a: v(c, -span / 2), b: v(c, span / 2) });
  }
  return out;
}

/** Joist centrelines in world millimetres. */
export function deckJoists(d: Deck): { a: Vec; b: Vec }[] {
  return deckJoistsLocal(d).map(j => ({ a: worldPoint(d, j.a), b: worldPoint(d, j.b) }));
}

/** Top of the deck above the storey floor, mm. Absent means the floor itself. */
export const deckTop = (d: Deck): number => d.topMm ?? 0;

/** Underside of the joists, mm above the storey floor. Negative for a balklaag
 *  at floor level: its joists stand below the floor. */
export const deckBottom = (d: Deck): number =>
  deckTop(d) - (d.joist?.d ?? 0) - (d.deckingMm ?? 0);

/** True when the deck lies above the storey's section plane rather than being its floor. */
export const deckRaised = (d: Deck): boolean => deckTop(d) > 0;

export type DeckPart = "decking" | "joist" | "deckHeader" | "trimmer";

export interface DeckSolid {
  part: DeckPart;
  /** World footprint, corners in traversal order. */
  poly: Vec[];
  /** mm above the storey floor. */
  z0: number;
  z1: number;
}

function localQuad(d: Deck, x0: number, y0: number, x1: number, y1: number): Vec[] {
  return [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)].map(p => worldPoint(d, p));
}

/** A JoistSegment (always axis-aligned: one coordinate constant, the other
 *  spanning) extruded `halfWidth` mm either side of its own line -- the
 *  general case of the old per-axis localQuad() calls below, since
 *  deckJoistLayout()'s header segments run across where a joist's own run
 *  along, and both are handled the same way once the segment itself already
 *  carries the right length (including any bearing extension). */
function segmentQuad(d: Deck, seg: JoistSegment, halfWidth: number): Vec[] {
  if (seg.a.y === seg.b.y) {
    const x0 = Math.min(seg.a.x, seg.b.x), x1 = Math.max(seg.a.x, seg.b.x);
    return localQuad(d, x0, seg.a.y - halfWidth, x1, seg.a.y + halfWidth);
  }
  const y0 = Math.min(seg.a.y, seg.b.y), y1 = Math.max(seg.a.y, seg.b.y);
  return localQuad(d, seg.a.x - halfWidth, y0, seg.a.x + halfWidth, y1);
}

/** A segment shifted `amount` mm perpendicular to its own run -- how a
 *  trimmer's single centreline becomes the two ADJACENT, touching members a
 *  real doubled trimmer is (as opposed to the 2D mark's purely legible gap;
 *  see render/deck.ts's own TRIMMER_GAP_MM). */
function offsetAcross(seg: JoistSegment, amount: number): JoistSegment {
  return seg.a.y === seg.b.y
    ? { a: { x: seg.a.x, y: seg.a.y + amount }, b: { x: seg.b.x, y: seg.b.y + amount } }
    : { a: { x: seg.a.x + amount, y: seg.a.y }, b: { x: seg.b.x + amount, y: seg.b.y } };
}

/**
 * The prisms the deck is built from: the decking sheet over the joists where a
 * thickness is stated, and one prism per joist at its section, running the
 * clear span plus the bearing at both ends. A deck at floor level draws no
 * slab of its own, since the storey's slab is there; its joists still stand
 * below. Without a stated section there are no joists to extrude.
 *
 * `layout` (issue #64, core/trimmer.ts's deckJoistLayout()) replaces the
 * plain joist set-out with the shortened joists either side of a hole, the
 * header across it, and the doubled trimmers -- as two ADJACENT single-width
 * prisms, not a single double-width one, matching the pair of real members
 * the materials takeoff (core/materials.ts's deckTakeoffOf()) counts.
 * Undefined draws every joist full length, unaware of any hole -- the
 * pre-#64 behaviour, used where no floor is at hand to check for one.
 */
export function deckSolids(d: Deck, layout?: DeckJoistLayout): DeckSolid[] {
  const out: DeckSolid[] = [];
  const top = deckTop(d);
  const decking = d.deckingMm ?? 0;
  const b = deckBox(d);
  if (decking > 0 && top > 0) {
    out.push({ part: "decking", poly: localQuad(d, b.x0, b.y0, b.x1, b.y1), z0: top - decking, z1: top });
  }
  if (!d.joist) return out;
  const z1 = top - decking, z0 = z1 - d.joist.d;
  const hw = d.joist.w / 2;

  if (!layout) {
    const reach = deckSpanMm(d) / 2 + bearingOf(d);
    for (const j of deckJoistsLocal(d)) {
      const poly = d.joistAxis === "x"
        ? localQuad(d, -reach, j.a.y - hw, reach, j.a.y + hw)
        : localQuad(d, j.a.x - hw, -reach, j.a.x + hw, reach);
      out.push({ part: "joist", poly, z0, z1 });
    }
    return out;
  }

  for (const seg of [...layout.full, ...layout.cut]) out.push({ part: "joist", poly: segmentQuad(d, seg, hw), z0, z1 });
  for (const seg of layout.headers) out.push({ part: "deckHeader", poly: segmentQuad(d, seg, hw), z0, z1 });
  for (const seg of layout.trimmers) {
    out.push({ part: "trimmer", poly: segmentQuad(d, offsetAcross(seg, -hw), hw), z0, z1 });
    out.push({ part: "trimmer", poly: segmentQuad(d, offsetAcross(seg, hw), hw), z0, z1 });
  }
  return out;
}
