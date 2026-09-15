// BENG geometry takeoff: envelope area, orientation and an indicative
// transmission estimate. The facts under test are the ones a takeoff has to
// get right to be usable -- the clad face is the mitered length (not the
// centerline), an opening is deducted once from the one clad face, orientation
// follows the facade side and northDeg the way the spec derives it, a storey
// above narrower than the one below reports the difference as roof, and an
// unstated Rc/U is skipped and counted rather than assumed.
import {
  emptyDoc, newId, Wall, Opening, Floor, PlanDoc, openingHeight,
} from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { detectRooms, outwardSide, roomArea } from "../src/core/rooms";
import { v, type Vec } from "../src/geometry/vec";
import { arcLength } from "../src/geometry/arc";
import {
  INSULATION_CLASSES, GLAZING_TYPES, insulationClassOf, glazingTypeOf,
  applyInsulationClass, applyGlazingType, thermalValue, uFromRc,
  isEnvelopeWall, wallRcOf, openingIsGlazing, openingUOf,
  type EnergyAssumptions,
} from "../src/model/energy";
import {
  envelopeTakeoff, transmissionEstimate, orientationOf, ORIENTATIONS,
} from "../src/core/energy";
import { wallAreaUnder, wallTopAt } from "../src/model/profile";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

const W = 4000, D = 3000, TH = 300, FACADE = 100, H = 2800;

/**
 * A closed rectangle, one node per corner, walls in a->b order p0->p1->p2->p3.
 * Every wall states the same thickness and facade, outward = "right": for
 * this winding (clockwise under y-down) the room falls on each wall's
 * perp(direction) side, which rooms.ts calls "left" -- so "right" is uniformly
 * the outward face, and every corner's outer face runs the long way.
 */
function rectFloorEnv(x0: number, y0: number, x1: number, y1: number): Floor {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const pts = [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    f.walls.push({
      id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!,
      thickness: TH, bulge: 0, openings: [],
      facadeMm: FACADE, facadeSide: "right",
    } satisfies Wall);
  }
  return f;
}

function baseDoc(): {
  doc: PlanDoc; f: Floor; top: Wall; right: Wall; bottom: Wall; left: Wall;
  window: Opening; door: Opening;
} {
  const f = rectFloorEnv(0, 0, W, D);
  const doc = emptyDoc();
  doc.floors = [f];
  const top = f.walls[0]!, right = f.walls[1]!, bottom = f.walls[2]!, left = f.walls[3]!;
  const window = opening({ kind: "window", t: 2000, width: 1200, sillHeight: 900, height: 1415 });
  const door = opening({ kind: "door", t: 2000, width: 830, height: 2315 });
  top.openings.push(window);
  bottom.openings.push(door);
  return { doc, f, top, right, bottom, left, window, door };
}

// ---- wall and glazing area ---------------------------------------------------

{
  const { doc, f, top } = baseDoc();
  const resolved = resolveFloor(f);
  const t = envelopeTakeoff(doc);

  let expectedGross = 0;
  for (const w of f.walls) {
    const rw = resolved.walls.get(w.id)!;
    expectedGross += rw.faces[w.facadeSide ?? "left"] * H;
  }
  const cutWindow = 1200 * 1415, cutDoor = 830 * 2315;
  check("wallsMm2 is the clad faces less the two openings",
    near(t.wallsMm2, expectedGross - cutWindow - cutDoor, 1), String(t.wallsMm2));
  check("glazingMm2 is the window's clamped cut", near(t.glazingMm2, cutWindow, 1));
  check("doorsMm2 is the door's clamped cut", near(t.doorsMm2, cutDoor, 1));

  check("every wall is present", t.storeys[0]!.walls.length === 4);
  for (const ew of t.storeys[0]!.walls) {
    const rw = resolved.walls.get(ew.wallId)!;
    check(`clad face is the longer face of ${ew.wallId}`,
      near(ew.lengthMm, Math.max(rw.faces.left, rw.faces.right), 1),
      `${ew.lengthMm} vs ${rw.faces.left}/${rw.faces.right}`);
  }

  const topWall = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  check("the wall carrying it reports the window", topWall.openings.length === 1);
  check("the opening area matches the clamped cut",
    near(topWall.openings[0]!.areaMm2, cutWindow, 1));
  check("the window reads as glazing", topWall.openings[0]!.glazing === true);
}

// ---- plate, roof, ground, volume, compactness --------------------------------

{
  const { doc, f } = baseDoc();
  const rooms = detectRooms(f);
  check("the rectangle encloses one room", rooms.length === 1, String(rooms.length));
  const room = rooms[0]!;

  const t = envelopeTakeoff(doc);
  check("plateMm2 is the room's gross (bvo) area",
    near(t.storeys[0]!.plateMm2, room.bvoAreaMm2, 1), String(t.storeys[0]!.plateMm2));
  check("usableMm2 is the room's net area (the default area mode)",
    near(t.usableMm2, roomArea(room, "net"), 1), String(t.usableMm2));
  check("the default area mode is net", t.areaMode === "net");

  check("a single storey's roof is its whole plate",
    near(t.roofMm2, t.storeys[0]!.plateMm2, 1));
  check("a single storey's ground is its whole plate",
    near(t.groundMm2, t.storeys[0]!.plateMm2, 1));
  check("envelopeMm2 sums the five figures",
    near(t.envelopeMm2, t.wallsMm2 + t.glazingMm2 + t.doorsMm2 + t.roofMm2 + t.groundMm2, 1));
  check("compactness is envelope over usable",
    t.compactness !== null && near(t.compactness, t.envelopeMm2 / t.usableMm2, 1e-6));
  check("volume is plate times storey height",
    near(t.volumeMm3, t.storeys[0]!.plateMm2 * H, 1));
}

// ---- orientation ---------------------------------------------------------------

{
  const { doc, top, window } = baseDoc();
  doc.northDeg = 0;
  const t = envelopeTakeoff(doc);
  const w = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  check("a facade facing screen-up is N at northDeg 0", w.orientation === "N", String(w.orientation));
  const o = w.openings.find(x => x.openingId === window.id)!;
  check("its window shares the wall's orientation", o.orientation === "N");
  check("glazingByOrientation puts the window's area under N",
    t.glazingByOrientation !== null && near(t.glazingByOrientation.N, window.width * 1415, 1));
  for (const dir of ORIENTATIONS) {
    if (dir === "N") continue;
    check(`glazingByOrientation.${dir} is empty`,
      t.glazingByOrientation !== null && t.glazingByOrientation[dir] === 0);
  }
}

{
  const { doc, top } = baseDoc();
  doc.northDeg = 90;
  const t = envelopeTakeoff(doc);
  const w = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  check("the same facade is W once north points screen-right", w.orientation === "W", String(w.orientation));
}

{
  const { doc, top } = baseDoc();
  doc.northDeg = 45;
  const t = envelopeTakeoff(doc);
  const w = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  check("bearing 315 rounds to NW", w.orientation === "NW", String(w.orientation));
}

{
  const { doc, top } = baseDoc();
  doc.northDeg = 0;
  top.facadeSide = "left";
  const t = envelopeTakeoff(doc);
  const w = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  check("flipping facadeSide reports the opposite sector", w.orientation === "S", String(w.orientation));
}

{
  const { doc } = baseDoc();
  const t = envelopeTakeoff(doc);
  check("no northDeg means no glazingByOrientation", t.glazingByOrientation === null);
  check("no northDeg means no wall orientation",
    t.storeys[0]!.walls.every(w => w.orientation === null));
}

// ---- unstated exterior -----------------------------------------------------

{
  const { doc, f, right, left } = baseDoc();
  const resolved = resolveFloor(f);
  const rightNet = resolved.walls.get(right.id)!.faces[right.facadeSide ?? "left"] * H;
  const leftNet = resolved.walls.get(left.id)!.faces[left.facadeSide ?? "left"] * H;
  const before = envelopeTakeoff(doc);

  delete right.facadeMm;
  delete right.facadeSide;
  delete left.facadeMm;
  delete left.facadeSide;
  const after = envelopeTakeoff(doc);

  check("removing two facades drops them from wallsMm2",
    near(after.wallsMm2, before.wallsMm2 - rightNet - leftNet, 1),
    `${after.wallsMm2} vs ${before.wallsMm2 - rightNet - leftNet}`);
  check("both now read as unstated exterior", after.unstatedExterior === 2, String(after.unstatedExterior));
}

{
  const { doc, f } = baseDoc();
  f.walls.pop(); // open chain, no room closes
  const t = envelopeTakeoff(doc);
  check("no rooms means nothing can be said about unstated exterior", t.unstatedExterior === 0);
}

// ---- outwardSide, and inward-facing facades ------------------------------

/** Two 4x3 m rooms side by side, split by a dividing wall at x=4000. No facades. */
function twoRoomFloor(): { f: Floor; divider: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(8000, 0), v(8000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: TH, bulge: 0, openings: [] } satisfies Wall);
  }
  const n1 = { id: newId("n"), x: 4000, y: 0 };
  const n2 = { id: newId("n"), x: 4000, y: 3000 };
  f.nodes.push(n1, n2);
  const top = f.walls[0]!, bottom = f.walls[2]!;
  const topB = top.b; top.b = n1.id;
  f.walls.push({ id: newId("w"), a: n1.id, b: topB, thickness: TH, bulge: 0, openings: [] } satisfies Wall);
  const botB = bottom.b; bottom.b = n2.id;
  f.walls.push({ id: newId("w"), a: n2.id, b: botB, thickness: TH, bulge: 0, openings: [] } satisfies Wall);
  const divider: Wall = { id: newId("w"), a: n1.id, b: n2.id, thickness: TH, bulge: 0, openings: [] };
  f.walls.push(divider);
  return { f, divider };
}

{
  // rectFloorEnv() states facadeSide "right" on every wall, which its own
  // comment says is the true outward face for this winding.
  const { f } = baseDoc();
  const rooms = detectRooms(f);
  for (const w of f.walls) {
    check(`outwardSide agrees with rectFloorEnv's outward face on ${w.id}`,
      outwardSide(rooms, w.id) === "right", String(outwardSide(rooms, w.id)));
  }
}

{
  const { f, divider } = twoRoomFloor();
  const rooms = detectRooms(f);
  check("the dividing wall closes two rooms", rooms.length === 2, String(rooms.length));
  check("a wall bounded by a room on both sides has no outward side",
    outwardSide(rooms, divider.id) === null);
}

{
  const { f, top } = baseDoc();
  f.walls.pop(); // open chain, no room closes -- see the unstated-exterior case above
  const rooms = detectRooms(f);
  check("outwardSide is null for a floor with no rooms at all",
    rooms.length === 0 && outwardSide(rooms, top.id) === null);
}

{
  const { doc } = baseDoc();
  const t = envelopeTakeoff(doc);
  check("every facade on its true outward side means no inward facades",
    t.inwardFacades === 0 && t.storeys[0]!.inwardFacades === 0, String(t.inwardFacades));
}

{
  const { doc, f, top } = baseDoc();
  const resolved = resolveFloor(f);
  top.facadeSide = "left"; // wrong: the room-bounded side, not the outward one
  const t = envelopeTakeoff(doc);
  check("flipping one wall's facadeSide reports one inward facade",
    t.inwardFacades === 1 && t.storeys[0]!.inwardFacades === 1, String(t.inwardFacades));
  const ew = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  const rw = resolved.walls.get(top.id)!;
  check("its lengthMm is now the shorter (inward) face",
    near(ew.lengthMm, Math.min(rw.faces.left, rw.faces.right), 1),
    `${ew.lengthMm} vs ${rw.faces.left}/${rw.faces.right}`);
}

// ---- two storeys: roof, ground, volume, overhang -----------------------------

{
  const floor0 = rectFloorEnv(0, 0, W, D);
  const floor1 = rectFloorEnv(0, 500, W, 2500); // 4000x2000, set back inside floor0
  const doc = emptyDoc();
  doc.floors = [floor0, floor1];
  const t = envelopeTakeoff(doc);
  const s0 = t.storeys[0]!, s1 = t.storeys[1]!;

  check("storey 0's roof is the plate not covered by storey 1",
    near(s0.roofMm2, s0.plateMm2 - s1.plateMm2, 1), `${s0.roofMm2} vs ${s0.plateMm2 - s1.plateMm2}`);
  check("storey 1's roof is its whole plate", near(s1.roofMm2, s1.plateMm2, 1));
  check("only storey 0 carries ground", near(s0.groundMm2, s0.plateMm2, 1) && s1.groundMm2 === 0);
  check("each storey's volume is its own plate times its own height",
    near(s0.volumeMm3, s0.plateMm2 * H, 1) && near(s1.volumeMm3, s1.plateMm2 * H, 1));
  check("a storey set back inside the one below has no overhang", s0.overhang === false);
  check("document-level overhang follows the storeys", t.overhang === false);
}

{
  const floor0 = rectFloorEnv(0, 0, W, D);
  const floor1 = rectFloorEnv(-500, 500, W - 500, 2500); // extends 500 past floor0's west edge
  const doc = emptyDoc();
  doc.floors = [floor0, floor1];
  const t = envelopeTakeoff(doc);
  check("a storey extending past the one below overhangs", t.storeys[0]!.overhang === true);
  check("document-level overhang picks it up", t.overhang === true);
}

{
  const floor0 = rectFloorEnv(0, 0, W, D);
  const floor1 = rectFloorEnv(0, 0, W, D); // exactly stacked
  const doc = emptyDoc();
  doc.floors = [floor0, floor1];
  const t = envelopeTakeoff(doc);
  check("boundary vertices lying on the lower boundary are not an overhang",
    t.storeys[0]!.overhang === false);
}

// ---- arc wall ---------------------------------------------------------------

{
  const { doc, top, window } = baseDoc();
  doc.northDeg = 0;
  top.bulge = 0.3;
  // Place the window exactly at the arc's own midpoint (by arc length), where
  // a symmetric arc's tangent is horizontal regardless of bulge.
  const A = v(0, 0), B = v(W, 0);
  window.t = arcLength(A, B, top.bulge) / 2;
  const t = envelopeTakeoff(doc);
  const w = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  const o = w.openings.find(x => x.openingId === window.id)!;
  check("a bulged wall's window at mid-arc still reports N", o.orientation === "N", String(o.orientation));
}

// ---- transmission estimate ---------------------------------------------------

{
  const { doc } = baseDoc();
  const t = envelopeTakeoff(doc);
  check("no energy assumptions and no per-element rc/u gives no estimate",
    transmissionEstimate(t, doc) === null);
}

{
  const { doc, top } = baseDoc();
  doc.energy = { wallRc: 4.7, roofRc: 6.3, floorRc: 3.7, windowU: 1.65, doorU: 2.0 };
  const t = envelopeTakeoff(doc);
  const te = transmissionEstimate(t, doc)!;
  check("an estimate exists once the document states figures", te !== null);

  const wallsWK = t.wallsMm2 / 1e6 / (4.7 + 0.17);
  check("wallsWK from the document default", near(te.wallsWK, wallsWK, 1e-6), `${te.wallsWK} vs ${wallsWK}`);
  const roofWK = t.roofMm2 / 1e6 / (6.3 + 0.14);
  check("roofWK", near(te.roofWK, roofWK, 1e-6));
  const floorWK = t.groundMm2 / 1e6 / (3.7 + 0.34);
  check("floorWK", near(te.floorWK, floorWK, 1e-6));
  const glazingWK = (1200 * 1415 / 1e6) * 1.65;
  check("glazingWK", near(te.glazingWK, glazingWK, 1e-6));
  const doorsWK = (830 * 2315 / 1e6) * 2.0;
  check("doorsWK", near(te.doorsWK, doorsWK, 1e-6));
  check("totalWK sums the five", near(te.totalWK, wallsWK + roofWK + floorWK + glazingWK + doorsWK, 1e-6));
  check("nothing is unstated once every figure is given", te.unstated === 0, String(te.unstated));
  const heatKWhYear = te.totalWK * 24 * 2800 / 1000;
  check("heatKWhYear", near(te.heatKWhYear, heatKWhYear, 1e-6));
  check("heatKWhM2Year is per m2 Ag",
    te.heatKWhM2Year !== null && near(te.heatKWhM2Year, heatKWhYear / (t.usableMm2 / 1e6), 1e-6));

  // A wall's own rc overrides the document default in wallsWK.
  top.rc = 1.3;
  const t2 = envelopeTakeoff(doc);
  const te2 = transmissionEstimate(t2, doc)!;
  const expectedWallsWK2 = t2.storeys[0]!.walls.reduce(
    (n, w) => n + (w.rc !== null ? (w.netMm2 / 1e6) * uFromRc(w.rc, "wall") : 0), 0);
  check("a wall's own rc changes wallsWK", near(te2.wallsWK, expectedWallsWK2, 1e-9));
  check("and no longer matches the all-default figure",
    Math.abs(te2.wallsWK - wallsWK) > 1e-6);
}

{
  const { doc, window } = baseDoc();
  doc.energy = { wallRc: 4.7, roofRc: 6.3, floorRc: 3.7, windowU: 1.65, doorU: 2.0 };
  window.uValue = 2.9;
  const t = envelopeTakeoff(doc);
  const te = transmissionEstimate(t, doc)!;
  const expectedGlazingWK = t.storeys[0]!.walls
    .flatMap(w => w.openings)
    .filter(o => o.glazing)
    .reduce((n, o) => n + (o.u !== null ? (o.areaMm2 / 1e6) * o.u : 0), 0);
  check("a window's own uValue overrides the document default",
    near(te.glazingWK, expectedGlazingWK, 1e-9) && near(te.glazingWK, (1200 * 1415 / 1e6) * 2.9, 1e-6));
}

{
  const { doc } = baseDoc();
  doc.energy = { windowU: 1.65 };
  const t = envelopeTakeoff(doc);
  const te = transmissionEstimate(t, doc)!;
  check("an estimate exists when only glazing is stated", te !== null);
  check("statedMm2 is only the glazing", near(te.statedMm2, t.glazingMm2, 1), String(te.statedMm2));
  check("four walls, the roof, the floor and the door are unstated",
    te.unstated === 7, String(te.unstated));
}

// ---- model: wallRcOf / openingUOf / openingIsGlazing --------------------------

{
  const envWall: Wall = {
    id: newId("w"), a: "na", b: "nb", thickness: 300, bulge: 0, openings: [],
    facadeMm: 100, facadeSide: "right",
  };
  const nonEnvWall: Wall = { id: newId("w"), a: "na", b: "nb", thickness: 100, bulge: 0, openings: [] };
  check("isEnvelopeWall matches a stated facade",
    isEnvelopeWall(envWall) && !isEnvelopeWall(nonEnvWall));

  const docW = emptyDoc();
  docW.energy = { wallRc: 4.7 };
  check("wallRcOf reads a non-facade wall's own rc regardless of the envelope",
    wallRcOf(docW, { ...nonEnvWall, rc: 1.3 }) === 1.3);
  check("wallRcOf is null for a non-facade wall with no rc, even with a document default",
    wallRcOf(docW, nonEnvWall) === null);
  check("wallRcOf falls back to the document default for an envelope wall with no rc",
    wallRcOf(docW, envWall) === 4.7);
  check("wallRcOf prefers an envelope wall's own rc over the default",
    wallRcOf(docW, { ...envWall, rc: 1.3 }) === 1.3);

  const winO = opening({ kind: "window", t: 1000, width: 1000 });
  const doorO = opening({ kind: "door", t: 1000, width: 900 });
  const glazedDoorO = opening({ kind: "door", t: 1000, width: 900, glazed: true });
  const passageO = opening({ kind: "passage", t: 1000, width: 900 });
  check("openingIsGlazing: window", openingIsGlazing(winO));
  check("openingIsGlazing: glazed door", openingIsGlazing(glazedDoorO));
  check("openingIsGlazing: plain door", !openingIsGlazing(doorO));
  check("openingIsGlazing: passage", !openingIsGlazing(passageO));

  const docU = emptyDoc();
  docU.energy = { windowU: 1.65, doorU: 2.0 };
  const ownU = opening({ kind: "window", t: 1000, width: 1000, uValue: 0.9 });
  check("openingUOf reads an opening's own uValue in a non-facade wall",
    openingUOf(docU, nonEnvWall, ownU) === 0.9);
  check("openingUOf is null for a non-facade wall's unstated opening, even with a document default",
    openingUOf(docU, nonEnvWall, winO) === null);
  check("openingUOf falls back to windowU for glazing in an envelope wall",
    openingUOf(docU, envWall, winO) === 1.65);
  check("openingUOf falls back to doorU for a plain door in an envelope wall",
    openingUOf(docU, envWall, doorO) === 2.0);
  check("openingUOf prefers the opening's own uValue over an envelope default",
    openingUOf(docU, envWall, ownU) === 0.9);
  check("openingUOf keeps the opening's own uValue with no document default",
    openingUOf(emptyDoc(), envWall, ownU) === 0.9);
}

// ---- model: insulation classes, glazing types, thermalValue, uFromRc ----------

{
  for (const c of INSULATION_CLASSES) {
    const e: EnergyAssumptions = {};
    applyInsulationClass(e, c.id);
    check(`insulation class round-trip: ${c.id}`, insulationClassOf(e) === c.id);
  }
  check("insulationClassOf is null for a custom mix",
    insulationClassOf({ wallRc: 1, roofRc: 1, floorRc: 1 }) === null);
  check("insulationClassOf is null when incomplete",
    insulationClassOf({ wallRc: 4.7 }) === null);

  for (const g of GLAZING_TYPES) {
    const e: EnergyAssumptions = {};
    applyGlazingType(e, g.id);
    check(`glazing type round-trip: ${g.id}`, glazingTypeOf(e) === g.id);
  }
  check("glazingTypeOf is null for a custom mix",
    glazingTypeOf({ windowU: 2.0, doorU: 2.0 }) === null);

  check("thermalValue(0) is undefined", thermalValue(0) === undefined);
  check("thermalValue rounds to two decimals",
    thermalValue(4.7049) !== undefined && near(thermalValue(4.7049)!, 4.7, 1e-9));
  check("uFromRc(2.5, wall)", near(uFromRc(2.5, "wall"), 1 / 2.67, 1e-9));
}

// ---- model: orientationOf on the eight sectors --------------------------------

{
  const s = Math.SQRT1_2;
  const cases: Array<[string, Vec]> = [
    ["N", v(0, -1)], ["NE", v(s, -s)], ["E", v(1, 0)], ["SE", v(s, s)],
    ["S", v(0, 1)], ["SW", v(-s, s)], ["W", v(-1, 0)], ["NW", v(-s, -s)],
  ];
  for (const [expected, n] of cases) {
    check(`orientationOf ${expected}`, orientationOf(n, 0) === expected, orientationOf(n, 0));
  }
}

// ── sloped walls (issue #55): the envelope reads the profile ───────────────

{
  const f = rectFloorEnv(0, 0, W, D);
  const doc = emptyDoc();
  doc.floors = [f];
  const top = f.walls[0]!;
  const resolved = resolveFloor(f);
  const rw = resolved.walls.get(top.id)!;
  const peak = H + 1000;
  // A gable at the midpoint: eaves at the flat wallHeight() (H), implied.
  top.profile = [{ t: rw.length / 2, height: peak }];

  const t = envelopeTakeoff(doc);
  const ew = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  const faceLen = rw.faces[top.facadeSide ?? "left"];
  const expectedGross = wallAreaUnder(f, top, rw.length, 0, rw.length) * (faceLen / rw.length);

  check("a gable end's envelope wall area equals the area under its profile, mapped onto the clad face",
    near(ew.grossMm2, expectedGross, 1), `${ew.grossMm2} vs ${expectedGross}`);
  check("...and no longer the pre-profile faceLength x flat-height box",
    !near(ew.grossMm2, faceLen * H, 1), `${ew.grossMm2} vs ${faceLen * H}`);
  check("the envelope wall's heightMm is the ridge (wallTopRange().max), not the flat wallHeight()",
    near(ew.heightMm, peak, 1), `${ew.heightMm} vs ${peak}`);
}

{
  // An opening's head is clamped to the wall's own top over its OWN span
  // (the rule core/surface.ts's openingOn() applies), not to the wall's flat
  // heightMm -- which a lean-to's low end makes lower than the local top,
  // and which the old (pre-profile) code used unconditionally.
  const f = rectFloorEnv(0, 0, W, D);
  const doc = emptyDoc();
  doc.floors = [f];
  const top = f.walls[0]!;
  const resolved = resolveFloor(f);
  const rw = resolved.walls.get(top.id)!;
  // A lean-to: flat at H at the a end, H + 2000 at the b end.
  top.profile = [{ t: 0, height: H }, { t: rw.length, height: H + 2000 }];
  // Near the low end, tall enough that its head sits above the local top
  // there but well under the wall's overall max (H + 2000).
  const window = opening({ kind: "window", t: 200, width: 300, sillHeight: 0, height: H + 500 });
  top.openings.push(window);

  const t = envelopeTakeoff(doc);
  const ew = t.storeys[0]!.walls.find(x => x.wallId === top.id)!;
  const eo = ew.openings.find(o => o.openingId === window.id)!;

  const s0 = window.t - window.width / 2, s1 = window.t + window.width / 2;
  const localTop = Math.min(wallTopAt(f, top, s0), wallTopAt(f, top, s1));
  const windowHeight = openingHeight(window);
  const expectedArea = window.width * Math.min(windowHeight, localTop);
  const flatClampArea = window.width * Math.min(windowHeight, H);
  check("an opening's head is clamped to the wall's own top over its span",
    near(eo.areaMm2, expectedArea, 1), `${eo.areaMm2} vs ${expectedArea}`);
  check("...not to the flat wallHeight(), which the lean-to's low end makes too strict here",
    !near(eo.areaMm2, flatClampArea, 1), `${eo.areaMm2} vs flat clamp ${flatClampArea}`);
}

console.log(failures === 0 ? "ALL ENERGY TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
