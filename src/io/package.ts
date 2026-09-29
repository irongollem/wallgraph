// The engineer's package (issue #78): one multi-page PDF -- a cover, the
// permit sheet, the uitgangspunten sheet, the materiaalstaat as a printed
// table and the elevation of every framed, block and sandwich wall -- handed
// to a constructeur in one export instead of four separate ones.
//
// Every page is built by the sheet that already owns it (io/permit.ts's
// permitSheet(), io/assumptions.ts's buildScene(), io/materials.ts's
// materialsRows(), core/frame.ts's wallElevation() drawn through
// render/frame.ts's drawElevation()) and laid onto one file by io/pdf.ts's
// pdfDocument(), which takes a list of pages rather than one -- there is no
// second PDF writer here, and no byte-level concatenation of separately
// generated PDFs.
//
// Wallgraph holds no licence or registration to assess structures: nothing
// on any page states or implies that a construction is safe, sufficient,
// compliant or approved. The statement below appears in full on the cover
// and in a short form in every page's footer; see CLAUDE.md's legal-text
// rule and the wording audit tests/package.test.ts runs against
// src/i18n.ts's `checks`/`assumptions`/`package` namespaces.
import type { PlanDoc } from "../model/doc";
import { projectOf } from "../model/doc";
import { resolveFloor } from "../core/resolve";
import { permitSheets } from "./permit";
import { assumptionsSheet, buildScene } from "./assumptions";
import { materialsHeaderRow, materialsRows, type MaterialsRow } from "./materials";
import { frameSheetHeightsMm, wallElevation, type WallElevation } from "../core/frame";
import { drawElevation } from "../render/frame";
import { recordSymbol } from "./record";
import { group, line, place, rect, text, type Item } from "./scene";
import { pdfBytes, pdfDocument, textWidth, type PdfPage } from "./pdf";
import { saveViaHost, downloadBlob } from "./save";
import { t, language, formatNumber } from "../i18n";

const SHEET_FONT = "system-ui, sans-serif";
const INK = "#26292e";

/** Which sections to include, beside the cover and the permit sheet, which
 *  are never optional -- the package always states what plan it is for and
 *  what a submission expects. All three default on, matching the panel's
 *  checkboxes (ui/panel.ts's Vergunningsblad section). */
export interface PackageOptions {
  assumptions?: boolean;
  materials?: boolean;
  elevations?: boolean;
}

interface ResolvedOptions { assumptions: boolean; materials: boolean; elevations: boolean }

function resolveOptions(options: PackageOptions): ResolvedOptions {
  return { assumptions: options.assumptions ?? true, materials: options.materials ?? true, elevations: options.elevations ?? true };
}

// ── word wrap, duplicated from io/assumptions.ts's own wrap() rather than
// imported: a fifteen-line helper is not worth coupling two export modules
// over, the same call io/materials.ts's planBaseName() makes. ──────────────
const WRAP_SLACK = 0.9;
function wrapText(s: string, maxWidthMm: number, sizeMm: number, bold = false): string[] {
  const maxW = maxWidthMm * WRAP_SLACK;
  const words = s.split(/\s+/).filter(w => w.length > 0);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(trial, bold) * sizeMm > maxW) { lines.push(cur); cur = w; }
    else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

/** Filesystem-safe project name -- mirrors io/assumptions.ts's and
 *  io/materials.ts's own planBaseName(), duplicated for the same reason
 *  those two duplicate it from each other. */
function planBaseName(doc: PlanDoc): string {
  const name = projectOf(doc).name?.trim();
  return name ? name.replace(/[\\/:*?"<>|]+/g, "-") : "floorplan";
}

// ── the cover page ──────────────────────────────────────────────────────────

const COVER_W_MM = 210;
const COVER_H_MM = 297;
const COVER_MARGIN_MM = 20;

function coverPage(doc: PlanDoc, opts: ResolvedOptions): PdfPage {
  const meta = projectOf(doc);
  const items: Item[] = [];
  let y = COVER_MARGIN_MM;

  const put = (size: number, s: string, bold = false): void => {
    items.push(bold ? group([text({ x: COVER_MARGIN_MM, y }, size, s)], { bold: true }) : text({ x: COVER_MARGIN_MM, y }, size, s));
  };

  put(8, t("package.title"), true);
  y += 8 * 1.8;

  const dateText = meta.date ?? new Date().toLocaleDateString(language() === "nl" ? "nl-NL" : "en-GB");
  const metaLines = [
    meta.name ? `${t("sheet.project")}: ${meta.name}` : undefined,
    meta.address ? `${t("sheet.address")}: ${meta.address}` : undefined,
    meta.author ? `${t("sheet.author")}: ${meta.author}` : undefined,
    meta.number ? `${t("sheet.number")}: ${meta.number}` : undefined,
    `${t("sheet.date")}: ${dateText}`,
  ].filter((s): s is string => s !== undefined);
  for (const l of metaLines) { put(3.6, l); y += 3.6 * 1.7; }
  y += 5;

  put(4.6, t("package.contentsHeading"), true);
  y += 4.6 * 1.8;
  const contents = [
    t("panel.permit"),
    ...(opts.assumptions ? [t("assumptions.title")] : []),
    ...(opts.materials ? [t("package.contentsMaterials")] : []),
    ...(opts.elevations ? [t("package.contentsElevations")] : []),
  ];
  for (const c of contents) { put(3.6, `– ${c}`); y += 3.6 * 1.7; }
  y += 8;

  for (const l of wrapText(t("package.statement"), COVER_W_MM - 2 * COVER_MARGIN_MM, 3.4)) {
    put(3.4, l);
    y += 3.4 * 1.7;
  }

  return {
    widthMm: COVER_W_MM, heightMm: COVER_H_MM, background: "#ffffff",
    scene: [group(items, { fill: "#111318", ink: "none", family: SHEET_FONT, anchor: "start", baseline: "alphabetic" })],
  };
}

// ── the permit sheet and uitgangspunten pages ───────────────────────────────

function permitPage(sheet: { widthMm: number; heightMm: number; scene: Item[] }): PdfPage {
  return { widthMm: sheet.widthMm, heightMm: sheet.heightMm, background: "#ffffff", scene: sheet.scene };
}

/** Grown by FOOTER_RESERVE_MM past the sheet's own natural height -- unlike
 *  the permit sheet, an uitgangspunten sheet has no outer margin band of its
 *  own past its content (buildScene() sizes the page to exactly reach the
 *  last line plus its own MARGIN_MM), so the footer needs a band added. */
const FOOTER_RESERVE_MM = 14;

function assumptionsPage(doc: PlanDoc): PdfPage {
  const sheet = buildScene(assumptionsSheet(doc));
  return { widthMm: sheet.widthMm, heightMm: sheet.heightMm + FOOTER_RESERVE_MM, background: "#ffffff", scene: sheet.scene };
}

// ── the materiaalstaat table pages ──────────────────────────────────────────

const MT_W_MM = 297;
const MT_H_MM = 210;
const MT_MARGIN_MM = 15;
const MT_ROW_H_MM = 4.2;
const MT_HEADER_GAP_MM = 12;
/** Rows per page, chosen with headroom under MT_H_MM for the title, the
 *  header row and the footer band -- see the module comment on why the
 *  footer's own placement rule (pageHeightMm - 7) needs that headroom. */
const MT_ROWS_PER_PAGE = 30;

/** Column x-offsets from MT_MARGIN_MM, mm -- "stock" ("Voorraadlengte (mm)")
 *  and "incomplete" ("Onvolledig") carry the longest captions of the ten, so
 *  they get the most room past their neighbours' own content widths. */
const MT_COLS: ReadonlyArray<{ key: keyof MaterialsRow; x: number }> = [
  { key: "storey", x: 0 }, { key: "system", x: 24 }, { key: "item", x: 54 },
  { key: "section", x: 110 }, { key: "length", x: 130 }, { key: "count", x: 148 },
  { key: "stock", x: 160 }, { key: "unit", x: 196 }, { key: "incomplete", x: 212 },
  { key: "offcut", x: 230 },
];

function materialsTablePage(header: MaterialsRow, rows: readonly MaterialsRow[], pageIndex: number, pageCount: number): PdfPage {
  const items: Item[] = [];
  const title = pageCount > 1
    ? `${t("package.materialsTitle")} (${pageIndex + 1}/${pageCount})`
    : t("package.materialsTitle");
  items.push(group([text({ x: MT_MARGIN_MM, y: MT_MARGIN_MM + 5 }, 5.2, title)], { bold: true }));

  let y = MT_MARGIN_MM + MT_HEADER_GAP_MM;
  const rowItems = (r: MaterialsRow, bold: boolean): Item =>
    group(MT_COLS.map(c => text({ x: MT_MARGIN_MM + c.x, y }, bold ? 2.8 : 2.6, r[c.key])), bold ? { bold: true } : undefined);
  items.push(rowItems(header, true));
  y += 4;
  items.push(line({ x: MT_MARGIN_MM, y }, { x: MT_W_MM - MT_MARGIN_MM, y }));
  y += 3.5;
  for (const r of rows) {
    items.push(rowItems(r, false));
    y += MT_ROW_H_MM;
  }

  return {
    widthMm: MT_W_MM, heightMm: MT_H_MM, background: "#ffffff",
    scene: [group(items, { fill: "#111318", ink: "#111318", width: 0.2, family: SHEET_FONT, anchor: "start", baseline: "alphabetic" })],
  };
}

function materialsPages(doc: PlanDoc): PdfPage[] {
  const header = materialsHeaderRow();
  const rows = materialsRows(doc);
  const chunks: MaterialsRow[][] = [];
  for (let i = 0; i < rows.length; i += MT_ROWS_PER_PAGE) chunks.push(rows.slice(i, i + MT_ROWS_PER_PAGE));
  if (chunks.length === 0) chunks.push([]);
  return chunks.map((chunk, i) => materialsTablePage(header, chunk, i, chunks.length));
}

// ── the elevation pages ─────────────────────────────────────────────────────

const EL_FRAME_MM = 10;
const EL_TITLE_H_MM = 10;
/** Reserved band below the drawing for the legend rows -- generous against
 *  a frame's own worst case (member families, plus a block's whole/cut
 *  counts or a sandwich's panel count are at most a handful of lines). */
const EL_STRIP_H_MM = 44;
/** Scales an elevation is tried at, finest first -- finer than the permit
 *  sheet's own PERMIT_SCALES (core/permit.ts): a wall's own face is far
 *  smaller than a storey plan, so a legible member outline wants 1:20-1:50
 *  rather than 1:100. */
const ELEVATION_SCALES: readonly number[] = [20, 25, 50, 75, 100, 150, 200];
const ELEVATION_PAPERS: ReadonlyArray<{ w: number; h: number }> = [{ w: 210, h: 297 }, { w: 297, h: 210 }];

interface ElevationLayout {
  pageW: number; pageH: number; scale: number;
  drawX: number; drawY: number; drawW: number; drawH: number; stripY: number;
}

/** A4 portrait or landscape, whichever the wall fits at the finest scale --
 *  falls back to the coarsest scale in landscape when even that does not
 *  fit, the same "state the problem, still export" reasoning
 *  core/permit.ts's own permitLayout() applies to a whole storey. */
function elevationLayout(e: WallElevation): ElevationLayout {
  const layout = (p: { w: number; h: number }, scale: number): ElevationLayout => {
    const drawW = p.w - 2 * EL_FRAME_MM;
    const drawH = p.h - 2 * EL_FRAME_MM - EL_TITLE_H_MM - EL_STRIP_H_MM;
    return {
      pageW: p.w, pageH: p.h, scale,
      drawX: EL_FRAME_MM, drawY: EL_FRAME_MM + EL_TITLE_H_MM, drawW, drawH,
      stripY: p.h - EL_FRAME_MM - EL_STRIP_H_MM,
    };
  };
  for (const scale of ELEVATION_SCALES) {
    for (const p of ELEVATION_PAPERS) {
      const trial = layout(p, scale);
      if (e.lengthMm / scale <= trial.drawW && e.heightMm / scale <= trial.drawH) return trial;
    }
  }
  return layout(ELEVATION_PAPERS[1]!, ELEVATION_SCALES[ELEVATION_SCALES.length - 1]!);
}

/** The legend's own lines: member counts for a frame, whole/cut block
 *  counts for a block wall, the panel count for a sandwich wall, and every
 *  `notes` entry -- the plain-text counterpart of ui/frame.ts's own
 *  legendRows(), duplicated rather than imported: io/ never reaches into
 *  ui/, and that renderer builds HTMLElements this one has no use for. */
function legendLines(e: WallElevation): string[] {
  const lines: string[] = [];
  if (e.kind === "frame") {
    const counts = new Map<string, number>();
    for (const m of e.members) counts.set(m.name, (counts.get(m.name) ?? 0) + m.count);
    for (const [name, count] of counts) lines.push(`${count} × ${t("materials.member." + name)}`);
  } else if (e.kind === "block") {
    const whole = e.courses.reduce((n, c) => n + c.blocks.filter(b => !b.cut).length, 0);
    const cut = e.courses.reduce((n, c) => n + c.blocks.filter(b => b.cut).length, 0);
    if (whole > 0) lines.push(t("frame.legendBlocks", { n: whole }));
    if (cut > 0) lines.push(t("frame.legendCut", { n: cut }));
  } else if (e.kind === "panel" && e.notes.length === 0) {
    lines.push(t("frame.legendPanels", { n: e.panelEdges.length + 1 }));
  }
  for (const note of e.notes) lines.push(t("frame.note_" + note));
  return lines;
}

/** One wall's elevation, replayed through the symbol recorder exactly as
 *  io/frame.ts's frameSvg() replays it for the standalone SVG download --
 *  same geometry, laid onto paper at a stated scale instead of at true
 *  size. */
function elevationPage(floorName: string, e: WallElevation): PdfPage {
  const L = elevationLayout(e);
  const items: Item[] = [];
  items.push(group([rect(EL_FRAME_MM, EL_FRAME_MM, L.pageW - 2 * EL_FRAME_MM, L.pageH - 2 * EL_FRAME_MM)],
    { fill: "none", ink: INK, width: 0.35 }));
  items.push(text({ x: EL_FRAME_MM + 2, y: EL_FRAME_MM + 6 }, 4.2,
    `${floorName} — ${formatNumber(Math.round(e.lengthMm))} mm · 1:${L.scale}`));

  const k = 1 / L.scale;
  const prims = recordSymbol({ draw: ctx => drawElevation(ctx, e) }, 0, 0, 0, false);
  const offX = L.drawX + (L.drawW - e.lengthMm * k) / 2;
  const offY = L.drawY + (L.drawH - e.heightMm * k) / 2;
  items.push(group(prims, { ink: INK, fill: "none", width: 12, cap: "round", join: "round" }, "elevation", place(k, offX, offY)));

  let ly = L.stripY + 5;
  for (const l of legendLines(e)) {
    items.push(text({ x: EL_FRAME_MM + 2, y: ly }, 2.6, l));
    ly += 2.6 * 1.6;
  }

  return { widthMm: L.pageW, heightMm: L.pageH, background: "#ffffff", scene: items };
}

/** A small A4 page stating what the elevations section could not draw --
 *  used only when there is something to say: every wall drew, and none was
 *  skipped, needs no page of its own past the elevations themselves. */
function elevationsNotePage(lines: readonly string[]): PdfPage {
  const items: Item[] = [];
  let y = COVER_MARGIN_MM;
  items.push(text({ x: COVER_MARGIN_MM, y: y + 5 }, 6, t("package.contentsElevations")));
  y += 16;
  for (const l of lines) {
    for (const wl of wrapText(l, COVER_W_MM - 2 * COVER_MARGIN_MM, 3.4)) {
      items.push(text({ x: COVER_MARGIN_MM, y }, 3.4, wl));
      y += 3.4 * 1.7;
    }
    y += 2;
  }
  return {
    widthMm: COVER_W_MM, heightMm: COVER_H_MM, background: "#ffffff",
    scene: [group(items, { fill: "#111318", ink: "none", family: SHEET_FONT, anchor: "start", baseline: "alphabetic" })],
  };
}

/** Every framed, block and sandwich wall's elevation, floor by floor, in
 *  document order -- a plain wall (core/frame.ts's wallElevation() `kind:
 *  "plain"`, e.g. concrete or glass) is skipped and counted rather than
 *  drawn, per the issue's own contract. */
function elevationPages(doc: PlanDoc): PdfPage[] {
  const pages: PdfPage[] = [];
  let skipped = 0, drawn = 0;
  const walls: PdfPage[] = [];
  for (const f of doc.floors) {
    const resolved = resolveFloor(f);
    for (const w of f.walls) {
      const rw = resolved.walls.get(w.id);
      if (!rw) continue;
      const e = wallElevation(f, w, rw, frameSheetHeightsMm(doc, w));
      if (e.kind === "plain") { skipped++; continue; }
      drawn++;
      walls.push(elevationPage(f.name, e));
    }
  }
  const notes: string[] = [];
  if (drawn === 0) notes.push(t("package.noElevations"));
  if (skipped > 0) notes.push(t("package.elevationsSkipped", { n: skipped }));
  if (notes.length > 0) pages.push(elevationsNotePage(notes));
  pages.push(...walls);
  return pages;
}

// ── the footer ───────────────────────────────────────────────────────────────

/** The short statement plus the page number, in the outer margin band every
 *  page reserves at its own bottom -- see each page builder above for how
 *  it makes room. */
function withFooter(p: PdfPage, pageNum: number, total: number): PdfPage {
  const maxWidthMm = p.widthMm - 20;
  const body = `${t("package.statementFooter")} — ${t("package.pageOf", { n: pageNum, total })}`;
  const lines = wrapText(body, maxWidthMm, 2.1);
  const y0 = p.heightMm - 7;
  const items: Item[] = lines.map((l, i) => text({ x: 10, y: y0 - (lines.length - 1 - i) * 2.1 * 1.6 }, 2.1, l));
  return { ...p, scene: [...p.scene, group(items, { fill: "#5a5f66", ink: "none", family: SHEET_FONT, anchor: "start", baseline: "alphabetic" })] };
}

// ── assembly ─────────────────────────────────────────────────────────────────

/**
 * The whole package as a PDF file, as a Latin-1 string of bytes, with a permit
 * sheet for each storey in `floorIndices` that has something drawn, or null
 * when none has -- same reading as io/permit.ts's permitPdf(): the package
 * cannot omit that page. A document with walls but no decks, beams
 * or lintels still produces a full package: the uitgangspunten page states
 * that plainly (assumptionsSheet()'s own `hasElements`) rather than being
 * skipped.
 */
export function engineerPackagePdf(doc: PlanDoc, floorIndices: readonly number[], options: PackageOptions = {}): string | null {
  const opts = resolveOptions(options);
  const sheets = permitSheets(doc, floorIndices);
  if (sheets.length === 0) return null;

  const pages: PdfPage[] = [coverPage(doc, opts), ...sheets.map(permitPage)];
  if (opts.assumptions) pages.push(assumptionsPage(doc));
  if (opts.materials) pages.push(...materialsPages(doc));
  if (opts.elevations) pages.push(...elevationPages(doc));

  const numbered = pages.map((p, i) => withFooter(p, i + 1, pages.length));
  const meta = projectOf(doc);
  const title = [meta.name, t("package.title")].filter((s): s is string => s !== undefined && s !== "").join(" — ");
  return pdfDocument(numbered, title);
}

export type PackageResult = "saved" | "empty" | "failed";

export async function exportEngineerPackage(doc: PlanDoc, floorIndices: readonly number[], options: PackageOptions = {}): Promise<PackageResult> {
  const pdf = engineerPackagePdf(doc, floorIndices, options);
  if (!pdf) return "empty";
  const filename = `${planBaseName(doc)}-pakket-constructeur.pdf`;
  if (await saveViaHost(filename, () => `data:application/pdf;base64,${btoa(pdf)}`)) return "saved";
  return downloadBlob(filename, new Blob([pdfBytes(pdf)], { type: "application/pdf" })) ? "saved" : "failed";
}
