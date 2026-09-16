// Roof planes: underside, sloped area, suggestion, wall mismatches,
// profileFromRoof, headroom, the energy roof area and storey clashes. Run with tsx.
import { emptyDoc, newId, type Wall, type Floor, type PlanDoc, floorHeight } from "../src/model/doc";
import type { RoofPlane } from "../src/model/roof";
import { ROOF_THICKNESS_DEFAULT_MM } from "../src/model/roof";
import {
  roofUndersideAt, planeUndersideAt, roofPlaneArea, roofWallMismatches, profileFromRoof, roofStoreyClashes,
} from "../src/core/roof";
import { clampRoofPlane } from "../src/model/roof";
import { stairRoofClearanceMm } from "../src/core/headroom";
import { stairDefaults, type Stair } from "../src/model/stair";
import { stairSteps } from "../src/core/stair3d";
import { suggestRoof, flatRoof, gableRoof } from "../src/core/roofsuggest";
import { roomLowHeadroom, HEADROOM_MIN_MM } from "../src/core/headroom";
import { wallLength } from "../src/model/ops";
import { envelopeTakeoff } from "../src/core/energy";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }
/** Shoelace area of a plan outline: positive is counter-clockwise under y-down. */
function polygonAreaOf(poly: readonly { x: number; y: number }[]): number {
  let acc = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    acc += a.x * b.y - b.x * a.y;
  }
  return acc / 2;
}

const rectOutline = (w: number, d: number) => [v(0, 0), v(w, 0), v(w, d), v(0, d)];

/** A closed rectangular wall loop on `f`, `w` x `d` mm, offset by (ox, oy) --
 *  for outerBoundary() to have a covered area to clip a plane against. */
function rectWalls(f: Floor, w: number, d: number, ox = 0, oy = 0): void {
  const ids = [0, 1, 2, 3].map(() => newId("n"));
  const pts = [v(ox, oy), v(ox + w, oy), v(ox + w, oy + d), v(ox, oy + d)];
  for (let i = 0; i < 4; i++) f.nodes.push({ id: ids[i]!, x: pts[i]!.x, y: pts[i]!.y });
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 150, bulge: 0, openings: [] });
  }
}

// --- underside on a 45° plane ---
{
  const plane: RoofPlane = { id: "p1", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 600, pitchDeg: 45 };
  const h1000 = planeUndersideAt(plane, v(2000, 1000));
  check("45° underside at 1000mm into the outline", near(h1000, 600 + 1000, 0.5), String(h1000));

  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.roofPlanes = [plane];
  const u = roofUndersideAt(f, v(2000, 1000));
  check("roofUndersideAt matches the single plane", u !== null && near(u, 1600, 0.5), String(u));
  check("roofUndersideAt is null outside the outline", roofUndersideAt(f, v(2000, 5000)) === null);
}

// --- lowest of overlapping planes at a ridge ---
{
  const outline = rectOutline(4000, 3000);
  const a: RoofPlane = { id: "pa", outline, eaveEdge: 0, eaveMm: 600, pitchDeg: 45 }; // eave at y=0, rises with y
  const b: RoofPlane = { id: "pb", outline, eaveEdge: 2, eaveMm: 600, pitchDeg: 45 }; // eave at y=3000, rises the other way
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.roofPlanes = [a, b];
  const p = v(2000, 1000);
  const ha = planeUndersideAt(a, p), hb = planeUndersideAt(b, p);
  const u = roofUndersideAt(f, p)!;
  check("ridge: a real disagreement between the two planes", !near(ha, hb, 5), `${ha} vs ${hb}`);
  check("ridge: roofUndersideAt takes the lower of the two", near(u, Math.min(ha, hb), 0.5), `${u} vs min(${ha},${hb})`);
}

// --- sloped area ---
{
  const plane: RoofPlane = { id: "p1", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 600, pitchDeg: 45 };
  const planMm2 = 4000 * 3000;
  const expected = planMm2 / Math.cos((45 * Math.PI) / 180);
  check("sloped area = plan area / cos(pitch)", near(roofPlaneArea(plane), expected, 1), String(roofPlaneArea(plane)));
}

// --- a rectangular house with two gable end walls ---
function gableHouse(peakOffsetMm: number): { doc: PlanDoc; w1: Wall; w3: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push(
    { id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 },
    { id: "n3", x: 4000, y: 6000 }, { id: "n4", x: 0, y: 6000 },
  );
  const h = floorHeight(f);
  const w1: Wall = {
    id: "w1", a: "n1", b: "n2", thickness: 150, bulge: 0, openings: [],
    profile: [{ t: 2000, height: h + peakOffsetMm }],
  };
  const w2: Wall = { id: "w2", a: "n2", b: "n3", thickness: 150, bulge: 0, openings: [] };
  const w3: Wall = {
    id: "w3", a: "n3", b: "n4", thickness: 150, bulge: 0, openings: [],
    profile: [{ t: 2000, height: h + peakOffsetMm }],
  };
  const w4: Wall = { id: "w4", a: "n4", b: "n1", thickness: 150, bulge: 0, openings: [] };
  f.walls.push(w1, w2, w3, w4);
  return { doc, w1, w3 };
}

// --- suggestion from two gable walls ---
{
  const { doc, w1 } = gableHouse(1000);
  const f = doc.floors[0]!;
  const h = floorHeight(f);
  const suggestion = suggestRoof(f);
  check("gable suggestion: basis", suggestion.basis === "gable", suggestion.basis);
  check("gable suggestion: two planes", suggestion.planes.length === 2, String(suggestion.planes.length));
  for (const plane of suggestion.planes) {
    check("gable suggestion: eave at the wall's own base height", near(plane.eaveMm, h, 1), String(plane.eaveMm));
    const expectedPitch = (Math.atan2(1000, 2000) * 180) / Math.PI; // peak 1000 above eave, 2000mm run
    check("gable suggestion: pitch from peak height and eave-to-ridge run",
      near(plane.pitchDeg, expectedPitch, 1), `${plane.pitchDeg} vs ${expectedPitch}`);
  }
  void w1;
}

// --- suggestion with no sloped walls: one flat plane at storey height ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 }, { id: "n3", x: 4000, y: 3000 }, { id: "n4", x: 0, y: 3000 });
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: `w${i}`, a: `n${(i % 4) + 1}`, b: `n${((i + 1) % 4) + 1}`, thickness: 100, bulge: 0, openings: [] });
  }
  const suggestion = suggestRoof(f);
  check("flat suggestion: basis", suggestion.basis === "flat", suggestion.basis);
  check("flat suggestion: one plane", suggestion.planes.length === 1, String(suggestion.planes.length));
  check("flat suggestion: no pitch", suggestion.planes[0]!.pitchDeg === 0);
  check("flat suggestion: eave at storey height", suggestion.planes[0]!.eaveMm === floorHeight(f));

  const preset = flatRoof(f);
  check("flatRoof() preset agrees", preset.length === 1 && preset[0]!.pitchDeg === 0);
  const gpreset = gableRoof(f, 40);
  check("gableRoof() preset: two planes at the stated pitch",
    gpreset.length === 2 && gpreset.every(p => p.pitchDeg === 40));
}

// --- wall / roof mismatch ---
{
  const { doc, w1 } = gableHouse(1000);
  const f = doc.floors[0]!;
  const suggestion = suggestRoof(f);
  check("mismatch setup: gable suggestion succeeded", suggestion.basis === "gable");
  f.roofPlanes = suggestion.planes;

  const clean = roofWallMismatches(f).filter(m => m.wallId === "w1" || m.wallId === "w3");
  check("matching gable: no mismatch reported", clean.length === 0, JSON.stringify(clean));

  // Lower the gable wall's own peak by 300mm below what the roof states there.
  w1.profile = [{ t: 2000, height: (w1.profile![0]!.height) - 300 }];
  const mismatches = roofWallMismatches(f);
  const forW1 = mismatches.find(m => m.wallId === "w1");
  check("300mm-low gable: a mismatch is reported", forW1 !== undefined, JSON.stringify(mismatches));
  if (forW1) check("300mm-low gable: gap is about 300mm", near(forW1.gapMm, 300, 5), String(forW1.gapMm));
}

// --- profileFromRoof reproduces a gable's peak ---
{
  const { doc, w1 } = gableHouse(1000);
  const f = doc.floors[0]!;
  const suggestion = suggestRoof(f);
  f.roofPlanes = suggestion.planes;
  const h = floorHeight(f);

  const pts = profileFromRoof(f, w1);
  check("profileFromRoof: not null under a roof", pts !== null);
  if (pts) {
    const peak = pts.find(p => Math.abs(p.t - 2000) <= 5);
    check("profileFromRoof: reproduces the peak", peak !== undefined && near(peak.height, h + 1000, 3),
      JSON.stringify(pts));
    const start = pts.find(p => p.t <= 5);
    check("profileFromRoof: reproduces the low end", start !== undefined && near(start.height, h, 3), JSON.stringify(pts));
  }
}

// --- headroom: a 4000-wide room under a 45° gable, eaves at 600 ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const planeA: RoofPlane = { id: "pa", outline: [v(0, 0), v(2000, 0), v(2000, 3000), v(0, 3000)], eaveEdge: 3, eaveMm: 600, pitchDeg: 45 };
  const planeB: RoofPlane = { id: "pb", outline: [v(2000, 0), v(4000, 0), v(4000, 3000), v(2000, 3000)], eaveEdge: 1, eaveMm: 600, pitchDeg: 45 };
  f.roofPlanes = [planeA, planeB];
  const room = { netPoly: [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)] };
  const low = roomLowHeadroom(f, room);
  const expected = 2 * 900 * 3000; // two 900mm-wide strips, full 3000mm depth
  check("headroom: two 900mm strips", near(low, expected, 2000), `${low} vs ${expected}`);
  check("headroom: HEADROOM_MIN_MM is 1500", HEADROOM_MIN_MM === 1500);
}

// --- energy roof area for a 45° gable ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const planMm2 = 4000 * 3000;
  f.roofPlanes = [{ id: "p1", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 600, pitchDeg: 45 }];
  const takeoff = envelopeTakeoff(doc);
  const expected = planMm2 * Math.sqrt(2);
  check("energy roof area = plan area x sqrt(2)", near(takeoff.storeys[0]!.roofMm2, expected, 10),
    `${takeoff.storeys[0]!.roofMm2} vs ${expected}`);
}

// --- roofStoreyClashes: a 45° plane rising into the storey above ---
{
  const doc = emptyDoc();
  const ground = doc.floors[0]!;
  ground.height = 2600;
  rectWalls(ground, 4000, 3000);
  const plane: RoofPlane = { id: "clashPlane", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 2600, pitchDeg: 45 };
  ground.roofPlanes = [plane];

  const above: Floor = { id: newId("f"), name: "Verdieping 2", nodes: [], walls: [], symbols: [] };
  rectWalls(above, 4000, 3000);
  doc.floors.push(above);

  const clashes = roofStoreyClashes(doc, 0);
  check("45° plane under a full storey above reports a clash", clashes.length === 1, JSON.stringify(clashes));
  if (clashes.length === 1) {
    const c = clashes[0]!;
    check("the clash names the plane", c.planeId === "clashPlane", c.planeId);
    const cosPitch = Math.cos((45 * Math.PI) / 180);
    const vertical = ROOF_THICKNESS_DEFAULT_MM / cosPitch;
    const expectedTop = 2600 + 3000 * Math.tan((45 * Math.PI) / 180) + vertical; // far edge, y=3000
    const expectedOver = Math.round(expectedTop - 2600);
    check("overMm is the top at the highest covered vertex, above the storey's own height",
      near(c.overMm, expectedOver, 1), `${c.overMm} vs ${expectedOver}`);
    check("the highest point sits at the far (high) edge of the plane, y=3000",
      near(c.at.y, 3000, 1), JSON.stringify(c.at));
  }
}

// --- roofStoreyClashes: a flat roof finishing exactly at the floor above reports nothing ---
{
  const doc = emptyDoc();
  const ground = doc.floors[0]!;
  ground.height = 2600;
  rectWalls(ground, 4000, 3000);
  // eave chosen so eaveMm + roof build-up (vertical, pitch 0) lands exactly on the floor height.
  const eaveMm = 2600 - ROOF_THICKNESS_DEFAULT_MM;
  ground.roofPlanes = [{ id: "flatPlane", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm, pitchDeg: 0 }];

  const above: Floor = { id: newId("f"), name: "Verdieping 2", nodes: [], walls: [], symbols: [] };
  rectWalls(above, 4000, 3000);
  doc.floors.push(above);

  check("a flat roof finishing at storey height reports no clash", roofStoreyClashes(doc, 0).length === 0);
}

// --- roofStoreyClashes: set-back -- the storey above covers only part of the plan ---
{
  const doc = emptyDoc();
  const ground = doc.floors[0]!;
  ground.height = 2600;
  rectWalls(ground, 4000, 3000);
  ground.roofPlanes = [{ id: "setback", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 2600, pitchDeg: 45 }];

  // The storey above stands well clear of the plane's own footprint.
  const above: Floor = { id: newId("f"), name: "Verdieping 2", nodes: [], walls: [], symbols: [] };
  rectWalls(above, 4000, 3000, 10000, 0);
  doc.floors.push(above);

  check("a plane entirely outside the storey above's covered area reports no clash",
    roofStoreyClashes(doc, 0).length === 0);
}

// --- roofStoreyClashes: the top storey reports nothing (nothing stands on it) ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = 2600;
  rectWalls(f, 4000, 3000);
  f.roofPlanes = [{ id: "top", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 2600, pitchDeg: 45 }];

  check("the top storey reports no clash", roofStoreyClashes(doc, 0).length === 0);
}

// --- roofStoreyClashes: a storey above with no closed boundary reports nothing, not a guess ---
{
  const doc = emptyDoc();
  const ground = doc.floors[0]!;
  ground.height = 2600;
  rectWalls(ground, 4000, 3000);
  ground.roofPlanes = [{ id: "openAbove", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 2600, pitchDeg: 45 }];

  const above: Floor = { id: newId("f"), name: "Verdieping 2", nodes: [], walls: [], symbols: [] }; // no walls at all
  doc.floors.push(above);

  check("a storey above with no closed wall loop reports no clash",
    roofStoreyClashes(doc, 0).length === 0);
}

// --- mismatches: only a wall that pierces the roof, or states a top of its own ---
{
  // A plain 6000x4000 storey under the 45 deg gable preset: every wall is flat
  // at storey height, well below the ridge. That is the ordinary partition, not
  // a mismatch.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  rectWalls(f, 6000, 4000);
  f.roofPlanes = gableRoof(f, 45);
  check("gable preset: two planes", f.roofPlanes.length === 2, String(f.roofPlanes.length));
  check("flat walls wholly below the roof report no mismatch",
    roofWallMismatches(f).length === 0, JSON.stringify(roofWallMismatches(f)));

  // A wall whose own top pokes through the underside is reported even without
  // a profile: it cannot be built as drawn.
  const tall = f.walls.find(w => Math.round(wallLength(f, w)) === 6000)!;
  tall.profile = [{ t: 3000, height: 6000 }];
  const pierced = roofWallMismatches(f).find(m => m.wallId === tall.id);
  check("a wall poking through the roof underside is reported", pierced !== undefined,
    JSON.stringify(roofWallMismatches(f)));
  delete tall.profile;

  // BOTH gable-end walls of a symmetric roof report, not just one: their
  // centerlines lie exactly on the plane outlines, where a bare point-in-polygon
  // test answers by its ray-casting convention rather than by the geometry.
  const ends = f.walls.filter(w => Math.round(wallLength(f, w)) === 4000);
  check("the symmetric gable has two 4000 end walls", ends.length === 2, String(ends.length));
  for (const w of ends) {
    const pts = profileFromRoof(f, w);
    check("profileFromRoof reads a roof over each gable end", pts !== null, w.id);
    if (pts) w.profile = pts.map(pt => ({ t: pt.t, height: pt.height - 300 }));
  }
  const both = roofWallMismatches(f);
  for (const w of ends) {
    const m = both.find(x => x.wallId === w.id);
    check("both gable ends report their 300mm disagreement",
      m !== undefined && near(m.gapMm, 300, 5), `${w.id}: ${JSON.stringify(both)}`);
  }

  // Following the roof exactly clears both again.
  for (const w of ends) {
    const pts = profileFromRoof(f, w);
    if (pts) w.profile = pts;
  }
  check("a gable end that follows the roof reports nothing",
    roofWallMismatches(f).filter(m => ends.some(w => w.id === m.wallId)).length === 0,
    JSON.stringify(roofWallMismatches(f)));
}

// --- clampRoofPlane rewinds a clockwise outline and keeps the eave edge ---
{
  const ccw = rectOutline(4000, 3000);                 // positive area under y-down
  const cw = [...ccw].reverse();                       // the same rectangle, pasted clockwise
  // Edge 0 of the CCW outline runs (0,0)->(4000,0); pick the same edge in the
  // reversed array so the remap has something to be right about.
  const eaveEdgeCw = cw.length - 2 - 0;
  const plane: RoofPlane = { id: "rw", outline: cw, eaveEdge: eaveEdgeCw, eaveMm: 600, pitchDeg: 30 };
  clampRoofPlane(plane);
  check("a clockwise outline is rewound counter-clockwise",
    polygonAreaOf(plane.outline) > 0, String(polygonAreaOf(plane.outline)));
  const a = plane.outline[plane.eaveEdge]!, b = plane.outline[(plane.eaveEdge + 1) % plane.outline.length]!;
  check("the eave edge still names the same two corners",
    a.x === 0 && a.y === 0 && b.x === 4000 && b.y === 0, JSON.stringify([a, b]));
  // And it now reads the same way an authored plane does.
  const authored: RoofPlane = { id: "au", outline: ccw, eaveEdge: 0, eaveMm: 600, pitchDeg: 30 };
  const p = v(2000, 1500);
  check("a rewound plane states the same underside as the authored one",
    near(planeUndersideAt(plane, p), planeUndersideAt(authored, p), 0.5),
    `${planeUndersideAt(plane, p)} vs ${planeUndersideAt(authored, p)}`);
}

// --- headroom reads a stated ceiling as well as the roof ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const netPoly = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)];
  const full = 4000 * 3000;

  check("no planes and no ceiling: nothing is low", roomLowHeadroom(f, { netPoly }) === 0);
  check("a ceiling at 1400 makes the whole floor low",
    near(roomLowHeadroom(f, { netPoly, ceilingMm: 1400 }), full, 1),
    String(roomLowHeadroom(f, { netPoly, ceilingMm: 1400 })));
  check("a ceiling at 2400 lowers nothing on its own",
    roomLowHeadroom(f, { netPoly, ceilingMm: 2400 }) === 0);

  // With a roof over it, the stated ceiling is the lower figure everywhere.
  f.roofPlanes = [{ id: "pa", outline: rectOutline(4000, 3000), eaveEdge: 0, eaveMm: 600, pitchDeg: 45 }];
  const roofOnly = roomLowHeadroom(f, { netPoly });
  check("the roof alone leaves part of the floor low", roofOnly > 0 && roofOnly < full, String(roofOnly));
  check("a ceiling below 1500 makes the whole floor low whatever the roof does",
    near(roomLowHeadroom(f, { netPoly, ceilingMm: 1400 }), full, 1),
    String(roomLowHeadroom(f, { netPoly, ceilingMm: 1400 })));
  check("a ceiling above 1500 leaves the roof's own figure",
    near(roomLowHeadroom(f, { netPoly, ceilingMm: 2400 }), roofOnly, 1));
}

// --- a stair under a roof reports its clearance to it ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const stair: Stair = { id: "s1", kind: "steektrap", x: 0, y: 0, rotation: 0, ...stairDefaults("steektrap") };
  f.stairs = [stair];
  const topTread = Math.max(...stairSteps(f, stair).map(st => st.z1));

  check("no roof: no clearance to report", stairRoofClearanceMm(f, stair) === null);

  // One flat plane well clear of the whole plan: the tightest clearance is at
  // the highest tread, which is what STAIR_HEADROOM_MM measures against a slab.
  const wide = rectOutline(20000, 20000).map(p => ({ x: p.x - 10000, y: p.y - 10000 }));
  const flatAt = (eaveMm: number): number | null => {
    f.roofPlanes = [{ id: "flat", outline: wide, eaveEdge: 0, eaveMm, pitchDeg: 0 }];
    return stairRoofClearanceMm(f, stair);
  };
  const high = flatAt(4000);
  check("a plane over the flight reports a clearance to the highest tread",
    high !== null && near(high, 4000 - topTread, 1), `${high} vs ${4000 - topTread}`);
  const lower = flatAt(3000);
  check("lowering the plane by 1000 lowers the clearance by 1000",
    high !== null && lower !== null && near(high - lower, 1000, 1), `${high} vs ${lower}`);

  // Low enough and the roof's underside falls below the tread: a clash, stated
  // as a negative clearance rather than clamped away.
  const clash = flatAt(1000);
  check("a plane below the flight reports a negative clearance",
    clash !== null && clash < 0, String(clash));

  // A plane that does not reach the flight at all has nothing to say about it.
  f.roofPlanes = [{ id: "away", outline: rectOutline(3000, 3000).map(p => ({ x: p.x + 50000, y: p.y })), eaveEdge: 0, eaveMm: 3000, pitchDeg: 0 }];
  check("a plane the flight never comes under reports nothing",
    stairRoofClearanceMm(f, stair) === null);
}


console.log(failures === 0 ? "ALL ROOF TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
