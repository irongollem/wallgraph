// A vertical continuation joins route points that live on different storeys.
// Routes remain floor-local drawing objects; this document-level link is the
// authored fact that says their endpoints are one service through the slab.
import { newId, routesOf, type Id, type PlanDoc } from "./doc";
import type { Route } from "./route";

export interface RoutePort {
  floorId: Id;
  routeId: Id;
  pointId: Id;
}

export interface RouteContinuation {
  id: Id;
  /** Optional shaft/riser identifier printed beside the plan mark. */
  tag?: string;
  /** One port per storey. Two is ordinary; more describes a through-riser. */
  ports: RoutePort[];
}

export function continuationsOf(doc: PlanDoc): RouteContinuation[] {
  return doc.continuations ?? [];
}

export function samePort(a: RoutePort, b: RoutePort): boolean {
  return a.floorId === b.floorId && a.routeId === b.routeId && a.pointId === b.pointId;
}

export function continuationAt(doc: PlanDoc, port: RoutePort): RouteContinuation | undefined {
  return continuationsOf(doc).find(link => link.ports.some(p => samePort(p, port)));
}

export interface ContinueRouteInput {
  routeId: Id;
  pointId: Id;
  /** Resolved plan position copied onto the destination-floor starter. */
  x: number;
  y: number;
}

export interface ContinueRouteResult {
  floorIndex: number;
  routeIds: Id[];
}

/**
 * Continue several floor-local endpoints to another existing storey in one
 * document mutation. Invalid/non-endpoint inputs are skipped; the caller can
 * compare routeIds.length with inputs.length before changing floors.
 */
export function continueRoutePorts(
  doc: PlanDoc, sourceFloorIndex: number, targetFloorIndex: number,
  inputs: readonly ContinueRouteInput[],
): ContinueRouteResult {
  const source = doc.floors[sourceFloorIndex], target = doc.floors[targetFloorIndex];
  const made: Id[] = [];
  if (!source || !target || source === target) return { floorIndex: targetFloorIndex, routeIds: made };
  for (const input of inputs) {
    const route = routesOf(source).find(r => r.id === input.routeId);
    const point = route?.points.find(p => p.id === input.pointId);
    if (!route || !point) continue;
    const degree = route.segments.reduce((n, s) => n + (s.a === point.id ? 1 : 0) + (s.b === point.id ? 1 : 0), 0);
    if (degree > 1 || point.anchor) continue;

    const sourcePort: RoutePort = { floorId: source.id, routeId: route.id, pointId: point.id };
    let link = continuationAt(doc, sourcePort);
    const existing = link?.ports.find(p => p.floorId === target.id);
    if (existing) { made.push(existing.routeId); continue; }

    const starterPoint = { id: newId("rp"), x: Math.round(input.x), y: Math.round(input.y) };
    const { points: _points, segments: _segments, ...identity } = route;
    const starter: Route = {
      ...identity, id: newId("rt"), points: [starterPoint], segments: [],
    };
    (target.routes ??= []).push(starter);
    const targetPort: RoutePort = { floorId: target.id, routeId: starter.id, pointId: starterPoint.id };
    delete point.terminal;
    if (link) link.ports.push(targetPort);
    else {
      link = { id: newId("rc"), ports: [sourcePort, targetPort] };
      (doc.continuations ??= []).push(link);
    }
    made.push(starter.id);
  }
  return { floorIndex: targetFloorIndex, routeIds: made };
}
