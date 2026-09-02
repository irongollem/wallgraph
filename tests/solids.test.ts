// Derived 3D solids: wall bodies with opening voids, room spaces, and the
// storey slab, built from the same resolved 2D geometry the exporters use.
import {
  emptyDoc, newId, floorHeight, wallHeight, FLOOR_HEIGHT_DEFAULT,
  Wall, Opening, Floor,
} from "../src/model/doc";
import { detectRooms } from "../src/core/rooms";
import { floorSolids, SLAB_DEFAULT_MM } from "../src/core/solids";
import { seedDoc } from "../src/seed";
import { v, dist, polygonArea, perp, add, scale } from "../src/geometry/vec";
import { arcPointAt, arcTangentAt, arcLength, bulgeFromSagitta } from "../src/geometry/arc";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

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

function isFiniteVec(p: { x: number; y: number }): boolean { return isFinite(p.x) && isFinite(p.y); }
function allFinite(fs: ReturnType<typeof floorSolids>): boolean {
  if (!fs) return true;
  for (const w of fs.walls) {
    for (const b of w.body) { if (!isFinite(b.z0) || !isFinite(b.z1) || !b.poly.every(isFiniteVec)) return false; }
    for (const o of w.voids) { if (!isFinite(o.z0) || !isFinite(o.z1) || !o.poly.every(isFiniteVec)) return false; }
  }
  for (const s of fs.spaces) { if (!isFinite(s.z1) || !s.poly.every(isFiniteVec)) return false; }
  if (fs.slab) {
    if (!fs.slab.outline.every(isFiniteVec)) return false;
    for (const h of fs.slab.holes) if (!h.every(isFiniteVec)) return false;
  }
  return true;
}

// ── walls: bodies and default heights ──────────────────────────────────────

{
  const f = rectFloor();
  const fs = floorSolids({ ...emptyDocWith(f) }, 0);
  check("solids resolve for a closed rectangle", fs !== null);
  if (fs) {
    check("one WallSolid per wall", fs.walls.length === 4, String(fs.walls.length));
    for (const w of fs.walls) {
      check("wall body has at least one prism", w.body.length >= 1);
      for (const p of w.body) {
        check("prism floor is 0", p.z0 === 0);
        check("prism top is the storey height", near(p.z1, FLOOR_HEIGHT_DEFAULT), String(p.z1));
      }
    }
    check("no NaN anywhere", allFinite(fs));
  }
}

// ── wall height override ────────────────────────────────────────────────────

{
  const f = rectFloor();
  f.walls[0]!.height = 2400;
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const overridden = fs.walls.find(w => w.wallId === f.walls[0]!.id)!;
  const ordinary = fs.walls.find(w => w.wallId === f.walls[1]!.id)!;
  check("an overridden wall uses its own height",
    overridden.body.every(p => near(p.z1, 2400)), JSON.stringify(overridden.body.map(p => p.z1)));
  check("a plain wall still uses the storey height",
    ordinary.body.every(p => near(p.z1, FLOOR_HEIGHT_DEFAULT)));
}

// ── opening voids ────────────────────────────────────────────────────────────

{
  const f = rectFloor();
  const doorWall = f.walls[0]!;   // 0,0 -> 4000,0
  const winWall = f.walls[2]!;    // 4000,3000 -> 0,3000
  doorWall.openings.push(opening({ kind: "door", t: 1000, width: 830 }));
  winWall.openings.push(opening({ kind: "window", t: 1000, width: 1200 }));
  const fs = floorSolids(emptyDocWith(f), 0)!;

  const doorSolid = fs.walls.find(w => w.wallId === doorWall.id)!;
  const doorVoid = doorSolid.voids[0]!;
  check("a door void starts at the floor", near(doorVoid.z0, 0), String(doorVoid.z0));
  check("a door void reaches the default door head", near(doorVoid.z1, 2315), String(doorVoid.z1));
  check("the door void is a quad", doorVoid.poly.length === 4);
  check("the door void carries its opening id", doorVoid.openingId === doorWall.openings[0]!.id);
  check("the door void carries its kind", doorVoid.kind === "door");

  const winSolid = fs.walls.find(w => w.wallId === winWall.id)!;
  const winVoid = winSolid.voids[0]!;
  check("a window void starts at the standard sill", near(winVoid.z0, 900), String(winVoid.z0));
  check("a window void spans sill to sill+height", near(winVoid.z1, 900 + 1415), String(winVoid.z1));
}

// ── clamping to the wall height ─────────────────────────────────────────────

{
  const f = rectFloor();
  const w = f.walls[0]!;
  // Sill 900 + a tall pane would reach 900+3000=3900, past the 2800 storey.
  w.openings.push(opening({ kind: "window", t: 1000, width: 1200, sillHeight: 900, height: 3000 }));
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const solid = fs.walls.find(ws => ws.wallId === w.id)!;
  const voidZ = solid.voids[0]!;
  check("a void that would exceed the wall clamps to it",
    near(voidZ.z1, wallHeight(f, w)), String(voidZ.z1));
  check("the clamped void keeps its sill", near(voidZ.z0, 900));
}

// ── bulged wall placement ───────────────────────────────────────────────────

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const a = { id: newId("n"), x: 0, y: 0 };
  const b = { id: newId("n"), x: 4000, y: 0 };
  f.nodes.push(a, b);
  const A = v(a.x, a.y), B = v(b.x, b.y);
  const bulge = bulgeFromSagitta(A, B, 400);
  const half = 100;
  const wall: Wall = { id: newId("w"), a: a.id, b: b.id, thickness: half * 2, bulge, openings: [] };
  wall.openings.push(opening({ kind: "passage", t: 2000, width: 900 }));
  f.walls.push(wall);
  const fs = floorSolids(doc, 0)!;
  const voidPoly = fs.walls[0]!.voids[0]!.poly;

  // Expected footprint: the same arc-placed jambs the opening marks use, per
  // resolve.ts's OpeningGeom — offset by half the wall thickness at each end.
  const L = arcLength(A, B, bulge);
  const t0 = (2000 - 450) / L, t1 = (2000 + 450) / L;
  const p0 = arcPointAt(A, B, bulge, t0), p1 = arcPointAt(A, B, bulge, t1);
  const n0 = perp(arcTangentAt(A, B, bulge, t0)), n1 = perp(arcTangentAt(A, B, bulge, t1));
  const expected = [add(p0, scale(n0, half)), add(p1, scale(n1, half)),
                     add(p1, scale(n1, -half)), add(p0, scale(n0, -half))];

  check("bulged void is a quad", voidPoly.length === 4);
  check("a void on a bulged wall sits on the arc, not the straight chord",
    voidPoly.every((p, i) => dist(p, expected[i]!) < 1), JSON.stringify({ voidPoly, expected }));
  check("the arc jambs are actually off the chord",
    dist(p0, v(1550, 0)) > 50, JSON.stringify(p0));
}

// ── spaces ───────────────────────────────────────────────────────────────

{
  const f = rectFloor();
  f.roomNames = [{ id: newId("r"), x: 2000, y: 1500, name: "Woonkamer" }];
  const rooms = detectRooms(f);
  const fs = floorSolids(emptyDocWith(f), 0)!;
  check("one space per detected room", fs.spaces.length === rooms.length, String(fs.spaces.length));
  check("spaces reach the storey height", fs.spaces.every(s => near(s.z1, floorHeight(f))));
  check("spaces start at the floor", fs.spaces.every(s => s.z0 === 0));
  check("the attached room name comes through", fs.spaces.some(s => s.name === "Woonkamer"),
    JSON.stringify(fs.spaces.map(s => s.name)));
}

// ── slab ─────────────────────────────────────────────────────────────────

{
  const f = rectFloor();
  const fs = floorSolids(emptyDocWith(f), 0)!;
  check("a closed rectangle gets a slab", fs.slab !== null);
  if (fs.slab) {
    check("the slab sits below the floor", fs.slab.z0 === -SLAB_DEFAULT_MM && fs.slab.z1 === 0);
    const outlineArea = Math.abs(polygonArea(fs.slab.outline));
    const roomsArea = fs.spaces.reduce((acc, s) => acc + Math.abs(polygonArea(s.poly)), 0);
    check("the slab outline encloses at least the net room area",
      outlineArea >= roomsArea, `${outlineArea} vs ${roomsArea}`);
    check("no holes without a vide", fs.slab.holes.length === 0);
  }
}

{
  const f = rectFloor();
  f.vides = [{ id: newId("v"), x: 2000, y: 1500, rotation: 0, width: 1200, depth: 800 }];
  const fs = floorSolids(emptyDocWith(f), 0)!;
  check("a vide becomes exactly one hole", fs.slab !== null && fs.slab.holes.length === 1);
  if (fs.slab) check("the hole is a quad", fs.slab.holes[0]!.length === 4,
    JSON.stringify(fs.slab.holes[0]));
}

// ── an open wall chain has no slab ──────────────────────────────────────────

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(4000, 0), v(4000, 3000)]; // three points, two walls, not closed
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i + 1 < ids.length; i++) {
    f.walls.push({ id: newId("w"), a: ids[i]!, b: ids[i + 1]!, thickness: 100, bulge: 0, openings: [] });
  }
  const fs = floorSolids(doc, 0)!;
  check("an open chain still produces wall solids", fs.walls.length === 2, String(fs.walls.length));
  check("an open chain has no slab", fs.slab === null);
}

// ── edges ────────────────────────────────────────────────────────────────

{
  check("an empty document has no solids", floorSolids(emptyDoc(), 0) === null);
  const doc = emptyDoc();
  check("an out-of-range floor index returns null", floorSolids(doc, 3) === null);
}

// ── the seed plan, end to end ───────────────────────────────────────────────

{
  const doc = seedDoc();
  const fs = floorSolids(doc, 0);
  check("the seed plan resolves", fs !== null);
  if (fs) {
    check("the seed plan has walls", fs.walls.length > 0);
    check("the seed plan has spaces", fs.spaces.length > 0);
    check("no NaN anywhere in the seed plan", allFinite(fs));
  }
}

function emptyDocWith(f: Floor): ReturnType<typeof emptyDoc> {
  const doc = emptyDoc();
  doc.floors = [f];
  return doc;
}

// ── junction fillers ────────────────────────────────────────────────────────

{
  const f = rectFloor();
  const fs = floorSolids(emptyDocWith(f), 0)!;
  check("degree-2 corners derive no junction fillers", fs.junctions.length === 0,
    String(fs.junctions.length));
}

{
  // A thick interior wall meeting the thin ring mid-edge: two degree-3 nodes.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(2000, 0), v(4000, 0), v(4000, 3000), v(2000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  const wall = (a: number, b: number, thickness = 100): Wall => {
    const w: Wall = { id: newId("w"), a: ids[a]!, b: ids[b]!, thickness, bulge: 0, openings: [] };
    f.walls.push(w);
    return w;
  };
  wall(0, 1); wall(1, 2); wall(2, 3); wall(3, 4); wall(4, 5); wall(5, 0);
  const branch = wall(1, 4, 300);
  branch.height = 2400;
  const fs = floorSolids(doc, 0)!;
  check("degree-3 nodes derive junction fillers", fs.junctions.length >= 1,
    String(fs.junctions.length));
  check("a filler is as tall as the shortest wall at the node",
    fs.junctions.every(j => near(j.z1, 2400)),
    JSON.stringify(fs.junctions.map(j => j.z1)));
  check("filler polygons are finite and closed",
    fs.junctions.every(j => j.poly.length >= 3 && j.poly.every(isFiniteVec) && j.z0 === 0));
}

// ── terrace plates ──────────────────────────────────────────────────────────

{
  const doc = emptyDoc();
  doc.floors = [rectFloor(), rectFloor()];
  check("the ground floor derives no terrace", floorSolids(doc, 0)!.terrace === null);
  check("a stacked identical storey derives no terrace", floorSolids(doc, 1)!.terrace === null);
}

{
  const doc = emptyDoc();
  const lower = rectFloor();
  const upper = emptyDoc().floors[0]!;
  const pts = [v(0, 0), v(2000, 0), v(2000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); upper.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    upper.walls.push({ id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 100, bulge: 0, openings: [] });
  }
  doc.floors = [lower, upper];
  const fs = floorSolids(doc, 1)!;
  check("a set-back storey derives a terrace plate over the storey below", fs.terrace !== null);
  if (fs.terrace) {
    check("the plate spans the lower storey's boundary",
      near(Math.abs(polygonArea(fs.terrace.outline)), 4000 * 3000, 1),
      String(polygonArea(fs.terrace.outline)));
    check("the storey's own boundary is carried as a hole", fs.terrace.holes.length === 1);
    check("the plate shares the slab's band",
      fs.terrace.z0 === -SLAB_DEFAULT_MM && fs.terrace.z1 === 0);
  }
}

console.log(failures === 0 ? "ALL SOLIDS TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
