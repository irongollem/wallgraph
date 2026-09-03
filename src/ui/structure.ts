// The structure pane: the kind picker with the tool armed — column, beam,
// railing or vide — the figures the next one is placed with, and the
// properties of a placed element.
//
// One pane for the four because they are placed the same way and edited in
// the same terms: a section, a run, a height, a material and a designation.
// The vide keeps its own rows (ui/vide.ts); this pane only hosts them under
// the shared picker.
import { Store } from "../model/store";
import { Tools, type StructureTarget } from "../input/tools";
import { structureOf, floorHeight, WALL_MATERIALS, type Floor, type WallMaterial } from "../model/doc";
import {
  Structural, Column, Beam, Railing, ColumnShape, ColumnSize, SpanSize, COLUMN_SHAPES,
  STEEL_PROFILES, STRUCTURE_LIMITS, clampColumnSize, clampBeamSize, clampRailWidth,
  clampRailHeight, clampPostMm, clampStructureHeight,
} from "../model/structure";
import { spanLength, beamBottom } from "../core/structure";
import { stairAngle } from "../model/stair";
import { isMixed } from "../core/mixed";
import { columnMark, beamMark, railingMark, BEAM_DASH } from "../render/structure";
import { videMark } from "../render/vide";
import { VIDE_DEFAULT } from "../model/vide";
import { COLORS, wallPen } from "../render/draw";
import { renderVideTool } from "./vide";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

const TARGETS: readonly StructureTarget[] = ["column", "beam", "railing", "vide"];

const kindLabel = (kind: StructureTarget): string =>
  t("panel.structure" + kind[0]!.toUpperCase() + kind.slice(1));

/** Eighth-turn detent, the same pull the stair and vide panes use. */
const DETENT_DEG = 45;
const DETENT_PULL = 7;
function snapAngle(deg: number): number {
  const nearest = Math.round(deg / DETENT_DEG) * DETENT_DEG;
  return Math.abs(deg - nearest) <= DETENT_PULL ? nearest : deg;
}

/** A tile's sample run, mm: long enough for the railing to show its posts. */
const SAMPLE_RUN = 1200;

/**
 * The mark a tile shows, centred on the origin at 1 unit = 1 mm: the column
 * as armed, so the picker reflects the section about to be placed; the others
 * at one sample size.
 */
function drawSample(ctx: CanvasRenderingContext2D, kind: StructureTarget, tools: Tools): void {
  const ink = tools.symbolColor;
  if (kind === "column") {
    const s = clampColumnSize(tools.columnSize);
    const material = tools.structureMaterial.column;
    const pen = wallPen({ ...(ink ? { color: ink } : {}), ...(material ? { material } : {}) });
    ctx.strokeStyle = pen.stroke;
    ctx.fillStyle = pen.fill;
    columnMark(ctx, { kind, id: "", x: 0, y: 0, rotation: 0, ...s });
    return;
  }
  ctx.strokeStyle = ink ?? COLORS.symbol;
  ctx.fillStyle = ctx.strokeStyle;
  const a = { x: -SAMPLE_RUN / 2, y: 0 }, b = { x: SAMPLE_RUN / 2, y: 0 };
  if (kind === "beam") {
    ctx.setLineDash([...BEAM_DASH]);
    beamMark(ctx, { kind, id: "", a, b, width: 200, depth: 190 });
  } else if (kind === "railing") {
    railingMark(ctx, { kind, id: "", a, b, width: 50, height: 1000, postMm: 400 });
  } else {
    videMark(ctx, { id: "", x: 0, y: 0, rotation: 0, ...VIDE_DEFAULT });
  }
}

/** The sample's largest extent, mm, for the tile to scale by. */
function sampleReach(kind: StructureTarget, tools: Tools): number {
  if (kind === "column") {
    const s = clampColumnSize(tools.columnSize);
    return Math.max(s.width, s.depth);
  }
  if (kind === "vide") return Math.max(VIDE_DEFAULT.width, VIDE_DEFAULT.depth);
  return SAMPLE_RUN;
}

function tile(kind: StructureTarget, tools: Tools, onPick: () => void): HTMLButtonElement {
  const b = el("button", "sym-tile") as HTMLButtonElement;
  b.type = "button";
  const label = kindLabel(kind);
  b.title = label;
  if (tools.structureKind === kind) b.classList.add("is-active");

  const cv = document.createElement("canvas");
  cv.width = 104; cv.height = 104;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.scale(2, 2);   // crisp on hidpi
    const pad = 6;
    const sc = (52 - 2 * pad) / sampleReach(kind, tools);
    ctx.translate(26, 26);
    ctx.scale(sc, sc);
    drawSample(ctx, kind, tools);
  }

  b.append(cv, Object.assign(el("span"), { textContent: label }));
  b.onclick = onPick;
  return b;
}

/** Kind picker plus the figures the next element is placed with. */
export function renderStructureTool(
  host: HTMLElement, store: Store, tools: Tools, rows: PaneRows, onPick: () => void,
): void {
  rows.secHead(t("panel.newStructure"));

  const grid = el("div", "pal-grid");
  for (const kind of TARGETS) {
    grid.append(tile(kind, tools, () => { tools.setStructureKind(kind); onPick(); }));
  }
  host.append(grid);

  switch (tools.structureKind) {
    case "column": {
      const size = clampColumnSize(tools.columnSize);
      shapeRow(rows, size.shape, shape => tools.setColumnSize({ ...size, shape }));
      columnSizeRows(rows, size, next => tools.setColumnSize(next));
      rows.numRow(t("panel.rotation"), (tools.columnRotation * 180) / Math.PI,
        n => tools.setColumnRotation((n * Math.PI) / 180), 15, { snap: snapAngle });
      materialRow(rows, tools.structureMaterial.column, m => tools.setStructureMaterial("column", m));
      rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
      rows.noteRow(t("panel.columnNote"));
      return;
    }
    case "beam": {
      const size = clampBeamSize(tools.beamSize);
      profileRow(rows, size, tools.beamLabel, (next, label) => tools.setBeamSize(next, label));
      beamSizeRows(rows, size, next => tools.setBeamSize(next));
      rows.textRow(t("panel.structureLabel"), tools.beamLabel, s => tools.setBeamLabel(s), { allowEmpty: true });
      materialRow(rows, tools.structureMaterial.beam, m => tools.setStructureMaterial("beam", m));
      rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
      rows.noteRow(t("panel.beamNote"));
      return;
    }
    case "railing": {
      railingRows(rows, { width: tools.railingWidth, height: tools.railingHeight, postMm: tools.railingPost },
        next => tools.setRailing(next.width, next.height, next.postMm));
      materialRow(rows, tools.structureMaterial.railing, m => tools.setStructureMaterial("railing", m));
      rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
      rows.noteRow(t("panel.railingNote"));
      return;
    }
    case "vide":
      renderVideTool(tools, rows);
      return;
  }
  void store;
}

/** Properties of the selected element. */
export function renderStructureProps(store: Store, tools: Tools, rows: PaneRows, id: string): void {
  const f = store.floor;
  const elm = structureOf(f).find(x => x.id === id);
  if (!elm) return;

  const mut = <K extends Structural["kind"]>(
    kind: K, fn: (e: Extract<Structural, { kind: K }>) => void, coalesceKey?: string,
  ): void => {
    store.mutate(d => {
      const e2 = structureOf(store.floorOf(d)).find(x => x.id === id);
      if (e2 && e2.kind === kind) fn(e2 as Extract<Structural, { kind: K }>);
    }, coalesceKey);
  };

  rows.secHead(kindLabel(elm.kind), { sel: true });

  if (elm.kind === "column") columnProps(rows, f, elm, fn => mut("column", fn));
  else if (elm.kind === "beam") beamProps(rows, f, elm, fn => mut("beam", fn));
  else railingProps(rows, elm, fn => mut("railing", fn));

  rows.textRow(t("panel.structureLabel"), elm.label ?? "",
    s => mut(elm.kind, e => { if (s) e.label = s; else delete e.label; }), { allowEmpty: true });
  materialRow(rows, elm.material ?? null, m => mut(elm.kind, e => { if (m) e.material = m; else delete e.material; }));
  // Arming the pen alongside, as the stair pane does: recolouring one element
  // is usually part of marking a storey's new work.
  rows.colorRow(t("panel.color"), elm.color ?? null, hex => {
    tools.symbolColor = hex;
    mut(elm.kind, e => { if (hex) e.color = hex; else delete e.color; }, "color:" + id);
  });
  rows.noteRow(t(elm.kind === "column" ? "panel.columnNote" : elm.kind === "beam" ? "panel.beamNote" : "panel.railingNote"));
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/**
 * Properties of every selected element at once: colour, for the reason the
 * stair and vide bulk panes offer only colour -- a section, a run and a height
 * have no single reading across a mixed group.
 */
export function renderStructureBulk(store: Store, tools: Tools, rows: PaneRows, ids: readonly string[]): void {
  const els = structureOf(store.floor).filter(x => ids.includes(x.id));
  const first = els[0];
  if (!first) return;
  rows.secHead(t("panel.selectionHeader", { n: els.length, label: t("panel.structurePlain") }), { sel: true, mode: true });
  const mixed = isMixed(els, x => x.color ?? "");
  rows.colorRow(t("panel.color"), first.color ?? null, hex => {
    tools.symbolColor = hex;
    store.mutate(d => {
      for (const x of structureOf(store.floorOf(d))) if (ids.includes(x.id)) { if (hex) x.color = hex; else delete x.color; }
    }, "color:" + ids.join(","));
  }, { mixed });
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

type Mut<T> = (fn: (e: T) => void) => void;

function columnProps(rows: PaneRows, f: Floor, c: Column, mut: Mut<Column>): void {
  const size: ColumnSize = { shape: c.shape, width: c.width, depth: c.depth };
  const setSize = (next: ColumnSize): void => mut(e => { e.shape = next.shape; e.width = next.width; e.depth = next.depth; });
  shapeRow(rows, c.shape, shape => setSize(clampColumnSize({ ...size, shape })));
  columnSizeRows(rows, size, setSize);
  rows.numRow(t("panel.rotation"), (c.rotation * 180) / Math.PI,
    n => mut(e => { e.rotation = stairAngle((n * Math.PI) / 180); }), 15, { snap: snapAngle });
  // Set/unset rather than a bare number, as a wall's height is: absent means
  // the column carries the floor above, not a stated height that matches it.
  rows.checkRow(t("panel.columnOwnHeight"), c.height !== undefined, on => mut(e => {
    if (on) e.height = floorHeight(f); else delete e.height;
  }));
  if (c.height !== undefined) {
    rows.numRow(t("panel.columnHeight"), c.height,
      n => mut(e => { e.height = clampStructureHeight(n); }), 50,
      { title: t("panel.columnHeightHelp") });
  }
  rows.noteRow(t("panel.columnHeightHelp"));
}

function beamProps(rows: PaneRows, f: Floor, b: Beam, mut: Mut<Beam>): void {
  const size: SpanSize = { width: b.width, depth: b.depth };
  profileRow(rows, size, b.label ?? "", (next, label) => mut(e => {
    e.width = next.width; e.depth = next.depth; e.label = label;
  }));
  beamSizeRows(rows, size, next => mut(e => { e.width = next.width; e.depth = next.depth; }));
  rows.infoRow(t("panel.spanLength"), `${Math.round(spanLength(b))} mm`);
  // Absent means the top sits at the storey height; setting it starts from
  // that same underside so the beam does not jump.
  rows.checkRow(t("panel.beamOwnBottom"), b.bottomMm !== undefined, on => mut(e => {
    if (on) e.bottomMm = Math.max(0, beamBottom(f, e)); else delete e.bottomMm;
  }));
  if (b.bottomMm !== undefined) {
    rows.numRow(t("panel.beamBottom"), b.bottomMm,
      n => mut(e => { e.bottomMm = Math.max(0, Math.min(STRUCTURE_LIMITS.height.max, Math.round(n))); }), 50,
      { title: t("panel.beamBottomHelp") });
  }
  rows.noteRow(t("panel.beamBottomHelp"));
}

function railingProps(rows: PaneRows, r: Railing, mut: Mut<Railing>): void {
  railingRows(rows, r, next => mut(e => { e.width = next.width; e.height = next.height; e.postMm = next.postMm; }));
  rows.infoRow(t("panel.spanLength"), `${Math.round(spanLength(r))} mm`);
}

function shapeRow(rows: PaneRows, shape: ColumnShape, commit: (shape: ColumnShape) => void): void {
  rows.selRow(t("panel.columnShape"), shape,
    COLUMN_SHAPES.map(s => [s, t("panel.columnShape_" + s)] as [string, string]),
    value => commit(value as ColumnShape));
}

/** Width and depth, or one diameter for a round section. */
function columnSizeRows(rows: PaneRows, s: ColumnSize, commit: (next: ColumnSize) => void): void {
  const set = (patch: Partial<ColumnSize>): void => commit(clampColumnSize({ ...s, ...patch }));
  const L = STRUCTURE_LIMITS.section;
  if (s.shape === "round") {
    rows.numRow(t("panel.columnDiameter"), s.width, n => set({ width: n }), 10,
      { title: `${L.min}–${L.max} mm` });
    return;
  }
  rows.numRow(t("panel.columnWidth"), s.width, n => set({ width: n }), 10, { title: `${L.min}–${L.max} mm` });
  rows.numRow(t("panel.columnDepth"), s.depth, n => set({ depth: n }), 10, { title: `${L.min}–${L.max} mm` });
}

/**
 * The catalogue sections. Picking one sets both figures and the designation;
 * the figures stay editable underneath, and once they no longer match a row
 * the select reads "custom" rather than claiming a section the beam is not.
 */
function profileRow(
  rows: PaneRows, size: SpanSize, label: string, commit: (next: SpanSize, label: string) => void,
): void {
  const current = STEEL_PROFILES.find(p => p.label === label && p.width === size.width && p.depth === size.depth);
  rows.selRow(t("panel.beamProfile"), current?.label ?? "",
    [["", t("panel.beamProfileCustom")], ...STEEL_PROFILES.map(p => [p.label, p.label] as [string, string])],
    value => {
      const p = STEEL_PROFILES.find(x => x.label === value);
      if (p) commit({ width: p.width, depth: p.depth }, p.label);
    });
}

function beamSizeRows(rows: PaneRows, s: SpanSize, commit: (next: SpanSize) => void): void {
  const set = (patch: Partial<SpanSize>): void => commit(clampBeamSize({ ...s, ...patch }));
  rows.numRow(t("panel.beamWidth"), s.width, n => set({ width: n }), 10,
    { title: `${STRUCTURE_LIMITS.section.min}–${STRUCTURE_LIMITS.section.max} mm` });
  rows.numRow(t("panel.beamDepth"), s.depth, n => set({ depth: n }), 10,
    { title: `${STRUCTURE_LIMITS.beamDepth.min}–${STRUCTURE_LIMITS.beamDepth.max} mm` });
}

interface RailingSize { width: number; height: number; postMm: number }

function railingRows(rows: PaneRows, s: RailingSize, commit: (next: RailingSize) => void): void {
  const set = (patch: Partial<RailingSize>): void => {
    const n = { ...s, ...patch };
    commit({ width: clampRailWidth(n.width), height: clampRailHeight(n.height), postMm: clampPostMm(n.postMm) });
  };
  rows.numRow(t("panel.railingWidth"), s.width, n => set({ width: n }), 10);
  rows.numRow(t("panel.railingHeight"), s.height, n => set({ height: n }), 50);
  rows.numRow(t("panel.railingPost"), s.postMm, n => set({ postMm: n }), 100);
}

/** Tri-state like a wall's: "" is not stated, which is not the same fact as any material. */
function materialRow(rows: PaneRows, value: WallMaterial | null, commit: (m: WallMaterial | null) => void): void {
  rows.selRow(t("panel.material"), value ?? "",
    [["", t("panel.materialUnknown")],
      ...WALL_MATERIALS.map(m => [m, t("panel.material_" + m)] as [string, string])],
    v => commit(v ? v as WallMaterial : null));
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
