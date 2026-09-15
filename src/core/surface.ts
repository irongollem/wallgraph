// Wall surface: the face area of a storey's walls -- per wall, per room and
// summed -- for the trades that are ordered by the square metre: stucwerk,
// verf, behang.
//
// Pure and uncached like the rest of core/. `resolved` and `rooms` are passed
// in rather than recomputed so a caller that already holds the revision-cached
// geometry (see derived() in main.ts) does not derive the floor twice.
//
// What the figures are measured over:
//
//   length   the MITERED face length from resolveFloor(), not the centerline.
//            A wall running between two thicker walls has an inner face shorter
//            than its axis and an outer face longer, and it is the face that
//            gets plastered.
//   height   PER FACE, because the two faces of one wall stand in two different
//            rooms and each is finished to its own room's ceiling. A room with
//            a suspended ceiling is finished to it; otherwise the wall's own
//            top, floor to top, applies. Nothing here knows about a floor
//            build-up.
//   top      a wall's own top may be a profile rather than one flat height
//            (model/profile.ts) -- a gable end, a lean-to. grossMm2 is the
//            area under that top, mapped from the centerline [0, L] onto the
//            face's own MITERED length proportionally: the profile is stated
//            once per wall, not once per face, so the face's area is the
//            centerline area scaled by faceLength / L. A ceiling still caps a
//            face, now pointwise along the top rather than as one flat
//            height. Flat where the wall states no profile, and bit-identical
//            to a plain length x height in that case.
//   openings each opening is deducted at its stated size (width x height,
//            clamped to the top over its own width) from BOTH faces, which is
//            what a kozijn schedule states. An opening whose head pokes above
//            the wall's own top anywhere across its width is listed in
//            `WallSurface.openingsAbove` and deducted only up to the top.
//   reveals  the dagkanten: the surface of the hole itself, through the wall's
//            thickness. Two jambs and a head, never a sill -- under a door the
//            sill is the floor, and under a window it takes a vensterbank
//            rather than plaster. Reported as its own figure and added to
//            `finishMm2`, never folded into `netMm2`, so a quantity that
//            excludes it stays readable beside one that includes it.
//
// Reported, never enforced, like every other figure in this product. Nothing
// here decides what is finished; it states what area the walls present.
import {
  Floor, Wall, Opening, Id, wallFacadeMm, facadeSideOf, openingSill, openingHeight,
} from "../model/doc";
import { wallLength } from "../model/ops";
import { wallTopAt, wallTopPolyline, wallTopRange } from "../model/profile";
import type { Resolved, ResolvedWall } from "./resolve";
import { roomKey, type Room } from "./rooms";

/** One side of one wall. `side` is the wall's own a->b frame: "left" is
 *  +perp(tangent), the clockwise visual side (invariant 2). */
export interface WallFaceSurface {
  side: "left" | "right";
  lengthMm: number;
  /**
   * The highest point this face is finished to: the ceiling of the room it
   * looks into where one is stated, the highest point of the wall's own top
   * otherwise. Never above the top itself -- a ceiling inside the slab is not
   * a taller face.
   */
  heightMm: number;
  /** The lowest point this face is finished to, by the same rule. Equal to
   *  `heightMm` on a flat wall. */
  minHeightMm: number;
  grossMm2: number;
  openingsMm2: number;
  netMm2: number;
  /**
   * Half the reveal of this face's openings -- see openingOn(). A reveal is one
   * surface through the wall, and the two sides finish half of it each.
   */
  revealsMm2: number;
  /** `netMm2` plus `revealsMm2`: everything this face costs to finish. */
  finishMm2: number;
  /**
   * This face carries the wall's cladding, and so is the outside of the
   * building. A wall that states no cladding has neither face marked, because
   * the document does not then say which of them is outside -- see `innerMm2`.
   */
  clad: boolean;
  /** roomKey() of the room this face looks into, absent where it looks into
   *  none: the outside, or a wall loop that does not close. */
  roomKey?: string;
  /** That room's name, where it has one. Carried here so a caller naming the
   *  face does not have to walk the room list for a word it already knows. */
  roomName?: string;
}

export interface WallSurface {
  wallId: Id;
  /** The highest point of the wall's own top. A face may be finished to less. */
  heightMm: number;
  /** The lowest point of the wall's own top. Equal to `heightMm` on a flat wall. */
  minHeightMm: number;
  /** Left face first, right second. */
  faces: [WallFaceSurface, WallFaceSurface];
  /** Openings deducted, counted once per face they cut. */
  openings: number;
  /**
   * Openings whose head (sill + height) pokes above the wall's OWN top
   * anywhere across their width -- independent of any room ceiling, which is
   * a finish rather than a fact about the wall's shape. Deducted only up to
   * the top; never repositioned.
   */
  openingsAbove: Id[];
  grossMm2: number;
  openingsMm2: number;
  /** Both faces, openings deducted. Reveals are NOT in this figure. */
  netMm2: number;
  /** The reveals of this wall's openings, counted once each across the two
   *  faces. Its own figure so a quantity that excludes them stays readable. */
  revealsMm2: number;
  /** `netMm2` plus `revealsMm2`: everything this wall costs to finish. */
  finishMm2: number;
  /**
   * Finish area over the faces that are NOT the clad side -- the interior
   * figure for a wall that states a facade. A wall with no cladding contributes
   * both of its faces here, since nothing in the document says either one is
   * outside; on a plan where no wall is clad this equals `finishMm2`.
   */
  innerMm2: number;
}

/**
 * One room's own walls: what is quoted for finishing that room.
 *
 * This is the figure a stucadoor or schilder prices, and it exists only where
 * the wall loop closes -- an open plan has faces that look into no room, and
 * those are reported as `unroomedMm2` rather than folded in somewhere.
 */
export interface RoomSurface {
  /** roomKey() of the room, which is how the panel matches it to its row. */
  key: string;
  name?: string;
  /** The ceiling its faces were measured to, absent where none is stated and
   *  the walls' own heights applied. */
  ceilingMm?: number;
  /** Wall faces looking into this room. */
  faces: number;
  grossMm2: number;
  openingsMm2: number;
  netMm2: number;
  /** The room's half of the reveals of the openings around it. */
  revealsMm2: number;
  /** `netMm2` plus `revealsMm2`: what finishing this room is quoted at. */
  finishMm2: number;
}

export interface FloorSurface {
  /** Per wall, largest net area first: what a takeoff is read in. */
  walls: WallSurface[];
  /** Per room, largest net area first. Empty where no wall loop closes. */
  rooms: RoomSurface[];
  grossMm2: number;
  openingsMm2: number;
  netMm2: number;
  revealsMm2: number;
  finishMm2: number;
  innerMm2: number;
  /** Finish area of the faces that look into no room -- the outside of the
   *  building, and anything the walls do not close around. */
  unroomedMm2: number;
  /** Faces left out of `innerMm2` because they carry cladding. */
  cladFaces: number;
}

/**
 * What one opening does to one face, mm²: the area it takes out, and the reveal
 * it opens up.
 *
 * `localTopMm` is the top the opening is measured against -- the lowest point
 * of the face's own (possibly ceiling-capped) top over the opening's width,
 * so a sloped or capped top never yields more area than is actually there.
 * Both figures are clamped to it: an opening taller than the top takes the
 * top and not more, the jambs are measured over the height that shows, and
 * the head counts only where the opening's own head is under the top.
 *
 * `thicknessMm` is the STRUCTURAL body. A clad wall's reveal is deeper by its
 * facade, but that depth is an exterior detail rather than plasterwork, and
 * this figure is read by the trades working inside.
 */
function openingOn(localTopMm: number, thicknessMm: number, o: Opening): {
  cutMm2: number; revealMm2: number;
} {
  const sill = openingSill(o);
  const head = sill + openingHeight(o);
  const top = Math.min(head, localTopMm);
  const bottom = Math.min(sill, top);
  const width = Math.max(0, o.width);
  const clear = Math.max(0, top - bottom);
  const jambs = 2 * clear * thicknessMm;
  // No sill: under a door or a passage it is the floor, and under a window a
  // vensterbank rather than plaster. A head clipped by the top is above it.
  const headArea = head <= localTopMm ? width * thicknessMm : 0;
  return { cutMm2: width * clear, revealMm2: jambs + headArea };
}

/**
 * The lowest point of the wall's own top -- capped pointwise at `cap` when
 * one is given -- over [s0, s1]. A piecewise-linear function's minimum over
 * an interval is always at one of its breakpoints or the interval's own
 * ends, never strictly between them, so this only has to look at those.
 */
function localTop(
  f: Floor, w: Wall, L: number, s0: number, s1: number, cap: number | undefined,
): number {
  const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(L, Math.max(s0, s1));
  let m = Math.min(wallTopAt(f, w, lo), wallTopAt(f, w, hi));
  for (const p of wallTopPolyline(f, w, L)) if (p.s > lo && p.s < hi) m = Math.min(m, p.h);
  return cap === undefined ? m : Math.min(m, cap);
}

/**
 * Trapezoid area under min(topAt(s), cap) between two adjacent breakpoints of
 * the wall's own top, inserting the crossing exactly once where the segment
 * crosses `cap`.
 */
function cappedSegmentArea(s0: number, h0: number, s1: number, h1: number, cap: number | undefined): number {
  const width = s1 - s0;
  if (width <= 0) return 0;
  if (cap === undefined || (h0 <= cap && h1 <= cap)) return (h0 + h1) / 2 * width;
  if (h0 >= cap && h1 >= cap) return cap * width;
  const u = (cap - h0) / (h1 - h0);
  const sC = s0 + u * width;
  return h0 <= cap
    ? (h0 + cap) / 2 * (sC - s0) + cap * (s1 - sC)
    : cap * (sC - s0) + (cap + h1) / 2 * (s1 - sC);
}

/** Area under the wall's own top over the full centerline [0, L], capped
 *  pointwise at `cap` (a room's ceiling) when one is given. */
function grossAreaUnderTop(f: Floor, w: Wall, L: number, cap: number | undefined): number {
  const poly = wallTopPolyline(f, w, L);
  let area = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    area += cappedSegmentArea(poly[i]!.s, poly[i]!.h, poly[i + 1]!.s, poly[i + 1]!.h, cap);
  }
  return area;
}

/** The room each wall face looks into, keyed "wallId:side". A face belongs to
 *  at most one room: it is one side of one wall. */
function roomsByFace(rooms: readonly Room[]): Map<string, Room> {
  const by = new Map<string, Room>();
  for (const r of rooms) {
    for (const rf of r.boundingFaces) by.set(rf.wallId + ":" + rf.side, r);
  }
  return by;
}

function wallSurface(f: Floor, rw: ResolvedWall, byFace: ReadonlyMap<string, Room>): WallSurface {
  const w = rw.wall;
  const L = wallLength(f, w);
  const range = wallTopRange(f, w, L);
  const heightMm = range.max, minHeightMm = range.min;
  const cladSide = wallFacadeMm(w) === undefined ? null : facadeSideOf(w);

  // An opening pokes through the wall's own top when the top somewhere over
  // its width is lower than its head -- a fact about the wall's shape, so it
  // is checked once, uncapped by whatever a room's ceiling happens to be.
  const openingsAbove = w.openings
    .filter(o => openingSill(o) + openingHeight(o) > localTop(f, w, L, o.t - o.width / 2, o.t + o.width / 2, undefined))
    .map(o => o.id);

  const face = (side: "left" | "right", lengthMm: number): WallFaceSurface => {
    const room = byFace.get(w.id + ":" + side);
    // A ceiling is a finish under the slab, so it can only lower the face --
    // capping the top pointwise rather than by one flat figure.
    const cap = room?.ceilingMm;
    const faceHeight = Math.min(heightMm, cap ?? Infinity);
    const faceMinHeight = Math.min(minHeightMm, cap ?? Infinity);
    // The mitered face length differs from the centerline L (a corner miter
    // runs one face long and the other short), so the centerline area under
    // the top is scaled onto the face's own length proportionally.
    const grossMm2 = L > 0 ? grossAreaUnderTop(f, w, L, cap) * (lengthMm / L) : lengthMm * faceHeight;
    let cut = 0, reveal = 0;
    for (const o of w.openings) {
      const top = localTop(f, w, L, o.t - o.width / 2, o.t + o.width / 2, cap);
      const on = openingOn(top, w.thickness, o);
      cut += on.cutMm2;
      reveal += on.revealMm2;
    }
    // A face shorter than its openings is a wall the openings do not fit in;
    // it reports no area rather than a negative one.
    const openingsMm2 = Math.min(cut, grossMm2);
    // Half, because a reveal is ONE surface through the wall and the two sides
    // finish half of it each. Where one side is outside, that half genuinely is
    // exterior work -- the inner reveal of a window is plastered, the outer one
    // belongs to the facade detail -- so the split is the fact, not a fudge.
    const netMm2 = grossMm2 - openingsMm2;
    const revealsMm2 = reveal / 2;
    return {
      side, lengthMm, heightMm: faceHeight, minHeightMm: faceMinHeight, grossMm2, openingsMm2,
      netMm2,
      revealsMm2,
      finishMm2: netMm2 + revealsMm2,
      clad: side === cladSide,
      ...(room ? { roomKey: roomKey(room) } : {}),
      ...(room?.name !== undefined ? { roomName: room.name } : {}),
    };
  };
  const faces: [WallFaceSurface, WallFaceSurface] =
    [face("left", rw.faces.left), face("right", rw.faces.right)];

  const sum = (pick: (x: WallFaceSurface) => number): number =>
    faces.reduce((n, x) => n + pick(x), 0);
  return {
    wallId: w.id,
    heightMm,
    minHeightMm,
    faces,
    openings: w.openings.length,
    openingsAbove,
    grossMm2: sum(x => x.grossMm2),
    openingsMm2: sum(x => x.openingsMm2),
    netMm2: sum(x => x.netMm2),
    revealsMm2: sum(x => x.revealsMm2),
    finishMm2: sum(x => x.finishMm2),
    innerMm2: faces.reduce((n, x) => n + (x.clad ? 0 : x.finishMm2), 0),
  };
}

/**
 * Every wall of this storey with its face area, the same area gathered per
 * room, and the storey's totals.
 *
 * Degenerate walls are absent: resolveFloor() drops a wall whose nodes
 * coincide, and a wall with no geometry has no face to finish.
 */
export function floorSurface(f: Floor, resolved: Resolved, rooms: readonly Room[]): FloorSurface {
  const byFace = roomsByFace(rooms);
  const walls: WallSurface[] = [];
  for (const w of f.walls) {
    const rw = resolved.walls.get(w.id);
    if (rw) walls.push(wallSurface(f, rw, byFace));
  }
  walls.sort((a, b) => b.finishMm2 - a.finishMm2);

  // Per room, over the faces that named it. Built from the faces rather than
  // from each room's boundingFaces so the two cannot count different things.
  const perRoom = new Map<string, RoomSurface>();
  for (const r of rooms) {
    perRoom.set(roomKey(r), {
      key: roomKey(r),
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.ceilingMm !== undefined ? { ceilingMm: r.ceilingMm } : {}),
      faces: 0, grossMm2: 0, openingsMm2: 0, netMm2: 0, revealsMm2: 0, finishMm2: 0,
    });
  }
  let unroomedMm2 = 0;
  for (const s of walls) {
    for (const x of s.faces) {
      const entry = x.roomKey === undefined ? undefined : perRoom.get(x.roomKey);
      if (!entry) { unroomedMm2 += x.finishMm2; continue; }
      entry.faces++;
      entry.grossMm2 += x.grossMm2;
      entry.openingsMm2 += x.openingsMm2;
      entry.netMm2 += x.netMm2;
      entry.revealsMm2 += x.revealsMm2;
      entry.finishMm2 += x.finishMm2;
    }
  }

  const total = (pick: (s: WallSurface) => number): number =>
    walls.reduce((n, s) => n + pick(s), 0);
  return {
    walls,
    rooms: [...perRoom.values()].sort((a, b) => b.finishMm2 - a.finishMm2),
    grossMm2: total(s => s.grossMm2),
    openingsMm2: total(s => s.openingsMm2),
    netMm2: total(s => s.netMm2),
    revealsMm2: total(s => s.revealsMm2),
    finishMm2: total(s => s.finishMm2),
    innerMm2: total(s => s.innerMm2),
    unroomedMm2,
    cladFaces: walls.reduce((n, s) => n + s.faces.filter(x => x.clad).length, 0),
  };
}
