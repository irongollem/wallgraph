// Derived positions and directions for the vertical-service marks on one
// storey. Broken references are ignored here and remain available to a future
// validation report; rendering a pasted document must never throw.
import { floorElevation, floorHeight, routesOf, type Floor, type PlanDoc } from "../model/doc";
import { continuationsOf, type RouteContinuation, type RoutePort } from "../model/continuation";
import { resolveRoutePoints, routeLength } from "./route";
import type { Discipline } from "../model/route";
import { routeInstallation, type Route } from "../model/route";
import type { Vec } from "../geometry/vec";

export type RiserDirection = "up" | "down" | "through";

export interface ResolvedRiserMember {
  continuation: RouteContinuation;
  port: RoutePort;
  routeId: string;
  pointId: string;
  discipline: Discipline;
  at: Vec;
  direction: RiserDirection;
}

export interface ResolvedRiserMark {
  at: Vec;
  direction: RiserDirection;
  discipline: Discipline;
  tag?: string;
  members: ResolvedRiserMember[];
}

/** Authored/derived elevation of a route plane above its own finished floor. */
export function routePlaneHeight(floor: Floor, route: Route): number {
  const installation = routeInstallation(route);
  if (installation === "floor") return 0;
  if (installation === "ceiling") return floorHeight(floor);
  return route.height ?? 0;
}

/** Every valid continuation port on one floor, before coincident marks group. */
export function riserMembers(doc: PlanDoc, floorIndex: number): ResolvedRiserMember[] {
  const floor = doc.floors[floorIndex];
  if (!floor) return [];
  const floorIndexById = new Map(doc.floors.map((f, i) => [f.id, i]));
  const out: ResolvedRiserMember[] = [];
  for (const continuation of continuationsOf(doc)) {
    const port = continuation.ports.find(p => p.floorId === floor.id);
    if (!port) continue;
    const route = routesOf(floor).find(r => r.id === port.routeId);
    const pointIndex = route?.points.findIndex(p => p.id === port.pointId) ?? -1;
    if (!route || pointIndex < 0) continue;
    const here = floorIndex;
    const other = continuation.ports
      .map(p => floorIndexById.get(p.floorId))
      .filter((i): i is number => i !== undefined && i !== here);
    const above = other.some(i => i > here), below = other.some(i => i < here);
    if (!above && !below) continue;
    out.push({
      continuation, port, routeId: route.id, pointId: port.pointId,
      discipline: route.discipline,
      at: resolveRoutePoints(floor, route)[pointIndex]!,
      direction: above && below ? "through" : above ? "up" : "down",
    });
  }
  return out;
}

/** Coincident continuations draw as one mark with a count, while retaining members. */
export function riserMarks(doc: PlanDoc, floorIndex: number): ResolvedRiserMark[] {
  const grouped = new Map<string, ResolvedRiserMark>();
  for (const member of riserMembers(doc, floorIndex)) {
    const tag = member.continuation.tag;
    const key = `${member.at.x}|${member.at.y}|${member.direction}|${member.discipline}|${tag ?? ""}`;
    const found = grouped.get(key);
    if (found) found.members.push(member);
    else grouped.set(key, {
      at: member.at, direction: member.direction, discipline: member.discipline,
      ...(tag ? { tag } : {}), members: [member],
    });
  }
  return [...grouped.values()];
}

/** Vertical distance between the lowest and highest valid port, in mm. */
export function continuationLength(doc: PlanDoc, continuation: RouteContinuation): number {
  const zs: number[] = [];
  for (const port of continuation.ports) {
    const floorIndex = doc.floors.findIndex(f => f.id === port.floorId);
    const floor = doc.floors[floorIndex];
    const route = floor && routesOf(floor).find(r => r.id === port.routeId);
    if (floorIndex >= 0 && route && floor)
      zs.push(floorElevation(doc, floorIndex) + routePlaneHeight(floor, route));
  }
  return zs.length < 2 ? 0 : Math.max(...zs) - Math.min(...zs);
}

export interface ServiceNetworkLength {
  floorLengthMm: number;
  verticalLengthMm: number;
  totalLengthMm: number;
  routes: number;
  continuations: number;
}

/**
 * Length of one connected service across every storey. Floor-local route
 * graphs and vertical links are each counted once, even though every vertical
 * link is visible from two or more floor plans.
 */
export function serviceNetworkLength(
  doc: PlanDoc, start: { floorId: string; routeId: string },
): ServiceNetworkLength {
  const routeKeys = new Set<string>();
  const linkIds = new Set<string>();
  const queue = [start];
  let floorLengthMm = 0, verticalLengthMm = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.floorId}|${current.routeId}`;
    if (routeKeys.has(key)) continue;
    routeKeys.add(key);
    const floor = doc.floors.find(f => f.id === current.floorId);
    const route = floor && routesOf(floor).find(r => r.id === current.routeId);
    if (!floor || !route) continue;
    floorLengthMm += routeLength(floor, route);
    for (const link of continuationsOf(doc)) {
      if (!link.ports.some(p => p.floorId === current.floorId && p.routeId === current.routeId)) continue;
      if (!linkIds.has(link.id)) {
        linkIds.add(link.id);
        verticalLengthMm += continuationLength(doc, link);
      }
      for (const port of link.ports) queue.push({ floorId: port.floorId, routeId: port.routeId });
    }
  }
  return {
    floorLengthMm, verticalLengthMm,
    totalLengthMm: floorLengthMm + verticalLengthMm,
    routes: routeKeys.size, continuations: linkIds.size,
  };
}
