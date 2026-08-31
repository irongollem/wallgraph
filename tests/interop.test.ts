// Interop tests: BIM 9. tests/ifc.test.ts checks that toIfc() produces
// well-formed STEP text by pattern-matching the string; this file checks that
// a real IFC engine (web-ifc, the wasm parser Autodesk/ThatOpen viewers are
// built on) agrees the file is a valid, internally consistent IFC4 model, and
// pins a golden fixture so an emitter change shows up as a visible diff.
//
// web-ifc ships an ESM build and a Node (CJS) build; `import "web-ifc"` under
// this project's ESM tsconfig resolves the browser build, which expects a
// browser wasm-fetch path and does not run under plain Node. The Node build
// (web-ifc-api-node.js, loading its .wasm from disk, no network) is reached
// via createRequire() instead — see the `webifc` import below. Types come
// from a type-only import so this stays typechecked without pulling in the
// browser runtime.
//
// Run `npx tsx tests/interop.test.ts --update` to (re)write
// tests/fixtures/plan.ifc from the current emitter after a deliberate change;
// review the diff before committing the new fixture.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type * as WebIFC from "web-ifc";
import {
  type PlanDoc, type Floor, type Wall, type Opening, type SymbolInstance,
  floorElevation, wallHeight, fireLabel, stairsOf, cabinetsOf, videsOf,
} from "../src/model/doc";
import { wallLength } from "../src/model/ops";
import type { Vide } from "../src/model/vide";
import type { Stair } from "../src/model/stair";
import type { Cabinet } from "../src/model/cabinet";
import { toIfc } from "../src/io/ifc";
import { ifcGuid } from "../src/model/guid";
import { detectRooms } from "../src/core/rooms";
import { bulgeFromSagitta } from "../src/geometry/arc";
import { v } from "../src/geometry/vec";

const require = createRequire(import.meta.url);
const webifc = require("web-ifc") as typeof WebIFC;

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

// ── the document: fixed ids and guid throughout, no newId() ────────────────
//
// Every element the brief asks for, on a document whose ids and guid are
// literal strings rather than newId()/newDocGuid() output, so two runs of
// this file — and the committed fixture — are byte-identical under a fixed
// clock. Layout: an 8x3 m ground floor split by a partition into two 4x3
// rooms (one named, one not), one outer wall bulged; a fire-rated
// self-closing door, a two-sash window and a passage; a vide, a stair, a
// base and a wall cabinet, and one symbol per registry category (plus two
// type-id overrides) in the unnamed room. A plain closed rectangle upper
// floor gives floorElevation() a second storey to report.
const SEED = "0123456789abcdef0123456789abcdef";
const CLOCK = Date.UTC(2026, 0, 1);

function buildDoc(): PlanDoc {
  const groundNodes = [
    { id: "gf-n0", x: 0, y: 0 },
    { id: "gf-n4", x: 4000, y: 0 },
    { id: "gf-n1", x: 8000, y: 0 },
    { id: "gf-n3", x: 0, y: 3000 },
    { id: "gf-n5", x: 4000, y: 3000 },
    { id: "gf-n2", x: 8000, y: 3000 },
  ];

  const door: Opening = {
    id: "gf-o-door", kind: "door", t: 1200, width: 900,
    sashes: [{ action: "turn", hinge: "b" }],
    fireRating: { kind: "wbdbo", minutes: 60 }, selfClosing: true,
  };
  const window: Opening = {
    id: "gf-o-window", kind: "window", t: 1500, width: 1200,
    sashes: [{ action: "fixed" }, { action: "turn", hinge: "a" }],
  };
  const passage: Opening = { id: "gf-o-passage", kind: "passage", t: 1500, width: 900, sashes: [] };

  const groundWalls: Wall[] = [
    {
      id: "gf-w1", a: "gf-n0", b: "gf-n4", thickness: 300, bulge: 0, openings: [door],
      loadBearing: true, fireRating: { kind: "wbdbo", minutes: 60 },
    },
    { id: "gf-w2", a: "gf-n4", b: "gf-n1", thickness: 300, bulge: 0, openings: [] },
    { id: "gf-w3", a: "gf-n1", b: "gf-n2", thickness: 300, bulge: 0, openings: [window] },
    { id: "gf-w4", a: "gf-n2", b: "gf-n5", thickness: 300, bulge: 0, openings: [] },
    // Bulged, same chord order as tests/ifc.test.ts's BIM4 block: endpoints
    // unmoved, bulge alone bows the wall.
    { id: "gf-w5", a: "gf-n5", b: "gf-n3", thickness: 300, bulge: bulgeFromSagitta(v(4000, 3000), v(0, 3000), 400), openings: [] },
    { id: "gf-w6", a: "gf-n3", b: "gf-n0", thickness: 300, bulge: 0, openings: [] },
    { id: "gf-w7", a: "gf-n4", b: "gf-n5", thickness: 150, bulge: 0, openings: [passage] }, // partition
  ];

  const vide: Vide = { id: "gf-vide1", x: 6000, y: 1500, rotation: 0, width: 1200, depth: 1200 };
  const stair: Stair = {
    id: "gf-stair1", kind: "steektrap", x: 2000, y: 300, rotation: 0,
    width: 900, going: 220, treads: 15, rise: 2800,
  };
  const cabinets: Cabinet[] = [
    { id: "gf-cab-base", kind: "base", x: 7500, y: 2700, rotation: 0, width: 600, depth: 600, front: "door" },
    { id: "gf-cab-wall", kind: "wall", x: 7500, y: 300, rotation: 0, width: 600, depth: 350, front: "door", label: "Bovenkast" },
  ];

  // One symbol per registry category, plus two TYPE_OVERRIDES entries
  // (light-point, smoke-detector) so the class mapping's override path is
  // exercised too, not just its per-category default.
  const symbols: SymbolInstance[] = [
    { id: "gf-sym-elec", type: "light-point", x: 1000, y: 1000, rotation: 0 },
    { id: "gf-sym-water", type: "water-point", x: 1200, y: 1000, rotation: 0 },
    { id: "gf-sym-sanitary", type: "toilet", x: 1400, y: 1000, rotation: 0 },
    { id: "gf-sym-heating", type: "radiator", x: 1600, y: 1000, rotation: 0 },
    { id: "gf-sym-vent", type: "vent-supply", x: 1800, y: 1000, rotation: 0 },
    { id: "gf-sym-safety", type: "smoke-detector", x: 2000, y: 1000, rotation: 0 },
    { id: "gf-sym-kitchen", type: "fridge", x: 2200, y: 1000, rotation: 0 },
    { id: "gf-sym-furniture", type: "sofa", x: 2400, y: 1000, rotation: 0 },
  ];

  const ground: Floor = {
    id: "floor-gf", name: "Begane grond", height: 2600,
    nodes: groundNodes, walls: groundWalls, symbols,
    stairs: [stair], vides: [vide], cabinets,
    roomNames: [{ id: "gf-rn1", x: 2000, y: 1500, name: "Woonkamer" }], // inside the left room only
  };

  const upper: Floor = {
    id: "floor-vp", name: "Verdieping", height: 2500,
    nodes: [
      { id: "vp-n0", x: 0, y: 0 }, { id: "vp-n1", x: 4000, y: 0 },
      { id: "vp-n2", x: 4000, y: 3000 }, { id: "vp-n3", x: 0, y: 3000 },
    ],
    walls: [
      { id: "vp-w1", a: "vp-n0", b: "vp-n1", thickness: 300, bulge: 0, openings: [] },
      { id: "vp-w2", a: "vp-n1", b: "vp-n2", thickness: 300, bulge: 0, openings: [] },
      { id: "vp-w3", a: "vp-n2", b: "vp-n3", thickness: 300, bulge: 0, openings: [] },
      { id: "vp-w4", a: "vp-n3", b: "vp-n0", thickness: 300, bulge: 0, openings: [] },
    ],
    symbols: [], stairs: [], vides: [], cabinets: [], roomNames: [],
  };

  return {
    version: 1, unit: "mm", gridMm: 100, guid: SEED, groundMm: 300,
    project: { name: "Interop fixture", author: "wallgraph interop test" },
    floors: [ground, upper],
  };
}

const doc = buildDoc();
const text = toIfc(doc, CLOCK);

// ── determinism: same document, same clock, byte-identical, twice over ─────
check("two exports under one clock are byte-identical", toIfc(doc, CLOCK) === text);

// ── golden fixture ──────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const fixturePath = path.join(fixturesDir, "plan.ifc");
const updating = process.argv.slice(2).includes("--update");

if (updating) {
  if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(fixturePath, text);
  console.log(`updated fixture ${fixturePath}`);
} else if (!existsSync(fixturePath)) {
  check("fixture exists (run with --update to create it)", false, fixturePath);
} else {
  const golden = readFileSync(fixturePath, "utf8");
  if (golden === text) {
    check("export matches the committed golden fixture byte-for-byte", true);
  } else {
    const goldenLines = golden.split("\n");
    const textLines = text.split("\n");
    let firstDiff = 0;
    while (firstDiff < goldenLines.length && firstDiff < textLines.length
      && goldenLines[firstDiff] === textLines[firstDiff]) firstDiff++;
    check("export matches the committed golden fixture byte-for-byte", false,
      `first differing line ${firstDiff}: fixture=${JSON.stringify(goldenLines[firstDiff])} `
      + `actual=${JSON.stringify(textLines[firstDiff])}`);
  }
}

// ── web-ifc round-trip ──────────────────────────────────────────────────────

async function roundTrip(): Promise<void> {
  const api = new webifc.IfcAPI();
  await api.Init();

  let modelID = -1;
  let openError: unknown;
  try {
    modelID = api.OpenModel(new TextEncoder().encode(text));
  } catch (e) {
    openError = e;
  }
  check("web-ifc opens the export without throwing", openError === undefined, String(openError));
  check("web-ifc returns a valid model handle", modelID !== -1, String(modelID));
  check("web-ifc reports the model open", modelID !== -1 && api.IsModelOpen(modelID));
  // web-ifc 0.0.77's IfcAPI carries no GetAndClearErrors (or equivalent error
  // log) — checked directly against this version's .d.ts / JS bundle, not
  // assumed. OpenModel() throwing on malformed STEP (verified separately: a
  // hand-corrupted entity line throws out of OpenModel rather than returning
  // -1 or logging a warning) is this version's only parse-failure signal, so
  // "no errors" is stood in for by OpenModel not throwing plus IsModelOpen
  // being true, checked above.
  if (modelID === -1) { failures += 1; console.error("FAIL cannot continue: model failed to open"); return; }

  // ── per-type counts, computed from the document itself ───────────────────

  const allWalls = doc.floors.flatMap(f => f.walls);
  const allOpenings = allWalls.flatMap(w => w.openings);
  const doors = allOpenings.filter(o => o.kind === "door");
  const windows = allOpenings.filter(o => o.kind === "window");
  const allVides = doc.floors.flatMap(f => videsOf(f));
  const allStairs = doc.floors.flatMap(f => stairsOf(f));
  const allCabinets = doc.floors.flatMap(f => cabinetsOf(f));
  const totalRooms = doc.floors.reduce((n, f) => n + detectRooms(f).length, 0);
  // Both floors are closed rectangles, so floorSolids() returns a slab for
  // each — one IFCSLAB per floor.
  const expectedSlabs = doc.floors.length;
  // CATEGORY_DEFAULTS maps both "kitchen" and "furniture" to IFCFURNITURE
  // (see io/ifc.ts), so the fridge and sofa placed above land in the same
  // IFC class as the two cabinets — not a coincidence to hide, the actual
  // expected count.
  const expectedFurniture = allCabinets.length + 2; // + fridge, sofa

  const countOfType = (type: number): number => api.GetLineIDsWithType(modelID, type).size();

  check("IFCWALL count matches the document", countOfType(webifc.IFCWALL) === allWalls.length,
    String(countOfType(webifc.IFCWALL)));
  check("IFCBUILDINGSTOREY count matches the document", countOfType(webifc.IFCBUILDINGSTOREY) === doc.floors.length,
    String(countOfType(webifc.IFCBUILDINGSTOREY)));
  check("IFCSPACE count matches detected rooms", countOfType(webifc.IFCSPACE) === totalRooms,
    String(countOfType(webifc.IFCSPACE)));
  check("IFCDOOR count matches the document", countOfType(webifc.IFCDOOR) === doors.length,
    String(countOfType(webifc.IFCDOOR)));
  check("IFCWINDOW count matches the document", countOfType(webifc.IFCWINDOW) === windows.length,
    String(countOfType(webifc.IFCWINDOW)));
  check("IFCOPENINGELEMENT count matches openings + vides",
    countOfType(webifc.IFCOPENINGELEMENT) === allOpenings.length + allVides.length,
    String(countOfType(webifc.IFCOPENINGELEMENT)));
  check("IFCSLAB count matches the closed floors", countOfType(webifc.IFCSLAB) === expectedSlabs,
    String(countOfType(webifc.IFCSLAB)));
  check("IFCSTAIR count matches the document", countOfType(webifc.IFCSTAIR) === allStairs.length,
    String(countOfType(webifc.IFCSTAIR)));
  check("IFCSTAIRFLIGHT count matches the document (one flight per stair)",
    countOfType(webifc.IFCSTAIRFLIGHT) === allStairs.length, String(countOfType(webifc.IFCSTAIRFLIGHT)));
  check("IFCFURNITURE count matches cabinets + kitchen/furniture symbols",
    countOfType(webifc.IFCFURNITURE) === expectedFurniture, String(countOfType(webifc.IFCFURNITURE)));

  // ── relations resolve: every ref web-ifc itself can load via GetLine ─────

  const resolves = (expressID: number): boolean => {
    try {
      const line = api.GetLine(modelID, expressID);
      return !!line && line.expressID === expressID;
    } catch {
      return false;
    }
  };

  {
    const ids = api.GetLineIDsWithType(modelID, webifc.IFCRELVOIDSELEMENT);
    let ok = ids.size() > 0;
    for (let i = 0; i < ids.size(); i++) {
      const rel = api.GetLine(modelID, ids.get(i));
      ok = ok && resolves(rel.RelatingBuildingElement.value) && resolves(rel.RelatedOpeningElement.value);
    }
    check("every IFCRELVOIDSELEMENT's RelatingBuildingElement and RelatedOpeningElement resolve",
      ok, String(ids.size()));
  }
  {
    const ids = api.GetLineIDsWithType(modelID, webifc.IFCRELFILLSELEMENT);
    let ok = ids.size() === doors.length + windows.length;
    for (let i = 0; i < ids.size(); i++) {
      const rel = api.GetLine(modelID, ids.get(i));
      ok = ok && resolves(rel.RelatingOpeningElement.value) && resolves(rel.RelatedBuildingElement.value);
    }
    check("every IFCRELFILLSELEMENT's RelatingOpeningElement and RelatedBuildingElement resolve",
      ok, String(ids.size()));
  }
  {
    const ids = api.GetLineIDsWithType(modelID, webifc.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    let ok = ids.size() > 0;
    for (let i = 0; i < ids.size(); i++) {
      const rel = api.GetLine(modelID, ids.get(i));
      const related: Array<{ value: number }> = Array.isArray(rel.RelatedElements) ? rel.RelatedElements : [rel.RelatedElements];
      ok = ok && resolves(rel.RelatingStructure.value) && related.length > 0 && related.every(r => resolves(r.value));
    }
    check("every IFCRELCONTAINEDINSPATIALSTRUCTURE's members resolve", ok, String(ids.size()));
  }
  {
    const ids = api.GetLineIDsWithType(modelID, webifc.IFCRELAGGREGATES);
    let ok = ids.size() > 0;
    for (let i = 0; i < ids.size(); i++) {
      const rel = api.GetLine(modelID, ids.get(i));
      const related: Array<{ value: number }> = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [rel.RelatedObjects];
      ok = ok && resolves(rel.RelatingObject.value) && related.length > 0 && related.every(r => resolves(r.value));
    }
    check("every IFCRELAGGREGATES's RelatingObject and RelatedObjects resolve", ok, String(ids.size()));
  }

  // ── a wall's Qto figures and Pset FireRating read back exactly ───────────

  const doorWall = doc.floors[0]!.walls.find(w => w.id === "gf-w1")!;
  const wallGuid = ifcGuid(SEED, doorWall.id);
  const wallExpressId = api.GetExpressIdFromGuid(modelID, wallGuid);
  check("the fire-rated wall's GlobalId resolves to an expressID", wallExpressId !== undefined, String(wallExpressId));

  if (wallExpressId !== undefined) {
    const wallEid = Number(wallExpressId);
    const wallLine = api.GetLine(modelID, wallEid);
    check("the resolved line is really an IFCWALL", wallLine.type === webifc.IFCWALL, String(wallLine.type));

    const relDefines = api.GetLineIDsWithType(modelID, webifc.IFCRELDEFINESBYPROPERTIES);
    let qtoValues: Record<string, number> | undefined;
    let psetValues: Record<string, unknown> | undefined;
    for (let i = 0; i < relDefines.size(); i++) {
      const rel = api.GetLine(modelID, relDefines.get(i));
      const related: Array<{ value: number }> = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [rel.RelatedObjects];
      if (!related.some(r => r.value === wallEid)) continue;
      const defId = rel.RelatingPropertyDefinition.value as number;
      const def = api.GetLine(modelID, defId);
      if (def.type === webifc.IFCELEMENTQUANTITY && def.Name?.value === "Qto_WallBaseQuantities") {
        qtoValues = {};
        for (const qHandle of def.Quantities as Array<{ value: number }>) {
          const q = api.GetLine(modelID, qHandle.value);
          const name = q.Name?.value as string;
          const val = (q.LengthValue ?? q.VolumeValue ?? q.AreaValue)?.value as number;
          qtoValues[name] = val;
        }
      } else if (def.type === webifc.IFCPROPERTYSET && def.Name?.value === "Pset_WallCommon") {
        psetValues = {};
        for (const pHandle of def.HasProperties as Array<{ value: number }>) {
          const p = api.GetLine(modelID, pHandle.value);
          psetValues[p.Name?.value as string] = p.NominalValue?.value;
        }
      }
    }

    const expectedLength = wallLength(doc.floors[0]!, doorWall);
    const expectedHeight = wallHeight(doc.floors[0]!, doorWall);
    check("Qto_WallBaseQuantities was found on the wall", qtoValues !== undefined);
    if (qtoValues) {
      check("Qto_WallBaseQuantities.Length reads back numerically", qtoValues.Length === expectedLength,
        `${qtoValues.Length} vs ${expectedLength}`);
      check("Qto_WallBaseQuantities.Width reads back numerically", qtoValues.Width === doorWall.thickness,
        `${qtoValues.Width} vs ${doorWall.thickness}`);
      check("Qto_WallBaseQuantities.Height reads back numerically", qtoValues.Height === expectedHeight,
        `${qtoValues.Height} vs ${expectedHeight}`);
    }

    check("Pset_WallCommon was found on the wall", psetValues !== undefined);
    if (psetValues) {
      const expectedFireLabel = fireLabel(doorWall.fireRating!);
      check("Pset_WallCommon.FireRating reads back the exact fireLabel text",
        psetValues.FireRating === expectedFireLabel, `${JSON.stringify(psetValues.FireRating)} vs ${expectedFireLabel}`);
    }
  }

  // ── storey elevations read back matching floorElevation() ────────────────

  {
    let ok = true;
    for (let i = 0; i < doc.floors.length; i++) {
      const floor = doc.floors[i]!;
      const guid = ifcGuid(SEED, floor.id);
      const eid = api.GetExpressIdFromGuid(modelID, guid);
      if (eid === undefined) { ok = false; continue; }
      const line = api.GetLine(modelID, Number(eid));
      const expected = floorElevation(doc, i);
      if (line.type !== webifc.IFCBUILDINGSTOREY || line.Elevation?.value !== expected) ok = false;
    }
    check("every storey's Elevation matches floorElevation()", ok);
  }

  api.CloseModel(modelID);
}

await roundTrip();

console.log(failures === 0 ? "ALL INTEROP TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
