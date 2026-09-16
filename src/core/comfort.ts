// A timber deck's own comfort check (issue #61): a floor that passes
// bending, shear and deflection (core/timber.ts) can still feel lively
// underfoot, because none of those three criteria says anything about how
// the span responds to a footstep. Two figures state that instead, both
// ordinary engineering formulas rather than a standard's table -- see the
// standards policy in core/timber.ts's own header, which applies here
// unchanged: every material figure and limit is a document assumption
// (model/materials.ts), editable and marked indicative, and this is a
// preliminary check, reported, never enforced.
//
// Pure and unit-agnostic about the document, exactly like core/timber.ts:
// every input here is already in mm, N/mm² and kg/m², and core/checks.ts is
// where a Deck's own authored facts (joist section, centres, decking
// thickness, loads) become one of these.

export interface ComfortInput {
  /** Checked span, mm -- the same centre-to-centre figure joistCheck() uses. */
  spanMm: number;
  /** Joist centres, mm. */
  centresMm: number;
  /** Rectangular joist section, mm. */
  section: { w: number; d: number };
  /** Mean modulus of elasticity, N/mm². */
  e0mean: number;
  /**
   * Mass the floor carries for the frequency, kg/m²: the joists' and
   * decking's own self weight plus the document's stated permanent load,
   * NOT the variable load -- a person's own weight does not lower a floor's
   * natural frequency, only what it permanently carries does.
   */
  massKgM2: number;
  /**
   * Decking stiffness across the joists, N·mm²/mm -- the bending stiffness
   * of a 1 mm wide strip of decking (E × thickness³/12), comparable to a
   * joist's own EI spread over its tributary width (EI/centresMm). Absent
   * or 0 when no decking is stated, or when the deck has none.
   */
  deckEiPerMm?: number;
  /** Lowest acceptable fundamental frequency, Hz -- MaterialAssumptions.timber.comfort. */
  minHz: number;
  /** Deflection limit under a 1 kN point load at midspan, mm -- MaterialAssumptions.timber.comfort. */
  maxPointMm: number;
}

export interface ComfortCheck {
  hz: number;
  minHz: number;
  pointMm: number;
  maxPointMm: number;
  passes: boolean;
  /** The figure closer to its own limit, or null when neither could be computed. */
  governing: "frequency" | "point" | null;
}

/** A 1 kN point load at midspan -- the standard serviceability check for a
 *  domestic floor's local stiffness under a footstep, N. */
const POINT_LOAD_N = 1000;

/**
 * Indicative bending modulus of an ordinary structural decking sheet
 * (OSB/plywood), N/mm² -- a fixed material constant the way STEEL_E_MPA is
 * in core/timber.ts, not a document assumption: no field in the document
 * states a decking grade, only its thickness. core/checks.ts uses this to
 * turn a deck's stated `deckingMm` into `deckEiPerMm` (E · thickness³/12,
 * the bending stiffness of a 1 mm wide strip).
 */
export const DECKING_E_MPA = 4500;

/**
 * The fundamental frequency of a simply supported span, Hz:
 *
 *     f1 = (π/2)·√(EI / (m·L⁴))
 *
 * with m the mass per unit length of the strip one joist carries. In the
 * document's own units (E in N/mm², I in mm⁴, L in mm, mass in kg/m²) the
 * ratio needs 1e9 before the root: kg/m² over mm of centres is 1e-9 kg/mm³
 * against N/mm² = kg/(mm·s²), which leaves 1/s² under the root.
 */
function frequencyHz(EI: number, massKgM2: number, centresMm: number, spanMm: number): number {
  if (spanMm <= 0 || EI <= 0 || massKgM2 <= 0 || centresMm <= 0) return 0;
  return (Math.PI / 2) * Math.sqrt((1e9 * EI) / (massKgM2 * centresMm * spanMm ** 4));
}

/**
 * How far a point load spreads sideways, as a share of the span. A deck
 * spreads a footstep over the joists either side; how far follows from the
 * deck's own stiffness ACROSS the joists against the joists' stiffness along
 * the span, both per metre of width, as the fourth root of their ratio. The
 * effective width is that ratio times the span; the constant below scales it,
 * and the figure is clamped between one joist (no deck, no spread) and
 * SPREAD_JOISTS_MAX (a spread nobody should count on).
 *
 * This is the ordinary plate-on-beams estimate, not a load-distribution
 * analysis: it is why the reported figure is an indicative comfort mark and
 * says so in the pane.
 */
const SPREAD_WIDTH_FACTOR = 1 / 1.1;
const SPREAD_JOISTS_MAX = 4;

/**
 * Deflection under a 1 kN point load at midspan, a = F·L³/(48·EI) -- F in N,
 * L in mm, EI in N·mm² already gives mm directly, with no unit-conversion
 * factor needed (N·mm³/(N·mm²) = mm) -- divided by the joists the deck
 * spreads that load over (see SPREAD_WIDTH_FACTOR). A deck stating no
 * thickness spreads nothing and the figure is one joist's own deflection.
 */
function pointDeflectionMm(EI: number, spanMm: number, centresMm: number, deckEiPerMm: number): number {
  if (spanMm <= 0 || EI <= 0) return Infinity;
  const single = (POINT_LOAD_N * spanMm ** 3) / (48 * EI);
  return single / spreadJoists(EI, spanMm, centresMm, deckEiPerMm);
}

/** The joists a midspan point load is shared over, at least one. */
export function spreadJoists(EI: number, spanMm: number, centresMm: number, deckEiPerMm: number): number {
  if (deckEiPerMm <= 0 || centresMm <= 0 || EI <= 0) return 1;
  // Per metre of width: the joists' own stiffness is one joist's EI over its
  // centres, the deck's is its 1 mm strip stiffness over 1 mm.
  const joistPerMm = EI / centresMm;
  const widthMm = SPREAD_WIDTH_FACTOR * spanMm * Math.pow(deckEiPerMm / joistPerMm, 0.25);
  return Math.max(1, Math.min(SPREAD_JOISTS_MAX, widthMm / centresMm));
}

export function checkComfort(i: ComfortInput): ComfortCheck {
  const { spanMm, centresMm, section, e0mean, massKgM2, deckEiPerMm = 0, minHz, maxPointMm } = i;
  const { w, d } = section;
  const I = (w * d * d * d) / 12;
  const EI = e0mean * I;

  const hzOk = spanMm > 0 && EI > 0 && massKgM2 > 0 && centresMm > 0;
  const hz = hzOk ? frequencyHz(EI, massKgM2, centresMm, spanMm) : 0;

  const pointOk = spanMm > 0 && EI > 0;
  const pointMm = pointOk ? pointDeflectionMm(EI, spanMm, centresMm, deckEiPerMm) : Infinity;

  // Utilisation runs the opposite way for the two criteria -- higher is
  // better for frequency, lower is better for deflection -- so both are
  // normalised to "share of the limit used up" (minHz/hz, pointMm/maxPointMm)
  // before comparing which one governs.
  const freqUtil = hzOk && minHz > 0 ? minHz / hz : null;
  const pointUtil = pointOk && maxPointMm > 0 ? pointMm / maxPointMm : null;

  let governing: ComfortCheck["governing"] = null;
  if (freqUtil !== null && pointUtil !== null) governing = freqUtil >= pointUtil ? "frequency" : "point";
  else if (freqUtil !== null) governing = "frequency";
  else if (pointUtil !== null) governing = "point";

  const freqPasses = freqUtil === null || freqUtil <= 1;
  const pointPasses = pointUtil === null || pointUtil <= 1;
  const passes = governing !== null && freqPasses && pointPasses;

  return { hz, minHz, pointMm, maxPointMm, passes, governing };
}
