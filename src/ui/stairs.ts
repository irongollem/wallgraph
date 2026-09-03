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
  clampStair, stairAngle, inheritsRise, stairTurns, setStairTurn, turnCount,
  type StairParams, type Turn,
} from "../model/stair";
import {
  stairBox, stairMetrics, gradient, resolveStair, stairIssues, STAIR_LIMITS,
} from "../core/stair";
import { turnAbout } from "../core/placed";
import { isMixed } from "../core/mixed";
import { getStair } from "../render/stairs";
import { COLORS } from "../render/draw";
import { t } from "../i18n";

/**
 * The row builders panel.ts already uses for every other kind of selection.
 *
 * Named for the panes rather than for stairs because every parametric object
 * borrows it — a stair, a vide, a cabinet, a room name and the zoom pane all
 * render through these, so all of them keep one appearance.
 */
export interface PaneRows {
  /**
   * `mode: true` (on a `sel` header) adds the "Done" affordance beside the
   * close button while the select tool's long-press mode is live and several
   * objects are gathered -- see Tools.selectMode. Every kind's pane gets it
   * for free by passing `mode: true` on its own group header; nothing else
   * about secHead changes.
   */
  secHead(label: string, opts?: { sel?: boolean; later?: boolean; mode?: boolean }): void;
  /**
   * `mixed: true` on any of these five renders the field as indeterminate --
   * an em-dash placeholder, an unchecked-but-indeterminate box, a leading "—"
   * option that commits nothing, or no ink swatch marked active -- until the
   * visitor actually types or picks a value. Used only by a bulk pane (see
   * panel.ts's per-kind Bulk renderers): a single selection never passes it,
   * so a lone object's pane is unaffected.
   */
  numRow(label: string, value: number, onCommit: (n: number) => void, step?: number,
         extra?: { title?: string; snap?: (n: number) => number; mixed?: boolean }): void;
  selRow(label: string, value: string, options: Array<[string, string]>, onCommit: (s: string) => void,
         opts?: { mixed?: boolean }): void;
  /** `allowEmpty` commits a cleared field, for a caption whose absence is a value. */
  textRow(label: string, value: string, onCommit: (s: string) => void,
          opts?: { mixed?: boolean; allowEmpty?: boolean }): void;
  infoRow(label: string, text: string, title?: string): void;
  noteRow(text: string): void;
  warnRow(text: string): void;
  colorRow(label: string, value: string | null, onCommit: (hex: string | null) => void,
            opts?: { mixed?: boolean }): void;
  /** `key` is drawn beside the label where there is a keyboard, `title`
   *  explains the button; the label reads the same without either. */
  btnRow(label: string, fn: () => void, title?: string, key?: string): void;
  dangerRow(label: string, fn: () => void): void;
  checkRow(label: string, value: boolean, onCommit: (b: boolean) => void, opts?: { mixed?: boolean }): void;
  /**
   * A row of standard values beside a typed field -- number chips beside a
   * numRow (cabinetry and doors are ordered in steps rather than measured, so
   * the steps have to be one click away), or string chips beside a textRow
   * (recently used groep labels, offered so wiring one circuit is repeated
   * clicks rather than repeated typing). Either way the typed field beside
   * them keeps anything else reachable.
   */
  chipRow<T extends string | number>(
    label: string, values: readonly T[], value: T, onCommit: (v: T) => void,
  ): void;
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
  host: HTMLElement, store: Store, tools: Tools, rows: PaneRows, onPick: () => void,
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
export function renderStairProps(store: Store, tools: Tools, rows: PaneRows, id: string): void {
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
      // Likewise the second turn: only a quarter at each end has one.
      if (turnCount(kind) < 2) delete s.counterTurn;
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

  // Turning about the middle of the footprint rather than about the anchor,
  // which sits on the edge that meets the wall; see turnAbout().
  const box = stairBox(stair);
  rows.numRow(t("panel.rotation"), (stair.rotation * 180) / Math.PI,
    n => mut(s => {
      const turned = stairAngle((n * Math.PI) / 180);
      Object.assign(s, turnAbout(s, box, turned));
      s.rotation = turned;
    }), 15, { snap: snapAngle });
  // Arming the pen alongside, as the symbol pane does: recolouring one stair is
  // usually part of marking a whole storey's new work.
  rows.colorRow(t("panel.color"), stair.color ?? null, hex => {
    tools.symbolColor = hex;
    mut(s => { if (hex) s.color = hex; else delete s.color; }, "color:" + id);
  });
  turnRows(rows, stair, mut);
  metricRows(rows, stair);
  rows.noteRow(t("panel.stairNote"));
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/**
 * Properties of every selected stair at once: colour is the one field a
 * bulk edit is reached for -- turning, mirroring and deleting a group already
 * apply to every member through the ordinary R/M/Del paths (see Tools), and
 * a stair's other parameters (kind, going, treads, rise) have no shared
 * reading across a mixed group the way a wall's thickness does.
 */
export function renderStairBulk(store: Store, tools: Tools, rows: PaneRows, ids: readonly string[]): void {
  const stairs = stairsOf(store.floor).filter(s => ids.includes(s.id));
  const first = stairs[0];
  if (!first) return;
  rows.secHead(t("panel.selectionHeader", { n: stairs.length, label: t("panel.stairPlain") }), { sel: true, mode: true });
  const mixed = isMixed(stairs, s => s.color ?? "");
  rows.colorRow(t("panel.color"), first.color ?? null, hex => {
    tools.symbolColor = hex;
    store.mutate(d => {
      for (const s of stairsOf(store.floorOf(d))) if (ids.includes(s.id)) { if (hex) s.color = hex; else delete s.color; }
    }, "color:" + ids.join(","));
  }, { mixed });
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}

/**
 * Which way the stair turns.
 *
 * A stair that turns is specified as turning linksom or rechtsom, so the
 * handedness is offered in those words rather than as a mirror — and a stair
 * with a quarter at each end sets each quarter on its own, which is the
 * difference between a flight that comes back beside itself and one that
 * doglegs. M still flips the stair as a whole, reversing both at once. A kind
 * that does not turn keeps the plain mirror, which is all its handedness means.
 */
function turnRows(rows: PaneRows, s: ResolvedStair, mut: (fn: (s: Stair) => void) => void): void {
  const turns = stairTurns(s);
  if (turns.length === 0) {
    rows.btnRow(t("panel.mirror"), () => mut(x => { x.mirrored = !x.mirrored; }),
      t("panel.mirrorTitle"), "M");
    return;
  }
  const options: Array<[string, string]> = [["ccw", t("panel.turnCcw")], ["cw", t("panel.turnCw")]];
  const label = (i: number): string => turns.length === 1
    ? t("panel.stairTurn")
    : t(i === 0 ? "panel.stairTurnBottom" : "panel.stairTurnTop");
  turns.forEach((turn, i) => {
    rows.selRow(label(i), turn, options, value => mut(x => setStairTurn(x, i, value as Turn)));
  });
}

/**
 * What the numbers add up to, and where they fall outside what a stair is
 * ordinarily built to. Read-only, like a wall's clear span: these follow from
 * the stored parameters, and the way to change one is to change what it follows
 * from. Stated as figures rather than as a verdict — see STAIR_LIMITS.
 */
function metricRows(rows: PaneRows, s: ResolvedStair): void {
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
  rows: PaneRows, kind: StairKind, p: StairParams, commit: (next: StairParams) => void,
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
