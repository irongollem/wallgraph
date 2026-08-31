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

/**
 * What an electrical run carries. Meaningless outside discipline "electrical"
 * -- a water or vent route ignores it entirely. Absent = "power", the
 * ordinary case (a socket or switch circuit); "utp"/"coax" are data runs.
 * Read through routeKind(), never r.kind directly, so a route that predates
 * this field reads as an ordinary power run.
 */
export type RouteKind = "power" | "utp" | "coax";

export const ROUTE_KINDS: readonly RouteKind[] = ["power", "utp", "coax"];

/** The run's kind, defaulted. See RouteKind. */
export function routeKind(r: Route): RouteKind {
  return r.kind ?? "power";
}

/** Aders on the ordinary geschakelde/wandcontactdoos run. */
export const ROUTE_VEINS_DEFAULT = 3;

/** Aantal aders, defaulted. Power runs only -- see Route.veins. */
export function routeVeins(r: Route): number {
  return r.veins ?? ROUTE_VEINS_DEFAULT;
}

/**
 * Whole aders, within what the schema allows. The chip row offers [2,3,4,5]
 * as the ordinary set; this is the wider bound a typed value can still reach.
 */
export function clampRouteVeins(n: number): number {
  return Math.max(2, Math.min(8, Math.round(isFinite(n) ? n : ROUTE_VEINS_DEFAULT)));
}

export interface Route {
  id: Id;
  discipline: Discipline;
  points: RoutePoint[];
  /**
   * Electrical-only: what the run carries. See RouteKind. Meaningful only
   * when discipline is "electrical"; a water or vent route ignores it.
   */
  kind?: RouteKind;
  /**
   * Aantal aders (conductor count). Meaningful for power runs only (kind is
   * "power" or absent) -- a data run's pairs follow from `spec` instead.
   * Absent means 3, the ordinary geschakelde/wandcontactdoos run. Read
   * through routeVeins().
   */
  veins?: number;
  /**
   * Groep, as the meterkast labels it ("1", "2", "K1"). Free text, short.
   * Meaningful for power runs; a data run does not belong to a groep.
   */
  group?: string;
  /**
   * Data-cable spec ("Cat6"). Meaningful for kind "utp" or "coax"; a power
   * run ignores it.
   */
  spec?: string;
}
