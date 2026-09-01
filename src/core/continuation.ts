// Derived positions and directions for the vertical-service marks on one
// storey. Broken references are ignored here and remain available to a future
// validation report; rendering a pasted document must never throw.
import { floorElevation, routesOf, type PlanDoc } from "../model/doc";
import { continuationsOf, samePort, type RouteContinuation, type RoutePort } from "../model/continuation";
import { resolveRoutePoints, routeLength, routePlaneHeight } from "./route";
import { routeHeat, routeKind, routeVent, routeWater, type Discipline, type Route } from "../model/route";
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


/* ── cross-floor topology report ───────────────────────────────────────────
 * What a network says about itself that does not add up. Reported, never
 * enforced -- the same rule the permit checklist follows: Wallgraph draws what
 * it is given, so a conflict is something to show the drawer, not something to
 * refuse. Nothing here throws or repairs; a document that arrives broken still
 * renders.
 */

export type ContinuationIssueKind =
  /** A port names a floor, route or point that is not in the document. */
  | "dangling"
  /** Every port of the link resolves, but they are all on one storey. */
  | "sameFloor"
  /** The ports carry different disciplines -- a water riser feeding a duct. */
  | "discipline"
  /** Same discipline, but the service metadata disagrees across the boundary. */
  | "metadata";

export interface ContinuationIssue {
  kind: ContinuationIssueKind;
  continuationId: string;
  /** The port the issue is about, where one port in particular is at fault. */
  port?: RoutePort;
  /** The disagreeing values, for the two "conflict" kinds. Display only. */
  values?: string[];
}

/**
 * The metadata that has to agree across a continuation: a riser carries ONE
 * service through the slab, so the run above and the run below are the same
 * circuit, the same pipe or the same duct. Identity a storey may legitimately
 * restate -- the tag, the name, the installation, the height of the horizontal
 * leg on each floor -- is not in here.
 */
function serviceKey(route: Route): string {
  switch (route.discipline) {
    case "electrical":
      // Groep and board name the circuit; the cable spec follows the kind.
      return [routeKind(route), route.group ?? "", route.board ?? "", route.spec ?? ""].join("|");
    case "water":
      return [routeWater(route), route.diameter ?? ""].join("|");
    case "heating":
      // Aanvoer and retour are different pipes; a riser must not join one to
      // the other and call it the same service.
      return [routeHeat(route), route.diameter ?? ""].join("|");
    case "vent":
      return [routeVent(route), route.ductDiameter ?? ""].join("|");
    case "gas":
      return String(route.diameter ?? "");
  }
}

export function continuationIssues(doc: PlanDoc): ContinuationIssue[] {
  const out: ContinuationIssue[] = [];
  const floorById = new Map(doc.floors.map(f => [f.id, f]));
  for (const link of continuationsOf(doc)) {
    const resolvedPorts: Array<{ port: RoutePort; route: Route; floorId: string }> = [];
    for (const port of link.ports) {
      const floor = floorById.get(port.floorId);
      const route = floor && routesOf(floor).find(r => r.id === port.routeId);
      const point = route?.points.find(p => p.id === port.pointId);
      if (!floor || !route || !point) {
        out.push({ kind: "dangling", continuationId: link.id, port });
        continue;
      }
      resolvedPorts.push({ port, route, floorId: floor.id });
    }
    if (resolvedPorts.length < 2) continue;
    if (new Set(resolvedPorts.map(p => p.floorId)).size < 2) {
      out.push({ kind: "sameFloor", continuationId: link.id });
      continue;
    }
    const disciplines = [...new Set(resolvedPorts.map(p => p.route.discipline))];
    if (disciplines.length > 1) {
      out.push({ kind: "discipline", continuationId: link.id, values: disciplines });
      continue;
    }
    const keys = [...new Set(resolvedPorts.map(p => serviceKey(p.route)))];
    if (keys.length > 1) out.push({ kind: "metadata", continuationId: link.id, values: keys });
  }
  return out;
}

/** Issues touching one particular route on one storey. */
export function issuesForRoute(doc: PlanDoc, floorId: string, routeId: string): ContinuationIssue[] {
  return continuationIssues(doc).filter(issue => {
    if (issue.port) return issue.port.floorId === floorId && issue.port.routeId === routeId;
    const link = continuationsOf(doc).find(l => l.id === issue.continuationId);
    return !!link?.ports.some(p => p.floorId === floorId && p.routeId === routeId);
  });
}

/* ── storey schedule ─────────────────────────────────────────────────────── */

export interface StoreyServiceRow {
  discipline: Discipline;
  /** Ports whose other end is only below: the service arrives from downstairs. */
  incoming: number;
  /** Ports whose other end is only above. */
  outgoing: number;
  /** Ports with storeys on both sides: the riser passes through. */
  through: number;
  /**
   * Vertical length attributed to THIS storey, mm. A link is visible from
   * every floor it touches, so counting its whole length on each of them would
   * report the same shaft several times; each link's length is charged to its
   * LOWEST storey once, and nowhere else.
   */
  verticalLengthMm: number;
}

/**
 * What crosses this storey's floor and ceiling, per discipline: how many
 * services arrive, leave and pass through, and how much vertical run belongs
 * to this storey. Reported, never reconciled against anything.
 */
export function storeyServices(doc: PlanDoc, floorIndex: number): StoreyServiceRow[] {
  const rows = new Map<Discipline, StoreyServiceRow>();
  const row = (discipline: Discipline): StoreyServiceRow => {
    const found = rows.get(discipline);
    if (found) return found;
    const made: StoreyServiceRow = { discipline, incoming: 0, outgoing: 0, through: 0, verticalLengthMm: 0 };
    rows.set(discipline, made);
    return made;
  };
  for (const member of riserMembers(doc, floorIndex)) {
    const here = row(member.discipline);
    if (member.direction === "through") here.through++;
    else if (member.direction === "up") here.outgoing++;
    else here.incoming++;
  }
  // Each link charged once, to the lowest storey it reaches, so a schedule per
  // storey summed over the building counts every shaft exactly once.
  const indexById = new Map(doc.floors.map((f, i) => [f.id, i]));
  const counted = new Set<string>();
  for (const link of continuationsOf(doc)) {
    const indices = link.ports
      .map(p => indexById.get(p.floorId))
      .filter((i): i is number => i !== undefined);
    if (indices.length < 2 || Math.min(...indices) !== floorIndex) continue;
    if (counted.has(link.id)) continue;
    counted.add(link.id);
    const port = link.ports.find(p => indexById.get(p.floorId) === floorIndex);
    const floor = port && doc.floors[floorIndex];
    const route = floor && routesOf(floor).find(r => r.id === port.routeId);
    if (!route) continue;
    row(route.discipline).verticalLengthMm += continuationLength(doc, link);
  }
  return [...rows.values()].sort((a, b) => a.discipline.localeCompare(b.discipline));
}

/** True when this point is one end of a vertical continuation. */
export function isContinuationPort(doc: PlanDoc, port: RoutePort): boolean {
  return continuationsOf(doc).some(link => link.ports.some(p => samePort(p, port)));
}
