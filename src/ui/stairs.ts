// The stair pane: the kind picker with the tool armed, and the properties of a
// placed stair.
//
// Both live here rather than in panel.ts because a stair is the one document
// object whose size is edited, so it needs a row per parameter in two places:
// once for the stair about to be placed and once for the one selected. The
// panel hands in its row builders, so the pane keeps one appearance.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { stairsOf, floorHeight } from "../model/doc";
import {
  Stair, ResolvedStair, StairKind, STAIR_KINDS, stairDefaults, stairFields, stairParams,
  clampStair, stairAngle, inheritsRise, type StairParams,
} from "../model/stair";
import {
  stairBox, stairMetrics, gradient, resolveStair, stairIssues, STAIR_LIMITS,
} from "../core/stair";
import { getStair } from "../render/stairs";
import { COLORS } from "../render/draw";
import { t } from "../i18n";

/** The row builders panel.ts already uses for every other kind of selection. */
export interface StairRows {
  secHead(label: string, opts?: { sel?: boolean }): void;
  numRow(label: string, value: number, onCommit: (n: number) => void, step?: number,
         extra?: { title?: string; snap?: (n: number) => number }): void;
  selRow(label: string, value: string, options: Array<[string, string]>, onCommit: (s: string) => void): void;
  textRow(label: string, value: string, onCommit: (s: string) => void): void;
  infoRow(label: string, text: string, title?: string): void;
  noteRow(text: string): void;
  warnRow(text: string): void;
  colorRow(label: string, value: string | null, onCommit: (hex: string | null) => void): void;
  btnRow(label: string, fn: () => void): void;
  dangerRow(label: string, fn: () => void): void;
}

/**
 * Pulls a rotation onto the eighth turns. A stairwell follows the walls, so
 * those are the angles wanted nearly every time; the pull is narrow enough that
 * any other angle is still reachable by typing or by scrubbing past it.
 */
const DETENT_DEG = 45;
const DETENT_PULL = 7;

function snapAngle(deg: number): number {
  const nearest = Math.round(deg / DETENT_DEG) * DETENT_DEG;
  return Math.abs(deg - nearest) <= DETENT_PULL ? nearest : deg;
}

/** The stair the tool would place, at the origin — what a tile draws. */
function sample(kind: StairKind): ResolvedStair {
  return { id: "", kind, x: 0, y: 0, rotation: 0, ...stairDefaults(kind) };
}

function tile(kind: StairKind, active: boolean, ink: string | null, onPick: () => void): HTMLButtonElement {
  const b = el("button", "sym-tile") as HTMLButtonElement;
  b.type = "button";
  const label = t("stair." + kind);
  b.title = label;
  if (active) b.classList.add("is-active");

  const cv = document.createElement("canvas");
  cv.width = 104; cv.height = 104;
  const ctx = cv.getContext("2d");
  const def = getStair(kind);
  if (ctx && def) {
    ctx.scale(2, 2);   // crisp on hidpi
    const s = sample(kind);
    const box = stairBox(s);
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const pad = 6;
    const sc = (52 - 2 * pad) / Math.max(w, h);
    ctx.translate(26, 26);
    ctx.scale(sc, sc);
    ctx.translate(-(box.x0 + box.x1) / 2, -(box.y0 + box.y1) / 2);
    ctx.strokeStyle = ink ?? COLORS.symbol;
    ctx.fillStyle = ctx.strokeStyle;
    def.draw(ctx, s);
  }

  b.append(cv, Object.assign(el("span"), { textContent: label }));
  b.onclick = onPick;
  return b;
}

/** Kind picker plus the dimensions the next stair will be placed with. */
export function renderStairTool(
  host: HTMLElement, store: Store, tools: Tools, rows: StairRows, onPick: () => void,
): void {
  rows.secHead(t("panel.newStair"));

  const grid = el("div", "pal-grid");
  for (const kind of STAIR_KINDS) {
    grid.append(tile(kind, tools.stairKind === kind, tools.symbolColor, () => {
      tools.setStairKind(kind, floorHeight(store.floor));
      onPick();
    }));
  }
  host.append(grid);

  sizeRows(rows, tools.stairKind, tools.stairSize, next => tools.setStairSize(next));
  // The same rotation field a placed stair has. R turns a quarter at a time,
  // which is what a stairwell usually wants; this is how any other angle is set.
  rows.numRow(t("panel.rotation"), (tools.stairRotation * 180) / Math.PI,
    n => tools.setStairRotation((n * Math.PI) / 180), 15, { snap: snapAngle });
  rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
  metricRows(rows, draftOf(tools));
  rows.noteRow(t("panel.stairNote"));
}

/** Properties of the selected stair. */
export function renderStairProps(store: Store, tools: Tools, rows: StairRows, id: string): void {
  const raw = stairsOf(store.floor).find(s => s.id === id);
  if (!raw) return;
  const stair = resolveStair(store.floor, raw);
  const inherited = raw.rise === undefined;

  const mut = (fn: (s: Stair) => void, coalesceKey?: string): void => {
    store.mutate(d => {
      const s2 = stairsOf(store.floorOf(d)).find(x => x.id === id);
      if (s2) fn(s2);
    }, coalesceKey);
  };

  rows.secHead(t("panel.stair", { kind: t("stair." + stair.kind) }), { sel: true });
  rows.selRow(t("panel.stairKind"), stair.kind,
    STAIR_KINDS.map(k => [k, t("stair." + k)] as [string, string]),
    value => mut(s => {
      const kind = value as StairKind;
      s.kind = kind;
      // The well belongs to the kind: a bordestrap's gap between flights means
      // nothing to a steektrap, and a spiltrap without one has no newel.
      if (stairFields(kind).well) s.well = s.well ?? stairDefaults(kind).well;
      else delete s.well;
      // A ramp never inherits a storey height, so it needs one of its own.
      if (!inheritsRise(kind) && s.rise === undefined) s.rise = stairDefaults(kind).rise;
    }));

  sizeRows(rows, stair.kind, stairParams(stair), next => mut(s => {
    s.width = next.width;
    s.going = next.going;
    s.treads = next.treads;
    s.rise = next.rise;
    if (stairFields(s.kind).well) s.well = next.well;
  }), inherited);

  // Only worth offering once the stair has stopped following its storey.
  if (!inherited && inheritsRise(stair.kind)) {
    rows.btnRow(t("panel.stairFollowStorey"), () => mut(s => { delete s.rise; }));
  }

  rows.numRow(t("panel.rotation"), (stair.rotation * 180) / Math.PI,
    n => mut(s => { s.rotation = stairAngle((n * Math.PI) / 180); }), 15, { snap: snapAngle });
  // Arming the pen alongside, as the symbol pane does: recolouring one stair is
  // usually part of marking a whole storey's new work.
  rows.colorRow(t("panel.color"), stair.color ?? null, hex => {
    tools.symbolColor = hex;
    mut(s => { if (hex) s.color = hex; else delete s.color; }, "color:" + id);
  });
  rows.btnRow(t("panel.mirror"), () => mut(s => { s.mirrored = !s.mirrored; }));
  metricRows(rows, stair);
  rows.noteRow(t("panel.stairNote"));
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/**
 * What the numbers add up to, and where they fall outside what a stair is
 * ordinarily built to. Read-only, like a wall's clear span: these follow from
 * the stored parameters, and the way to change one is to change what it follows
 * from. Stated as figures rather than as a verdict — see STAIR_LIMITS.
 */
function metricRows(rows: StairRows, s: ResolvedStair): void {
  const m = stairMetrics(s);
  if (m.risers !== null && m.riser !== null) {
    rows.infoRow(t("panel.stairRiser"), `${m.risers} × ${m.riser.toFixed(1)} mm`);
  }
  if (m.walkRule !== null) {
    rows.infoRow(t("panel.stairWalkRule"), `${Math.round(m.walkRule)} mm`,
      t("panel.stairWalkRuleHelp", { min: STAIR_LIMITS.walkRuleMin, max: STAIR_LIMITS.walkRuleMax }));
  }
  if (m.slope !== null) rows.infoRow(t("panel.stairSlope"), `1:${gradient(m.slope)}`);
  rows.infoRow(t("panel.stairFootprint"), footprint(s));
  for (const issue of stairIssues(s)) {
    rows.warnRow(t("stairIssue." + issue.code, {
      value: issue.code === "slopeSteep" ? `1:${gradient(issue.value)}` : Math.round(issue.value),
      limit: issue.code === "slopeSteep" ? `1:${issue.limit}` : issue.limit,
    }));
  }
}

/** The parameter rows a kind actually reads; see stairFields(). */
function sizeRows(
  rows: StairRows, kind: StairKind, p: StairParams, commit: (next: StairParams) => void,
  riseInherited = false,
): void {
  const fields = stairFields(kind);
  const set = (patch: Partial<StairParams>): void => commit(clampStair({ ...p, ...patch }));
  const L = STAIR_LIMITS;
  rows.numRow(t("panel.stairWidth"), p.width, n => set({ width: n }), 50,
    { title: t("panel.stairWidthHelp", { min: L.widthMin }) });
  if (fields.going) {
    rows.numRow(t("panel.stairGoing"), p.going, n => set({ going: n }), 10,
      { title: t("panel.stairGoingHelp", { min: L.goingMin }) });
  }
  if (fields.treads) {
    rows.numRow(t("panel.stairTreads"), p.treads, n => set({ treads: n }), 1,
      { title: t("panel.stairTreadsHelp", { max: L.riserMax }) });
  }
  rows.numRow(t("panel.stairRise"), p.rise, n => set({ rise: n }), 100,
    { title: riseInherited ? t("panel.stairRiseInherited") : t("panel.stairRiseHelp") });
  if (riseInherited) rows.noteRow(t("panel.stairRiseInherited"));
  if (fields.well) {
    rows.numRow(t("panel.stairWell"), p.well, n => set({ well: n }), 50,
      { title: t("panel.stairWellHelp") });
  }
}

/** How much floor the stair takes, so the fit in a stairwell is visible. */
function footprint(s: ResolvedStair): string {
  const b = stairBox(s);
  return `${Math.round(b.x1 - b.x0)} × ${Math.round(b.y1 - b.y0)} mm`;
}

function draftOf(tools: Tools): ResolvedStair {
  return { id: "", kind: tools.stairKind, x: 0, y: 0, rotation: 0, ...clampStair(tools.stairSize) };
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
