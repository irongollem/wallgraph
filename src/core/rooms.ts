// Room detection: flatten all wall centerlines, build a half-edge structure,
// walk faces by taking the sharpest-left next edge at each vertex. Bounded
// faces are rooms; the unbounded outer face is rejected by winding sign.
//
// Each room is reported with TWO boundaries, because plans are dimensioned both
// ways and the difference is not small — a 4x3 m room with 300 mm walls is 12 m²
// centerline but 9.99 m² net, a 20% gap:
//   poly    / areaMm2    centerline-bounded (hart-op-hart), what the graph stores
//   netPoly / netAreaMm2 inner wall faces (dagmaat), the usable floor NEN 2580 asks for
//   bvoPoly / bvoAreaMm2 gross: to the outer face of a clad wall, to the centreline
//                        of an unclad one -- NEN 2580's BVO, which is what a
//                        bedrijfsunit is advertised and taxed at
// The net boundary is derived by offsetting each face edge inward by half the
// thickness of the wall it lies on, then intersecting adjacent offset lines —
// the same miter construction resolve.ts uses at junctions.
import { Floor, DimMode, AreaMode, roomNamesOf, wallFacadeMm } from "../model/doc";
import type { Id } from "../model/doc";
import type { RoomName } from "../model/room";
import {
  Vec, v, dist, dot, sub, add, norm, perp, scale, cross, angleOf, lineIntersect,
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
  /**
   * Gross boundary, per NEN 2580: the outer face of the facade where a bounding
   * wall has one, and the centreline where it does not — which is what the
   * standard says about a party wall shared with a neighbour. Equal to `poly`
   * on a plan whose walls carry no facade, because that is then the same line.
   */
  bvoPoly: Vec[];
  /** Net floor area, mm². This is the NEN 2580-style number. */
  netAreaMm2: number;
  /** Gross floor area (BVO), mm², measured over `bvoPoly`. */
  bvoAreaMm2: number;
  centroid: Vec;
  /**
   * What this room is called, when a name has been written inside it. Derived,
   * not stored: the document holds the name and the point it was written at,
   * and the room that contains that point takes it. See model/room.ts.
   */
  name?: string;
  /** The RoomName the name came from, so the name can be rewritten. */
  nameId?: Id;
  /**
   * Walls whose centerline forms part of this room's boundary, deduplicated.
   * Follows straight from the half-edge walk below: every boundary edge is
   * one wall's own segment (a wall drawn through another's midpoint splits it
   * at that node first, so there is no wall a room edge could straddle), so
   * this is read off the same trace that finds the room rather than by
   * re-matching geometry afterward. What core/fitout.ts sums window area over
   * for the daylight ratio.
   */
  boundingWallIds: Id[];
}

interface HalfEdge { from: number; to: number; visited: boolean; half: number; wallId: Id }

/** One traced face of the flattened wall graph, before it is classified as a
 *  room or the outer boundary. */
interface Face { poly: Vec[]; halves: number[]; wallIds: Id[]; area: number }

/**
 * Walk every face of the flattened wall graph by the sharpest-left turn rule:
 * the bounded rooms AND the one unbounded outer face, undifferentiated. Faces
 * trace with positive shoelace area when bounded, negative when unbounded
 * (see the module comment) — callers tell them apart by sign.
 *
 * Shared by detectRooms() (keeps positive-area faces above the sliver
 * threshold) and outerBoundary() (keeps the unbounded one).
 */
function walkFaces(f: Floor): Face[] {
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

  const addSeg = (a: Vec, b: Vec, half: number, wallId: Id): void => {
    const ia = vid(a), ib = vid(b);
    if (ia === ib) return;
    const ek = Math.min(ia, ib) + "-" + Math.max(ia, ib);
    if (edgeSet.has(ek)) return;
    edgeSet.add(ek);
    for (const [from, to] of [[ia, ib], [ib, ia]] as const) {
      const idx = halfEdges.length;
      halfEdges.push({ from, to, visited: false, half, wallId });
      const arr = outgoing.get(from);
      if (arr) arr.push(idx); else outgoing.set(from, [idx]);
    }
  };

  for (const w of f.walls) {
    const A = nodePos.get(w.a), B = nodePos.get(w.b);
    if (!A || !B || dist(A, B) < 1) continue;
    const flat = arcFlatten(A, B, w.bulge, 5);
    const half = w.thickness / 2;
    for (let i = 0; i + 1 < flat.length; i++) addSeg(flat[i]!, flat[i + 1]!, half, w.id);
  }

  // Sort outgoing edges by angle for the turn rule.
  for (const [vi, arr] of outgoing) {
    arr.sort((e1, e2) => angleOfEdge(halfEdges, verts, e1) - angleOfEdge(halfEdges, verts, e2));
    outgoing.set(vi, arr);
  }

  const twin = (i: number): number => (i % 2 === 0 ? i + 1 : i - 1);

  const faces: Face[] = [];
  for (let start = 0; start < halfEdges.length; start++) {
    if (halfEdges[start]!.visited) continue;
    const polyIdx: number[] = [];
    const halves: number[] = []; // half-thickness of the wall carrying each edge
    const wallIds: Id[] = []; // which wall carries each edge, same order as halves
    let cur = start;
    let guard = 0;
    while (guard++ < 100000) {
      const he = halfEdges[cur]!;
      if (he.visited) break;
      he.visited = true;
      polyIdx.push(he.from);
      halves.push(he.half);
      wallIds.push(he.wallId);
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
    faces.push({ poly, halves, wallIds, area: polygonArea(poly) });
  }
  return faces;
}

export function detectRooms(f: Floor): Room[] {
  const rooms: Room[] = [];
  for (const face of walkFaces(f)) {
    // With this turn rule (y-down), bounded faces trace with positive shoelace
    // area; the unbounded outer face is negative. Verified by tests/core.test.ts.
    if (face.area <= 1e4) continue; // rejects outer face and <0.01 m² slivers
    const netPoly = insetPolygon(face.poly, face.halves);
    const netArea = Math.max(0, polygonArea(netPoly));
    // Gross: the same edge offsets run the other way, and only where the wall
    // carrying that edge is clad. An exterior wall bounds one room and its
    // facade is by definition on the far side of it, so no side check is needed
    // -- a facade drawn on the room side is a document error, not a case.
    const bvoPoly = insetPolygon(face.poly, face.wallIds.map((id, i) => {
      const w = f.walls.find(x => x.id === id);
      const fm = w ? wallFacadeMm(w) : undefined;
      return fm === undefined ? 0 : -((face.halves[i] ?? 0) + fm);
    }));
    rooms.push({
      poly: face.poly, areaMm2: face.area,
      netPoly, netAreaMm2: netArea,
      bvoPoly, bvoAreaMm2: Math.max(0, polygonArea(bvoPoly)),
      centroid: polygonCentroid(face.poly),
      boundingWallIds: Array.from(new Set(face.wallIds)),
    });
  }
  attachNames(f, rooms);
  return rooms;
}

/**
 * The outer boundary of the wall graph: centerline vertices, like `Room.poly`
 * — not offset to the outer wall faces. This is the unbounded face the same
 * half-edge walk visits and detectRooms() discards, so it is the most
 * negative-area face rather than the positive ones. Null when the graph
 * encloses nothing (no walls, or an open chain — walking a tree-shaped graph
 * retraces every edge and cancels to near-zero area either way).
 *
 * Assumes one connected wall graph, which is what a single storey's slab is;
 * several disjoint closed loops on one floor would each contribute their own
 * negative-area face and only the largest is reported.
 */
export function outerBoundary(f: Floor): Vec[] | null {
  let best: Face | null = null;
  for (const face of walkFaces(f)) {
    if (best === null || face.area < best.area) best = face;
  }
  if (!best || best.area >= -1e4) return null;
  return best.poly;
}

/**
 * The area one room reports under the plan's convention. One helper rather than
 * a ternary at each call site: the canvas, the panel, the SVG, the DXF, the IFC
 * space and the fit-out all have to state the same number, and a third mode is
 * exactly the change that leaves one of six ternaries behind.
 */
export function roomArea(r: Room, mode: AreaMode): number {
  return mode === "net" ? r.netAreaMm2
       : mode === "bvo" ? r.bvoAreaMm2
       : r.areaMm2;
}

/** Corners count as square within about two degrees. */
const SQUARE_TOL = 0.035;
/** Two edges count as one straight run within about half a degree. */
const STRAIGHT_TOL = 0.01;

/**
 * The two dimensions of a rectangular room, width first — the pair an interior
 * fitter sets out from. Undefined for anything else: an L-shaped room has no
 * single width and depth, and reporting its bounding box would state a span
 * that is not there.
 *
 * Run over `netPoly` this is the dagmaat, over `poly` the centerline size. A
 * room bounded by a wall that a partition tees into has extra vertices along a
 * straight side, so collinear runs are collapsed before the corners are counted.
 */
export function rectSize(poly: Vec[]): { w: number; d: number } | undefined {
  const p = corners(poly);
  if (p.length !== 4) return undefined;
  const edge = (i: number): { len: number; dir: Vec } => {
    const a = p[i]!, b = p[(i + 1) % 4]!;
    return { len: dist(a, b), dir: norm(sub(b, a)) };
  };
  const e = [edge(0), edge(1), edge(2), edge(3)];
  for (let i = 0; i < 4; i++) if (Math.abs(dot(e[i]!.dir, e[(i + 1) % 4]!.dir)) > SQUARE_TOL) return undefined;
  // Width is the more horizontal side, so the pair reads as it does on the
  // sheet rather than in the order the face happened to be walked.
  const wide = Math.abs(e[0]!.dir.x) >= Math.abs(e[1]!.dir.x) ? e[0]! : e[1]!;
  const deep = wide === e[0]! ? e[1]! : e[0]!;
  return { w: Math.round(wide.len), d: Math.round(deep.len) };
}

/**
 * The clear size to print inside a room, when the drawing's convention asks for
 * one and the room has one. Always the dagmaat: the centerline size of a room
 * is not a span anything is built to, so `centerline` prints nothing here and
 * leaves the wall chains to say it.
 */
export const roomSize = (r: Room, mode: DimMode): { w: number; d: number } | undefined =>
  mode === "centerline" ? undefined : rectSize(r.netPoly);

/** "4120 × 6890" — width first, in mm, the way a sheet writes a clear size. */
export const sizeLabel = (s: { w: number; d: number }, times = "×"): string =>
  `${s.w} ${times} ${s.d}`;

/** The polygon's real corners: vertices where the boundary turns. */
function corners(poly: Vec[]): Vec[] {
  const out: Vec[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n]!, b = poly[i]!, c = poly[(i + 1) % n]!;
    if (dist(a, b) < 1 || dist(b, c) < 1) continue;
    if (Math.abs(cross(norm(sub(b, a)), norm(sub(c, b)))) > STRAIGHT_TOL) out.push(b);
  }
  return out;
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
    if (room) { room.name = rn.name; room.nameId = rn.id; }
  }
}

/** Stored labels that currently fall in no detected room (including duplicates). */
export function unattachedRoomNames(f: Floor, rooms: Room[]): RoomName[] {
  const attached = new Set(rooms.flatMap(r => r.nameId === undefined ? [] : [r.nameId]));
  return roomNamesOf(f).filter(rn => !attached.has(rn.id));
}

/**
 * The names a wall edit has left with nothing to name: their ids, for the edit
 * to delete.
 *
 * Taking out the wall between a hal and a werkplaats leaves one room, and both
 * names then fall inside it. That is not a merge — one of the two named a room
 * that no longer exists — so the name of the larger of the two keeps the space
 * and the other is finished. It is the reading most likely to be right, and
 * whoever is drawing corrects it in one edit either way.
 *
 * `before` is the room set as it stood before the edit, which is where the
 * sizes come from: afterwards there is nothing left to compare. A name that
 * named no room before ranks below every name that did, so a word left over
 * from an earlier layout never takes the room off the name that held it.
 */
export function orphanedRoomNames(f: Floor, before: Room[]): Id[] {
  const names = roomNamesOf(f);
  if (names.length < 2) return [];
  const was = new Map<Id, number>();
  for (const r of before) if (r.nameId !== undefined) was.set(r.nameId, r.areaMm2);
  const dead: Id[] = [];
  for (const room of detectRooms(f)) {
    const inside = names.filter(rn => pointInPolygon(v(rn.x, rn.y), room.netPoly));
    if (inside.length < 2) continue;
    const keep = inside.reduce((a, b) => ((was.get(b.id) ?? -1) > (was.get(a.id) ?? -1) ? b : a));
    for (const rn of inside) if (rn.id !== keep.id) dead.push(rn.id);
  }
  return dead;
}

/**
 * The stored names that draw on their own, where they were written: the ones
 * that name no detected room. An open-plan space and a room whose walls are not
 * closed yet need that.
 *
 * A name whose point has ended up inside a room another name already took is
 * left out. Two names in one room is a mistake rather than a merge — see
 * attachNames() — and drawing the second beside the first states it as a room
 * that is not there: take out the wall between a hal and a werkplaats and the
 * one room that results carries one name, not two. The word stays in the
 * document and stays listed in the room pane, so it can be edited or deleted
 * there, and it draws again the moment the wall comes back.
 *
 * The canvas, the SVG and the DXF all label a plan from this, so they cannot
 * disagree about which words are on it.
 */
export function looseRoomNames(f: Floor, rooms: Room[]): RoomName[] {
  return unattachedRoomNames(f, rooms).filter(rn =>
    !rooms.some(r => r.name !== undefined && pointInPolygon(v(rn.x, rn.y), r.netPoly)));
}

/**
 * A room's identity between two renders. Rooms are derived and carry no id, so
 * the panel keys its rows on the one thing a rename cannot change: where the
 * room sits. Moving a wall changes the key, which is correct — that is a
 * different outline.
 */
export function roomKey(r: Room): string {
  return `${Math.round(r.centroid.x)},${Math.round(r.centroid.y)}`;
}

/**
 * Where to write this room's name so that attachNames() hands it back. The
 * centroid is the obvious answer and the wrong one for a concave room: an
 * L-shaped floor has its centroid in the missing corner, and a name written
 * there attaches to nothing. Falls back to the middle of the widest horizontal
 * span inside the room, sampled across its height.
 */
export function roomAnchor(r: Room): Vec {
  const poly = r.netPoly.length >= 3 ? r.netPoly : r.poly;
  const round = (p: Vec): Vec => v(Math.round(p.x), Math.round(p.y));
  if (poly.length < 3 || pointInPolygon(r.centroid, poly)) return round(r.centroid);

  let minY = Infinity, maxY = -Infinity;
  for (const p of poly) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const ys = [r.centroid.y];
  for (let i = 1; i < SPAN_SAMPLES; i++) ys.push(minY + ((maxY - minY) * i) / SPAN_SAMPLES);

  let best: { p: Vec; width: number } | null = null;
  for (const y of ys) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      if ((a.y > y) === (b.y > y)) continue;
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    // Crossings pair up into inside-spans; the widest is the roomiest place a
    // word can stand.
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1]! - xs[i]!;
      if (!best || width > best.width) best = { p: v((xs[i]! + xs[i + 1]!) / 2, y), width };
    }
  }
  return round(best ? best.p : r.centroid);
}

/** Horizontal lines tried when the centroid falls outside its own room. */
const SPAN_SAMPLES = 8;

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
