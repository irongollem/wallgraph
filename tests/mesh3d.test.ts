// 3D scene mesh: triangulation area preservation, prism volumes against the
// derived solids, storey elevation and bounds.
import {
  emptyDoc, newId, FLOOR_HEIGHT_DEFAULT, Wall, Opening, Floor,
} from "../src/model/doc";
import { floorSolids, SLAB_DEFAULT_MM } from "../src/core/solids";
import {
  buildSceneMesh, Mesh3D, WALL_COLOR, SLAB_COLOR, STAIR_COLOR,
  DOOR_COLOR, GLASS_COLOR, PLATE_SEAT_MM,
} from "../src/render3d/mesh";
import { triangulatePolygon, triangulateWithHoles } from "../src/render3d/triangulate";
import { v, Vec, polygonArea } from "../src/geometry/vec";
import { seedDoc } from "../src/seed";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }
function nearRel(a: number, b: number, rel = 1e-4): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * rel);
}

/** A closed 4000x3000 rectangle, one node per corner, walls in order. */
function rectFloor(wallTh = 100): Floor {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    const w: Wall = { id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: wallTh, bulge: 0, openings: [] };
    f.walls.push(w);
  }
  return f;
}

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

function emptyDocWith(f: Floor): ReturnType<typeof emptyDoc> {
  const doc = emptyDoc();
  doc.floors = [f];
  return doc;
}

/** Sum of unsigned triangle areas, mm². */
function trisArea(verts: Vec[], tris: number[]): number {
  let s = 0;
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = verts[tris[i]!]!, b = verts[tris[i + 1]!]!, c = verts[tris[i + 2]!]!;
    s += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  return s;
}

/**
 * Signed volume of the triangle soup via the divergence theorem, mm³. With
 * `rgb` set, only triangles of that colour count; with `zMin`, only triangles
 * whose vertices all sit at z >= zMin. The subset is shifted down by zMin
 * before summing, so a neighbouring prism's flat cap lying exactly in that
 * plane contributes zero while closed prisms keep their volume.
 */
function volumeOf(m: Mesh3D, rgb?: readonly [number, number, number], zMin = -Infinity): number {
  let s = 0;
  const dz = isFinite(zMin) ? zMin : 0;
  const P = m.positions, C = m.colors;
  for (let i = 0; i + 8 < P.length; i += 9) {
    if (rgb && (Math.abs(C[i]! - rgb[0]) > 1e-3 || Math.abs(C[i + 1]! - rgb[1]) > 1e-3
      || Math.abs(C[i + 2]! - rgb[2]) > 1e-3)) continue;
    if (P[i + 2]! < zMin - 0.5 || P[i + 5]! < zMin - 0.5 || P[i + 8]! < zMin - 0.5) continue;
    const ax = P[i]!, ay = P[i + 1]!, az = P[i + 2]! - dz;
    const bx = P[i + 3]!, by = P[i + 4]!, bz = P[i + 5]! - dz;
    const cx = P[i + 6]!, cy = P[i + 7]!, cz = P[i + 8]! - dz;
    s += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return s;
}

// ── triangulation: area preservation ────────────────────────────────────────

{
  const square = [v(0, 0), v(100, 0), v(100, 100), v(0, 100)];
  const tris = triangulatePolygon(square);
  check("convex quad triangulates to its area", near(trisArea(square, tris), 10000, 1e-6));
  const rev = square.slice().reverse();
  check("convex quad, reversed winding", near(trisArea(rev, triangulatePolygon(rev)), 10000, 1e-6));
}

{
  const L = [v(0, 0), v(400, 0), v(400, 200), v(200, 200), v(200, 400), v(0, 400)];
  const expected = 400 * 200 + 200 * 200;
  check("L-shape triangulates to its area", near(trisArea(L, triangulatePolygon(L)), expected, 1e-6));
  const rev = L.slice().reverse();
  check("L-shape, reversed winding", near(trisArea(rev, triangulatePolygon(rev)), expected, 1e-6));
  const tris = triangulatePolygon(L);
  check("indices stay in range", tris.every(i => i >= 0 && i < L.length) && tris.length % 3 === 0);
}

{
  const outer = [v(0, 0), v(400, 0), v(400, 400), v(0, 400)];
  const hole = [v(150, 150), v(250, 150), v(250, 250), v(150, 250)];
  const expected = 400 * 400 - 100 * 100;
  const r1 = triangulateWithHoles(outer, [hole]);
  check("ring with a hole: outer minus hole area", near(trisArea(r1.verts, r1.tris), expected, 1e-6),
    String(trisArea(r1.verts, r1.tris)));
  const r2 = triangulateWithHoles(outer.slice().reverse(), [hole.slice().reverse()]);
  check("ring with a hole, both rings reversed", near(trisArea(r2.verts, r2.tris), expected, 1e-6));
  const r3 = triangulateWithHoles(outer, [hole.slice().reverse()]);
  check("hole winding is normalized against the outer ring",
    near(trisArea(r3.verts, r3.tris), expected, 1e-6));
}

// ── triangulation: degenerate input ─────────────────────────────────────────

{
  const collinear = [v(0, 0), v(50, 0), v(100, 0), v(100, 100), v(0, 100)];
  let threw = false, tris: number[] = [];
  try { tris = triangulatePolygon(collinear); } catch { threw = true; }
  check("a collinear vertex does not throw", !threw);
  check("a collinear vertex keeps the area", near(trisArea(collinear, tris), 10000, 1e-6));

  const dup = [v(0, 0), v(100, 0), v(100, 0), v(100, 100), v(0, 100)];
  threw = false; tris = [];
  try { tris = triangulatePolygon(dup); } catch { threw = true; }
  check("a duplicate point does not throw", !threw);
  check("a duplicate point keeps the area", near(trisArea(dup, tris), 10000, 1e-6));

  check("a degenerate polygon yields no triangles",
    triangulatePolygon([v(0, 0), v(100, 0)]).length === 0
    && triangulatePolygon([v(0, 0), v(50, 0), v(100, 0)]).length === 0);
}

// ── one-room rectangular plan ───────────────────────────────────────────────

const rectDoc = emptyDocWith(rectFloor());
const rectMesh = buildSceneMesh(rectDoc);
const rectWallVol = volumeOf(rectMesh, WALL_COLOR);
const rectSlabVol = volumeOf(rectMesh, SLAB_COLOR);

{
  const m = rectMesh;
  check("the mesh is non-empty", m.positions.length > 0);
  check("positions are triangles", m.positions.length % 9 === 0);
  check("one normal and one colour per vertex",
    m.normals.length === m.positions.length && m.colors.length === m.positions.length);
  check("edges are segment pairs", m.edges.length % 6 === 0 && m.edges.length > 0);

  let unit = true;
  for (let i = 0; i < m.normals.length; i += 3) {
    if (Math.abs(Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!) - 1) > 1e-3) { unit = false; break; }
  }
  check("normals are unit length", unit);

  let vertical = false;
  for (let i = 0; i + 5 < m.edges.length; i += 6) {
    if (m.edges[i + 2] !== m.edges[i + 5]) { vertical = true; break; }
  }
  check("vertical outline edges exist at the corners", vertical);

  check("bounds exist", m.bounds !== null);
  if (m.bounds) {
    check("z range is slab bottom to wall top",
      near(m.bounds.min[2], -SLAB_DEFAULT_MM, 1e-3) && near(m.bounds.max[2], FLOOR_HEIGHT_DEFAULT, 1e-3),
      JSON.stringify([m.bounds.min[2], m.bounds.max[2]]));
    check("x/y bounds reach the outer wall faces",
      near(m.bounds.min[0], -50, 0.01) && near(m.bounds.min[1], -50, 0.01)
      && near(m.bounds.max[0], 4050, 0.01) && near(m.bounds.max[1], 3050, 0.01),
      JSON.stringify(m.bounds));
  }

  // Expected wall volume two ways: the solids' own piece areas, and the hand
  // figure for a 100-thick ring mitred at right angles.
  const fs = floorSolids(rectDoc, 0)!;
  let expected = 0;
  for (const w of fs.walls) for (const p of w.body) {
    expected += Math.abs(polygonArea(p.poly)) * (p.z1 - p.z0);
  }
  check("wall volume equals piece area x height", nearRel(rectWallVol, expected),
    `${rectWallVol} vs ${expected}`);
  check("wall volume equals the mitred ring figure",
    nearRel(rectWallVol, 1400000 * FLOOR_HEIGHT_DEFAULT, 1e-3), String(rectWallVol));

  const slabExpected = Math.abs(polygonArea(fs.slab!.outline)) * SLAB_DEFAULT_MM;
  check("slab volume equals outline area x thickness", nearRel(rectSlabVol, slabExpected),
    `${rectSlabVol} vs ${slabExpected}`);
  check("no stair triangles without a stair", volumeOf(m, STAIR_COLOR) === 0);
}

// ── a window opening: void carved, bands put back ───────────────────────────

{
  const f = rectFloor();
  // Defaults: sill 900, height 1415, so the void is 1200 wide x 100 thick.
  f.walls[0]!.openings.push(opening({ kind: "window", t: 1500, width: 1200 }));
  const m = buildSceneMesh(emptyDocWith(f));
  const vol = volumeOf(m, WALL_COLOR);
  const voidVol = 1200 * 100 * 1415;
  check("a window removes exactly its void volume", nearRel(vol, rectWallVol - voidVol),
    `${vol} vs ${rectWallVol - voidVol}`);
  check("the carved wall is thinner than the blank one", vol < rectWallVol);
  const pane = volumeOf(m, GLASS_COLOR);
  check("a window carries a pane in the void", nearRel(pane, 1200 * 30 * 1415, 1e-3), String(pane));
  check("a window carries no door leaf", volumeOf(m, DOOR_COLOR) === 0);
}

{
  const f = rectFloor();
  // A door void reaches the floor: only the lintel band above 2315 comes back.
  f.walls[0]!.openings.push(opening({ kind: "door", t: 1500, width: 830 }));
  const m = buildSceneMesh(emptyDocWith(f));
  const vol = volumeOf(m, WALL_COLOR);
  const voidVol = 830 * 100 * 2315;
  check("a door removes exactly its void volume", nearRel(vol, rectWallVol - voidVol),
    `${vol} vs ${rectWallVol - voidVol}`);
  const leaf = volumeOf(m, DOOR_COLOR);
  check("a door carries a leaf in the void", nearRel(leaf, 830 * 40 * 2315, 1e-3), String(leaf));
}

{
  const f = rectFloor();
  f.walls[0]!.openings.push(opening({ kind: "passage", t: 1500, width: 1000 }));
  const m = buildSceneMesh(emptyDocWith(f));
  check("a passage stays open",
    volumeOf(m, DOOR_COLOR) === 0 && volumeOf(m, GLASS_COLOR) === 0);
}

// ── junction fillers: a T-node's wedge is wall material ─────────────────────

{
  // The rectangle with its long walls split at x=2000 and a thick interior
  // wall joining the two midpoints: two degree-3 nodes, each with the wedge
  // resolveFloor() derives where the thick wall meets the thin ring.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(2000, 0), v(4000, 0), v(4000, 3000), v(2000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  const wall = (a: number, b: number, thickness = 100): void => {
    f.walls.push({ id: newId("w"), a: ids[a]!, b: ids[b]!, thickness, bulge: 0, openings: [] });
  };
  wall(0, 1); wall(1, 2); wall(2, 3); wall(3, 4); wall(4, 5); wall(5, 0);
  wall(1, 4, 300);
  const fs = floorSolids(doc, 0)!;
  check("the T-nodes derive junction fillers", fs.junctions.length >= 1, String(fs.junctions.length));
  const m = buildSceneMesh(doc);
  let expected = 0;
  for (const w of fs.walls) for (const p of w.body) expected += Math.abs(polygonArea(p.poly)) * (p.z1 - p.z0);
  for (const j of fs.junctions) expected += Math.abs(polygonArea(j.poly)) * (j.z1 - j.z0);
  const vol = volumeOf(m, WALL_COLOR);
  check("wall volume includes the junction wedges", nearRel(vol, expected, 1e-3),
    `${vol} vs ${expected}`);
}

// ── a vide: slab volume drops by hole area x thickness ─────────────────────

{
  const f = rectFloor();
  f.vides = [{ id: newId("v"), x: 2000, y: 1500, rotation: 0, width: 1200, depth: 800 }];
  const m = buildSceneMesh(emptyDocWith(f));
  const vol = volumeOf(m, SLAB_COLOR);
  const holeVol = 1200 * 800 * SLAB_DEFAULT_MM;
  check("a vide removes hole area x slab thickness", nearRel(vol, rectSlabVol - holeVol),
    `${vol} vs ${rectSlabVol - holeVol}`);
}

// ── two storeys sit one elevation apart, the lower seated under the slab ────

/** Mitred-ring wall area of rectFloor(), mm² (see the one-storey figure). */
const RING_AREA = 1400000;

{
  const doc = emptyDoc();
  doc.floors = [rectFloor(), rectFloor()];
  const m = buildSceneMesh(doc);
  // The lower storey's walls are seated PLATE_SEAT_MM under the slab resting
  // on them, so the coplanar tops cannot z-fight; the top storey carries no
  // plate and keeps its full height.
  const seated = RING_AREA * (FLOOR_HEIGHT_DEFAULT - PLATE_SEAT_MM);
  check("the lower storey is seated under the slab above",
    nearRel(volumeOf(m, WALL_COLOR), seated + rectWallVol, 1e-3),
    String(volumeOf(m, WALL_COLOR)));
  check("the upper storey's walls alone match one storey",
    nearRel(volumeOf(m, WALL_COLOR, FLOOR_HEIGHT_DEFAULT), rectWallVol));
  check("bounds span both storeys", m.bounds !== null
    && near(m.bounds!.min[2], -SLAB_DEFAULT_MM, 1e-3)
    && near(m.bounds!.max[2], 2 * FLOOR_HEIGHT_DEFAULT, 1e-3),
    JSON.stringify(m.bounds));
  // Identical stacked outlines: the upper storey covers the lower, so no
  // terrace plate doubles the slab.
  check("stacked identical storeys carry one slab per level",
    nearRel(volumeOf(m, SLAB_COLOR, FLOOR_HEIGHT_DEFAULT - SLAB_DEFAULT_MM), rectSlabVol),
    String(volumeOf(m, SLAB_COLOR, FLOOR_HEIGHT_DEFAULT - SLAB_DEFAULT_MM)));

  // Hiding a storey removes it, and the storey below it comes back unseated.
  const lowerOnly = buildSceneMesh(doc, new Set([doc.floors[1]!.id]));
  check("hiding the top storey shows the lower at full height",
    nearRel(volumeOf(lowerOnly, WALL_COLOR), rectWallVol, 1e-3),
    String(volumeOf(lowerOnly, WALL_COLOR)));
  const upperOnly = buildSceneMesh(doc, new Set([doc.floors[0]!.id]));
  check("hiding the ground storey leaves the upper alone",
    nearRel(volumeOf(upperOnly, WALL_COLOR), rectWallVol, 1e-3)
    && upperOnly.bounds !== null
    && near(upperOnly.bounds!.min[2], FLOOR_HEIGHT_DEFAULT - SLAB_DEFAULT_MM, 1e-3),
    JSON.stringify(upperOnly.bounds));
}

// ── a set-back storey: the roof below becomes its terrace plate ─────────────

{
  const doc = emptyDoc();
  const lower = rectFloor();
  // The upper storey encloses only the left 2000 mm of the footprint.
  const upper = emptyDoc().floors[0]!;
  const pts = [v(0, 0), v(2000, 0), v(2000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); upper.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    upper.walls.push({ id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 100, bulge: 0, openings: [] });
  }
  doc.floors = [lower, upper];
  const fs = floorSolids(doc, 1)!;
  check("a set-back storey derives a terrace plate", fs.terrace !== null);
  check("the plate carries the storey's own boundary as a hole",
    fs.terrace !== null && fs.terrace.holes.length === 1);
  const m = buildSceneMesh(doc);
  // Plate ring plus the storey's own slab tile the level: together they cover
  // the full lower boundary at slab thickness.
  const levelVol = volumeOf(m, SLAB_COLOR, FLOOR_HEIGHT_DEFAULT - SLAB_DEFAULT_MM);
  const expected = 4000 * 3000 * SLAB_DEFAULT_MM;
  check("plate and slab tile the storey's level", nearRel(levelVol, expected, 1e-3),
    `${levelVol} vs ${expected}`);
}

// ── a stair contributes a box of footprint x rise ───────────────────────────

{
  const f = rectFloor();
  f.stairs = [{
    id: newId("s"), kind: "steektrap", x: 2000, y: 400, rotation: 0,
    width: 900, going: 220, treads: 10, rise: 2800,
  }];
  const m = buildSceneMesh(emptyDocWith(f));
  const vol = volumeOf(m, STAIR_COLOR);
  const expected = 900 * (10 * 220) * 2800;
  check("a stair is a box of footprint x rise", nearRel(vol, expected), `${vol} vs ${expected}`);
  check("the stair leaves the walls alone", nearRel(volumeOf(m, WALL_COLOR), rectWallVol));
}

// ── empty and degenerate documents ──────────────────────────────────────────

{
  const m = buildSceneMesh(emptyDoc());
  check("an empty document yields an empty mesh",
    m.positions.length === 0 && m.edges.length === 0);
  check("an empty document has null bounds", m.bounds === null);
}

// ── the seed plan, end to end ───────────────────────────────────────────────

{
  const m = buildSceneMesh(seedDoc());
  check("the seed plan yields a mesh", m.positions.length > 0 && m.bounds !== null);
  let finite = true;
  for (const arr of [m.positions, m.normals, m.colors, m.edges]) {
    for (let i = 0; i < arr.length; i++) if (!isFinite(arr[i]!)) { finite = false; break; }
  }
  check("no NaN anywhere in the seed mesh", finite);
  check("seed wall volume is positive", volumeOf(m, WALL_COLOR) > 0);
}

console.log(failures === 0 ? "ALL MESH3D TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
