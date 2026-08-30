// A room name as the document stores it.
//
// Rooms themselves are derived — detectRooms() walks the wall graph and finds
// them, so there is nothing in the document to hang a name on, and inventing a
// stored room would put derived geometry back in the document (see PLAN.md).
//
// What IS authored is the name and where it was written. So that is what this
// stores: a point and a word. Which room it names follows from the point at
// render time, the same way everything else visible follows from the graph. Move
// a wall so the point falls in the next room and the name goes with the point,
// which is the honest outcome — the alternative is a name silently attached to a
// face that no longer exists.
import type { Id } from "./doc";

export interface RoomName {
  id: Id;
  /** A point inside the room, world mm. Integer, like every stored coordinate. */
  x: number;
  y: number;
  name: string;
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
