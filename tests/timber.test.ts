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

// ---- point load (issue #64) -----------------------------------------------
//
// An off-centre point load's combined maximum (UDL + point) does not sit at
// the load itself or at midspan -- see core/timber.ts's own header. Hand
// case: L 4000 mm, a design UDL qd 1 N/mm, a characteristic UDL qk 0.8 N/mm,
// a point P 2000 N at a = 1000 mm (b = 3000 mm):
//
//   Combined moment M(x) for x in [a, L]:
//     M(x) = q*x*(L-x)/2 + P*a*(L-x)/L = (L-x)*(q*x/2 + P*a/L)
//   dM/dx = q*(L-2x)/2 - P*a/L = 0  =>  x* = L/2 - P*a/(q*L)
//         = 2000 - 2000*1000/(1*4000) = 2000 - 500 = 1500
//   M(1500) = (4000-1500)*(1*1500/2 + 2000*1000/4000) = 2500*(750+500)
//           = 2500*1250 = 3,125,000 N*mm
//
//   By contrast, evaluating only at the load and at midspan gives:
//     M(a=1000)    = q*1000*3000/2 + P*3000*1000/4000 = 1,500,000+1,500,000
//                  = 3,000,000
//     M(mid=2000)  = q*2000*2000/2 + P*1000*2000/4000 = 2,000,000+1,000,000
//                  = 3,000,000
//   Both 4% BELOW the true combined maximum at x = 1500 -- exactly the case
//   the issue calls out: the true maximum falls strictly between the point
//   load and midspan.
//
//   V = qd*L/2 + P*max(a,b)/L = 1*4000/2 + 2000*3000/4000 = 2000+1500 = 3500 N
//
// The deflection maximum has no equally short closed form (Roark's formulas,
// piecewise about a); it was found the same way checkSpan() itself does --
// sampling the combined curve, at 1 mm resolution independently of
// checkSpan()'s own 4000/400 = 10 mm grid -- giving w_inst = 15.086768 mm at
// x = 1905 mm, w_fin = w_inst*(1+kdef) = 15.086768*1.6 = 24.138829 mm,
// deflection = 24.138829 / (4000/250=16) = 1.508677.
//
// Section 44x195, TIMBER_DEFAULT (C24: kmod 0.8, fmk 24, fvk 4.0, gammaM
// 1.3, kdef 0.6) -- the same section and material as the plain-UDL case
// above, so W, I, A, fmd, fvd are unchanged: bending = M/W/fmd = 0.758790,
// shear = (1.5*V/A)/fvd = 0.248580.
{
  const input: SpanInput = {
    spanMm: 4000, qdNmm: 1, qkNmm: 0.8,
    section: { w: 44, d: 195 },
    material: TIMBER_DEFAULT,
    deflectionDiv: 250,
    points: [{ nd: 2000, nk: 2000, atMm: 1000 }],
  };
  const r = checkSpan(input);

  check("combined moment: true max (at x=1500) exceeds both candidate points",
    near(r.momentNmm, 3_125_000, 50), String(r.momentNmm));
  check("shear V = qd*L/2 + P*max(a,b)/L", near(r.shearN, 3500, 1), String(r.shearN));
  check("bending utilisation within 1%", near(r.bending, 0.758790, 0.0076), String(r.bending));
  check("shear utilisation within 1%", near(r.shear, 0.248580, 0.0025), String(r.shear));
  check("deflection (sampled combined maximum) within 0.5%",
    near(r.deflectionMm, 24.138829, 0.12), String(r.deflectionMm));
  check("deflection utilisation within 0.5%", near(r.deflection, 1.508677, 0.0075), String(r.deflection));
  check("deflection governs", r.governing === "deflection", r.governing);
  check("this span does not pass", r.passes === false);
}

// ---- two point loads at once (issue #64 follow-up) -------------------------
//
// A trimmer beside a hole reaching neither edge of the deck carries BOTH its
// headers' reactions at once -- the ordinary case for a hatch in the middle
// of a floor. Hand case: the issue's own 4200x3600 deck at 600 centres with
// a CENTRED 1000x2400 hole (tests/trimmer.test.ts works the geometry by
// hand): trimmer span L = 3700 mm, symmetric point loads at a1 = 650 mm and
// a2 = 3050 mm (b1 = 3050, b2 = 650), each nd = 677.25 N, nk = 472.5 N (the
// header's own reaction, g and q factored: gammaG*105 + gammaQ*367.5 =
// 1.2*105 + 1.5*367.5 = 126 + 551.25 = 677.25; characteristic 105+367.5 =
// 472.5). The trimmer's own UDL is the SAME figures joistCheck() would use
// at this deck (qd 1.935 N/mm, qk 1.35 N/mm -- see the very first hand case
// in this file).
//
// Superposing the UDL and both point-load moment diagrams and evaluating at
// both load points and at midspan (by the symmetry of this centred hole,
// a1 and a2 sit equally far from their own ends, so the true maximum has to
// be at one of these three candidates, not strictly between them the way a
// single off-centre load's is):
//
//   M(x) = qd*x*(L-x)/2 + nd*b1*x/L (x<=a1, else nd*a1*(L-x)/L)
//                       + nd*b2*x/L (x<=a2, else nd*a2*(L-x)/L)
//   b1 = L-a1 = 3050, b2 = L-a2 = 650
//
//   M(a1=650): x<=a1 (boundary) for point 1, x<=a2 for point 2.
//     UDL   = 1.935*650*3050/2         = 1,918,068.75
//     point1 (b1*x/L)  = 677.25*3050*650/3700 =   362,877.87
//     point2 (b2*x/L)  = 677.25*650*650/3700  =    77,334.63
//     total = 2,358,281.25 -- by symmetry M(a2) is the same.
//
//   M(mid=1850): x>a1 for point 1 (a1*(L-x)/L), x<=a2 for point 2 (b2*x/L);
//   by symmetry both point terms come out equal:
//     UDL    = 1.935*1850*1850/2       = 3,311,268.75
//     point1 = 677.25*650*1850/3700    =   220,106.25
//     point2 = 677.25*650*1850/3700    =   220,106.25
//     total  = 3,751,481.25
//
//   So the combined maximum is at MIDSPAN (M = 3,751,481.25 N*mm), the exact
//   symmetric case: two equal point loads placed symmetrically about
//   midspan, plus a symmetric UDL, cannot peak anywhere but the centre --
//   both a1 and a2 giving the SAME, lower value confirms it, rather than
//   the single-point case's off-centre maximum.
//
//   This is LARGER than checking either point load alone: against this same
//   L=3700/qd=1.935 fixture, a1's point load by itself peaks off-centre at
//   x≈1788.5, M ≈ 3,535,033 N*mm (found by sampling, no shorter closed form
//   -- an off-centre single point's own maximum, as in the case above) --
//   about 6% below the true combined figure, understating the trimmer's
//   real moment exactly the way checking each header independently used to.
//
//   Shear: R1 = R2 = qd*L/2 + nd*(b1+b2)/L = 1.935*3700/2 +
//          677.25*(3050+650)/3700 = 3,579.75 + 677.25*3700/3700 = 3,579.75
//          + 677.25 = 4,257 N (both supports equal, again by symmetry).
{
  const L = 3700, qd = 1.935, qk = 1.35;
  const a1 = 650, a2 = 3050, nd = 677.25, nk = 472.5;
  const input: SpanInput = {
    spanMm: L, qdNmm: qd, qkNmm: qk,
    section: { w: 88, d: 195 }, // the trimmer's own doubled section
    material: TIMBER_DEFAULT,
    deflectionDiv: 250,
    points: [{ nd, nk, atMm: a1 }, { nd, nk, atMm: a2 }],
  };
  const both = checkSpan(input);
  const near1 = checkSpan({ ...input, points: [{ nd, nk, atMm: a1 }] });

  check("combined moment (both points) matches the hand calculation",
    near(both.momentNmm, 3_751_481, 50), String(both.momentNmm));
  check("combined moment is larger than with either point load alone",
    both.momentNmm > near1.momentNmm, `${both.momentNmm} vs ${near1.momentNmm}`);
  check("the single-point moment matches its own (off-centre) hand case",
    near(near1.momentNmm, 3_535_033, 50), String(near1.momentNmm));
  check("shear R1 = R2 = qd*L/2 + nd*(b1+b2)/L = 4257 N", near(both.shearN, 4257, 1), String(both.shearN));
  check("bending utilisation matches (doubled 88x195 section)",
    near(both.bending, 0.45545, 0.005), String(both.bending));
  check("shear utilisation matches", near(both.shear, 0.15117, 0.002), String(both.shear));
  check("deflection utilisation matches (governs, but passes)",
    near(both.deflection, 0.68653, 0.007), String(both.deflection));
  check("this trimmer passes with both point loads (governed by deflection)", both.passes === true);
  check("deflection governs", both.governing === "deflection", both.governing);
}

// ---- deflection uses nk, not nd --------------------------------------------
//
// Isolate the split: no UDL (qd = qk = 0), one point load at midspan so
// deflection is driven ENTIRELY by that one point's own nk. Swapping nd and
// nk between two otherwise-identical calls must scale the deflection by
// exactly the nd:nk ratio of the FIRST call (3), since deflection is linear
// in the point load and depends only on nk -- if the code used nd instead,
// the swapped call would come back IDENTICAL (nd and nk trade places, so
// "using nd" would read the same number both times) rather than scaled.
{
  const base = {
    spanMm: 4000, qdNmm: 0, qkNmm: 0,
    section: { w: 44, d: 195 }, material: TIMBER_DEFAULT, deflectionDiv: 250,
  };
  const original = checkSpan({ ...base, points: [{ nd: 3000, nk: 1000, atMm: 2000 }] });
  const swapped = checkSpan({ ...base, points: [{ nd: 1000, nk: 3000, atMm: 2000 }] });

  check("deflection scales with nk (swapped nk=3000 vs original nk=1000 -> x3)",
    near(swapped.deflectionMm, original.deflectionMm * 3, 0.001),
    `${swapped.deflectionMm} vs ${original.deflectionMm}`);
  check("bending scales with nd instead (swapped nd=1000 vs original nd=3000 -> /3)",
    near(swapped.bending, original.bending / 3, 0.0005), `${swapped.bending} vs ${original.bending}`);
  check("deflection is NOT identical between the two calls (would be, if nd drove it)",
    Math.abs(swapped.deflectionMm - original.deflectionMm) > 1);
}

// A point load of zero width but non-zero magnitude still exercises the
// sampling path -- a header/trimmer test double-checks that separately
// (tests/trimmer.test.ts); here, points = [] (and, for good measure, a
// zero-magnitude point at various positions) must reduce to the plain-UDL
// result bit-for-bit.
{
  const base: Omit<SpanInput, "points"> = {
    spanMm: 3600, qdNmm: 1.935, qkNmm: 1.35,
    section: { w: 44, d: 195 }, material: TIMBER_DEFAULT, deflectionDiv: 250,
  };
  const withoutPoints = checkSpan(base);
  const withEmptyArray = checkSpan({ ...base, points: [] });
  check("points: [] identity: moment unchanged",
    withEmptyArray.momentNmm === withoutPoints.momentNmm, String(withEmptyArray.momentNmm));
  check("points: [] identity: shear unchanged", withEmptyArray.shearN === withoutPoints.shearN);
  check("points: [] identity: deflection unchanged", withEmptyArray.deflectionMm === withoutPoints.deflectionMm);
  check("points: [] identity: passes unchanged", withEmptyArray.passes === withoutPoints.passes);

  for (const atMm of [0, 900, 1800, 2700, 3600]) {
    const withZeroPoint = checkSpan({ ...base, points: [{ nd: 0, nk: 0, atMm }] });
    check(`zero-point identity at atMm=${atMm}: moment unchanged`,
      near(withZeroPoint.momentNmm, withoutPoints.momentNmm, 0.5), String(withZeroPoint.momentNmm));
    check(`zero-point identity at atMm=${atMm}: shear unchanged`,
      withZeroPoint.shearN === withoutPoints.shearN, String(withZeroPoint.shearN));
    check(`zero-point identity at atMm=${atMm}: deflection unchanged`,
      near(withZeroPoint.deflectionMm, withoutPoints.deflectionMm, 0.001), String(withZeroPoint.deflectionMm));
    check(`zero-point identity at atMm=${atMm}: passes unchanged`,
      withZeroPoint.passes === withoutPoints.passes);
    check(`zero-point identity at atMm=${atMm}: governing unchanged`,
      withZeroPoint.governing === withoutPoints.governing);
  }
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
