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
// simply supported span under a uniformly distributed load, optionally with
// one or more added point loads (issue #64 -- a header's reaction on a
// trimmer; a trimmer beside an interior hole carries two, one from each
// header, superposed), and explicitly excludes every other continuous or
// cantilevered span, lateral-torsional stability, vibration, notches,
// bearing stress, connections and fire.
//
// An off-centre point load's own maximum moment and deflection do not sit
// at the load itself or at midspan -- the true maximum of the COMBINED (UDL
// plus every point load, superposed) curve can fall anywhere between them,
// and with two point loads there is no single closed form worth solving for.
// Both curves are instead sampled at a fine, even mesh across the span (plus
// every load's own position and midspan, so those analytically exact points
// are never missed by the grid) and the largest sampled value is taken. Both
// curves are smooth (a downward parabola in pieces for moment, a piecewise
// cubic for deflection), so a few hundred samples find the true maximum to
// well under engineering precision; this is verified in tests/timber.test.ts
// against hand-worked one- and two-point-load cases.

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
  /**
   * Point loads on the span, N, and where each stands, mm from the near
   * support -- a header's reaction landing on a trimmer (issue #64). Each
   * carries its own design (factored, `nd`) and characteristic (unfactored,
   * `nk`) figure, exactly as the UDL's qdNmm/qkNmm are split: `nd` feeds the
   * moment and shear, `nk` the (creep-factored) deflection. EVERY entry
   * superposes -- a trimmer beside a hole with a header at both ends carries
   * both headers' reactions AT ONCE, which is the ordinary case, not the
   * worse of the two considered separately. Absent or empty is the ordinary
   * UDL-only span; every existing test must pass unchanged.
   */
  points?: { nd: number; nk: number; atMm: number }[];
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

/** Even samples across the span, plus every load's own position and midspan
 *  so those analytically exact points are hit regardless of where the grid
 *  falls -- see the module header. */
const SPAN_SAMPLES = 400;

function sampleXs(L: number, ats: readonly number[]): number[] {
  const xs: number[] = [];
  for (let k = 0; k <= SPAN_SAMPLES; k++) xs.push((L * k) / SPAN_SAMPLES);
  xs.push(L / 2);
  for (const a of ats) xs.push(Math.max(0, Math.min(L, a)));
  return xs;
}

/** UDL moment at x: q·x·(L-x)/2 -- qL²/8 at x = L/2. */
function udlMomentAt(q: number, L: number, x: number): number {
  return (q * x * (L - x)) / 2;
}

/** A point load P at a (b = L-a): moment at x, standard simply-supported
 *  beam formula, piecewise about the load. */
function pointMomentAt(P: number, a: number, b: number, L: number, x: number): number {
  return x <= a ? (P * b * x) / L : (P * a * (L - x)) / L;
}

/** UDL deflection at x (Roark's beam formulas) -- (5qL⁴)/(384EI) at
 *  x = L/2, matching the pre-#64 midspan-only formula exactly. */
function udlDeflectionAt(q: number, E: number, I: number, L: number, x: number): number {
  return (q * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * E * I);
}

/** A point load P at a (b = L-a): deflection at x, standard simply-supported
 *  beam formula, piecewise about the load -- continuous at x = a, where both
 *  branches equal P·a²·b²/(3·L·E·I), the textbook "deflection under the
 *  load" figure. */
function pointDeflectionAt(P: number, a: number, b: number, L: number, E: number, I: number, x: number): number {
  return x <= a
    ? (P * b * x * (L * L - b * b - x * x)) / (6 * L * E * I)
    : (P * a * (L - x) * (2 * L * x - a * a - x * x)) / (6 * L * E * I);
}

/**
 * M = qL²/8, V = qL/2, extended by zero or more point loads, each at its own
 * `atMm` (a, with b = L-a). Every point load superposes: the moment and
 * deflection curves are the UDL curve plus the SUM of every point load's own
 * curve, and the maximum of that combined curve -- found by sampling (module
 * header), never assumed to sit at a load or at midspan -- is what governs.
 * Design (`nd`) feeds moment and shear; characteristic (`nk`) feeds
 * deflection, exactly like the UDL's own qd/qk.
 *
 * Shear: the two support reactions are R1 = qd·L/2 + Σ(nd·b/L) (near) and
 * R2 = qd·L/2 + Σ(nd·a/L) (far); since V runs monotonically from R1 down to
 * -R2 as x crosses the span (a step down at each point load, sloping down
 * qd elsewhere), its largest magnitude is always at one end -- V = max(R1,
 * R2). With one point load this is the familiar qd·L/2 + P·max(a,b)/L.
 *
 * Bending σ = M/W against f_m,d = kmod·fmk/γM. Shear τ = 1.5V/A against
 * f_v,d = kmod·fvk/γM (rectangular section shear-stress factor). Deflection
 * w_fin = (w_udl + Σw_point)·(1 + kdef) against L/deflectionDiv, both w
 * terms the instantaneous (unfactored) figures.
 *
 * With no point loads every sample but x = L/2 evaluates to less than the
 * midspan value, so this reduces to the plain qL²/8 and 5qkL⁴/384EI exactly
 * -- P = [] is the pre-#64 UDL-only result, bit for bit.
 */
export function checkSpan(i: SpanInput): SpanCheck {
  const { spanMm: L, qdNmm: qd, qkNmm: qk, section, material, deflectionDiv, points } = i;
  const { w, d } = section;
  const W = (w * d * d) / 6;
  const I = (w * d * d * d) / 12;
  const A = w * d;

  const pts = (points ?? []).map(p => {
    const a = Math.max(0, Math.min(L, p.atMm));
    return { nd: p.nd, nk: p.nk, a, b: L - a };
  });

  let momentNmm = 0;
  let wInst = 0;
  for (const x of sampleXs(L, pts.map(p => p.a))) {
    let m = udlMomentAt(qd, L, x);
    for (const p of pts) m += pointMomentAt(p.nd, p.a, p.b, L, x);
    momentNmm = Math.max(momentNmm, m);
    if (I > 0) {
      let ww = udlDeflectionAt(qk, material.e0mean, I, L, x);
      for (const p of pts) ww += pointDeflectionAt(p.nk, p.a, p.b, L, material.e0mean, I, x);
      wInst = Math.max(wInst, ww);
    }
  }
  if (I <= 0) wInst = Infinity;

  let r1 = (qd * L) / 2, r2 = (qd * L) / 2;
  for (const p of pts) { r1 += (p.nd * p.b) / L; r2 += (p.nd * p.a) / L; }
  const shearN = Math.max(r1, r2);

  const fmd = (material.kmod * material.fmk) / material.gammaM;
  const fvd = (material.kmod * material.fvk) / material.gammaM;
  const bending = W > 0 ? momentNmm / W / fmd : Infinity;
  const shear = A > 0 ? (1.5 * shearN) / A / fvd : Infinity;

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
