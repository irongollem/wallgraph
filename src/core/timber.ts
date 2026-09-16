// Preliminary structural check for one simply supported member under a
// uniformly distributed load -- the calculation applied three ways by
// core/checks.ts (a deck's joists, a placed beam, an opening's lintel).
//
// Pure and unit-agnostic about the document: every input here is already in
// N, mm and N/mm², and every caller (core/checks.ts) is where a deck, a beam
// or an opening's authored figures become one of these. Two sibling
// functions rather than one, because a timber and a steel section are
// checked against genuinely different material behaviour (kmod/gammaM/kdef
// and a rectangular section on one side, a catalogue Wy/Iy and no creep term
// on the other) even though both report the same SpanCheck shape.
//
// Standards policy (issue #36 / #46): the equations below -- M = qL²/8,
// V = qL/2, W = wd²/6, I = wd³/12, bending/shear/deflection against a
// factored resistance -- are public engineering equations. No NEN-EN text,
// table or coefficient is embedded as "the standard"; every material figure
// and partial factor is a document assumption (model/materials.ts) that a
// named preset fills in, editable and marked indicative. This is a
// PRELIMINARY design check, not a constructieberekening: it assumes a single
// simply supported span under a uniformly distributed load and explicitly
// excludes point loads, continuous or cantilevered spans, lateral-torsional
// stability, vibration, notches, bearing stress, connections and fire.

export interface SpanInput {
  /** Clear span, mm. */
  spanMm: number;
  /**
   * Design line load, N/mm, already factored: gammaG·g + gammaQ·q over the
   * member's load width.
   */
  qdNmm: number;
  /** Characteristic (unfactored) line load for deflection, N/mm. */
  qkNmm: number;
  /** Rectangular section, mm: `d` is the bending-direction depth. */
  section: { w: number; d: number };
  material: {
    /** Characteristic bending strength, N/mm². */
    fmk: number;
    /** Characteristic shear strength, N/mm². */
    fvk: number;
    /** Mean modulus of elasticity, N/mm². */
    e0mean: number;
    /** Load-duration/service-class modification factor. */
    kmod: number;
    /** Material partial factor. */
    gammaM: number;
    /** Creep factor. */
    kdef: number;
  };
  /** Deflection limit as a span fraction: 250 means L/250. */
  deflectionDiv: number;
}

export interface SpanCheck {
  momentNmm: number;
  shearN: number;
  /** Utilisations, 1.0 = at the limit. */
  bending: number;
  shear: number;
  deflection: number;
  governing: "bending" | "shear" | "deflection";
  deflectionMm: number;
  limitMm: number;
  passes: boolean;
}

function governingOf(bending: number, shear: number, deflection: number): SpanCheck["governing"] {
  if (bending >= shear && bending >= deflection) return "bending";
  return shear >= deflection ? "shear" : "deflection";
}

/**
 * M = qL²/8, V = qL/2. Bending σ = M/W against f_m,d = kmod·fmk/γM. Shear
 * τ = 1.5V/A against f_v,d = kmod·fvk/γM (rectangular section shear-stress
 * factor). Deflection w_fin = (5·qk·L⁴ / (384·E·I))·(1 + kdef) against
 * L/deflectionDiv.
 */
export function checkSpan(i: SpanInput): SpanCheck {
  const { spanMm: L, qdNmm: qd, qkNmm: qk, section, material, deflectionDiv } = i;
  const { w, d } = section;
  const W = (w * d * d) / 6;
  const I = (w * d * d * d) / 12;
  const A = w * d;

  const momentNmm = (qd * L * L) / 8;
  const shearN = (qd * L) / 2;

  const fmd = (material.kmod * material.fmk) / material.gammaM;
  const fvd = (material.kmod * material.fvk) / material.gammaM;
  const bending = W > 0 ? momentNmm / W / fmd : Infinity;
  const shear = A > 0 ? (1.5 * shearN) / A / fvd : Infinity;

  const wInst = I > 0 ? (5 * qk * L ** 4) / (384 * material.e0mean * I) : Infinity;
  const deflectionMm = wInst * (1 + material.kdef);
  const limitMm = deflectionDiv > 0 ? L / deflectionDiv : 0;
  const deflection = limitMm > 0 ? deflectionMm / limitMm : Infinity;

  const governing = governingOf(bending, shear, deflection);
  const passes = bending <= 1 && shear <= 1 && deflection <= 1;
  return { momentNmm, shearN, bending, shear, deflection, governing, deflectionMm, limitMm, passes };
}

/**
 * The LEAST TIMBER that passes: of every section in `sections` that passes,
 * the one with the smallest cross-section, ties going to the shallower.
 * Ordering the list by depth alone would propose a 71 x 196 where a 44 x 220
 * passes on a third less timber, which is not what anyone orders; a builder
 * who needs the shallower section states it and reads the check instead.
 * Null when none passes.
 */
export function proposeSection(
  i: Omit<SpanInput, "section">,
  sections: readonly { w: number; d: number }[],
): { w: number; d: number } | null {
  let best: { w: number; d: number } | null = null;
  for (const section of sections) {
    if (!checkSpan({ ...i, section }).passes) continue;
    const area = section.w * section.d;
    if (!best || area < best.w * best.d || (area === best.w * best.d && section.d < best.d)) {
      best = { w: section.w, d: section.d };
    }
  }
  return best;
}

/** A steel beam's stiffness, read off a catalogue profile rather than a
 *  rectangular section: `wyMm3`/`iyMm4` are STEEL_PROFILES's `wy`/`iy`
 *  (cm³/cm⁴) converted to mm³/mm⁴ by the caller (core/checks.ts). */
export interface SteelSpanInput {
  spanMm: number;
  qdNmm: number;
  qkNmm: number;
  wyMm3: number;
  iyMm4: number;
  /** Yield strength, N/mm². */
  fy: number;
  deflectionDiv: number;
}

/** Modulus of elasticity of structural steel, N/mm². */
export const STEEL_E_MPA = 210000;

/**
 * Steel beam, bending only: σ = M/Wy against fy. Deflection with E = 210000,
 * no creep term -- steel does not creep the way timber does. Shear is
 * reported (V = qL/2) but not checked against the section: web shear
 * buckling and crippling are outside a preliminary hand check and are named
 * in the excluded list beside the result, so `shear` reads 0 and never
 * governs.
 */
export function checkSteelSpan(i: SteelSpanInput): SpanCheck {
  const { spanMm: L, qdNmm: qd, qkNmm: qk, wyMm3, iyMm4, fy, deflectionDiv } = i;
  const momentNmm = (qd * L * L) / 8;
  const shearN = (qd * L) / 2;

  const bending = wyMm3 > 0 ? momentNmm / wyMm3 / fy : Infinity;

  const deflectionMm = iyMm4 > 0 ? (5 * qk * L ** 4) / (384 * STEEL_E_MPA * iyMm4) : Infinity;
  const limitMm = deflectionDiv > 0 ? L / deflectionDiv : 0;
  const deflection = limitMm > 0 ? deflectionMm / limitMm : Infinity;

  const governing: SpanCheck["governing"] = bending >= deflection ? "bending" : "deflection";
  const passes = bending <= 1 && deflection <= 1;
  return { momentNmm, shearN, bending, shear: 0, deflection, governing, deflectionMm, limitMm, passes };
}
