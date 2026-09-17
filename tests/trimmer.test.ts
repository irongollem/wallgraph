// core/trimmer.ts: what a hole in a deck (a stair opening or a vide) does to
// its joists -- the cut joists, the header(s) across the hole and the
// doubled trimmer(s) either side (issue #64). core/checks.ts's headerCheck()
// and trimmerCheck() apply core/timber.ts's point-load extension (pinned in
// tests/timber.test.ts) to these; core/materials.ts's deckTakeoffOf() counts
// them into the materiaalstaat.
import { emptyDoc, newId, type Floor, type PlanDoc } from "../src/model/doc";
import type { Deck } from "../src/model/deck";
import type { Vide } from "../src/model/vide";
import { trimDeck, deckJoistLayout, type JoistSegment } from "../src/core/trimmer";
import { headerCheck, trimmerCheck } from "../src/core/checks";
import { deckTakeoffOf } from "../src/core/materials";
import { TIMBER_DEFAULT } from "../src/model/materials";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol: number): boolean { return Math.abs(a - b) <= tol; }

function docWithDeck(deckOver: Partial<Deck> = {}): { doc: PlanDoc; f: Floor; d: Deck } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const d: Deck = {
    id: newId("dk"), x: 1000, y: 500, rotation: 0,
    width: 4200, depth: 3600, joistAxis: "y", joistMm: 600,
    joist: { w: 44, d: 195 }, loadG: 500, loadQ: 1750,
    ...deckOver,
  };
  f.decks = [d];
  return { doc, f, d };
}

function vide(over: Partial<Vide>): Vide {
  return { id: newId("vd"), x: 0, y: 0, rotation: 0, width: 100, depth: 100, ...over };
}

// ---- hand-worked case: 4200 x 3600 deck at 600 centres, 1000 x 2400 hole --
//
// Deck: width 4200 (across the joists), depth 3600 (the joist span, since
// joistAxis "y"), joist 44x195, centres 600, bearing the default 100 mm,
// loadG 500 N/m^2 + loadQ 1750 N/m^2 ("wonen").
//
// Joist set-out (deckJoistsLocal(), core/deck.ts): the across extent is
// inset by the joist's own half-width at each edge -- 4200 - 44 = 4156 mm.
// 4156 / 600 = 6.93, rounded UP to 7 bays, so the spacing is 4156/7 =
// 593.71 mm and the 8 joists sit symmetrically about the centre at
// +-296.86, +-890.57, +-1484.29, +-2078 mm.
//
// Hole: 1000 mm across (left -500, right 500), 2400 mm along the span,
// centred (from -1200, to 1200) -- neither end reaches the deck's own span
// edge (+-1800), so both ends get a header.
//
//   Cut joists: only +-296.86 fall inside [-500, 500] -- 2 joists cut, 6
//   run past the hole untouched.
//
//   Each cut joist's own stub (box distance to the hole edge, plus the
//   bearing at its true wall end): from -1800 to -1200 is 600 mm, +100 mm
//   bearing = 700 mm at each end (symmetric, since the hole is centred).
//
//   Header span = hole width + bearing = 1000 + 100 = 1100 mm.
//
//   Each cut joist's own reaction at the header = (line load * stub)/2,
//   line load = (500+1750) N/m^2 * 0.6 m / 1e6 = 1.35 N/mm:
//     per-joist reaction = 1.35 * 700 / 2 = 472.5 N
//   The header itself, simply supported on the two trimmers, delivers half
//   of its own total (2 joists * 472.5 N) to each trimmer:
//     reactionN = 2 * 472.5 / 2 = 472.5 N  (matches (cut*q*stub)/4 exactly:
//     2*1.35*700/4 = 472.5)
//
//   Trimmer span = deck span + bearing = 3600 + 100 = 3700 mm (the same
//   figure joistCheck() would report for an ordinary joist here). The near
//   header's point load lands at bearing/2 + (from - (-spanHalf)) =
//   50 + 600 = 650 mm from the near support; the far one, by symmetry, at
//   3700 - 650 = 3050 mm.
{
  const { f, d } = docWithDeck();
  f.vides = [vide({ x: d.x, y: d.y, width: 1000, depth: 2400 })];
  const trimmed = trimDeck(f, d);

  check("2 openings-worth of joists cut, 6 run past the hole",
    trimmed.fullJoists === 6, String(trimmed.fullJoists));
  check("one cut-joist group (symmetric hole -> equal stubs both ends), count 4",
    trimmed.cutJoists.length === 1 && trimmed.cutJoists[0]!.count === 4,
    JSON.stringify(trimmed.cutJoists));
  check("cut joist stub length is 700 mm", near(trimmed.cutJoists[0]!.lengthMm, 700, 0.01),
    String(trimmed.cutJoists[0]!.lengthMm));

  check("two headers (hole is interior, neither end at the deck's edge)",
    trimmed.headers.length === 2, String(trimmed.headers.length));
  for (const h of trimmed.headers) {
    check("header span = hole width + bearing = 1100 mm", near(h.spanMm, 1100, 0.01), String(h.spanMm));
    check("header carries 2 joists", h.carriesJoists === 2, String(h.carriesJoists));
    // g line = 500*0.6/1e6 = 0.3 N/mm, q line = 1750*0.6/1e6 = 1.05 N/mm;
    // reaction = (2 joists * line * 700mm stub)/4, g and q kept apart.
    check("header reactionG = (2*0.3*700)/4 = 105 N", near(h.reactionG, 105, 0.01), String(h.reactionG));
    check("header reactionQ = (2*1.05*700)/4 = 367.5 N", near(h.reactionQ, 367.5, 0.01), String(h.reactionQ));
    check("g+q reaction = 472.5 N, matching the pre-split combined figure",
      near(h.reactionG + h.reactionQ, 472.5, 0.01));
  }

  // ONE trimmer entry per opening -- it carries BOTH headers' reactions as
  // separate points, not two independent entries (issue #64 follow-up).
  check("one trimmer entry (carrying both headers' point loads at once)",
    trimmed.trimmers.length === 1, String(trimmed.trimmers.length));
  const trimmer = trimmed.trimmers[0]!;
  check("the trimmer stands for 4 physical pieces (2 positions x doubled)", trimmer.count === 4);
  check("the trimmer's own span is 3700 mm (deck span + bearing)", near(trimmer.spanMm, 3700, 0.01));
  check("the trimmer carries exactly 2 points (one per header)", trimmer.points.length === 2);
  check("every point's g+q is 472.5 N (each header's own reaction)",
    trimmer.points.every(p => near(p.g + p.q, 472.5, 0.01)), JSON.stringify(trimmer.points));
  const pointAts = trimmer.points.map(p => p.atMm).sort((a, b) => a - b);
  check("trimmer point loads land at 650 mm and 3050 mm",
    near(pointAts[0]!, 650, 0.01) && near(pointAts[1]!, 3050, 0.01), JSON.stringify(pointAts));

  check("one opening, complete", trimmed.openings.length === 1 && trimmed.openings[0]!.complete);
  const o = trimmed.openings[0]!;
  check("opening from/to/left/right match the hole's local extent",
    near(o.from, -1200, 0.01) && near(o.to, 1200, 0.01) && near(o.left, -500, 0.01) && near(o.right, 500, 0.01),
    JSON.stringify(o));

  // headerCheck()/trimmerCheck() apply core/timber.ts's checkSpan() to these
  // figures -- both already pinned against a hand-worked case there; here
  // the point is that they run to completion (a stated joist and loads) and
  // report the section actually checked.
  const doc = emptyDoc();
  doc.materials = { timber: { ...TIMBER_DEFAULT } };
  const hResult = headerCheck(doc, d, trimmed.headers[0]!);
  check("headerCheck runs to a real result against the deck's own joist section",
    hResult.status !== "incomplete" && hResult.check !== undefined, JSON.stringify(hResult.missing));
  check("headerCheck's checked section is the deck's own (undoubled) joist",
    (hResult.input as { section: { w: number; d: number } }).section.w === 44
    && (hResult.input as { section: { w: number; d: number } }).section.d === 195);

  const trResult = trimmerCheck(doc, d, trimmer);
  check("trimmerCheck runs to a real result", trResult.status !== "incomplete" && trResult.check !== undefined,
    JSON.stringify(trResult.missing));
  check("trimmerCheck's checked section is the deck's joist DOUBLED in width",
    (trResult.input as { section: { w: number; d: number } }).section.w === 88
    && (trResult.input as { section: { w: number; d: number } }).section.d === 195);
  check("trimmerCheck reports no comfort figure (issue #64: not required for a header/trimmer)",
    trResult.comfort === undefined);
  check("headerCheck reports no comfort figure either", hResult.comfort === undefined);

  // The takeoff counts the header(s) and the doubled trimmers, and shortens
  // the cut joists instead of ordering them full length.
  const takeoff = deckTakeoffOf(f, d, 0.1, 1_220_000);
  const headerMembers = takeoff.members.filter(m => m.name === "deckHeader");
  const trimmerMembers = takeoff.members.filter(m => m.name === "trimmer");
  const joistMembers = takeoff.members.filter(m => m.name === "joist");
  check("takeoff counts 2 headers", headerMembers.length === 2 && headerMembers.every(m => m.count === 1),
    JSON.stringify(headerMembers));
  check("takeoff counts 4 doubled-trimmer pieces (2 positions x doubled) in one entry",
    trimmerMembers.length === 1 && trimmerMembers[0]!.count === 4, JSON.stringify(trimmerMembers));
  check("takeoff's trimmer section is the SINGLE joist width (doubling is in `count`, not section)",
    trimmerMembers.every(m => m.sectionMm.w === 44), JSON.stringify(trimmerMembers));
  check("takeoff's full-length joist entry now counts 6, not 8, at the ordinary full length (clear span + 2*bearing = 3800 mm)",
    joistMembers.some(m => m.count === 6 && near(m.lengthMm, 3800, 0.5)), JSON.stringify(joistMembers));
  check("takeoff's cut-joist entry counts the 4 shortened stubs at 700 mm",
    joistMembers.some(m => m.count === 4 && near(m.lengthMm, 700, 0.01)), JSON.stringify(joistMembers));
}

// ---- a hole reaching the deck's edge needs no header on that side ---------
{
  const { f, d } = docWithDeck();
  // Same across band as above (left -500, right 500); span band -1800..-600
  // reaches the near edge (deck span half is 1800) exactly.
  f.vides = [vide({ x: d.x, y: d.y - 1200, width: 1000, depth: 1200 })];
  const trimmed = trimDeck(f, d);

  check("only one header (the far end; the near end is the deck's own edge)",
    trimmed.headers.length === 1, String(trimmed.headers.length));
  check("far header span is still 1100 mm", near(trimmed.headers[0]!.spanMm, 1100, 0.01));
  check("far header's stub is longer (2500 mm) since it runs from mid-deck to the hole",
    trimmed.cutJoists.length === 1 && near(trimmed.cutJoists[0]!.lengthMm, 2500, 0.01),
    JSON.stringify(trimmed.cutJoists));
  check("far header reactionG = (2*0.3*2500)/4 = 375 N",
    near(trimmed.headers[0]!.reactionG, 375, 0.01), String(trimmed.headers[0]!.reactionG));
  check("far header reactionQ = (2*1.05*2500)/4 = 1312.5 N",
    near(trimmed.headers[0]!.reactionQ, 1312.5, 0.01), String(trimmed.headers[0]!.reactionQ));
  check("only one trimmer entry (one header, so one point load)",
    trimmed.trimmers.length === 1, String(trimmed.trimmers.length));
  check("that trimmer carries exactly one point", trimmed.trimmers[0]!.points.length === 1);
  check("that trimmer's point load lands at 1250 mm", near(trimmed.trimmers[0]!.points[0]!.atMm, 1250, 0.01),
    String(trimmed.trimmers[0]!.points[0]!.atMm));
}

// ---- a hole not fully inside the deck reports incomplete, nothing trimmed -
{
  const { f, d } = docWithDeck();
  // Overlaps the deck (across band still -500..500) but its span band runs
  // from -2200 to 200 -- 400 mm past the deck's own near edge at -1800.
  f.vides = [vide({ x: d.x, y: d.y - 1000, width: 1000, depth: 2400 })];
  const trimmed = trimDeck(f, d);

  check("the opening is reported", trimmed.openings.length === 1);
  check("but marked incomplete", trimmed.openings[0]!.complete === false);
  check("nothing was trimmed for it: every joist is full-length",
    trimmed.fullJoists === 8 && trimmed.cutJoists.length === 0);
  check("no header or trimmer was derived", trimmed.headers.length === 0 && trimmed.trimmers.length === 0);
}

// ---- a vide with no overlap with this deck at all is simply not this ------
// deck's concern -- it belongs to whatever IS under it, and reporting it
// here would flag every deck on a floor for a hole that has nothing to do
// with it.
{
  const { f, d } = docWithDeck();
  f.vides = [vide({ x: d.x + 20000, y: d.y + 20000, width: 900, depth: 900 })];
  const trimmed = trimDeck(f, d);
  check("an unrelated vide elsewhere on the floor produces no opening for this deck",
    trimmed.openings.length === 0);
  check("every joist is still full-length", trimmed.fullJoists === 8 && trimmed.cutJoists.length === 0);
}

// ---- one derived layout: no joist segment crosses a hole's interior -------
//
// The plan (render/deck.ts's deckMark()), the 3D solids (core/deck.ts's
// deckSolids()) and the IFC export (io/ifc.ts) all read deckJoistLayout()
// rather than deckJoistsLocal() once a deck has a hole -- this checks the
// layout itself carries no full or cut joist segment that still crosses a
// complete opening's interior, which is what would otherwise let a joist be
// drawn or extruded straight through a trapgat.
function segmentSpanAcross(axisIsX: boolean, seg: JoistSegment): { spanLo: number; spanHi: number; across: number } {
  const a = axisIsX ? seg.a.x : seg.a.y, b = axisIsX ? seg.b.x : seg.b.y;
  const across = axisIsX ? seg.a.y : seg.a.x;
  return { spanLo: Math.min(a, b), spanHi: Math.max(a, b), across };
}

{
  const { f, d } = docWithDeck();
  f.vides = [vide({ x: d.x, y: d.y, width: 1000, depth: 2400 })];
  const layout = deckJoistLayout(f, d);
  const axisIsX = d.joistAxis === "x";
  const openOpenings = layout.openings.filter(o => o.complete);
  check("the fixture has a complete opening to check against", openOpenings.length === 1);

  const crossesAnyOpening = (seg: JoistSegment): boolean => {
    const { spanLo, spanHi, across } = segmentSpanAcross(axisIsX, seg);
    return openOpenings.some(o =>
      across > o.left + 1 && across < o.right - 1 && spanLo < o.to - 1 && spanHi > o.from + 1);
  };

  const offenders = [...layout.full, ...layout.cut].filter(crossesAnyOpening);
  check("no full or cut joist segment crosses the vide's interior",
    offenders.length === 0, JSON.stringify(offenders));

  // The cut segments themselves must stop exactly at the header (from/to),
  // never reach into the hole even up to its edge plus a rounding slop.
  const cutInBand = layout.cut.filter(seg => {
    const { across } = segmentSpanAcross(axisIsX, seg);
    return openOpenings.some(o => across > o.left + 1 && across < o.right - 1);
  });
  check("every cut segment in the hole's across band stops at from/to",
    cutInBand.length === 4, String(cutInBand.length));
  for (const seg of cutInBand) {
    const { spanLo, spanHi } = segmentSpanAcross(axisIsX, seg);
    const o = openOpenings[0]!;
    const stopsAtNear = near(spanHi, o.from, 1);
    const stopsAtFar = near(spanLo, o.to, 1);
    check("segment's inner end lands exactly on the header line",
      stopsAtNear || stopsAtFar, JSON.stringify({ seg, o }));
  }
}

// ---- headerCheck must refuse over an incomplete load, like joistCheck() and
// trimmerCheck() already do (bug: headerCheck() read "ok" with nothing in
// `missing` when loadQ was absent, because its own `base` ignored `hasLoad`) -
{
  const { f, d } = docWithDeck({ loadQ: undefined });
  f.vides = [vide({ x: d.x, y: d.y, width: 1000, depth: 2400 })];
  const trimmed = trimDeck(f, d);
  const doc = emptyDoc();
  doc.materials = { timber: { ...TIMBER_DEFAULT } };

  const hResult = headerCheck(doc, d, trimmed.headers[0]!);
  check("headerCheck is incomplete when loadQ is missing, like joistCheck/trimmerCheck",
    hResult.status === "incomplete", JSON.stringify(hResult));
  check("headerCheck names a missing load",
    hResult.missing.includes("load") || hResult.missing.includes("loadQ"), JSON.stringify(hResult.missing));
}

// ---- two holes cutting one joist: the takeoff must count the SAME cut
// segments deckJoistLayout() draws, not each hole's stub measured from the
// deck's own edge as if it were the only hole (bug: a middle stub between two
// holes was instead measured all the way out to the far deck edge, and
// double-counted with the matching wrong figure from the other hole) --------
{
  const { f, d } = docWithDeck({ depth: 6000 });
  f.vides = [
    vide({ x: d.x, y: d.y - 1500, width: 1000, depth: 1000 }),
    vide({ x: d.x, y: d.y + 1500, width: 1000, depth: 1000 }),
  ];
  const trimmed = trimDeck(f, d);
  const layout = deckJoistLayout(f, d);
  const axisIsX = d.joistAxis === "x";

  const layoutLengths = layout.cut
    .map(seg => { const { spanLo, spanHi } = segmentSpanAcross(axisIsX, seg); return Math.round(spanHi - spanLo); })
    .sort((a, b) => a - b);
  check("two holes cut each of the 2 affected joists into three pieces, 1100/2000/1100",
    JSON.stringify(layoutLengths) === JSON.stringify([1100, 1100, 1100, 1100, 2000, 2000]),
    JSON.stringify(layoutLengths));

  const takeoffLengths = trimmed.cutJoists
    .flatMap(c => Array(c.count).fill(Math.round(c.lengthMm)))
    .sort((a: number, b: number) => a - b);
  check("the takeoff's cut-joist pieces match the layout's own cut segments exactly",
    JSON.stringify(takeoffLengths) === JSON.stringify(layoutLengths), JSON.stringify(trimmed.cutJoists));
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
