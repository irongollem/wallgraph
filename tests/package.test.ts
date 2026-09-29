// The engineer's package (issue #78): engineerPackagePdf() assembles the
// cover, the permit sheet, the uitgangspunten sheet, the materiaalstaat
// table and every framed/block/sandwich wall's elevation into one PDF via
// io/pdf.ts's multi-page pdfDocument(). What is checked here: the pages
// land in the stated order and the optional three are omitted when their
// option is off, the statement appears on the cover and in every page's
// footer in both languages, a document with nothing structural still gets a
// full package with a "no elements" uitgangspunten page, the materiaalstaat
// table's rows equal materialsCsv()'s own rows, and no check-result string
// in either language reads as a verdict on structural safety.
import { emptyDoc, newId, type Wall, type Opening, type PlanDoc } from "../src/model/doc";
import type { Deck } from "../src/model/deck";
import type { Beam } from "../src/model/structure";
import { engineerPackagePdf } from "../src/io/package";
import { materialsCsv, materialsRows, materialsHeaderRow, type MaterialsRow } from "../src/io/materials";
import { t, changeLanguage, resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

const H = 2600, POST_MM = 600, POST_WIDTH = 38, FRAME_TH = 89;

/**
 * One storey with a lintel (a concrete wall, so its elevation is "plain" and
 * gets skipped), a deck, a beam and a separate framed timber wall (drawn) --
 * one of every structural element the package's five pages read from, per
 * the issue's own test fixture ("a plan with a deck, a beam, a lintel and a
 * framed wall").
 */
function buildDoc(): PlanDoc {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  doc.project = { name: "Test Villa", address: "Teststraat 1", author: "Tester", number: "T-1" };

  const n1 = newId("n"), n2 = newId("n"), n3 = newId("n"), n4 = newId("n");
  f.nodes = [
    { id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 },
    { id: n3, x: 0, y: 3000 }, { id: n4, x: 4000, y: 3000 },
  ];

  const lintelOpening = opening({ kind: "door", t: 900, width: 900, lintel: { w: 44, d: 145 } });
  const lintelWall: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0,
    openings: [lintelOpening], material: "concrete",
  };
  const framedWall: Wall = {
    id: newId("w"), a: n3, b: n4, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
  f.walls = [lintelWall, framedWall];

  const deck: Deck = {
    id: newId("d"), x: 0, y: 0, rotation: 0, width: 2400, depth: 3600,
    joistAxis: "y", joistMm: 600, joist: { w: 44, d: 195 }, loadG: 500, loadQ: 1750,
  };
  f.decks = [deck];

  const beam: Beam = {
    id: newId("s"), kind: "beam", a: { x: 0, y: 5000 }, b: { x: 3000, y: 5000 },
    width: 100, depth: 200, label: "HEA 200", loadKNm: 5,
  };
  f.structure = [beam];

  return doc;
}

/** A document with a wall (so the permit sheet is not null) but no deck,
 *  beam or lintel -- the assumptions page's own "nothing to report" path. */
function buildBareDoc(): PlanDoc {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  f.walls = [{ id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0, openings: [] }];
  return doc;
}

const countPages = (pdf: string): number => (pdf.match(/\/Type \/Page[^s]/g) ?? []).length;

// ── page order and the three options ────────────────────────────────────────

changeLanguage("nl");
{
  const doc = buildDoc();
  const pdf = engineerPackagePdf(doc, [0]);
  check("a plan with structural elements produces a PDF", pdf !== null && pdf.length > 0);
  const body = pdf ?? "";

  // Cover, permit, assumptions, materiaalstaat (one page) and the
  // elevations section (a skipped-walls note plus the one framed wall) --
  // six pages, in that order.
  check("the package has six pages (cover, permit, assumptions, materials, elevations note, one elevation)",
    countPages(body) === 6, String(countPages(body)));

  const markers: Array<[string, string]> = [
    [t("package.title"), "the cover"],
    [t("sheet.storey"), "the permit sheet"],
    [t("assumptions.assumptionsHeading"), "the uitgangspunten sheet"],
    [t("package.materialsTitle"), "the materiaalstaat table"],
    [t("package.contentsElevations"), "the elevations section"],
    ["Floor 1", "the framed wall's own elevation"],
  ];
  let cur = 0;
  for (const [marker, label] of markers) {
    const idx = body.indexOf(marker, cur);
    check(`${label} appears in order`, idx > cur || (cur === 0 && idx === 0), `marker=${JSON.stringify(marker)} idx=${idx} cur=${cur}`);
    cur = idx >= 0 ? idx : cur;
  }
}

{
  // Every storey: one permit sheet per storey with something drawn, after the cover.
  const doc = buildDoc();
  doc.floors.push({ ...structuredClone(doc.floors[0]!), id: "upper", name: "Verdieping 2" });
  const opts = { assumptions: false, materials: false, elevations: false };
  const both = engineerPackagePdf(doc, [0, 1], opts) ?? "";
  check("every storey adds its own permit sheet", countPages(both) === 3, String(countPages(both)));
  check("the second sheet names its own storey", both.includes("Verdieping 2"));
}

{
  const doc = buildDoc();
  const pdf = engineerPackagePdf(doc, [0], { assumptions: false, materials: false, elevations: false }) ?? "";
  check("unticking every option leaves only the cover and the permit sheet",
    countPages(pdf) === 2, String(countPages(pdf)));
  check("the uitgangspunten heading is omitted", !pdf.includes(t("assumptions.assumptionsHeading")));
  check("the materiaalstaat table is omitted", !pdf.includes(t("package.materialsTitle")));
  check("the elevations section is omitted", !pdf.includes(t("package.contentsElevations")));
}

check("a document with nothing drawn produces no package", engineerPackagePdf(emptyDoc(), [0]) === null
  || (() => { const d = emptyDoc(); d.floors[0]!.nodes = []; d.floors[0]!.walls = []; return engineerPackagePdf(d, [0]) === null; })());

// ── the statement, on the cover and in every footer, both languages ────────

// A word-wrapped paragraph splits across several text operators, so the
// check reads a short prefix guaranteed to survive on the FIRST wrapped
// line: io/package.ts's wrap() always keeps at least the opening word (and,
// at these page widths, several more) on line one regardless of where the
// rest of the sentence breaks.
const STATEMENT_PREFIX: Record<"nl" | "en", string> = {
  nl: "Dit pakket beschrijft wat in de plattegrond",
  en: "This package states what is drawn",
};
const FOOTER_PREFIX: Record<"nl" | "en", string> = {
  nl: "Geen constructieberekening, geen verklaring",
  en: "Not a structural calculation, not a statement",
};

for (const lang of ["nl", "en"] as const) {
  changeLanguage(lang);
  const doc = buildDoc();
  const pdf = engineerPackagePdf(doc, [0]) ?? "";
  check(`${lang}: the full statement appears on the cover`, pdf.includes(STATEMENT_PREFIX[lang]));
  const pages = countPages(pdf);
  const footerHits = (pdf.match(new RegExp(FOOTER_PREFIX[lang].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  check(`${lang}: the short statement is in every page's footer`, footerHits === pages, `${footerHits} vs ${pages} pages`);
}
changeLanguage("nl");

// ── a document with no structural elements ──────────────────────────────────

{
  const doc = buildBareDoc();
  const pdf = engineerPackagePdf(doc, [0]);
  check("a document without a deck, beam or lintel still produces a package", pdf !== null);
  const body = pdf ?? "";
  check("the cover is present", body.includes(t("package.title")));
  check("the permit sheet is present", body.includes(t("sheet.storey")));
  check("the uitgangspunten page states there is nothing structural to report",
    body.includes("Dit document bevat geen balklagen"));
}

// ── the materiaalstaat table's rows equal materialsCsv()'s own rows ────────

{
  const doc = buildDoc();
  const header = materialsHeaderRow();
  const rows = materialsRows(doc);
  check("the fixture produces at least one materiaalstaat row", rows.length > 0, String(rows.length));

  const toCsvLine = (r: MaterialsRow): string =>
    [r.storey, r.system, r.item, r.section, r.length, r.count, r.stock, r.unit, r.incomplete, r.offcut].join(";");

  const csv = materialsCsv(doc).replace(/^﻿/, "");
  const lines = csv.split("\r\n").filter(l => l.length > 0);
  check("materialsCsv() has a header plus one line per materiaalstaat row",
    lines.length === rows.length + 1, `${lines.length} vs ${rows.length + 1}`);
  check("the header row matches", lines[0] === toCsvLine(header), `${lines[0]} vs ${toCsvLine(header)}`);
  const mismatches = rows
    .map((r, i) => ({ i, csv: lines[i + 1], row: toCsvLine(r) }))
    .filter(x => x.csv !== x.row);
  check("every materiaalstaat table row equals its CSV line", mismatches.length === 0, JSON.stringify(mismatches));
}

// ── wording audit: no check-result string reads as a verdict ───────────────

const FORBIDDEN_WORDS = ["veilig", "safe", "goedgekeurd", "approved", "voldoet aan de eisen", "compliant"];
/** Negating disclaimer sentences -- explicitly stating the package is NOT a
 *  safety verdict, which is why they legitimately carry "veiligheid"/
 *  "safety" as a substring of "veilig"/"safe". Excluded by key, per the
 *  issue's own instruction, rather than smarter word-boundary matching. */
const FORBIDDEN_EXCLUDED_KEYS = new Set([
  "checks.resultNote", "assumptions.subtitle", "package.statement", "package.statementFooter",
]);

for (const lang of ["nl", "en"] as const) {
  const dict = (resources as any)[lang].translation as Record<string, Record<string, unknown>>;
  for (const section of ["checks", "assumptions", "package"] as const) {
    const ns = dict[section] ?? {};
    for (const [key, value] of Object.entries(ns)) {
      if (typeof value !== "string") continue;
      const fullKey = `${section}.${key}`;
      if (FORBIDDEN_EXCLUDED_KEYS.has(fullKey)) continue;
      const lower = value.toLowerCase();
      const hit = FORBIDDEN_WORDS.find(w => lower.includes(w));
      check(`${lang} ${fullKey} carries no check-result verdict wording`, hit === undefined, `"${value}" contains "${hit}"`);
    }
  }
}

console.log(failures === 0 ? "ALL PACKAGE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
