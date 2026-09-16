// core/comfort.ts: the pure natural-frequency and 1 kN point-load deflection
// check (checkComfort()), and its two applications in core/checks.ts's
// joistCheck() -- deriving a deck's own mass and decking stiffness from its
// stated facts, and keeping `comfort` separate from the strength `status`
// (issue #61). checkComfort() itself is pinned by hand-worked figures here,
// the way core/timber.ts's checkSpan() is pinned in tests/timber.test.ts.
import { checkComfort, spreadJoists, DECKING_E_MPA, type ComfortInput } from "../src/core/comfort";
import { emptyDoc, type Floor } from "../src/model/doc";
import type { Deck } from "../src/model/deck";
import { joistCheck } from "../src/core/checks";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol: number): boolean { return Math.abs(a - b) <= tol; }

// ── hand-worked case -------------------------------------------------------
//
// A 44x220 C24 joist at 600 mm centres, 4200 mm span, 50 kg/m² of mass
// (self weight plus permanent load, not variable), no decking stated. By
// hand:
//
//   I  = w*d^3/12 = 44*220^3/12 = 44*10,648,000/12 = 39,042,666.667 mm^4
//   EI = e0mean*I = 11000 * 39,042,666.667 = 429,469,333,333.3 N*mm^2
//
// Frequency, f1 = (pi/2)*sqrt(EI/(m*L^4)) -- deriving the numeric factor
// that turns E(N/mm^2), I(mm^4), L(mm) and massKgM2(kg/m^2) directly into
// Hz (see core/comfort.ts's own header for the full derivation):
//
//   E(N/m^2)  = E*1e6            I(m^4) = I*1e-12
//   EI(N*m^2) = E*I*1e-6
//   L(m)^4    = L^4*1e-12
//   m(kg/m)   = massKgM2*centresMm*1e-3
//
//   EI/(m*L^4) [SI] = (E*I)/(massKgM2*centresMm*L^4) * 1e9
//
//   massKgM2*centresMm = 50*600 = 30,000
//   L^4 = 4200^4 = 311,169,600,000,000
//   ratio = EI/(30,000*311,169,600,000,000) * 1e9
//         = 429,469,333,333.3/9,335,088,000,000,000,000 * 1e9
//         = 46.0059
//   f1 = (pi/2)*sqrt(46.0059) = 1.570796*6.78277 = 10.6543 Hz
//
// Point-load deflection, a = F*L^3/(48*EI), F = 1000 N -- no unit-conversion
// factor needed (N*mm^3/(N*mm^2) = mm directly):
//
//   L^3 = 4200^3 = 74,088,000,000
//   a = 1000*74,088,000,000 / (48*429,469,333,333.3)
//     = 74,088,000,000,000 / 20,614,528,000,000
//     = 3.5940 mm
//
// Against the indicative defaults (minHz 8, maxPointMm 1.0): frequency
// utilisation 8/10.6543 = 0.751 (passes); point utilisation 3.5940/1.0 =
// 3.594 (fails, by a wide margin) -- point governs, and the whole check
// fails. This is the concrete case the issue is about: a joist can be sized
// generously for bending and deflection and still read as failing comfort
// by a wide margin under an ordinary 1 kN point load.
{
  const input: ComfortInput = {
    spanMm: 4200, centresMm: 600, section: { w: 44, d: 220 }, e0mean: 11000,
    massKgM2: 50, minHz: 8, maxPointMm: 1.0,
  };
  const r = checkComfort(input);
  check("frequency matches the hand-worked figure", near(r.hz, 10.6543, 0.02), String(r.hz));
  check("point deflection matches the hand-worked figure", near(r.pointMm, 3.5940, 0.01), String(r.pointMm));
  check("frequency alone passes (8 / 10.6543 = 0.751)", r.hz >= r.minHz);
  check("point deflection fails (3.594 mm against a 1 mm mark)", r.pointMm > r.maxPointMm);
  check("point governs (further from its own limit)", r.governing === "point", r.governing ?? "null");
  check("the whole comfort check fails", r.passes === false);
  check("no decking stated: point deflection is the single-joist figure (no spreading)",
    near(r.pointMm, (1000 * 4200 ** 3) / (48 * 11000 * ((44 * 220 ** 3) / 12)), 1e-6));
}

// ── halving the centres raises the frequency by the expected factor -------
//
// f1 ~ 1/sqrt(m*centres) with everything else held fixed, so halving the
// centres (600 -> 300) halves massKgM2*centresMm and raises f1 by sqrt(2).
{
  const base: ComfortInput = {
    spanMm: 4200, centresMm: 600, section: { w: 44, d: 220 }, e0mean: 11000,
    massKgM2: 50, minHz: 8, maxPointMm: 1.0,
  };
  const wide = checkComfort(base);
  const tight = checkComfort({ ...base, centresMm: 300 });
  check("halving the centres raises the frequency by sqrt(2)",
    near(tight.hz, wide.hz * Math.SQRT2, 0.01), `${wide.hz} -> ${tight.hz} (expected x${Math.SQRT2.toFixed(5)})`);
  check("point deflection is unaffected by centres alone (no decking to spread over)",
    near(tight.pointMm, wide.pointMm, 1e-9));
}

// ── deck spreading: conservative by default, capped when it applies -------
{
  const base: ComfortInput = {
    spanMm: 4200, centresMm: 600, section: { w: 44, d: 220 }, e0mean: 11000, massKgM2: 50, minHz: 8, maxPointMm: 1.0,
  };
  const noDeck = checkComfort(base);
  check("no decking stated (deckEiPerMm absent) shares the load over exactly one joist -- the conservative default",
    near(noDeck.pointMm, 3.5940, 0.01), String(noDeck.pointMm));

  // A deck spreads a footstep sideways over the joists either side: the
  // effective width is the span times the fourth root of the deck's own
  // stiffness across the joists against the joists' along the span, so a
  // stiffer or thicker deck spreads further and a bare joist spreads none.
  const jointEiPerMm = (11000 * ((44 * 220 ** 3) / 12)) / 600;
  const deck18 = (DECKING_E_MPA * 18 ** 3) / 12;
  const spread18 = spreadJoists(11000 * ((44 * 220 ** 3) / 12), 4200, 600, deck18);
  check("an 18 mm deck spreads a point load over more than one joist, and not many",
    spread18 > 1.2 && spread18 < 2.5, String(spread18));
  const with18 = checkComfort({ ...base, deckEiPerMm: deck18 });
  check("and the deflection falls by exactly that share",
    near(with18.pointMm, noDeck.pointMm / spread18, 1e-6), `${with18.pointMm} vs ${noDeck.pointMm / spread18}`);
  const thicker = checkComfort({ ...base, deckEiPerMm: (DECKING_E_MPA * 22 ** 3) / 12 });
  check("a thicker deck spreads further still", thicker.pointMm < with18.pointMm,
    `${thicker.pointMm} vs ${with18.pointMm}`);
  const absurd = checkComfort({ ...base, deckEiPerMm: jointEiPerMm * 1000 });
  check("and the spread is capped: no deck shares a footstep over more than four joists",
    near(absurd.pointMm, noDeck.pointMm / 4, 1e-6), String(absurd.pointMm));
}

// ── governing switches as the span changes ---------------------------------
//
// Frequency utilisation scales with L^2 (minHz/hz, hz ~ 1/L^2); point
// utilisation scales with L^3 (pointMm/maxPointMm, pointMm ~ L^3). At a
// short span the L^2 term is relatively larger, so frequency governs; past
// the crossover the L^3 term overtakes and point governs -- for this
// section/centres/mass the crossover sits under 900 mm, so a short span
// (600 mm) governs on frequency and the 4200 mm case above governs on
// point.
{
  const base: ComfortInput = {
    centresMm: 600, section: { w: 44, d: 220 }, e0mean: 11000, massKgM2: 50, minHz: 8, maxPointMm: 1.0, spanMm: 0,
  };
  const short = checkComfort({ ...base, spanMm: 600 });
  const long = checkComfort({ ...base, spanMm: 4200 });
  check("a short span governs on frequency", short.governing === "frequency", short.governing ?? "null");
  check("a short span comfortably passes both figures", short.passes === true);
  check("frequency falls as span grows (600 -> 4200)", long.hz < short.hz, `${short.hz} -> ${long.hz}`);
  check("the long span governs on point deflection instead", long.governing === "point", long.governing ?? "null");
}

// ── degenerate input: nothing computable reports governing null -----------
{
  const r = checkComfort({
    spanMm: 0, centresMm: 600, section: { w: 44, d: 220 }, e0mean: 11000, massKgM2: 0, minHz: 8, maxPointMm: 1.0,
  });
  check("a zero span and zero mass compute neither figure", r.hz === 0 && !isFinite(r.pointMm));
  check("governing is null when neither figure could be computed", r.governing === null);
  check("passes is false, not a vacuous true, when nothing could be computed", r.passes === false);
}

// ── joistCheck(): comfort wired from a deck's own facts --------------------

function deckDoc(loadG: number | undefined, loadQ: number | undefined, spanMm: number, deckingMm?: number) {
  const doc = emptyDoc();
  const f: Floor = doc.floors[0]!;
  const deck: Deck = {
    id: "d1", x: 0, y: 0, rotation: 0, width: 2400, depth: spanMm,
    joistAxis: "y", joistMm: 600, joist: { w: 44, d: 220 }, bearingMm: 0,
    loadG, loadQ, deckingMm,
  };
  f.decks = [deck];
  return { doc, f, deck };
}

{
  // No permanent load stated at all: the mass cannot be assumed, so comfort
  // is not computed -- "loadG" names the reason distinctly from "load" (the
  // strength check's own, coarser requirement of both loadG and loadQ).
  const { doc, deck } = deckDoc(undefined, 1750, 4200);
  const r = joistCheck(doc, deck);
  check("no comfort figure without a stated permanent load", r.comfort === undefined);
  check("missing names loadG specifically", r.missing.includes("loadG"), JSON.stringify(r.missing));
  check("status is incomplete (the strength check also needs loadG)", r.status === "incomplete", r.status);
}

{
  // loadQ alone missing: the strength check is still incomplete (it needs
  // both), but comfort only needs the permanent load and the joist section,
  // so it IS computed here -- comfort is not gated on the strength result.
  const { doc, deck } = deckDoc(500, undefined, 4200);
  const r = joistCheck(doc, deck);
  check("status is incomplete (loadQ is still missing for strength)", r.status === "incomplete", r.status);
  check("missing does not name loadG (the permanent load is stated)", !r.missing.includes("loadG"), JSON.stringify(r.missing));
  check("missing still names load (loadQ absent)", r.missing.includes("load"), JSON.stringify(r.missing));
  check("comfort is computed anyway, from the stated permanent load alone", r.comfort !== undefined);
}

{
  // A floor that fails comfort but passes strength is still `status: "ok"`
  // for strength -- comfort is reported entirely separately. 44x220 at 600
  // centres over 3600 mm under "wonen" loads (500/1750 N/m^2) passes bending,
  // shear and deflection with room to spare (deflection, the governing one,
  // at about three quarters of its limit), and still lands over the 1.5 mm
  // comfort mark once the deck's own spreading is allowed for: a footstep on
  // one joist is a = 1000*3600^3/(48*EI) = 2.265 mm shared over the joists an
  // 18 mm deck reaches, which is what makes a loft floor of ordinary spans
  // feel lively without anything about its strength being wrong.
  const { doc, deck } = deckDoc(500, 1750, 3600);
  const r = joistCheck(doc, deck);
  check("strength status is ok (bending, shear and deflection all pass)", r.status === "ok", r.status);
  check("check.passes is true (the strength result itself)", r.check?.passes === true);
  check("comfort is present", r.comfort !== undefined);
  check("comfort fails on the point-load figure",
    r.comfort !== undefined && !r.comfort.passes && r.comfort.governing === "point",
    JSON.stringify(r.comfort));
  check("the frequency figure itself passes -- it is the footstep that does not",
    (r.comfort?.hz ?? 0) > (r.comfort?.minHz ?? Infinity), JSON.stringify(r.comfort));
}

{
  // Decking thickness feeds deckEiPerMm (DECKING_E_MPA * t^3/12) and its
  // own self weight into the mass -- both should move the comfort figure
  // relative to the same deck with no decking stated.
  const { doc: docPlain, deck: deckPlain } = deckDoc(500, 1750, 4200);
  const plain = joistCheck(docPlain, deckPlain);
  const { doc: docDecked, deck: deckDecked } = deckDoc(500, 1750, 4200, 18);
  const decked = joistCheck(docDecked, deckDecked);
  check("stated decking adds self weight, lowering the frequency", decked.comfort !== undefined
    && plain.comfort !== undefined && decked.comfort.hz < plain.comfort.hz,
    `${plain.comfort?.hz} -> ${decked.comfort?.hz}`);
  check("stated decking spreads the point load, lowering its deflection", decked.comfort !== undefined
    && plain.comfort !== undefined && decked.comfort.pointMm < plain.comfort.pointMm,
    `${plain.comfort?.pointMm} -> ${decked.comfort?.pointMm}`);
  check("DECKING_E_MPA is a fixed, positive indicative modulus", DECKING_E_MPA > 0);
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
