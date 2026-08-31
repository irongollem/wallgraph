// Derived per-room fit-out figures: indicative workstation capacity, a
// daylight ratio, and indicative ventilation demand for verblijfsruimten.
//
// Nothing here is stored. A room's use lives on its RoomName -- the one
// authored per-room anchor the model has, see model/room.ts -- and these
// figures follow from it the same way core/stair.ts's stairIssues() follows
// from a stair's stored parameters: stated, flagged against an ordinary
// guideline value, never enforced. Wallgraph draws what it is given and makes
// no compliance claim (see the disclaimer).
import { Floor, PlanDoc, areaModeOf, findWall, openingHeight, roomNamesOf } from "../model/doc";
import type { Room } from "./rooms";
import type { RoomUse } from "../model/room";

/**
 * NEN 1824's commonly applied working figure for an office workstation: the
 * 4 m² desk-and-chair basis plus the standard circulation and furniture
 * supplements lands at about 7 m² in ordinary practice. A guideline value
 * read off the room area, not the norm text itself.
 */
export const WORKPLACE_MIN_M2 = 7;

/**
 * Bbl nieuwbouw ventilation figure for kantoorfunctie, dm³/s per person.
 * Indicative only -- there is nothing to check it against until a plan
 * carries services routing, so ventilationM3h below is reported, not flagged.
 */
export const VENT_DM3S_PER_PERSON = 6.5;

export type FitoutIssueCode = "workplaceNone";

export interface FitoutIssue {
  code: FitoutIssueCode;
  /** The figure as computed (m² of room area). */
  value: number;
  /** What it is being read against (m²). */
  limit: number;
}

export interface RoomFigures {
  /** Room area on the document's declared basis (areaModeOf), m². */
  areaM2: number;
  /** Indicative workstation capacity: floor(area / WORKPLACE_MIN_M2). */
  workstations: number;
  /**
   * Glazing area over floor area, as a plain ratio (0 = no glazing). This is
   * NOT the Bbl equivalent-daylight-area calculation, which weighs glazing by
   * distance and obstruction rather than summing raw opening area -- that is
   * a different, more involved figure this deliberately does not attempt, so
   * it carries no threshold to flag it against.
   */
  daylightRatio: number;
  /** Indicative ventilation demand at the workstation capacity, m³/h. */
  ventilationM3h: number;
  /** Where a figure falls outside what is ordinarily built. Empty is ordinary. */
  issues: FitoutIssue[];
}

/**
 * Fit-out figures for `room`, when the name attached to it states use
 * "verblijf". Every other use, and a room with no stated use at all, returns
 * null: there is nothing to guess a figure from, and a room with no
 * name-point cannot state a use in the first place (see model/room.ts).
 */
export function roomFigures(floor: Floor, room: Room, doc: PlanDoc): RoomFigures | null {
  if (roomUseOf(floor, room) !== "verblijf") return null;

  const areaMm2 = areaModeOf(doc) === "net" ? room.netAreaMm2 : room.areaMm2;
  const areaM2 = areaMm2 / 1e6;
  const workstations = Math.floor(areaM2 / WORKPLACE_MIN_M2);

  const daylightRatio = areaMm2 > 0 ? glazingArea(floor, room) / areaMm2 : 0;
  const ventilationM3h = workstations * VENT_DM3S_PER_PERSON * 3.6;

  const issues: FitoutIssue[] = [];
  if (workstations < 1) issues.push({ code: "workplaceNone", value: areaM2, limit: WORKPLACE_MIN_M2 });

  return { areaM2, workstations, daylightRatio, ventilationM3h, issues };
}

/** The use stated by the name attached to this room, if any. */
function roomUseOf(floor: Floor, room: Room): RoomUse | undefined {
  if (room.nameId === undefined) return undefined;
  return roomNamesOf(floor).find(rn => rn.id === room.nameId)?.use;
}

/**
 * Total window-opening area on this room's bounding walls, mm² (width times
 * openingHeight, summed). `room.boundingWallIds` is read straight off the
 * half-edge trace detectRooms() already does -- see the field's comment in
 * core/rooms.ts -- rather than re-matching the room polygon to wall
 * centerlines here.
 */
function glazingArea(floor: Floor, room: Room): number {
  let total = 0;
  for (const wallId of room.boundingWallIds) {
    const wall = findWall(floor, wallId);
    if (!wall) continue;
    for (const o of wall.openings) {
      if (o.kind === "window") total += o.width * openingHeight(o);
    }
  }
  return total;
}
