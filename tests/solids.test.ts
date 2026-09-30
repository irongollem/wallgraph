// Derived 3D solids: wall bodies with opening voids, room spaces, and the
// storey slab, built from the same resolved 2D geometry the exporters use.
import {
  emptyDoc, newId, floorHeight, wallHeight, FLOOR_HEIGHT_DEFAULT, openingHeight,
  Wall, Opening, Floor,
} from "../src/model/doc";
import { detectRooms } from "../src/core/rooms";
import { floorSolids, SLAB_DEFAULT_MM } from "../src/core/solids";
import { seedDoc } from "../src/seed";
import { v, dist, polygonArea, perp, add, scale, pointInPolygon } from "../src/geometry/vec";
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

// ── posts ───────────────────────────────────────────────────────────────────

{
  const f = rectFloor();
  f.walls[0]!.material = "glass";
  f.walls[0]!.postMm = 1200;
  f.walls[0]!.postWidthMm = 60;
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const framed = fs.walls.find(x => x.wallId === f.walls[0]!.id)!;
  check("a wall stating a profile derives post prisms", framed.posts.length > 0,
    String(framed.posts.length));
  check("posts run the wall's height",
    framed.posts.every(p => p.z0 === 0 && near(p.z1, FLOOR_HEIGHT_DEFAULT)));
  check("a wall without a profile has none",
    fs.walls.find(x => x.wallId === f.walls[1]!.id)!.posts.length === 0);
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

  upper.vides = [{ id: newId("v"), x: 1000, y: 1500, rotation: 0, width: 500, depth: 500 }];
  const withVide = floorSolids(doc, 1)!.terrace;
  check("a vide inside the upper footprint is not a nested terrace hole",
    withVide !== null && withVide.holes.length === 1, String(withVide?.holes.length));
}

// ── stairwells ──────────────────────────────────────────────────────────────

{
  const stair = (): NonNullable<Floor["stairs"]>[number] => ({
    id: newId("s"), kind: "steektrap", x: 2000, y: 400, rotation: 0,
    width: 900, going: 220, treads: 10, rise: 2800,
  });

  const doc = emptyDoc();
  const lower = rectFloor();
  lower.stairs = [stair()];
  doc.floors = [lower, rectFloor()];
  const fs = floorSolids(doc, 1)!;
  check("a through flight cuts a stairwell in the slab above",
    fs.slab !== null && fs.slab.holes.length === 1, String(fs.slab?.holes.length));
  if (fs.slab?.holes[0]) {
    // Steps within headroom of the soffit are 1..9 (step 0 tops out at 2800/11
    // <= 300): local y 220..2200 over the 900 width.
    check("the well spans the headroom-critical steps",
      near(Math.abs(polygonArea(fs.slab.holes[0])), 900 * 1980, 1),
      String(polygonArea(fs.slab.holes[0])));
  }

  const doc2 = emptyDoc();
  const mezz = rectFloor();
  mezz.stairs = [{ ...stair(), rise: 1300 }];
  doc2.floors = [mezz, rectFloor()];
  check("a flight that stays under the slab cuts nothing",
    floorSolids(doc2, 1)!.slab!.holes.length === 0);

  const doc3 = emptyDoc();
  const lower3 = rectFloor();
  lower3.stairs = [stair()];
  const upper3 = rectFloor();
  upper3.vides = [{ id: newId("v"), x: 2000, y: 1400, rotation: 0, width: 1500, depth: 2400 }];
  doc3.floors = [lower3, upper3];
  check("an authored vide over the flight is the trapgat",
    floorSolids(doc3, 1)!.slab!.holes.length === 1);

  const doc4 = emptyDoc();
  const lower4 = rectFloor();
  lower4.stairs = [stair()];
  const upper4 = rectFloor();
  // Covers only the entry end of the derived well. The rest of the well must
  // remain open rather than being discarded because the two holes overlap.
  upper4.vides = [{ id: newId("v"), x: 2000, y: 650, rotation: 0, width: 500, depth: 500 }];
  doc4.floors = [lower4, upper4];
  const partial = floorSolids(doc4, 1)!.slab!.holes;
  check("a partial vide and stairwell become one triangulatable hole", partial.length === 1,
    String(partial.length));
  check("the merged hole keeps the authored and uncovered stairwell areas",
    !!partial[0] && pointInPolygon(v(2000, 500), partial[0]) && pointInPolygon(v(1600, 2000), partial[0]));
}

// ── sloped tops (profile, issue #55) ────────────────────────────────────────

{
  // A gable: one wall of a closed rectangle carries a ridge at its midpoint.
  const f = rectFloor();
  const gable = f.walls[0]!; // a->b along the 4000 mm edge, x 0..4000
  const base = wallHeight(f, gable);
  gable.profile = [{ t: 2000, height: base + 1000 }];
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const ws = fs.walls.find(w => w.wallId === gable.id)!;
  check("a profiled wall's pieces carry a top array", ws.body.every(p => p.top !== undefined),
    JSON.stringify(ws.body.map(p => p.top)));
  const peakVerts = ws.body.flatMap(p => p.poly.map((pt, i) => ({ x: pt.x, h: p.top![i]! })))
    .filter(pv => near(pv.x, 2000, 1));
  check("the piece is split at the ridge: at least two vertices sit at x=2000",
    peakVerts.length >= 2, String(peakVerts.length));
  check("the vertices at the ridge meet the peak height",
    peakVerts.every(pv => near(pv.h, base + 1000, 1)), JSON.stringify(peakVerts));
  check("no vertex of the gable wall rises above the ridge",
    ws.body.every(p => p.top!.every(h => h <= base + 1000 + 1)),
    JSON.stringify(ws.body.map(p => p.top)));

  const flatWall = f.walls[1]!;
  const flatWs = fs.walls.find(w => w.wallId === flatWall.id)!;
  check("a wall stating no profile carries no top field",
    flatWs.body.every(p => p.top === undefined));
  check("...and stays flat at wallHeight() -- unchanged from before the profile",
    flatWs.body.every(p => near(p.z1, wallHeight(f, flatWall), 1)) && flatWs.body.length === 1);
}

{
  // A valley: both ends high (stated), a low point at the midpoint (the
  // plain wallHeight()) -- so the wall's own top dips in the middle rather
  // than peaking, the opposite of a gable.
  const f = rectFloor();
  const w = f.walls[0]!;
  const L = 4000;
  const base = wallHeight(f, w);
  w.profile = [{ t: 0, height: base + 1000 }, { t: L / 2, height: base }, { t: L, height: base + 1000 }];
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const ws = fs.walls.find(x => x.wallId === w.id)!;
  const midVerts = ws.body.flatMap(p => p.poly.map((pt, i) => ({ x: pt.x, h: p.top![i]! })))
    .filter(pv => near(pv.x, L / 2, 1));
  check("a valley wall is split at its low point", midVerts.length >= 2, String(midVerts.length));
  check("its middle vertices sit at the low height, not the eaves either side",
    midVerts.every(pv => near(pv.h, base, 1)), JSON.stringify(midVerts));
}

{
  // A gable's LOW end meets two taller flat walls at a T: the junction takes
  // that low end height (wallHeight(), the implied end the profile does not
  // restate), not the gable's own peak and not simply the shortest wall's
  // flat height() -- both flat neighbours here are taller than the gable's
  // low end, so it alone decides.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const nodeAt = (p: { x: number; y: number }): string => {
    const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id;
  };
  const nLeft = nodeAt(v(0, 0)), nCenter = nodeAt(v(4000, 0));
  const nRight = nodeAt(v(8000, 0)), nDown = nodeAt(v(4000, 3000));
  const gable: Wall = { id: newId("w"), a: nLeft, b: nCenter, thickness: 100, bulge: 0, openings: [] };
  const gableLowEnd = wallHeight(f, gable); // FLOOR_HEIGHT_DEFAULT, since gable states no own height
  gable.profile = [{ t: 0, height: gableLowEnd + 1000 }]; // peak at "left", far from "center"
  const rightWall: Wall = {
    id: newId("w"), a: nCenter, b: nRight, thickness: 100, bulge: 0, openings: [], height: gableLowEnd + 200,
  };
  const downWall: Wall = {
    id: newId("w"), a: nCenter, b: nDown, thickness: 100, bulge: 0, openings: [], height: gableLowEnd + 400,
  };
  f.walls.push(gable, rightWall, downWall);
  const fs = floorSolids(doc, 0)!;
  check("a T-junction is derived where the three walls meet", fs.junctions.length === 1,
    String(fs.junctions.length));
  const j = fs.junctions[0]!;
  check("junction height is the gable's own low end, not its peak or either flat neighbour",
    near(j.z1, gableLowEnd, 1), `${j.z1} vs low end ${gableLowEnd}, peak ${gableLowEnd + 1000}`);
}

{
  // A window under the ridge: the wall above its head follows the profile up
  // to the peak rather than stopping flat at the pieces either side.
  const f = rectFloor();
  const gable = f.walls[0]!;
  const base = wallHeight(f, gable);
  gable.profile = [{ t: 2000, height: base + 1000 }];
  gable.openings.push(opening({ kind: "window", t: 2000, width: 1000, sillHeight: 900, height: 1200 }));
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const vd = fs.walls.find(w => w.wallId === gable.id)!.voids[0]!;
  const above = vd.above ?? [];
  const peak = Math.max(...above.flatMap(p => p.top ?? []));
  const atJambs = above.flatMap(p => p.poly.map((pt, i) => ({ x: pt.x, h: p.top![i]! })))
    .filter(pv => near(pv.x, 1500, 1) || near(pv.x, 2500, 1));
  check("the wall above a window under the ridge reaches the peak", near(peak, base + 1000), String(peak));
  check("and meets the profile at the jambs", atJambs.length > 0 && atJambs.every(pv => near(pv.h, base + 750)),
    JSON.stringify(atJambs));
  check("and starts at the head", above.length > 0 && above.every(p => p.z0 === vd.z1));
  const flat = rectFloor();
  flat.walls[0]!.openings.push(opening({ kind: "window", t: 2000, width: 1000, sillHeight: 900, height: 1200 }));
  const flatVoid = floorSolids(emptyDocWith(flat), 0)!.walls.find(w => w.wallId === flat.walls[0]!.id)!.voids[0]!;
  check("a flat wall's void carries no band of its own", flatVoid.above === undefined);
}

// ── build-ups: boards and the voorzetwand frame zone (issue #73) ───────────

/** Perpendicular distance from `p` to the infinite line through A-B, mm. */
function perpDist(p: { x: number; y: number }, A: { x: number; y: number }, B: { x: number; y: number }): number {
  const abx = B.x - A.x, aby = B.y - A.y;
  const apx = p.x - A.x, apy = p.y - A.y;
  const len = Math.hypot(abx, aby) || 1;
  return Math.abs(abx * apy - aby * apx) / len;
}

{
  // A two-board stack on the right face of a 100mm wall, no opening and no
  // frame: one piece per board (the wall's whole length), each at its own
  // cumulative offset from the centerline -- half (50) for the structural
  // face, then +12 for the gypsum's own outer edge, then +15 more for the
  // osb's, regardless of the plain neighbour it corners into (see
  // surface.test.ts's case 1 caveat -- the board band's own offset still
  // solves a real corner at that depth).
  const f = rectFloor();
  const w = f.walls[0]!; // (0,0) -> (4000,0)
  const A = v(0, 0), B = v(4000, 0);
  w.buildUp = { right: { boards: [{ kind: "gypsum", mm: 12 }, { kind: "osb", mm: 15 }] } };
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const solid = fs.walls.find(x => x.wallId === w.id)!;
  const boards = solid.buildUp.filter(p => p.part === "boards");

  check("a two-board stack yields one prism per board per piece",
    boards.length === 2, String(boards.length));
  check("all boards prisms are tagged with their side",
    boards.every(p => p.side === "right"));
  check("boards keep their own kind, innermost first",
    boards[0]?.kind === "gypsum" && boards[1]?.kind === "osb",
    JSON.stringify(boards.map(p => p.kind)));

  const gypsum = boards[0]!, osb = boards[1]!;
  const distsOf = (p: typeof gypsum) => p.poly.map(pt => perpDist(pt, A, B));
  check("the gypsum board runs from the structural face (50) to 62",
    distsOf(gypsum).every(d => near(d, 50, 0.5) || near(d, 62, 0.5)), JSON.stringify(distsOf(gypsum)));
  check("the osb board runs from 62 to 77, stacked outward on the gypsum",
    distsOf(osb).every(d => near(d, 62, 0.5) || near(d, 77, 0.5)), JSON.stringify(distsOf(osb)));
  check("the left face, stating no build-up, contributes nothing",
    solid.buildUp.every(p => p.side !== "left"));
}

{
  // A door in the wall's own body cuts every band it carries -- structural
  // pieces, a voorzetwand's own frame zone, and the board stacked on it.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.openings.push(opening({ kind: "door", t: 1000, width: 830 }));
  w.buildUp = {
    right: {
      frame: { gapMm: 20, depthMm: 50, material: "timber" },
      boards: [{ kind: "gypsum", mm: 12 }],
    },
  };
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const solid = fs.walls.find(x => x.wallId === w.id)!;
  const frame = solid.buildUp.filter(p => p.part === "frame");
  const boards = solid.buildUp.filter(p => p.part === "boards");

  const fullHeight = (ps: typeof frame) => ps.filter(p => p.z0 === 0 && near(p.z1, FLOOR_HEIGHT_DEFAULT));
  check("the door leaves the structural body in two pieces",
    solid.body.length === 2, String(solid.body.length));
  check("the door also cuts the frame zone in two",
    fullHeight(frame).length === 2, String(fullHeight(frame).length));
  check("...and the board stacked on it",
    fullHeight(boards).length === 2, String(fullHeight(boards).length));
  const head = openingHeight(w.openings[0]!);
  check("the frame zone and the board continue above the door's head",
    frame.filter(p => near(p.z0, head)).length === 1 && boards.filter(p => near(p.z0, head)).length === 1,
    JSON.stringify(solid.buildUp.map(p => [p.part, p.z0, p.z1])));
  check("nothing is built below a door's sill at the floor",
    solid.buildUp.every(p => p.z0 > 0 || near(p.z1, FLOOR_HEIGHT_DEFAULT)));
}

{
  // A window: the voorzetwand runs below its sill and above its head, over
  // the window's own span and at the band's own depth.
  const f = rectFloor();
  const w = f.walls[0]!; // (0,0) -> (4000,0), right face at y < 0
  w.openings.push(opening({ kind: "window", t: 2000, width: 1200, sillHeight: 900, height: 1200 }));
  w.buildUp = {
    right: {
      frame: { gapMm: 20, depthMm: 50, material: "timber" },
      boards: [{ kind: "gypsum", mm: 12 }],
    },
  };
  const solid = floorSolids(emptyDocWith(f), 0)!.walls.find(x => x.wallId === w.id)!;
  const sill = solid.buildUp.filter(p => p.z0 === 0 && near(p.z1, 900));
  const over = solid.buildUp.filter(p => near(p.z0, 2100) && near(p.z1, FLOOR_HEIGHT_DEFAULT));
  check("below the sill: one frame prism and one board prism",
    sill.length === 2 && sill.some(p => p.part === "frame") && sill.some(p => p.part === "boards" && p.kind === "gypsum"),
    JSON.stringify(solid.buildUp.map(p => [p.part, p.z0, p.z1])));
  check("above the head: one frame prism and one board prism",
    over.length === 2 && over.some(p => p.part === "frame") && over.some(p => p.part === "boards"));
  const xs = [...sill, ...over].flatMap(p => p.poly.map(q => q.x));
  check("the sill and head bands span the window's jambs",
    xs.every(x => near(x, 1400, 0.5) || near(x, 2600, 0.5)), JSON.stringify(xs));
  const frameYs = sill.find(p => p.part === "frame")!.poly.map(q => q.y);
  check("the frame band below the sill stands 20..70 off the right face",
    frameYs.every(y => near(y, -70, 0.5) || near(y, -120, 0.5)), JSON.stringify(frameYs));
  const boardYs = sill.find(p => p.part === "boards")!.poly.map(q => q.y);
  check("the board below the sill is stacked on the front of the frame",
    boardYs.every(y => near(y, -120, 0.5) || near(y, -132, 0.5)), JSON.stringify(boardYs));
}

{
  // A capped voorzetwand stops at its own height over a window too: below a
  // head that is higher than the cap nothing is added above it, and a run
  // that stops short of the window leaves its span bare.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.openings.push(opening({ kind: "window", t: 2000, width: 1200, sillHeight: 900, height: 1200 }));
  w.buildUp = { right: { frame: { gapMm: 20, depthMm: 50, material: "timber", heightMm: 1800 }, boards: [] } };
  const capped = floorSolids(emptyDocWith(f), 0)!.walls.find(x => x.wallId === w.id)!;
  check("a cap below the head adds nothing above the head",
    capped.buildUp.every(p => p.z1 <= 1800 + 0.5), JSON.stringify(capped.buildUp.map(p => [p.z0, p.z1])));
  check("...and still fills below the sill",
    capped.buildUp.some(p => p.z0 === 0 && near(p.z1, 900)));

  w.buildUp = { right: { frame: { gapMm: 20, depthMm: 50, material: "timber" }, boards: [], runs: [{ fromMm: 0, toMm: 1000 }] } };
  const partial = floorSolids(emptyDocWith(f), 0)!.walls.find(x => x.wallId === w.id)!;
  check("a run that stops before the window adds nothing over its span",
    partial.buildUp.every(p => p.poly.every(q => q.x <= 1000 + 0.5)),
    JSON.stringify(partial.buildUp.map(p => p.poly.map(q => q.x))));
}

{
  // A voorzetwand's own heightMm caps its zone and the board it carries,
  // while the wall's own structural body (which knows nothing of a frame it
  // carries) keeps the full storey height.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.buildUp = {
    right: {
      frame: { gapMm: 20, depthMm: 50, material: "timber", heightMm: 2000 },
      boards: [{ kind: "gypsum", mm: 12 }],
    },
  };
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const solid = fs.walls.find(x => x.wallId === w.id)!;

  check("every build-up prism is capped at the frame's own heightMm",
    solid.buildUp.length > 0 && solid.buildUp.every(p => near(p.z1, 2000, 1)),
    JSON.stringify(solid.buildUp.map(p => p.z1)));
  check("the structural body stays at the full storey height, uncapped",
    solid.body.every(p => near(p.z1, FLOOR_HEIGHT_DEFAULT, 1)),
    JSON.stringify(solid.body.map(p => p.z1)));
}

{
  // A gable's build-up follows the same profile its host wall does: the
  // board carries a top array and no vertex rises past the ridge.
  const f = rectFloor();
  const gable = f.walls[0]!;
  const base = wallHeight(f, gable);
  gable.profile = [{ t: 2000, height: base + 1000 }];
  gable.buildUp = { right: { boards: [{ kind: "gypsum", mm: 12 }] } };
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const solid = fs.walls.find(x => x.wallId === gable.id)!;
  const boards = solid.buildUp.filter(p => p.part === "boards");

  check("a profiled wall's build-up prisms carry a top array",
    boards.length > 0 && boards.every(p => p.top !== undefined),
    JSON.stringify(boards.map(p => p.top)));
  check("no vertex of the board rises above the ridge",
    boards.every(p => p.top!.every(h => h <= base + 1000 + 1)),
    JSON.stringify(boards.map(p => p.top)));
  const peakVerts = boards.flatMap(p => p.poly.map((pt, i) => ({ x: pt.x, h: p.top![i]! })))
    .filter(pv => near(pv.x, 2000, 1));
  check("the board is split at the ridge, meeting the peak height",
    peakVerts.length >= 2 && peakVerts.every(pv => near(pv.h, base + 1000, 1)),
    JSON.stringify(peakVerts));
}

// ── facade skin ─────────────────────────────────────────────────────────────

{
  const f = rectFloor();
  const w = f.walls[0]!; // runs +x along y = 0; "right" is -y
  w.facadeMm = 100; w.facadeSide = "right";
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const ws = fs.walls.find(x => x.wallId === w.id)!;
  const ys = ws.facade.flatMap(p => p.poly.map(pt => pt.y));
  check("a facade wall yields facade prisms", ws.facade.length > 0);
  check("the facade stands at half..half+100 on its side",
    near(Math.min(...ys), -150, 0.5) && near(Math.max(...ys), -50, 0.5), `${Math.min(...ys)}..${Math.max(...ys)}`);
  check("a flat wall's facade is flat at wallHeight()",
    ws.facade.every(p => p.top === undefined && p.z0 === 0 && near(p.z1, wallHeight(f, w), 0.5)));
  const other = fs.walls.find(x => x.wallId === f.walls[1]!.id)!;
  check("a wall stating no facade has none", other.facade.length === 0);
}

{
  const f = rectFloor();
  const w = f.walls[0]!;
  w.facadeMm = 100; w.facadeSide = "right";
  w.openings.push(opening({ kind: "window", t: 2000, width: 1000, sillHeight: 900, height: 1200 }));
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const ws = fs.walls.find(x => x.wallId === w.id)!;
  const over = ws.facade.filter(p => p.poly.every(pt => pt.x >= 1500 - 0.5 && pt.x <= 2500 + 0.5));
  check("a window adds a facade band under its sill",
    over.some(p => p.z0 === 0 && near(p.z1, 900, 0.5)), JSON.stringify(over.map(p => [p.z0, p.z1])));
  check("...and one over its head",
    over.some(p => near(p.z0, 2100, 0.5) && near(p.z1, wallHeight(f, w), 0.5)));
  check("...none across the glazing",
    over.every(p => p.z1 <= 900.5 || p.z0 >= 2099.5));
}

{
  const f = rectFloor();
  const w = f.walls[0]!;
  w.facadeMm = 100; w.facadeSide = "right";
  const base = wallHeight(f, w);
  w.profile = [{ t: 2000, height: base + 1000 }];
  const fs = floorSolids(emptyDocWith(f), 0)!;
  const ws = fs.walls.find(x => x.wallId === w.id)!;
  check("a profiled wall's facade carries per-vertex tops",
    ws.facade.length >= 2 && ws.facade.every(p => p.top !== undefined && p.top.length === p.poly.length));
  const peak = ws.facade.flatMap(p => p.poly.map((pt, i) => ({ x: pt.x, h: p.top![i]! }))).filter(pv => near(pv.x, 2000, 1));
  check("the facade meets the ridge height", peak.length >= 2 && peak.every(pv => near(pv.h, base + 1000, 1)));
}

console.log(failures === 0 ? "ALL SOLIDS TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
