// The Materialen fold-out: stock-nesting assumptions and the read-only wall
// takeoff they feed. Mirrors ui/energy.ts -- assumptions are cheap (they only
// read/write PlanDoc.materials) and render on every rebuild, while the
// takeoff itself resolves the active storey (core/materials.ts's
// floorMaterials) and so is computed by the caller only while the section is
// open; this module only lays out rows over whatever it is handed.
import { Store } from "../model/store";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";
import { sqm } from "./walls";
import { stockLengths, kerfMm, wastePct, sheetMm } from "../model/materials";
import type { Member, MemberName, WallSystem, WallTakeoff, FloorMaterials } from "../core/materials";
import type { NestResult } from "../core/stock";

/** materials.system.* key for each WallSystem id -- the id itself carries a
 *  dash, which is not a valid nested-key segment. */
const SYSTEM_KEY: Record<WallSystem, string> = {
  "framed-timber": "framedTimber",
  "framed-steel": "framedSteel",
  block: "block",
  sandwich: "sandwich",
  other: "other",
};

/** The existing panel row that states the fact an `incomplete` marker names,
 *  reused verbatim rather than duplicated -- see WallTakeoff.incomplete. */
const INCOMPLETE_FIELD_KEY: Record<WallTakeoff["incomplete"][number], string> = {
  postWidth: "panel.postWidthOn",
  block: "panel.blockOn",
  panel: "panel.panelWidthOn",
  lining: "panel.liningOn",
};

function wallLabel(lengthMm: number): string {
  return t("materials.wallLabel", { mm: Math.round(lengthMm) });
}

function memberLabel(name: MemberName): string {
  return t("materials.member." + name);
}

function systemLabel(system: WallSystem): string {
  return t("materials.system." + SYSTEM_KEY[system]);
}

/** Comma-separated mm, ascending, deduplicated integers. Empty means "clear
 *  to default"; any non-positive or non-numeric entry rejects the whole edit
 *  rather than keeping a partial list -- see model/materials.ts's own
 *  cleaning, which this mirrors for what a visitor is allowed to commit. */
function parseStockList(text: string): number[] | null {
  const parts = text.split(",").map(s => s.trim()).filter(s => s.length > 0);
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0) return null;
    nums.push(Math.round(n));
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * Stock lengths, saw kerf, waste allowance and sheet size. Plain fields, not
 * gated behind a set/unset toggle the way lining or posts are -- there is no
 * "no assumption" state to represent, only the document's own figure or the
 * trade default -- so a commit always writes through, and only the stock
 * list's empty-input gesture clears anything back to absent.
 */
export function renderMaterialAssumptions(
  rows: Pick<PaneRows, "numRow" | "textRow" | "noteRow">,
  store: Store,
): void {
  const d = store.doc;

  rows.textRow(t("materials.stock"), stockLengths(d).join(", "), text => {
    store.mutate(dd => {
      if (text.trim() === "") {
        if (!dd.materials) return;
        delete dd.materials.stockMm;
        if (Object.keys(dd.materials).length === 0) delete dd.materials;
        return;
      }
      const parsed = parseStockList(text);
      if (!parsed || parsed.length === 0) return; // invalid: leave the field as typed, commit nothing
      dd.materials ??= {};
      dd.materials.stockMm = parsed;
    });
  }, { allowEmpty: true });
  rows.noteRow(t("materials.stockHelp"));

  rows.numRow(t("materials.kerf"), kerfMm(d), n => store.mutate(dd => {
    dd.materials ??= {};
    dd.materials.kerfMm = Math.max(0, Math.round(n));
  }));
  rows.numRow(t("materials.waste"), wastePct(d), n => store.mutate(dd => {
    dd.materials ??= {};
    dd.materials.wastePct = Math.max(0, Math.round(n));
  }));
  const sheet = sheetMm(d);
  rows.numRow(t("materials.sheetWidth"), sheet.width, n => store.mutate(dd => {
    dd.materials ??= {};
    dd.materials.sheetMm = { ...sheetMm(dd), width: Math.max(1, Math.round(n)) };
  }), 50);
  rows.numRow(t("materials.sheetHeight"), sheet.height, n => store.mutate(dd => {
    dd.materials ??= {};
    dd.materials.sheetMm = { ...sheetMm(dd), height: Math.max(1, Math.round(n)) };
  }), 50);
}

/** One member line: count and length on the left, section on the right --
 *  the same left-label/right-value shape every other read-only row here
 *  uses. */
function memberRow(rows: Pick<PaneRows, "infoRow">, m: Member): void {
  rows.infoRow(`${m.count} × ${memberLabel(m.name)} ${Math.round(m.lengthMm)} mm`,
    `${m.sectionMm.w}×${m.sectionMm.d} mm`);
}

/** The nested buy list as one line ("6000 mm × 12, 3600 mm × 4, waste 7 %"),
 *  plus a splice count where any plate needed one. */
function nestRows(rows: Pick<PaneRows, "noteRow">, nested: NestResult): void {
  if (nested.stock.length === 0) return;
  const entries = nested.stock.map(s => t("materials.stockEntry", { length: s.lengthMm, count: s.count }));
  const waste = nested.wastePct > 0.05 ? ", " + t("materials.wasteSuffix", { pct: Math.round(nested.wastePct) }) : "";
  rows.noteRow(entries.join(", ") + waste);
  if (nested.splices > 0) rows.noteRow(t("materials.splices", { n: nested.splices }));
}

function figureRows(
  rows: Pick<PaneRows, "infoRow">,
  s: { boardMm2: number; sheets: number; insulationMm2: number; blocks: number; panels: number },
): void {
  if (s.boardMm2 > 0) {
    rows.infoRow(t("materials.boardArea"), sqm(s.boardMm2));
    rows.infoRow(t("materials.sheets"), String(s.sheets));
  }
  if (s.insulationMm2 > 0) rows.infoRow(t("materials.insulationArea"), sqm(s.insulationMm2));
  if (s.blocks > 0) rows.infoRow(t("materials.blocks"), String(s.blocks));
  if (s.panels > 0) rows.infoRow(t("materials.panels"), String(s.panels));
}

/**
 * The largest stock length in play -- a non-spliceable member longer than
 * this fits no bar at all. `stockLengths()` returns its list ascending, so
 * the last entry is the largest; an empty list (never happens -- the
 * accessor falls back to the default) reads as no limit.
 */
function maxStock(store: Store): number {
  const lens = stockLengths(store.doc);
  return lens.length > 0 ? lens[lens.length - 1]! : Infinity;
}

/**
 * The read-only takeoff: per system, its members, the nested buy list and
 * the board/insulation/block/panel quantities, then a warn row for every
 * member that fits no stock length and every wall missing a fact its system
 * needs. `takeoff` is supplied by the caller (Panel.syncMaterialsTakeoff),
 * which is what keeps floorMaterials()'s resolve and nest off the hot path.
 */
export function renderMaterialTakeoff(
  rows: Pick<PaneRows, "secHead" | "infoRow" | "noteRow" | "warnRow">,
  store: Store,
  takeoff: FloorMaterials,
): void {
  if (takeoff.walls.length === 0) { rows.noteRow(t("materials.noWalls")); return; }

  let shown = false;
  for (const sys of takeoff.bySystem) {
    // "other" walls carry no member shapes and, absent lining or insulation
    // of their own, nothing else this takeoff counts -- a header over
    // nothing would report a system that has, in fact, reported nothing.
    const hasFigures = sys.members.length > 0 || sys.boardMm2 > 0 || sys.insulationMm2 > 0
      || sys.blocks > 0 || sys.panels > 0;
    if (!hasFigures) continue;
    shown = true;
    rows.secHead(systemLabel(sys.system), { later: true });
    if (sys.system === "framed-timber" || sys.system === "framed-steel") {
      rows.noteRow(t("materials.studsNote"));
    }
    for (const m of sys.members) memberRow(rows, m);
    nestRows(rows, sys.nested);
    figureRows(rows, sys);
  }

  const max = maxStock(store);
  for (const w of takeoff.walls) {
    for (const m of w.members) {
      if (!m.spliceable && m.lengthMm > max) {
        shown = true;
        rows.warnRow(t("materials.unfit",
          { wall: wallLabel(w.lengthMm), member: memberLabel(m.name), length: Math.round(m.lengthMm) }));
      }
    }
  }
  for (const w of takeoff.walls) {
    for (const field of w.incomplete) {
      shown = true;
      rows.warnRow(t("materials.incomplete", { wall: wallLabel(w.lengthMm), field: t(INCOMPLETE_FIELD_KEY[field]) }));
    }
  }
  if (!shown) rows.noteRow(t("materials.nothing"));
}

/**
 * The selected wall's own members and figures, under a "Materiaal" head --
 * the wall-pane counterpart of the storey-wide takeoff above. Nothing to
 * nest here: stock is bought per storey/system, not per wall, so this reads
 * `wt.members` as drawn rather than running them through `nest()` again.
 * Renders nothing for a wall with no figures at all (an unframed, unlined,
 * unblocked, unpanelled wall -- "other" with nothing stated).
 */
export function renderWallMaterial(
  rows: Pick<PaneRows, "secHead" | "infoRow" | "noteRow" | "warnRow">,
  wt: WallTakeoff | undefined,
): void {
  if (!wt) return;
  const hasFigures = wt.members.length > 0 || wt.boardMm2 > 0 || wt.insulationMm2 > 0
    || wt.blocks > 0 || wt.panels > 0 || wt.incomplete.length > 0;
  if (!hasFigures) return;

  rows.secHead(t("materials.wallHead"), { later: true });
  if (wt.system === "framed-timber" || wt.system === "framed-steel") {
    rows.noteRow(t("materials.studsNote"));
  }
  for (const m of wt.members) memberRow(rows, m);
  figureRows(rows, wt);
  for (const field of wt.incomplete) {
    rows.warnRow(t("materials.incompleteField", { field: t(INCOMPLETE_FIELD_KEY[field]) }));
  }
}
