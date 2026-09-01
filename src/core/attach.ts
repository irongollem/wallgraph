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
import { furnishingClass, type Furnishing } from "../model/furnishing";
import { Discipline, RoutePoint, RouteWater, routeWater } from "../model/route";
import { getSymbol } from "../render/symbols";
import { dist, v } from "../geometry/vec";
import { resolveRoutePoints } from "./route";

/** Whether a run of this discipline ends at a symbol of this type. */
export function routeTakesSymbol(discipline: Discipline, type: string): boolean {
  const category = getSymbol(type)?.category;
  if (!category) return false;
  return (discipline === "electrical" && category === "electrical")
    || (discipline === "water" && category === "water")
    || (discipline === "vent" && category === "ventilation")
    || (discipline === "gas" && category === "heating");
}

/**
 * Whether a run of this discipline ends at this piece of fit-out. Drainage
 * reaches the fixtures; supply reaches the appliances too, which is why the
 * water kind is part of the question.
 */
export function routeTakesFurnishing(
  discipline: Discipline, water: RouteWater, fn: Furnishing,
): boolean {
  const trade = furnishingClass(fn.form);
  return (discipline === "water" && trade === "sanitary")
    || (discipline === "water" && water !== "afvoer" && trade === "appliance")
    || (discipline === "electrical" && trade === "appliance")
    || (discipline === "vent" && fn.form === "appliance" && fn.mark === "hood")
    || (discipline === "gas" && fn.form === "appliance");
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
  floor: Floor, device: { id: Id; x: number; y: number; wallId?: Id },
  takes: (discipline: Discipline, water: RouteWater) => boolean,
): RoutePoint[] {
  const found: RoutePoint[] = [];
  const at = v(device.x, device.y);
  for (const route of routesOf(floor)) {
    if (!takes(route.discipline, routeWater(route))) continue;
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
      if (!sameWall && dist(resolved[i]!, at) > ROUTE_LINK_MM) continue;
      found.push(point);
    }
  }
  return found;
}

/** Apply what routeEndsUnder found. Returns how many ends changed hands. */
export function linkDeviceToRouteEnds(
  floor: Floor, device: { id: Id; x: number; y: number; wallId?: Id },
  takes: (discipline: Discipline, water: RouteWater) => boolean,
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
  floor: Floor, route: { discipline: Discipline; water?: RouteWater }, at: { x: number; y: number },
  within = ROUTE_LINK_MM * 4,
): NearbyDevice | null {
  const water = route.water ?? "koud";
  const found: Array<NearbyDevice & { d: number }> = [];
  const consider = (device: NearbyDevice, x: number, y: number): void => {
    const d = dist(v(x, y), v(at.x, at.y));
    if (d <= within) found.push({ ...device, d });
  };
  for (const s of floor.symbols as SymbolInstance[]) {
    if (routeTakesSymbol(route.discipline, s.type))
      consider({ id: s.id, kind: "symbol", name: s.type }, s.x, s.y);
  }
  for (const fn of furnishingsOf(floor)) {
    if (routeTakesFurnishing(route.discipline, water, fn))
      consider({ id: fn.id, kind: "furnishing", name: fn.mark ?? fn.form }, fn.x, fn.y);
  }
  found.sort((a, b) => a.d - b.d);
  const best = found[0];
  return best ? { id: best.id, kind: best.kind, name: best.name } : null;
}
