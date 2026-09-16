// Uitgangspunten sheet (issue #63): the spans, loads, sections and
// assumptions a constructeur needs to redo the preliminary structural checks
// (core/checks.ts) by hand -- one printed page, handed over alongside the
// plan rather than read off the panel.
//
// `assumptionsSheet(doc)` gathers a plain, language-agnostic model: every
// deck, beam and lintel the document states, the check core/checks.ts already
// runs for each, and the document's own assumption figures. No text lives in
// the model -- `assumptionsSvg`/`assumptionsPdf` below turn it into paper
// millimetres in the CURRENT UI language, so the model itself is what
// tests/assumptions.test.ts checks against. Rendering reuses the permit
// sheet's own machinery (io/scene.ts's primitives, io/pdf.ts's pdfDocument,
// io/svg.ts's sceneSvg) rather than a second page writer -- see io/permit.ts
// for the drawing counterpart of this same split.
//
// Reported, never enforced, like every check it lists: the sheet states what
// was drawn and assumed, not a constructieberekening (a registered structural
// calculation) -- see the header line assumptionsSvg()/assumptionsPdf() print
// and core/timber.ts's own standards-policy note.
import type { Id, PlanDoc, Floor, OpeningKind, WallMaterial } from "../model/doc";
import { decksOf, structureOf, projectOf, openingBearing, openingHead } from "../model/doc";
import { wallTopAt } from "../model/profile";
import { bearingOf } from "../model/deck";
import { deckSpanMm } from "../core/deck";
import type { Beam } from "../model/structure";
import { spanLength } from "../core/structure";
import { joistCheck, beamCheck, lintelCheck, type CheckResult } from "../core/checks";
import {
  timberOf, timberClassOf, steelFyOf, gammaGOf, gammaQOf, deflectionDivOf, sectionsMmOf,
  assumptionDrift, type TimberAssumptions, type AssumptionDrift,
} from "../model/materials";
import { text, line, group, type Item } from "./scene";
import { sceneSvg } from "./svg";
import { pdfDocument, pdfBytes, textWidth } from "./pdf";
import { saveViaHost, downloadBlob } from "./save";
import { t, language, formatNumber } from "../i18n";

// ── the model ────────────────────────────────────────────────────────────────

export interface SheetDeckRow {
  id: Id;
  /** Authored caption, or "" for the renderer's own generic fallback word. */
  label: string;
  spanMm: number;
  joistMm: number;
  bearingMm: number;
  loadG?: number;
  loadQ?: number;
  deckingMm?: number;
  result: CheckResult;
}

export interface SheetBeamRow {
  id: Id;
  label: string;
  spanMm: number;
  loadKNm?: number;
  result: CheckResult;
}

/** Every opening carries one of these -- a lintel spans a structural opening
 *  whether or not it has a frame, the same reading lintelCheck() itself takes
 *  (it runs for a passage exactly as it does for a door or window). */
export interface SheetLintelRow {
  id: Id;
  wallId: Id;
  kind: OpeningKind;
  widthMm: number;
  /** Opening width plus the bearing at each end -- the checked span. */
  spanMm: number;
  bearingMm: number;
  wallMaterial?: WallMaterial;
  wallThicknessMm: number;
  /** Wall height above the opening's head, mm -- what the self-weight is taken over. */
  aboveMm: number;
  lintelLoadKNm?: number;
  result: CheckResult;
}

export interface SheetStorey {
  id: Id;
  name: string;
  decks: SheetDeckRow[];
  beams: SheetBeamRow[];
  lintels: SheetLintelRow[];
}

export interface SheetAssumptions {
  timber: TimberAssumptions;
  steelFy: number;
  gammaG: number;
  gammaQ: number;
  deflectionDiv: number;
  sectionsMm: readonly { w: number; d: number }[];
}

export interface SheetModel {
  projectName?: string;
  projectAddress?: string;
  projectNumber?: string;
  author?: string;
  /** As authored on the title block; undefined means the export date. */
  date?: string;
  storeys: SheetStorey[];
  assumptions: SheetAssumptions;
  /** Every assumption the document has edited away from its indicative
   *  preset (issue #62's model/materials.ts's assumptionDrift()) -- surfaced
   *  here so an edited figure is visible on the printed sheet rather than
   *  buried in the panel that let it happen. */
  drift: readonly AssumptionDrift[];
  /** Every deck, beam and lintel across every storey, flattened, in document order. */
  hasElements: boolean;
}

function sheetStorey(doc: PlanDoc, f: Floor): SheetStorey {
  const decks: SheetDeckRow[] = decksOf(f).map(d => ({
    id: d.id, label: d.label ?? "",
    spanMm: deckSpanMm(d) + bearingOf(d), joistMm: d.joistMm, bearingMm: bearingOf(d),
    loadG: d.loadG, loadQ: d.loadQ, deckingMm: d.deckingMm,
    result: joistCheck(doc, d),
  }));

  const beams: SheetBeamRow[] = structureOf(f)
    .filter((el): el is Beam => el.kind === "beam")
    .map(b => ({
      id: b.id, label: b.label ?? "", spanMm: spanLength(b), loadKNm: b.loadKNm,
      result: beamCheck(doc, f, b),
    }));

  const lintels: SheetLintelRow[] = [];
  for (const w of f.walls) {
    for (const o of w.openings) {
      const aboveMm = Math.max(0, wallTopAt(f, w, o.t) - openingHead(o));
      lintels.push({
        id: o.id, wallId: w.id, kind: o.kind, widthMm: o.width,
        spanMm: o.width + openingBearing(o), bearingMm: openingBearing(o),
        wallMaterial: w.material, wallThicknessMm: w.thickness, aboveMm,
        lintelLoadKNm: o.lintelLoadKNm,
        result: lintelCheck(doc, f, w, o),
      });
    }
  }

  return { id: f.id, name: f.name, decks, beams, lintels };
}

/**
 * The whole sheet's plain data, gathered once per export: every deck, beam
 * and lintel per storey with the check core/checks.ts already runs for it,
 * plus the document's own assumption figures. Never returns null -- unlike
 * the permit sheet, a document that draws no decks, beams or lintels still
 * gets a page (its assumptions and excluded-checks list still apply); see
 * `hasElements` for what the renderer reads to print "nothing to report"
 * instead of an element table.
 */
export function assumptionsSheet(doc: PlanDoc): SheetModel {
  const meta = projectOf(doc);
  const storeys = doc.floors.map(f => sheetStorey(doc, f));
  const hasElements = storeys.some(s => s.decks.length + s.beams.length + s.lintels.length > 0);
  return {
    projectName: meta.name, projectAddress: meta.address, projectNumber: meta.number,
    author: meta.author, date: meta.date,
    storeys,
    assumptions: {
      timber: timberOf(doc), steelFy: steelFyOf(doc), gammaG: gammaGOf(doc),
      gammaQ: gammaQOf(doc), deflectionDiv: deflectionDivOf(doc), sectionsMm: sectionsMmOf(doc),
    },
    drift: assumptionDrift(doc),
    hasElements,
  };
}

// ── rendering ────────────────────────────────────────────────────────────────

/** A4 width; the height grows with the content -- a report page rather than
 *  a scaled drawing, so there is no paper size to fit a plan onto. */
const PAGE_W_MM = 210;
const MARGIN_MM = 18;
const CONTENT_W_MM = PAGE_W_MM - 2 * MARGIN_MM;

const SHEET_FONT = "system-ui, sans-serif";

/** The `missing` keys core/checks.ts's three checks report, worded plainly
 *  for a page nobody reads beside the app -- mirrors ui/deck.ts's,
 *  ui/structure.ts's and ui/panel.ts's own missingLabel() switches, but
 *  without their "on this panel" phrasing, which means nothing on paper. */
const MISSING_KEYS: Record<string, string> = {
  span: "assumptions.missingSpan",
  load: "assumptions.missingLoad",
  loadG: "assumptions.missingLoadG",
  joistSection: "assumptions.missingJoistSection",
  loadKNm: "assumptions.missingLoadKNm",
  material: "assumptions.missingMaterial",
  lintelSection: "assumptions.missingLintelSection",
};

function missingLabel(key: string): string {
  const k = MISSING_KEYS[key];
  return k ? t(k) : key;
}

/** Wording for a CheckResult's own `flags` (issue #62) -- mirrors
 *  ui/checks.ts's own FLAG_KEY, duplicated rather than imported: io/ does not
 *  reach into ui/ (see io/materials.ts's own note on the same point). */
const FLAG_KEY: Record<string, string> = {
  lowLoadQ: "checks.flagLowLoadQ",
  lowLoadG: "checks.flagLowLoadG",
  zeroLoad: "checks.flagZeroLoad",
};

/** assumptionDrift() keys that read as a whole number -- mirrors
 *  ui/checks.ts's DRIFT_WHOLE, duplicated for the same reason as FLAG_KEY
 *  above. */
const DRIFT_WHOLE = new Set(["deflectionDiv", "steelFy"]);

function driftLabel(key: string): string {
  return t("checks.drift" + key[0]!.toUpperCase() + key.slice(1));
}

function driftValue(n: number, key: string): string {
  const decimals = DRIFT_WHOLE.has(key) ? 0 : 1;
  return formatNumber(n, { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) });
}

/** One drift entry, worded in full ("k_mod 1,0 (standaard 0,8)") -- mirrors
 *  ui/checks.ts's own driftItemText(). */
function driftItemText(item: AssumptionDrift): string {
  if (item.key === "timberClass") return t("checks.driftTimberClass");
  return t("checks.driftItem", {
    label: driftLabel(item.key), value: driftValue(item.value, item.key), preset: driftValue(item.preset, item.key),
  });
}

/** The closing list of what a preliminary check excludes (issue #63) --
 *  broader than checks.resultNote's own prose, which is written for one
 *  result at a time on the panel: this is the sheet's own itemised list, plus
 *  what a trimmed opening in a deck needs and the app does not yet check
 *  (issue #64 is on its way). */
const EXCLUDED_KEYS: readonly string[] = [
  "assumptions.excludedPoint", "assumptions.excludedContinuous", "assumptions.excludedLateral",
  "assumptions.excludedNotches", "assumptions.excludedBearing", "assumptions.excludedConnections",
  "assumptions.excludedFire", "assumptions.excludedLoadPath", "assumptions.excludedFoundation",
  "assumptions.excludedTrimmer",
];

function pctText(u: number): string {
  if (!isFinite(u)) return "—";
  return `${Math.round(u * 100)}%`;
}

const mm = (n: number): string => `${Math.round(n)} mm`;
// Every decimal in the interface language's own format, so a sheet does not
// read "1,0" in one line and "17.6" in the next.
const knm = (n: number): string => `${formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kN/m`;
const fmt1 = (n: number): string => formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Greedy word wrap at `maxWidthMm`, measured with the Helvetica metrics the
 *  PDF writer paints with (io/pdf.ts's textWidth), less WRAP_SLACK. The SVG
 *  of the same sheet renders in the viewer's own sans-serif, which runs wider
 *  than Helvetica; the slack keeps a line inside the page in both. */
const WRAP_SLACK = 0.9;

function wrap(s: string, maxWidthMm: number, sizeMm: number, bold = false): string[] {
  maxWidthMm *= WRAP_SLACK;
  const words = s.split(/\s+/).filter(w => w.length > 0);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(trial, bold) * sizeMm > maxWidthMm) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

/** Places text top-down in paper millimetres, tracking how tall the page
 *  turns out to be -- there is no fixed sheet size to lay content INTO the
 *  way the permit sheet places a plan at a stated scale. */
class Cursor {
  y: number;
  readonly items: Item[] = [];
  constructor(y: number) { this.y = y; }

  private put(x: number, size: number, body: string, bold: boolean): void {
    if (body === "") return;
    const prim = text({ x, y: this.y }, size, body);
    this.items.push(bold ? group([prim], { bold: true }) : prim);
  }

  heading(body: string, size = 5.2): void {
    this.y += size * 0.5;
    this.put(MARGIN_MM, size, body, true);
    this.y += size * 1.1;
  }

  sub(body: string, size = 3.6): void {
    this.y += size * 0.3;
    this.put(MARGIN_MM, size, body, true);
    this.y += size * 1.45;
  }

  para(body: string, size = 3.1, indentMm = 0): void {
    for (const l of wrap(body, CONTENT_W_MM - indentMm, size)) {
      this.put(MARGIN_MM + indentMm, size, l, false);
      this.y += size * 1.55;
    }
  }

  bullet(body: string, size = 3.1): void {
    for (const l of wrap(`– ${body}`, CONTENT_W_MM, size)) {
      this.put(MARGIN_MM, size, l, false);
      this.y += size * 1.55;
    }
  }

  rule(): void {
    this.y += 1.5;
    this.items.push(line({ x: MARGIN_MM, y: this.y }, { x: PAGE_W_MM - MARGIN_MM, y: this.y }));
    this.y += 3;
  }

  gap(sizeMm: number): void { this.y += sizeMm; }
}

/** Title + one line of facts, then the load make-up, the section (or a named
 *  proposal), the utilisations and pass/fail, or the incomplete list with
 *  every missing input named -- never silently omitted. Shared by the three
 *  kinds; only the facts line and the section label differ, handed in by the
 *  caller exactly as ui/checks.ts's renderCheckResult() takes them. */
function addResultBlock(cursor: Cursor, title: string, facts: string[], result: CheckResult, sectionLabel: string | undefined): void {
  cursor.sub(title);
  for (const f of facts) cursor.para(f, 3.1, 3);
  if (sectionLabel) cursor.para(`${t("checks.section")}: ${sectionLabel}`, 3.1, 3);

  if (result.status === "incomplete") {
    for (const key of result.missing) cursor.para(t("checks.missingRow", { row: missingLabel(key) }), 3.1, 3);
    if (result.proposal) cursor.para(t("checks.proposalHint", { w: result.proposal.w, d: result.proposal.d }), 3.1, 3);
    else if (result.proposal === null) cursor.para(t("checks.noSectionPasses"), 3.1, 3);
  } else if (result.check) {
    const c = result.check;
    const bits = [
      `${t("checks.bending")} ${pctText(c.bending)}`,
      result.material === "timber" ? `${t("checks.shear")} ${pctText(c.shear)}` : "",
      `${t("checks.deflection")} ${pctText(c.deflection)} (${fmt1(c.deflectionMm)} / ${formatNumber(Math.round(c.limitMm))} mm)`,
      `${t("checks.governing")}: ${t("checks." + c.governing)}`,
    ].filter(b => b !== "");
    cursor.para(bits.join("  ·  "), 3.1, 3);
    cursor.para(`${t("checks.result")}: ${c.passes ? t("checks.pass") : t("checks.fail")}`, 3.1, 3);
    if (!c.passes) {
      if (result.proposal) cursor.para(t("checks.proposalHint", { w: result.proposal.w, d: result.proposal.d }), 3.1, 3);
      else if (result.proposal === null) cursor.para(t("checks.noSectionPasses"), 3.1, 3);
    }
  }

  if (result.comfort) {
    const cf = result.comfort;
    cursor.para(
      `${t("checks.comfortHz")} ${fmt1(cf.hz)} / ${fmt1(cf.minHz)} Hz  ·  ` +
      `${t("checks.comfortPoint")} ${fmt1(cf.pointMm)} / ${fmt1(cf.maxPointMm)} mm  ·  ` +
      `${t("checks.comfortResult")}: ${cf.passes ? t("checks.pass") : t("checks.fail")}`,
      3.1, 3);
  }

  for (const flag of result.flags ?? []) {
    const key = FLAG_KEY[flag];
    if (key) cursor.para(t(key), 3.1, 3);
  }
}

/** "Balklaag — naam" for a captioned deck; the plain word alone when the
 *  deck carries no caption of its own -- "Balklaag — balklaag" would repeat
 *  the same word for no reason, since deck.label's own generic fallback
 *  ("balklaag") is what the drawing prints, not a name. */
function deckTitle(row: SheetDeckRow): string {
  return row.label !== "" ? `${t("panel.structureDeck")} — ${row.label}` : t("panel.structureDeck");
}

function beamTitle(row: SheetBeamRow): string {
  return row.label !== "" ? `${t("panel.structureBeam")} — ${row.label}` : t("panel.structureBeam");
}

function lintelTitle(row: SheetLintelRow): string {
  return `${t("panel." + row.kind)} — ${mm(row.widthMm)}`;
}

/** `w × d mm` for a check that ran against a rectangular timber section --
 *  the "timber" material guard is what lets TypeScript see `.section` at
 *  all, since a SteelSpanInput carries none of its own. */
function timberSectionLabel(result: CheckResult): string | undefined {
  if (result.material !== "timber" || !result.input) return undefined;
  const { w, d } = (result.input as { section: { w: number; d: number } }).section;
  return `${w} × ${d} mm`;
}

function addDeck(cursor: Cursor, row: SheetDeckRow): void {
  const facts = [
    `${t("checks.span")}: ${mm(row.spanMm)}  ·  ${t("panel.deckJoistMm")}: ${mm(row.joistMm)}  ·  ${t("panel.deckBearing")}: ${mm(row.bearingMm)}`,
    `${t("panel.deckLoadG")}: ${row.loadG !== undefined ? `${row.loadG} N/m²` : "—"}` +
    `  ·  ${t("panel.deckLoadQ")}: ${row.loadQ !== undefined ? `${row.loadQ} N/m²` : "—"}` +
    (row.deckingMm ? `  ·  ${t("panel.deckDecking")}: ${mm(row.deckingMm)}` : ""),
  ];
  addResultBlock(cursor, deckTitle(row), facts, row.result, timberSectionLabel(row.result));
}

function addBeam(cursor: Cursor, row: SheetBeamRow): void {
  const facts = [
    `${t("checks.span")}: ${mm(row.spanMm)}  ·  ${t("panel.beamLoad")}: ${row.loadKNm !== undefined ? knm(row.loadKNm) : "—"}`,
  ];
  const sectionLabel = row.result.material === "steel"
    ? (row.label !== "" ? row.label : undefined)
    : timberSectionLabel(row.result);
  addBeamOrLintelBlock(cursor, beamTitle(row), facts, row.result, sectionLabel);
}

/** Beams and lintels share one block shape (checks.ts's renderCheckResult
 *  covers both); decks add the comfort lines addResultBlock already prints,
 *  so the shared body lives in addResultBlock and this is just the call. */
function addBeamOrLintelBlock(cursor: Cursor, title: string, facts: string[], result: CheckResult, sectionLabel: string | undefined): void {
  addResultBlock(cursor, title, facts, result, sectionLabel);
}

function addLintel(cursor: Cursor, row: SheetLintelRow): void {
  const materialLabel = row.wallMaterial ? t("panel.material_" + row.wallMaterial) : t("panel.materialUnknown");
  const facts = [
    `${t("checks.span")}: ${mm(row.spanMm)}  (${t("panel.lintelBearing")} ${mm(row.bearingMm)})`,
    `${t("panel.material")}: ${materialLabel}  ·  ${t("panel.thickness")}: ${mm(row.wallThicknessMm)}  ·  ${t("assumptions.aboveHead")}: ${mm(row.aboveMm)}`,
  ];
  if (row.lintelLoadKNm !== undefined) facts.push(`${t("panel.lintelLoad")}: ${knm(row.lintelLoadKNm)}`);
  addBeamOrLintelBlock(cursor, lintelTitle(row), facts, row.result, timberSectionLabel(row.result));
}

/** One decimal, in the number format of the interface language -- matches
 *  driftValue()'s own formatting for exactly these figures (issue #62), so a
 *  document that has not edited kmod away from its default still reads it in
 *  the same shape the drift row would name it in if it had. */
const f1 = (n: number): string => formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function addAssumptions(cursor: Cursor, model: SheetModel): void {
  cursor.heading(t("assumptions.assumptionsHeading"));
  const a = model.assumptions;
  const classId = timberClassOf(a.timber);
  cursor.para(`${t("materials.timberClass")}: ${classId ? t("materials.timberClass_" + classId) : t("materials.custom")}`);
  cursor.para(`f_m,k ${a.timber.fmk} N/mm²  ·  f_v,k ${a.timber.fvk} N/mm²  ·  E0,mean ${a.timber.e0mean} N/mm²`);
  cursor.para(`${t("materials.kmod")}: ${f1(a.timber.kmod)}  ·  ${t("materials.gammaM")}: ${f1(a.timber.gammaM)}  ·  ${t("materials.kdef")}: ${f1(a.timber.kdef)}`);
  cursor.para(`${t("materials.gammaG")}: ${f1(a.gammaG)}  ·  ${t("materials.gammaQ")}: ${f1(a.gammaQ)}  ·  ${t("materials.deflectionDiv")}: L/${Math.round(a.deflectionDiv)}`);
  if (a.timber.comfort) {
    cursor.para(`${t("materials.comfortMinHz")}: ${f1(a.timber.comfort.minHz)} Hz  ·  ${t("materials.comfortMaxPointMm")}: ${f1(a.timber.comfort.maxPointMm)} mm`);
  }
  cursor.para(`${t("assumptions.steelFy")}: ${Math.round(a.steelFy)} N/mm²`);
  cursor.para(`${t("materials.sections")}: ${a.sectionsMm.map(s => `${s.w}×${s.d}`).join(", ")} mm`);
}

function addDrift(cursor: Cursor, drift: readonly AssumptionDrift[]): void {
  if (drift.length === 0) return;
  cursor.heading(t("assumptions.driftHeading"));
  for (const item of drift) cursor.bullet(driftItemText(item));
}

function addExcluded(cursor: Cursor): void {
  cursor.heading(t("assumptions.excludedHeading"));
  for (const key of EXCLUDED_KEYS) cursor.bullet(t(key));
}

/** The sheet as one scene, in paper millimetres -- page width fixed at A4,
 *  height grown to whatever the content needs. */
function buildScene(model: SheetModel): { widthMm: number; heightMm: number; scene: Item[]; title: string } {
  const cursor = new Cursor(MARGIN_MM);

  cursor.heading(t("assumptions.title"), 6.5);
  for (const l of wrap(t("assumptions.subtitle"), CONTENT_W_MM, 3.1)) cursor.para(l, 3.1);
  cursor.gap(1.5);

  const dateText = model.date ?? new Date().toLocaleDateString(language() === "nl" ? "nl-NL" : "en-GB");
  const metaBits = [
    model.projectName ? `${t("sheet.project")}: ${model.projectName}` : undefined,
    model.projectAddress ? `${t("sheet.address")}: ${model.projectAddress}` : undefined,
    `${t("sheet.date")}: ${dateText}`,
    model.author ? `${t("sheet.author")}: ${model.author}` : undefined,
    model.projectNumber ? `${t("sheet.number")}: ${model.projectNumber}` : undefined,
  ].filter((b): b is string => b !== undefined);
  cursor.para(metaBits.join("  ·  "), 3.3);
  cursor.rule();

  if (!model.hasElements) {
    cursor.para(t("assumptions.noElements"));
    cursor.gap(2);
  } else {
    for (const storey of model.storeys) {
      if (storey.decks.length + storey.beams.length + storey.lintels.length === 0) continue;
      cursor.heading(`${t("sheet.storey")}: ${storey.name}`, 4.4);
      for (const row of storey.decks) addDeck(cursor, row);
      for (const row of storey.beams) addBeam(cursor, row);
      for (const row of storey.lintels) addLintel(cursor, row);
    }
  }

  cursor.rule();
  addAssumptions(cursor, model);
  if (model.drift.length > 0) {
    cursor.rule();
    addDrift(cursor, model.drift);
  }
  cursor.rule();
  addExcluded(cursor);

  const outer = group(cursor.items, {
    fill: "#000000", ink: "none", family: SHEET_FONT, anchor: "start", baseline: "alphabetic",
  }, "sheet");
  const title = [model.projectName, t("assumptions.title")].filter(s => s !== undefined && s !== "").join(" — ");
  return { widthMm: PAGE_W_MM, heightMm: cursor.y + MARGIN_MM, scene: [outer], title };
}

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** The sheet as an SVG document, sized in paper millimetres -- same shape as
 *  io/permit.ts's permitSvg(), but never null: an element-less document still
 *  gets its assumptions and excluded-checks list. */
export function assumptionsSvg(doc: PlanDoc): string {
  const sheet = buildScene(assumptionsSheet(doc));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"` +
    ` width="${n(sheet.widthMm)}mm" height="${n(sheet.heightMm)}mm" viewBox="0 0 ${n(sheet.widthMm)} ${n(sheet.heightMm)}">`,
    `<rect x="0" y="0" width="${n(sheet.widthMm)}" height="${n(sheet.heightMm)}" fill="#ffffff"/>`,
    ...sceneSvg(sheet.scene),
    `</svg>`,
  ].join("\n") + "\n";
}

/** The sheet as a PDF file, as a Latin-1 string of bytes -- reuses io/pdf.ts's
 *  page writer exactly as io/permit.ts's permitPdf() does, rather than a
 *  second one. */
export function assumptionsPdf(doc: PlanDoc): string {
  const sheet = buildScene(assumptionsSheet(doc));
  return pdfDocument({ widthMm: sheet.widthMm, heightMm: sheet.heightMm, background: "#ffffff", scene: sheet.scene }, sheet.title);
}

/** Filesystem-safe project name, or "floorplan" absent one -- mirrors
 *  io/materials.ts's own planBaseName(), duplicated rather than imported:
 *  a three-line filename helper is not worth coupling two export modules over. */
function planBaseName(doc: PlanDoc): string {
  const name = projectOf(doc).name?.trim();
  return name ? name.replace(/[\\/:*?"<>|]+/g, "-") : "floorplan";
}

export type AssumptionsResult = "saved" | "failed";

/** Downloaded through the same channel every other export uses (io/save.ts).
 *  Never "empty" (unlike the permit sheet): the sheet always has its
 *  assumptions and excluded-checks list, whole document like exportIfc() and
 *  exportMaterialsCsv() -- there is no floorIndex to pass. */
export async function exportAssumptions(doc: PlanDoc): Promise<AssumptionsResult> {
  const pdf = assumptionsPdf(doc);
  const filename = `${planBaseName(doc)}-uitgangspunten.pdf`;
  if (await saveViaHost(filename, () => `data:application/pdf;base64,${btoa(pdf)}`)) return "saved";
  return downloadBlob(filename, new Blob([pdfBytes(pdf)], { type: "application/pdf" })) ? "saved" : "failed";
}
