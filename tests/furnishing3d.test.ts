// Fit-out solids: the prisms each furnishing form contributes to the 3D scene,
// where they stand, and that the scene mesh carries them at their storey's
// elevation.
import {
  Furnishing, FurnishingForm, FURNISHING_FORMS, FURNISHING_PRESETS, furnishingDefaults,
  furnishingOverhead,
} from "../src/model/furnishing";
import { furnishingSolids, furnishingZ0, FurnishingPart, OVERHEAD_Z0_MM } from "../src/core/furnishing3d";
import { furnishingBox, WORKTOP_OVERHANG } from "../src/core/furnishing";
import { localPoint } from "../src/core/placed";
import { buildSceneMesh, CASEWORK_COLOR, WORKTOP_COLOR, SANITARY_COLOR } from "../src/render3d/mesh";
import { polygonArea, v } from "../src/geometry/vec";
import { emptyDoc, newId, floorElevation, type Floor, type PlanDoc } from "../src/model/doc";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }
function nearRel(a: number, b: number, rel = 1e-6): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * rel);
}

const mk = (form: FurnishingForm, over: Partial<Furnishing> = {}): Furnishing => {
  const d = furnishingDefaults(form);
  return {
    id: newId("fit"), form, x: 0, y: 0, rotation: 0,
    width: d.width, depth: d.depth, height: d.height, ...over,
  };
};

/** Footprint area net of the rings cut out of it, mm². */
const netArea = (p: FurnishingPart): number =>
  Math.abs(polygonArea(p.poly)) - (p.holes ?? []).reduce((s, h) => s + Math.abs(polygonArea(h)), 0);

/** The overall z-band a piece's parts occupy. */
const extentOf = (f: Furnishing): { z0: number; z1: number } => {
  const parts = furnishingSolids(f);
  return {
    z0: Math.min(...parts.map(p => p.z0)),
    z1: Math.max(...parts.map(p => p.z1)),
  };
};

const volumeOfParts = (parts: FurnishingPart[]): number =>
  parts.reduce((s, p) => s + netArea(p) * (p.z1 - p.z0), 0);

// ── every form yields a body ────────────────────────────────────────────────

for (const form of FURNISHING_FORMS) {
  const f = mk(form);
  const parts = furnishingSolids(f);
  check(`${form} yields at least one prism`, parts.length > 0);
  check(`${form} prisms have real footprints and bands`,
    parts.every(p => p.poly.length >= 3 && Math.abs(polygonArea(p.poly)) > 1 && p.z1 > p.z0));
  check(`${form} stands on or above the floor`, parts.every(p => p.z0 >= -1e-9));
  check(`${form} holes are real rings inside their part`,
    parts.every(p => (p.holes ?? []).every(h => h.length >= 3
      && Math.abs(polygonArea(h)) > 1
      && Math.abs(polygonArea(h)) < Math.abs(polygonArea(p.poly)))));
}

// Every preset the palette offers is placeable, so every preset has a body.
for (const p of FURNISHING_PRESETS) {
  const f = mk(p.form, { width: p.width, depth: p.depth, height: p.height, kind: p.kind,
    front: p.front, corner: p.corner, worktop: p.worktop, mark: p.mark, cistern: p.cistern,
    rails: p.rails, basins: p.basins, tray: p.tray });
  check(`preset ${p.id} yields a body`, furnishingSolids(f).length > 0);
}

// ── the plan footprint bounds the body ──────────────────────────────────────
//
// A part may not wander outside the footprint the plan draws, save for the
// blad's stated oversail. Checked in the piece's own frame, so it covers the
// rotated and mirrored cases too.
for (const form of FURNISHING_FORMS) {
  for (const over of [{}, { rotation: 0.7, x: 1234, y: -567 }, { rotation: -2.1, mirrored: true }]) {
    const f = mk(form, { worktop: form === "cabinet", ...over });
    const b = furnishingBox(f);
    const slack = form === "cabinet" ? WORKTOP_OVERHANG + 1e-6 : 1e-6;
    const inside = furnishingSolids(f).every(p => [p.poly, ...(p.holes ?? [])].every(ring =>
      ring.every(q => {
        const l = localPoint(f, q);
        return l.x >= b.x0 - slack && l.x <= b.x1 + slack
          && l.y >= b.y0 - slack && l.y <= b.y1 + slack;
      })));
    check(`${form} stays inside its footprint (${JSON.stringify(over)})`, inside);
  }
}

// A placed piece is its own body moved: turning and mirroring go through
// worldPoint(), so the parts are congruent to the unplaced ones.
{
  const at = { x: 4000, y: -2500, rotation: 1.1, mirrored: true };
  const flat = mk("bath");
  const placed = mk("bath", at);
  const a = furnishingSolids(flat), z = furnishingSolids(placed);
  check("placing a furnishing keeps its part count", a.length === z.length);
  check("placing a furnishing keeps every footprint area",
    a.every((p, i) => nearRel(Math.abs(polygonArea(p.poly)), Math.abs(polygonArea(z[i]!.poly)))));
  check("placing a furnishing keeps every z-band",
    a.every((p, i) => near(p.z0, z[i]!.z0, 1e-6) && near(p.z1, z[i]!.z1, 1e-6)));
}

// ── where a piece starts ────────────────────────────────────────────────────

for (const form of FURNISHING_FORMS) {
  const f = mk(form);
  check(`${form} starts on the floor unless it hangs`,
    furnishingZ0(f) === (furnishingOverhead(f) ? OVERHEAD_Z0_MM : 0));
}

{
  const wall = mk("cabinet", { kind: "wall", height: 700, depth: 350 });
  const hood = mk("appliance", { mark: "hood", height: 850, depth: 500 });
  check("a wall cabinet hangs at OVERHEAD_Z0_MM",
    furnishingZ0(wall) === OVERHEAD_Z0_MM && furnishingSolids(wall).every(p => p.z0 >= OVERHEAD_Z0_MM));
  check("an afzuigkap hangs at the same height",
    furnishingSolids(hood).every(p => p.z0 >= OVERHEAD_Z0_MM));
  const e = extentOf(wall);
  check("a wall cabinet's carcass reaches its own height above the hang",
    near(e.z0, OVERHEAD_Z0_MM) && near(e.z1, OVERHEAD_Z0_MM + 700), JSON.stringify(e));
  check("a wall unit carries no plinth",
    furnishingSolids(wall).every(p => p.z0 >= OVERHEAD_Z0_MM - 1e-9));
}

// ── the cabinet stack: plinth, carcass, front, blad ─────────────────────────
{
  const base = mk("cabinet", { kind: "base", width: 600, depth: 600, height: 720, worktop: true });
  const parts = furnishingSolids(base);
  const e = extentOf(base);
  check("a base unit stands on its plinth and carries its blad",
    near(e.z0, 0) && near(e.z1, 150 + 720 + 40), JSON.stringify(e));
  const plinth = parts.find(p => p.z0 === 0)!;
  const carcass = parts.find(p => near(p.z0, 150) && p.material === "casework")!;
  check("the plinth is set back from the carcass",
    Math.abs(polygonArea(plinth.poly)) < Math.abs(polygonArea(carcass.poly)),
    `${Math.abs(polygonArea(plinth.poly))} vs ${Math.abs(polygonArea(carcass.poly))}`);
  const blad = parts.filter(p => p.material === "worktop");
  check("exactly one blad, over the carcass", blad.length === 1 && near(blad[0]!.z0, 870));
  check("the blad oversails the carcass",
    Math.abs(polygonArea(blad[0]!.poly)) > Math.abs(polygonArea(carcass.poly)));
  check("the blad's oversail is the plan's overhang",
    near(Math.abs(polygonArea(blad[0]!.poly)) - Math.abs(polygonArea(carcass.poly)),
      600 * (WORKTOP_OVERHANG + 20)), String(Math.abs(polygonArea(blad[0]!.poly))));

  const drawers = furnishingSolids(
    mk("cabinet", { kind: "base", front: "drawers", drawers: 4, worktop: true }));
  const doors = furnishingSolids(mk("cabinet", { kind: "base", front: "door", worktop: true }));
  const open = furnishingSolids(mk("cabinet", { kind: "base", front: "open", worktop: true }));
  check("a bank of drawers is one panel per drawer", drawers.length === doors.length + 3,
    `${drawers.length} vs ${doors.length}`);
  // What stands in the recess left in front of the carcass: a leaf over the
  // whole opening on a closed unit, a plate per shelf on an open one.
  const inRecess = (ps: FurnishingPart[]): FurnishingPart[] =>
    ps.filter(p => p.material === "casework" && Math.abs(polygonArea(p.poly)) < 0.2 * 600 * 580);
  check("a door fills the recess in front of the carcass",
    inRecess(doors).length === 1 && inRecess(doors)[0]!.z1 - inRecess(doors)[0]!.z0 > 700,
    JSON.stringify(inRecess(doors).map(p => p.z1 - p.z0)));
  check("an open unit shows shelf plates instead",
    inRecess(open).length >= 1 && inRecess(open).every(p => p.z1 - p.z0 < 100),
    JSON.stringify(inRecess(open).map(p => p.z1 - p.z0)));
  const dbl = furnishingSolids(mk("cabinet", { kind: "base", front: "double", worktop: true }));
  check("a pair of doors is two panels", dbl.length === doors.length + 1);

  const corner = mk("cabinet", { kind: "base", corner: true, width: 900, depth: 900, worktop: true });
  const cp = furnishingSolids(corner);
  check("a corner unit's carcass is the pentagon the plan draws",
    cp.some(p => p.material === "casework" && p.poly.length === 5));
}

// ── fixtures are hollow where the plan draws them hollow ────────────────────
{
  const bath = mk("bath", { width: 1700, depth: 750, height: 600 });
  const parts = furnishingSolids(bath);
  const rim = parts.find(p => (p.holes ?? []).length > 0);
  check("a bath's rim is cut by its tub", rim !== undefined);
  check("the tub is open above its floor",
    volumeOfParts(parts) < 1700 * 750 * 600,
    `${volumeOfParts(parts)} vs ${1700 * 750 * 600}`);

  const counter = mk("counter", { width: 1200, depth: 600, height: 910, basins: 2 });
  const cparts = furnishingSolids(counter);
  const deck = cparts.find(p => p.material === "worktop")!;
  check("both bowls are sunk through the blad", (deck.holes ?? []).length === 2);
  check("each bowl has a floor below the blad",
    cparts.filter(p => p.material === "sanitary").length === 2
      && cparts.filter(p => p.material === "sanitary").every(p => p.z1 < deck.z0));

  const basin = mk("basin", { width: 1200, depth: 450, height: 850, basins: 2 });
  check("a wastafel hangs its top at its stated height",
    near(extentOf(basin).z1, 850));
  const shower = mk("shower", { tray: "tray", width: 900, depth: 900, height: 100 });
  check("a douchebak is a rim around a sunk floor",
    furnishingSolids(shower).some(p => (p.holes ?? []).length === 1));
}

// ── the scene mesh carries the fit-out ──────────────────────────────────────

/** Signed volume of the triangle soup by the divergence theorem, mm³,
 *  restricted to triangles of one colour. */
function meshVolume(m: ReturnType<typeof buildSceneMesh>, rgb: readonly [number, number, number]): number {
  let s = 0;
  const P = m.positions, C = m.colors;
  for (let i = 0; i + 8 < P.length; i += 9) {
    if (Math.abs(C[i]! - rgb[0]) > 1e-3 || Math.abs(C[i + 1]! - rgb[1]) > 1e-3
      || Math.abs(C[i + 2]! - rgb[2]) > 1e-3) continue;
    const ax = P[i]!, ay = P[i + 1]!, az = P[i + 2]!;
    const bx = P[i + 3]!, by = P[i + 4]!, bz = P[i + 5]!;
    const cx = P[i + 6]!, cy = P[i + 7]!, cz = P[i + 8]!;
    s += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return s;
}

/** A closed 4000x3000 rectangle of walls, so the storey has fabric to carry. */
function rectFloor(f: Floor): void {
  const pts = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 100, bulge: 0, openings: [] });
  }
}

{
  const doc: PlanDoc = emptyDoc();
  const ground = doc.floors[0]!;
  rectFloor(ground);
  const cabinet = mk("cabinet", { x: 1000, y: 200, kind: "base", worktop: true, rotation: 0.4 });
  const bath = mk("bath", { x: 3000, y: 2000 });
  ground.furnishings = [cabinet, bath];

  const mesh = buildSceneMesh(doc);
  const parts = [...furnishingSolids(cabinet), ...furnishingSolids(bath)];
  const expectCasework = volumeOfParts(parts.filter(p => p.material === "casework"));
  const expectWorktop = volumeOfParts(parts.filter(p => p.material === "worktop"));
  const expectSanitary = volumeOfParts(parts.filter(p => p.material === "sanitary"));
  check("the mesh carries the casework volume",
    nearRel(meshVolume(mesh, CASEWORK_COLOR), expectCasework, 1e-4),
    `${meshVolume(mesh, CASEWORK_COLOR)} vs ${expectCasework}`);
  check("the mesh carries the blad volume",
    nearRel(meshVolume(mesh, WORKTOP_COLOR), expectWorktop, 1e-4));
  check("the mesh carries the fixture volume, tub excluded",
    nearRel(meshVolume(mesh, SANITARY_COLOR), expectSanitary, 1e-4),
    `${meshVolume(mesh, SANITARY_COLOR)} vs ${expectSanitary}`);

  // A hidden storey withholds its fit-out with everything else on it.
  const hidden = buildSceneMesh(doc, new Set([ground.id]));
  check("a hidden storey shows no fit-out", near(meshVolume(hidden, CASEWORK_COLOR), 0, 1e-3));

  // On an upper storey the same piece rides at that storey's elevation.
  const upper: Floor = { id: newId("f"), name: "1e", nodes: [], walls: [], symbols: [],
    furnishings: [mk("cabinet", { x: 1000, y: 1000, kind: "base", worktop: true })] };
  rectFloor(upper);
  doc.floors.push(upper);
  const two = buildSceneMesh(doc);
  const elev = floorElevation(doc, 1);
  check("an upper storey's fit-out is lifted to its elevation", elev > 0
    && nearRel(meshVolume(two, CASEWORK_COLOR),
      meshVolume(mesh, CASEWORK_COLOR)
        + volumeOfParts(furnishingSolids(upper.furnishings![0]!).filter(p => p.material === "casework")),
      1e-4));
  const zTop = Math.max(...Array.from({ length: two.positions.length / 3 },
    (_, i) => two.positions[i * 3 + 2]!));
  check("the upper storey's body reaches above the ground storey's", zTop > elev);
}

console.log(failures === 0 ? "ALL FURNISHING3D TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
