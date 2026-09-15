// Assumptions for the wall material takeoff: what a wall's construction is
// nested and quantified against when the document states no figure of its
// own. Modeled on model/energy.ts -- absent means "not stated", read only
// through the accessors below, never through doc.materials directly. All
// figures are indicative trade defaults, editable per document.
import type { PlanDoc } from "./doc";

export interface MaterialAssumptions {
  /** Stock lengths timber is bought in, mm, ascending. */
  stockMm?: number[];
  /** Saw kerf per cut, mm. */
  kerfMm?: number;
  /** Waste allowance on sheet and block quantities, percent. */
  wastePct?: number;
  /** Board sheet the lining is cut from, mm. */
  sheetMm?: { width: number; height: number };
}

/** Ordinary Dutch timber stock lengths, mm, ascending. */
export const STOCK_MM_DEFAULT: readonly number[] = [2400, 2700, 3000, 3600, 4200, 4800, 5400, 6000];
/** An ordinary hand or panel saw kerf, mm. */
export const KERF_MM_DEFAULT = 3;
/** An ordinary trade waste allowance on sheet and block quantities, percent. */
export const WASTE_PCT_DEFAULT = 10;
/** An ordinary plasterboard/OSB sheet size, mm. */
export const SHEET_MM_DEFAULT: { width: number; height: number } = { width: 1200, height: 2600 };

/**
 * Stock lengths to nest against: the document's own list, cleaned to positive
 * integers, deduplicated and sorted ascending. Filtered rather than rejected
 * wholesale -- one bad entry in a pasted document should not silently fall
 * back to the whole default list -- and the default applies only when
 * filtering leaves nothing.
 */
export function stockLengths(d: PlanDoc): readonly number[] {
  const raw = d.materials?.stockMm;
  if (!raw || raw.length === 0) return STOCK_MM_DEFAULT;
  const cleaned = [...new Set(raw.filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  return cleaned.length > 0 ? cleaned : STOCK_MM_DEFAULT;
}

/** Saw kerf per cut, mm: the document's own figure when stated and not
 *  negative, else the default. */
export function kerfMm(d: PlanDoc): number {
  const k = d.materials?.kerfMm;
  return k !== undefined && isFinite(k) && k >= 0 ? k : KERF_MM_DEFAULT;
}

/** Waste allowance on sheet and block quantities, percent. */
export function wastePct(d: PlanDoc): number {
  const w = d.materials?.wastePct;
  return w !== undefined && isFinite(w) && w >= 0 ? w : WASTE_PCT_DEFAULT;
}

/** Sheet size the lining is cut from, mm. */
export function sheetMm(d: PlanDoc): { width: number; height: number } {
  const s = d.materials?.sheetMm;
  return s && s.width > 0 && s.height > 0 ? s : SHEET_MM_DEFAULT;
}
