// Roof planes proposed from what is already drawn, so stating a roof is not
// double entry against the walls' own top profiles (model/profile.ts) in the
// common case. A proposal only -- the panel shows it and writes it, or not,
// in one mutation; nothing here touches the document.
//
// Three rules, tried in order (see the model decision in issue #57):
//   1. Two gable walls (a wall whose top profile is a single interior peak)
//      that agree with each other and stand opposite one another -> a
//      two-plane zadeldak, ridge between their peaks.
//   2. A wall whose top rises monotonically end to end (a lean-to wall) ->
//      one plane, eave on the low side.
//   3. Neither -> one flat plane over the storey's own outline, at storey
//      height. Also reached when gable walls are found but disagree, with a
//      reason string explaining why.
import { Floor, Wall, findNode, floorHeight, newId } from "../model/doc";
import { RoofPlane, ROOF_PITCH_MIN, ROOF_PITCH_MAX } from "../model/roof";
import { wallLength } from "../model/ops";
import { wallTopAt, wallTopPolyline } from "../model/profile";
import { outerBoundary } from "./rooms";
import {
  Vec, v, add, sub, scale, dot, cross, dist, norm, perp, polygonArea, clipHalfPlane,
} from "../geometry/vec";
import { arcPointAt } from "../geometry/arc";

const DEG = Math.PI / 180;

export interface RoofSuggestion {
  planes: RoofPlane[];
  basis: "gable" | "leanTo" | "flat";
  /** Why rule 1 or 2 could not be used, when a flatter rule was reached
   *  despite sloped walls being present. A key the caller words (i18n's
   *  roof.note*), not a sentence: core states the reason, the panel says it.
   *  Absent when rule 3 applies simply because nothing on the floor is
   *  sloped. */
  note?: "gableDisagree";
}

function clampPitchDeg(n: number): number {
  return Math.max(ROOF_PITCH_MIN, Math.min(ROOF_PITCH_MAX, isFinite(n) ? n : 0));
}

/** The storey's own outer boundary, wound counter-clockwise under y-down like
 *  a room -- outerBoundary() itself returns the unbounded face's own winding
 *  (negative shoelace area, see core/rooms.ts), the opposite of what
 *  RoofPlane.outline states. Null when the wall graph encloses nothing. */
function ccwOutline(f: Floor): Vec[] | null {
  const outline = outerBoundary(f);
  if (!outline || outline.length < 3) return null;
  return polygonArea(outline) < 0 ? [...outline].reverse() : outline;
}

function wallWorldPointAt(f: Floor, w: Wall, s: number): Vec {
  const na = findNode(f, w.a), nb = findNode(f, w.b);
  const A = na ? v(na.x, na.y) : v(0, 0), B = nb ? v(nb.x, nb.y) : v(0, 0);
  const L = wallLength(f, w);
  if (L <= 0) return A;
  const t = Math.max(0, Math.min(1, s / L));
  return w.bulge === 0 ? add(A, scale(sub(B, A), t)) : arcPointAt(A, B, w.bulge, t);
}

// ── reading a wall's own profile as a roof-suggesting shape ────────────────

interface GablePeak { s: number; height: number }

/**
 * A gable wall: its top profile, read with the implied ends (model/profile.ts
 * breakpoints), rises then falls with exactly one interior peak strictly
 * above both ends. Null for a flat wall, a lean-to and anything not unimodal.
 */
function gablePeakOf(f: Floor, w: Wall): GablePeak | null {
  const L = wallLength(f, w);
  if (L <= 0) return null;
  const pts = wallTopPolyline(f, w, L);
  if (pts.length < 3) return null;
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1]!.h >= pts[i]!.h) i++;
  const peak = i;
  if (peak === 0 || peak === pts.length - 1) return null; // no interior peak
  while (i + 1 < pts.length && pts[i + 1]!.h <= pts[i]!.h) i++;
  if (i !== pts.length - 1) return null; // not unimodal
  const peakH = pts[peak]!.h;
  const lowH = Math.min(pts[0]!.h, pts[pts.length - 1]!.h);
  if (peakH <= lowH + 1) return null; // flat within rounding: not a gable
  return { s: pts[peak]!.s, height: peakH };
}

/** A gable wall's own ends, when they agree with each other -- the shape
 *  gableProfile() itself always produces. Null on an asymmetric gable (a
 *  knee wall stepping into the slope, say), which this suggester leaves for
 *  the wall's own authored profile rather than guessing an eave for it. */
function symmetricGableEnds(f: Floor, w: Wall): { lowMm: number } | null {
  const L = wallLength(f, w);
  const h0 = wallTopAt(f, w, 0), h1 = wallTopAt(f, w, L);
  return Math.abs(h0 - h1) <= 5 ? { lowMm: (h0 + h1) / 2 } : null;
}

interface LeanTo { lowS: number; lowH: number; highS: number; highH: number }

/** A lean-to wall: its top rises (or falls) monotonically from one end to
 *  the other, by more than rounding. Null for a flat wall or a gable. */
function leanToOf(f: Floor, w: Wall): LeanTo | null {
  const L = wallLength(f, w);
  if (L <= 0) return null;
  const pts = wallTopPolyline(f, w, L);
  if (pts.length < 2) return null;
  let inc = true, dec = true;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]!.h < pts[i - 1]!.h - 1e-6) inc = false;
    if (pts[i]!.h > pts[i - 1]!.h + 1e-6) dec = false;
  }
  if (!inc && !dec) return null;
  const first = pts[0]!, last = pts[pts.length - 1]!;
  if (Math.abs(last.h - first.h) < 1) return null; // flat: not a lean-to
  return inc
    ? { lowS: first.s, lowH: first.h, highS: last.s, highH: last.h }
    : { lowS: last.s, lowH: last.h, highS: first.s, highH: first.h };
}

// ── picking the eave edge of a proposed plane ───────────────────────────────

/**
 * The outline edge farthest from the line through `origin` in `dir`,
 * PARALLEL to `dir` within 5° -- the rule the issue states for picking a
 * proposed plane's eave edge. `origin` need not be the ridge itself; any
 * fixed point gives the same ordering among candidate edges, since shifting
 * it only adds a constant to every edge's measured distance.
 */
function pickEaveEdge(poly: Vec[], origin: Vec, dir: Vec): { idx: number; dist: number } | null {
  const n = poly.length;
  const cosTol = Math.cos(5 * DEG);
  let best: { idx: number; dist: number } | null = null;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const ed = norm(sub(b, a));
    if (Math.hypot(ed.x, ed.y) < 1e-6) continue;
    if (Math.abs(dot(ed, dir)) < cosTol) continue;
    const mid = scale(add(a, b), 0.5);
    const d = Math.abs(cross(dir, sub(mid, origin)));
    if (!best || d > best.dist) best = { idx: i, dist: d };
  }
  return best;
}

// ── rule 1: gable ────────────────────────────────────────────────────────

interface GablePair { a: Wall; peakA: GablePeak; b: Wall; peakB: GablePeak; eaveMm: number }

/** The first pair of gable walls that agree at the peak and at their own
 *  ends, are roughly parallel, and do not share a node (adjacent walls are
 *  a valley or a hip, not opposite gable ends). Null when no pair agrees. */
function bestGablePair(f: Floor, candidates: Array<{ w: Wall; peak: GablePeak }>): GablePair | null {
  const PEAK_TOL_MM = 30, LOW_TOL_MM = 30, PARALLEL_COS = Math.cos(10 * DEG);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const ca = candidates[i]!, cb = candidates[j]!;
      const shared = ca.w.a === cb.w.a || ca.w.a === cb.w.b || ca.w.b === cb.w.a || ca.w.b === cb.w.b;
      if (shared) continue;
      const symA = symmetricGableEnds(f, ca.w), symB = symmetricGableEnds(f, cb.w);
      if (!symA || !symB) continue;
      if (Math.abs(ca.peak.height - cb.peak.height) > PEAK_TOL_MM) continue;
      if (Math.abs(symA.lowMm - symB.lowMm) > LOW_TOL_MM) continue;
      const na = findNode(f, ca.w.a), nbb = findNode(f, ca.w.b);
      const nc = findNode(f, cb.w.a), nd = findNode(f, cb.w.b);
      if (!na || !nbb || !nc || !nd) continue;
      const dirA = norm(sub(v(nbb.x, nbb.y), v(na.x, na.y)));
      const dirB = norm(sub(v(nd.x, nd.y), v(nc.x, nc.y)));
      if (Math.abs(dot(dirA, dirB)) < PARALLEL_COS) continue;
      return { a: ca.w, peakA: ca.peak, b: cb.w, peakB: cb.peak, eaveMm: (symA.lowMm + symB.lowMm) / 2 };
    }
  }
  return null;
}

/** Two planes split from `outline` by the ridge between the pair's peaks,
 *  each eaved on the outline edge farthest from the ridge and parallel to
 *  it (pickEaveEdge). Null when the ridge is degenerate or a half comes out
 *  too thin to carry an eave -- the caller falls back to a flat roof. */
function gablePlanesFrom(f: Floor, outline: Vec[], pair: GablePair): RoofPlane[] | null {
  const pA = wallWorldPointAt(f, pair.a, pair.peakA.s);
  const pB = wallWorldPointAt(f, pair.b, pair.peakB.s);
  if (dist(pA, pB) < 1) return null;
  const ridgeDir = norm(sub(pB, pA));
  const n = perp(ridgeDir);
  const halves = [clipHalfPlane(outline, pA, n), clipHalfPlane(outline, pA, scale(n, -1))];
  const peakHeight = (pair.peakA.height + pair.peakB.height) / 2;
  const planes: RoofPlane[] = [];
  for (const half of halves) {
    if (half.length < 3) return null;
    const picked = pickEaveEdge(half, pA, ridgeDir);
    if (!picked) return null;
    const pitchRad = Math.atan2(Math.max(0, peakHeight - pair.eaveMm), Math.max(1, picked.dist));
    planes.push({
      id: newId("rfp"),
      outline: half.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      eaveEdge: picked.idx,
      eaveMm: Math.round(pair.eaveMm),
      pitchDeg: clampPitchDeg((pitchRad * 180) / Math.PI),
    });
  }
  return planes;
}

// ── rule 2: lean-to ──────────────────────────────────────────────────────

function leanToPlaneFrom(f: Floor, outline: Vec[], w: Wall, lean: LeanTo): RoofPlane | null {
  const lowPt = wallWorldPointAt(f, w, lean.lowS);
  const highPt = wallWorldPointAt(f, w, lean.highS);
  if (dist(lowPt, highPt) < 1) return null;
  const slopeDir = norm(sub(highPt, lowPt));
  const eaveDir = perp(slopeDir);
  const picked = pickEaveEdge(outline, highPt, eaveDir);
  if (!picked) return null;
  const pitchRad = Math.atan2(Math.max(0, lean.highH - lean.lowH), Math.max(1, picked.dist));
  return {
    id: newId("rfp"),
    outline: outline.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    eaveEdge: picked.idx,
    eaveMm: Math.round(lean.lowH),
    pitchDeg: clampPitchDeg((pitchRad * 180) / Math.PI),
  };
}

// ── rule 3: flat ─────────────────────────────────────────────────────────

function flatPlanesOver(f: Floor, outline: Vec[]): RoofPlane[] {
  return [{
    id: newId("rfp"),
    outline: outline.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    eaveEdge: 0,
    eaveMm: Math.round(floorHeight(f)),
    pitchDeg: 0,
  }];
}

// ── the proposal itself ──────────────────────────────────────────────────

/**
 * Roof planes proposed from the walls already drawn. Reported to the panel;
 * writing them into the document is a separate, explicit mutation (Accept).
 */
export function suggestRoof(f: Floor): RoofSuggestion {
  const outline = ccwOutline(f);
  if (!outline) return { planes: [], basis: "flat" };

  const gableCandidates = f.walls
    .map(w => ({ w, peak: gablePeakOf(f, w) }))
    .filter((x): x is { w: Wall; peak: GablePeak } => x.peak !== null);

  if (gableCandidates.length >= 2) {
    const pair = bestGablePair(f, gableCandidates);
    if (pair) {
      const planes = gablePlanesFrom(f, outline, pair);
      if (planes) return { planes, basis: "gable" };
    }
    return {
      planes: flatPlanesOver(f, outline), basis: "flat",
      note: "gableDisagree",
    };
  }

  const leanCandidates = f.walls
    .map(w => ({ w, lean: leanToOf(f, w) }))
    .filter((x): x is { w: Wall; lean: LeanTo } => x.lean !== null);
  if (leanCandidates.length > 0) {
    const best = leanCandidates.reduce((a, b) =>
      (b.lean.highH - b.lean.lowH) > (a.lean.highH - a.lean.lowH) ? b : a);
    const plane = leanToPlaneFrom(f, outline, best.w, best.lean);
    if (plane) return { planes: [plane], basis: "leanTo" };
  }

  return { planes: flatPlanesOver(f, outline), basis: "flat" };
}

/** Flat-roof preset: one plane over the storey's own outline, at storey
 *  height, no pitch. Empty when the wall graph encloses nothing. */
export function flatRoof(f: Floor): RoofPlane[] {
  const outline = ccwOutline(f);
  return outline ? flatPlanesOver(f, outline) : [];
}

interface Box2 { x0: number; y0: number; x1: number; y1: number }

function boundingBoxOf(poly: Vec[]): Box2 {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** Gable-roof preset: two planes, ridge along the LONGER side of the
 *  outline's own bounding box, eave at storey height, `pitchDeg` on both
 *  sides. Empty when the wall graph encloses nothing or a half comes out
 *  too thin to carry an eave. */
export function gableRoof(f: Floor, pitchDeg: number): RoofPlane[] {
  const outline = ccwOutline(f);
  if (!outline) return [];
  const box = boundingBoxOf(outline);
  const wide = box.x1 - box.x0 >= box.y1 - box.y0;
  const ridgeOrigin = v((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
  const ridgeDir = wide ? v(1, 0) : v(0, 1);
  const n = perp(ridgeDir);
  const eaveMm = Math.round(floorHeight(f));
  const pitch = clampPitchDeg(pitchDeg);
  const planes: RoofPlane[] = [];
  for (const half of [clipHalfPlane(outline, ridgeOrigin, n), clipHalfPlane(outline, ridgeOrigin, scale(n, -1))]) {
    if (half.length < 3) continue;
    const picked = pickEaveEdge(half, ridgeOrigin, ridgeDir);
    if (!picked) continue;
    planes.push({
      id: newId("rfp"),
      outline: half.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      eaveEdge: picked.idx,
      eaveMm,
      pitchDeg: pitch,
    });
  }
  return planes;
}
