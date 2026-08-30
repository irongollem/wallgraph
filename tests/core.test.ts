// Engine sanity tests, run with tsx.
import { emptyDoc, newId, Wall, GRID_DEFAULT_MM } from "../src/model/doc";
import { Store } from "../src/model/store";
import { sashesOf, sashSpecsOf, doorKindOf, windowKindOf, DOOR_KINDS, WINDOW_KINDS, type Opening } from "../src/model/doc";
import { detectRooms } from "../src/core/rooms";
import { insertWall, insertRun, nodeAt, wallLength } from "../src/model/ops";
import { shapeRun } from "../src/model/shape";
import { dimensionChains } from "../src/core/dimensions";
import { seedDoc } from "../src/seed";
import { resolveFloor } from "../src/core/resolve";
import { arcInfo, arcLength, arcPointAt, arcTangentAt, arcFlatten, bulgeFromSagitta } from "../src/geometry/arc";
import { v, dist, pointInPolygon } from "../src/geometry/vec";
import { gridSteps, MIN_GRID_PX } from "../src/render/grid";
import { scaleBarMm } from "../src/io/image";
import { planBounds } from "../src/core/bounds";
import { symbolInk, COLORS, INKS } from "../src/render/draw";

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
  top.openings.push({ id: newId("o"), kind: "door", t: 2000, width: 900,
    sashes: [{ action: "turn", hinge: "a", outward: false }] });
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
    planBounds({ id: "f", name: "", nodes: [], walls: [], symbols: [] }, { walls: new Map(), junctions: [] }) === null);

  // The bar is a round metric length that stays inside a quarter of the image.
  for (const [pxPerMm, w] of [[0.12, 1200], [0.02, 1200], [0.5, 800]] as const) {
    const mm = scaleBarMm(pxPerMm, w);
    check(`scale bar ${mm}mm fits at ${pxPerMm}px/mm`, mm * pxPerMm <= w * 0.25, String(mm * pxPerMm));
    check(`scale bar ${mm}mm is a round length`, [100, 200, 500, 1000, 2000, 5000, 10000].includes(mm));
  }
}

// --- net (inner-face) room areas: the NEN 2580 number ---
{
  // A 4000 x 3000 centerline room: net is (4000-t) x (3000-t) exactly.
  for (const t of [100, 300]) {
    const f = rectFloor(t);
    const r = detectRooms(f)[0]!;
    check(`net area ${t}mm walls`,
      near(r.netAreaMm2, (4000 - t) * (3000 - t), 1000),
      `${r.netAreaMm2} vs ${(4000 - t) * (3000 - t)}`);
    check(`net < centerline (${t}mm)`, r.netAreaMm2 < r.areaMm2);
  }
}
{
  // Mixed thicknesses: a 100mm divider in a 300mm shell. Each half insets by
  // 150 on the outer sides and 50 on the divider.
  const f = rectFloor(300);
  const n1 = { id: newId("n"), x: 2000, y: 0 };
  const n2 = { id: newId("n"), x: 2000, y: 3000 };
  f.nodes.push(n1, n2);
  const top = f.walls[0]!, bottom = f.walls[2]!;
  const topB = top.b; top.b = n1.id;
  f.walls.push({ id: newId("w"), a: n1.id, b: topB, thickness: 300, bulge: 0, openings: [] });
  const botB = bottom.b; bottom.b = n2.id;
  f.walls.push({ id: newId("w"), a: n2.id, b: botB, thickness: 300, bulge: 0, openings: [] });
  f.walls.push({ id: newId("w"), a: n1.id, b: n2.id, thickness: 100, bulge: 0, openings: [] });
  const rooms = detectRooms(f);
  const expect = (2000 - 150 - 50) * (3000 - 300);
  check("net area honours per-wall thickness",
    rooms.length === 2 && rooms.every(r => near(r.netAreaMm2, expect, 2000)),
    JSON.stringify(rooms.map(r => r.netAreaMm2)));
}
{
  // Walls thicker than the room invert the boundary. A doubly-inverted
  // rectangle has POSITIVE shoelace area, so this must be caught structurally,
  // not by an area check — otherwise it reports a room that does not exist.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(400, 0), v(400, 400), v(0, 400)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++)
    f.walls.push({ id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 600, bulge: 0, openings: [] });
  const r = detectRooms(f)[0];
  check("over-thick walls give zero net area", !r || r.netAreaMm2 === 0, String(r?.netAreaMm2));
}

// --- wall face lengths: centerline vs clear span (dagmaat) ---
{
  const f = rectFloor(100);
  const res = resolveFloor(f);
  for (const rw of res.walls.values()) {
    const cl = rw.length;
    check(`clear span is centerline minus a wall (${cl}mm)`,
      near(rw.clearLength, cl - 100, 1), `${rw.clearLength} vs ${cl - 100}`);
    check(`outer face is centerline plus a wall (${cl}mm)`,
      near(Math.max(rw.faces.left, rw.faces.right), cl + 100, 1));
  }
}
{
  // Differing thicknesses at the two ends: a 4000 wall between a 300 and a 100
  // wall loses 150 at one end and 50 at the other.
  const f = rectFloor(300);
  const nMid = { id: newId("n"), x: 0, y: 1500 };
  f.nodes.push(nMid);
  const left = f.walls[3]!;              // (0,3000) -> (0,0)
  const leftB = left.b; left.b = nMid.id;
  f.walls.push({ id: newId("w"), a: nMid.id, b: leftB, thickness: 100, bulge: 0, openings: [] });
  const res = resolveFloor(f);
  let ok = true;
  for (const rw of res.walls.values())
    if (!isFinite(rw.clearLength) || rw.clearLength <= 0) ok = false;
  check("clear span finite and positive with mixed thicknesses", ok);
  const top = res.walls.get(f.walls[0]!.id)!;
  check("clear span shorter than centerline", top.clearLength < top.length,
    `${top.clearLength} vs ${top.length}`);
}

// --- multi-floor store ---
{
  const st = new Store();
  st.replace(emptyDoc());
  check("starts on the only floor", st.activeFloor === 0 && st.doc.floors.length === 1);
  check("no ghost on the lowest floor", st.floorBelow === null);

  st.addFloor("Floor 2");
  check("add switches to the new floor", st.doc.floors.length === 2 && st.activeFloor === 1);
  check("ghost is the storey below", st.floorBelow === st.doc.floors[0]);

  // Edits must land on the ACTIVE floor, not floors[0].
  st.mutate(d => { st.floorOf(d).nodes.push({ id: newId("n"), x: 1, y: 2 }); });
  check("edit lands on the active floor",
    st.doc.floors[1]!.nodes.length === 1 && st.doc.floors[0]!.nodes.length === 0);

  // Duplicating must not share ids, or an edit on one storey would hit another.
  st.setActiveFloor(0);
  st.mutate(d => {
    const f = st.floorOf(d);
    const a = { id: newId("n"), x: 0, y: 0 }, b = { id: newId("n"), x: 1000, y: 0 };
    f.nodes.push(a, b);
    f.walls.push({ id: newId("w"), a: a.id, b: b.id, thickness: 100, bulge: 0, openings: [] });
  });
  st.duplicateFloor("Copy");
  const src = st.doc.floors[0]!, copy = st.doc.floors[1]!;
  const shared = copy.nodes.some(n => src.nodes.some(m => m.id === n.id))
              || copy.walls.some(w => src.walls.some(x => x.id === w.id));
  check("duplicate re-ids everything", !shared);
  check("duplicate rewires walls to its own nodes",
    copy.walls.every(w => copy.nodes.some(n => n.id === w.a) && copy.nodes.some(n => n.id === w.b)));

  // Undo can shrink floors[]; the index must never dangle.
  st.setActiveFloor(st.doc.floors.length - 1);
  const high = st.activeFloor;
  st.undo();
  check("undo clamps the active floor",
    st.activeFloor <= st.doc.floors.length - 1 && st.activeFloor >= 0,
    `was ${high}, now ${st.activeFloor} of ${st.doc.floors.length}`);
  check("floor getter never returns undefined", st.floor !== undefined);

  // The last floor is never removable.
  while (st.doc.floors.length > 1) st.deleteFloor();
  st.deleteFloor();
  check("last floor cannot be deleted", st.doc.floors.length === 1);
}

// --- T-junctions must not leave a hole in the masonry ---
{
  // A 300mm wall running through, with a 100mm branch. The through-wall's end
  // caps slant from the outer face at the node to the inner face pushed out by
  // the branch, so the wedge between them belongs to no wall polygon.
  const f = emptyDoc().floors[0]!;
  const N = (x: number, y: number): string => { const id = newId("n"); f.nodes.push({ id, x, y }); return id; };
  const P = N(0, 0), W = N(-3000, 0), E = N(3000, 0), S = N(0, 3000);
  const mk = (a: string, b: string, t: number): void => {
    f.walls.push({ id: newId("w"), a, b, thickness: t, bulge: 0, openings: [] });
  };
  mk(W, P, 300); mk(P, E, 300); mk(P, S, 100);
  const res = resolveFloor(f);
  const covered = (p: { x: number; y: number }): boolean =>
    [...res.walls.values()].some(rw => rw.pieces.some(pc => pointInPolygon(p, pc.poly)))
    || res.junctions.some(j => pointInPolygon(p, j.poly));

  let holes = 0;
  // Sweep the full 300mm band across the junction; every point must be masonry.
  for (let x = -200; x <= 200; x += 10)
    for (let y = -140; y <= 140; y += 10)
      if (!covered(v(x, y))) holes++;
  check("no hole in a T-junction", holes === 0, `${holes} uncovered probe points`);
  check("junction polygon emitted for degree 3", res.junctions.length === 1, String(res.junctions.length));
}
{
  // An L corner already miters cleanly, so it must NOT gain a filler polygon.
  const f = rectFloor(200);
  const res = resolveFloor(f);
  check("no junction fill for plain corners", res.junctions.length === 0, String(res.junctions.length));
}

// --- window sashes ---
{
  const mk = (o: Partial<Opening>): Opening =>
    ({ id: "o", kind: "window", t: 1000, width: 2000, sashes: [{ action: "fixed" }], ...o });

  // A combination window is one hole subdivided; widths must total the opening.
  const combo = sashesOf(mk({ width: 2400, sashes: [
    { action: "fixed", width: 1400 }, { action: "turn-tilt", hinge: "b" },
  ] }), 2400);
  check("sized sash keeps its width", combo[0]!.width === 1400);
  check("unsized sash takes the remainder", combo[1]!.width === 1000);
  check("sash widths total the opening",
    Math.abs(combo.reduce((t, x) => t + x.width, 0) - 2400) < 1e-6);

  const three = sashesOf(mk({ width: 3000, sashes: [
    { action: "fixed" }, { action: "turn" }, { action: "fixed" },
  ] }), 3000);
  check("unsized sashes split evenly", three.every(x => Math.abs(x.width - 1000) < 1e-6));

  // Over-wide fixed panes must not hand the remainder a negative width, which
  // would flip the sash geometry inside out.
  const over = sashesOf(mk({ width: 1000, sashes: [
    { action: "fixed", width: 1800 }, { action: "turn" },
  ] }), 1000);
  check("remainder never goes negative", over[1]!.width === 0, String(over[1]!.width));

  check("an explicit single sash spans the opening",
    sashesOf(mk({ sashes: [{ action: "fold" }] }), 2000)[0]!.width === 2000);
}

// --- doors get sashes too, and named kinds survive tuning ---
{
  const door = (o: Partial<Opening>): Opening =>
    ({ id: "o", kind: "door", t: 1000, width: 900,
      sashes: [{ action: "turn", hinge: "a", outward: false }], ...o });
  check("passage has no leaf action",
    sashesOf({ id: "o", kind: "passage", t: 1, width: 900, sashes: [] }, 900).length === 0);

  // Hinge side and swing are tunings, not identity: all four read as one door.
  for (const hinge of ["a", "b"] as const)
    for (const outward of [true, false])
      check(`door hinge=${hinge} outward=${outward} is still a single door`,
        doorKindOf(sashesOf(door({ sashes: [{ action: "turn", hinge, outward }] }), 900))?.id === "enkel");

  for (const k of DOOR_KINDS)
    check(`door kind ${k.id} round-trips`, doorKindOf(k.sashes)?.id === k.id);
  // A pui is a frame assembly: fixed glazing beside opening parts.
  const pui = DOOR_KINDS.find(k => k.id === "schuifpui")!;
  check("schuifpui is fixed glazing plus a sliding leaf",
    pui.sashes.length === 2 && pui.sashes[0]!.action === "fixed" && pui.sashes[1]!.action === "slide");
  const pui3 = DOOR_KINDS.find(k => k.id === "schuifpui3")!;
  check("3-panel pui is fixed / sliding / fixed",
    pui3.sashes.map(x => x.action).join(",") === "fixed,slide,fixed");
  // Its panes divide the opening, so widths still total it.
  const laid = sashesOf(door({ width: 4200, sashes: pui3.sashes }), 4200);
  check("pui panes total the opening width",
    Math.abs(laid.reduce((t, x) => t + x.width, 0) - 4200) < 1e-6);

  check("tourniquet is a named door kind",
    DOOR_KINDS.some(k => k.id === "tourniquet" && k.sashes[0]!.action === "revolve"));
  // Rotation sense is a tuning, like hinge side: both senses are one tourniquet.
  for (const spin of ["cw", "ccw"] as const)
    check(`tourniquet spinning ${spin} is still a tourniquet`,
      doorKindOf([{ action: "revolve", spin }])?.id === "tourniquet");

  // A double door is two leaves sharing the opening.
  const dbl = sashesOf(door({ width: 1600, sashes: DOOR_KINDS.find(k => k.id === "dubbel")!.sashes }), 1600);
  check("double door has two leaves of half the width",
    dbl.length === 2 && dbl.every(l => Math.abs(l.width - 800) < 1e-6), JSON.stringify(dbl.map(l => l.width)));
  check("double door leaves hinge on opposite jambs",
    dbl[0]!.hinge === "a" && dbl[1]!.hinge === "b");
  const automatic = door({ width: 1600, sashes: DOOR_KINDS.find(k => k.id === "dubbel")!.sashes });
  const specs = sashSpecsOf(automatic);
  specs[0]!.hinge = "b"; // the kind of property edit the panel performs
  automatic.sashes = specs;
  const resized = sashesOf(automatic, 2000);
  check("editing a leaf preserves automatic widths",
    specs.every(x => x.width === undefined) && resized.every(x => x.width === 1000),
    JSON.stringify({ specs, resized }));
}
{
  // Windows: a horizontal hinge IS identity (valraam vs uitzetraam), a jamb
  // hinge is not.
  // Single-pane kinds identify themselves from their parts.
  for (const k of WINDOW_KINDS.filter(k => !k.expandsTo))
    check(`window kind ${k.id} round-trips`,
      windowKindOf({ action: k.action, hinge: k.hinge, outward: k.outward })?.id === k.id);
  // Multi-pane kinds deliberately do not: a stolpraam IS two draairamen, and
  // reporting each pane as a draairaam is the honest answer.
  const stolp = WINDOW_KINDS.find(k => k.id === "stolp")!;
  check("stolpraam expands to two opposite-hinged leaves",
    stolp.expandsTo?.length === 2
    && stolp.expandsTo[0]!.hinge === "a" && stolp.expandsTo[1]!.hinge === "b");
  check("each stolpraam leaf reads as a draairaam",
    stolp.expandsTo!.every(x => windowKindOf(x)?.id === "draai"));
  // The axis split: taatsraam turns in plan, tuimelraam does not.
  check("taatsraam is the vertical-axis pivot", windowKindOf({ action: "pivot" })?.id === "taats");
  check("tuimelraam is the horizontal-axis tumble", windowKindOf({ action: "tumble" })?.id === "tuimel");
  check("valraam and uitzetraam stay distinct",
    windowKindOf({ action: "tilt", hinge: "sill" })?.id === "val"
    && windowKindOf({ action: "tilt", hinge: "head" })?.id === "uitzet");
  check("a side-hung window is still one kind whichever jamb hinges",
    windowKindOf({ action: "turn", hinge: "b", outward: true })?.id === "draai");
}

// --- symbol colour ---
{
  const sym = (color?: string) => ({ id: "s1", type: "socket-single", x: 0, y: 0, rotation: 0, color });
  check("no colour draws in the plan ink", symbolInk(sym()) === COLORS.symbol);
  check("a symbol keeps its own colour", symbolInk(sym("#d0342c")) === "#d0342c");
  check("uppercase hex is accepted", symbolInk(sym("#D0342C")) === "#D0342C");
  // Canvas ignores an invalid strokeStyle instead of throwing, so a hand-edited
  // or pasted document could otherwise paint a symbol in the previous one's
  // colour -- a wrong colour on a plan that states what is new means the wrong
  // thing, so anything unparseable falls back rather than being passed through.
  for (const bad of ["", "red", "#fff", "#12345g", "javascript:alert(1)"])
    check(`rejects ${JSON.stringify(bad)}`, symbolInk(sym(bad)) === COLORS.symbol);
  // The presets are what the picker stores, so they must survive that check.
  check("every preset ink is a storable colour",
    INKS.every(i => i.hex === null || symbolInk(sym(i.hex)) === i.hex));
  check("exactly one preset is the default ink", INKS.filter(i => i.hex === null).length === 1);
}

// --- dimension chains ---
{
  const doc = seedDoc();
  const f = doc.floors[0]!;
  const chains = dimensionChains(f);

  // Every span must account for the run: a chain whose parts do not add up to
  // its overall is worse than no chain, because a builder sets out from it.
  for (const c of chains) {
    const sum = c.spans.reduce((t, s2) => t + s2.mm, 0);
    check(`chain spans total ${Math.round(c.total)}`, Math.abs(sum - c.total) < 1,
      `spans sum ${sum}`);
    check("chain spans run end to end without gaps",
      c.spans.every((s2, i) => i === 0 || s2.from === c.spans[i - 1]!.to));
  }

  // The demo is a rectangle: four facades, and the interior wall is not one.
  check("one chain per facade", chains.length === 4, String(chains.length));
  check("all chains are axis-aligned here",
    chains.every(c => Math.abs(c.dir.x) > 0.99 || Math.abs(c.dir.y) > 0.99));

  // A chain must sit OUTSIDE, or it measures across the rooms it describes.
  const rooms = detectRooms(f);
  for (const c of chains) {
    const mid = {
      x: c.origin.x + c.dir.x * c.total / 2 + c.out.x * (c.half + 200),
      y: c.origin.y + c.dir.y * c.total / 2 + c.out.y * (c.half + 200),
    };
    check("chain lies outside every room",
      !rooms.some(r => pointInPolygon(mid, r.poly)));
  }

  // Openings break a run: the top facade carries a 1800 window, so 1800 is a span.
  const top = chains.find(c => Math.abs(c.dir.x) > 0.99 && c.origin.y < 100);
  check("an opening becomes its own span",
    top !== undefined && top.spans.some(s2 => s2.mm === 1800),
    top ? top.spans.map(s2 => s2.mm).join(",") : "no top chain");

  // Collinear walls merge: the top facade is two walls but one 8000 run.
  check("collinear walls merge into one run",
    top !== undefined && Math.abs(top.total - 8000) < 1 && top.wallIds.length === 2,
    top ? `${top.total} over ${top.wallIds.length} walls` : "");
}
{
  // A bowed wall has no single line to measure along, so it forms no chain.
  const f = rectFloor(100);
  f.walls[1]!.bulge = -0.4;
  const chains = dimensionChains(f);
  check("curved walls are left out of chains",
    chains.every(c => !c.wallIds.includes(f.walls[1]!.id)));
}
{
  // Nothing enclosed yet: chains still appear, falling back to the centroid,
  // rather than the tool going blank while a plan is being drawn.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const a = { id: newId("n"), x: 0, y: 0 }, b = { id: newId("n"), x: 3000, y: 0 };
  f.nodes.push(a, b);
  f.walls.push({ id: newId("w"), a: a.id, b: b.id, thickness: 100, bulge: 0, openings: [] });
  const chains = dimensionChains(f);
  check("a lone wall still dimensions", chains.length === 1 && Math.abs(chains[0]!.total - 3000) < 1);
}

// --- welded wall insertion ---
{
  // Two rooms drawn side by side share one wall. Stacking two would put two
  // walls in the same place, and detectRooms would walk between them.
  const f = emptyDoc().floors[0]!;
  const left = shapeRun("rect", v(0, 0), v(4000, 3000))!;
  insertRun(f, left.points, left.bulges, 100);
  check("a rectangle is four walls", f.walls.length === 4 && f.nodes.length === 4);
  check("a rectangle is one room", detectRooms(f).length === 1);

  const right = shapeRun("rect", v(4000, 0), v(8000, 3000))!;
  insertRun(f, right.points, right.bulges, 100);
  check("the shared wall is not doubled", f.walls.length === 7, String(f.walls.length));
  check("the shared corners are not doubled", f.nodes.length === 6, String(f.nodes.length));
  check("two rooms side by side", detectRooms(f).length === 2);

  insertRun(f, right.points, right.bulges, 100);
  check("drawing the same rectangle again adds nothing",
    f.walls.length === 7 && f.nodes.length === 6);
}
{
  // A rectangle overlapping part of an existing wall splits that wall at both
  // ends of the overlap rather than laying a second wall along it.
  const f = emptyDoc().floors[0]!;
  const room = shapeRun("rect", v(0, 0), v(4000, 3000))!;
  insertRun(f, room.points, room.bulges, 100);
  const inner = shapeRun("rect", v(4000, 1000), v(6000, 2000))!;
  insertRun(f, inner.points, inner.bulges, 100);
  const onSeam = f.walls.filter(w => {
    const a = f.nodes.find(n => n.id === w.a)!, b = f.nodes.find(n => n.id === w.b)!;
    return a.x === 4000 && b.x === 4000;
  });
  check("a partial overlap splits the wall it shares", onSeam.length === 3, String(onSeam.length));
  const areas = detectRooms(f).map(r => Math.round(r.areaMm2 / 1000)).sort((a, b) => a - b);
  check("both rooms come out whole", areas.join(",") === "2000,12000", areas.join(","));
}
{
  // A wall drawn straight across a room divides it: both walls it crosses are
  // split, and so is the new wall, or the two rooms share no boundary.
  const f = emptyDoc().floors[0]!;
  const room = shapeRun("rect", v(0, 0), v(4000, 3000))!;
  insertRun(f, room.points, room.bulges, 100);
  const a = nodeAt(f, v(2000, -500)), b = nodeAt(f, v(2000, 3500));
  insertWall(f, a.id, b.id, 100);
  check("a crossing wall splits what it crosses", f.walls.length === 9, String(f.walls.length));
  const areas = detectRooms(f).map(r => Math.round(r.areaMm2 / 1000));
  check("the room is divided in two", areas.length === 2 && areas.every(x => x === 6000), areas.join(","));
}
{
  // An opening on a wall that gets split travels with the piece it sits on.
  const f = emptyDoc().floors[0]!;
  const a = nodeAt(f, v(0, 0)), b = nodeAt(f, v(4000, 0));
  const wall = insertWall(f, a.id, b.id, 100)[0]!;
  wall.openings.push({ id: newId("o"), kind: "door", t: 3000, width: 900,
    sashes: [{ action: "turn", hinge: "a" }] });
  const c = nodeAt(f, v(1000, 0)), d = nodeAt(f, v(1000, 2000));
  insertWall(f, c.id, d.id, 100);
  const holders = f.walls.filter(w => w.openings.length > 0);
  check("a split wall keeps its opening", holders.length === 1, String(holders.length));
  check("the opening keeps its place on the piece it landed on",
    Math.abs((holders[0]?.openings[0]?.t ?? 0) - 2000) < 1, String(holders[0]?.openings[0]?.t));
}
{
  // A junction may not cut through the span occupied by an opening. Doing so
  // would put one or both jambs beyond the child wall that retains the record.
  const f = emptyDoc().floors[0]!;
  const a = nodeAt(f, v(0, 0)), b = nodeAt(f, v(4000, 0));
  const wall = insertWall(f, a.id, b.id, 100)[0]!;
  wall.openings.push({ id: newId("o"), kind: "door", t: 2000, width: 900,
    sashes: [{ action: "turn", hinge: "a" }] });
  const c = nodeAt(f, v(2000, -1000)), d = nodeAt(f, v(2000, 1000));
  const before = f.walls.length;
  const made = insertWall(f, c.id, d.id, 100);
  check("a wall crossing through an opening is rejected", made.length === 0);
  check("the rejected crossing leaves the carrying wall whole",
    f.walls.length === before && wallLength(f, wall) === 4000 && wall.openings[0]!.t === 2000,
    JSON.stringify({ walls: f.walls.length, t: wall.openings[0]!.t }));
}
{
  // The circle is four quarter arcs on one centre, not a many-sided polygon.
  const f = emptyDoc().floors[0]!;
  const ring = shapeRun("circle", v(0, 0), v(2000, 0))!;
  insertRun(f, ring.points, ring.bulges, 100);
  check("a circle is four walls", f.walls.length === 4, String(f.walls.length));
  const centres = f.walls.map(w => {
    const a = f.nodes.find(n => n.id === w.a)!, b = f.nodes.find(n => n.id === w.b)!;
    return arcInfo(v(a.x, a.y), v(b.x, b.y), w.bulge)!;
  });
  check("every quarter has the drawn radius", centres.every(i => near(i.radius, 2000, 1)),
    centres.map(i => i.radius.toFixed(1)).join(","));
  check("every quarter shares the centre",
    centres.every(i => dist(i.center, v(0, 0)) < 1));
  const rooms = detectRooms(f);
  // Room detection flattens arcs, so the area is a shade under the true circle.
  check("a circle encloses one room", rooms.length === 1);
  check("the enclosed area is the circle's",
    near(rooms[0]?.areaMm2 ?? 0, Math.PI * 2000 * 2000, 60_000), String(rooms[0]?.areaMm2));
}
{
  const f = emptyDoc().floors[0]!;
  const hex = shapeRun("polygon", v(0, 0), v(2000, 0), { sides: 6 })!;
  insertRun(f, hex.points, hex.bulges, 100);
  check("a hexagon is six walls", f.walls.length === 6, String(f.walls.length));
  check("a hexagon is one room", detectRooms(f).length === 1);
  const sides = hex.points.map((p, i) => dist(p, hex.points[(i + 1) % hex.points.length]!));
  check("its sides are equal", sides.every(x => near(x, sides[0]!, 1)));
}
{
  // The shapes themselves: what two points mean, and what is too small to be a
  // shape at all.
  const square = shapeRun("rect", v(0, 0), v(4000, -1000), { square: true })!;
  check("Shift squares the rectangle off",
    square.points[1]!.x === 4000 && square.points[2]!.y === -4000,
    JSON.stringify(square.points));
  check("a rectangle with no span is not a shape", shapeRun("rect", v(0, 0), v(4000, 5)) === null);
  check("a circle with no radius is not a shape", shapeRun("circle", v(0, 0), v(3, 0)) === null);
  check("sides are clamped to a ring that closes",
    shapeRun("polygon", v(0, 0), v(1000, 0), { sides: 1 })!.points.length === 3);
  check("a polygon whose rounded edges are too short is rejected",
    shapeRun("polygon", v(0, 0), v(20, 0), { sides: 24 }) === null);
}
{
  // Closing a chain runs one wall back to the node it started from.
  const f = emptyDoc().floors[0]!;
  const pts = [v(0, 0), v(3000, 0), v(3000, 2000)];
  const ids = pts.map(p => nodeAt(f, p).id);
  insertWall(f, ids[0]!, ids[1]!, 100);
  insertWall(f, ids[1]!, ids[2]!, 100);
  check("an open chain encloses nothing", detectRooms(f).length === 0);
  insertWall(f, ids[2]!, ids[0]!, 100);
  check("closing it makes a room", detectRooms(f).length === 1);
  check("closing it makes exactly one more wall", f.walls.length === 3, String(f.walls.length));
}

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
