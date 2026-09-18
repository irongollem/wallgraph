// Column protrusion, the proposed voorzetwand stand-off, and the build-up
// clash report: src/core/leafclash.ts. Run with tsx.
import { emptyDoc, newId, type Wall, type Floor } from "../src/model/doc";
import type { Column, ColumnShape } from "../src/model/structure";
import { resolveFloor } from "../src/core/resolve";
import { columnProtrusions, proposedGapMm, buildUpClashes } from "../src/core/leafclash";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

/** A single straight wall from (0,0) to (L,0), on its own floor. */
function wallFloor(L: number, thickness: number): { f: Floor; w: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const a = newId("n"), b = newId("n");
  f.nodes.push({ id: a, x: 0, y: 0 }, { id: b, x: L, y: 0 });
  const w: Wall = { id: newId("w"), a, b, thickness, bulge: 0, openings: [] };
  f.walls.push(w);
  return { f, w };
}

function addColumn(
  f: Floor, opts: { x: number; y: number; width: number; depth: number; shape: ColumnShape; rotation: number },
): Column {
  const c: Column = { id: newId("c"), kind: "column", ...opts };
  f.structure!.push(c);
  return c;
}

// ---- 1. an H-column standing past a concrete wall's face ------------------

{
  // 200mm-thick wall (half = 100). H-column, 300 wide x 200 deep, its centre
  // 50mm on the room side of the centerline (y = 50): its footprint runs
  // y in [-50, 150], so the room-side edge (150) sits 50mm past the
  // structural face at 100.
  const { f, w } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 50, width: 300, depth: 200, shape: "h", rotation: 0 });
  const ps = columnProtrusions(f, resolved).filter(p => p.columnId === c.id);
  check("H-column: one entry, on the room side", ps.length === 1 && ps[0]!.side === "left", JSON.stringify(ps));
  check("H-column protrusion is 50", ps[0]?.protrusionMm === 50, String(ps[0]?.protrusionMm));
  check("proposed gap on the near face ceils to 50", proposedGapMm(f, resolved, w.id, "left") === 50);
  check("no proposal on the clear face", proposedGapMm(f, resolved, w.id, "right") === null);
}

// ---- 2. a column wholly inside the wall thickness --------------------------

{
  // 200mm-thick wall (half = 100). 200 x 150 rect column on the centerline:
  // its footprint runs y in [-75, 75], inside [-100, 100] on both sides.
  const { f } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 0, width: 200, depth: 150, shape: "rect", rotation: 0 });
  const ps = columnProtrusions(f, resolved).filter(p => p.columnId === c.id);
  check("column wholly inside the wall: no protrusion", ps.length === 0, JSON.stringify(ps));
}

// ---- 3. a column standing clear of a sandwich wall's face -------------------

{
  // 100mm-thick sandwich wall (half = 50). 200 x 200 rect column, its near
  // edge (facing the wall) 20mm clear of the face at 50: centre y = 50 + 20
  // + 100 (its own half-depth) = 170, far edge at 270 -- protrusion
  // 270 - 50 = 220, i.e. exactly gap + depth = 20 + 200.
  const { f, w } = wallFloor(1000, 100);
  w.material = "sandwich";
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 170, width: 200, depth: 200, shape: "rect", rotation: 0 });
  const ps = columnProtrusions(f, resolved).filter(p => p.columnId === c.id);
  check("20mm clear + 200 deep -> protrusion 220", ps.length === 1 && ps[0]!.protrusionMm === 220, JSON.stringify(ps));
}

// ---- 4. a rotated column ----------------------------------------------------

{
  // 200mm-thick wall (half = 100). Rect column 300 (local x) x 200 (local
  // y), rotated by atan2(3,4) -- a 3-4-5 triangle, so sin = 0.6, cos = 0.8
  // exactly. worldPoint()'s rotation sends local (150, 100) (the corner
  // toward the room and along +t) to world-relative
  // (150*0.8 - 100*0.6, 150*0.6 + 100*0.8) = (90, 170): the rotated
  // footprint's half-extent along the wall's normal is 170, not the
  // unrotated depth/2 = 100 -- the general form hw*|sin| + hd*|cos| =
  // 150*0.6 + 100*0.8 = 90 + 80 = 170 confirms every corner is checked, not
  // just this one. Centred at y = 100, the room-side edge reaches
  // 100 + 170 = 270, protrusion 270 - 100 = 170.
  const { f } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const rotation = Math.atan2(3, 4);
  const c = addColumn(f, { x: 500, y: 100, width: 300, depth: 200, shape: "rect", rotation });
  const ps = columnProtrusions(f, resolved).filter(p => p.columnId === c.id);
  check("rotated rect: one entry, on the room side", ps.length === 1 && ps[0]!.side === "left", JSON.stringify(ps));
  check("rotated rect protrusion is 170", ps[0]?.protrusionMm === 170, String(ps[0]?.protrusionMm));
}
{
  // The same column, unrotated, at the same centre: half-extent along the
  // normal is just depth/2 = 100, room-side edge at 100 + 100 = 200,
  // protrusion 200 - 100 = 100 -- less than the rotated case's 170, which is
  // exactly the rotation's own contribution (70mm) demonstrated above.
  const { f } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 100, width: 300, depth: 200, shape: "rect", rotation: 0 });
  const ps = columnProtrusions(f, resolved).filter(p => p.columnId === c.id);
  check("same column unrotated: protrusion 100", ps.length === 1 && ps[0]!.protrusionMm === 100, JSON.stringify(ps));
}

// ---- 5. a build-up clash against a stated frame -----------------------------

{
  // Same 50mm protrusion as case 1. A frame with gapMm 30 stands 20mm short
  // of the column (30 < 50): the column reaches into the studs, a clash.
  // Widened to gapMm 50, the frame's own depth starts exactly where the
  // column ends: no clash (protrusion > gapMm is false at 50 == 50).
  const { f, w } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 50, width: 300, depth: 200, shape: "h", rotation: 0 });
  w.buildUp = { left: { frame: { gapMm: 30, depthMm: 50, material: "timber" }, boards: [] } };
  let clashes = buildUpClashes(f, resolved).filter(p => p.columnId === c.id);
  check("gapMm 30 over a 50mm protrusion: one clash", clashes.length === 1, JSON.stringify(clashes));
  w.buildUp.left!.frame!.gapMm = 50;
  clashes = buildUpClashes(f, resolved).filter(p => p.columnId === c.id);
  check("gapMm 50 over a 50mm protrusion: none", clashes.length === 0, JSON.stringify(clashes));
}

// ---- 6. a column beyond the wall's own end in t -----------------------------

{
  // 1000mm-long wall. Column centred at x = 1500, 300 wide: its t-range,
  // [1350, 1650], lies wholly past the wall's own end at 1000.
  const { f } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 1500, y: 50, width: 300, depth: 200, shape: "h", rotation: 0 });
  const ps = columnProtrusions(f, resolved).filter(p => p.columnId === c.id);
  check("column beyond the wall's end in t: not counted", ps.length === 0, JSON.stringify(ps));
}

// ---- 7. an unframed board stack clashes at any protrusion -------------------

{
  // Same 50mm protrusion as case 1, but the face states boards with no
  // frame: any protrusion at all reaches the structural face, so it clashes.
  const { f, w } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 50, width: 300, depth: 200, shape: "h", rotation: 0 });
  w.buildUp = { left: { boards: [{ kind: "gypsum", mm: 12 }] } };
  const clashes = buildUpClashes(f, resolved).filter(p => p.columnId === c.id);
  check(
    "unframed board stack: any protrusion clashes",
    clashes.length === 1 && clashes[0]!.protrusionMm === 50,
    JSON.stringify(clashes),
  );
}
{
  // The same protruding column, but the face states no build-up at all:
  // nothing to clash with.
  const { f } = wallFloor(1000, 200);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 50, width: 300, depth: 200, shape: "h", rotation: 0 });
  const clashes = buildUpClashes(f, resolved).filter(p => p.columnId === c.id);
  check("no stated build-up: no clash even though the column protrudes", clashes.length === 0, JSON.stringify(clashes));
}

// ---- 8. an arc wall, measured radially --------------------------------------

{
  // A=(0,0), B=(1000,0), bulge=1: a full semicircle with the chord as
  // diameter. arcInfo gives centre = chord midpoint = (500,0) (offset
  // k = (c/4)(g - 1/g) = (1000/4)(1-1) = 0) and radius = (c/4)(g + 1/g)
  // = (1000/4)*2 = 500. The apex (t = L/2) sits at (500, 500), directly
  // above the centre, and positive bulge bows toward left (verified against
  // arcTangentAt/perp directly, not reasoned: at the apex, tangent is
  // (1, 0) and perp(tangent) is (0, 1), the same +y direction the apex
  // itself is offset in from the chord -- so the outward, larger-radius
  // side is "left").
  //
  // 100mm-thick wall (half = 50), structural face at r = 550. A round
  // column, 100mm across, centred 530mm from the arc's own centre along the
  // radial line straight through the apex (500, 530): its outer edge sits
  // at r = 530 + 50 = 580, protrusion 580 - 550 = 30.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const a = newId("n"), b = newId("n");
  f.nodes.push({ id: a, x: 0, y: 0 }, { id: b, x: 1000, y: 0 });
  const w: Wall = { id: newId("w"), a, b, thickness: 100, bulge: 1, openings: [] };
  f.walls.push(w);
  const resolved = resolveFloor(f);
  const c = addColumn(f, { x: 500, y: 530, width: 100, depth: 100, shape: "round", rotation: 0 });
  const ps = columnProtrusions(f, resolved).filter(p => p.columnId === c.id);
  check("arc wall: one entry, on the outward (left) side", ps.length === 1 && ps[0]!.side === "left", JSON.stringify(ps));
  check(
    "arc wall protrusion is 30, measured radially (24-gon tolerance)",
    !!ps[0] && near(ps[0]!.protrusionMm, 30, 1),
    String(ps[0]?.protrusionMm),
  );
}

if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("ok   leafclash.test.ts");
