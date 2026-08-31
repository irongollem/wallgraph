// A route as the document stores it: a manually drawn run of a building
// service -- electrical, water, ventilation -- as a switchable layer over the
// plan.
//
// A route is a polyline of waypoints, same DXF bulge convention as a wall
// (see doc.ts's Wall.bulge): straight by default, one bulge per point for the
// segment leaving it toward the next. There is no thickness and no material --
// this is the manual-routing core (issue #25); discipline metadata beyond the
// three-way split below, and any automatic routing, are follow-up work.
//
// A waypoint MAY follow a symbol instance (`anchor`) instead of standing on
// its own stored x/y. The document does not chase the symbol: nothing writes
// the point's x/y when the symbol moves, and no mutation keeps the two in
// sync. Instead `resolveRoutePoints()` in core/route.ts reads the symbol's
// CURRENT position at derive time, the same way a room's boundary is derived
// from the wall graph on every revision rather than stored. A dangling anchor
// (the symbol was deleted) falls back to the point's own stored x/y -- which
// is why deleting a symbol has to write that fallback position into every
// point that was following it, in the same mutation that removes the symbol
// (see Tools.deleteSelected in input/tools.ts): otherwise the route would
// jump back to wherever it was FIRST anchored rather than where the symbol
// last stood.
import type { Id } from "./doc";

export type Discipline = "electrical" | "water" | "vent";

export const DISCIPLINES: readonly Discipline[] = ["electrical", "water", "vent"];

export interface RoutePoint {
  /** mm. The point's own position; authoritative unless `anchor` resolves. */
  x: number;
  y: number;
  /** DXF bulge for the segment leaving THIS point toward the next one. 0 or
   *  absent is straight. Meaningless on a route's last point. */
  bulge?: number;
  /** A symbol instance id this point follows. See the file comment. */
  anchor?: Id;
}

export interface Route {
  id: Id;
  discipline: Discipline;
  points: RoutePoint[];
}
