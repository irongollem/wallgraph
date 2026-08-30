// Room detection: flatten all wall centerlines, build a half-edge structure,
// walk faces by taking the sharpest-left next edge at each vertex. Bounded
// faces are rooms; the unbounded outer face is rejected by winding sign.
//
// Each room is reported with TWO boundaries, because plans are dimensioned both
// ways and the difference is not small — a 4x3 m room with 300 mm walls is 12 m²
// centerline but 9.99 m² net, a 20% gap:
//   poly    / areaMm2    centerline-bounded (hart-op-hart), what the graph stores
//   netPoly / netAreaMm2 inner wall faces (dagmaat), the usable floor NEN 2580 asks for
// The net boundary is derived by offsetting each face edge inward by half the
// thickness of the wall it lies on, then intersecting adjacent offset lines —
// the same miter construction resolve.ts uses at junctions.
import { Floor, roomNamesOf } from "../model/doc";
import type { Id } from "../model/doc";
import {
  Vec, v, dist, dot, sub, add, norm, perp, scale, angleOf, lineIntersect,
  polygonArea, polygonCentroid, pointInPolygon,
} from "../geometry/vec";
import { arcFlatten } from "../geometry/arc";

export interface Room {
  /** Centerline-bounded boundary (hart-op-hart). */
  poly: Vec[];
  /** Centerline-bounded area, mm². Always >= netAreaMm2. */
  areaMm2: number;
  /** Inner wall faces (dagmaat) — the usable floor outline. */
  netPoly: Vec[];
  /** Net floor area, mm². This is the NEN 2580-style number. */
  netAreaMm2: number;
  centroid: Vec;
  /**
   * What this room is called, when a name has been written inside it. Derived,
   * not stored: the document holds the name and the point it was written at,
   * and the room that contains that point takes it. See model/room.ts.
   */
  name?: string;
  /** The RoomName the name came from, so a click can select it. */
  nameId?: Id;
  /** That name's pen, when it carries one. */
  nameColor?: string;
}

interface HalfEdge { from: number; to: number; visited: boolean; half: number }

export function detectRooms(f: Floor): Room[] {
  // Collect flattened vertices with dedup (quantize to 1mm).
  const verts: Vec[] = [];
  const vmap = new Map<string, number>();
  const vid = (p: Vec): number => {
    const k = Math.round(p.x) + "," + Math.round(p.y);
    let i = vmap.get(k);
    if (i === undefined) { i = verts.length; verts.push(v(Math.round(p.x), Math.round(p.y))); vmap.set(k, i); }
    return i;
  };

  const nodePos = new Map(f.nodes.map(n => [n.id, v(n.x, n.y)] as const));
  const edgeSet = new Set<string>();
  const halfEdges: HalfEdge[] = [];
  const outgoing = new Map<number, number[]>(); // vertex -> half-edge indices

  const addSeg = (a: Vec, b: Vec, half: number): void => {
    const ia = vid(a), ib = vid(b);
    if (ia === ib) return;
    const ek = Math.min(ia, ib) + "-" + Math.max(ia, ib);
    if (edgeSet.has(ek)) return;
    edgeSet.add(ek);
    for (const [from, to] of [[ia, ib], [ib, ia]] as const) {
      const idx = halfEdges.length;
      halfEdges.push({ from, to, visited: false, half });
      const arr = outgoing.get(from);
      if (arr) arr.push(idx); else outgoing.set(from, [idx]);
    }
  };

  for (const w of f.walls) {
    const A = nodePos.get(w.a), B = nodePos.get(w.b);
    if (!A || !B || dist(A, B) < 1) continue;
    const flat = arcFlatten(A, B, w.bulge, 5);
    const half = w.thickness / 2;
    for (let i = 0; i + 1 < flat.length; i++) addSeg(flat[i]!, flat[i + 1]!, half);
  }

  // Sort outgoing edges by angle for the turn rule.
  for (const [vi, arr] of outgoing) {
    arr.sort((e1, e2) => angleOfEdge(halfEdges, verts, e1) - angleOfEdge(halfEdges, verts, e2));
    outgoing.set(vi, arr);
  }

  const twin = (i: number): number => (i % 2 === 0 ? i + 1 : i - 1);

  const rooms: Room[] = [];
  for (let start = 0; start < halfEdges.length; start++) {
    if (halfEdges[start]!.visited) continue;
    const polyIdx: number[] = [];
    const halves: number[] = []; // half-thickness of the wall carrying each edge
    let cur = start;
    let guard = 0;
    while (guard++ < 100000) {
      const he = halfEdges[cur]!;
      if (he.visited) break;
      he.visited = true;
      polyIdx.push(he.from);
      halves.push(he.half);
      // Next: at he.to, pick the edge just CW of twin(cur) in the sorted order.
      const outs = outgoing.get(he.to)!;
      const tw = twin(cur);
      const pos = outs.indexOf(tw);
      const next = outs[(pos - 1 + outs.length) % outs.length]!;
      cur = next;
      if (cur === start) break;
    }
    if (polyIdx.length < 3) continue;
    const poly = polyIdx.map(i => verts[i]!);
    const area = polygonArea(poly);
    // With this turn rule (y-down), bounded faces trace with positive shoelace
    // area; the unbounded outer face is negative. Verified by tests/core.test.ts.
    if (area <= 1e4) continue; // rejects outer face and <0.01 m² slivers
    const netPoly = insetPolygon(poly, halves);
    const netArea = Math.max(0, polygonArea(netPoly));
    rooms.push({
      poly, areaMm2: area,
      netPoly, netAreaMm2: netArea,
      centroid: polygonCentroid(poly),
    });
  }
  attachNames(f, rooms);
  return rooms;
}

/**
 * Hand each room the name written inside it. Matched against the net boundary,
 * so a name written just inside a wall face still lands in the room the drawer
 * meant rather than in the wall itself. A name whose point falls in no room is
 * left unattached; it still draws where it was written, which is what an
 * open-plan or not-yet-enclosed space needs.
 *
 * First match wins: two names in one room is a mistake, not a merge.
 */
function attachNames(f: Floor, rooms: Room[]): void {
  for (const rn of roomNamesOf(f)) {
    const p = v(rn.x, rn.y);
    const room = rooms.find(r => r.name === undefined && pointInPolygon(p, r.netPoly));
    if (room) { room.name = rn.name; room.nameId = rn.id; room.nameColor = rn.color; }
  }
}

/**
 * Shrink a room boundary to the inner wall faces: offset every edge inward by
 * the half-thickness of its wall, then intersect adjacent offset lines so the
 * corners miter properly instead of leaving gaps or overshoots.
 *
 * Bounded faces are always traced in the same rotational direction here (the
 * sharpest-left turn rule, verified by the positive-shoelace check above), so
 * "inward" is a fixed side of each edge: +perp() of the traversal direction.
 * (perp() is the clockwise visual side under y-down; with this turn rule that
 * points into the room. Offsetting the other way inflates the room to its outer
 * faces instead — verified both directions against a 4x3 m room in the tests.)
 * Parallel neighbours (a straight run split by a flattened arc) have no
 * intersection and keep the offset point itself.
 */
function insetPolygon(poly: Vec[], halves: number[]): Vec[] {
  const n = poly.length;
  if (n < 3) return poly;
  const lines: Array<{ p: Vec; d: Vec }> = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const d = sub(b, a);
    if (dist(a, b) < 1e-9) { lines.push({ p: a, d: v(1, 0) }); continue; }
    const dir = norm(d);
    lines.push({ p: add(a, scale(perp(dir), halves[i] ?? 0)), d: dir });
  }
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n]!, cur = lines[i]!;
    const x = lineIntersect(prev.p, prev.d, cur.p, cur.d);
    out.push(x ?? cur.p);
  }
  // Walls thicker than the room turn the boundary inside out: every edge
  // reverses, and the shoelace of a doubly-inverted rectangle is POSITIVE, so an
  // area check alone would report a plausible-looking room that does not exist.
  // Detect the inversion directly — any edge running opposite its original is a
  // collapse — and report no usable floor.
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const oa = out[i]!, ob = out[(i + 1) % n]!;
    if (dist(a, b) < 1e-9) continue;
    if (dot(sub(b, a), sub(ob, oa)) < 0) return [];
  }
  return out;
}

function angleOfEdge(hes: HalfEdge[], verts: Vec[], i: number): number {
  const he = hes[i]!;
  const a = verts[he.from]!, b = verts[he.to]!;
  return angleOf(v(b.x - a.x, b.y - a.y));
}
