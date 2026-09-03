// The tape measure: what a distance is taken between, and the figure it reads.
//
// Editor state only. A measurement is read off the plan and discarded; nothing
// here reaches the document or an export. The targets are the plan as DRAWN --
// wall faces, jambs and footprints as well as the centerline graph -- because a
// tape is held against a surface, and the figure a builder wants is face to
// face rather than axis to axis.
import { Floor, stairsOf, videsOf, structureOf, furnishingsOf, routesOf } from "../model/doc";
import { Resolved } from "./resolve";
import { getSymbol } from "../render/symbols";
import { symbolFootprintCorners } from "./placed";
import { stairCorners, resolveStair } from "./stair";
import { videCorners } from "./vide";
import { structureCorners } from "./structure";
import { furnishingCorners } from "./furnishing";
import { resolveRoutePoints } from "./route";
import { arcFlatten } from "../geometry/arc";
import {
  Vec, v, add, sub, scale, dist, dot, cross, angleOf, fromAngle, distToSeg,
} from "../geometry/vec";

/** A segment a tape end can be laid along. */
export type Edge = readonly [Vec, Vec];

/** Everything a tape end can land on: the points, and the edges between them. */
export interface MeasureTargets { corners: Vec[]; edges: Edge[] }

/**
 * Where a tape end landed and why. `corner` is a point of the drawing (a node,
 * a mitered corner, a jamb, a footprint corner, or the foot of the perpendicular
 * from the other end); `edge` is a point along a face, a centerline or a
 * footprint side; `grid` and `free` are the quantised cursor.
 */
export interface MeasureSnap { p: Vec; kind: "corner" | "edge" | "grid" | "free" }

export interface MeasureSnapOptions {
  /** Grab radius for a corner, mm. */
  tolCorner: number;
  /** Grab radius for an edge, mm; ordinarily tighter than the corner's. */
  tolEdge: number;
  /** Quantisation step when nothing is hit, mm; 1 for whole millimetres. */
  grid: number;
  /** The first end, once it is down. */
  from?: Vec | null;
  /** Hold the second end to one of the eight directions from `from`. */
  ortho?: boolean;
}

/** Chord tolerance for flattening a curved centerline or run, mm. */
const FLATTEN_MM = 2;

/** The plan as drawn, reduced to the points and edges a tape can be held to. */
export function measureTargets(floor: Floor, resolved: Resolved): MeasureTargets {
  const corners: Vec[] = [];
  const edges: Edge[] = [];
  const ring = (poly: Vec[]): void => {
    for (let i = 0; i < poly.length; i++) {
      corners.push(poly[i]!);
      edges.push([poly[i]!, poly[(i + 1) % poly.length]!]);
    }
  };
  const chain = (pts: Vec[]): void => {
    for (let i = 0; i + 1 < pts.length; i++) edges.push([pts[i]!, pts[i + 1]!]);
  };

  for (const n of floor.nodes) corners.push(v(n.x, n.y));
  // The solid pieces rather than the outline: their vertices are the jambs,
  // and the reveal between two of them is the dagmaat of the opening.
  for (const rw of resolved.walls.values()) {
    for (const piece of rw.pieces) ring(piece.poly);
    for (const band of rw.facade) ring(band.poly);
    // The centerline as well, so hart-op-hart is reachable at any point along
    // a wall and not only at its nodes.
    chain(rw.wall.bulge === 0 ? [rw.a, rw.b] : arcFlatten(rw.a, rw.b, rw.wall.bulge, FLATTEN_MM));
  }
  for (const s of floor.symbols) {
    const def = getSymbol(s.type);
    if (def) ring(symbolFootprintCorners(def, s));
  }
  for (const st of stairsOf(floor)) ring(quad(stairCorners(resolveStair(floor, st))));
  for (const vd of videsOf(floor)) ring(quad(videCorners(vd)));
  for (const el of structureOf(floor)) ring(quad(structureCorners(el)));
  for (const fn of furnishingsOf(floor)) ring(quad(furnishingCorners(fn)));
  // A run's true vertices, not the fanned lanes it is drawn as (see
  // resolveRoutes): the tape makes a geometric claim.
  for (const route of routesOf(floor)) {
    const pts = resolveRoutePoints(floor, route);
    const at = new Map(route.points.map((p, i) => [p.id, pts[i]!]));
    corners.push(...pts);
    for (const seg of route.segments) {
      const a = at.get(seg.a), b = at.get(seg.b);
      if (!a || !b) continue;
      chain(seg.bulge ? arcFlatten(a, b, seg.bulge, FLATTEN_MM) : [a, b]);
    }
  }
  return { corners, edges };
}

/**
 * Four box corners in traversal order. boxCorners() (core/placed.ts) lists
 * them column by column, which is fine for a bounding box and wrong for a ring;
 * sorting by angle about the centre wires a convex quad whatever the input
 * order.
 */
function quad(corners: Vec[]): Vec[] {
  const c = scale(corners.reduce(add, v(0, 0)), 1 / corners.length);
  return [...corners].sort((p, q) => angleOf(sub(p, c)) - angleOf(sub(q, c)));
}

/**
 * Where a tape end lands for a cursor at `raw`. Corners take precedence over
 * edges, at the wider radius; with the first end down, the foot of the
 * perpendicular from it onto an edge is offered as a corner too, since a tape
 * held square to a wall reads the clear distance to it.
 *
 * Under the angle lock the cursor is first projected onto the nearest of the
 * eight rays from the first end. A corner near the RAW cursor still wins, as
 * it does for a chained wall; otherwise the end is where the ray meets an edge,
 * and failing that the length along the ray rounded to the grid.
 */
export function measureSnap(targets: MeasureTargets, raw: Vec, o: MeasureSnapOptions): MeasureSnap {
  const from = o.from ?? null;
  let p = raw;
  let ray: Vec | null = null;
  if (from && o.ortho) {
    const d = sub(raw, from);
    ray = fromAngle(Math.round(angleOf(d) / (Math.PI / 4)) * (Math.PI / 4));
    p = add(from, scale(ray, dot(d, ray)));
  }

  const corner = nearest(targets.corners, raw, o.tolCorner);
  if (corner) return { p: corner, kind: "corner" };
  if (from) {
    const foot = nearest(perpendicularFeet(targets.edges, from), raw, o.tolCorner);
    if (foot) return { p: foot, kind: "corner" };
  }

  if (ray && from) {
    const hit = rayHit(targets.edges, from, ray, p, o.tolEdge);
    if (hit) return { p: hit, kind: "edge" };
    // Each leg is quantised rather than the length: along an axis the two are
    // the same figure, and on a diagonal the end then lands on a grid point
    // with equal legs, as the grid snap promises.
    const l = dist(p, from);
    const leg = v(Math.round(l * ray.x / o.grid) * o.grid, Math.round(l * ray.y / o.grid) * o.grid);
    return { p: add(from, leg), kind: o.grid > 1 ? "grid" : "free" };
  }

  let best: { p: Vec; d: number } | null = null;
  for (const [a, b] of targets.edges) {
    const { d, t } = distToSeg(p, a, b);
    if (d <= o.tolEdge && (!best || d < best.d)) best = { p: add(a, scale(sub(b, a), t)), d };
  }
  if (best) return { p: best.p, kind: "edge" };
  const g = o.grid;
  return { p: v(Math.round(p.x / g) * g, Math.round(p.y / g) * g), kind: g > 1 ? "grid" : "free" };
}

function nearest(points: Vec[], at: Vec, tol: number): Vec | null {
  let best: Vec | null = null, bestD = tol;
  for (const q of points) {
    const d = dist(q, at);
    if (d <= bestD) { best = q; bestD = d; }
  }
  return best;
}

/** The foot of the perpendicular from `from` onto each edge it falls within. */
function perpendicularFeet(edges: Edge[], from: Vec): Vec[] {
  const feet: Vec[] = [];
  for (const [a, b] of edges) {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    if (l2 === 0) continue;
    const t = dot(sub(from, a), ab) / l2;
    if (t <= 0 || t >= 1) continue;
    const foot = add(a, scale(ab, t));
    // On the edge itself the foot is the first end again, which measures nothing.
    if (dist(foot, from) > 1) feet.push(foot);
  }
  return feet;
}

/** Where the ray from `origin` along `dir` meets an edge, nearest to `near`. */
function rayHit(edges: Edge[], origin: Vec, dir: Vec, near: Vec, tol: number): Vec | null {
  let best: { p: Vec; d: number } | null = null;
  for (const [a, b] of edges) {
    const seg = sub(b, a);
    const den = cross(dir, seg);
    if (Math.abs(den) < 1e-9) continue;
    const q = sub(a, origin);
    const s = cross(q, seg) / den;
    const u = cross(q, dir) / den;
    if (s <= 1 || u < 0 || u > 1) continue;
    const p = add(origin, scale(dir, s));
    const d = dist(p, near);
    if (d <= tol && (!best || d < best.d)) best = { p, d };
  }
  return best?.p ?? null;
}

/** The figure between two ends, in whole millimetres. */
export interface Measurement { length: number; dx: number; dy: number }

export function measurement(a: Vec, b: Vec): Measurement {
  return {
    length: Math.round(dist(a, b)),
    dx: Math.round(Math.abs(b.x - a.x)),
    dy: Math.round(Math.abs(b.y - a.y)),
  };
}
