// What a service run may end at, and which loose ends a newly placed device
// picks up.
//
// One statement of "an electrical run ends at an electrical symbol or at an
// appliance", read from both sides: the route tool asks it while drawing (so a
// waypoint dropped on a socket anchors to it), and a device asks it as it is
// placed or moved (so a socket dropped on a run's loose end takes that end
// over). Two copies of this rule would let the two gestures disagree about
// what is connected -- which is exactly the state a plan cannot be left in,
// since an unanchored endpoint sitting under a socket LOOKS wired and behaves
// as though it is not: the run does not follow the device when it moves, and
// the panel still calls the end loose.
import { Floor, Id, furnishingsOf, routesOf, type SymbolInstance } from "../model/doc";
import { furnishingPorts, type Furnishing } from "../model/furnishing";
import {
  Discipline, RoutePoint, RouteWater, RouteVent, RouteKind, routeServiceKey,
} from "../model/route";
import { serviceKeyOf, serviceMatches, type ServiceKey } from "../model/service";
import { getSymbol } from "../render/symbols";
import { Vec, dist, v } from "../geometry/vec";
import { resolveRoutePoints } from "./route";
import { insertRoutePoint, projectOntoLeg } from "./routegraph";
import { connectionPoint, type Device } from "./port";

/**
 * Whether a run carrying `key` may end at a symbol of this type.
 *
 * The device's own PORTS answer it. This used to be a table keyed on the
 * symbol's CATEGORY -- electrical runs end at electrical marks, gas runs at the
 * heating group -- which was both too coarse and wrong in places: a gas-point
 * sits in the water category, so a gas run could not reach the one mark that
 * exists for it, and no electrical run could reach a cv-ketel or a warmtepomp,
 * which plainly need power. A device that declares what it takes cannot be
 * wrong about it in one place and right in another.
 *
 * A symbol declaring nothing takes nothing. That is the honest reading for the
 * seven that have it -- a blusser, a blusdeken, an EHBO-kast, the signs -- and
 * the route tool's Alt override still reaches anything this did not anticipate.
 */
export function routeTakesSymbol(key: ServiceKey, type: string): boolean {
  const ports = getSymbol(type)?.ports ?? [];
  return ports.some(port => serviceMatches(port.key, key));
}

/** The same question for a piece of fit-out, answered by its own ports. */
export function routeTakesFurnishing(key: ServiceKey, fn: Furnishing): boolean {
  return furnishingPorts(fn).some(port => serviceMatches(port.key, key));
}

/**
 * How near a device has to land to a run's loose end for that end to be taken
 * as its connection, mm.
 *
 * Generous on purpose, and not a screen distance: a concealed run hugs the
 * wall CENTERLINE while a wall-mounted socket's anchor sits on the wall FACE,
 * so the two are half a wall apart even when they are drawn as the same
 * connection. A device on the same wall as the endpoint is matched on the
 * wall instead (see below), which covers a wall thicker than this figure.
 */
export const ROUTE_LINK_MM = 200;

/**
 * Every loose, unanchored endpoint this device stands on -- the ends a
 * placement or a drop is about to take over.
 *
 * Only DEGREE <= 1 points, and only unanchored ones: a junction in the middle
 * of a trunk is not something a device placed nearby should silently capture,
 * and an endpoint already following another device keeps it. A point on the
 * same wall as the device matches on the wall regardless of the plan distance,
 * which is what makes a concealed run's centerline endpoint and the socket on
 * the face in front of it read as one connection.
 *
 * Called from inside store.mutate(), in the same mutation that places or moves
 * the device, so a link is one undo step with the placement that caused it.
 */
export function routeEndsUnder(
  floor: Floor, device: Device & { wallId?: Id },
  takes: (key: ServiceKey) => boolean,
): RoutePoint[] {
  const found: RoutePoint[] = [];
  for (const route of routesOf(floor)) {
    const key = routeServiceKey(route);
    if (!takes(key)) continue;
    // Measured from where THIS run would attach, not from the device's anchor:
    // a run drawn to a bath's waste is at the bath's waste, which is most of a
    // bath away from the wall the bath is anchored to.
    const at = connectionPoint(device, routeServiceKey(route));
    const degree = new Map<Id, number>();
    for (const segment of route.segments) {
      degree.set(segment.a, (degree.get(segment.a) ?? 0) + 1);
      degree.set(segment.b, (degree.get(segment.b) ?? 0) + 1);
    }
    const resolved = resolveRoutePoints(floor, route);
    for (let i = 0; i < route.points.length; i++) {
      const point = route.points[i]!;
      if (point.anchor || (degree.get(point.id) ?? 0) > 1) continue;
      const sameWall = device.wallId !== undefined && point.wallId === device.wallId;
      const wall = sameWall ? floor.walls.find(w => w.id === device.wallId) : undefined;
      // A shared wall permits the perpendicular gap from its centreline to
      // its face, but not an unlimited distance along the wall.
      const reach = ROUTE_LINK_MM + (wall?.thickness ?? 0) / 2;
      if (dist(resolved[i]!, at) > reach) continue;
      found.push(point);
    }
  }
  return found;
}

/**
 * One leg of a run that a device stands ON, and where along it.
 *
 * Not the same gesture as taking over a loose end: nothing here is an end. A
 * socket placed part-way along a circuit that carries on past it, a tap on a
 * cold-water run, a valve on a gas line -- the run reaches the device and
 * continues, so what the drawing needs is a junction spliced INTO the leg,
 * not a branch drawn to it.
 */
export interface RouteLegUnder {
  routeId: Id;
  segmentId: Id;
  /** Fraction from the segment's a to its b -- sweep fraction on a bowed leg. */
  t: number;
  /** Where on the leg the device projects, world mm. */
  at: Vec;
  distanceMm: number;
}

/**
 * The legs of compatible runs this device stands on, nearest first, at most
 * one per run.
 *
 * Measured against the STORED geometry, never the fanned resolution the canvas
 * draws: the corridor lanes in core/route.ts spread bundled runs apart for
 * legibility, and two circuits stored along one wall centerline are equally
 * under a socket placed on it however far apart they happen to be drawn. Which
 * run a device joins must not depend on a drawing device -- and when two of
 * them really are equally under it, the honest answer is two candidates, which
 * is what the panel then offers.
 *
 * A run the device is already connected to is left out, and so is a leg whose
 * own endpoint is the device: that is a connection, not a leg to split.
 * Endpoints are excluded near the ends of a leg too, so a device sitting on a
 * corner of the run splits nothing -- routeEndsUnder() has already offered to
 * take that corner over, and inserting a second point a millimetre from it
 * would leave a zero-length leg.
 */
export function routeLegsUnder(
  floor: Floor, device: Device & { wallId?: Id },
  takes: (key: ServiceKey) => boolean,
): RouteLegUnder[] {
  const found: RouteLegUnder[] = [];
  for (const route of routesOf(floor)) {
    const key = routeServiceKey(route);
    if (!takes(key)) continue;
    if (route.points.some(p => p.anchor === device.id)) continue;
    const at = connectionPoint(device, key);
    const resolved = resolveRoutePoints(floor, route);
    const byId = new Map(route.points.map((p, i) => [p.id, { point: p, at: resolved[i]! }]));
    let best: RouteLegUnder | undefined;
    for (const segment of route.segments) {
      const a = byId.get(segment.a), b = byId.get(segment.b);
      if (!a || !b) continue;
      const hit = projectOntoLeg(a.at, b.at, segment.bulge ?? 0, at);
      if (!hit) continue;
      // Near either end is the endpoint's business, not a split.
      if (hit.t <= END_MARGIN || hit.t >= 1 - END_MARGIN) continue;
      const sameWall = device.wallId !== undefined
        && a.point.wallId === device.wallId && b.point.wallId === device.wallId;
      if (!sameWall && hit.distanceMm > ROUTE_LINK_MM) continue;
      if (best && best.distanceMm <= hit.distanceMm) continue;
      best = { routeId: route.id, segmentId: segment.id, t: hit.t, at: hit.at, distanceMm: hit.distanceMm };
    }
    if (best) found.push(best);
  }
  return found.sort((x, y) => x.distanceMm - y.distanceMm);
}

/** How much of each end of a leg belongs to its endpoints rather than to a
 *  split, as a fraction of the leg. */
const END_MARGIN = 0.02;

/** Apply what routeEndsUnder found. Returns how many ends changed hands. */
export function linkDeviceToRouteEnds(
  floor: Floor, device: Device & { wallId?: Id },
  takes: (key: ServiceKey) => boolean,
): number {
  const ends = routeEndsUnder(floor, device, takes);
  for (const point of ends) {
    point.anchor = device.id;
    delete point.wallId; delete point.wallT; delete point.wallSide;
  }
  return ends.length;
}

/**
 * Every loose endpoint a symbol placed at this spot would pick up, without
 * changing anything -- what the panel offers as an explicit "link to" action
 * for a run whose end was drawn before the device that belongs on it.
 */
export interface NearbyDevice { id: Id; kind: "symbol" | "furnishing"; name: string }

export function nearestDeviceFor(
  floor: Floor,
  route: { discipline: Discipline; water?: RouteWater; vent?: RouteVent; kind?: RouteKind },
  at: { x: number; y: number },
  within = ROUTE_LINK_MM * 4,
): NearbyDevice | null {
  const water = route.water ?? "koud";
  const key = serviceKeyOf(route.discipline, { water, vent: route.vent, power: route.kind });
  const found: Array<NearbyDevice & { d: number }> = [];
  const consider = (named: NearbyDevice, device: Device): void => {
    const d = dist(connectionPoint(device, key), v(at.x, at.y));
    if (d <= within) found.push({ ...named, d });
  };
  for (const s of floor.symbols as SymbolInstance[]) {
    if (routeTakesSymbol(key, s.type)) consider({ id: s.id, kind: "symbol", name: s.type }, s);
  }
  for (const fn of furnishingsOf(floor)) {
    if (routeTakesFurnishing(key, fn)) consider({ id: fn.id, kind: "furnishing", name: fn.mark ?? fn.form }, fn);
  }
  found.sort((a, b) => a.d - b.d);
  const best = found[0];
  return best ? { id: best.id, kind: best.kind, name: best.name } : null;
}

/**
 * Connect a device to the network around it, as far as it can be done without
 * asking: every loose end it stands on is taken over, and if it stands on the
 * line of exactly ONE compatible run it is spliced into that run as a junction.
 *
 * Two or more runs under it is where this stops. Which circuit a socket belongs
 * to is not something the drawing knows -- two runs stored along the same wall
 * are equally under it -- and guessing would put the device on a circuit nobody
 * chose while looking exactly like a deliberate connection. The panel offers
 * the candidates instead (see deviceConnections()).
 *
 * Called from inside store.mutate(), in the same mutation that places or moves
 * the device, so the connection is one undo step with the placement that caused
 * it. Returns how many connections were made.
 */
export function connectDevice(
  floor: Floor, device: Device & { wallId?: Id },
  takes: (key: ServiceKey) => boolean,
): number {
  const linked = linkDeviceToRouteEnds(floor, device, takes);
  if (linked > 0) return linked;
  const legs = routeLegsUnder(floor, device, takes);
  if (legs.length !== 1) return 0;
  const leg = legs[0]!;
  return insertRoutePoint(floor, leg.routeId, leg.segmentId, leg.t, device.id) ? 1 : 0;
}

/** Whether connectDevice() would do anything -- asked before opening a
 *  mutation, so a placement that connected nothing pushes no undo step. */
export function deviceConnects(
  floor: Floor, device: Device & { wallId?: Id },
  takes: (key: ServiceKey) => boolean,
): boolean {
  return routeEndsUnder(floor, device, takes).length > 0
    || routeLegsUnder(floor, device, takes).length === 1;
}
