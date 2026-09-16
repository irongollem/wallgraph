// Uitgangspunten sheet (issue #63): assumptionsSheet() gathers every deck,
// beam and lintel the document states with the check core/checks.ts already
// runs for each; assumptionsSvg()/assumptionsPdf() render that model to
// paper. What is checked here: every element is listed, an incomplete check
// names its own missing input rather than omitting it, an edited assumption
// shows up in the drift list, and the excluded-checks list is present in
// both languages.
import { emptyDoc, newId, type Wall, type Opening, type PlanDoc } from "../src/model/doc";
import type { Deck } from "../src/model/deck";
import type { Beam } from "../src/model/structure";
import { assumptionsSheet, assumptionsSvg, assumptionsPdf } from "../src/io/assumptions";
import { t, changeLanguage } from "../src/i18n";


/** The sheet's visible text as one string: every <text> element's content in
 *  order, joined by spaces and unescaped. A long line wraps onto several text
 *  elements, so a phrase is looked for in the page's reading order rather than
 *  inside one element. */
function sheetText(svg: string): string {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map(m => m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
    .join(" ")
    .replace(/\s+/g, " ");
}

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

/**
 * One storey with two decks (one complete, one missing its joist section),
 * one beam and one wall carrying two openings (one with a complete lintel,
 * one missing both the wall's material and its own lintel section) -- enough
 * to exercise every row kind and an incomplete result at once.
 */
function buildDoc(): {
  doc: PlanDoc; deckOk: Deck; deckIncomplete: Deck; beam: Beam; wall: Wall;
  okOpening: Opening; incompleteOpening: Opening;
} {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = 2600;

  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];

  // Neither opening's wall states a material, so both report "material"
  // missing -- the point of incompleteOpening (no lintel stated either) is
  // that it names a SECOND missing input beside it, none omitted.
  const okOpening = opening({ kind: "door", t: 900, width: 900, lintel: { w: 44, d: 145 } });
  const incompleteOpening = opening({ kind: "window", t: 2200, width: 1200 });
  const wall: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0,
    openings: [okOpening, incompleteOpening],
  };
  f.walls = [wall];

  const deckOk: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 44, d: 195 }, loadG: 500, loadQ: 1750,
  };
  const deckIncomplete: Deck = {
    id: newId("d"), x: 3000, y: 3000, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, loadG: 500, loadQ: 1750,
  };
  f.decks = [deckOk, deckIncomplete];

  const beam: Beam = {
    id: newId("s"), kind: "beam", a: { x: 0, y: 5000 }, b: { x: 3000, y: 5000 },
    width: 100, depth: 200, label: "HEA 200", loadKNm: 5,
  };
  f.structure = [beam];

  // Edited away from GAMMA_G_DEFAULT (1.2) -- the drift list should name it.
  doc.materials = { gammaG: 1.5 };

  return { doc, deckOk, deckIncomplete, beam, wall, okOpening, incompleteOpening };
}

// ── the model ────────────────────────────────────────────────────────────────

const { doc, deckIncomplete, incompleteOpening } = buildDoc();
const model = assumptionsSheet(doc);

check("one storey is gathered", model.storeys.length === 1);
const storey = model.storeys[0]!;
check("every deck in the document is listed", storey.decks.length === 2, String(storey.decks.length));
check("the beam is listed", storey.beams.length === 1, String(storey.beams.length));
check("every opening on the wall is listed as a lintel row", storey.lintels.length === 2, String(storey.lintels.length));
check("the document has elements", model.hasElements);

const incompleteRow = storey.decks.find(d => d.id === deckIncomplete.id);
check("the incomplete deck is found", incompleteRow !== undefined);
check("its check reports incomplete", incompleteRow?.result.status === "incomplete");
check("its missing joist section is named", incompleteRow?.result.missing.includes("joistSection") ?? false,
  JSON.stringify(incompleteRow?.result.missing));

const incompleteLintel = storey.lintels.find(l => l.id === incompleteOpening.id);
check("the lintel with no stated wall material and no lintel is incomplete", incompleteLintel?.result.status === "incomplete");
check("it names the missing material", incompleteLintel?.result.missing.includes("material") ?? false,
  JSON.stringify(incompleteLintel?.result.missing));
check("it names the missing lintel section", incompleteLintel?.result.missing.includes("lintelSection") ?? false,
  JSON.stringify(incompleteLintel?.result.missing));

check("an edited assumption appears in the drift list", model.drift.some(d => d.key === "gammaG"), JSON.stringify(model.drift));

// ── an element-less document still gets a sheet, not an empty page ─────────

{
  const bare = emptyDoc();
  const bareModel = assumptionsSheet(bare);
  check("a document with no decks, beams or lintels reports so", bareModel.hasElements === false);
  check("its own storey is still gathered", bareModel.storeys.length === 1);
  const svg = assumptionsSvg(bare);
  check("the rendered sheet states there is nothing to report",
    svg.includes(t("assumptions.noElements")));
  check("it still carries the assumptions block", svg.includes(t("materials.timberClass")));
}

// ── rendering: nothing named is silently omitted, in either language ───────

for (const lang of ["nl", "en"] as const) {
  changeLanguage(lang);
  const svg = assumptionsSvg(doc);

  // The subtitle wraps across several <text> lines on the page, so it is not
  // one contiguous string in the SVG; "constructieberekening" is the one word
  // in it neither language translates, and survives the wrap intact.
  check(`[${lang}] the sheet states what it is, not a constructieberekening`,
    svg.includes("constructieberekening"));
  check(`[${lang}] the statement is third person, not addressed at a reader`,
    !/\byou\b|\byour\b|\bje\b|\bjouw\b/i.test(svg));
  check(`[${lang}] the incomplete deck's missing joist section is named, not omitted`,
    svg.includes(t("assumptions.missingJoistSection")));
  check(`[${lang}] the incomplete lintel's missing wall material is named`,
    svg.includes(t("assumptions.missingMaterial")));
  check(`[${lang}] the incomplete lintel's missing section is named`,
    svg.includes(t("assumptions.missingLintelSection")));
  check(`[${lang}] the drifted γG shows up on the sheet`,
    svg.includes(t("checks.driftGammaG")));

  check(`[${lang}] the excluded-checks list is present`, svg.includes(t("assumptions.excludedHeading")));
  for (const key of [
    "excludedPoint", "excludedContinuous", "excludedLateral", "excludedNotches", "excludedBearing",
    "excludedConnections", "excludedFire", "excludedLoadPath", "excludedFoundation", "excludedTrimmer",
  ]) {
    check(`[${lang}] excluded item ${key} is present`, sheetText(svg).includes(t("assumptions." + key)));
  }

  check(`[${lang}] a complete deck's comfort figures are on the sheet`, svg.includes(t("checks.comfortResult")));
  check(`[${lang}] the beam's own section (HEA 200) is stated`, svg.includes("HEA 200"));
  check(`[${lang}] no NaN or undefined leaks onto the sheet`, !/NaN|undefined/.test(svg));
}
changeLanguage("nl");

// ── SVG well-formedness ─────────────────────────────────────────────────────

{
  const svg = assumptionsSvg(doc);
  check("the SVG opens and closes its root element", svg.trimStart().startsWith("<svg") && svg.trimEnd().endsWith("</svg>"));
  check("no NaN or Infinity in the SVG", !/NaN|Infinity/.test(svg));
}

// ── PDF: same page machinery the permit sheet uses ──────────────────────────

{
  const pdf = assumptionsPdf(doc);
  check("the file declares its version", pdf.startsWith("%PDF-1."));
  check("the file ends where a reader looks for the trailer", pdf.trimEnd().endsWith("%%EOF"));
  check("the sheet is one page", /\/Type \/Pages \/Kids \[3 0 R\] \/Count 1/.test(pdf));
  check("no NaN or Infinity in the content", !/NaN|Infinity/.test(pdf));

  const bare = assumptionsPdf(emptyDoc());
  check("an element-less document still produces a PDF", bare.startsWith("%PDF-1."));
}

console.log(failures === 0 ? "ALL ASSUMPTIONS TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
