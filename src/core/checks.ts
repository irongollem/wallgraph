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
import { type Deck, bearingOf, DECK_USES } from "../model/deck";
import { deckSpanMm } from "./deck";
import type { Beam } from "../model/structure";
import { STEEL_PROFILES, STRUCTURE_LIMITS } from "../model/structure";
import { spanLength } from "./structure";
import {
  timberOf, gammaGOf, gammaQOf, deflectionDivOf, sectionsMmOf, steelFyOf,
  WALL_DENSITY_KG_M3, FRAMED_WALL_FACE_LOAD_KNM2, TIMBER_DENSITY_KG_M3, type TimberAssumptions,
} from "../model/materials";
import {
  checkSpan, proposeSection, checkSteelSpan,
  type SpanInput, type SpanCheck, type SteelSpanInput,
} from "./timber";
import { checkComfort, DECKING_E_MPA, type ComfortCheck } from "./comfort";
import type { TrimmedDeck } from "./trimmer";

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
  /**
   * The line load's own permanent/variable make-up, kN/m (numerically equal
   * to N/mm -- see the unit-conversion note above) -- separate from
   * `input.qdNmm`/`qkNmm`, which are already summed and factored, so the UI
   * can show what a result is built from without re-deriving the unit
   * conversion this module owns. Present once the load itself is known, even
   * when the check as a whole is `incomplete` over a missing section.
   * `wallLineKNm` is present only for a lintel: the wall's own self-weight,
   * which is `gLineKNm` in full -- the opening's own `lintelLoadKNm` is a
   * variable load and so is carried in `qLineKNm` instead (see
   * lintelCheck()'s own header).
   */
  loadBreakdown?: { gLineKNm: number; qLineKNm: number; wallLineKNm?: number };
  /**
   * A deck's own comfort figures (issue #61) -- fundamental frequency and
   * 1 kN point-load deflection -- reported beside the strength check, never
   * folded into `status`: a floor that fails comfort but passes bending,
   * shear and deflection is still `status: "ok"` here, with `comfort.passes`
   * false telling the rest of the story. Present only for joistCheck(); a
   * beam or lintel carries no comfort figure. Undefined when the deck states
   * no joist section or no permanent load -- see the "loadG" `missing` key,
   * which always accompanies an undefined `comfort` (the section is covered
   * by "joistSection", the span by "span").
   */
  comfort?: ComfortCheck;
  /**
   * Stable keys naming a load this module read as implausible -- a figure
   * typed low enough to pass a check rather than one the building actually
   * states (issue #62). Reported beside the result exactly like `missing`,
   * worded by the pane that reads it; never changes `status`, a
   * utilisation or `proposal` -- see joistCheck()/beamCheck()/lintelCheck()'s
   * own comments for what each key tests. Undefined when nothing is flagged.
   */
  flags?: string[];
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
 * A joist's own self-weight spread over the floor area it carries, kg/m²:
 * TIMBER_DENSITY_KG_M3 times the joist's cross-section, spread over its
 * tributary width (the centres) -- an "equivalent thickness" of solid
 * timber over the floor, the same idea FRAMED_WALL_FACE_LOAD_KNM2 applies
 * to a stud wall's face. kg/m³ × mm² / mm gives mm (an equivalent
 * thickness); /1000 turns that into m for the kg/m³ to cancel to kg/m².
 */
function joistSelfWeightKgM2(joist: { w: number; d: number }, centresMm: number): number {
  return centresMm > 0 ? (TIMBER_DENSITY_KG_M3 * joist.w * joist.d) / (centresMm * 1000) : 0;
}

/** A decking sheet's own self-weight, kg/m²: density × thickness, mm to m. */
function deckingSelfWeightKgM2(deckingMm: number): number {
  return (TIMBER_DENSITY_KG_M3 * deckingMm) / 1000;
}

/**
 * Issue #62: a load typed low enough to pass a check must still read as odd
 * beside the result -- reported, never enforced (this module's own header).
 * `lowLoadQ` compares the deck's own stated loadQ against the lightest
 * DECK_USES preset: typed below even a berging/balkon figure understates
 * what any ordinary floor use asks for. `lowLoadG` compares loadG against
 * the deck's OWN computed self-weight (joists plus decking, the same figures
 * comfortInputs() derives) -- a stated permanent load below what the timber
 * already weighs cannot be the floor's true permanent load, whatever the
 * use, and needs a joist section to compute at all.
 */
function deckLoadFlags(deck: Deck): string[] | undefined {
  const flags: string[] = [];
  if (deck.loadQ !== undefined) {
    const lowestQ = Math.min(...DECK_USES.map(u => u.loadQ));
    if (deck.loadQ < lowestQ) flags.push("lowLoadQ");
  }
  if (deck.loadG !== undefined && deck.joist) {
    const selfWeightNm2 = (joistSelfWeightKgM2(deck.joist, deck.joistMm)
      + (deck.deckingMm ? deckingSelfWeightKgM2(deck.deckingMm) : 0)) * GRAVITY_MS2;
    if (deck.loadG < selfWeightNm2) flags.push("lowLoadG");
  }
  return flags.length > 0 ? flags : undefined;
}

/**
 * The comfort check's own inputs, derived from the deck's stated facts --
 * undefined when a joist section or the permanent load is not stated, since
 * neither the stiffness (EI) nor the mass can be assumed. Not gated on the
 * variable load (unlike the strength check's `hasLoad`): comfort's mass is
 * self weight plus the PERMANENT load only, so a deck missing only its
 * variable load can still report a comfort figure.
 */
function comfortInputs(doc: PlanDoc, deck: Deck, spanMm: number): ComfortCheck | undefined {
  if (!deck.joist || deck.loadG === undefined || spanMm <= 0) return undefined;
  const timber = timberOf(doc);
  const selfWeightKgM2 = joistSelfWeightKgM2(deck.joist, deck.joistMm)
    + (deck.deckingMm ? deckingSelfWeightKgM2(deck.deckingMm) : 0);
  // N/m² / (m/s²) = kg/m²: the authored permanent load as a mass rather
  // than a force, matching the self-weight figures above.
  const massKgM2 = selfWeightKgM2 + deck.loadG / GRAVITY_MS2;
  const deckEiPerMm = deck.deckingMm ? (DECKING_E_MPA * deck.deckingMm ** 3) / 12 : 0;
  return checkComfort({
    spanMm, centresMm: deck.joistMm, section: deck.joist, e0mean: timber.e0mean,
    massKgM2, deckEiPerMm, minHz: timber.comfort!.minHz, maxPointMm: timber.comfort!.maxPointMm,
  });
}

/**
 * A deck's joists: span = the deck's own clear extent along the joist axis
 * plus one bearing -- centre-to-centre of the joist's own bearings at each
 * end, the same convention every span check here uses (see lintelCheck());
 * load width = joist centres; g and q from the deck's authored area loads
 * (N/m²); section = the deck's stated joist, else incomplete with a proposal
 * (which still needs the load to compute). `comfort` is derived alongside
 * and independently of the strength result -- see comfortInputs() -- so it
 * can be present even where the strength check itself is `incomplete` over
 * a missing variable load.
 */
export function joistCheck(doc: PlanDoc, deck: Deck): CheckResult {
  const missing: string[] = [];
  const spanMm = deckSpanMm(deck) + bearingOf(deck);
  if (spanMm <= 0) missing.push("span");
  const hasLoad = deck.loadG !== undefined && deck.loadQ !== undefined;
  if (!hasLoad) missing.push("load");
  if (deck.loadG === undefined) missing.push("loadG");
  if (!deck.joist) missing.push("joistSection");

  const sections = sectionsMmOf(doc);
  // N/m² × mm width / 1e6 = N/mm, numerically the same as kN/m.
  const gLineNmm = hasLoad ? (deck.loadG! * deck.joistMm) / 1_000_000 : 0;
  const qLineNmm = hasLoad ? (deck.loadQ! * deck.joistMm) / 1_000_000 : 0;
  const base = spanMm > 0 && hasLoad ? timberBase(doc, spanMm, gLineNmm, qLineNmm) : null;
  const loadBreakdown = hasLoad ? { gLineKNm: gLineNmm, qLineKNm: qLineNmm } : undefined;
  const comfort = comfortInputs(doc, deck, spanMm);
  const flags = deckLoadFlags(deck);

  if (!deck.joist || !base) {
    return {
      status: "incomplete", missing, material: "timber",
      proposal: base ? proposeSection(base, sections) : null, loadBreakdown, comfort, flags,
    };
  }

  const { check, proposal } = timberResult(base, deck.joist, sections);
  return {
    status: check.passes ? "ok" : "fails", missing: [], material: "timber",
    input: { ...base, section: deck.joist }, check, proposal, loadBreakdown, comfort, flags,
  };
}

// ── header / trimmer (issue #64) ────────────────────────────────────────

export type DeckHeader = TrimmedDeck["headers"][number];
export type DeckTrimmer = TrimmedDeck["trimmers"][number];

/**
 * A header across a trimmed opening (core/trimmer.ts's trimDeck()): span and
 * carried-joist count are its own; load is its own end reaction, already
 * split into g and q (header.reactionG/reactionQ, both characteristic --
 * trimDeck() derives them straight from the deck's own loadG/loadQ, with no
 * combined figure to split back by ratio) turned into a line load over the
 * header's own span (reactionG/Q is the header's own reaction at ONE end,
 * i.e. half its own total UDL load, so the total is 2*reaction). Section =
 * the deck's own stated joist, exactly as joistCheck() reads it: this issue
 * adds no separate header section field, so a header is checked -- and
 * proposed a size -- against the same joist stock the rest of the deck
 * orders. `comfort` is left undefined; issue #64 does not ask for one on a
 * header.
 */
export function headerCheck(doc: PlanDoc, deck: Deck, header: DeckHeader): CheckResult {
  const missing: string[] = [];
  if (header.spanMm <= 0) missing.push("span");
  const hasLoad = deck.loadG !== undefined && deck.loadQ !== undefined;
  if (!hasLoad) missing.push("load");
  if (deck.loadG === undefined) missing.push("loadG");
  if (!deck.joist) missing.push("joistSection");

  const gLineNmm = header.spanMm > 0 ? (2 * header.reactionG) / header.spanMm : 0;
  const qLineNmm = header.spanMm > 0 ? (2 * header.reactionQ) / header.spanMm : 0;
  const base = header.spanMm > 0 ? timberBase(doc, header.spanMm, gLineNmm, qLineNmm) : null;
  const loadBreakdown = { gLineKNm: gLineNmm, qLineKNm: qLineNmm };
  const sections = sectionsMmOf(doc);

  if (!deck.joist || !base) {
    return {
      status: "incomplete", missing, material: "timber",
      proposal: base ? proposeSection(base, sections) : null, loadBreakdown,
    };
  }
  const { check, proposal } = timberResult(base, deck.joist, sections);
  return {
    status: check.passes ? "ok" : "fails", missing: [], material: "timber",
    input: { ...base, section: deck.joist }, check, proposal, loadBreakdown,
  };
}

/**
 * proposeSection(), exactly as joistCheck() uses it, but against every
 * candidate section doubled in width first (the trimmer's own convention --
 * see core/trimmer.ts's header) and with `points` folded into the base so a
 * candidate is judged against the same combined load the stated section is
 * checked against. Doubling every candidate by the same factor does not
 * change which one is smallest, so ranking by the doubled candidate's area
 * gives the same order proposeSection() would over the single-piece list;
 * the result is halved back to the single piece a builder orders two of.
 */
function proposeDoubledSection(
  base: Omit<SpanInput, "section">, sections: readonly { w: number; d: number }[], points: SpanInput["points"],
): { w: number; d: number } | null {
  const doubled = sections.map(s => ({ w: s.w * 2, d: s.d }));
  const found = proposeSection({ ...base, points }, doubled);
  return found ? { w: found.w / 2, d: found.d } : null;
}

/**
 * A trimmer beside a trimmed opening: its own strip of floor (the same
 * tributary width, `joistMm`, an ordinary joist at this position would
 * carry -- doubling the section for strength does not double what it
 * carries) as a UDL, plus every header's reaction landing on it as a point
 * load at its own distance along the span (trimmer.points, from
 * trimDeck()) -- ONE beside a hole that reaches the deck's edge, TWO beside
 * a fully interior one, both superposed by checkSpan() rather than checked
 * against the worse alone (issue #64's own follow-up: the ordinary case for
 * a hatch in the middle of a floor is exactly two headers). Each point's g
 * and q are factored separately: `nd = gammaG*g + gammaQ*q` for moment and
 * shear, `nk = g+q` (characteristic) for deflection -- see core/timber.ts's
 * own note on why a point load, unlike the pre-#64 single-point case, now
 * carries this split just like the UDL's own qd/qk. Section = the deck's
 * own stated joist DOUBLED in width for the check (the trimmer's
 * convention); the checked and proposed section are both reported as the
 * doubled figure, and the caller (ui/deck.ts, io/assumptions.ts) halves it
 * back and states "doubled" beside it -- this module reports the physics,
 * not the wording.
 */
export function trimmerCheck(doc: PlanDoc, deck: Deck, trimmer: DeckTrimmer): CheckResult {
  const missing: string[] = [];
  if (trimmer.spanMm <= 0) missing.push("span");
  const hasLoad = deck.loadG !== undefined && deck.loadQ !== undefined;
  if (!hasLoad) missing.push("load");
  if (deck.loadG === undefined) missing.push("loadG");
  if (!deck.joist) missing.push("joistSection");

  const sections = sectionsMmOf(doc);
  const gLineNmm = hasLoad ? (deck.loadG! * deck.joistMm) / 1_000_000 : 0;
  const qLineNmm = hasLoad ? (deck.loadQ! * deck.joistMm) / 1_000_000 : 0;
  const base = trimmer.spanMm > 0 && hasLoad ? timberBase(doc, trimmer.spanMm, gLineNmm, qLineNmm) : null;
  const loadBreakdown = hasLoad ? { gLineKNm: gLineNmm, qLineKNm: qLineNmm } : undefined;

  const gammaG = gammaGOf(doc), gammaQ = gammaQOf(doc);
  const points: SpanInput["points"] = trimmer.points.map(p => (
    { nd: gammaG * p.g + gammaQ * p.q, nk: p.g + p.q, atMm: p.atMm }
  ));

  if (!deck.joist || !base) {
    return {
      status: "incomplete", missing, material: "timber",
      proposal: base ? proposeDoubledSection(base, sections, points) : null, loadBreakdown,
    };
  }

  const doubled = { w: deck.joist.w * 2, d: deck.joist.d };
  const input: SpanInput = { ...base, section: doubled, points };
  const check = checkSpan(input);
  const proposal = check.passes ? undefined : proposeDoubledSection(base, sections, points);
  return {
    status: check.passes ? "ok" : "fails", missing: [], material: "timber",
    input, check, proposal, loadBreakdown,
  };
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
  // Issue #62: a load stated as exactly zero passes trivially -- flagged
  // beside the result rather than folded into `missing`, since zero is a
  // value the document did type, not one it left absent.
  const flags: string[] | undefined = beam.loadKNm === 0 ? ["zeroLoad"] : undefined;

  if (missing.length > 0) {
    return { status: "incomplete", missing, material: isSteel ? "steel" : "timber", proposal: null, flags };
  }

  // kN/m and N/mm are the same number; the whole authored load is permanent.
  const gLineNmm = beam.loadKNm!;
  const loadBreakdown = { gLineKNm: gLineNmm, qLineKNm: 0 };
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
    // A steel beam is checked against its own catalogue section, never
    // proposed a replacement -- proposal is always null so a failing steel
    // beam reads "none passes" rather than silently carrying no note.
    return {
      status: check.passes ? "ok" : "fails", missing: [], material: "steel", input, check, proposal: null,
      loadBreakdown, flags,
    };
  }

  const timber = timberOf(doc);
  const base: Omit<SpanInput, "section"> = { spanMm, qdNmm, qkNmm, material: timber, deflectionDiv };
  // A beam's proposal must survive clampBeamSize() -- STRUCTURE_LIMITS.section
  // is narrower than the document's own default sections list (which offers
  // 38 mm wide joist stock, below a beam's 50 mm minimum) -- so the smallest
  // passing section here is also one the panel can actually store.
  const beamSections = sectionsMmOf(doc).filter(s =>
    s.w >= STRUCTURE_LIMITS.section.min && s.w <= STRUCTURE_LIMITS.section.max
    && s.d >= STRUCTURE_LIMITS.beamDepth.min && s.d <= STRUCTURE_LIMITS.beamDepth.max);
  const { check, proposal } = timberResult(base, { w: beam.width, d: beam.depth }, beamSections);
  return {
    status: check.passes ? "ok" : "fails", missing: [], material: "timber",
    input: { ...base, section: { w: beam.width, d: beam.depth } }, check, proposal, loadBreakdown, flags,
  };
}

// ── lintel ───────────────────────────────────────────────────────────────

/**
 * An opening's lintel: span = opening width + bearing -- centre-to-centre of
 * the lintel's own bearings at each end, the same convention joistCheck()
 * uses; load = the wall above the opening head (density × thickness × the
 * wall's own height above the head there, read via wallTopAt() so a gable's
 * rake is not loaded with a rectangle of wall that is not there), permanent,
 * plus an optional authored `lintelLoadKNm` for a floor bearing on the wall,
 * variable -- a floor's live load is not the wall's own weight, so it is
 * factored by gammaQ rather than folded into the wall's gammaG line. A wall
 * stating no material (or one with no density figure -- glass, sandwich) is
 * incomplete; section = the opening's stated `lintel`, else incomplete with
 * a proposal.
 */
export function lintelCheck(doc: PlanDoc, f: Floor, wall: Wall, opening: Opening): CheckResult {
  const missing: string[] = [];
  const spanMm = opening.width + openingBearing(opening);

  const headMm = openingHead(opening);
  const topMm = wallTopAt(f, wall, opening.t);
  const aboveMm = Math.max(0, topMm - headMm);

  const selfWeightNmm = wallLineLoadNmm(wall.material, wall.thickness, aboveMm);
  if (selfWeightNmm === null) missing.push("material");
  if (!opening.lintel) missing.push("lintelSection");

  const sections = sectionsMmOf(doc);
  const extraNmm = opening.lintelLoadKNm ?? 0;
  // kN/m and N/mm are the same number. The wall's self-weight is permanent
  // (g); an authored lintelLoadKNm is a floor bearing on the wall and so is
  // variable (q), never summed into the g line.
  const base = selfWeightNmm !== null ? timberBase(doc, spanMm, selfWeightNmm, extraNmm) : null;
  const loadBreakdown = selfWeightNmm !== null
    ? { gLineKNm: selfWeightNmm, qLineKNm: extraNmm, wallLineKNm: selfWeightNmm }
    : undefined;
  // Issue #62: an authored floor bearing stated as exactly zero (the toggle
  // is on, the figure typed to nothing) reports the same way beamCheck()'s
  // zero load does -- the wall's own self-weight is never authored, so this
  // is the one load figure a lintel can state at all.
  const flags: string[] | undefined = opening.lintelLoadKNm === 0 ? ["zeroLoad"] : undefined;

  if (!opening.lintel || !base) {
    return {
      status: "incomplete", missing, material: "timber",
      proposal: base ? proposeSection(base, sections) : null, loadBreakdown, flags,
    };
  }

  const { check, proposal } = timberResult(base, opening.lintel, sections);
  return {
    status: check.passes ? "ok" : "fails", missing: [], material: "timber",
    input: { ...base, section: opening.lintel }, check, proposal, loadBreakdown, flags,
  };
}
