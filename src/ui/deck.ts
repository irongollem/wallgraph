// The deck pane: the figures the next deck is placed with, and the properties
// of a placed one. Same shape as the vide pane; the tool rows are hosted by the
// structure pane, where the deck is one of its kinds.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { decksOf, floorHeight } from "../model/doc";
import {
  Deck, DeckSize, DECK_DEFAULT, DECK_USES, BEARING_DEFAULT_MM, clampDeckSize, clampSection,
  clampBearing, clampDecking, clampDeckTop, deckUseOf,
} from "../model/deck";
import { deckSpanMm, deckJoistsLocal } from "../core/deck";
import { joistCheck } from "../core/checks";
import { renderCheckResult } from "./checks";
import { stairAngle } from "../model/stair";
import { isMixed } from "../core/mixed";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** A section to start from when one is first stated: an ordinary 71×171 joist. */
const SECTION_START = { w: 71, d: 171 };

/** Size, joist direction, centres and angle the next deck is placed with. */
export function renderDeckTool(tools: Tools, rows: PaneRows): void {
  sizeRows(rows, tools.deckSize, next => tools.setDeckSize(next));
  rows.numRow(t("panel.rotation"), (tools.deckRotation * 180) / Math.PI,
    n => tools.setDeckRotation((n * Math.PI) / 180), 15, { snap: snapAngle });
  rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
  rows.noteRow(t("panel.deckNote"));
}

/** Properties of the selected deck. */
export function renderDeckProps(store: Store, tools: Tools, rows: PaneRows, id: string): void {
  const f = store.floor;
  const deck = decksOf(f).find(x => x.id === id);
  if (!deck) return;

  const mut = (fn: (d: Deck) => void, coalesceKey?: string): void => {
    store.mutate(doc => {
      const d2 = decksOf(store.floorOf(doc)).find(x => x.id === id);
      if (d2) fn(d2);
    }, coalesceKey);
  };

  rows.secHead(t("panel.structureDeck"), { sel: true });
  sizeRows(rows, deck, next => mut(d => Object.assign(d, next)));
  rows.numRow(t("panel.rotation"), (deck.rotation * 180) / Math.PI,
    n => mut(d => { d.rotation = stairAngle((n * Math.PI) / 180); }), 15, { snap: snapAngle });

  // Set/unset, as a column's own height is: absent is "not stated", which the
  // takeoff reports rather than assuming a section.
  rows.checkRow(t("panel.deckSectionOn"), deck.joist !== undefined, on => mut(d => {
    if (on) d.joist = { ...SECTION_START }; else delete d.joist;
  }));
  if (deck.joist) {
    const j = deck.joist;
    rows.numRow(t("panel.deckJoistW"), j.w, n => mut(d => { d.joist = { w: clampSection(n), d: j.d }; }), 1);
    rows.numRow(t("panel.deckJoistD"), j.d, n => mut(d => { d.joist = { w: j.w, d: clampSection(n) }; }), 1);
  }
  rows.numRow(t("panel.deckBearing"), deck.bearingMm ?? BEARING_DEFAULT_MM,
    n => mut(d => { d.bearingMm = clampBearing(n); }), 10);
  rows.numRow(t("panel.deckDecking"), deck.deckingMm ?? 0, n => mut(d => {
    const k = clampDecking(n);
    if (k > 0) d.deckingMm = k; else delete d.deckingMm;
  }), 1, { title: t("panel.deckDeckingHelp") });

  const storey = floorHeight(f);
  rows.checkRow(t("panel.deckRaised"), deck.topMm !== undefined, on => mut(d => {
    if (on) d.topMm = clampDeckTop(Math.round(storey / 2), storey); else delete d.topMm;
  }));
  if (deck.topMm !== undefined) {
    rows.numRow(t("panel.deckTop"), deck.topMm, n => mut(d => { d.topMm = clampDeckTop(n, storey); }), 50,
      { title: t("panel.deckTopHelp") });
  }

  loadRows(rows, deck, fn => mut(fn));

  rows.textRow(t("panel.deckLabel"), deck.label ?? t("deck.label"),
    s => mut(d => { d.label = s === t("deck.label") ? undefined : s; }));
  rows.colorRow(t("panel.color"), deck.color ?? null, hex => {
    tools.symbolColor = hex;
    mut(d => { if (hex) d.color = hex; else delete d.color; }, "color:" + id);
  });
  rows.infoRow(t("panel.deckArea"), `${((deck.width * deck.depth) / 1e6).toFixed(2)} m²`);
  rows.infoRow(t("panel.deckSpan"), `${deckSpanMm(deck)} mm`);
  rows.infoRow(t("panel.deckJoists"), String(deckJoistsLocal(deck).length));
  rows.noteRow(t("panel.deckNote"));

  const result = joistCheck(store.doc, deck);
  renderCheckResult(rows, result, joistMissingLabel, deck.joist ? `${deck.joist.w} × ${deck.joist.d} mm` : undefined,
    (w, d) => mut(d2 => { d2.joist = { w, d }; }));

  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/** Wording for joistCheck()'s `missing` keys -- each points at the row it is
 *  entered in, all of them on this same pane. */
function joistMissingLabel(key: string): string {
  switch (key) {
    case "span": return t("checks.missingSpanDeck");
    case "load": return t("checks.missingLoadDeck");
    case "joistSection": return t("panel.deckSectionOn");
    default: return key;
  }
}

/** Properties of every selected deck at once: colour and loads, which read the
 *  same across a group; size and set-out do not. */
export function renderDeckBulk(store: Store, tools: Tools, rows: PaneRows, ids: readonly string[]): void {
  const decks = decksOf(store.floor).filter(d => ids.includes(d.id));
  const first = decks[0];
  if (!first) return;
  const each = (fn: (d: Deck) => void, coalesceKey?: string): void => {
    store.mutate(doc => {
      for (const d of decksOf(store.floorOf(doc))) if (ids.includes(d.id)) fn(d);
    }, coalesceKey);
  };
  rows.secHead(t("panel.selectionHeader", { n: decks.length, label: t("panel.structureDeck") }), { sel: true, mode: true });
  rows.colorRow(t("panel.color"), first.color ?? null, hex => {
    tools.symbolColor = hex;
    each(d => { if (hex) d.color = hex; else delete d.color; }, "color:" + ids.join(","));
  }, { mixed: isMixed(decks, d => d.color ?? "") });
  loadRows(rows, first, each, {
    use: isMixed(decks, d => deckUseOf(d)),
    g: isMixed(decks, d => String(d.loadG ?? "")),
    q: isMixed(decks, d => String(d.loadQ ?? "")),
  });
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/**
 * The use preset and the two load rows. The preset only fills the figures;
 * the select reads back whichever preset they match, or "custom".
 */
function loadRows(
  rows: PaneRows, d: Deck, mut: (fn: (d: Deck) => void) => void,
  mixed: { use: boolean; g: boolean; q: boolean } = { use: false, g: false, q: false },
): void {
  const use = deckUseOf(d);
  const options: Array<[string, string]> = [
    ["", t("panel.deckUseNone")],
    ...DECK_USES.map(u => [u.id, t("deck.use_" + u.id)] as [string, string]),
  ];
  if (use === "custom") options.push(["custom", t("panel.deckUseCustom")]);
  rows.selRow(t("panel.deckUse"), use, options, id => mut(x => {
    if (id === "custom") return;
    const preset = DECK_USES.find(u => u.id === id);
    if (preset) { x.loadG = preset.loadG; x.loadQ = preset.loadQ; }
    else { delete x.loadG; delete x.loadQ; }
  }), { mixed: mixed.use });
  const load = (n: number): number => Math.max(0, Math.round(isFinite(n) ? n : 0));
  rows.numRow(t("panel.deckLoadG"), d.loadG ?? 0, n => mut(x => { x.loadG = load(n); }), 250, { mixed: mixed.g });
  rows.numRow(t("panel.deckLoadQ"), d.loadQ ?? 0, n => mut(x => { x.loadQ = load(n); }), 250, { mixed: mixed.q });
  rows.noteRow(t("panel.deckLoadNote"));
}

function sizeRows(rows: PaneRows, s: DeckSize, commit: (next: DeckSize) => void): void {
  const set = (patch: Partial<DeckSize>): void => commit(clampDeckSize({ ...pick(s), ...patch }));
  rows.numRow(t("panel.deckWidth"), s.width, n => set({ width: n }), 100);
  rows.numRow(t("panel.deckDepth"), s.depth, n => set({ depth: n }), 100);
  rows.selRow(t("panel.deckAxis"), s.joistAxis,
    [["x", t("panel.deckAxis_x")], ["y", t("panel.deckAxis_y")]],
    value => set({ joistAxis: value === "x" ? "x" : "y" }));
  rows.numRow(t("panel.deckJoistMm"), s.joistMm, n => set({ joistMm: n }), 50,
    { title: `${DECK_DEFAULT.joistMm} mm` });
}

/** The size fields alone, so a placed deck's other fields never ride along. */
function pick(s: DeckSize): DeckSize {
  return { width: s.width, depth: s.depth, joistAxis: s.joistAxis, joistMm: s.joistMm };
}

const DETENT_DEG = 45;
const DETENT_PULL = 7;
function snapAngle(deg: number): number {
  const nearest = Math.round(deg / DETENT_DEG) * DETENT_DEG;
  return Math.abs(deg - nearest) <= DETENT_PULL ? nearest : deg;
}
