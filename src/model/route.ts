// A route as the document stores it: a manually drawn run of a building
// service -- electrical, water, ventilation or gas -- as a switchable layer over the
// plan.
//
// A route is one connected service network. Points are terminals and junctions;
// explicit segments join them, so a shared trunk is stored once and may branch
// to any number of sockets, taps, drains or air terminals. Segment curves use
// the same DXF bulge convention as a wall (see doc.ts's Wall.bulge).
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
import { serviceKeyOf, type ServiceKey } from "./service";

/**
 * The trades a run can belong to.
 *
 * Verwarming is its own discipline rather than a kind of water, because that is
 * how it is built and drawn: CV pipe is not tapwater pipe, it is sized on a
 * different basis, it is ordered separately, and an installatietekening carries
 * verwarming and sanitair as separate systems even where one installateur lays
 * both. The layer vocabulary already had a "heating" key for the symbols, which
 * no run could be drawn on -- this is what that key was always missing.
 */
export type Discipline = "electrical" | "water" | "heating" | "vent" | "gas";

export const DISCIPLINES: readonly Discipline[] =
  ["electrical", "water", "heating", "vent", "gas"];

export interface RoutePoint {
  id: Id;
  /** mm. The point's own position; authoritative unless `anchor` resolves. */
  x: number;
  y: number;
  /** A symbol instance id this point follows. See the file comment. */
  anchor?: Id;
  /** Wall attachment for concealed or surface-mounted work. `wallT` is the
   * distance from wall node a; `wallSide` selects a face for surface work. */
  wallId?: Id;
  wallT?: number;
  wallSide?: 1 | -1;
  /** Explicit state for an unanchored endpoint. Branch points need no state. */
  terminal?: RouteTerminal;
}

export interface RouteSegment {
  id: Id;
  a: Id;
  b: Id;
  /** DXF bulge from a toward b. Absent is straight. */
  bulge?: number;
}

export type RouteInstallation = "concealed" | "surface" | "floor" | "ceiling" | "free";

export const ROUTE_INSTALLATIONS: readonly RouteInstallation[] = [
  "concealed", "surface", "floor", "ceiling", "free",
];

/**
 * What an unconnected end of a run IS.
 *
 * "source" is where the service comes from, "capped" a deliberately closed
 * end. "external" is the third honest answer: a riser that leaves the top or
 * the bottom of what has been modelled -- up through a roof, down into a crawl
 * space or a street connection -- and so has no storey in this document to be
 * continued to. It is stated rather than linked to a fictional floor, and
 * unlike an unclassified end it is not incomplete: it says the drawing stops
 * here on purpose.
 */
export type RouteTerminal = "source" | "capped" | "external";

export function routeInstallation(r: Route): RouteInstallation {
  return r.installation ?? "concealed";
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

/**
 * What a water run carries. Meaningless outside discipline "water" -- an
 * electrical or vent route ignores it entirely. Absent = "koud", the
 * ordinary supply run; "warm" is the other supply leg, "afvoer" is drainage.
 * Read through routeWater(), never r.water directly, so a route that
 * predates this field reads as an ordinary cold-supply run.
 */
export type RouteWater = "koud" | "warm" | "afvoer";

export const ROUTE_WATERS: readonly RouteWater[] = ["koud", "warm", "afvoer"];

/** The run's water kind, defaulted. See RouteWater. */
export function routeWater(r: Route): RouteWater {
  return r.water ?? "koud";
}

/**
 * Nominal pipe diameter, mm, ordered in steps rather than measured -- the
 * same "offered set, not a continuum" reasoning as a door width. Supply
 * (koud/warm) runs in copper/PEX sizes; afvoer runs in PVC drain sizes, a
 * different ladder entirely since it carries waste, not pressure.
 */
export const WATER_SUPPLY_DIAMETERS: readonly number[] = [15, 22, 28];
export const WATER_DRAIN_DIAMETERS: readonly number[] = [40, 50, 75, 110];

/** The default nominal diameter, mm, for a water route of the given kind. */
export function defaultRouteDiameter(water: RouteWater): number {
  return water === "afvoer" ? 50 : 15;
}

/** The chip row's ladder for a water kind: drain sizes for afvoer, supply
 *  sizes for koud/warm. */
export function routeDiameterLadder(water: RouteWater): readonly number[] {
  return water === "afvoer" ? WATER_DRAIN_DIAMETERS : WATER_SUPPLY_DIAMETERS;
}

/** The run's nominal diameter, mm, defaulted per water kind. Water-only --
 *  see Route.diameter. */
export function routeDiameter(r: Route): number {
  return r.diameter ?? defaultRouteDiameter(routeWater(r));
}

/** Whole mm, within what the schema allows (8-200) -- the chip row offers
 *  the kind's own ladder; this is the wider bound a typed value can reach. */
export function clampRouteDiameter(n: number): number {
  return Math.max(8, Math.min(200, Math.round(isFinite(n) ? n : defaultRouteDiameter("koud"))));
}

/**
 * What a vent run carries. Meaningless outside discipline "vent" -- an
 * electrical or water route ignores it entirely. Absent = "toevoer" (supply
 * air, the ordinary case); "afvoer" is extract. Reuses water's own Dutch word
 * for the drain/extract side -- it is the correct term for extract air, the
 * same way "afvoer" already names drainage on a water run -- but the two
 * stay unambiguous everywhere else: i18n keys are routeVentToevoer/
 * routeVentAfvoer (never bare routeAfvoer*), and the DXF layer is
 * ROUTES-VENT-AFVOER, distinct from water's ROUTES-WATER-AFVOER. Read
 * through routeVent(), never r.vent directly, so a route that predates this
 * field reads as an ordinary supply run.
 */
/**
 * Which leg of the CV circuit a run is. Meaningless outside discipline
 * "heating". Absent = "aanvoer", the flow leg. Read through routeHeat().
 *
 * Two legs rather than one line: a radiator is reached by both, and a plan
 * that drew only one would be short by half the pipe in the takeoff.
 */
export type RouteHeat = "aanvoer" | "retour";

export const ROUTE_HEATS: readonly RouteHeat[] = ["aanvoer", "retour"];

/** The run's CV leg, defaulted. See RouteHeat. */
export function routeHeat(r: Route): RouteHeat {
  return r.heat ?? "aanvoer";
}

/** Ordinary CV pipe sizes, mm: 15/22 in copper, 16 in alupex. */
export const HEAT_DIAMETERS: readonly number[] = [15, 16, 22, 28];
export const HEAT_DIAMETER_DEFAULT = 16;

/** The run's CV pipe diameter, mm, defaulted. Heating-only. */
export function routeHeatDiameter(r: Route): number {
  return r.diameter ?? HEAT_DIAMETER_DEFAULT;
}

export type RouteVent = "toevoer" | "afvoer";

export const ROUTE_VENTS: readonly RouteVent[] = ["toevoer", "afvoer"];

/** The run's vent kind, defaulted. See RouteVent. */
export function routeVent(r: Route): RouteVent {
  return r.vent ?? "toevoer";
}

/**
 * Nominal duct diameter, mm, offered in steps -- the same "offered set, not
 * a continuum" reasoning as a water route's pipe diameter, but its own
 * ladder: round spiro duct sizes rather than copper/PEX or PVC drain sizes.
 */
export const VENT_DIAMETERS: readonly number[] = [100, 125, 150, 160, 180, 200];

/** The ordinary duct size absent a stated one. */
export const VENT_DIAMETER_DEFAULT = 125;

/** The run's nominal duct diameter, mm, defaulted. Vent-only -- see
 *  Route.ductDiameter. */
export function routeDuctDiameter(r: Route): number {
  return r.ductDiameter ?? VENT_DIAMETER_DEFAULT;
}

/**
 * The size the run physically occupies in plan, mm, or undefined for a
 * discipline that has none.
 *
 * A cable bundle has no meaningful plan width -- it is pulled through whatever
 * it is pulled through -- so electrical returns nothing. Everything else is a
 * pipe or a duct, and a 200 duct genuinely has to fit somewhere, which is what
 * the drawing has to be able to show. One accessor rather than a dispatch at
 * each call site: the canvas, the SVG and the property pane must agree about
 * how big a run is.
 */
export function routeBoreMm(r: Route): number | undefined {
  switch (r.discipline) {
    case "electrical": return undefined;
    case "vent": return routeDuctDiameter(r);
    case "heating": return routeHeatDiameter(r);
    case "water": return routeDiameter(r);
    default: return r.diameter ?? 15;   // gas
  }
}

/** Whole mm, within what the schema allows (63-400) -- the chip row offers
 *  VENT_DIAMETERS; this is the wider bound a typed value can still reach. */
export function clampDuctDiameter(n: number): number {
  return Math.max(63, Math.min(400, Math.round(isFinite(n) ? n : VENT_DIAMETER_DEFAULT)));
}

/**
 * The run's stated design flow, m3/h, or undefined when nobody entered one.
 * Vent-only, and unlike every other optional field on Route this has NO
 * default to fall back to: a flow figure is a fact someone measured or
 * designed to, not something that can be assumed for a run that never stated
 * one. core/fitout.ts's roomVentRouted() relies on that distinction to keep
 * its summed figure honest about what it excludes.
 */
export function routeFlow(r: Route): number | undefined {
  return r.flow;
}

/** Whole m3/h, at least 1 (the schema's own minimum) -- never called with a
 *  value meant to clear the field; that is 0/empty, handled by the caller. */
export function clampRouteFlow(n: number): number {
  return Math.max(1, Math.round(n));
}

/** The service key a run carries -- see model/service.ts. */
export function routeServiceKey(r: Route): ServiceKey {
  return serviceKeyOf(r.discipline, {
    water: routeWater(r), vent: routeVent(r), power: routeKind(r), heat: routeHeat(r),
  });
}

export interface Route {
  id: Id;
  discipline: Discipline;
  points: RoutePoint[];
  segments: RouteSegment[];
  /** Short drawing identifier, for example E-01, KW-01 or MV-T1. */
  tag?: string;
  /** Optional descriptive name, primarily for schedules and hover text. */
  name?: string;
  /** Distribution board identifier for an electrical circuit. */
  board?: string;
  /** Where the service is installed relative to the plan geometry. */
  installation?: RouteInstallation;
  /** Installation height above finished floor, mm. */
  height?: number;
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
  /**
   * Water-only: koud/warm/afvoer. See RouteWater. Meaningful only when
   * discipline is "water"; an electrical or vent route ignores it.
   */
  water?: RouteWater;
  /**
   * Water/gas nominal pipe diameter, mm. Water defaults per kind -- 15 for
   * koud/warm and 50 for afvoer; gas defaults to 15.
   */
  diameter?: number;
  /**
   * Heating-only: which leg of the CV circuit. See RouteHeat. Absent means
   * "aanvoer".
   */
  heat?: RouteHeat;
  /**
   * Vent-only: toevoer/afvoer. See RouteVent. Meaningful only when
   * discipline is "vent"; an electrical or water route ignores it.
   */
  vent?: RouteVent;
  /**
   * Vent-only: nominal duct diameter, mm. Meaningful only when discipline is
   * "vent". Absent means 125. Read through routeDuctDiameter().
   */
  ductDiameter?: number;
  /**
   * Vent-only: design flow for this run, m3/h, integer. Meaningful only when
   * discipline is "vent". Absent means not stated -- there is no default (see
   * routeFlow()), unlike every other optional field on this type.
   */
  flow?: number;
}
