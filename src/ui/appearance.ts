// The 3D look of one element: a colour, a pattern and a way back to the
// built-in default. The default comes from model/appearance.ts; what is stored
// is only the difference from it.
import { t } from "../i18n";
import { PATTERN_IDS, defaultAppearance, patchAppearance, resolveAppearance } from "../model/appearance";
import type { AppearanceKey, AppearanceOverride, AppearancePatch, PatternId, Rgb } from "../model/appearance";
import type { PaneRows } from "./stairs";

export function patternName(id: PatternId): string {
  return t("appearance.pattern." + id);
}

export function rgbToHex(c: Rgb): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return "#" + h(c[0]) + h(c[1]) + h(c[2]);
}

/** Applies `patch` to `holder[field]`'s own override, deleting the field when it ends up empty. */
export function patchOverride<K extends string>(
  holder: { [P in K]?: AppearanceOverride }, field: K, patch: AppearancePatch | null,
): void {
  const next = patchAppearance(holder[field], patch);
  if (next) holder[field] = next; else delete holder[field];
}

export interface AppearanceOpts {
  /** Bulk pane: the members differ, so the first member's look is only shown. */
  mixed?: boolean;
}

/** Applies one edit to the element(s) behind a row. `coalesceKey` is the undo key for the edit. */
export type AppearanceCommit = (patch: AppearancePatch | null, coalesceKey: string) => void;

/**
 * One row group: colour (showing the resolved colour), a Default chip that
 * clears the override, a pattern select and the texture rows. `target` names
 * the thing the row edits, stable across rebuilds and unique on the pane (see
 * `appearanceTarget`). `onCommit` receives only the edited field, so a bulk
 * edit leaves each member's other fields alone; a null patch clears everything.
 */
export function renderAppearanceRows(
  rows: Pick<PaneRows, "appearanceRow">, label: string, target: string, key: AppearanceKey,
  override: AppearanceOverride | undefined, onCommit: AppearanceCommit, opts: AppearanceOpts = {},
): void {
  const resolved = resolveAppearance(key, override);
  const fallback = defaultAppearance(key);
  const patternOptions: Array<[string, string]> = [
    ["", t("appearance.patternAuto", { name: patternName(fallback.pattern) })],
    ...PATTERN_IDS.map((id): [string, string] => [id, patternName(id)]),
  ];
  const coalesceKey = "appearance:" + target;
  rows.appearanceRow(label, rgbToHex(resolved.color), patchAppearance(override, {}) !== undefined,
    override?.pattern ?? "", patternOptions,
    {
      color: hex => onCommit({ color: hex }, coalesceKey),
      texture: id => onCommit({ texture: id === "" ? null : id }, coalesceKey),
      pattern: p => onCommit({ pattern: p === "" ? null : p as PatternId }, coalesceKey),
      clear: () => onCommit(null, coalesceKey),
    }, { ...opts, target, coalesceKey, texture: opts.mixed ? "" : override?.texture ?? "" });
}

/** A stable name for what an appearance row edits: kind, element id(s) and the field it lives in. */
export const appearanceTarget = (kind: string, ids: string | readonly string[], field: string): string =>
  `${kind}:${typeof ids === "string" ? ids : ids.join(",")}:${field}`;
