// A room name as the document stores it.
//
// Rooms themselves are derived — detectRooms() walks the wall graph and finds
// them, so there is nothing in the document to hang a name on, and inventing a
// stored room would put derived geometry back in the document (see CLAUDE.md).
//
// What IS authored is the name and where it was written. So that is what this
// stores: a point and a word. Which room it names follows from the point at
// render time, the same way everything else visible follows from the graph. Move
// a wall so the point falls in the next room and the name goes with the point,
// which is the honest outcome — the alternative is a name silently attached to a
// face that no longer exists.
import type { Id } from "./doc";

/**
 * What a room is used for, in the Bouwbesluit sense the fit-out figures in
 * core/fitout.ts read: only "verblijf" (verblijfsruimte) gets workstation,
 * daylight and ventilation figures. The other three are stated so a plan can
 * say what a space is without implying it takes fit-out figures it does not.
 */
export type RoomUse = "verblijf" | "verkeer" | "sanitair" | "techniek";

export const ROOM_USES: readonly RoomUse[] = ["verblijf", "verkeer", "sanitair", "techniek"];

export interface RoomName {
  id: Id;
  /** A point inside the room, world mm. Integer, like every stored coordinate. */
  x: number;
  y: number;
  name: string;
  /**
   * What the room is used for. Rides on the name rather than being its own
   * stored fact because RoomName is the only authored per-room anchor this
   * model has -- there is no stored room to hang it on instead (rooms are
   * derived, see core/rooms.ts). A room with no name-point therefore cannot
   * state a use, and gets no fit-out figures; that is the honest outcome, not
   * a gap to fill by guessing. Absent means "not stated".
   */
  use?: RoomUse;
  /**
   * Finished ceiling height in mm above the floor, where this room has a
   * suspended ceiling of its own. Rides on the name for the reason `use` does:
   * there is no stored room to hang it on, so a room with no name-point cannot
   * state one and falls back to the storey's (Floor.ceilingMm). Absent means
   * "not stated", not "no ceiling" -- the storey still answers.
   *
   * A finish, like the storey's: it changes only the wall face area
   * core/surface.ts reports, never the graph, the areas or a stair.
   */
  ceilingMm?: number;
}

/**
 * Names offered as completions in the room list. A plattegrond names the same
 * dozen rooms in nearly every house, and typing "Woonkamer" for the fifth time
 * is the kind of work the tool should already have done. Free text stays
 * available: the list is a datalist, not a closed set.
 *
 * These are translation keys (`room.<id>`), so adding one needs its name in both
 * languages or the i18n test fails.
 */
export const ROOM_NAMES: readonly string[] = [
  "woonkamer", "keuken", "hal", "gang", "toilet", "badkamer", "slaapkamer",
  "kinderkamer", "werkkamer", "berging", "bijkeuken", "washok", "meterkast",
  "garage", "zolder", "kelder", "overloop", "entree", "terras", "balkon",
];

/** Height of a room name on the drawing, in screen pixels. */
export const ROOM_NAME_PX = 13;
