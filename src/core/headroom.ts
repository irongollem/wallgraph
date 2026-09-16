// NEN 2580 headroom: the part of a room's floor a sloped roof leaves under
// 1500 mm, and the same figure folded into a stair's own clearance report.
// Reported, never enforced -- nothing here decides whether a room passes.
import { Floor } from "../model/doc";
import { RoofPlane, roofPlanesOf } from "../model/roof";
import { roofUndersideAt, eaveLineOf } from "./roof";
import { stairSteps } from "./stair3d";
import type { Stair } from "../model/stair";
import { Vec, v, add, sub, scale, norm, perp, polygonArea, clipHalfPlane } from "../geometry/vec";

const DEG = Math.PI / 180;

/** NEN 2580's own threshold: floor area below this is not counted toward GO. */
export const HEADROOM_MIN_MM = 1500;

/**
 * `subject` clipped to `clip`, one half-plane per edge of `clip` -- the same
 * convex-clip approximation core/solids.ts's plateHoles() and
 * core/roofsuggest.ts's ridge picking already accept for a building or a
 * roof-plane outline: exact when `clip` is convex, an over-cut otherwise.
 * `clip` is read with RoofPlane.outline's own winding (counter-clockwise
 * under y-down), so +perp(edge direction) is inward.
 */
function clipToOutline(subject: Vec[], clip: readonly { x: number; y: number }[]): Vec[] {
  let out = subject;
  const n = clip.length;
  for (let i = 0; i < n && out.length >= 3; i++) {
    const a = v(clip[i]!.x, clip[i]!.y), b = v(clip[(i + 1) % n]!.x, clip[(i + 1) % n]!.y);
    const edge = sub(b, a);
    if (Math.hypot(edge.x, edge.y) < 1e-9) continue;
    out = clipHalfPlane(out, a, perp(norm(edge)));
  }
  return out;
}

/**
 * The part of `netPoly` where THIS plane's own underside falls below
 * HEADROOM_MIN_MM: the room clipped to the plane's outline, then clipped
 * again at the line where the plane's underside equals 1500 mm -- parallel
 * to the eave, since the underside is affine in the distance from it (see
 * core/roof.ts). Exact, not sampled. A flat plane (pitch 0) has no such line:
 * its underside is one figure everywhere, so the clipped region is either
 * kept whole or dropped whole.
 */
function lowHeadroomUnder(netPoly: Vec[], plane: RoofPlane): Vec[] {
  if (plane.outline.length < 3) return [];
  const clipped = clipToOutline(netPoly, plane.outline);
  if (clipped.length < 3) return [];
  const k = Math.tan(plane.pitchDeg * DEG);
  if (k <= 1e-9) return plane.eaveMm < HEADROOM_MIN_MM ? clipped : [];
  // underside(p) = eaveMm + distanceIntoOutline(p) * k < 1500
  //   <=> distanceIntoOutline(p) < (1500 - eaveMm) / k
  const eave = eaveLineOf(plane);
  const cutoff = (HEADROOM_MIN_MM - plane.eaveMm) / k;
  const o = add(eave.a, scale(eave.inward, cutoff));
  const low = clipHalfPlane(clipped, o, scale(eave.inward, -1));
  return low.length >= 3 ? low : [];
}

/**
 * A room's own low-headroom area, mm²: the floor under HEADROOM_MIN_MM,
 * measured against the LOWER of the roof underside and the room's stated
 * ceiling at every point.
 *
 * A stated ceiling (`Room.ceilingMm` -- the room's own where its name gives
 * one, the storey's otherwise, see core/rooms.ts) is one figure over the whole
 * room, so where it is itself below 1500 the whole floor is low whatever the
 * roof does, and where it is at or above 1500 it lowers nothing the roof has
 * not already lowered. That is why the two cases are exact rather than
 * sampled.
 *
 * The roof part is the sum of what each plane leaves under HEADROOM_MIN_MM.
 * Summed rather than unioned, which is exact for planes that partition the
 * storey (core/roofsuggest.ts's gable and lean-to cases, meeting only along a
 * shared edge) and over-counts only where two AUTHORED planes are made to
 * overlap on purpose (a hip drawn with deliberately overlapping outlines) --
 * the same trade-off roofUndersideAt() accepts for the ridge itself, and the
 * one core/energy.ts's `overlappingRoof` flags.
 */
export function roomLowHeadroom(f: Floor, room: { netPoly: Vec[]; ceilingMm?: number }): number {
  if (room.netPoly.length < 3) return 0;
  if (room.ceilingMm !== undefined && room.ceilingMm < HEADROOM_MIN_MM) {
    return Math.abs(polygonArea(room.netPoly));
  }
  const planes = roofPlanesOf(f);
  if (planes.length === 0) return 0;
  let area = 0;
  for (const plane of planes) area += Math.abs(polygonArea(lowHeadroomUnder(room.netPoly, plane)));
  return area;
}

/**
 * The tightest clearance between a stair's own flight and the roof over it,
 * mm -- the roof folded into the existing STAIR_HEADROOM_MM figure
 * (core/stair3d.ts), which only ever checks the slab above. Sampled at every
 * step's own footprint vertices against roofUndersideAt(): the minimum over a
 * concave footprint can be missed between vertices, the same approximation
 * core/energy.ts's overhang check accepts for a room outline. Negative means
 * the roof's underside actually falls below the tread there -- a real clash,
 * not just a tight fit. Null when the floor has no roof planes, or the
 * flight never comes under one: reported only where there is something to
 * report, never enforced.
 */
export function stairRoofClearanceMm(f: Floor, s: Stair): number | null {
  if (roofPlanesOf(f).length === 0) return null;
  let best: number | null = null;
  for (const step of stairSteps(f, s)) {
    for (const p of step.poly) {
      const underside = roofUndersideAt(f, p);
      if (underside === null) continue;
      const clearance = underside - step.z1;
      if (best === null || clearance < best) best = clearance;
    }
  }
  return best === null ? null : Math.round(best);
}
