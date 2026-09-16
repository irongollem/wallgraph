// A storey's roof, authored as planes rather than derived from the walls.
//
// A roof plane states its own outline in plan, the height of its eave (the
// low edge) and its pitch -- the same "authored, not derived" choice
// Wall.profile makes for a wall's own top (see model/profile.ts and the model
// decision in issue #53/#57). Keeping the two separate is deliberate: a wall's
// top is what was actually built there, a roof plane is what covers it, and
// where the two disagree that is a fact worth reporting, not a conflict to
// resolve by picking one as authoritative. core/roofsuggest.ts proposes planes
// from the walls already drawn so this is not double entry in the common case,
// and core/roof.ts's profileFromRoof() can propose a wall's profile back from
// a plane the same way.
import type { Id } from "./doc";
import { polygonArea } from "../geometry/vec";

/**
 * One roof plane. `outline` is this plane's own footprint in plan, integer
 * mm, counter-clockwise under y-down like a room boundary (Room.poly) --
 * bounded faces trace with positive shoelace area under that winding, see
 * core/rooms.ts. Several planes' outlines may overlap (a ridge or a hip does
 * not require them to meet exactly, see roofUndersideAt() in core/roof.ts).
 */
export interface RoofPlane {
  id: Id;
  /** Plan outline of this plane, integer mm, counter-clockwise under y-down like a room. */
  outline: { x: number; y: number }[];
  /** Index of the outline edge that is the eave: the plane's low edge, where
   *  it stands `eaveMm` above this storey's floor. The edge runs from
   *  outline[eaveEdge] to outline[(eaveEdge+1) % outline.length]. */
  eaveEdge: number;
  /** Height of the eave above this storey's floor, integer mm. */
  eaveMm: number;
  /** Degrees, 0 (flat) to 75. The plane rises away from the eave edge, into the outline. */
  pitchDeg: number;
  /** Structural roof build-up thickness, mm, measured SQUARE TO THE PLANE
   *  (not vertically). Absent means not stated; core/roof.ts's default. */
  thicknessMm?: number;
}

/** A floor's roof planes. Absent means none, not an error -- a plan drawn
 *  before this existed, or a storey with no roof of its own. */
export function roofPlanesOf(f: { roofPlanes?: RoofPlane[] }): RoofPlane[] {
  return f.roofPlanes ?? [];
}

export const ROOF_PITCH_MIN = 0;
export const ROOF_PITCH_MAX = 75;
export const ROOF_EAVE_MM_MIN = 100;
export const ROOF_EAVE_MM_MAX = 20000;
export const ROOF_THICKNESS_MM_MIN = 1;
export const ROOF_THICKNESS_MM_MAX = 2000;

/** Structural roof build-up thickness a plane with none stated is drawn and
 *  built at, mm -- an explicit placeholder rather than a silent zero, the
 *  same role SLAB_DEFAULT_MM plays for a floor slab. */
export const ROOF_THICKNESS_DEFAULT_MM = 200;

/** The thickness that actually applies, mm: the plane's own where stated,
 *  ROOF_THICKNESS_DEFAULT_MM otherwise. */
export function roofThicknessOf(plane: RoofPlane): number {
  return plane.thicknessMm !== undefined && plane.thicknessMm > 0
    ? plane.thicknessMm : ROOF_THICKNESS_DEFAULT_MM;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(isFinite(n) ? n : lo)));
}

/**
 * Clamp a roof plane in place: outline rounded to integer mm with consecutive
 * duplicates dropped, `eaveEdge` kept in range, `eaveMm` into
 * [ROOF_EAVE_MM_MIN, ROOF_EAVE_MM_MAX], `pitchDeg` into [0, 75] (not rounded
 * to a whole degree -- an authored angle, like a symbol's `rotation`, not a
 * stored length), `thicknessMm` into [1, 2000] where stated. Mirrors
 * clampProfile()/clampOpening(). A plane whose outline collapses to fewer
 * than 3 points is left with that short outline for the caller to drop --
 * this function states ranges, it does not decide whether a plane survives.
 *
 * A clockwise outline is reversed here, with `eaveEdge` remapped to the same
 * geometric edge (edge i of the reversed array is edge n-2-i of the original),
 * because the winding is a stated invariant that several readers rely on
 * rather than re-derive: core/headroom.ts and core/roof.ts's clip helpers take
 * +perp(edge direction) as inward. eaveLineOf() tolerates either winding, so
 * nothing else has to change; this is what makes a pasted or hand-built plane
 * behave like an authored one.
 */
export function clampRoofPlane(plane: RoofPlane): void {
  const cleaned: { x: number; y: number }[] = [];
  for (const p of plane.outline) {
    const rp = { x: Math.round(p.x), y: Math.round(p.y) };
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev.x !== rp.x || prev.y !== rp.y) cleaned.push(rp);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0]!, last = cleaned[cleaned.length - 1]!;
    if (first.x === last.x && first.y === last.y) cleaned.pop();
  }
  plane.outline = cleaned;
  const n = plane.outline.length;
  plane.eaveEdge = n > 0 ? clampInt(plane.eaveEdge, 0, n - 1) : 0;
  if (n >= 3 && polygonArea(plane.outline) < 0) {
    plane.outline = [...plane.outline].reverse();
    plane.eaveEdge = (((n - 2 - plane.eaveEdge) % n) + n) % n;
  }
  plane.eaveMm = clampInt(plane.eaveMm, ROOF_EAVE_MM_MIN, ROOF_EAVE_MM_MAX);
  plane.pitchDeg = Math.max(ROOF_PITCH_MIN, Math.min(ROOF_PITCH_MAX, isFinite(plane.pitchDeg) ? plane.pitchDeg : 0));
  if (plane.thicknessMm !== undefined) {
    plane.thicknessMm = clampInt(plane.thicknessMm, ROOF_THICKNESS_MM_MIN, ROOF_THICKNESS_MM_MAX);
  }
}
