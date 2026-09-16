// The three preliminary structural checks a plan draws: a deck's joists, a
// placed beam, an opening's lintel. Each turns the document's own authored
// figures into a core/timber.ts SpanInput (or SteelSpanInput) and reports the
// result -- this is the only place in the codebase that knows a deck's area
// load is N/m², a beam's authored load is kN/m, or that kN/m and N/mm are the
// same number; core/timber.ts itself is unit-agnostic. checkSpan() and
// checkSteelSpan() are pure and know nothing about the document; this module
// is where a document object becomes their input.
//
// Reported, never enforced -- see core/timber.ts's own header for the
// standards policy and the list of what a preliminary check excludes.
import type { PlanDoc, Floor, Wall, Opening, WallMaterial } from "../model/doc";
import { isFramedMaterial, openingHead, openingBearing } from "../model/doc";
import { wallTopAt } from "../model/profile";
import type { Deck } from "../model/deck";
import { deckSpanMm } from "./deck";
import type { Beam } from "../model/structure";
import { STEEL_PROFILES } from "../model/structure";
import { spanLength } from "./structure";
import {
  timberOf, gammaGOf, gammaQOf, deflectionDivOf, sectionsMmOf, steelFyOf,
  WALL_DENSITY_KG_M3, FRAMED_WALL_FACE_LOAD_KNM2, type TimberAssumptions,
} from "../model/materials";
import {
  checkSpan, proposeSection, checkSteelSpan,
  type SpanInput, type SpanCheck, type SteelSpanInput,
} from "./timber";

export type CheckStatus = "ok" | "fails" | "incomplete";

export interface CheckResult {
  status: CheckStatus;
  /**
   * Stable keys naming what stopped the check -- worded by the pane that
   * reads them, never a sentence. Empty once `status` is not "incomplete".
   */
  missing: string[];
  /** "steel" once a beam's label matches a cataloged profile with known
   *  Wy/Iy; "timber" (a rectangular section) otherwise, including for the
   *  joist and lintel checks, which have no steel path. */
  material: "timber" | "steel";
  input?: SpanInput | SteelSpanInput;
  check?: SpanCheck;
  /** Smallest passing section from the document's list, when the check
   *  fails or a section is missing; undefined when it already passes;
   *  null when nothing in the list passes (or nothing could be tried). */
  proposal?: { w: number; d: number } | null;
}

/** Standard gravity, m/s² -- for turning a wall's density into a self-weight. */
const GRAVITY_MS2 = 9.81;

/**
 * A wall's self-weight over its own height `aboveMm`, as a line load, N/mm.
 * A framed wall (timber or steel post material) uses FRAMED_WALL_FACE_LOAD_KNM2
 * per m² of face rather than density × thickness -- its weight is the boarding
 * and insulation, not the frame's own bulk. Other materials use
 * WALL_DENSITY_KG_M3; a material with no table entry (glass, sandwich) or no
 * material at all returns null, unless there is no wall above the head to
 * weigh in the first place, which is zero regardless of material.
 */
function wallLineLoadNmm(material: WallMaterial | undefined, thicknessMm: number, aboveMm: number): number | null {
  if (aboveMm <= 0) return 0;
  if (material !== undefined && isFramedMaterial(material)) {
    // kN/m and N/mm are the same number: kN/m = 1000 N / 1000 mm.
    return FRAMED_WALL_FACE_LOAD_KNM2 * (aboveMm / 1000);
  }
  const density = material !== undefined ? WALL_DENSITY_KG_M3[material] : undefined;
  if (density === undefined) return null;
  // kg/m³ × m × m × m/s² = N/m; /1000 for N/m -> N/mm.
  return (density * (thicknessMm / 1000) * (aboveMm / 1000) * GRAVITY_MS2) / 1000;
}

/** The line-load half of a SpanInput/SteelSpanInput: span, factored and
 *  characteristic load. Shared by all three checks once each has reduced its
 *  own authored figures to one permanent line load, N/mm ("g line"), and (for
 *  the joist check alone) a separate variable one. */
function loadInputs(spanMm: number, gLineNmm: number, qLineNmm: number, doc: PlanDoc) {
  return {
    spanMm,
    qdNmm: gammaGOf(doc) * gLineNmm + gammaQOf(doc) * qLineNmm,
    qkNmm: gLineNmm + qLineNmm,
  };
}

function timberBase(doc: PlanDoc, spanMm: number, gLineNmm: number, qLineNmm: number): Omit<SpanInput, "section"> {
  const timber: TimberAssumptions = timberOf(doc);
  return { ...loadInputs(spanMm, gLineNmm, qLineNmm, doc), material: timber, deflectionDiv: deflectionDivOf(doc) };
}

function timberResult(base: Omit<SpanInput, "section">, section: { w: number; d: number }, sections: readonly { w: number; d: number }[]): { check: SpanCheck; proposal?: { w: number; d: number } | null } {
  const input: SpanInput = { ...base, section };
  const check = checkSpan(input);
  return { check, proposal: check.passes ? undefined : proposeSection(base, sections) };
}

// ── joist ────────────────────────────────────────────────────────────────

/**
 * A deck's joists: span = the deck's own extent along the joist axis; load
 * width = joist centres; g and q from the deck's authored area loads (N/m²);
 * section = the deck's stated joist, else incomplete with a proposal (which
 * still needs the load to compute).
 */
export function joistCheck(doc: PlanDoc, deck: Deck): CheckResult {
  const missing: string[] = [];
  const spanMm = deckSpanMm(deck);
  if (spanMm <= 0) missing.push("span");
  if (deck.loadG === undefined || deck.loadQ === undefined) missing.push("load");
  if (!deck.joist) missing.push("joistSection");

  const sections = sectionsMmOf(doc);
  const base = spanMm > 0 && deck.loadG !== undefined && deck.loadQ !== undefined
    ? timberBase(
        doc, spanMm,
        // N/m² × mm width / 1e6 = N/mm.
        (deck.loadG * deck.joistMm) / 1_000_000,
        (deck.loadQ * deck.joistMm) / 1_000_000,
      )
    : null;

  if (!deck.joist || !base) {
    return { status: "incomplete", missing, material: "timber", proposal: base ? proposeSection(base, sections) : null };
  }

  const { check, proposal } = timberResult(base, deck.joist, sections);
  return { status: check.passes ? "ok" : "fails", missing: [], material: "timber", input: { ...base, section: deck.joist }, check, proposal };
}

// ── beam ─────────────────────────────────────────────────────────────────

/**
 * A placed beam: span = the run's own length; load = the beam's authored
 * `loadKNm`, treated wholly as permanent (no separate variable component is
 * authored for a beam). A label matching STEEL_PROFILES with known Wy/Iy
 * takes the steel path; otherwise the section is width × depth timber.
 */
export function beamCheck(doc: PlanDoc, _f: Floor, beam: Beam): CheckResult {
  const missing: string[] = [];
  const spanMm = spanLength(beam);
  if (spanMm <= 0) missing.push("span");
  if (beam.loadKNm === undefined) missing.push("loadKNm");

  const profile = beam.label !== undefined ? STEEL_PROFILES.find(p => p.label === beam.label) : undefined;
  const isSteel = profile !== undefined;

  if (missing.length > 0) {
    return { status: "incomplete", missing, material: isSteel ? "steel" : "timber", proposal: null };
  }

  // kN/m and N/mm are the same number; the whole authored load is permanent.
  const gLineNmm = beam.loadKNm!;
  const { qdNmm, qkNmm } = loadInputs(spanMm, gLineNmm, 0, doc);
  const deflectionDiv = deflectionDivOf(doc);

  if (profile) {
    const input: SteelSpanInput = {
      spanMm, qdNmm, qkNmm,
      // cm³ -> mm³ (×1000), cm⁴ -> mm⁴ (×10000).
      wyMm3: profile.wy * 1000, iyMm4: profile.iy * 10000,
      fy: steelFyOf(doc), deflectionDiv,
    };
    const check = checkSteelSpan(input);
    return { status: check.passes ? "ok" : "fails", missing: [], material: "steel", input, check };
  }

  const timber = timberOf(doc);
  const base: Omit<SpanInput, "section"> = { spanMm, qdNmm, qkNmm, material: timber, deflectionDiv };
  const { check, proposal } = timberResult(base, { w: beam.width, d: beam.depth }, sectionsMmOf(doc));
  return { status: check.passes ? "ok" : "fails", missing: [], material: "timber", input: { ...base, section: { w: beam.width, d: beam.depth } }, check, proposal };
}

// ── lintel ───────────────────────────────────────────────────────────────

/**
 * An opening's lintel: span = opening width + 2 × bearing; load = the wall
 * above the opening head (density × thickness × the wall's own height above
 * the head there, read via wallTopAt() so a gable's rake is not loaded with a
 * rectangle of wall that is not there) plus an optional authored
 * `lintelLoadKNm` for a floor bearing on the wall. A wall stating no material
 * (or one with no density figure -- glass, sandwich) is incomplete; section =
 * the opening's stated `lintel`, else incomplete with a proposal.
 */
export function lintelCheck(doc: PlanDoc, f: Floor, wall: Wall, opening: Opening): CheckResult {
  const missing: string[] = [];
  const spanMm = opening.width + 2 * openingBearing(opening);

  const headMm = openingHead(opening);
  const topMm = wallTopAt(f, wall, opening.t);
  const aboveMm = Math.max(0, topMm - headMm);

  const selfWeightNmm = wallLineLoadNmm(wall.material, wall.thickness, aboveMm);
  if (selfWeightNmm === null) missing.push("material");
  if (!opening.lintel) missing.push("lintelSection");

  const sections = sectionsMmOf(doc);
  const base = selfWeightNmm !== null
    // kN/m and N/mm are the same number.
    ? timberBase(doc, spanMm, selfWeightNmm + (opening.lintelLoadKNm ?? 0), 0)
    : null;

  if (!opening.lintel || !base) {
    return { status: "incomplete", missing, material: "timber", proposal: base ? proposeSection(base, sections) : null };
  }

  const { check, proposal } = timberResult(base, opening.lintel, sections);
  return { status: check.passes ? "ok" : "fails", missing: [], material: "timber", input: { ...base, section: opening.lintel }, check, proposal };
}
