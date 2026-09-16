// core/checks.ts: the three applications of the span check (core/timber.ts)
// to a deck's joists, a placed beam and an opening's lintel -- unit
// conversion (N/m² deck loads, kN/m beam and lintel loads, kg/m³ wall
// densities, all reduced to the N/mm core/timber.ts takes), missing-input
// detection, and the steel/timber beam routing. checkSpan()/checkSteelSpan()
// themselves are pinned in tests/timber.test.ts; here the point is that a
// document object turns into the right SpanInput/SteelSpanInput.
import {
  emptyDoc, newId, type Wall, type Opening, type Floor, type PlanDoc,
} from "../src/model/doc";
import { wallTopAt } from "../src/model/profile";
import type { Deck } from "../src/model/deck";
import { type Beam, STRUCTURE_LIMITS } from "../src/model/structure";
import { Store } from "../src/model/store";
import { joistCheck, beamCheck, lintelCheck } from "../src/core/checks";
import {
  checkSpan, checkSteelSpan, proposeSection, type SpanInput, type SteelSpanInput,
} from "../src/core/timber";
import { SECTIONS_DEFAULT, TIMBER_DEFAULT, TIMBER_CLASSES } from "../src/model/materials";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol: number): boolean { return Math.abs(a - b) <= tol; }

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

function docWithFlatWall(len: number, wallOver: Partial<Wall> = {}): { doc: PlanDoc; f: Floor; w: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = 2600;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: len, y: 0 }];
  const w: Wall = { id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0, openings: [], material: "masonry", ...wallOver };
  f.walls = [w];
  return { doc, f, w };
}

// ---- joistCheck -----------------------------------------------------------

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const deckNoSection: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, loadG: 500, loadQ: 1750,
  };
  f.decks = [deckNoSection];
  const r = joistCheck(doc, deckNoSection);
  check("a joist check on a deck without a section is incomplete", r.status === "incomplete");
  check("missing lists joistSection", r.missing.includes("joistSection"), JSON.stringify(r.missing));
  check("a proposal is still offered (the load is known)", r.proposal !== undefined && r.proposal !== null);
}

{
  const doc = emptyDoc();
  const deckNoLoad: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 44, d: 195 },
  };
  const r = joistCheck(doc, deckNoLoad);
  check("a joist check on a deck without loads is incomplete", r.status === "incomplete");
  check("missing lists load", r.missing.includes("load"), JSON.stringify(r.missing));
  check("no proposal can be offered without a load", r.proposal === null);
}

{
  // Same load figures as the hand-worked case in tests/timber.test.ts -- 600
  // mm centres, g 500 N/m², q 1750 N/m², 44x195 C24 -- but the checked span
  // is now the deck's clear 3600 span PLUS one bearing (default 100, deck
  // states none): 3700, centre-to-centre of the joist's own bearings.
  //
  //   M = qd*L^2/8 = 1.935 * 3700^2 / 8 = 3,311,268.75 N*mm
  //   V = qd*L/2   = 1.935 * 3700 / 2   = 3,579.75 N
  //   (W, I, A, fmd, fvd unchanged from the 3600 case: 278,850 mm^3,
  //   27,187,875 mm^4, 8,580 mm^2, 14.76923 N/mm^2, 2.46154 N/mm^2)
  //
  //   bending = (M/W) / fmd = 11.87473 / 14.76923 = 0.80402
  //   shear   = (1.5V/A) / fvd = 0.62583 / 2.46154 = 0.25424
  //
  //   w_inst = 5*qk*L^4 / (384*E*I) = 5*1.35*3700^4 / 114,841,584,000,000
  //          = 11.01569 mm
  //   w_fin = w_inst*1.6 = 17.62510 mm
  //   limit = 3700/250 = 14.8 mm
  //   deflection = 17.62510 / 14.8 = 1.19089
  //
  // Deflection still governs and the joist still fails, by a slightly wider
  // margin than the 3600 case.
  const doc = emptyDoc();
  const deck: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 44, d: 195 }, loadG: 500, loadQ: 1750,
  };
  const r = joistCheck(doc, deck);
  check("status is fails (deflection governs at 1.19089)", r.status === "fails", r.status);
  check("no missing keys once a full result is produced", r.missing.length === 0);
  check("material is timber", r.material === "timber");
  const input = r.input as SpanInput;
  check("qdNmm matches the hand-worked figure", near(input.qdNmm, 1.935, 1e-9), String(input.qdNmm));
  check("qkNmm matches the hand-worked figure", near(input.qkNmm, 1.35, 1e-9), String(input.qkNmm));
  check("spanMm is the deck's clear extent plus the default bearing (3600 + 100)", input.spanMm === 3700, String(input.spanMm));
  check("checkSpan on the same input reproduces beamCheck's own result",
    JSON.stringify(checkSpan(input)) === JSON.stringify(r.check));
  check("bending utilisation matches the hand-worked figure", near(r.check!.bending, 0.80402, 0.0005), String(r.check!.bending));
  check("shear utilisation matches the hand-worked figure", near(r.check!.shear, 0.25424, 0.0005), String(r.check!.shear));
  check("deflection utilisation matches the hand-worked figure", near(r.check!.deflection, 1.19089, 0.0005), String(r.check!.deflection));
}

// ---- beamCheck --------------------------------------------------------------

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const beamNoLoad: Beam = { id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, width: 100, depth: 150 };
  const r = beamCheck(doc, f, beamNoLoad);
  check("a beam without a load is incomplete", r.status === "incomplete");
  check("missing lists loadKNm", r.missing.includes("loadKNm"), JSON.stringify(r.missing));
}

{
  // Timber path: no label, so width x depth is checked as a rectangular
  // timber section. Span 3000, loadKNm 1.0 (wholly permanent): qd = 1.2*1.0
  // = 1.2, qk = 1.0.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const beam: Beam = {
    id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, width: 100, depth: 150, loadKNm: 1.0,
  };
  const r = beamCheck(doc, f, beam);
  check("material is timber (no matching label)", r.material === "timber");
  const input = r.input as SpanInput;
  check("qdNmm = gammaG * loadKNm", near(input.qdNmm, 1.2, 1e-9), String(input.qdNmm));
  check("qkNmm = loadKNm (unfactored, wholly permanent)", near(input.qkNmm, 1.0, 1e-9), String(input.qkNmm));
  check("spanMm is the run's own length", input.spanMm === 3000);
  check("section is the beam's own width x depth", input.section.w === 100 && input.section.d === 150);
  check("this beam passes (light load, short span)", r.status === "ok", r.status);
}

{
  // A beam's proposal must survive clampBeamSize(): every 38 and 44 mm wide
  // entry in the document's default sections list is narrower than
  // STRUCTURE_LIMITS.section.min (50), so beamCheck() must filter them out
  // even where one would otherwise be the smallest passing area.
  //
  // Span 3600, loadKNm 1.5 (wholly permanent): qd = 1.2*1.5 = 1.8 N/mm,
  // qk = 1.5 N/mm. By hand, unfiltered over SECTIONS_DEFAULT the smallest
  // passing AREA is 44 x 220 (area 9,680 mm^2, deflection 0.849) -- 44 is
  // below the beam minimum. Of the three 71-wide entries, 71 x 171 still
  // fails (deflection 1.120), 71 x 196 passes (deflection 0.744, area
  // 13,916 mm^2) and is the smallest area that both passes and clears the
  // minimum.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const beam: Beam = {
    id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 3600, y: 0 }, width: 44, depth: 69, loadKNm: 1.5,
  };
  const r = beamCheck(doc, f, beam);
  check("this stated 44x69 section fails", r.status === "fails", r.status);
  const { spanMm, qdNmm, qkNmm, material, deflectionDiv } = r.input as SpanInput;
  const base: Omit<SpanInput, "section"> = { spanMm, qdNmm, qkNmm, material, deflectionDiv };
  const unfiltered = proposeSection(base, SECTIONS_DEFAULT);
  check("sanity: unfiltered, the smallest passing section is narrower than the beam minimum",
    unfiltered !== null && unfiltered.w < STRUCTURE_LIMITS.section.min, JSON.stringify(unfiltered));
  check("beamCheck's own proposal is never narrower than STRUCTURE_LIMITS.section.min",
    r.proposal !== undefined && r.proposal !== null && r.proposal.w >= STRUCTURE_LIMITS.section.min,
    JSON.stringify(r.proposal));
  check("the proposal is exactly 71 x 196, the smallest section that both passes and clears the minimum",
    JSON.stringify(r.proposal) === JSON.stringify({ w: 71, d: 196 }), JSON.stringify(r.proposal));
}

{
  // Steel path: a label matching STEEL_PROFILES uses the catalogue Wy/Iy.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const beam: Beam = {
    id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 4000, y: 0 },
    width: 200, depth: 190, label: "HEA 200", loadKNm: 5,
  };
  const r = beamCheck(doc, f, beam);
  check("a label matching STEEL_PROFILES takes the steel path", r.material === "steel");
  const input = r.input as SteelSpanInput;
  check("wyMm3 is HEA 200's catalogue Wy (389 cm^3) in mm^3", input.wyMm3 === 389_000, String(input.wyMm3));
  check("iyMm4 is HEA 200's catalogue Iy (3692 cm^4) in mm^4", input.iyMm4 === 36_920_000, String(input.iyMm4));
  check("fy is the document default 235", input.fy === 235);
  check("qdNmm = gammaG * loadKNm = 1.2*5 = 6", near(input.qdNmm, 6, 1e-9), String(input.qdNmm));
  check("qkNmm = loadKNm = 5", near(input.qkNmm, 5, 1e-9), String(input.qkNmm));
  check("beamCheck's own result reproduces checkSteelSpan on the same input",
    JSON.stringify(checkSteelSpan(input)) === JSON.stringify(r.check));
  check("a passing steel beam still carries proposal: null (no catalogue substitute is offered)",
    r.proposal === null, JSON.stringify(r.proposal));
}

{
  // A failing steel beam always reports proposal: null -- a catalogue
  // section is never swapped in for a rectangular timber substitute -- so
  // the panel shows "none passes" rather than silently carrying no note.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const beam: Beam = {
    id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 8000, y: 0 },
    width: 100, depth: 100, label: "HEA 100", loadKNm: 20,
  };
  const r = beamCheck(doc, f, beam);
  check("this heavily overloaded HEA 100 fails", r.status === "fails", r.status);
  check("material is steel", r.material === "steel");
  check("proposal is null on a failing steel beam", r.proposal === null, JSON.stringify(r.proposal));
}

{
  // A label that names nothing in STEEL_PROFILES falls back to the timber
  // path over the beam's stated width x depth.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const beam: Beam = {
    id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 },
    width: 100, depth: 150, label: "Not A Real Profile", loadKNm: 1.0,
  };
  const r = beamCheck(doc, f, beam);
  check("an unmatched label is checked as timber of its stated size", r.material === "timber");
}

// ---- lintelCheck --------------------------------------------------------------

{
  // A wall with no material: incomplete, regardless of a stated lintel section.
  const { doc, f, w } = docWithFlatWall(3000, { material: undefined });
  const door = opening({ kind: "door", t: 1500, width: 1000, sillHeight: 0, height: 2100, lintel: { w: 44, d: 195 } });
  const r = lintelCheck(doc, f, w, door);
  check("a lintel in a wall with no material is incomplete", r.status === "incomplete");
  check("missing lists material", r.missing.includes("material"), JSON.stringify(r.missing));
}

{
  // A wall stating a material but no lintel section: incomplete with a proposal.
  const { doc, f, w } = docWithFlatWall(3000);
  const door = opening({ kind: "door", t: 1500, width: 1000, sillHeight: 0, height: 2100 });
  const r = lintelCheck(doc, f, w, door);
  check("a lintel with no stated section is incomplete", r.status === "incomplete");
  check("missing lists lintelSection", r.missing.includes("lintelSection"), JSON.stringify(r.missing));
  check("a proposal is offered (the wall's material is known)", r.proposal !== undefined && r.proposal !== null);
}

{
  // Masonry, 200 mm thick, floor 2600, head at 2100 -> 500 mm of wall above
  // the head. By hand: g_line = 1900 * 0.2 * 0.5 * 9.81 / 1000 = 1.8639 N/mm.
  const { doc, f, w } = docWithFlatWall(3000);
  const door = opening({
    kind: "door", t: 1500, width: 1000, sillHeight: 0, height: 2100, lintel: { w: 44, d: 195 },
  });
  const r = lintelCheck(doc, f, w, door);
  check("status is not incomplete", r.status !== "incomplete", r.status);
  const input = r.input as SpanInput;
  check("spanMm = width + bearing (default 150) = 1150", input.spanMm === 1150, String(input.spanMm));
  check("qkNmm is the masonry self-weight line load", near(input.qkNmm, 1.8639, 1e-4), String(input.qkNmm));
  check("qdNmm = gammaG * qkNmm", near(input.qdNmm, 1.2 * 1.8639, 1e-4), String(input.qdNmm));
  check("lintelCheck's own result reproduces checkSpan on the same input",
    JSON.stringify(checkSpan(input)) === JSON.stringify(r.check));
}

{
  // lintelLoadKNm is a floor bearing on the wall, so it is factored as
  // variable load (gammaQ) rather than folded into the wall's own permanent
  // self-weight (gammaG). Same wall as above (qkNmm-wall = 1.8639 N/mm)
  // plus an authored 2 kN/m floor bearing.
  const { doc, f, w } = docWithFlatWall(3000);
  const door = opening({
    kind: "door", t: 1500, width: 1000, sillHeight: 0, height: 2100,
    lintel: { w: 44, d: 195 }, lintelLoadKNm: 2,
  });
  const r = lintelCheck(doc, f, w, door);
  const input = r.input as SpanInput;
  const load = r.loadBreakdown!;
  check("wallLineKNm is the wall's self-weight alone", near(load.wallLineKNm!, 1.8639, 1e-4), String(load.wallLineKNm));
  check("gLineKNm equals wallLineKNm -- lintelLoadKNm is no longer folded into g",
    near(load.gLineKNm, load.wallLineKNm!, 1e-9), `${load.gLineKNm} vs ${load.wallLineKNm}`);
  check("qLineKNm carries the authored lintelLoadKNm", near(load.qLineKNm, 2, 1e-9), String(load.qLineKNm));
  check("qdNmm = gammaG*wallSelfWeight + gammaQ*lintelLoadKNm = 1.2*1.8639 + 1.5*2",
    near(input.qdNmm, 1.2 * 1.8639 + 1.5 * 2, 1e-3), String(input.qdNmm));
  check("qkNmm = wallSelfWeight + lintelLoadKNm, unfactored",
    near(input.qkNmm, 1.8639 + 2, 1e-4), String(input.qkNmm));
}

{
  // A framed (timber/steel post) wall uses 0.5 kN/m² of face rather than a
  // density: 500 mm above the head -> 0.5 * 0.5 = 0.25 N/mm.
  const { doc, f, w } = docWithFlatWall(3000, { material: "timber", thickness: 100 });
  const door = opening({
    kind: "door", t: 1500, width: 1000, sillHeight: 0, height: 2100, lintel: { w: 44, d: 195 },
  });
  const r = lintelCheck(doc, f, w, door);
  const input = r.input as SpanInput;
  check("a framed wall's self-weight is the face-load convention, not density*thickness",
    near(input.qkNmm, 0.25, 1e-9), String(input.qkNmm));
}

{
  // An opening reaching the full wall height leaves nothing above the head:
  // the self-weight is 0 regardless of material, so an unstated material is
  // not reported missing in this case.
  const { doc, f, w } = docWithFlatWall(3000, { material: undefined });
  const fullHeightDoor = opening({
    kind: "door", t: 1500, width: 1000, sillHeight: 0, height: 2600, lintel: { w: 44, d: 195 },
  });
  const r = lintelCheck(doc, f, w, fullHeightDoor);
  check("no wall above the head needs no material figure", !r.missing.includes("material"), JSON.stringify(r.missing));
  const input = r.input as SpanInput;
  check("qkNmm is 0 with nothing above the head", input.qkNmm === 0, String(input.qkNmm));
  check("an unloaded lintel trivially passes", r.status === "ok", r.status);
}

{
  // A gable wall: wallTopAt(), not the flat wallHeight(), decides how much
  // wall stands above the head -- an opening under the ridge carries twice
  // the wall of one at the quarter point, exactly as the profile implies.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = 2600;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  const w: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0, openings: [],
    material: "masonry", profile: [{ t: 2000, height: 3600 }],
  };
  f.walls = [w];

  check("sanity: wallTopAt at the quarter point is 2850", wallTopAt(f, w, 500) === 2850, String(wallTopAt(f, w, 500)));
  check("sanity: wallTopAt at the ridge is 3600", wallTopAt(f, w, 2000) === 3600);

  const quarter = opening({ kind: "door", t: 500, width: 1000, sillHeight: 0, height: 2100, lintel: { w: 44, d: 195 } });
  const ridge = opening({ kind: "door", t: 2000, width: 1000, sillHeight: 0, height: 2100, lintel: { w: 44, d: 195 } });
  const rQuarter = lintelCheck(doc, f, w, quarter);
  const rRidge = lintelCheck(doc, f, w, ridge);
  const qQuarter = (rQuarter.input as SpanInput).qkNmm;
  const qRidge = (rRidge.input as SpanInput).qkNmm;
  check("above the head: quarter point 750mm, ridge 1500mm -- exactly double",
    near(qRidge, 2 * qQuarter, 1e-6), `${qRidge} vs ${2 * qQuarter}`);
  check("quarter-point load matches the hand figure (1900*0.2*0.75*9.81/1000)",
    near(qQuarter, 2.79585, 1e-4), String(qQuarter));
}

// ---- store.mutate: changing an authored fact changes the result -----------

{
  const store = new Store();
  const deck: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 44, d: 195 }, loadG: 500, loadQ: 1750,
  };
  store.mutate(doc => { store.floorOf(doc).decks = [deck]; });
  const before = joistCheck(store.doc, store.floorOf(store.doc).decks![0]!);

  store.mutate(doc => { store.floorOf(doc).decks![0]!.loadQ = 3000; });
  const afterLoad = joistCheck(store.doc, store.floorOf(store.doc).decks![0]!);
  check("increasing the variable load changes the check", afterLoad.check!.bending !== before.check!.bending,
    `${before.check!.bending} -> ${afterLoad.check!.bending}`);
  check("increasing the load worsens (or leaves equal but never improves) the utilisation",
    afterLoad.check!.deflection > before.check!.deflection);

  store.mutate(doc => { store.floorOf(doc).decks![0]!.joist = { w: 71, d: 221 }; });
  const afterSection = joistCheck(store.doc, store.floorOf(store.doc).decks![0]!);
  check("a bigger section improves the utilisation", afterSection.check!.deflection < afterLoad.check!.deflection,
    `${afterLoad.check!.deflection} -> ${afterSection.check!.deflection}`);

  const c18 = TIMBER_CLASSES.find(c => c.id === "C18")!;
  store.mutate(doc => { doc.materials = { timber: { ...TIMBER_DEFAULT, fmk: c18.fmk, fvk: c18.fvk, e0mean: c18.e0mean } }; });
  const afterClass = joistCheck(store.doc, store.floorOf(store.doc).decks![0]!);
  check("a weaker timber class raises the bending utilisation", afterClass.check!.bending > afterSection.check!.bending,
    `${afterSection.check!.bending} -> ${afterClass.check!.bending}`);
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
