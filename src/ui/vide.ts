// The vide pane: the size the next opening is placed at, and the properties of
// a placed one. Same shape as the stair pane, and it borrows the panel's row
// builders for the same reason.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { videsOf } from "../model/doc";
import { Vide, clampVide, VIDE_DEFAULT } from "../model/vide";
import { stairAngle } from "../model/stair";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** The vide pane uses the same row builders the stair pane does. */
export type VideRows = PaneRows;

/** Size and angle the next vide will be placed at. */
export function renderVideTool(store: Store, tools: Tools, rows: VideRows): void {
  rows.secHead(t("panel.newVide"));
  sizeRows(rows, tools.videSize, next => tools.setVideSize(next));
  rows.numRow(t("panel.rotation"), (tools.videRotation * 180) / Math.PI,
    n => tools.setVideRotation((n * Math.PI) / 180), 15, { snap: snapAngle });
  rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
  rows.noteRow(t("panel.videNote"));
  void store;
}

/** Properties of the selected vide. */
export function renderVideProps(store: Store, tools: Tools, rows: VideRows, id: string): void {
  const vide = videsOf(store.floor).find(x => x.id === id);
  if (!vide) return;

  const mut = (fn: (v: Vide) => void, coalesceKey?: string): void => {
    store.mutate(d => {
      const v2 = videsOf(store.floorOf(d)).find(x => x.id === id);
      if (v2) fn(v2);
    }, coalesceKey);
  };

  rows.secHead(t("panel.vide"), { sel: true });
  sizeRows(rows, vide, next => mut(v => { v.width = next.width; v.depth = next.depth; }));
  rows.numRow(t("panel.rotation"), (vide.rotation * 180) / Math.PI,
    n => mut(v => { v.rotation = stairAngle((n * Math.PI) / 180); }), 15, { snap: snapAngle });
  rows.textRow(t("panel.videLabel"), vide.label ?? t("vide.label"),
    s => mut(v => { v.label = s === t("vide.label") ? undefined : s; }));
  rows.colorRow(t("panel.color"), vide.color ?? null, hex => {
    tools.symbolColor = hex;
    mut(v => { if (hex) v.color = hex; else delete v.color; }, "color:" + id);
  });
  rows.infoRow(t("panel.videArea"), `${((vide.width * vide.depth) / 1e6).toFixed(2)} m²`);
  rows.noteRow(t("panel.videNote"));
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

function sizeRows(
  rows: VideRows, s: { width: number; depth: number },
  commit: (next: { width: number; depth: number }) => void,
): void {
  const set = (patch: Partial<typeof s>): void => commit(clampVide({ ...s, ...patch }));
  rows.numRow(t("panel.videWidth"), s.width, n => set({ width: n }), 100,
    { title: t("panel.videWidthHelp", { w: VIDE_DEFAULT.width, d: VIDE_DEFAULT.depth }) });
  rows.numRow(t("panel.videDepth"), s.depth, n => set({ depth: n }), 100,
    { title: t("panel.videWidthHelp", { w: VIDE_DEFAULT.width, d: VIDE_DEFAULT.depth }) });
}

const DETENT_DEG = 45;
const DETENT_PULL = 7;
function snapAngle(deg: number): number {
  const nearest = Math.round(deg / DETENT_DEG) * DETENT_DEG;
  return Math.abs(deg - nearest) <= DETENT_PULL ? nearest : deg;
}
