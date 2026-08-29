// Room detection: flatten all wall centerlines, build a half-edge structure,
// walk faces by taking the sharpest-left next edge at each vertex. Bounded
// faces are rooms; the unbounded outer face is rejected by winding sign.
// Areas are centerline-bounded for now (net inner-face area is a P1 item).
import { Floor } from "../model/doc";
import { Vec, v, dist, angleOf, polygonArea, polygonCentroid } from "../geometry/vec";
import { arcFlatten } from "../geometry/arc";

export interface Room {
  poly: Vec[];
  areaMm2: number;
  centroid: Vec;
}

interface HalfEdge { from: number; to: number; visited: boolean }

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

  const addSeg = (a: Vec, b: Vec): void => {
    const ia = vid(a), ib = vid(b);
    if (ia === ib) return;
    const ek = Math.min(ia, ib) + "-" + Math.max(ia, ib);
    if (edgeSet.has(ek)) return;
    edgeSet.add(ek);
    for (const [from, to] of [[ia, ib], [ib, ia]] as const) {
      const idx = halfEdges.length;
      halfEdges.push({ from, to, visited: false });
      const arr = outgoing.get(from);
      if (arr) arr.push(idx); else outgoing.set(from, [idx]);
    }
  };

  for (const w of f.walls) {
    const A = nodePos.get(w.a), B = nodePos.get(w.b);
    if (!A || !B || dist(A, B) < 1) continue;
    const flat = arcFlatten(A, B, w.bulge, 5);
    for (let i = 0; i + 1 < flat.length; i++) addSeg(flat[i]!, flat[i + 1]!);
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
    let cur = start;
    let guard = 0;
    while (guard++ < 100000) {
      const he = halfEdges[cur]!;
      if (he.visited) break;
      he.visited = true;
      polyIdx.push(he.from);
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
    rooms.push({ poly, areaMm2: area, centroid: polygonCentroid(poly) });
  }
  return rooms;
}

function angleOfEdge(hes: HalfEdge[], verts: Vec[], i: number): number {
  const he = hes[i]!;
  const a = verts[he.from]!, b = verts[he.to]!;
  return angleOf(v(b.x - a.x, b.y - a.y));
}
