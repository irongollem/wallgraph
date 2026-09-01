// Editing the shape of a service network after it is drawn: taking one
// waypoint back out, and joining separately drawn runs into a single network.
//
// Both need RESOLVED positions -- an anchored point sits where its device
// currently stands, not where its stored x/y says -- so they live in core
// beside the derivation rather than in model/ops.ts, which works on stored
// coordinates alone. Both are called from inside store.mutate().
//
// The document-level facts a route edit must not break: a continuation names a
// point by (floorId, routeId, pointId), so absorbing a route into another, or
// removing a point, has to re-point or drop the ports that named it. Leaving a
// port pointing at a route that no longer exists is a dangling reference that
// riserMembers() silently skips -- the riser mark disappears from both storeys
// and nothing says why.
import {
  Floor, Id, PlanDoc, newId, routesOf,
} from "../model/doc";
import { continuationsOf } from "../model/continuation";
import { Route, RoutePoint, RouteSegment } from "../model/route";
import { Vec, dist, distToSeg } from "../geometry/vec";
import { resolveRoutePoints } from "./route";

/** Undirected edge key, so a duplicate segment is recognised either way round. */
const edgeKey = (a: Id, b: Id): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** How many segments meet at each point. */
export function routeDegrees(route: Route): Map<Id, number> {
  const degree = new Map<Id, number>();
  for (const segment of route.segments) {
    degree.set(segment.a, (degree.get(segment.a) ?? 0) + 1);
    degree.set(segment.b, (degree.get(segment.b) ?? 0) + 1);
  }
  return degree;
}

/**
 * A terminal state describes a free end and nothing else, so every point that
 * is no longer degree-1 loses it. Run after any edit that changes the graph.
 */
function pruneTerminals(route: Route): void {
  const degree = routeDegrees(route);
  for (const point of route.points) if ((degree.get(point.id) ?? 0) !== 1) delete point.terminal;
}

/**
 * Take one waypoint out of a route.
 *
 * A point of degree 2 DISSOLVES: its two neighbours are reconnected, so
 * removing a redundant bend from the middle of a run shortens the drawing
 * rather than cutting the run in half. The replacement segment is straight
 * even when the two it replaces were bowed -- two arcs joined end to end are
 * not one arc, and inventing a bulge here would move the run somewhere nobody
 * drew. Any other degree simply loses its incident segments, which is what
 * removing a loose end or a branch point means.
 *
 * A route left with no points at all is removed; one left with points but no
 * segments is kept, since that is exactly what a cross-floor starter is.
 * Continuation ports naming the removed point are dropped, and a link left
 * with fewer than two ports goes with them.
 */
export function removeRoutePoint(doc: PlanDoc, floorIndex: number, routeId: Id, pointId: Id): boolean {
  const floor = doc.floors[floorIndex];
  const route = floor && routesOf(floor).find(r => r.id === routeId);
  if (!floor || !route || !route.points.some(p => p.id === pointId)) return false;

  const neighbours: Id[] = [];
  for (const segment of route.segments) {
    if (segment.a === pointId) neighbours.push(segment.b);
    else if (segment.b === pointId) neighbours.push(segment.a);
  }
  route.segments = route.segments.filter(s => s.a !== pointId && s.b !== pointId);
  if (neighbours.length === 2 && neighbours[0] !== neighbours[1]) {
    const [a, b] = neighbours as [Id, Id];
    const known = new Set(route.segments.map(s => edgeKey(s.a, s.b)));
    if (!known.has(edgeKey(a, b))) route.segments.push({ id: newId("rse"), a, b });
  }
  route.points = route.points.filter(p => p.id !== pointId);
  pruneTerminals(route);

  if (doc.continuations) {
    for (const link of doc.continuations) {
      link.ports = link.ports.filter(p =>
        !(p.floorId === floor.id && p.routeId === routeId && p.pointId === pointId));
    }
    doc.continuations = doc.continuations.filter(link => link.ports.length >= 2);
  }
  if (route.points.length === 0) floor.routes = routesOf(floor).filter(r => r.id !== routeId);
  return true;
}

/**
 * How near two runs have to come for a merge to treat them as one connection,
 * mm.
 *
 * Deliberately looser than the route tool's own snap: merging is an explicit
 * request about an explicit selection ("join these two"), not something that
 * can happen by passing the cursor near a line, so the cost of being generous
 * is low and the cost of being strict is a button that refuses for reasons the
 * drawing does not show.
 */
export const ROUTE_WELD_MM = 250;

interface Waypoint { id: Id; routeIndex: number; at: Vec; anchored: boolean; endpoint: boolean }

/**
 * What merging a selection would produce, without changing anything: the
 * points and segments the surviving route would carry, which points welded
 * onto which, and whether the selection can be merged at all.
 *
 * Two ways a weld is found, in this order:
 *   1. Point to point -- two waypoints from different runs within tolerance,
 *      at least one of them a free end. Two runs that merely CROSS are left
 *      alone: a cable passing over a pipe, or over another circuit, is not a
 *      connection, and a merge must not invent one.
 *   2. Free end to segment -- an endpoint landing on another run's straight
 *      leg splits that leg and joins there, which is the T a branch drawn onto
 *      an existing trunk actually is. Bowed legs are excluded, the same cut
 *      the corridor fan makes for the same reason: projecting onto an arc is a
 *      different problem and this pass does not need it.
 *
 * `connected` is what decides whether the merge is OFFERED: every selected run
 * has to reach the surviving one through those welds, or the result would be
 * one route object holding two unrelated networks -- legal in the model, and
 * a lie about the drawing.
 */
export interface RouteMergePlan {
  baseId: Id;
  points: RoutePoint[];
  segments: RouteSegment[];
  /** Route ids folded into the base, in selection order. */
  absorbed: Id[];
  /** Old point id (per route) -> the id it survives as. */
  pointMap: Map<Id, Id>;
  sameDiscipline: boolean;
  connected: boolean;
}

export function planRouteMerge(floor: Floor, ids: readonly Id[]): RouteMergePlan | null {
  const all = routesOf(floor);
  // Selection order, so the run the property pane is editing survives and
  // keeps its tag, groep and diameter.
  const routes = ids.map(id => all.find(r => r.id === id)).filter((r): r is Route => !!r);
  const base = routes[0];
  if (!base || routes.length < 2) return null;
  const sameDiscipline = routes.every(r => r.discipline === base.discipline);

  // One flat pool of points, with fresh ids where two routes happen to share
  // one (a pasted document can), and every position resolved.
  const points: RoutePoint[] = [];
  const waypoints: Waypoint[] = [];
  const pointMap = new Map<Id, Id>();
  const segments: RouteSegment[] = [];
  const taken = new Set<Id>();
  routes.forEach((route, routeIndex) => {
    const resolved = resolveRoutePoints(floor, route);
    const degree = routeDegrees(route);
    const local = new Map<Id, Id>();
    route.points.forEach((point, i) => {
      const id = taken.has(point.id) ? newId("rp") : point.id;
      taken.add(id);
      local.set(point.id, id);
      pointMap.set(point.id, id);
      points.push({ ...point, id });
      waypoints.push({
        id, routeIndex, at: resolved[i]!,
        anchored: point.anchor !== undefined,
        endpoint: (degree.get(point.id) ?? 0) <= 1,
      });
    });
    for (const segment of route.segments) {
      segments.push({
        ...segment,
        id: newId("rse"),
        a: local.get(segment.a) ?? segment.a,
        b: local.get(segment.b) ?? segment.b,
      });
    }
  });

  // Union-find over the pooled points; joining two also records that their
  // two source runs now touch.
  const parent = new Map<Id, Id>(waypoints.map(w => [w.id, w.id]));
  const find = (x: Id): Id => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) { const next = parent.get(x)!; parent.set(x, root); x = next; }
    return root;
  };
  const routeParent = Array.from({ length: routes.length }, (_, i) => i);
  const findRoute = (i: number): number => {
    while (routeParent[i] !== i) { routeParent[i] = routeParent[routeParent[i]!]!; i = routeParent[i]!; }
    return i;
  };
  const byId = new Map(waypoints.map(w => [w.id, w]));
  const join = (a: Waypoint, b: Waypoint): void => {
    const ra = find(a.id), rb = find(b.id);
    if (ra !== rb) {
      // The surviving id prefers an anchored point -- it is the one carrying
      // the device the network actually reaches.
      const keep = byId.get(ra)!.anchored || !byId.get(rb)!.anchored ? ra : rb;
      parent.set(keep === ra ? rb : ra, keep);
    }
    const ia = findRoute(a.routeIndex), ib = findRoute(b.routeIndex);
    if (ia !== ib) routeParent[ia] = ib;
  };

  // 1. Point to point, nearest pairs first so a cluster of three ends resolves
  //    the same way however the routes were ordered.
  const pairs: Array<{ a: Waypoint; b: Waypoint; d: number }> = [];
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i]!, b = waypoints[j]!;
      if (a.routeIndex === b.routeIndex) continue;
      if (!a.endpoint && !b.endpoint) continue;
      const d = dist(a.at, b.at);
      if (d <= ROUTE_WELD_MM) pairs.push({ a, b, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  for (const pair of pairs) join(pair.a, pair.b);

  // 2. A free end landing on another run's straight leg splits that leg.
  for (const end of waypoints) {
    if (!end.endpoint) continue;
    let best: { segment: RouteSegment; d: number; owner: Waypoint } | undefined;
    for (const segment of segments) {
      const a = byId.get(segment.a), b = byId.get(segment.b);
      if (!a || !b || a.routeIndex === end.routeIndex) continue;
      if ((segment.bulge ?? 0) !== 0) continue;
      if (findRoute(a.routeIndex) === findRoute(end.routeIndex)) continue;
      const hit = distToSeg(end.at, a.at, b.at);
      if (hit.d <= ROUTE_WELD_MM && (!best || hit.d < best.d)) best = { segment, d: hit.d, owner: a };
    }
    if (!best) continue;
    const original = best.segment;
    segments.splice(segments.indexOf(original), 1,
      { id: newId("rse"), a: original.a, b: end.id },
      { id: newId("rse"), a: end.id, b: original.b });
    const ia = findRoute(best.owner.routeIndex), ib = findRoute(end.routeIndex);
    if (ia !== ib) routeParent[ia] = ib;
  }

  // Collapse onto the surviving ids.
  const survivor = (id: Id): Id => find(id);
  for (const [from, to] of pointMap) pointMap.set(from, survivor(to));
  const kept = new Map<Id, RoutePoint>();
  for (const point of points) {
    const id = survivor(point.id);
    const existing = kept.get(id);
    if (!existing) { kept.set(id, { ...point, id }); continue; }
    // Two welded points: keep the anchor and the wall attachment that exist,
    // and let a stated terminal survive so a capped end is not silently opened.
    if (!existing.anchor && point.anchor) {
      existing.anchor = point.anchor;
      delete existing.wallId; delete existing.wallT; delete existing.wallSide;
    }
    if (!existing.terminal && point.terminal) existing.terminal = point.terminal;
  }
  const mergedSegments: RouteSegment[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const a = survivor(segment.a), b = survivor(segment.b);
    if (a === b) continue;                       // a weld swallowed this leg
    const key = edgeKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    mergedSegments.push({ ...segment, a, b });
  }

  const root = findRoute(0);
  return {
    baseId: base.id,
    points: [...kept.values()],
    segments: mergedSegments,
    absorbed: routes.slice(1).map(r => r.id),
    pointMap,
    sameDiscipline,
    connected: routes.every((_, i) => findRoute(i) === root),
  };
}

/** True when the selection can be merged as it stands. */
export function canMergeRoutes(floor: Floor, ids: readonly Id[]): boolean {
  const plan = planRouteMerge(floor, ids);
  return plan !== null && plan.sameDiscipline && plan.connected;
}

/**
 * Fold every selected run into the first, welding where they touch. Returns
 * the surviving route id, or null when the selection cannot be merged.
 *
 * Continuation ports naming an absorbed route are re-pointed at the survivor
 * and at whichever point their own point welded into, so a riser that reached
 * one of the merged runs still reaches the network it is now part of.
 */
export function mergeRoutes(doc: PlanDoc, floorIndex: number, ids: readonly Id[]): Id | null {
  const floor = doc.floors[floorIndex];
  if (!floor) return null;
  const plan = planRouteMerge(floor, ids);
  if (!plan || !plan.sameDiscipline || !plan.connected) return null;
  const base = routesOf(floor).find(r => r.id === plan.baseId);
  if (!base) return null;

  base.points = plan.points;
  base.segments = plan.segments;
  pruneTerminals(base);
  floor.routes = routesOf(floor).filter(r => !plan.absorbed.includes(r.id));

  for (const link of continuationsOf(doc)) {
    for (const port of link.ports) {
      if (port.floorId !== floor.id) continue;
      if (port.routeId !== plan.baseId && !plan.absorbed.includes(port.routeId)) continue;
      port.routeId = plan.baseId;
      port.pointId = plan.pointMap.get(port.pointId) ?? port.pointId;
    }
  }
  // A weld can bring two ports of one link onto the same point; a link with
  // one distinct port left is no longer a continuation.
  if (doc.continuations) {
    for (const link of doc.continuations) {
      const seen = new Set<string>();
      link.ports = link.ports.filter(p => {
        const key = `${p.floorId}|${p.routeId}|${p.pointId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    doc.continuations = doc.continuations.filter(link => link.ports.length >= 2);
  }
  return plan.baseId;
}
