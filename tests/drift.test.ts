// Issue #62: an assumption a document has edited away from its preset
// (model/materials.ts's assumptionDrift()) and a load core/checks.ts reads
// as implausible (CheckResult.flags) must both stay visible beside a
// preliminary check -- without ever changing what the check itself reports.
// checkSpan()/checkSteelSpan() are pinned in tests/timber.test.ts and the
// object-to-SpanInput plumbing in tests/checks.test.ts; here the point is
// the drift list and the flags alone.
import { emptyDoc, newId, type PlanDoc, type Wall, type Opening, type Floor } from "../src/model/doc";
import type { Deck } from "../src/model/deck";
import { DECK_USES } from "../src/model/deck";
import type { Beam } from "../src/model/structure";
import { joistCheck, beamCheck, lintelCheck } from "../src/core/checks";
import { checkSpan, type SpanInput } from "../src/core/timber";
import {
  assumptionDrift, KMOD_DEFAULT, GAMMA_M_DEFAULT, KDEF_DEFAULT,
  GAMMA_G_DEFAULT, GAMMA_Q_DEFAULT, DEFLECTION_DIV_DEFAULT, STEEL_FY_DEFAULT,
  MIN_HZ_DEFAULT, MAX_POINT_MM_DEFAULT, TIMBER_CLASSES,
} from "../src/model/materials";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function keys(drift: ReturnType<typeof assumptionDrift>): string[] {
  return drift.map(d => d.key);
}

// ---- assumptionDrift: presets, drift and tolerance -------------------------

{
  const doc = emptyDoc();
  check("a fresh document has no assumption drift", assumptionDrift(doc).length === 0, JSON.stringify(assumptionDrift(doc)));
}

{
  const doc: PlanDoc = emptyDoc();
  doc.materials = { timber: { fmk: 24, fvk: 4.0, e0mean: 11000, kmod: 1.0, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT } };
  const drift = assumptionDrift(doc);
  check("editing k_mod alone reports exactly one drift entry", drift.length === 1, JSON.stringify(drift));
  check("the entry names kmod, its value and the default", JSON.stringify(drift[0]) === JSON.stringify({ key: "kmod", value: 1.0, preset: KMOD_DEFAULT }), JSON.stringify(drift[0]));
}

{
  // Within a rounding hair of the preset (1e-6) is not drift.
  const doc: PlanDoc = emptyDoc();
  doc.materials = { timber: { fmk: 24, fvk: 4.0, e0mean: 11000, kmod: KMOD_DEFAULT + 1e-9, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT } };
  check("a figure within the rounding tolerance of its preset is not drift", assumptionDrift(doc).length === 0, JSON.stringify(assumptionDrift(doc)));
}

{
  const doc: PlanDoc = emptyDoc();
  doc.materials = { timber: { fmk: 24, fvk: 4.0, e0mean: 11000, kmod: KMOD_DEFAULT + 1e-4, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT } };
  check("a figure a real distance from its preset is drift", assumptionDrift(doc).length === 1, JSON.stringify(assumptionDrift(doc)));
}

{
  // gammaG/gammaQ/deflectionDiv/steel.fy -- document-level, not part of the
  // timber bundle.
  const doc: PlanDoc = emptyDoc();
  doc.materials = { gammaG: 1.35, gammaQ: GAMMA_Q_DEFAULT, deflectionDiv: 200, steel: { fy: 355 } };
  const drift = assumptionDrift(doc);
  check("gammaG drifts", drift.some(d => d.key === "gammaG" && d.value === 1.35 && d.preset === GAMMA_G_DEFAULT), JSON.stringify(drift));
  check("gammaQ at its own default does not drift", !drift.some(d => d.key === "gammaQ"), JSON.stringify(drift));
  check("deflectionDiv drifts", drift.some(d => d.key === "deflectionDiv" && d.value === 200 && d.preset === DEFLECTION_DIV_DEFAULT), JSON.stringify(drift));
  check("steel.fy drifts", drift.some(d => d.key === "steelFy" && d.value === 355 && d.preset === STEEL_FY_DEFAULT), JSON.stringify(drift));
  check("nothing else is reported", drift.length === 3, JSON.stringify(drift));
}

{
  // The comfort marks (issue #61) ride in the same timber bundle.
  const doc: PlanDoc = emptyDoc();
  doc.materials = {
    timber: {
      fmk: 24, fvk: 4.0, e0mean: 11000, kmod: KMOD_DEFAULT, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT,
      comfort: { minHz: 6, maxPointMm: 1.0 },
    },
  };
  const drift = assumptionDrift(doc);
  check("comfort.minHz drifts", drift.some(d => d.key === "comfortMinHz" && d.value === 6 && d.preset === MIN_HZ_DEFAULT), JSON.stringify(drift));
  check("comfort.maxPointMm drifts", drift.some(d => d.key === "comfortMaxPointMm" && d.value === 1.0 && d.preset === MAX_POINT_MM_DEFAULT), JSON.stringify(drift));
  check("nothing else is reported", drift.length === 2, JSON.stringify(drift));
}

{
  // A genuinely custom class (matches none of TIMBER_CLASSES) reports
  // "timberClass"; picking a NAMED class does not, even though its figures
  // differ from the default C24.
  const custom: PlanDoc = emptyDoc();
  custom.materials = { timber: { fmk: 24, fvk: 4.0, e0mean: 11500, kmod: KMOD_DEFAULT, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT } };
  check("a custom mix reports timberClass", keys(assumptionDrift(custom)).includes("timberClass"), JSON.stringify(assumptionDrift(custom)));

  const c18 = TIMBER_CLASSES.find(c => c.id === "C18")!;
  const named: PlanDoc = emptyDoc();
  named.materials = { timber: { fmk: c18.fmk, fvk: c18.fvk, e0mean: c18.e0mean, kmod: KMOD_DEFAULT, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT } };
  check("choosing a named class (C18) is not drift, even though it differs from the C24 default",
    assumptionDrift(named).length === 0, JSON.stringify(assumptionDrift(named)));
}

{
  // assumptionDrift() is a pure read: computing it changes nothing about a
  // subsequent check on the same document.
  const doc: PlanDoc = emptyDoc();
  doc.materials = { timber: { fmk: 24, fvk: 4.0, e0mean: 11000, kmod: 1.0, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT } };
  const deck: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 71, d: 221 }, loadG: 500, loadQ: 1750,
  };
  const before = joistCheck(doc, deck);
  assumptionDrift(doc);
  const after = joistCheck(doc, deck);
  check("the drift row does not change any utilisation: the same check runs identically before and after",
    JSON.stringify(before) === JSON.stringify(after));
}

// ---- implausible-load flags -------------------------------------------------

{
  const lowestQ = Math.min(...DECK_USES.map(u => u.loadQ));
  const doc = emptyDoc();
  const flagged: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 71, d: 221 }, loadG: 500, loadQ: lowestQ - 1,
  };
  const r = joistCheck(doc, flagged);
  check("a loadQ below the lightest DECK_USES preset is flagged lowLoadQ", (r.flags ?? []).includes("lowLoadQ"), JSON.stringify(r.flags));

  const ordinary: Deck = { ...flagged, loadQ: DECK_USES.find(u => u.id === "wonen")!.loadQ };
  const r2 = joistCheck(doc, ordinary);
  check("an ordinary use-level loadQ is not flagged", !(r2.flags ?? []).includes("lowLoadQ"), JSON.stringify(r2.flags));
}

{
  // loadG below the deck's own computed self-weight (joist + decking).
  const doc = emptyDoc();
  const deck: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 71, d: 221 }, loadG: 1, loadQ: 1750,
  };
  const r = joistCheck(doc, deck);
  check("a loadG below the joists' own self-weight is flagged lowLoadG", (r.flags ?? []).includes("lowLoadG"), JSON.stringify(r.flags));

  const ordinary: Deck = { ...deck, loadG: 500 };
  const r2 = joistCheck(doc, ordinary);
  check("an ordinary permanent load is not flagged lowLoadG", !(r2.flags ?? []).includes("lowLoadG"), JSON.stringify(r2.flags));
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const zero: Beam = { id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, width: 100, depth: 150, loadKNm: 0 };
  const rZero = beamCheck(doc, f, zero);
  check("a beam stated with a zero load is flagged zeroLoad", (rZero.flags ?? []).includes("zeroLoad"), JSON.stringify(rZero.flags));

  const loaded: Beam = { ...zero, loadKNm: 1 };
  const rLoaded = beamCheck(doc, f, loaded);
  check("a beam with an ordinary load is not flagged", !(rLoaded.flags ?? []).includes("zeroLoad"), JSON.stringify(rLoaded.flags));
}

{
  // A lintel's own authored floor bearing (lintelLoadKNm), stated as exactly
  // zero -- the wall's self-weight is never authored, so this is the one
  // load a lintel can state at all.
  const doc = emptyDoc();
  const f: Floor = doc.floors[0]!;
  f.height = 2600;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 3000, y: 0 }];
  const w: Wall = { id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0, openings: [], material: "masonry" };
  f.walls = [w];
  const door: Opening = {
    id: newId("o"), sashes: [], kind: "door", t: 1500, width: 1000, sillHeight: 0, height: 2100,
    lintel: { w: 44, d: 195 }, lintelLoadKNm: 0,
  };
  const rZero = lintelCheck(doc, f, w, door);
  check("a lintel with an authored floor bearing of zero is flagged zeroLoad", (rZero.flags ?? []).includes("zeroLoad"), JSON.stringify(rZero.flags));

  const withoutExtra: Opening = { ...door, lintelLoadKNm: undefined };
  const rAbsent = lintelCheck(doc, f, w, withoutExtra);
  check("no authored floor bearing at all is not flagged (only a stated zero is)", !(rAbsent.flags ?? []).includes("zeroLoad"), JSON.stringify(rAbsent.flags));
}

{
  // Flags never change status, a utilisation or the proposal: a flagged
  // beam with a comfortably light (but nonzero) load still checks exactly
  // as an unflagged one would -- the flag rides beside the result, not
  // inside it.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const beam: Beam = { id: newId("b"), kind: "beam", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, width: 200, depth: 220, loadKNm: 0 };
  const r = beamCheck(doc, f, beam);
  check("a zero-load beam is still checked, not forced incomplete", r.status !== "incomplete", r.status);
  check("status is decided by checkSpan alone -- a passing beam still passes", r.status === "ok", r.status);
  check("no proposal is offered once the check already passes", r.proposal === undefined, JSON.stringify(r.proposal));
  const input = r.input as SpanInput;
  check("the flag changes nothing about the SpanInput/checkSpan result",
    JSON.stringify(checkSpan(input)) === JSON.stringify(r.check));
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
