// Materiaalstaat CSV export (issue #51): a known plan produces the expected
// rows and totals, the BOM and separator are present, and an incomplete wall
// is flagged rather than silently reading as zero. core/materials.ts's own
// figures are covered by tests/materials.test.ts; this file only checks the
// CSV shaping (io/materials.ts) on top of them.
import { emptyDoc, newId, type Wall, type Floor } from "../src/model/doc";
import { v } from "../src/geometry/vec";
import { materialsCsv } from "../src/io/materials";
import { changeLanguage } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

/**
 * A 4000x3000 rectangle, the same four-material spread
 * tests/materials.test.ts's buildDoc() uses: top a framed-timber wall,
 * right a block wall WITH a stated format, bottom a block wall states
 * a material but no format (incomplete), left "other" (nothing stated at
 * all). Plus one deck with a stated joist section and decking.
 */
function buildDoc(): { doc: ReturnType<typeof emptyDoc>; f: Floor; top: Wall; blockOk: Wall; blockMissing: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.name = "Begane grond";
  f.height = 2600;
  const pts = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });

  const top: Wall = {
    id: newId("w"), a: ids[0]!, b: ids[1]!, thickness: 89, bulge: 0, openings: [],
    material: "timber", postMm: 600, postWidthMm: 38,
  };
  const blockOk: Wall = {
    id: newId("w"), a: ids[1]!, b: ids[2]!, thickness: 240, bulge: 0, openings: [],
    material: "aerated", blockMm: { length: 600, height: 250 },
  };
  const blockMissing: Wall = {
    id: newId("w"), a: ids[2]!, b: ids[3]!, thickness: 240, bulge: 0, openings: [],
    material: "masonry", // no blockMm: incomplete, same block system as blockOk
  };
  const other: Wall = { id: newId("w"), a: ids[3]!, b: ids[0]!, thickness: 100, bulge: 0, openings: [] };
  f.walls = [top, blockOk, blockMissing, other];
  f.decks = [{
    id: "dk1", x: 2000, y: 1500, rotation: 0, width: 2400, depth: 3600, joistAxis: "y", joistMm: 600,
    joist: { w: 71, d: 171 }, deckingMm: 18,
  }];
  return { doc, f, top, blockOk, blockMissing };
}

const { doc, top, blockMissing } = buildDoc();
const csv = materialsCsv(doc);

// ── encoding and shape ───────────────────────────────────────────────────

check("starts with a UTF-8 BOM", csv.charCodeAt(0) === 0xFEFF);
const body = csv.slice(1);
const lines = body.split("\r\n").filter(l => l.length > 0);
check("more than one line (header plus data)", lines.length > 1, String(lines.length));

const header = lines[0]!.split(";");
check("header has 10 semicolon-separated columns", header.length === 10, String(header.length));
check("header is in the document's current language (nl default): storey first",
  header[0] === "Verdieping", header[0]);
check("header names the incomplete column", header[8] === "Onvolledig", header[8]);
check("header names the offcut column last", header[9] === "Restant (mm)", header[9]);

const rows = lines.slice(1).map(l => l.split(";"));
check("every data row has as many fields as the header", rows.every(r => r.length === header.length),
  JSON.stringify(rows.find(r => r.length !== header.length)));
check("every row states the storey name in the first column",
  rows.every(r => r[0] === "Begane grond"));

// ── member rows: a framed wall's stud ────────────────────────────────────

const studRow = rows.find(r => r[2] === "Stijl");
check("a framed wall's stud is a line item", studRow !== undefined);
if (studRow) {
  check("its section is width x depth", studRow[3] === `38x${top.thickness}`, studRow[3]);
  check("its length is a plain integer (no decimals)", /^\d+$/.test(studRow[4]!), studRow[4]);
  check("its count is a plain integer", /^\d+$/.test(studRow[5]!), studRow[5]);
  check("its unit is \"stuk\" (piece)", studRow[7] === "stuk", studRow[7]);
  check("a complete member row carries no incomplete flag", studRow[8] === "", studRow[8]);
  check("a member row leaves the offcut column blank", studRow[9] === "", studRow[9]);
}

// ── block system: a stated format counts blocks, an unstated one is flagged,
// not a silent zero (the two walls share one "Blokopbouw" system group) ────

const blocksRow = rows.find(r => r[2] === "Blokken");
check("the block system's block count is a line item", blocksRow !== undefined);
if (blocksRow) {
  check("its system is \"Blokopbouw\"", blocksRow[1] === "Blokopbouw", blocksRow[1]);
  check("its count is greater than zero (the format-stated wall's own blocks)",
    Number(blocksRow[5]) > 0, blocksRow[5]);
  check("its unit is \"blok\"", blocksRow[7] === "blok", blocksRow[7]);
  // The system's blocks are not silently reported as complete: blockMissing
  // (no blockMm) shares this "Blokopbouw" group with blockOk, so the row
  // that already carries the real (non-zero) block count is itself flagged,
  // rather than a missing wall's absence being folded away.
  check("the row is flagged incomplete -- one of its two block walls states no format",
    blocksRow[8] === "x", blocksRow[8]);
  void blockMissing; // the wall responsible for the flag above
}

// ── decks: joists, rim boards and the decking area ──────────────────────

const deckJoistRow = rows.find(r => r[1] === "Balklagen" && r[2] === "Balk");
check("the deck's joist is a line item under the \"Balklagen\" system", deckJoistRow !== undefined);
if (deckJoistRow) {
  check("its section is the stated joist section", deckJoistRow[3] === "71x171", deckJoistRow[3]);
  check("its length is the clear span plus bearing at both ends",
    deckJoistRow[4] === String(3600 + 2 * 100), deckJoistRow[4]);
}
const deckingRow = rows.find(r => r[1] === "Balklagen" && r[2] === "Vloerplaat");
check("the deck's decking area is a line item", deckingRow !== undefined);
if (deckingRow) {
  // 2400 x 3600 mm = 8.64 m^2, two places, with the interface language's own
  // decimal separator: a comma under nl, a point under en (a sheet written in
  // English is read by a spreadsheet in an English locale).
  check("area is two decimals with a comma under nl", deckingRow[5] === "8,64", deckingRow[5]);
  changeLanguage("en");
  const enRows = materialsCsv(doc).slice(1).split("\r\n").filter(l => l.length > 0)
    .slice(1).map(l => l.split(";"));
  const enDecking = enRows.find(r => r[4] === "" && r[5] === "8.64");
  check("and with a point under en", enDecking !== undefined,
    JSON.stringify(enRows.map(r => r[5]).slice(0, 12)));
  changeLanguage("nl");
  check("its unit is m²", deckingRow[7] === "m²", deckingRow[7]);
}

// ── stock summary trailing rows: at least one per system with members ───

const stockRow = rows.find(r => r[1] === "Houten regelwerk" && r[2] === "Voorraadlengte");
check("the framed-timber system carries at least one nested stock-length row", stockRow !== undefined);
if (stockRow) {
  check("its length column is blank -- the bar length lives in the stock column",
    stockRow[4] === "", stockRow[4]);
  check("its count is a plain integer", /^\d+$/.test(stockRow[5]!), stockRow[5]);
  check("its stock column carries the bought stock length (a plain integer)",
    /^\d+$/.test(stockRow[6]!), stockRow[6]);
  check("its offcut is a plain integer in its own column", /^\d+$/.test(stockRow[9]!), stockRow[9]);
}

// ── a frame with no post width states its own dedicated incomplete row ──
//
// Unlike a missing block format (flagged on the existing "Blokken" row
// above), a missing post width leaves NO members at all -- framedMembers()
// in core/materials.ts returns none -- so there is no existing quantity row
// to flag, and the CSV states a standalone line instead.

{
  const doc2 = emptyDoc();
  const f2 = doc2.floors[0]!;
  f2.name = "Verdieping";
  const n1 = newId("n"), n2 = newId("n");
  f2.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  f2.walls = [{
    id: newId("w"), a: n1, b: n2, thickness: 89, bulge: 0, openings: [],
    material: "timber", postMm: 600, // no postWidthMm
  }];
  const rows2 = materialsCsv(doc2).slice(1).split("\r\n").filter(l => l.length > 0).slice(1).map(l => l.split(";"));
  check("no stud/plate member rows for a frame with no post width",
    rows2.every(r => r[2] !== "Stijl" && r[2] !== "Regel"));
  const postWidthRow = rows2.find(r => r[2] === "Stijlbreedte opgeven");
  check("a dedicated \"Stijlbreedte opgeven\" row states the missing fact", postWidthRow !== undefined,
    JSON.stringify(rows2));
  if (postWidthRow) {
    check("it is flagged incomplete", postWidthRow[8] === "x", postWidthRow[8]);
    check("it counts exactly the one affected wall", postWidthRow[5] === "1", postWidthRow[5]);
    check("its storey is \"Verdieping\"", postWidthRow[0] === "Verdieping", postWidthRow[0]);
  }
}

// ── formula injection guard: a storey name a spreadsheet would execute ──
//
// A field starting with =, +, -, @, tab or CR opens as a formula in a
// spreadsheet unless neutralised. csvField() quotes it and prefixes a
// leading apostrophe inside the quotes, forcing it to read as text.

{
  const doc3 = emptyDoc();
  const f3 = doc3.floors[0]!;
  f3.name = "=SUM(A1)";
  const n1 = newId("n"), n2 = newId("n");
  f3.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  f3.walls = [{
    id: newId("w"), a: n1, b: n2, thickness: 89, bulge: 0, openings: [],
    material: "timber", postMm: 600, postWidthMm: 38,
  }];
  const csv3 = materialsCsv(doc3);
  const rows3 = csv3.slice(1).split("\r\n").filter(l => l.length > 0).slice(1).map(l => l.split(";"));
  check("a formula-like storey name is quoted with a leading apostrophe",
    rows3.length > 0 && rows3.every(r => r[0] === "\"'=SUM(A1)\""),
    JSON.stringify(rows3.map(r => r[0])));
}

// ── purity: same document, same output ───────────────────────────────────

check("materialsCsv is pure: calling it again on the same document is byte-identical",
  materialsCsv(doc) === csv);

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
