// A wall's top profile: heights along its centerline, for a wall under a
// pitched roof. `Wall.profile` states points; this is where "what lies
// between and beyond them" turns into numbers.
//
// The wall's own ends (t = 0 and t = L) anchor at `wallHeight()` wherever the
// profile states no point there -- a single point at the ridge is enough to
// describe a gable, because the eaves are implied rather than repeated. This
// is what makes gableProfile() below a ONE-point preset: the low ends come
// from wallHeight(), not from a second and third point. Between and beyond
// the resulting breakpoints the top is linear, then flat.
//
// Pure and uncached, like the rest of model/. Nothing here changes the plan:
// the wall graph, room detection and every consumer outside this phase keep
// reading wallHeight().
import { Floor, Wall, ProfilePoint, wallHeight } from "./doc";
import { wallLength } from "./ops";

/** A stated or implied height at a distance from node a, mm. */
interface Breakpoint { t: number; h: number }

/**
 * The wall's top as breakpoints over [0, L]: the stated points, sorted and
 * deduplicated by `t` (last write at a given `t` wins), with an implied point
 * at 0 and/or at L holding `wallHeight()` wherever the profile does not state
 * one there itself.
 *
 * A point outside [0, L] -- a stale `t` left over from a wall that has since
 * shrunk, say, since nothing else in this module enforces the stored value is
 * clean -- would otherwise extend the domain a caller integrates or ranges
 * over. It is dropped, but not silently: `heightAt()` against the full,
 * unclamped list gives the height its own interpolation implies exactly at
 * the boundary it overshoots, and that height -- not the point itself -- is
 * kept in its place.
 */
function breakpoints(f: Floor, w: Wall, L: number): Breakpoint[] {
  const byT = new Map<number, number>();
  for (const p of w.profile ?? []) byT.set(p.t, p.height);
  const all = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, h]) => ({ t, h }));
  if (all.length === 0) return [{ t: 0, h: wallHeight(f, w) }, { t: L, h: wallHeight(f, w) }];
  const stated = all.filter(p => p.t >= 0 && p.t <= L);
  if (all[0]!.t < 0 && !stated.some(p => p.t === 0)) stated.unshift({ t: 0, h: heightAt(all, 0) });
  if (all[all.length - 1]!.t > L && !stated.some(p => p.t === L)) stated.push({ t: L, h: heightAt(all, L) });
  stated.sort((a, b) => a.t - b.t);
  if (stated.length === 0) return [{ t: 0, h: wallHeight(f, w) }, { t: L, h: wallHeight(f, w) }];
  const pts = [...stated];
  if (pts[0]!.t > 0) pts.unshift({ t: 0, h: wallHeight(f, w) });
  if (pts[pts.length - 1]!.t < L) pts.push({ t: L, h: wallHeight(f, w) });
  return pts;
}

/** Linear interpolation over a sorted, non-empty breakpoint list; flat before
 *  the first and after the last (only reachable for `s` outside [0, L]). */
function heightAt(pts: readonly Breakpoint[], s: number): number {
  const first = pts[0]!, last = pts[pts.length - 1]!;
  if (s <= first.t) return first.h;
  if (s >= last.t) return last.h;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i]!, p1 = pts[i + 1]!;
    if (s <= p1.t) {
      if (p1.t === p0.t) return p1.h;
      const frac = (s - p0.t) / (p1.t - p0.t);
      return p0.h + frac * (p1.h - p0.h);
    }
  }
  return last.h;
}

/** Height of the wall's top at `s` mm from node a. Linear between points,
 *  flat beyond the wall's own ends. */
export function wallTopAt(f: Floor, w: Wall, s: number): number {
  return heightAt(breakpoints(f, w, wallLength(f, w)), s);
}

/** The top as a polyline over [0, L]: (s, height) pairs, including s = 0 and
 *  s = L, sorted, no duplicates. */
export function wallTopPolyline(f: Floor, w: Wall, L: number): { s: number; h: number }[] {
  return breakpoints(f, w, L).map(p => ({ s: p.t, h: p.h }));
}

/** Highest and lowest point of the top. Flat walls return wallHeight() for
 *  both -- the extremes of a piecewise-linear function are always at one of
 *  its breakpoints, never strictly between them. */
export function wallTopRange(f: Floor, w: Wall, L: number): { min: number; max: number } {
  const hs = breakpoints(f, w, L).map(p => p.h);
  return { min: Math.min(...hs), max: Math.max(...hs) };
}

/** Area under the top over [s0, s1], mm² (trapezoids between breakpoints). */
export function wallAreaUnder(f: Floor, w: Wall, L: number, s0: number, s1: number): number {
  const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  if (hi <= lo) return 0;
  const pts = breakpoints(f, w, L);
  const stops = [...new Set([lo, hi, ...pts.map(p => p.t).filter(t => t > lo && t < hi)])]
    .sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    area += (heightAt(pts, a) + heightAt(pts, b)) / 2 * (b - a);
  }
  return area;
}

export const PROFILE_HEIGHT_MIN = 100;
export const PROFILE_HEIGHT_MAX = 20000;

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(isFinite(n) ? n : lo)));
}

/**
 * Clamp a wall's profile in place: `t` into [0, L], height into
 * [PROFILE_HEIGHT_MIN, PROFILE_HEIGHT_MAX], sorted by `t`, integer,
 * duplicates at one `t` collapsed (last write wins). Mirrors clampOpening(),
 * called wherever that is after a geometry change. A no-op on a wall with no
 * profile.
 */
export function clampProfile(f: Floor, w: Wall): void {
  if (!w.profile || w.profile.length === 0) return;
  // Math.floor(), not the raw (possibly fractional) length -- a diagonal or
  // arc-length wall's L is rarely a whole mm, and clamping to it directly
  // would let a point past the floor land on that fractional value instead
  // of being rounded, breaking invariant 1.
  const L = Math.floor(wallLength(f, w));
  const byT = new Map<number, number>();
  for (const p of w.profile) {
    byT.set(clampInt(p.t, 0, L), clampInt(p.height, PROFILE_HEIGHT_MIN, PROFILE_HEIGHT_MAX));
  }
  w.profile = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, height]) => ({ t, height }));
}

// ── panel presets ────────────────────────────────────────────────────────
//
// Small pure helpers so the panel does not re-derive them. Each returns data
// for the caller to write into `w.profile` (and clampProfile() afterwards);
// none mutates the wall.

/** The one-point gable: a ridge at the midpoint, wallHeight() + 1000 high.
 *  The eaves are not stated -- they come from wallHeight() at the ends. */
export function gableProfile(f: Floor, w: Wall, L: number): ProfilePoint[] {
  return [{ t: Math.round(L / 2), height: wallHeight(f, w) + 1000 }];
}

/** The lean-to: flat at wallHeight() at the a end, wallHeight() + 1000 at
 *  the b end. */
export function leanToProfile(f: Floor, w: Wall, L: number): ProfilePoint[] {
  const h = wallHeight(f, w);
  return [{ t: 0, height: h }, { t: L, height: h + 1000 }];
}

/**
 * Where "add point" lands: the midpoint of the widest gap in [0, L] between
 * the wall's current points (including the implied 0 and L), at the top's own
 * interpolated height there -- so a new point starts exactly on the existing
 * shape rather than kinking it.
 */
export function addProfilePoint(f: Floor, w: Wall, L: number): ProfilePoint {
  const ts = (w.profile ?? []).map(p => p.t).filter(t => t >= 0 && t <= L);
  const stops = [...new Set([0, L, ...ts])].sort((a, b) => a - b);
  let bestGap = -1, bestMid = Math.round(L / 2);
  for (let i = 0; i + 1 < stops.length; i++) {
    const gap = stops[i + 1]! - stops[i]!;
    if (gap > bestGap) { bestGap = gap; bestMid = Math.round((stops[i]! + stops[i + 1]!) / 2); }
  }
  return { t: bestMid, height: Math.round(wallTopAt(f, w, bestMid)) };
}

// ── stacked frames: frame breaks ────────────────────────────────────────
//
// A break is a HEIGHT above the floor, not a position along the wall, so it
// carries across a split or a merge unchanged the way `height` itself does
// -- see model/ops.ts's splitWall() and core/join.ts's mergeThrough(). Only
// its range depends on the wall's own geometry (the top profile), which is
// why the clamp lives here beside clampProfile() rather than as a bare
// clampInt in doc.ts.

/** Margin kept between a break and the floor, and between a break and the
 *  wall's own highest point -- enough for a post width either side, so a
 *  band is never asked to carry a stud of zero or negative length. */
export const FRAME_BREAK_MARGIN_MM = 200;

/**
 * Clamp a wall's frame breaks in place: integer mm, ascending, deduplicated,
 * each kept `FRAME_BREAK_MARGIN_MM` clear of the floor and of the wall's own
 * highest point (`wallTopRange().max`) -- a break may stand ABOVE the
 * profile's lowest point (a gable's eaves, say): the band above it then
 * simply has no members over the span where the profile dips below it (see
 * frameLayout()), which is reported rather than refused. Mirrors
 * clampProfile(); a no-op on a wall with no breaks.
 */
export function clampFrameBreaks(f: Floor, w: Wall): void {
  if (!w.frameBreaksMm || w.frameBreaksMm.length === 0) return;
  const L = wallLength(f, w);
  const top = wallTopRange(f, w, L).max;
  const lo = FRAME_BREAK_MARGIN_MM;
  const hi = Math.max(lo + 1, top - FRAME_BREAK_MARGIN_MM);
  const set = new Set<number>();
  for (const b of w.frameBreaksMm) set.add(clampInt(b, lo, hi));
  const cleaned = [...set].sort((a, b) => a - b);
  if (cleaned.length > 0) w.frameBreaksMm = cleaned; else delete w.frameBreaksMm;
}

/**
 * Where "add break" lands: the middle of the wall's own lowest top (the
 * eaves height on a gable, the wall height on a flat wall), rounded to 10 mm
 * -- so the default sits comfortably under the profile everywhere rather
 * than risking the margin clampFrameBreaks() enforces at the top.
 */
export function defaultFrameBreak(f: Floor, w: Wall, L: number): number {
  const min = wallTopRange(f, w, L).min;
  return Math.round(min / 2 / 10) * 10;
}
