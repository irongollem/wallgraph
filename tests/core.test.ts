// Engine sanity tests, run with tsx.
import { emptyDoc, newId, Wall, GRID_DEFAULT_MM } from "../src/model/doc";
import { Store } from "../src/model/store";
import { sashesOf, doorKindOf, windowKindOf, DOOR_KINDS, WINDOW_KINDS, type Opening } from "../src/model/doc";
import { detectRooms } from "../src/core/rooms";
import { resolveFloor } from "../src/core/resolve";
import { arcInfo, arcLength, arcPointAt, arcTangentAt, arcFlatten, bulgeFromSagitta } from "../src/geometry/arc";
import { v, dist, pointInPolygon } from "../src/geometry/vec";
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
    ({ id: "o", kind: "window", t: 1000, width: 2000, ...o } as Opening);

  // Documents written before sashes existed must resolve to the same window.
  const legacy: Array<[string, Opening, string]> = [
    ["fixed", mk({ windowType: "fixed" }), "fixed"],
    ["casement", mk({ windowType: "casement" }), "turn"],
    ["tilt-turn", mk({ windowType: "tilt-turn" }), "turn-tilt"],
    ["sliding", mk({ windowType: "sliding" }), "slide"],
    ["untyped", mk({}), "fixed"],
  ];
  for (const [name, o, action] of legacy) {
    const s2 = sashesOf(o, 2000);
    check(`legacy ${name} maps to one ${action} sash`,
      s2.length === 1 && s2[0]!.action === action && s2[0]!.width === 2000,
      JSON.stringify(s2));
  }
  // swingIn false is "naar buiten", which is what drives the solid line style.
  check("legacy swingIn:false becomes outward",
    sashesOf(mk({ windowType: "casement", swingIn: false }), 2000)[0]!.outward === true);
  check("legacy swingIn:true stays inward",
    sashesOf(mk({ windowType: "casement", swingIn: true }), 2000)[0]!.outward === false);

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

  // sashes wins over a stale windowType, so the two can never disagree.
  check("sashes override a legacy windowType",
    sashesOf(mk({ windowType: "sliding", sashes: [{ action: "fold" }] }), 2000)[0]!.action === "fold");
}

// --- doors get sashes too, and named kinds survive tuning ---
{
  const door = (o: Partial<Opening>): Opening =>
    ({ id: "o", kind: "door", t: 1000, width: 900, ...o } as Opening);

  // A door with no sashes is a hinged leaf. Defaulting to "fixed" — which the
  // window-only fallback did — silently erased every existing door's swing.
  const legacy = sashesOf(door({ hinge: "b", swingIn: true }), 900);
  check("legacy door is one hinged leaf",
    legacy.length === 1 && legacy[0]!.action === "turn" && legacy[0]!.hinge === "b",
    JSON.stringify(legacy));
  check("passage has no leaf action",
    sashesOf({ id: "o", kind: "passage", t: 1, width: 900 } as Opening, 900)[0]!.action === "fixed");

  // Hinge side and swing are tunings, not identity: all four read as one door.
  for (const hinge of ["a", "b"] as const)
    for (const swingIn of [true, false])
      check(`door hinge=${hinge} swingIn=${swingIn} is still a single door`,
        doorKindOf(sashesOf(door({ hinge, swingIn }), 900))?.id === "enkel");

  for (const k of DOOR_KINDS)
    check(`door kind ${k.id} round-trips`, doorKindOf(k.sashes)?.id === k.id);

  // A double door is two leaves sharing the opening.
  const dbl = sashesOf(door({ width: 1600, sashes: DOOR_KINDS.find(k => k.id === "dubbel")!.sashes }), 1600);
  check("double door has two leaves of half the width",
    dbl.length === 2 && dbl.every(l => Math.abs(l.width - 800) < 1e-6), JSON.stringify(dbl.map(l => l.width)));
  check("double door leaves hinge on opposite jambs",
    dbl[0]!.hinge === "a" && dbl[1]!.hinge === "b");
}
{
  // Windows: a horizontal hinge IS identity (valraam vs uitzetraam), a jamb
  // hinge is not.
  for (const k of WINDOW_KINDS)
    check(`window kind ${k.id} round-trips`,
      windowKindOf({ action: k.action, hinge: k.hinge, outward: k.outward })?.id === k.id);
  check("valraam and uitzetraam stay distinct",
    windowKindOf({ action: "tilt", hinge: "sill" })?.id === "val"
    && windowKindOf({ action: "tilt", hinge: "head" })?.id === "uitzet");
  check("a side-hung window is still one kind whichever jamb hinges",
    windowKindOf({ action: "turn", hinge: "b", outward: true })?.id === "draai");
}

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
