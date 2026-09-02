// The whole-building triangle mesh: every storey's derived solids placed at
// its elevation and extruded into flat-shaded prisms for a 3D renderer.
//
// Conventions follow core/solids.ts: x/y stay document space (mm, y down) and
// z is height above Peil (mm, positive up); a renderer maps axes itself. Pure
// and uncached like the rest of the derived geometry — callers cache against
// the store revision.
import { PlanDoc, floorElevation, stairsOf } from "../model/doc";
import { floorSolids } from "../core/solids";
import { resolveStair, stairCorners } from "../core/stair";
import { Vec, dist, polygonArea } from "../geometry/vec";
import { triangulatePolygon, triangulateWithHoles } from "./triangulate";

export interface Bounds3 { min: [number, number, number]; max: [number, number, number] }

export interface Mesh3D {
  /** Triangle soup: xyz per vertex, mm. x/y are document space (y down), z is height above Peil, positive up. */
  positions: Float32Array;
  /** Per-vertex face normals, unit length, same convention. Flat shading: vertices are not shared across faces. */
  normals: Float32Array;
  /** Per-vertex rgb, each channel 0..1. */
  colors: Float32Array;
  /** Outline segments for GL_LINES rendering: consecutive xyz vertex pairs, mm. */
  edges: Float32Array;
  /** Null when the document yields no geometry. */
  bounds: Bounds3 | null;
}

type Rgb = readonly [number, number, number];

/** Wall prisms: light warm grey, reading against the #f4f2ec canvas ground. */
export const WALL_COLOR: Rgb = [0.93, 0.92, 0.9];
/** Slab prisms: a step darker than the walls they carry. */
export const SLAB_COLOR: Rgb = [0.8, 0.79, 0.77];
/** Stair boxes: muted warm tone. */
export const STAIR_COLOR: Rgb = [0.85, 0.8, 0.72];

/** Height differences (mm) under which a prism is not emitted. */
const H_EPS = 1e-6;
/** Distance (mm) under which two ring vertices are one point. */
const RING_EPS = 1e-6;
/** Footprint areas (mm²) under which a prism is not emitted. */
const AREA_EPS = 1e-6;
/**
 * A vertical outline edge is drawn where the footprint turns by more than 30°
 * (incoming/outgoing direction cosine below this). Arcs are flattened into
 * many small turns, so an unthresholded edge per vertex would render a curved
 * wall as hatching.
 */
const EDGE_TURN_COS = Math.cos(Math.PI / 6);

interface MeshAcc { positions: number[]; normals: number[]; colors: number[]; edges: number[] }

/**
 * The building as one triangle soup: per storey, wall prisms (with the bands a
 * window's borstwering and an opening's lintel put back), the slab with its
 * vide holes, and each stair as a box over its footprint. Spaces are room
 * volumes, not built fabric, and are not rendered.
 */
export function buildSceneMesh(doc: PlanDoc): Mesh3D {
  const acc: MeshAcc = { positions: [], normals: [], colors: [], edges: [] };

  for (let i = 0; i < doc.floors.length; i++) {
    const fs = floorSolids(doc, i);
    if (!fs) continue;
    const f = doc.floors[i]!;
    const elev = floorElevation(doc, i);

    for (const w of fs.walls) {
      for (const p of w.body) emitPrism(acc, p.poly, [], elev + p.z0, elev + p.z1, WALL_COLOR);
      // The resolved pieces are the solid intervals BETWEEN openings, cut at
      // full wall height. The band below a sill and the band above a head put
      // that material back, so a wall with a window is exact without CSG.
      const h = w.body[0]?.z1 ?? w.voids.reduce((top, o) => Math.max(top, o.z1), 0);
      for (const o of w.voids) {
        if (o.z0 > H_EPS) emitPrism(acc, o.poly, [], elev, elev + o.z0, WALL_COLOR);
        if (o.z1 < h - H_EPS) emitPrism(acc, o.poly, [], elev + o.z1, elev + h, WALL_COLOR);
      }
    }

    if (fs.slab) {
      emitPrism(acc, fs.slab.outline, fs.slab.holes, elev + fs.slab.z0, elev + fs.slab.z1, SLAB_COLOR);
    }

    for (const st of stairsOf(f)) {
      const r = resolveStair(f, st);
      // stairCorners() returns the corners in grid order (x0,y0) (x0,y1)
      // (x1,y0) (x1,y1); reorder into a traversal of the footprint quad.
      const c = stairCorners(r);
      emitPrism(acc, [c[0]!, c[1]!, c[3]!, c[2]!], [], elev, elev + r.rise, STAIR_COLOR);
    }
  }

  return {
    positions: new Float32Array(acc.positions),
    normals: new Float32Array(acc.normals),
    colors: new Float32Array(acc.colors),
    edges: new Float32Array(acc.edges),
    bounds: boundsOf(acc.positions),
  };
}

/**
 * One extruded footprint: caps triangulated (holes bridged into the outer
 * ring), one quad per boundary edge including hole loops, vertices duplicated
 * per face for flat shading.
 *
 * Orientation invariant: rings are normalized by shoelace sign (outer
 * positive, holes negative, in raw x/y terms), and faces are wound so the
 * closed prism's signed volume Σ dot(a, cross(b, c))/6 over its triangles is
 * positive and equals footprint area × height.
 */
function emitPrism(acc: MeshAcc, footprint: Vec[], holes: Vec[][], z0: number, z1: number, color: Rgb): void {
  if (!(z1 - z0 > H_EPS)) return;
  const outer = cleanRing(footprint);
  if (outer.length < 3 || Math.abs(polygonArea(outer)) <= AREA_EPS) return;
  if (polygonArea(outer) < 0) outer.reverse();

  const rings: Vec[][] = [outer];
  for (const h of holes) {
    const r = cleanRing(h);
    if (r.length < 3 || Math.abs(polygonArea(r)) <= AREA_EPS) continue;
    if (polygonArea(r) > 0) r.reverse();
    rings.push(r);
  }
  const holeRings = rings.slice(1);

  // Caps. Triangles come back in the outer ring's (positive) winding, which
  // faces +z; the bottom cap reverses them to face -z.
  const cap = holeRings.length > 0
    ? triangulateWithHoles(outer, holeRings)
    : { verts: outer, tris: triangulatePolygon(outer) };
  for (let i = 0; i + 2 < cap.tris.length; i += 3) {
    const a = cap.verts[cap.tris[i]!]!, b = cap.verts[cap.tris[i + 1]!]!, c = cap.verts[cap.tris[i + 2]!]!;
    pushTri(acc, a.x, a.y, z1, b.x, b.y, z1, c.x, c.y, z1, color);
    pushTri(acc, a.x, a.y, z0, c.x, c.y, z0, b.x, b.y, z0, color);
  }

  // Sides and outline edges. With the outer ring positive and hole rings
  // negative, material lies left of travel on every ring, so the quad winding
  // and the outward normal are one rule for both.
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i]!, q = ring[(i + 1) % n]!;
      pushTri(acc, p.x, p.y, z0, q.x, q.y, z0, q.x, q.y, z1, color);
      pushTri(acc, p.x, p.y, z0, q.x, q.y, z1, p.x, p.y, z1, color);
      acc.edges.push(p.x, p.y, z0, q.x, q.y, z0);
      acc.edges.push(p.x, p.y, z1, q.x, q.y, z1);
    }
    for (let i = 0; i < n; i++) {
      const prev = ring[(i + n - 1) % n]!, cur = ring[i]!, next = ring[(i + 1) % n]!;
      if (turnCos(prev, cur, next) < EDGE_TURN_COS) {
        acc.edges.push(cur.x, cur.y, z0, cur.x, cur.y, z1);
      }
    }
  }
}

/** One triangle with its face normal; a degenerate triangle is skipped. */
function pushTri(
  acc: MeshAcc,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  color: Rgb,
): void {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l <= AREA_EPS) return;
  acc.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  for (let k = 0; k < 3; k++) {
    acc.normals.push(nx / l, ny / l, nz / l);
    acc.colors.push(color[0], color[1], color[2]);
  }
}

/** Drop consecutive (and closing) duplicate vertices. */
function cleanRing(poly: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > RING_EPS) out.push(p);
  }
  while (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= RING_EPS) out.pop();
  return out;
}

/** Cosine of the footprint's turn at `cur`: incoming vs outgoing direction. */
function turnCos(prev: Vec, cur: Vec, next: Vec): number {
  const ix = cur.x - prev.x, iy = cur.y - prev.y;
  const ox = next.x - cur.x, oy = next.y - cur.y;
  const li = Math.hypot(ix, iy) || 1, lo = Math.hypot(ox, oy) || 1;
  return (ix * ox + iy * oy) / (li * lo);
}

function boundsOf(positions: number[]): Bounds3 | null {
  if (positions.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const c = positions[i + k]!;
      if (c < min[k]!) min[k] = c;
      if (c > max[k]!) max[k] = c;
    }
  }
  return { min, max };
}
