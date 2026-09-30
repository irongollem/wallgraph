// The 3D look of one element: a colour, a pattern and a way back to the
// built-in default. The default comes from model/appearance.ts; what is stored
// is only the difference from it.
import { t } from "../i18n";
import { PATTERN_IDS, defaultAppearance, resolveAppearance } from "../model/appearance";
import type { AppearanceKey, AppearanceOverride, PatternId, Rgb } from "../model/appearance";
import type { PaneRows } from "./stairs";

export function patternName(id: PatternId): string {
  return t("appearance.pattern." + id);
}

export function rgbToHex(c: Rgb): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return "#" + h(c[0]) + h(c[1]) + h(c[2]);
}

/** An override with neither field is no override. */
export function normalizeOverride(o: AppearanceOverride): AppearanceOverride | undefined {
  const out: AppearanceOverride = {};
  if (o.color !== undefined) out.color = o.color;
  if (o.pattern !== undefined) out.pattern = o.pattern;
  if (o.texture !== undefined) out.texture = o.texture;
  return out.color === undefined && out.pattern === undefined && out.texture === undefined ? undefined : out;
}

/** Writes `next` onto `holder[field]`, deleting the field when it is empty. */
export function writeOverride<K extends string>(
  holder: { [P in K]?: AppearanceOverride }, field: K, next: AppearanceOverride | undefined,
): void {
  if (next) holder[field] = { ...next }; else delete holder[field];
}

export interface AppearanceOpts {
  /** Bulk pane: the members differ, so the first member's look is only shown. */
  mixed?: boolean;
}

/**
 * One row group: colour (showing the resolved colour), a Default chip that
 * clears the override, and a pattern select. `onCommit` receives the whole next
 * override, or undefined when nothing differs from the default.
 */
export function renderAppearanceRows(
  rows: Pick<PaneRows, "appearanceRow">, label: string, key: AppearanceKey, override: AppearanceOverride | undefined,
  onCommit: (next: AppearanceOverride | undefined) => void, opts: AppearanceOpts = {},
): void {
  const resolved = resolveAppearance(key, override);
  const fallback = defaultAppearance(key);
  const patternOptions: Array<[string, string]> = [
    ["", t("appearance.patternAuto", { name: patternName(fallback.pattern) })],
    ...PATTERN_IDS.map((id): [string, string] => [id, patternName(id)]),
  ];
  rows.appearanceRow(label, rgbToHex(resolved.color), normalizeOverride(override ?? {}) !== undefined,
    override?.pattern ?? "", patternOptions,
    {
      color: hex => onCommit(normalizeOverride({ ...override, color: hex })),
      texture: id => {
        const next: AppearanceOverride = { ...override };
        if (id === "") delete next.texture; else next.texture = id;
        onCommit(normalizeOverride(next));
      },
      pattern: p => {
        const next: AppearanceOverride = { ...override };
        if (p === "") delete next.pattern; else next.pattern = p as PatternId;
        onCommit(normalizeOverride(next));
      },
      clear: () => onCommit(undefined),
    }, { ...opts, texture: opts.mixed ? "" : override?.texture ?? "" });
}
