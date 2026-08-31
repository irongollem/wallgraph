// Derived route geometry. Nothing here is stored beyond the route's own
// waypoints (model/route.ts): where an anchored point currently sits, how
// long the run is, and where several routes bundle through the same corridor
// are all recomputed on every call, exactly like a room's boundary.
import { Floor, routesOf } from "../model/doc";
import {
  Route, RouteKind, routeKind, routeVeins, RouteWater, routeWater, routeDiameter, ROUTE_WATERS,
  routeInstallation,
} from "../model/route";
import { Vec, v, add, sub, scale, cross, dot, dist, perp, distToSeg } from "../geometry/vec";
import { arcLength, arcFlatten, arcPointAt, arcTangentAt } from "../geometry/arc";
import { wallLength } from "../model/ops";

/**
 * A route's waypoints resolved to world mm: an anchored point reads the
 * symbol's CURRENT x/y, a dangling anchor (the symbol is gone) or a free
 * point reads its own stored x/y. Purely derived -- nothing is written back,
 * so a route and the symbols it follows can each be edited without either
 * mutation racing to keep the other in sync. See model/route.ts.
 */
export function resolveRoutePoints(floor: Floor, route: Route): Vec[] {
  return route.points.map(p => {
    if (p.anchor) {
      const sym = floor.symbols.find(s => s.id === p.anchor);
      if (sym) return v(sym.x, sym.y);
    }
    if (p.wallId && p.wallT !== undefined) {
      const wall = floor.walls.find(w => w.id === p.wallId);
      if (wall) {
        const a = floor.nodes.find(n => n.id === wall.a), b = floor.nodes.find(n => n.id === wall.b);
        if (a && b) {
          const length = wallLength(floor, wall);
          const frac = length > 0 ? Math.max(0, Math.min(1, p.wallT / length)) : 0;
          const A = v(a.x, a.y), B = v(b.x, b.y);
          const center = arcPointAt(A, B, wall.bulge, frac);
          if (routeInstallation(route) === "surface") {
            const normal = perp(arcTangentAt(A, B, wall.bulge, frac));
            return add(center, scale(normal, (p.wallSide ?? 1) * wall.thickness / 2));
          }
          return center;
        }
      }
    }
    return v(p.x, p.y);
  });
}

function pointMap(route: Route, points: Vec[]): Map<string, Vec> {
  return new Map(route.points.map((p, i) => [p.id, points[i]!]));
}

/** Arc-aware total length of a route, mm, following anchored points. */
export function routeLength(floor: Floor, route: Route): number {
  const pts = resolveRoutePoints(floor, route);
  const byId = pointMap(route, pts);
  let total = 0;
  for (const segment of route.segments) {
    const a = byId.get(segment.a), b = byId.get(segment.b);
    if (a && b) total += arcLength(a, b, segment.bulge ?? 0);
  }
  return total;
}

/** One drawn segment of a resolved route: straight, or a preserved arc. */
export interface ResolvedRouteSegment {
  id: string;
  pointA: string;
  pointB: string;
  a: Vec;
  b: Vec;
  /** 0 for a straight segment -- possibly nudged sideways for legibility, see
   *  below -- nonzero for an untouched arc. */
  bulge: number;
}

export interface ResolvedRoute {
  route: Route;
  segments: ResolvedRouteSegment[];
}

/**
 * How far apart parallel lanes sit when several routes bundle through the
 * same corridor, mm.
 */
const LANE_SPACING_MM = 60;
/** How far apart two straight runs may sit and still count as one corridor. */
const CORRIDOR_PERP_TOL_MM = 60;
/** Two segments that only touch end to end are not a shared corridor. */
const CORRIDOR_MIN_OVERLAP_MM = 50;
/** sin of the largest angle between two directions still called "parallel". */
const CORRIDOR_PARALLEL_SIN_TOL = 0.05; // ~2.9 degrees

interface SegRef { ri: number; si: number; a: Vec; b: Vec; dir: Vec; len: number }

function shareCorridor(p: SegRef, q: SegRef): boolean {
  if (p.ri === q.ri && p.si === q.si) return false;
  // Near-parallel: both directions are unit vectors, so the magnitude of
  // their cross product IS the sine of the angle between them -- and it does
  // not matter whether the two runs happen to point the same way or opposite
  // ways along the corridor.
  if (Math.abs(cross(p.dir, q.dir)) > CORRIDOR_PARALLEL_SIN_TOL) return false;
  // Perpendicular distance from p's infinite line to q.
  if (Math.abs(cross(p.dir, sub(q.a, p.a))) > CORRIDOR_PERP_TOL_MM) return false;
  // Overlap along p's direction.
  const t0 = dot(sub(q.a, p.a), p.dir), t1 = dot(sub(q.b, p.a), p.dir);
  const overlap = Math.min(p.len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
  return overlap > CORRIDOR_MIN_OVERLAP_MM;
}

/**
 * The sideways nudge for every straight segment that shares a corridor with
 * another route, keyed "routeIndex:segmentIndex". A segment with no partner
 * -- the ordinary case -- gets no entry and is drawn exactly where it is
 * stored.
 *
 * This is drawn-legibility only, never a geometric claim: the offset is
 * applied per SEGMENT, uniformly along its whole length, not tapered in from
 * the corridor's ends. Two consequences follow, both accepted for this first
 * pass: a route can show a small lateral jog where it enters or leaves a
 * bundle (the segment before the boundary carries one offset, the one after
 * carries another, or none), and a corridor formed by a BULGED segment is not
 * detected at all -- arcs are excluded from bundling entirely, so two curved
 * runs along the same wall still overlap. Both are limitations to revisit if
 * fanning turns out to need to look better than "legible", not bugs in this
 * pass's own arithmetic.
 *
 * Lane order within a corridor is by ROUTE id, not by document position, and
 * the corridor's own reference direction is canonicalised (sign-normalised)
 * before use -- both so two calls against the same floor, or a re-render
 * after nothing changed, fan the same routes into the same lanes every time.
 */
function laneOffsets(routes: Route[], segs: SegRef[]): Map<string, Vec> {
  const n = segs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shareCorridor(segs[i]!, segs[j]!)) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = groups.get(r);
    if (list) list.push(i); else groups.set(r, [i]);
  }

  const result = new Map<string, Vec>();
  for (const idxs of groups.values()) {
    // Deterministic member order, independent of the segments' position in
    // the input array (which follows document storage order).
    const members = idxs.map(i => segs[i]!).sort((a, b) => {
      const ra = routes[a.ri]!.id, rb = routes[b.ri]!.id;
      return ra === rb ? a.si - b.si : ra < rb ? -1 : 1;
    });
    const laneIds = [...new Set(members.map(m => routes[m.ri]!.id))].sort();
    if (laneIds.length <= 1) continue; // nothing to fan out
    const ref = members[0]!.dir;
    const canon = (ref.x < 0 || (ref.x === 0 && ref.y < 0)) ? scale(ref, -1) : ref;
    const n2 = perp(canon);
    const center = (laneIds.length - 1) / 2;
    for (const m of members) {
      const lane = laneIds.indexOf(routes[m.ri]!.id);
      result.set(`${m.ri}:${m.si}`, scale(n2, (lane - center) * LANE_SPACING_MM));
    }
  }
  return result;
}

/**
 * Every route on the floor, resolved to drawable segments: anchored points
 * followed, and parallel runs fanned into side-by-side lanes where several
 * routes share a corridor (see laneOffsets above). This is the ONE resolution
 * the canvas, SVG and DXF exports all draw from, so a run reads the same way
 * everywhere it appears.
 */
export function resolveRoutes(floor: Floor): ResolvedRoute[] {
  const routes = routesOf(floor);
  const resolvedPts = routes.map(r => resolveRoutePoints(floor, r));
  const resolvedMaps = routes.map((r, i) => pointMap(r, resolvedPts[i]!));

  const straightRefs: SegRef[] = [];
  routes.forEach((route, ri) => {
    const pts = resolvedMaps[ri]!;
    for (let si = 0; si < route.segments.length; si++) {
      const segment = route.segments[si]!;
      if ((segment.bulge ?? 0) !== 0) continue; // arcs are not bundled
      const a = pts.get(segment.a), b = pts.get(segment.b);
      if (!a || !b) continue;
      const len = dist(a, b);
      if (len < 1) continue;
      straightRefs.push({ ri, si, a, b, dir: scale(sub(b, a), 1 / len), len });
    }
  });
  const offsets = laneOffsets(routes, straightRefs);

  return routes.map((route, ri) => {
    const pts = resolvedMaps[ri]!;
    const segments: ResolvedRouteSegment[] = [];
    for (let si = 0; si < route.segments.length; si++) {
      const segment = route.segments[si]!;
      const bulge = segment.bulge ?? 0;
      const a0 = pts.get(segment.a), b0 = pts.get(segment.b);
      if (!a0 || !b0) continue;
      const off = bulge === 0 ? offsets.get(`${ri}:${si}`) : undefined;
      const base = { id: segment.id, pointA: segment.a, pointB: segment.b };
      segments.push(off
        ? { ...base, a: add(a0, off), b: add(b0, off), bulge: 0 }
        : { ...base, a: a0, b: b0, bulge });
    }
    return { route, segments };
  });
}

/**
 * Per groep, across the floor's electrical runs: total resolved length and
 * how many distinct anchored devices (sockets, switches -- whatever symbol a
 * waypoint follows) sit somewhere on a run carrying that groep. A materials-
 * list shape for the person wiring the meterkast to check their own count
 * against -- reported, never validated against what the meterkast actually
 * has (there is nothing here that knows).
 */
export interface RouteGroupSummary {
  group: string;
  lengthMm: number;
  devices: number;
}

export function routeGroupSummaries(floor: Floor): RouteGroupSummary[] {
  const byGroup = new Map<string, { lengthMm: number; devices: Set<string> }>();
  for (const r of routesOf(floor)) {
    if (r.discipline !== "electrical" || !r.group) continue;
    const entry = byGroup.get(r.group) ?? { lengthMm: 0, devices: new Set<string>() };
    entry.lengthMm += routeLength(floor, r);
    for (const p of r.points) if (p.anchor) entry.devices.add(p.anchor);
    byGroup.set(r.group, entry);
  }
  return [...byGroup.entries()]
    .map(([group, e]) => ({ group, lengthMm: e.lengthMm, devices: e.devices.size }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/**
 * Per kind -- and for power, per aders count -- total cable length across the
 * floor's electrical runs: "120 m of 3-aders, 40 m Cat6". Same reported,
 * never-validated shape as routeGroupSummaries above.
 */
export interface RouteKindSummary {
  kind: RouteKind;
  /** Power only; a data run's summary carries no veins count. */
  veins?: number;
  lengthMm: number;
}

export function routeKindSummaries(floor: Floor): RouteKindSummary[] {
  const by = new Map<string, RouteKindSummary>();
  for (const r of routesOf(floor)) {
    if (r.discipline !== "electrical") continue;
    const kind = routeKind(r);
    const veins = kind === "power" ? routeVeins(r) : undefined;
    const key = kind + (veins !== undefined ? ":" + veins : "");
    const entry = by.get(key) ?? { kind, veins, lengthMm: 0 };
    entry.lengthMm += routeLength(floor, r);
    by.set(key, entry);
  }
  return [...by.values()].sort((a, b) =>
    a.kind === b.kind ? (a.veins ?? 0) - (b.veins ?? 0) : a.kind.localeCompare(b.kind));
}

/**
 * Per water kind and diameter, total run length across the floor's water
 * routes: "40 m of 15 mm koud, 12 m of 50 mm afvoer" -- same reported, never
 * validated shape as routeKindSummaries above. This is a takeoff, not a
 * sizing calculation, and afvoer's slope is not modelled at all -- a 2D plan
 * states the run, not its fall, so nothing here claims a gradient.
 */
export interface RouteWaterSummary {
  water: RouteWater;
  diameter: number;
  lengthMm: number;
}

export function routeWaterSummaries(floor: Floor): RouteWaterSummary[] {
  const by = new Map<string, RouteWaterSummary>();
  for (const r of routesOf(floor)) {
    if (r.discipline !== "water") continue;
    const water = routeWater(r);
    const diameter = routeDiameter(r);
    const key = water + ":" + diameter;
    const entry = by.get(key) ?? { water, diameter, lengthMm: 0 };
    entry.lengthMm += routeLength(floor, r);
    by.set(key, entry);
  }
  return [...by.values()].sort((a, b) =>
    a.water === b.water ? a.diameter - b.diameter : ROUTE_WATERS.indexOf(a.water) - ROUTE_WATERS.indexOf(b.water));
}

export interface RouteGasSummary { diameter: number; lengthMm: number }

export function routeGasSummaries(floor: Floor): RouteGasSummary[] {
  const byDiameter = new Map<number, number>();
  for (const route of routesOf(floor)) {
    if (route.discipline !== "gas") continue;
    const diameter = route.diameter ?? 15;
    byDiameter.set(diameter, (byDiameter.get(diameter) ?? 0) + routeLength(floor, route));
  }
  return [...byDiameter.entries()].map(([diameter, lengthMm]) => ({ diameter, lengthMm }))
    .sort((a, b) => a.diameter - b.diameter);
}

/** Shortest world-mm distance from `p` to the resolved route. */
export function routeDistance(resolved: ResolvedRoute, p: Vec): number {
  let best = Infinity;
  for (const seg of resolved.segments) {
    const pts = seg.bulge === 0 ? [seg.a, seg.b] : arcFlatten(seg.a, seg.b, seg.bulge, 2);
    for (let i = 0; i + 1 < pts.length; i++) {
      best = Math.min(best, distToSeg(p, pts[i]!, pts[i + 1]!).d);
    }
  }
  return best;
}

/** True when `p` (world mm) lands within `margin` of the resolved route. */
export function routeHit(resolved: ResolvedRoute, p: Vec, margin: number): boolean {
  return routeDistance(resolved, p) <= margin;
}
