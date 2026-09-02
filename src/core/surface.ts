// Wall surface: the face area of a storey's walls, per wall and summed, for the
// trades that are ordered by the square metre -- stucwerk, verf, behang.
//
// Pure and uncached like the rest of core/. `resolved` is passed in rather than
// recomputed so a caller that already holds the revision-cached geometry (see
// derived() in main.ts) does not resolve the floor twice.
//
// What the figures are measured over:
//
//   length   the MITERED face length from resolveFloor(), not the centerline.
//            A wall running between two thicker walls has an inner face shorter
//            than its axis and an outer face longer, and it is the face that
//            gets plastered.
//   height   wallHeight(), which is floor to floor. Nothing here knows about a
//            suspended ceiling or a floor build-up, so this is the full storey
//            face rather than the height a room is finished to.
//   openings each opening is deducted at its stated size (width x height,
//            clamped to the wall) from BOTH faces, which is what a kozijn
//            schedule states. The reveals -- the dagkanten around the opening --
//            are not added: they are perpendicular to the faces this measures.
//
// Reported, never enforced, like every other figure in this product. Nothing
// here decides what is finished; it states what area the walls present.
import {
  Floor, Opening, Id, wallHeight, wallFacadeMm, facadeSideOf, openingSill, openingHeight,
} from "../model/doc";
import type { Resolved, ResolvedWall } from "./resolve";

/** One side of one wall. `side` is the wall's own a->b frame: "left" is
 *  +perp(tangent), the clockwise visual side (invariant 2). */
export interface WallFaceSurface {
  side: "left" | "right";
  lengthMm: number;
  grossMm2: number;
  openingsMm2: number;
  netMm2: number;
  /**
   * This face carries the wall's cladding, and so is the outside of the
   * building. A wall that states no cladding has neither face marked, because
   * the document does not then say which of them is outside -- see `innerMm2`.
   */
  clad: boolean;
}

export interface WallSurface {
  wallId: Id;
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

export interface FloorSurface {
  /** Per wall, largest net area first: what a takeoff is read in. */
  walls: WallSurface[];
  grossMm2: number;
  openingsMm2: number;
  netMm2: number;
  innerMm2: number;
  /** Faces left out of `innerMm2` because they carry cladding. */
  cladFaces: number;
}

/** The area one opening takes out of one face, mm². Clamped to the wall: an
 *  opening taller than the wall it sits in cuts the wall, not more. */
function openingCut(heightMm: number, o: Opening): number {
  const sill = openingSill(o);
  const top = Math.min(sill + openingHeight(o), heightMm);
  const bottom = Math.min(sill, top);
  return Math.max(0, o.width) * Math.max(0, top - bottom);
}

export function wallSurface(f: Floor, rw: ResolvedWall): WallSurface {
  const w = rw.wall;
  const heightMm = wallHeight(f, w);
  const cutMm2 = w.openings.reduce((sum, o) => sum + openingCut(heightMm, o), 0);
  const cladSide = wallFacadeMm(w) === undefined ? null : facadeSideOf(w);

  const face = (side: "left" | "right", lengthMm: number): WallFaceSurface => {
    const grossMm2 = lengthMm * heightMm;
    // A face shorter than its openings is a wall the openings do not fit in;
    // it reports no area rather than a negative one.
    const openingsMm2 = Math.min(cutMm2, grossMm2);
    return {
      side, lengthMm, grossMm2, openingsMm2,
      netMm2: grossMm2 - openingsMm2,
      clad: side === cladSide,
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
 * Every wall of this storey with its face area, and the storey's totals.
 *
 * Degenerate walls are absent: resolveFloor() drops a wall whose nodes
 * coincide, and a wall with no geometry has no face to finish.
 */
export function floorSurface(f: Floor, resolved: Resolved): FloorSurface {
  const walls: WallSurface[] = [];
  for (const w of f.walls) {
    const rw = resolved.walls.get(w.id);
    if (rw) walls.push(wallSurface(f, rw));
  }
  walls.sort((a, b) => b.netMm2 - a.netMm2);
  const total = (pick: (s: WallSurface) => number): number =>
    walls.reduce((n, s) => n + pick(s), 0);
  return {
    walls,
    grossMm2: total(s => s.grossMm2),
    openingsMm2: total(s => s.openingsMm2),
    netMm2: total(s => s.netMm2),
    innerMm2: total(s => s.innerMm2),
    cladFaces: walls.reduce((n, s) => n + s.faces.filter(x => x.clad).length, 0),
  };
}
