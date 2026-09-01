// Proposing a run between two points, along the walls (issue #29).
//
// An input convenience over the ordinary Route, never a second representation:
// what comes back is a list of waypoints the caller writes into a plain Route,
// which the user then owns and can drag, extend or delete like any other. The
// engine proposes; nothing here is re-derived afterwards, and nothing on the
// document remembers that a run was proposed rather than drawn.
//
// The graph is the wall graph. Services follow the fabric -- a cable runs along
// a wall and turns at a corner, it does not cut across a room -- so the plan
// already contains the network the search needs, and building a second one
// would be a second thing to keep true. Costs are arc-aware lengths; a bowed
// wall is flattened for the geometry it contributes, the same 5 mm chord
// tolerance detectRooms uses.
//
// Scope, per the issue: shortest along the walls, with an offset. No obstacle
// semantics -- nothing here knows a vide from a corridor -- and no preference
// between two paths of equal length beyond a deterministic tie-break.
import { Floor, Id } from "../model/doc";
import { nearestWall, wallLength } from "../model/ops";
import { arcFlatten } from "../geometry/arc";
import { Vec, v, add, sub, scale, dist, norm, perp, cross, dot, lineIntersect } from "../geometry/vec";

/** Chord tolerance a bowed wall is flattened at, mm. Matches detectRooms. */
const FLATTEN_MM = 5;

/**
 * How near a picked point has to be to a wall to be routed from it, mm. A
 * point further out than this is off the fabric, and there is no honest path
 * to propose -- the caller falls back to letting the user draw one.
 */
export const AUTOROUTE_REACH_MM = 3000;

/** The largest miter a corner may grow to, as a multiple of the offset. Same
 *  reasoning and figure as resolveFloor's MITER_LIMIT. */
const MITER_LIMIT = 4;

interface GraphNode { at: Vec }
interface GraphEdge { to: number; cost: number }

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[][];
}

/** Every wall as a polyline of straight legs, arcs flattened. */
function wallLegs(floor: Floor): Array<{ id: Id; pts: Vec[] }> {
  const out: Array<{ id: Id; pts: Vec[] }> = [];
  for (const wall of floor.walls) {
    const a = floor.nodes.find(n => n.id === wall.a);
    const b = floor.nodes.find(n => n.id === wall.b);
    if (!a || !b) continue;
    const A = v(a.x, a.y), B = v(b.x, b.y);
    out.push({ id: wall.id, pts: wall.bulge === 0 ? [A, B] : arcFlatten(A, B, wall.bulge, FLATTEN_MM) });
  }
  return out;
}

/**
 * The routing graph: one vertex per distinct wall-graph position (including
 * the intermediate points a bowed wall flattens to), one edge per straight leg
 * between them. Vertices are keyed by rounded mm, so two walls that share a
 * node share a vertex without depending on node identity -- which is what lets
 * the two picked points be spliced in as ordinary vertices below.
 */
function buildGraph(floor: Floor, extra: Vec[]): { graph: Graph; indexOf: (p: Vec) => number } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[][] = [];
  const byKey = new Map<string, number>();
  const key = (p: Vec): string => `${Math.round(p.x)}|${Math.round(p.y)}`;
  const vertex = (p: Vec): number => {
    const k = key(p);
    const found = byKey.get(k);
    if (found !== undefined) return found;
    const index = nodes.length;
    byKey.set(k, index);
    nodes.push({ at: p });
    edges.push([]);
    return index;
  };
  const link = (i: number, j: number): void => {
    if (i === j) return;
    const cost = dist(nodes[i]!.at, nodes[j]!.at);
    if (edges[i]!.some(e => e.to === j)) return;
    edges[i]!.push({ to: j, cost });
    edges[j]!.push({ to: i, cost });
  };

  for (const leg of wallLegs(floor)) {
    // Any picked point that lands ON this leg becomes a vertex of it, so the
    // path can start or end part-way along a wall rather than only at corners.
    for (let i = 0; i + 1 < leg.pts.length; i++) {
      const a = leg.pts[i]!, b = leg.pts[i + 1]!;
      const along = extra
        .map(p => ({ p, t: projectT(p, a, b) }))
        .filter(x => x.t !== null && x.t > 0 && x.t < 1)
        .map(x => ({ at: add(a, scale(sub(b, a), x.t!)), t: x.t! }))
        .sort((x, y) => x.t - y.t);
      let previous = vertex(a);
      for (const point of along) {
        const next = vertex(point.at);
        link(previous, next);
        previous = next;
      }
      link(previous, vertex(b));
    }
  }
  return { graph: { nodes, edges }, indexOf: (p: Vec) => byKey.get(key(p)) ?? -1 };
}

/** Where `p` falls along a->b as a fraction, or null when it is off the leg. */
function projectT(p: Vec, a: Vec, b: Vec): number | null {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return null;
  const t = dot(sub(p, a), ab) / len2;
  if (t <= 0 || t >= 1) return null;
  const on = add(a, scale(ab, t));
  return dist(on, p) <= 1 ? t : null;
}

/** The point on the wall graph a picked point routes from, or null. */
export function snapToFabric(floor: Floor, p: Vec, reach = AUTOROUTE_REACH_MM): Vec | null {
  const near = nearestWall(floor, p, reach);
  if (!near) return null;
  const a = floor.nodes.find(n => n.id === near.wall.a);
  const b = floor.nodes.find(n => n.id === near.wall.b);
  if (!a || !b) return null;
  const A = v(a.x, a.y), B = v(b.x, b.y);
  const pts = near.wall.bulge === 0 ? [A, B] : arcFlatten(A, B, near.wall.bulge, FLATTEN_MM);
  const total = wallLength(floor, near.wall);
  const want = Math.max(0, Math.min(total, near.tMm));
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const s0 = pts[i]!, s1 = pts[i + 1]!;
    const legLength = dist(s0, s1);
    if (want <= acc + legLength || i + 2 === pts.length) {
      const t = legLength > 0 ? Math.max(0, Math.min(1, (want - acc) / legLength)) : 0;
      return add(s0, scale(sub(s1, s0), t));
    }
    acc += legLength;
  }
  return A;
}

/** Dijkstra over the graph, returning vertex indices from `from` to `to`. */
function shortestPath(graph: Graph, from: number, to: number): number[] | null {
  const n = graph.nodes.length;
  const best = new Array<number>(n).fill(Infinity);
  const previous = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  best[from] = 0;
  // A plan's wall graph is small enough that a linear scan for the next
  // vertex costs less than maintaining a heap would.
  for (;;) {
    let at = -1, atCost = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && best[i]! < atCost) { at = i; atCost = best[i]!; }
    if (at < 0) break;
    if (at === to) break;
    done[at] = true;
    for (const edge of graph.edges[at]!) {
      const cost = atCost + edge.cost;
      // Strictly better only, so an equal-length alternative never displaces
      // the first one found and the same plan proposes the same run twice.
      if (cost < best[edge.to]!) { best[edge.to] = cost; previous[edge.to] = at; }
    }
  }
  if (!isFinite(best[to]!)) return null;
  const path: number[] = [];
  for (let at = to; at >= 0; at = previous[at]!) {
    path.push(at);
    if (at === from) break;
  }
  path.reverse();
  return path[0] === from ? path : null;
}

/**
 * Drop what a waypoint would not say: a repeat of the point before it, and the
 * middle of three that lie on one straight line. Both arise from splicing the
 * picked points into the graph -- a pick that lands exactly on a corner, or two
 * picks on one wall, produce a point the run already has.
 */
function tidy(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const previous = out[out.length - 1];
    if (previous && dist(previous, pts[i]!) <= 1) continue;
    const next = pts[i + 1];
    if (previous && next) {
      const a = norm(sub(pts[i]!, previous)), b = norm(sub(next, pts[i]!));
      if (Math.abs(cross(a, b)) < 1e-6 && dot(a, b) > 0) continue;
    }
    out.push(pts[i]!);
  }
  return out;
}

/**
 * Displace a polyline sideways by `offset` mm, keeping every leg parallel to
 * the one it came from and meeting the neighbouring legs at their
 * intersection -- the same corner construction resolveFloor uses for a wall
 * face, and for the same reason: a per-point displacement would shorten the
 * legs at every turn and leave the run visibly off the wall it follows.
 *
 * `hand` is +1 for perp(direction) -- the clockwise visual side under y-down
 * (see geometry/vec.ts) -- and -1 for the other. It is fixed for the whole run
 * rather than decided per leg, so a run that turns a corner stays on the same
 * side of the wall it is following instead of crossing through it.
 */
export function offsetPolyline(pts: Vec[], offset: number, hand: 1 | -1): Vec[] {
  if (offset === 0 || pts.length < 2) return pts;
  const shift = (a: Vec, b: Vec): Vec => scale(perp(norm(sub(b, a))), offset * hand);
  const out: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const before = i > 0 ? shift(pts[i - 1]!, pts[i]!) : null;
    const after = i + 1 < pts.length ? shift(pts[i]!, pts[i + 1]!) : null;
    if (!before) { out.push(add(pts[i]!, after!)); continue; }
    if (!after) { out.push(add(pts[i]!, before)); continue; }
    const p0 = add(pts[i - 1]!, before), p1 = add(pts[i]!, before);
    const q0 = add(pts[i]!, after), q1 = add(pts[i + 1]!, after);
    const hit = lineIntersect(p0, sub(p1, p0), q0, sub(q1, q0));
    // Parallel legs, or a hairpin whose miter would shoot off: fall back to
    // the midpoint of the two displaced corners.
    const fallback = scale(add(p1, q0), 0.5);
    const corner = hit && dist(hit, pts[i]!) <= Math.abs(offset) * MITER_LIMIT ? hit : fallback;
    out.push(corner);
  }
  return out;
}

export interface AutoRouteOptions {
  /** Stand-off from the wall centerline, mm. 0 runs down the centerline. */
  offsetMm?: number;
  /** How far off the fabric a picked point may be and still route. */
  reachMm?: number;
}

/**
 * The waypoints of a run from `from` to `to` along the walls, or null when
 * either end is off the fabric or no path connects them.
 *
 * The first and last waypoints are the picked points themselves, so a run
 * proposed to a socket still ends AT the socket rather than at the wall behind
 * it; everything between follows the graph. Which side the offset falls on is
 * taken from where `from` was picked relative to the first leg, which is the
 * only side the caller has actually expressed an opinion about.
 */
export function autoRoutePath(
  floor: Floor, from: Vec, to: Vec, options: AutoRouteOptions = {},
): Vec[] | null {
  const reach = options.reachMm ?? AUTOROUTE_REACH_MM;
  const start = snapToFabric(floor, from, reach);
  const end = snapToFabric(floor, to, reach);
  if (!start || !end) return null;

  const { graph, indexOf } = buildGraph(floor, [start, end]);
  const a = indexOf(start), b = indexOf(end);
  if (a < 0 || b < 0) return null;
  if (a === b) return [from, to];

  const path = shortestPath(graph, a, b);
  if (!path) return null;
  const along = tidy(path.map(i => graph.nodes[i]!.at));

  const offset = Math.round(options.offsetMm ?? 0);
  let laid = along;
  if (offset !== 0 && along.length >= 2) {
    const first = norm(sub(along[1]!, along[0]!));
    // Which side of the first leg the pick was on. Exactly on the line is a
    // caller with no opinion, and takes perp()'s own side.
    const hand: 1 | -1 = dot(sub(from, along[0]!), perp(first)) >= 0 ? 1 : -1;
    laid = offsetPolyline(along, offset, hand);
  }
  const out = tidy([from, ...laid, to]);
  return out.map(p => v(Math.round(p.x), Math.round(p.y)));
}
