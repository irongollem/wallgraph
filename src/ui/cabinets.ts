// The cabinet pane: the named unit picker with the tool armed, and the
// properties of a placed one.
//
// Same shape as the stair pane, and for the same reason: a cabinet is a
// document object whose size is edited, so it needs a row per parameter in two
// places — once for the unit about to be placed and once for the one selected.
// The panel hands in its row builders, so the pane keeps one appearance.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { cabinetsOf } from "../model/doc";
import {
  Cabinet, CabinetSpec, CabinetKind, CabinetFront, CABINET_KINDS, CABINET_FRONTS,
  CABINET_PRESETS, CABINET_WIDTHS, CABINET_DEPTHS, cabinetDefaults, cabinetPresetOf,
  cabinetHinge, cabinetHeight, cabinetDrawers, clampCabinet,
} from "../model/cabinet";
import { cabinetBox } from "../core/cabinet";
import { cabinetMark } from "../render/cabinet";
import { stairAngle } from "../model/stair";
import { COLORS } from "../render/draw";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** A preset drawn at the size it places, for the picker tile. */
function sample(spec: CabinetSpec): Cabinet {
  return {
    id: "", kind: spec.kind, x: 0, y: 0, rotation: 0,
    width: spec.width, depth: spec.depth, height: spec.height,
    front: spec.front, hinge: spec.hinge,
    ...(spec.front === "drawers" ? { drawers: spec.drawers } : {}),
    ...(spec.corner ? { corner: true } : {}),
    ...(spec.worktop ? { worktop: true } : {}),
  };
}

function tile(id: string, spec: CabinetSpec, active: boolean, ink: string | null, onPick: () => void): HTMLButtonElement {
  const b = el("button", "sym-tile") as HTMLButtonElement;
  b.type = "button";
  const label = t("cabinet." + id);
  b.title = `${label} — ${spec.width} × ${spec.depth} mm`;
  if (active) b.classList.add("is-active");

  const cv = document.createElement("canvas");
  cv.width = 104; cv.height = 104;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.scale(2, 2);   // crisp on hidpi
    const c = sample(spec);
    const box = cabinetBox(c);
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const pad = 6;
    const sc = (52 - 2 * pad) / Math.max(w, h);
    ctx.translate(26, 26);
    ctx.scale(sc, sc);
    ctx.translate(-(box.x0 + box.x1) / 2, -(box.y0 + box.y1) / 2);
    ctx.strokeStyle = ink ?? COLORS.symbol;
    ctx.fillStyle = ctx.strokeStyle;
    cabinetMark(ctx, c);
  }

  b.append(cv, Object.assign(el("span"), { textContent: label }));
  b.onclick = onPick;
  return b;
}

/** Unit picker plus the dimensions the next cabinet will be placed with. */
export function renderCabinetTool(
  host: HTMLElement, store: Store, tools: Tools, rows: PaneRows, onPick: () => void,
): void {
  rows.secHead(t("panel.newCabinet"));

  const grid = el("div", "pal-grid");
  for (const p of CABINET_PRESETS) {
    const { id, ...spec } = p;
    grid.append(tile(id, spec, tools.cabinetPresetId === id, tools.symbolColor, () => {
      tools.setCabinetPreset(id);
      onPick();
    }));
  }
  host.append(grid);

  specRows(rows, tools.cabinetSpec, next => tools.setCabinetSpec(next));
  rows.numRow(t("panel.rotation"), (tools.cabinetRotation * 180) / Math.PI,
    n => tools.setCabinetRotation((n * Math.PI) / 180), 15, { snap: snapAngle });
  rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
  rows.noteRow(t("panel.cabinetNote"));
  void store;
}

/** Properties of the selected cabinet. */
export function renderCabinetProps(store: Store, tools: Tools, rows: PaneRows, id: string): void {
  const cab = cabinetsOf(store.floor).find(x => x.id === id);
  if (!cab) return;

  const mut = (fn: (c: Cabinet) => void, coalesceKey?: string): void => {
    store.mutate(d => {
      const c2 = cabinetsOf(store.floorOf(d)).find(x => x.id === id);
      if (c2) fn(c2);
    }, coalesceKey);
  };

  const preset = cabinetPresetOf(cab);
  rows.secHead(t("panel.cabinet", {
    kind: preset ? t("cabinet." + preset.id) : t("panel.cabinetCustom"),
  }), { sel: true });

  // Swapping the named unit rewrites every field it names, the way picking a
  // door kind rewrites the sash list. The hinge side is a tuning and survives.
  rows.selRow(t("panel.cabinetPreset"), preset?.id ?? "",
    [...CABINET_PRESETS.map(p => [p.id, t("cabinet." + p.id)] as [string, string]),
      ...(preset ? [] : [["", t("panel.cabinetCustom")] as [string, string]])],
    value => mut(c => {
      const p = CABINET_PRESETS.find(x => x.id === value);
      if (!p) return;
      c.kind = p.kind; c.width = p.width; c.depth = p.depth; c.height = p.height;
      c.front = p.front;
      if (p.front === "drawers") c.drawers = p.drawers; else delete c.drawers;
      if (p.corner) c.corner = true; else delete c.corner;
      if (p.worktop) c.worktop = true; else delete c.worktop;
    }));

  specRows(rows, specOf(cab), next => mut(c => {
    c.kind = next.kind; c.width = next.width; c.depth = next.depth; c.height = next.height;
    c.front = next.front; c.hinge = next.hinge;
    if (next.front === "drawers") c.drawers = next.drawers; else delete c.drawers;
    if (next.corner) c.corner = true; else delete c.corner;
    if (next.worktop) c.worktop = true; else delete c.worktop;
  }));

  rows.numRow(t("panel.rotation"), (cab.rotation * 180) / Math.PI,
    n => mut(c => { c.rotation = stairAngle((n * Math.PI) / 180); }), 15, { snap: snapAngle });
  rows.textRow(t("panel.cabinetLabel"), cab.label ?? "",
    s => mut(c => { const v = s.trim(); if (v) c.label = v; else delete c.label; }));
  rows.colorRow(t("panel.color"), cab.color ?? null, hex => {
    tools.symbolColor = hex;
    mut(c => { if (hex) c.color = hex; else delete c.color; }, "color:" + id);
  });
  rows.btnRow(t("panel.mirror"), () => mut(c => { c.mirrored = !c.mirrored; }), t("panel.mirrorTitle"), "M");
  rows.infoRow(t("panel.cabinetFootprint"),
    `${cab.width} × ${cab.depth} × ${cabinetHeight(cab)} mm`);
  rows.noteRow(t("panel.cabinetNote"));
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/** A placed cabinet's fields as the editable specification. */
function specOf(c: Cabinet): CabinetSpec {
  return {
    kind: c.kind, width: c.width, depth: c.depth, height: cabinetHeight(c),
    front: c.front, hinge: cabinetHinge(c), drawers: cabinetDrawers(c),
    corner: !!c.corner, worktop: !!c.worktop,
  };
}

/** The rows every cabinet has, shared by the tool pane and the property pane. */
function specRows(rows: PaneRows, spec: CabinetSpec, commit: (next: CabinetSpec) => void): void {
  const set = (patch: Partial<CabinetSpec>): void => commit(clampCabinet({ ...spec, ...patch }));

  rows.selRow(t("panel.cabinetKind"), spec.kind,
    CABINET_KINDS.map(k => [k, t("cabinetKind." + k)] as [string, string]),
    value => {
      // The height class carries a depth and a height with it: a 600-deep wall
      // unit is not a wall unit, and re-typing both every time the class changed
      // is the work the class exists to save.
      const kind = value as CabinetKind;
      const d = cabinetDefaults(kind);
      set({ kind, depth: d.depth, height: d.height, worktop: d.worktop });
    });

  rows.numRow(t("panel.cabinetWidth"), spec.width, n => set({ width: n }), 50);
  rows.chipRow(t("panel.cabinetWidth"), CABINET_WIDTHS, spec.width, n => set({ width: n }));
  rows.numRow(t("panel.cabinetDepth"), spec.depth, n => set({ depth: n }), 50);
  rows.chipRow(t("panel.cabinetDepth"), CABINET_DEPTHS[spec.kind], spec.depth, n => set({ depth: n }));
  rows.numRow(t("panel.cabinetHeight"), spec.height, n => set({ height: n }), 50);

  rows.selRow(t("panel.cabinetFront"), spec.front,
    CABINET_FRONTS.map(f => [f, t("cabinetFront." + f)] as [string, string]),
    value => set({ front: value as CabinetFront }));

  // Which way a single door swings is the one thing a fitter reads off a unit
  // in plan; a pair hangs at both ends and an open unit has nothing to hang.
  if (spec.front === "door") {
    rows.selRow(t("panel.cabinetHinge"), spec.hinge,
      [["left", t("panel.cabinetHingeLeft")], ["right", t("panel.cabinetHingeRight")]],
      value => set({ hinge: value === "right" ? "right" : "left" }));
  }
  if (spec.front === "drawers") {
    rows.numRow(t("panel.cabinetDrawers"), spec.drawers, n => set({ drawers: n }), 1);
  }
  rows.checkRow(t("panel.cabinetCorner"), spec.corner, b => set({ corner: b }));
  rows.checkRow(t("panel.cabinetWorktop"), spec.worktop, b => set({ worktop: b }));
}

/** Cabinetry follows the walls, so the quarter turns are what it wants. */
const DETENT_DEG = 45;
const DETENT_PULL = 7;
function snapAngle(deg: number): number {
  const nearest = Math.round(deg / DETENT_DEG) * DETENT_DEG;
  return Math.abs(deg - nearest) <= DETENT_PULL ? nearest : deg;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
