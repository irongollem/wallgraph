// core/timber.ts: the pure simply-supported, uniformly-distributed-load span
// check applied by core/checks.ts's three applications. checkSpan() and
// checkSteelSpan() know nothing about the document -- every input here is
// already in N, mm and N/mm² -- so this file pins the calculation itself.
import { checkSpan, checkSteelSpan, proposeSection, STEEL_E_MPA, type SpanInput } from "../src/core/timber";
import { TIMBER_DEFAULT, SECTIONS_DEFAULT, timberOf } from "../src/model/materials";
import { emptyDoc } from "../src/model/doc";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol: number): boolean { return Math.abs(a - b) <= tol; }

// ---- hand-worked case ---------------------------------------------------
//
// A 44x195 C24 joist at 600 mm centres, 3600 mm span, g 0.5 kN/m² and
// q 1.75 kN/m² -- the issue's own worked example. By hand, with the
// indicative partial factors gammaG 1.2, gammaQ 1.5 and deflection limit
// L/250:
//
//   g_line = 0.5 * 0.6 = 0.3 N/mm     (kN/m and N/mm are the same number)
//   q_line = 1.75 * 0.6 = 1.05 N/mm
//   qd = 1.2*0.3 + 1.5*1.05 = 1.935 N/mm
//   qk = 0.3 + 1.05 = 1.35 N/mm
//
//   M = qd*L^2/8 = 1.935 * 3600^2 / 8 = 3,134,700 N*mm
//   V = qd*L/2   = 1.935 * 3600 / 2   = 3,483 N
//
//   W = w*d^2/6  = 44 * 195^2 / 6  = 278,850 mm^3
//   I = w*d^3/12 = 44 * 195^3 / 12 = 27,187,875 mm^4
//   A = w*d      = 44 * 195       = 8,580 mm^2
//
//   fmd = kmod*fmk/gammaM = 0.8*24/1.3 = 14.76923 N/mm^2
//   fvd = kmod*fvk/gammaM = 0.8*4.0/1.3 = 2.46154 N/mm^2
//
//   sigma = M/W = 3,134,700 / 278,850 = 11.241528 N/mm^2
//   bending = sigma/fmd = 11.241528 / 14.769231 = 0.761145
//
//   tau = 1.5*V/A = 1.5*3483/8580 = 0.608916 N/mm^2
//   shear = tau/fvd = 0.608916 / 2.461538 = 0.247372
//
//   w_inst = 5*qk*L^4 / (384*E*I) = 5*1.35*3600^4 / (384*11000*27,187,875)
//          = 1,133,740,800,000,000 / 114,841,584,000,000 = 9.872215 mm
//   w_fin = w_inst*(1+kdef) = 9.872215 * 1.6 = 15.795544 mm
//   limit = L/250 = 3600/250 = 14.4 mm
//   deflection = w_fin/limit = 15.795544 / 14.4 = 1.096913
//
// Deflection governs and exceeds 1.0: this joist does not pass at the
// document's indicative defaults -- a genuine result, not a contrived one.
{
  const input: SpanInput = {
    spanMm: 3600,
    qdNmm: 1.935,
    qkNmm: 1.35,
    section: { w: 44, d: 195 },
    material: TIMBER_DEFAULT, // C24, kmod 0.8, gammaM 1.3, kdef 0.6
    deflectionDiv: 250,
  };
  const r = checkSpan(input);

  check("moment M = qd*L^2/8", near(r.momentNmm, 3_134_700, 1), String(r.momentNmm));
  check("shear V = qd*L/2", near(r.shearN, 3483, 1), String(r.shearN));

  check("bending utilisation within 1%", near(r.bending, 0.761145, 0.008), String(r.bending));
  check("shear utilisation within 1%", near(r.shear, 0.247372, 0.0025), String(r.shear));

  check("deflection (instantaneous + creep) within 1%", near(r.deflectionMm, 15.795544, 0.16), String(r.deflectionMm));
  check("limit is L/250", r.limitMm === 14.4, String(r.limitMm));
  check("deflection utilisation within 1%", near(r.deflection, 1.096913, 0.011), String(r.deflection));

  check("deflection governs", r.governing === "deflection", r.governing);
  check("the joist does not pass (deflection exceeds 1.0)", r.passes === false);
}

// ---- proposeSection -------------------------------------------------------

{
  // A light load over a short span: the smallest default section should
  // pass outright, so proposeSection must return exactly that one.
  const base: Omit<SpanInput, "section"> = {
    spanMm: 1200, qdNmm: 0.2, qkNmm: 0.15, material: TIMBER_DEFAULT, deflectionDiv: 250,
  };
  const smallest = SECTIONS_DEFAULT[0]!;
  check("the lightest default section already passes this light load",
    checkSpan({ ...base, section: smallest }).passes);
  const proposed = proposeSection(base, SECTIONS_DEFAULT);
  check("proposeSection returns the first (smallest) passing section",
    JSON.stringify(proposed) === JSON.stringify(smallest), JSON.stringify(proposed));
}

{
  // A load heavy enough that only a larger section in the middle of the
  // list passes: proposeSection must skip every smaller one that fails.
  const base: Omit<SpanInput, "section"> = {
    spanMm: 2400, qdNmm: 1.2, qkNmm: 0.9, material: TIMBER_DEFAULT, deflectionDiv: 250,
  };
  const results = SECTIONS_DEFAULT.map(s => ({ s, passes: checkSpan({ ...base, section: s }).passes }));
  const firstPassing = results.find(r => r.passes)?.s ?? null;
  const proposed = proposeSection(base, SECTIONS_DEFAULT);
  check("some default section passes this load (fixture is not degenerate)", firstPassing !== null);
  const proposedIndex = results.findIndex(r => r.s.w === proposed?.w && r.s.d === proposed?.d);
  check("every section before the proposal fails", results.slice(0, proposedIndex).every(r => !r.passes));
  check("proposeSection returns the smallest passing section",
    JSON.stringify(proposed) === JSON.stringify(firstPassing), `${JSON.stringify(proposed)} vs ${JSON.stringify(firstPassing)}`);
}

{
  // A load no default section can carry: null.
  const base: Omit<SpanInput, "section"> = {
    spanMm: 8000, qdNmm: 20, qkNmm: 15, material: TIMBER_DEFAULT, deflectionDiv: 250,
  };
  check("every default section fails this load", SECTIONS_DEFAULT.every(s => !checkSpan({ ...base, section: s }).passes));
  check("proposeSection returns null when nothing passes", proposeSection(base, SECTIONS_DEFAULT) === null);
}

// ---- checkSteelSpan --------------------------------------------------------
//
// HEA 200 (wy 389 cm^3 = 389,000 mm^3, iy 3692 cm^4 = 36,920,000 mm^4),
// fy 235 N/mm^2, a 4000 mm span, qd 5 N/mm, qk 3.5 N/mm, L/250:
//
//   M = 5 * 4000^2 / 8 = 10,000,000 N*mm
//   bending = M/Wy/fy = 10,000,000 / 389,000 / 235 = 0.109391
//
//   w_inst = 5*3.5*4000^4 / (384*210000*36,920,000) = 1.504755 mm
//   limit = 4000/250 = 16 mm
//   deflection = 1.504755/16 = 0.094047
{
  const r = checkSteelSpan({
    spanMm: 4000, qdNmm: 5, qkNmm: 3.5,
    wyMm3: 389 * 1000, iyMm4: 3692 * 10000,
    fy: 235, deflectionDiv: 250,
  });
  check("steel E is 210000 N/mm^2", STEEL_E_MPA === 210000);
  check("steel moment M = qd*L^2/8", near(r.momentNmm, 10_000_000, 1), String(r.momentNmm));
  check("steel bending utilisation within 1%", near(r.bending, 0.109391, 0.0011), String(r.bending));
  check("steel deflection utilisation within 1%", near(r.deflection, 0.094047, 0.0009), String(r.deflection));
  check("steel shear is not checked (reported as 0, never governs)", r.shear === 0);
  check("bending governs over deflection here", r.governing === "bending");
  check("this beam passes", r.passes === true);
}

{
  // Least timber, not least depth: at 3600 mm and ordinary loads a 44 x 220
  // passes on a third less timber than the 71 x 196 a depth-ordered list
  // reaches first.
  const base = {
    spanMm: 3600,
    qdNmm: (1.2 * 0.5 + 1.5 * 1.75) * 0.6,
    qkNmm: (0.5 + 1.75) * 0.6,
    material: { ...TIMBER_DEFAULT },
    deflectionDiv: 250,
  };
  const proposed = proposeSection(base, SECTIONS_DEFAULT)!;
  const passing = SECTIONS_DEFAULT.filter(sec => checkSpan({ ...base, section: sec }).passes);
  check("proposeSection returns the passing section with the least timber",
    passing.every(sec => sec.w * sec.d >= proposed.w * proposed.d),
    `${proposed.w}x${proposed.d} vs ${JSON.stringify(passing)}`);
}

// ---- timberOf validation ---------------------------------------------------
//
// A pasted gammaM: 0 must not reach checkSpan(): fmd = kmod*fmk/gammaM would
// be infinite, and an infinite design strength always "passes" -- so
// timberOf() validates each of the six figures individually (finite and > 0)
// and falls back to TIMBER_DEFAULT's own field, one at a time.
{
  const doc = emptyDoc();
  doc.materials = { timber: { ...TIMBER_DEFAULT, gammaM: 0 } };
  const t = timberOf(doc);
  check("an invalid gammaM (0) falls back to the default", t.gammaM === TIMBER_DEFAULT.gammaM, String(t.gammaM));
  check("the other five figures are carried through unchanged",
    t.fmk === TIMBER_DEFAULT.fmk && t.fvk === TIMBER_DEFAULT.fvk && t.e0mean === TIMBER_DEFAULT.e0mean
    && t.kmod === TIMBER_DEFAULT.kmod && t.kdef === TIMBER_DEFAULT.kdef,
    JSON.stringify(t));
}

{
  // Each figure is validated on its own: a non-finite fmk falls back without
  // disturbing a genuinely custom fvk alongside it.
  const doc = emptyDoc();
  doc.materials = { timber: { ...TIMBER_DEFAULT, fmk: NaN, fvk: 9.9 } };
  const t = timberOf(doc);
  check("a non-finite fmk falls back to the default", t.fmk === TIMBER_DEFAULT.fmk, String(t.fmk));
  check("a genuinely custom fvk is kept", t.fvk === 9.9, String(t.fvk));
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
