// 2D polygon triangulation for the 3D mesh: ear clipping, with hole rings
// bridged into the outer ring so a prism cap needs no solid subtraction.
//
// Pure geometry over document-space polygons (mm, y down). Robust rather than
// fast: the O(n²) ear search is well under a frame at plan scale, degenerate
// input (duplicate or collinear vertices) is dropped instead of thrown on, and
// a pass that finds no ear fans the remainder so a caller always gets a
// triangle list back.
import { Vec, v, sub, cross, dist, polygonArea } from "../geometry/vec";

/** Twice-area (mm²) under which a triangle is treated as degenerate. */
const AREA_EPS = 1e-6;
/** Distance (mm) under which two vertices are the same point. */
const POINT_EPS = 1e-9;

/**
 * Ear-clip `poly` into index triples into `poly`. Accepts either winding and
 * returns triangles in the input's own winding. Duplicate and collinear
 * vertices are skipped without a triangle; a degenerate polygon yields an
 * empty list.
 */
export function triangulatePolygon(poly: Vec[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const sign = polygonArea(poly) >= 0 ? 1 : -1;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const tris: number[] = [];

  while (idx.length > 3) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const m = idx.length;
      const ip = idx[(i + m - 1) % m]!, ic = idx[i]!, inx = idx[(i + 1) % m]!;
      const a = poly[ip]!, b = poly[ic]!, c = poly[inx]!;
      const area2 = cross(sub(b, a), sub(c, a));
      if (Math.abs(area2) <= AREA_EPS) {
        // Collinear triple or duplicate point: the middle vertex adds nothing.
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (area2 * sign < 0) continue; // reflex corner, not an ear
      if (earBlocked(poly, idx, ip, ic, inx, sign)) continue;
      tris.push(ip, ic, inx);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Self-intersecting input past what ear clipping handles: fan the
      // remainder so the caller still gets a full triangle list.
      for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0]!, idx[i]!, idx[i + 1]!);
      return tris;
    }
  }

  if (idx.length === 3) {
    const a = poly[idx[0]!]!, b = poly[idx[1]!]!, c = poly[idx[2]!]!;
    if (Math.abs(cross(sub(b, a), sub(c, a))) > AREA_EPS) tris.push(idx[0]!, idx[1]!, idx[2]!);
  }
  return tris;
}

/**
 * Triangulate an outer ring with hole rings: each hole is bridged into the
 * outer ring at a mutually visible vertex (from the hole's max-x vertex,
 * rightward), then the combined ring is ear-clipped. `verts` is that combined
 * ring — bridge vertices appear twice — and `tris` indexes into it, in the
 * outer ring's winding. Either winding is accepted for every ring.
 */
export function triangulateWithHoles(outer: Vec[], holes: Vec[][]): { verts: Vec[]; tris: number[] } {
  let ring = outer.slice();
  const sign = polygonArea(outer) >= 0 ? 1 : -1;

  // Holes traverse opposite to the outer ring, rightmost hole bridged first so
  // no unmerged hole can lie across a later bridge ray.
  const hs: Vec[][] = [];
  for (const h of holes) {
    if (h.length < 3 || Math.abs(polygonArea(h)) <= AREA_EPS) continue;
    hs.push((polygonArea(h) >= 0 ? 1 : -1) === sign ? h.slice().reverse() : h.slice());
  }
  hs.sort((a, b) => maxX(b) - maxX(a));
  for (const h of hs) ring = bridgeHole(ring, h, sign);

  return { verts: ring, tris: triangulatePolygon(ring) };
}

/** True when a remaining vertex other than the ear's corners lies in the ear. */
function earBlocked(poly: Vec[], idx: number[], ip: number, ic: number, inx: number, sign: number): boolean {
  const a = poly[ip]!, b = poly[ic]!, c = poly[inx]!;
  for (const iv of idx) {
    if (iv === ip || iv === ic || iv === inx) continue;
    const p = poly[iv]!;
    // A bridge duplicates vertices; a copy of an ear corner does not block it.
    if (dist(p, a) <= POINT_EPS || dist(p, b) <= POINT_EPS || dist(p, c) <= POINT_EPS) continue;
    if (inTriangle(p, a, b, c, sign)) return true;
  }
  return false;
}

/** Boundary-inclusive point-in-triangle, for a triangle of orientation `sign`. */
function inTriangle(p: Vec, a: Vec, b: Vec, c: Vec, sign: number): boolean {
  return cross(sub(b, a), sub(p, a)) * sign >= -AREA_EPS
    && cross(sub(c, b), sub(p, b)) * sign >= -AREA_EPS
    && cross(sub(a, c), sub(p, c)) * sign >= -AREA_EPS;
}

function maxX(poly: Vec[]): number {
  let x = -Infinity;
  for (const p of poly) if (p.x > x) x = p.x;
  return x;
}

/**
 * Splice `hole` into `ring` at a vertex visible from the hole's max-x vertex.
 * Standard rightward bridging: cast a +x ray from that vertex, take the
 * closest ring-edge crossing, and connect to the crossed edge's endpoint —
 * unless a reflex ring vertex inside the (vertex, crossing, endpoint) triangle
 * is a nearer-to-the-ray connection, in which case connect there. `sign` is
 * the outer ring's shoelace sign, which the merged ring keeps.
 */
function bridgeHole(ring: Vec[], hole: Vec[], sign: number): Vec[] {
  let mi = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i]!.x > hole[mi]!.x) mi = i;
  const m = hole[mi]!;

  let bestIx = Infinity, bestEdge = -1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    if ((p.y <= m.y) === (q.y <= m.y)) continue;
    const ix = p.x + ((m.y - p.y) * (q.x - p.x)) / (q.y - p.y);
    if (ix >= m.x - POINT_EPS && ix < bestIx) { bestIx = ix; bestEdge = i; }
  }

  let bi: number;
  if (bestEdge < 0) {
    // The ray leaves the ring without a crossing (a hole outside the outline
    // as drawn): connect to the nearest ring vertex rather than fail.
    bi = 0;
    for (let i = 1; i < ring.length; i++) if (dist(ring[i]!, m) < dist(ring[bi]!, m)) bi = i;
  } else {
    const p = ring[bestEdge]!, q = ring[(bestEdge + 1) % ring.length]!;
    const inter = v(bestIx, m.y);
    if (dist(p, inter) <= POINT_EPS) bi = bestEdge;
    else if (dist(q, inter) <= POINT_EPS) bi = (bestEdge + 1) % ring.length;
    else {
      bi = q.x > p.x ? (bestEdge + 1) % ring.length : bestEdge;
      const cand = ring[bi]!;
      const triSign = cross(sub(inter, m), sub(cand, m)) >= 0 ? 1 : -1;
      let bestCos = -2, bestD = Infinity;
      for (let i = 0; i < ring.length; i++) {
        if (i === bi) continue;
        const r = ring[i]!;
        if (dist(r, m) <= POINT_EPS || dist(r, cand) <= POINT_EPS) continue;
        const prev = ring[(i + ring.length - 1) % ring.length]!;
        const next = ring[(i + 1) % ring.length]!;
        if (cross(sub(r, prev), sub(next, r)) * sign >= -AREA_EPS) continue; // convex
        if (!inTriangle(r, m, inter, cand, triSign)) continue;
        const d = dist(r, m) || 1;
        const cos = (r.x - m.x) / d;
        if (cos > bestCos || (cos === bestCos && d < bestD)) { bestCos = cos; bestD = d; bi = i; }
      }
    }
  }

  const out: Vec[] = ring.slice(0, bi + 1);
  for (let k = 0; k <= hole.length; k++) out.push(hole[(mi + k) % hole.length]!);
  out.push(ring[bi]!);
  out.push(...ring.slice(bi + 1));
  return out;
}
