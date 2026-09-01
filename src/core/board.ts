// Derived groepenkast geometry, and what a run's groep actually is.
//
// A groep's connection point is not stored: it follows the kast's placement and
// its position in the kast's own list, so moving the meterkast moves every
// point a circuit hangs off, and adding a groep re-fans the rest — the same
// rule that keeps a room's boundary out of the document.
import { Floor, Id, routesOf, type SymbolInstance } from "../model/doc";
import { BoardGroup, boardGroups, boardOf, groupLocalPoint } from "../model/board";
import type { Route } from "../model/route";
import { getSymbol } from "../render/symbols";
import { worldPoint } from "./placed";
import type { Vec } from "../geometry/vec";

/** Every symbol on the floor that is a groepenkast. */
export function boardsOn(floor: Floor): SymbolInstance[] {
  return floor.symbols.filter(s => s.type === BOARD_TYPE);
}

/** The one symbol type that carries board data. */
export const BOARD_TYPE = "dist-board";

export interface ResolvedGroup {
  board: SymbolInstance;
  group: BoardGroup;
  /** Where a cable hooks on, world mm. */
  at: Vec;
}

/** The groepen of one kast, each with the point a run connects to. */
export function resolveBoard(board: SymbolInstance): ResolvedGroup[] {
  const groups = boardGroups(board);
  const depth = getSymbol(board.type)?.depth ?? 0;
  return groups.map((group, index) => ({
    board, group,
    at: worldPoint(board, groupLocalPoint(index, groups.length, depth)),
  }));
}

/** Every groep on the floor, across every kast. */
export function resolveBoards(floor: Floor): ResolvedGroup[] {
  return boardsOn(floor).flatMap(resolveBoard);
}

/** The groep with this id, wherever it is. */
export function groupById(floor: Floor, id: Id): ResolvedGroup | undefined {
  return resolveBoards(floor).find(g => g.group.id === id);
}

/**
 * The kast groep a run is connected to, or undefined for one that is not.
 *
 * A run is connected by ANCHORING a waypoint to the groep, which is the same
 * mechanism a socket uses — so the connection is a fact about the drawing
 * rather than two strings that happen to match. Only the first is reported: a
 * run fed from two groepen is not something this model can state, and silently
 * picking one of them would be worse than naming the first.
 */
export function routeGroupOf(floor: Floor, route: Route): ResolvedGroup | undefined {
  for (const point of route.points) {
    if (!point.anchor) continue;
    const found = groupById(floor, point.anchor);
    if (found) return found;
  }
  return undefined;
}

/**
 * The groep a run belongs to: the kast's own label where it is connected to
 * one, the typed field otherwise.
 *
 * Derived beats stored, the way a room's area does. A run drawn to groep 3 of
 * the meterkast IS on groep 3, and renaming that groep in the kast renames it
 * on every run hanging off it — which is the point of declaring groepen at all.
 */
export function routeGroup(floor: Floor, route: Route): string | undefined {
  const connected = routeGroupOf(floor, route);
  if (connected) return connected.group.name;
  const typed = route.group?.trim();
  return typed ? typed : undefined;
}

/** The kast a run is fed from, derived the same way. */
export function routeBoard(floor: Floor, route: Route): string | undefined {
  const connected = routeGroupOf(floor, route);
  if (connected) return boardOf(connected.board).name?.trim() || undefined;
  const typed = route.board?.trim();
  return typed ? typed : undefined;
}

/** Every distinct groep name in use on the floor, kast-declared first. */
export function groupNames(floor: Floor): string[] {
  const out: string[] = [];
  for (const resolved of resolveBoards(floor)) {
    if (resolved.group.name && !out.includes(resolved.group.name)) out.push(resolved.group.name);
  }
  for (const route of routesOf(floor)) {
    const name = routeGroup(floor, route);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * How many runs hang off each groep of a kast. A groep nobody has wired is not
 * an error — a kast is often drawn before its circuits — but it is worth
 * showing, since an empty groep on a finished drawing is usually one that was
 * planned and forgotten.
 */
export function groupLoad(floor: Floor, board: SymbolInstance): Map<Id, number> {
  const counts = new Map<Id, number>(boardGroups(board).map(g => [g.id, 0]));
  for (const route of routesOf(floor)) {
    for (const point of route.points) {
      if (!point.anchor || !counts.has(point.anchor)) continue;
      counts.set(point.anchor, (counts.get(point.anchor) ?? 0) + 1);
      break; // one run counts once against a groep, however often it touches it
    }
  }
  return counts;
}
