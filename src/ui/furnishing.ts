// The Inrichten pane: the named-piece picker with the tool armed, and the
// properties of a placed one.
//
// Same shape as the stair pane, and for the same reason: a furnishing is a
// document object whose size is edited, so it needs a row per parameter in two
// places — once for the piece about to be placed and once for the one selected.
// The panel hands in its row builders, so the pane keeps one appearance.
//
// The picker groups by room rather than by form, because that is how a plan is
// fitted out: a kitchen is drawn in one pass, then the bathroom. Which rows
// appear under it follows the form — a bed has a size and nothing else, a
// cabinet has a front and a hinge side.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { furnishingsOf } from "../model/doc";
import {
  Furnishing, FurnishingSpec, FurnishingGroup, FURNISHING_GROUPS, FURNISHING_PRESETS,
  CabinetKind, CabinetFront, ApplianceMark, ToiletCistern, ShowerTray,
  CABINET_KINDS, CABINET_FRONTS, CABINET_DEPTHS, APPLIANCE_MARKS, TOILET_CISTERNS,
  SHOWER_TRAYS, FORM_WIDTHS,
  cabinetDefaults, furnishingPresetOf, furnishingSpecOf,
  furnishingHeight, furnishingWallMounted, clampFurnishing, writeSpec,
} from "../model/furnishing";
import { furnishingBox } from "../core/furnishing";
import { turnAbout } from "../core/placed";
import { isMixed } from "../core/mixed";
import { furnishingMark } from "../render/furnishing";
import { stairAngle } from "../model/stair";
import { COLORS } from "../render/draw";
import { t } from "../i18n";
import { foldOut } from "./foldout";
import type { PaneRows } from "./stairs";

/** Which group the picker has open. Kept across rebuilds of the pane. */
const openGroups = new Set<FurnishingGroup>(["keuken"]);

/** A preset drawn at the size it places, for the picker tile. */
function sample(spec: FurnishingSpec): Furnishing {
  const f: Furnishing = {
    id: "", form: spec.form, x: 0, y: 0, rotation: 0,
    width: spec.width, depth: spec.depth,
  };
  writeSpec(f, spec);
  return f;
}

function tile(
  id: string, spec: FurnishingSpec, active: boolean, ink: string | null, onPick: () => void,
): HTMLButtonElement {
  const b = el("button", "sym-tile") as HTMLButtonElement;
  b.type = "button";
  const label = t("furnishing." + id);
  b.title = `${label} — ${spec.width} × ${spec.depth} mm`;
  if (active) b.classList.add("is-active");

  const cv = document.createElement("canvas");
  cv.width = 104; cv.height = 104;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.scale(2, 2);   // crisp on hidpi
    const f = sample(spec);
    const box = furnishingBox(f);
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const pad = 6;
    const sc = (52 - 2 * pad) / Math.max(w, h);
    ctx.translate(26, 26);
    ctx.scale(sc, sc);
    ctx.translate(-(box.x0 + box.x1) / 2, -(box.y0 + box.y1) / 2);
    ctx.strokeStyle = ink ?? COLORS.symbol;
    ctx.fillStyle = ctx.strokeStyle;
    furnishingMark(ctx, f);
  }

  b.append(cv, Object.assign(el("span"), { textContent: label }));
  b.onclick = onPick;
  return b;
}

/** The picker plus the dimensions the next piece will be placed with. */
export function renderFurnishingTool(
  host: HTMLElement, store: Store, tools: Tools, rows: PaneRows, onPick: () => void,
): void {
  rows.secHead(t("panel.newFurnishing"));

  for (const g of FURNISHING_GROUPS) {
    const presets = FURNISHING_PRESETS.filter(p => p.group === g);
    const grid = el("div", "pal-grid");
    for (const p of presets) {
      const { id, group: _group, ...spec } = p;
      grid.append(tile(id, spec, tools.furnishingPresetId === id, tools.symbolColor, () => {
        tools.setFurnishingPreset(id);
        onPick();
      }));
    }
    const fold = foldOut({
      id: "fit-" + g,
      label: t("furnishingGroup." + g),
      count: presets.length,
      open: openGroups.has(g),
      content: grid,
      onToggle: open => { if (open) openGroups.add(g); else openGroups.delete(g); },
    });
    host.append(fold.head, fold.body);
  }

  specRows(rows, tools.furnishingSpec, next => tools.setFurnishingSpec(next));
  rows.numRow(t("panel.rotation"), (tools.furnishingRotation * 180) / Math.PI,
    n => tools.setFurnishingRotation((n * Math.PI) / 180), 15, { snap: snapAngle });
  rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
  rows.noteRow(t(furnishingWallMounted(tools.furnishingSpec.form)
    ? "panel.furnishingNote" : "panel.furnishingNoteLoose"));
  void store;
}

/** Properties of the selected furnishing. */
export function renderFurnishingProps(store: Store, tools: Tools, rows: PaneRows, id: string): void {
  const piece = furnishingsOf(store.floor).find(x => x.id === id);
  if (!piece) return;

  const mut = (fn: (f: Furnishing) => void, coalesceKey?: string): void => {
    store.mutate(d => {
      const f2 = furnishingsOf(store.floorOf(d)).find(x => x.id === id);
      if (f2) fn(f2);
    }, coalesceKey);
  };

  // What a shift-click has gathered. The pane states one piece's numbers — the
  // one clicked last — and edits them on that piece; the gestures that mean the
  // same thing for every member are the ones that apply to all of them.
  const group = store.selectedOf("furnishing");
  const mutAll = (fn: (f: Furnishing) => void): void => {
    store.mutate(d => {
      for (const f of furnishingsOf(store.floorOf(d))) if (group.includes(f.id)) fn(f);
    });
  };

  const preset = furnishingPresetOf(piece);
  const groupPieces = furnishingsOf(store.floor).filter(f => group.includes(f.id));
  // "3 × Inrichting" once several are gathered, the same header format every
  // kind's bulk pane uses; the singular named piece otherwise.
  rows.secHead(group.length > 1
    ? t("panel.selectionHeader", { n: group.length, label: t("panel.furnishingPlain") })
    : t("panel.furnishing", {
      kind: preset ? t("furnishing." + preset.id) : t("form." + piece.form),
    }),
    { sel: true, mode: true });
  if (group.length > 1) rows.noteRow(t("panel.furnishingGroup", { n: group.length }));

  // Swapping the named piece rewrites every field it names, the way picking a
  // door kind rewrites the sash list. The hinge side is a tuning and survives.
  rows.selRow(t("panel.furnishingPreset"), preset?.id ?? "",
    [...FURNISHING_PRESETS.map(p => [p.id, t("furnishing." + p.id)] as [string, string]),
      ...(preset ? [] : [["", t("panel.furnishingCustom")] as [string, string]])],
    value => mut(f => {
      const p = FURNISHING_PRESETS.find(x => x.id === value);
      if (!p) return;
      const { id: _id, group: _group, ...spec } = p;
      writeSpec(f, spec);
    }));

  specRows(rows, furnishingSpecOf(piece), next => mut(f => writeSpec(f, next)));

  // About the middle of the piece rather than about the anchor, which for a
  // wall-mounted one sits on the edge that meets the wall; see turnAbout().
  const box = furnishingBox(piece);
  rows.numRow(t("panel.rotation"), (piece.rotation * 180) / Math.PI,
    n => mut(f => {
      const turned = stairAngle((n * Math.PI) / 180);
      Object.assign(f, turnAbout(f, box, turned));
      f.rotation = turned;
    }), 15, { snap: snapAngle });
  rows.textRow(t("panel.furnishingLabel"), piece.label ?? "",
    s => mut(f => { const value = s.trim(); if (value) f.label = value; else delete f.label; }));
  // Colour is the field a bulk edit ("recolour the whole kitchen") is actually
  // reached for; grown onto the existing per-piece pane rather than a separate
  // reduced view, since a furnishing's spec has no single group-wide reading
  // the way a wall's thickness or an opening's width does.
  rows.colorRow(t("panel.color"), piece.color ?? null, hex => {
    tools.symbolColor = hex;
    if (group.length > 1) mutAll(f => { if (hex) f.color = hex; else delete f.color; });
    else mut(f => { if (hex) f.color = hex; else delete f.color; }, "color:" + id);
  }, { mixed: group.length > 1 && isMixed(groupPieces, f => f.color ?? "") });
  rows.btnRow(t("panel.mirror"), () => mutAll(f => { f.mirrored = !f.mirrored; }),
    t("panel.mirrorTitle"), "M");
  rows.infoRow(t("panel.furnishingFootprint"),
    `${piece.width} × ${piece.depth} × ${furnishingHeight(piece)} mm`);
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/**
 * The rows a furnishing has, shared by the tool pane and the property pane:
 * the size every piece is built to, then whatever its form actually reads. A
 * bed has no front and a cabinet no bowl, and offering either would invite a
 * field the drawing then ignores.
 */
function specRows(rows: PaneRows, spec: FurnishingSpec, commit: (next: FurnishingSpec) => void): void {
  const set = (patch: Partial<FurnishingSpec>): void => commit(clampFurnishing({ ...spec, ...patch }));

  if (spec.form === "cabinet") {
    rows.selRow(t("panel.cabinetKind"), spec.kind,
      CABINET_KINDS.map(k => [k, t("cabinetKind." + k)] as [string, string]),
      value => {
        // The height class carries a depth and a height with it: a 600-deep
        // wall unit is not a wall unit, and re-typing both every time the class
        // changed is the work the class exists to save.
        const kind = value as CabinetKind;
        const d = cabinetDefaults(kind);
        set({ kind, depth: d.depth, height: d.height, worktop: d.worktop });
      });
  }

  rows.numRow(t("panel.furnishingWidth"), spec.width, n => set({ width: n }), 50);
  const widths = FORM_WIDTHS[spec.form];
  if (widths) rows.chipRow(t("panel.furnishingWidth"), widths, spec.width, n => set({ width: n }));
  rows.numRow(t("panel.furnishingDepth"), spec.depth, n => set({ depth: n }), 50);
  if (spec.form === "cabinet") {
    rows.chipRow(t("panel.furnishingDepth"), CABINET_DEPTHS[spec.kind], spec.depth,
      n => set({ depth: n }));
  }
  rows.numRow(t("panel.furnishingHeight"), spec.height, n => set({ height: n }), 50);

  if (spec.form === "cabinet") {
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
  }
  if (spec.form === "cabinet" || spec.form === "counter") {
    rows.checkRow(t("panel.cabinetWorktop"), spec.worktop, b => set({ worktop: b }));
  }

  if (spec.form === "appliance") {
    rows.selRow(t("panel.applianceMark"), spec.mark,
      APPLIANCE_MARKS.map(m => [m, t("applianceMark." + m)] as [string, string]),
      value => set({ mark: value as ApplianceMark }));
  }
  if (spec.form === "toilet") {
    rows.selRow(t("panel.toiletCistern"), spec.cistern,
      TOILET_CISTERNS.map(c => [c, t("toiletCistern." + c)] as [string, string]),
      value => set({ cistern: value as ToiletCistern }));
    rows.checkRow(t("panel.toiletRails"), spec.rails, b => set({ rails: b }));
  }
  if (spec.form === "basin" || spec.form === "counter") {
    rows.numRow(t("panel.furnishingBasins"), spec.basins, n => set({ basins: n }), 1);
  }
  if (spec.form === "shower") {
    rows.selRow(t("panel.showerTray"), spec.tray,
      SHOWER_TRAYS.map(x => [x, t("showerTray." + x)] as [string, string]),
      value => set({ tray: value as ShowerTray }));
  }
}

/** The fit-out follows the walls, so the eighth turns are what it wants. */
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
