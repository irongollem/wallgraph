// Assumptions for the wall material takeoff and the preliminary structural
// checks (core/timber.ts, core/checks.ts): what a wall's construction is
// nested and quantified against, and what a span is checked against, when the
// document states no figure of its own. Modeled on model/energy.ts -- absent
// means "not stated", read only through the accessors below, never through
// doc.materials directly. All figures are indicative trade defaults, editable
// per document, and every one named below has a hard runtime default: unlike
// model/energy.ts's Rc/U (a physical fact about one specific wall, with no
// sensible universal figure), these are generic engineering conventions --
// partial factors, a deflection limit, a strength class -- that a preliminary
// check needs to run at all, in the same spirit as this file's own
// stockMm/kerfMm/wastePct/sheetMm below. A structural check therefore never
// reports "incomplete" over a document-level assumption, only over the
// per-object facts core/checks.ts reads (a joist's section, a beam's load, a
// wall's material) -- see CLAUDE.md's "missing input yields incomplete"
// policy, which is about those facts, not about a safety-factor convention.
import type { PlanDoc, WallMaterial } from "./doc";

export interface MaterialAssumptions {
  /** Stock lengths timber is bought in, mm, ascending. */
  stockMm?: number[];
  /** Saw kerf per cut, mm. */
  kerfMm?: number;
  /** Waste allowance on sheet and block quantities, percent. */
  wastePct?: number;
  /** Board sheet the lining is cut from, mm. */
  sheetMm?: { width: number; height: number };
  /**
   * Timber strength class for the preliminary span checks. Absent means the
   * default class applies (see TIMBER_DEFAULT); read via timberOf(). Bundled
   * as one object because a strength class and its partial factors are
   * chosen together, the way applyTimberClass() writes fmk/fvk/e0mean without
   * disturbing kmod/gammaM/kdef.
   */
  timber?: TimberAssumptions;
  /** Steel yield strength for a beam checked against a catalogue profile. */
  steel?: { fy: number };
  /** Partial factor on permanent load. Indicative default 1.2, editable. */
  gammaG?: number;
  /** Partial factor on variable load. Indicative default 1.5, editable. */
  gammaQ?: number;
  /** Deflection limit as a span fraction: 250 means L/250. Indicative default 250. */
  deflectionDiv?: number;
  /** Rectangular timber sections available to propose from, mm, ascending by depth then width. */
  sectionsMm?: { w: number; d: number }[];
}

/**
 * Timber material properties a span check needs. fmk/fvk/e0mean are
 * characteristic bending strength, shear strength and mean modulus of
 * elasticity, N/mm² -- the strength-class figures a TIMBER_CLASSES preset
 * fills in. kmod (load-duration and service-class modification factor),
 * gammaM (material partial factor) and kdef (creep factor) are the same for
 * every class, carried alongside so a document can edit them without also
 * restating the class.
 */
export interface TimberAssumptions {
  fmk: number; fvk: number; e0mean: number;
  kmod: number; gammaM: number; kdef: number;
}

/** Indicative defaults for the three factors shared by every timber class. */
export const KMOD_DEFAULT = 0.8;
export const GAMMA_M_DEFAULT = 1.3;
export const KDEF_DEFAULT = 0.6;

/** Indicative default partial factors on permanent and variable load. */
export const GAMMA_G_DEFAULT = 1.2;
export const GAMMA_Q_DEFAULT = 1.5;

/** Indicative default deflection limit: L/250. */
export const DEFLECTION_DIV_DEFAULT = 250;

/** Indicative default steel yield strength, N/mm² (S235). */
export const STEEL_FY_DEFAULT = 235;

export type TimberClassId = "C18" | "C24" | "GL24h";

export interface TimberClass { id: TimberClassId; fmk: number; fvk: number; e0mean: number }

/** Named timber strength classes -- a preset only fills fmk/fvk/e0mean; it
 *  stores nothing of itself, and the select reads back whichever class the
 *  figures happen to match (timberClassOf()), exactly as INSULATION_CLASSES
 *  does. Indicative, not a substitute for a graded delivery note. */
export const TIMBER_CLASSES: readonly TimberClass[] = [
  { id: "C18", fmk: 18, fvk: 3.4, e0mean: 9000 },
  { id: "C24", fmk: 24, fvk: 4.0, e0mean: 11000 },
  { id: "GL24h", fmk: 24, fvk: 3.5, e0mean: 11500 },
];

/** The document default when no timber assumption is stated: C24 with the
 *  three shared factors at their indicative defaults. */
export const TIMBER_DEFAULT: TimberAssumptions = {
  fmk: 24, fvk: 4.0, e0mean: 11000,
  kmod: KMOD_DEFAULT, gammaM: GAMMA_M_DEFAULT, kdef: KDEF_DEFAULT,
};

/** Two figures count as the same class within this tolerance, N/mm². */
const CLASS_TOL_MPA = 0.05;

/** The timber class whose fmk/fvk/e0mean all match, or null for a genuine
 *  custom mix -- mirrors energy.ts's insulationClassOf(). kmod/gammaM/kdef
 *  are not part of the match: they are shared factors, not the class. */
export function timberClassOf(t: TimberAssumptions | undefined): TimberClassId | null {
  if (!t) return null;
  const hit = TIMBER_CLASSES.find(c =>
    Math.abs(c.fmk - t.fmk) <= CLASS_TOL_MPA
    && Math.abs(c.fvk - t.fvk) <= CLASS_TOL_MPA
    && Math.abs(c.e0mean - t.e0mean) <= CLASS_TOL_MPA);
  return hit?.id ?? null;
}

/** Writes a named class's fmk/fvk/e0mean onto `t`, leaving kmod/gammaM/kdef
 *  untouched -- mirrors energy.ts's applyInsulationClass(). */
export function applyTimberClass(t: TimberAssumptions, id: TimberClassId): void {
  const c = TIMBER_CLASSES.find(x => x.id === id);
  if (!c) return;
  t.fmk = c.fmk;
  t.fvk = c.fvk;
  t.e0mean = c.e0mean;
}

/** The ordinary trade sizes, mm, ascending by depth then width -- what
 *  proposeSection() in core/timber.ts offers from when a document states no
 *  section list of its own. */
export const SECTIONS_DEFAULT: readonly { w: number; d: number }[] = [
  { w: 44, d: 69 }, { w: 38, d: 89 }, { w: 44, d: 95 }, { w: 44, d: 120 },
  { w: 38, d: 140 }, { w: 44, d: 145 }, { w: 44, d: 170 }, { w: 71, d: 171 },
  { w: 44, d: 195 }, { w: 71, d: 196 }, { w: 44, d: 220 }, { w: 71, d: 221 },
];

/** Timber material properties: the document's own, else TIMBER_DEFAULT (C24). */
export function timberOf(d: PlanDoc): TimberAssumptions {
  return d.materials?.timber ?? TIMBER_DEFAULT;
}

/** Steel yield strength, N/mm²: the document's own, else STEEL_FY_DEFAULT. */
export function steelFyOf(d: PlanDoc): number {
  const fy = d.materials?.steel?.fy;
  return fy !== undefined && isFinite(fy) && fy > 0 ? fy : STEEL_FY_DEFAULT;
}

/** Partial factor on permanent load: the document's own, else GAMMA_G_DEFAULT. */
export function gammaGOf(d: PlanDoc): number {
  const g = d.materials?.gammaG;
  return g !== undefined && isFinite(g) && g > 0 ? g : GAMMA_G_DEFAULT;
}

/** Partial factor on variable load: the document's own, else GAMMA_Q_DEFAULT. */
export function gammaQOf(d: PlanDoc): number {
  const q = d.materials?.gammaQ;
  return q !== undefined && isFinite(q) && q > 0 ? q : GAMMA_Q_DEFAULT;
}

/** Deflection limit as a span fraction (250 means L/250): the document's own,
 *  else DEFLECTION_DIV_DEFAULT. */
export function deflectionDivOf(d: PlanDoc): number {
  const div = d.materials?.deflectionDiv;
  return div !== undefined && isFinite(div) && div > 0 ? div : DEFLECTION_DIV_DEFAULT;
}

/** Sections to propose from: the document's own list, cleaned to positive
 *  integer pairs, else SECTIONS_DEFAULT -- mirrors stockLengths()'s cleaning,
 *  one bad entry does not fall back to the whole default list. */
export function sectionsMmOf(d: PlanDoc): readonly { w: number; d: number }[] {
  const raw = d.materials?.sectionsMm;
  if (!raw || raw.length === 0) return SECTIONS_DEFAULT;
  const cleaned = raw.filter(s =>
    Number.isInteger(s.w) && s.w > 0 && Number.isInteger(s.d) && s.d > 0);
  return cleaned.length > 0 ? cleaned : SECTIONS_DEFAULT;
}

/**
 * Indicative self-weight densities for a lintel's wall load, kg/m³ -- the
 * masonry-type materials a wall states. A framed wall (timber or steel post
 * frame) does not carry a density: its self-weight is FRAMED_WALL_FACE_LOAD_KNM2
 * per m² of face instead, since a stud wall's weight comes from its lining and
 * insulation, not from the frame's own bulk. "glass" and "sandwich" carry
 * neither -- a lintelCheck() over one of those reports "material" missing.
 */
export const WALL_DENSITY_KG_M3: Partial<Record<WallMaterial, number>> = {
  masonry: 1900,
  calciumsilicate: 1850,
  concrete: 2400,
  aerated: 600,
};

/** A framed wall's self-weight per m² of face, kN/m² -- indicative, covers
 *  the boarding, insulation and frame together rather than the frame alone. */
export const FRAMED_WALL_FACE_LOAD_KNM2 = 0.5;

/** Ordinary Dutch timber stock lengths, mm, ascending. */
export const STOCK_MM_DEFAULT: readonly number[] = [2400, 2700, 3000, 3600, 4200, 4800, 5400, 6000];

/**
 * Named stock-length presets a document's list is often set out from rather
 * than typed by hand -- the bouwmarkt's common structural lengths, or the
 * full houthandel range (equal to STOCK_MM_DEFAULT, so choosing it is the
 * same as clearing the field back to default; see stockPresetOf()).
 */
export interface StockPreset { id: "diy" | "merchant"; stockMm: readonly number[] }

export const STOCK_PRESETS: readonly StockPreset[] = [
  { id: "diy", stockMm: [2400, 2700, 3000] },
  { id: "merchant", stockMm: STOCK_MM_DEFAULT },
];

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

/**
 * The preset whose stock lengths exactly match the document's own list (the
 * default list counts as "merchant", since it equals that preset), or null
 * for a genuine custom list -- mirrors model/energy.ts's insulationClassOf().
 */
export function stockPresetOf(d: PlanDoc): StockPreset["id"] | null {
  const cur = stockLengths(d);
  const hit = STOCK_PRESETS.find(p => p.stockMm.length === cur.length && p.stockMm.every((v, i) => v === cur[i]));
  return hit?.id ?? null;
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
