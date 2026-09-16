// Materiaalstaat CSV export: the same per-storey, per-system takeoff
// core/materials.ts computes for the Materialen fold-out (ui/materials.ts),
// reshaped as one line item per row rather than read-only panel text, plus
// each system's nested stock-buy list as trailing rows. The preliminary span
// checks (core/checks.ts) are not exported here -- see issue #51: they are
// advisory, not a materiaalstaat line, and depend on assumptions the sheet
// does not carry.
//
// Semicolon-separated (a decimal comma would collide with a comma separator),
// UTF-8 with a leading BOM so a spreadsheet reads the accented characters
// rather than guessing at an encoding. Millimetre and count figures are plain
// integers; an area carries two decimals, with the decimal separator of the
// interface's own language -- a comma under nl, a point under en. A sheet
// written in English and read with a comma would be read as hundreds of
// square metres by a spreadsheet in an English locale.
import type { Floor, PlanDoc } from "../model/doc";
import { projectOf } from "../model/doc";
import { resolveFloor } from "../core/resolve";
import { detectRooms } from "../core/rooms";
import { floorSurface } from "../core/surface";
import {
  floorMaterials,
  type FloorMaterials, type Member, type MemberName, type WallSystem, type WallTakeoff,
} from "../core/materials";
import type { NestResult } from "../core/stock";
import { t, language } from "../i18n";
import { saveViaHost, downloadBlob } from "./save";

/** The panel row an `incomplete` marker restates -- see ui/materials.ts's own
 *  INCOMPLETE_FIELD_KEY, duplicated here rather than imported: io/ never
 *  reaches into ui/. */
const INCOMPLETE_FIELD_KEY: Record<WallTakeoff["incomplete"][number], string> = {
  postWidth: "panel.postWidthOn",
  block: "panel.blockOn",
  panel: "panel.panelWidthOn",
  lining: "panel.liningOn",
};

function csvField(s: string): string {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function row(fields: readonly string[]): string {
  return fields.map(csvField).join(";");
}

/** Whole millimetres/counts -- no thousands separator, these never run large
 *  enough to want one. */
function csvInt(n: number): string {
  return String(Math.round(n));
}

/** m^2, two decimals, the decimal separator of the interface language; see the file
 *  banner above for why this does not follow the interface language. */
function csvArea(mm2: number): string {
  const text = (mm2 / 1e6).toFixed(2);
  return language() === "nl" ? text.replace(".", ",") : text;
}

const memberLabel = (name: MemberName): string => t("materials.member." + name);

const SYSTEM_KEY: Record<WallSystem, string> = {
  "framed-timber": "framedTimber", "framed-steel": "framedSteel",
  block: "block", sandwich: "sandwich", other: "other",
};
const systemLabel = (system: WallSystem): string => t("materials.system." + SYSTEM_KEY[system]);

/** How many of this system's walls carry each `incomplete` marker -- the CSV
 *  states the count as its own line rather than dropping the marker, the
 *  same "flagged, not silently zero" reading the Materialen fold-out gives a
 *  warnRow for each wall. */
function systemIncompleteCounts(
  walls: readonly WallTakeoff[], system: WallSystem,
): Map<WallTakeoff["incomplete"][number], number> {
  const counts = new Map<WallTakeoff["incomplete"][number], number>();
  for (const w of walls) {
    if (w.system !== system) continue;
    for (const field of w.incomplete) counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  return counts;
}

/** One system's or one storey's decks' nested buy list, as trailing rows:
 *  one per bought stock length (its own count and total offcut), then a
 *  waste-percentage row and a splice-count row where either is non-zero, and
 *  one row per unfit piece -- a piece too long for every stock length, never
 *  silently dropped from the sheet. */
function pushStockRows(out: string[], storey: string, system: string, nested: NestResult): void {
  for (const s of nested.stock) {
    out.push(row([storey, system, t("materials.csv.stockItem"), "", csvInt(s.lengthMm), csvInt(s.count),
      csvInt(s.offcutMm), t("materials.csv.unit.length"), ""]));
  }
  if (nested.wastePct > 0) {
    out.push(row([storey, system, t("materials.csv.wasteItem"), "", "", csvInt(nested.wastePct), "", "%", ""]));
  }
  if (nested.splices > 0) {
    out.push(row([storey, system, t("materials.csv.splicesItem"), "", "", csvInt(nested.splices), "",
      t("materials.csv.unit.piece"), ""]));
  }
  for (const u of nested.unfit) {
    out.push(row([storey, system, memberLabel(u.name as MemberName), "", csvInt(u.lengthMm), csvInt(u.count), "",
      t("materials.csv.unit.piece"), "x"]));
  }
}

function pushMemberRows(out: string[], storey: string, system: string, members: readonly Member[]): void {
  for (const m of members) {
    out.push(row([storey, system, memberLabel(m.name), `${m.sectionMm.w}x${m.sectionMm.d}`,
      csvInt(m.lengthMm), csvInt(m.count), "", t("materials.csv.unit.piece"), ""]));
  }
}

function pushSystemRows(
  out: string[], storey: string, system: WallSystem,
  sys: FloorMaterials["bySystem"][number], walls: readonly WallTakeoff[],
): void {
  const name = systemLabel(system);
  const incomplete = systemIncompleteCounts(walls, system);
  pushMemberRows(out, storey, name, sys.members);
  if (sys.boardMm2 > 0 || incomplete.has("lining")) {
    out.push(row([storey, name, t("materials.boardArea"), "", "", csvArea(sys.boardMm2), "",
      t("materials.csv.unit.area"), incomplete.has("lining") ? "x" : ""]));
  }
  if (sys.sheets > 0) {
    out.push(row([storey, name, t("materials.sheets"), "", "", csvInt(sys.sheets), "",
      t("materials.csv.unit.sheet"), ""]));
  }
  if (sys.insulationMm2 > 0) {
    out.push(row([storey, name, t("materials.insulationArea"), "", "", csvArea(sys.insulationMm2), "",
      t("materials.csv.unit.area"), ""]));
  }
  if (sys.blocks > 0 || incomplete.has("block")) {
    out.push(row([storey, name, t("materials.blocks"), "", "", csvInt(sys.blocks), "",
      t("materials.csv.unit.block"), incomplete.has("block") ? "x" : ""]));
  }
  if (sys.panels > 0 || incomplete.has("panel")) {
    out.push(row([storey, name, t("materials.panels"), "", "", csvInt(sys.panels), "",
      t("materials.csv.unit.panel"), incomplete.has("panel") ? "x" : ""]));
  }
  const postWidth = incomplete.get("postWidth");
  if (postWidth) {
    out.push(row([storey, name, t(INCOMPLETE_FIELD_KEY.postWidth), "", "", csvInt(postWidth), "",
      t("materials.csv.unit.wall"), "x"]));
  }
  pushStockRows(out, storey, name, sys.nested);
}

/**
 * A storey's decks as one more "system" section, named by `materials.decksHead`
 * -- the joists and rim boards floorMaterials() already derives for the
 * Materialen fold-out (core/materials.ts's deckTakeoffOf(), stated in its own
 * comment: no separate takeoff module for decks). A deck missing a joist
 * section is flagged the same way an incomplete wall is, not left as a
 * silent zero.
 */
function pushDeckRows(out: string[], storey: string, decks: FloorMaterials["decks"]): void {
  const incompleteDecks = decks.perDeck.filter(d => d.incomplete.includes("joist")).length;
  const hasFigures = decks.members.length > 0 || decks.deckingMm2 > 0 || incompleteDecks > 0;
  if (!hasFigures) return;
  const name = t("materials.decksHead");
  pushMemberRows(out, storey, name, decks.members);
  if (decks.deckingMm2 > 0) {
    out.push(row([storey, name, t("materials.deckingArea"), "", "", csvArea(decks.deckingMm2), "",
      t("materials.csv.unit.area"), ""]));
  }
  if (decks.sheets > 0) {
    out.push(row([storey, name, t("materials.sheets"), "", "", csvInt(decks.sheets), "",
      t("materials.csv.unit.sheet"), ""]));
  }
  if (incompleteDecks > 0) {
    out.push(row([storey, name, t("panel.deckSectionOn"), "", "", csvInt(incompleteDecks), "",
      t("materials.csv.unit.deck"), "x"]));
  }
  pushStockRows(out, storey, name, decks.nested);
}

function floorRows(doc: PlanDoc, f: Floor): string[] {
  const resolved = resolveFloor(f);
  const rooms = detectRooms(f);
  const surface = floorSurface(f, resolved, rooms);
  const takeoff = floorMaterials(doc, f, resolved, surface);
  const out: string[] = [];
  for (const sys of takeoff.bySystem) {
    const incomplete = systemIncompleteCounts(takeoff.walls, sys.system);
    const hasFigures = sys.members.length > 0 || sys.boardMm2 > 0 || sys.insulationMm2 > 0
      || sys.blocks > 0 || sys.panels > 0 || incomplete.size > 0;
    if (!hasFigures) continue;
    pushSystemRows(out, f.name, sys.system, sys, takeoff.walls);
  }
  pushDeckRows(out, f.name, takeoff.decks);
  return out;
}

/** materialsCsv(doc): the whole materiaalstaat as one CSV string, BOM
 *  included -- see the file banner for the encoding and locale rules. */
export function materialsCsv(doc: PlanDoc): string {
  const header = row([
    t("materials.csv.header.storey"), t("materials.csv.header.system"), t("materials.csv.header.item"),
    t("materials.csv.header.section"), t("materials.csv.header.length"), t("materials.csv.header.count"),
    t("materials.csv.header.stock"), t("materials.csv.header.unit"), t("materials.csv.header.incomplete"),
  ]);
  const lines = [header];
  for (const f of doc.floors) lines.push(...floorRows(doc, f));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Filesystem-safe project name, or "floorplan" absent one -- matches the
 *  fallback the other exports' fixed "floorplan.*" filenames already read as
 *  a plan without a stated name. */
function planBaseName(doc: PlanDoc): string {
  const name = projectOf(doc).name?.trim();
  return name ? name.replace(/[\\/:*?"<>|]+/g, "-") : "floorplan";
}

export type MaterialsCsvResult = "saved" | "failed";

/** Downloaded through the same channel every other export uses (see
 *  io/save.ts): the hosted downloads capability, then a blob link. The BOM
 *  already lives in `csv` itself, so neither path adds one again. */
export async function exportMaterialsCsv(doc: PlanDoc): Promise<MaterialsCsvResult> {
  const csv = materialsCsv(doc);
  const filename = `${planBaseName(doc)}-materiaalstaat.csv`;
  if (await saveViaHost(filename, () => csv)) return "saved";
  if (downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }))) return "saved";
  return "failed";
}
