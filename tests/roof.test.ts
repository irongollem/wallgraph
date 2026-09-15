// Roof planes: underside, sloped area, suggestion, wall mismatches,
// profileFromRoof, headroom and the energy roof area. Run with tsx.
import { emptyDoc, type Wall, type PlanDoc, floorHeight } from "../src/model/doc";
import type { RoofPlane } from "../src/model/roof";
import {
  roofUndersideAt, planeUndersideAt, roofPlaneArea, roofWallMismatches, profileFromRoof,
} from "../src/core/roof";
import { suggestRoof, flatRoof, gableRoof } from "../src/core/roofsuggest";
import { roomLowHeadroom, HEADROOM_MIN_MM } from "../src/core/headroom";
import { envelopeTakeoff } from "../src/core/energy";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

const rectOutline = (w: number, d: number) => [v(0, 0), v(w, 0), v(w, d), v(0, d)];

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

console.log(failures === 0 ? "ALL ROOF TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
