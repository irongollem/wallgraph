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
//            height, floor to floor, applies. Nothing here knows about a floor
//            build-up.
//   openings each opening is deducted at its stated size (width x height,
//            clamped to the face's own height) from BOTH faces, which is what a
//            kozijn schedule states. The reveals -- the dagkanten around the
//            opening -- are not added: they are perpendicular to the faces this
//            measures.
//
// Reported, never enforced, like every other figure in this product. Nothing
// here decides what is finished; it states what area the walls present.
import {
  Floor, Opening, Id, wallHeight, wallFacadeMm, facadeSideOf, openingSill, openingHeight,
} from "../model/doc";
import type { Resolved, ResolvedWall } from "./resolve";
import { roomKey, type Room } from "./rooms";

/** One side of one wall. `side` is the wall's own a->b frame: "left" is
 *  +perp(tangent), the clockwise visual side (invariant 2). */
export interface WallFaceSurface {
  side: "left" | "right";
  lengthMm: number;
  /**
   * The height this face is finished to: the ceiling of the room it looks into
   * where one is stated, the wall's own height otherwise. Never above the
   * wall itself -- a ceiling inside the slab is not a taller face.
   */
  heightMm: number;
  grossMm2: number;
  openingsMm2: number;
  netMm2: number;
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
  /** The wall's own height, floor to floor. A face may be finished to less. */
  heightMm: number;
  /** Left face first, right second. */
  faces: [WallFaceSurface, WallFaceSurface];
  /** Openings deducted, counted once per face they cut. */
  openings: number;
  grossMm2: number;
  openingsMm2: number;
  /** Both faces, openings deducted. */
  netMm2: number;
  /**
   * Net area over the faces that are NOT the clad side -- the finishing figure
   * for a wall that states a facade. A wall with no cladding contributes both
   * of its faces here, since nothing in the document says either one is
   * outside; on a plan where no wall is clad this equals `netMm2`.
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
}

export interface FloorSurface {
  /** Per wall, largest net area first: what a takeoff is read in. */
  walls: WallSurface[];
  /** Per room, largest net area first. Empty where no wall loop closes. */
  rooms: RoomSurface[];
  grossMm2: number;
  openingsMm2: number;
  netMm2: number;
  innerMm2: number;
  /** Net area of the faces that look into no room -- the outside of the
   *  building, and anything the walls do not close around. */
  unroomedMm2: number;
  /** Faces left out of `innerMm2` because they carry cladding. */
  cladFaces: number;
}

/** The area one opening takes out of one face, mm². Clamped to the face: an
 *  opening taller than the face it cuts takes the face, not more. */
function openingCut(heightMm: number, o: Opening): number {
  const sill = openingSill(o);
  const top = Math.min(sill + openingHeight(o), heightMm);
  const bottom = Math.min(sill, top);
  return Math.max(0, o.width) * Math.max(0, top - bottom);
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
  const heightMm = wallHeight(f, w);
  const cladSide = wallFacadeMm(w) === undefined ? null : facadeSideOf(w);

  const face = (side: "left" | "right", lengthMm: number): WallFaceSurface => {
    const room = byFace.get(w.id + ":" + side);
    // A ceiling is a finish under the slab, so it can only lower the face.
    const faceHeight = Math.min(room?.ceilingMm ?? heightMm, heightMm);
    const grossMm2 = lengthMm * faceHeight;
    const cut = w.openings.reduce((sum, o) => sum + openingCut(faceHeight, o), 0);
    // A face shorter than its openings is a wall the openings do not fit in;
    // it reports no area rather than a negative one.
    const openingsMm2 = Math.min(cut, grossMm2);
    return {
      side, lengthMm, heightMm: faceHeight, grossMm2, openingsMm2,
      netMm2: grossMm2 - openingsMm2,
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
    faces,
    openings: w.openings.length,
    grossMm2: sum(x => x.grossMm2),
    openingsMm2: sum(x => x.openingsMm2),
    netMm2: sum(x => x.netMm2),
    innerMm2: faces.reduce((n, x) => n + (x.clad ? 0 : x.netMm2), 0),
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
  walls.sort((a, b) => b.netMm2 - a.netMm2);

  // Per room, over the faces that named it. Built from the faces rather than
  // from each room's boundingFaces so the two cannot count different things.
  const perRoom = new Map<string, RoomSurface>();
  for (const r of rooms) {
    perRoom.set(roomKey(r), {
      key: roomKey(r),
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.ceilingMm !== undefined ? { ceilingMm: r.ceilingMm } : {}),
      faces: 0, grossMm2: 0, openingsMm2: 0, netMm2: 0,
    });
  }
  let unroomedMm2 = 0;
  for (const s of walls) {
    for (const x of s.faces) {
      const entry = x.roomKey === undefined ? undefined : perRoom.get(x.roomKey);
      if (!entry) { unroomedMm2 += x.netMm2; continue; }
      entry.faces++;
      entry.grossMm2 += x.grossMm2;
      entry.openingsMm2 += x.openingsMm2;
      entry.netMm2 += x.netMm2;
    }
  }

  const total = (pick: (s: WallSurface) => number): number =>
    walls.reduce((n, s) => n + pick(s), 0);
  return {
    walls,
    rooms: [...perRoom.values()].sort((a, b) => b.netMm2 - a.netMm2),
    grossMm2: total(s => s.grossMm2),
    openingsMm2: total(s => s.openingsMm2),
    netMm2: total(s => s.netMm2),
    innerMm2: total(s => s.innerMm2),
    unroomedMm2,
    cladFaces: walls.reduce((n, s) => n + s.faces.filter(x => x.clad).length, 0),
  };
}
