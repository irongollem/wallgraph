// A groepenkast: what it is called, and the groepen it carries.
//
// Data on the symbol instance rather than a document object of its own, the
// way a toilet's cistern and a basin's bowl count ride on Furnishing. The plan
// MARK of a verdeelkast is one fixed picture at any scale — that is what makes
// it a symbol — and what varies is not its size but what it distributes. Only
// read for type "dist-board".
//
// Why it is here at all: a groep is the identity an electrician selects by, and
// it was free text on every run. Two runs typed "1" and "01" were two groepen;
// a run typed "3" belonged to a kast that might not exist. A groep the kast
// declares is a thing a run can be connected TO, so the run's groep and board
// stop being strings the drawing hopes agree.
import { newId, type Id } from "./doc";

export interface BoardGroup {
  id: Id;
  /** What the kast labels it: "1", "2", "K1". Short, and the kast's own. */
  name: string;
  /** What it feeds, for the schedule. Absent means nobody said. */
  label?: string;
}

export interface BoardData {
  /** What the drawing calls this kast: "MK", "OK1". */
  name?: string;
  /** The groepen it distributes, in the order the kast lists them. */
  groups: BoardGroup[];
}

/** The kast's data, defaulted — a board symbol that carries none is an empty
 *  kast, not a missing one. */
export function boardOf(symbol: { board?: BoardData }): BoardData {
  return symbol.board ?? { groups: [] };
}

export const boardGroups = (symbol: { board?: BoardData }): BoardGroup[] =>
  boardOf(symbol).groups;

/**
 * A new groep, named for the position it takes. Numbering is a convenience for
 * the first ones, not a rule: a kast renumbered by hand keeps whatever names
 * were typed, and nothing here renumbers on a delete — groep 4 does not become
 * groep 3 because groep 2 was removed, since the kast's own labels do not.
 */
export function nextGroup(groups: readonly BoardGroup[]): BoardGroup {
  const used = new Set(groups.map(g => g.name));
  let n = 1;
  while (used.has(String(n))) n++;
  return { id: newId("bg"), name: String(n) };
}

/** Longest a kast or groep name may be. Long enough for "MK-KELDER". */
export const BOARD_NAME_MAX = 16;

export const clampBoardName = (s: string): string => s.trim().slice(0, BOARD_NAME_MAX);

/**
 * How far apart the groep connection points sit along the kast's front edge,
 * mm, and how wide the fan may grow.
 *
 * The points are EDITING handles as much as drawing: something to hook a cable
 * onto, one per groep, spread wide enough to be clickable at ordinary zoom. A
 * kast of twenty groepen would crowd them inside a 500 mm mark, so the fan is
 * allowed to grow past the mark's own width rather than the points overlapping
 * — the mark stays the mark, and the handles stay reachable.
 */
export const GROUP_PITCH_MM = 120;
/** The fan is centred on the kast, so this is half of its widest span. */
export const GROUP_SPAN_MAX_MM = 2400;

/**
 * Where a groep's connection point sits in the kast's own millimetres: along
 * the room-facing edge, `depth` out from the anchor, fanned about the centre.
 * One groep sits on the centreline.
 */
export function groupLocalPoint(
  index: number, count: number, depth: number,
): { x: number; y: number } {
  const pitch = Math.min(GROUP_PITCH_MM, count > 1 ? (GROUP_SPAN_MAX_MM * 2) / (count - 1) : GROUP_PITCH_MM);
  const span = (count - 1) * pitch;
  return { x: -span / 2 + index * pitch, y: depth };
}
