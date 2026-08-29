// Engine sanity tests, run with tsx.
import { emptyDoc, newId, Wall, GRID_DEFAULT_MM } from "../src/model/doc";
import { detectRooms } from "../src/core/rooms";
import { resolveFloor } from "../src/core/resolve";
import { arcInfo, arcLength, arcPointAt, arcTangentAt, arcFlatten, bulgeFromSagitta } from "../src/geometry/arc";
import { v, dist } from "../src/geometry/vec";
import { gridSteps, MIN_GRID_PX } from "../src/render/grid";
import { planBounds, scaleBarMm } from "../src/io/image";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

// --- arcs ---
{
  // Semi-circle: chord 2000mm, bulge=1 -> radius 1000, length pi*1000
  const a = v(0, 0), b = v(2000, 0);
  const info = arcInfo(a, b, 1)!;
  check("arc radius", near(info.radius, 1000, 0.01), String(info.radius));
  check("arc length", near(arcLength(a, b, 1), Math.PI * 1000, 0.1));
  const midP = arcPointAt(a, b, 1, 0.5);
  check("arc apex", near(dist(midP, v(1000, 1000)), 0, 0.5), JSON.stringify(midP)); // perp(a->b)=(0,1) y-down
  const t0 = arcTangentAt(a, b, 1, 0);
  check("arc tangent at start", near(t0.x, 0, 0.01) && near(t0.y, 1, 0.01), JSON.stringify(t0));
  const flat = arcFlatten(a, b, 1, 2);
  check("arc flatten endpoints", dist(flat[0]!, a) < 0.01 && dist(flat[flat.length - 1]!, b) < 0.01);
  check("bulge from sagitta roundtrip", near(bulgeFromSagitta(a, b, 1000), 1, 1e-9));
}

// --- room detection: single 4000x3000 room ---
function rectFloor(wallTh = 100) {
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
{
  const f = rectFloor();
  const rooms = detectRooms(f);
  check("one room detected", rooms.length === 1, String(rooms.length));
  if (rooms.length === 1) {
    check("room area 12 m^2", near(rooms[0]!.areaMm2, 12_000_000, 1000), String(rooms[0]!.areaMm2));
    check("room centroid", near(rooms[0]!.centroid.x, 2000, 5) && near(rooms[0]!.centroid.y, 1500, 5));
  }
}

// --- two rooms via a dividing wall ---
{
  const f = rectFloor();
  const n1 = { id: newId("n"), x: 2000, y: 0 };
  const n2 = { id: newId("n"), x: 2000, y: 3000 };
  // But the top wall passes through (2000,0) without a node -> rooms.ts flattening
  // dedups by position only if a vertex exists there. Split top/bottom walls first:
  // simulate proper drawing: walls split at junctions. Add nodes and rewire.
  const top = f.walls[0]!, bottom = f.walls[2]!;
  f.nodes.push(n1, n2);
  const topB = top.b;
  top.b = n1.id;
  f.walls.push({ id: newId("w"), a: n1.id, b: topB, thickness: 100, bulge: 0, openings: [] });
  const botB = bottom.b;
  bottom.b = n2.id;
  f.walls.push({ id: newId("w"), a: n2.id, b: botB, thickness: 100, bulge: 0, openings: [] });
  f.walls.push({ id: newId("w"), a: n1.id, b: n2.id, thickness: 100, bulge: 0, openings: [] });
  const rooms = detectRooms(f);
  check("two rooms detected", rooms.length === 2, String(rooms.length));
  const areas = rooms.map(r => r.areaMm2).sort((x, y) => x - y);
  check("split areas 6+6 m^2", near(areas[0]!, 6_000_000, 1000) && near(areas[1]!, 6_000_000, 1000), JSON.stringify(areas));
}

// --- room with an arc wall ---
{
  const f = rectFloor();
  f.walls[1]!.bulge = -0.5; // negative = away from perp -> bows outward here
  const rooms = detectRooms(f);
  check("arc room detected", rooms.length === 1, String(rooms.length));
  if (rooms.length === 1) check("arc room area > rect", rooms[0]!.areaMm2 > 12_000_000, String(rooms[0]!.areaMm2));
}

// --- resolve: corners and opening pieces ---
{
  const f = rectFloor(200);
  const res = resolveFloor(f);
  check("resolved all walls", res.walls.size === 4);
  const rw = [...res.walls.values()][0]!;
  check("wall solid without openings is 1 piece", rw.pieces.length === 1);
  // Outer corner of an L-junction at (0,0) between left wall and top wall
  // should extend to (-100,-100) (outside corner of 200-thick walls).
  const allPts = rw.pieces[0]!.poly;
  const hasOuter = allPts.some(p => near(p.x, -100, 2) && near(p.y, -100, 2));
  check("miter outer corner at (-100,-100)", hasOuter, JSON.stringify(allPts.slice(0, 4)));

  // Add a door to the top wall -> 2 pieces.
  const top = f.walls[0]!;
  top.openings.push({ id: newId("o"), kind: "door", t: 2000, width: 900, hinge: "a", swingIn: true });
  const res2 = resolveFloor(f);
  check("door splits wall into 2 pieces", res2.walls.get(top.id)!.pieces.length === 2,
    String(res2.walls.get(top.id)!.pieces.length));
  const og = res2.walls.get(top.id)!.openings[0]!;
  check("door jambs 900 apart", near(dist(og.p0, og.p1), 900, 0.5), String(dist(og.p0, og.p1)));
}

// --- degree-3 junction (T) resolves without NaN ---
{
  const f = rectFloor();
  const nMid = { id: newId("n"), x: 2000, y: 0 };
  f.nodes.push(nMid);
  const top = f.walls[0]!;
  const topB = top.b; top.b = nMid.id;
  f.walls.push({ id: newId("w"), a: nMid.id, b: topB, thickness: 100, bulge: 0, openings: [] });
  f.walls.push({ id: newId("w"), a: nMid.id, b: (() => { const n = { id: newId("n"), x: 2000, y: 1500 }; f.nodes.push(n); return n.id; })(), thickness: 150, bulge: 0, openings: [] });
  const res = resolveFloor(f);
  let ok = true;
  for (const rw of res.walls.values())
    for (const pc of rw.pieces)
      for (const p of pc.poly)
        if (!isFinite(p.x) || !isFinite(p.y)) ok = false;
  check("T-junction geometry finite", ok);
}

// --- grid spacing ---
{
  // Drawn lines must always be whole multiples of the document grid, so a
  // square on screen is a whole number of cells (the 1 m hardcode bug).
  const zooms = [0.01, 0.03, 0.09, 0.12, 0.3, 1, 2];
  const grids = [10, 25, 50, 100, 120, 500];
  let multiples = true, readable = true, majorOnGrid = true;
  for (const g of grids) for (const z of zooms) {
    const st = gridSteps(g, z);
    if (st.minor % g !== 0 || st.major % st.minor !== 0) multiples = false;
    if (st.major % g !== 0) majorOnGrid = false;
    if (st.minor * z < MIN_GRID_PX) readable = false;
  }
  check("grid steps are multiples of gridMm", multiples);
  check("major lines land on the grid", majorOnGrid);
  check("grid steps stay readable at every zoom", readable);

  // The reported case: 50 mm grid at the default fit zoom used to draw 1 m
  // squares, so a 5005 mm wall looked ~5 cells wide.
  const fit = gridSteps(50, 0.09);
  check("50mm grid steps up, not to 1m", fit.minor === 100 && fit.stepped, JSON.stringify(fit));
  check("major stays at 1m for a 50mm grid", fit.major === 1000, String(fit.major));

  // The default grid is coarse enough to draw cell-for-cell at ordinary zoom,
  // so the common case never needs stepping up at all.
  check("default grid draws directly at fit zoom", !gridSteps(GRID_DEFAULT_MM, 0.09).stepped
    && gridSteps(GRID_DEFAULT_MM, 0.09).major === 1000, JSON.stringify(gridSteps(GRID_DEFAULT_MM, 0.09)));
  check("default grid matches emptyDoc", emptyDoc().gridMm === GRID_DEFAULT_MM);

  const zoomedIn = gridSteps(50, 0.5);
  check("fine grid drawn as-is when it fits", zoomedIn.minor === 50 && !zoomedIn.stepped);
  check("minor and major never coincide", gridSteps(50, 0.005).major > gridSteps(50, 0.005).minor);
  check("degenerate zoom falls back to gridMm", gridSteps(50, 0).minor === 50);
}

// --- PNG export framing ---
{
  const f = rectFloor(300);   // 4000 x 3000 centerlines, 300mm walls
  const res = resolveFloor(f);
  const b = planBounds(f, res)!;
  // Outer faces, not centerlines: a 300mm wall sticks 150mm past each corner,
  // so cropping to node bounds would slice the exterior walls in half.
  check("bounds cover wall outer faces",
    near(b.min.x, -150, 1) && near(b.min.y, -150, 1) && near(b.max.x, 4150, 1) && near(b.max.y, 3150, 1),
    JSON.stringify(b));

  // A symbol inside the shell must not inflate the frame — a too-generous
  // reach per symbol silently pads the exported image with empty paper.
  f.symbols.push({ id: newId("s"), type: "bath", x: 2000, y: 1500, rotation: 0 });
  const bIn = planBounds(f, res)!;
  check("interior symbol does not grow the frame",
    bIn.min.x === b.min.x && bIn.min.y === b.min.y && bIn.max.x === b.max.x && bIn.max.y === b.max.y,
    JSON.stringify(bIn));

  // One outside it has to pull the frame out with it.
  f.symbols.push({ id: newId("s"), type: "bath", x: 5000, y: 1500, rotation: 0 });
  const b2 = planBounds(f, res)!;
  check("bounds cover symbols outside the walls", b2.max.x > 5000, String(b2.max.x));

  check("empty floor has no bounds",
    planBounds({ id: "f", name: "", nodes: [], walls: [], symbols: [] }, { walls: new Map() }) === null);

  // The bar is a round metric length that stays inside a quarter of the image.
  for (const [pxPerMm, w] of [[0.12, 1200], [0.02, 1200], [0.5, 800]] as const) {
    const mm = scaleBarMm(pxPerMm, w);
    check(`scale bar ${mm}mm fits at ${pxPerMm}px/mm`, mm * pxPerMm <= w * 0.25, String(mm * pxPerMm));
    check(`scale bar ${mm}mm is a round length`, [100, 200, 500, 1000, 2000, 5000, 10000].includes(mm));
  }
}

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
