// One framed wall's members placed in the wall's own plane. The takeoff
// (core/materials.ts) counts this layout and the elevation (render/frame.ts)
// draws it, so the drawing and the order cannot disagree.
import type { Floor, Id, Opening, Wall } from "../model/doc";
import {
  isBlockMaterial, isFramedMaterial, openingHeight, openingSill, wallPostMm, wallPostWidthMm, postLayoutOf,
} from "../model/doc";
import { wallTopAt, wallTopPolyline, wallTopRange } from "../model/profile";
import type { MemberName } from "./materials";
import { postBays, postPositions, type ResolvedWall, type WallRun } from "./resolve";
import { arcTangentAt } from "../geometry/arc";
import { dot, scale, v, type Vec } from "../geometry/vec";

export interface PlacedMember {
  name: MemberName;
  /** Rectangle in the wall's own plane, mm: x along the frame from the a end, y up from the floor. */
  x: number; y: number; w: number; h: number;
  sectionMm: { w: number; d: number };
  /** Cut length, mm: the rectangle's long side, or the slope length for a raked plate. */
  lengthMm: number;
  /** Pieces this rectangle stands for: 2 for a header, 1 otherwise. */
  count: number;
  spliceable: boolean;
  /**
   * Δheight/Δx for a member under a sloped top. Absent means flat (level).
   *
   * A raked top plate (name plate/rail) is a full parallelogram: both its top
   * and bottom edges run at this slope, `y` being the height at the LEFT
   * edge (x). Every other member keeps its ordinary flat rectangle -- `h`
   * (and `lengthMm`) are already cut to the HIGHER of its two edges, per
   * frameLayout()'s own rule -- and `slope` is only the extra fact the
   * elevation draws on top of it: a diagonal line across the member's own
   * top showing where the roofline actually crosses, referenced from the
   * rectangle's top-RIGHT corner (x+w, y+h) when slope >= 0 and its top-LEFT
   * corner when slope < 0 -- the corner where the member's ordered length
   * and the profile agree exactly.
   */
  slope?: number;
}

export interface FrameLayout {
  lengthMm: number;
  /** The frame's overall height: the highest point of the top band (its
   *  profile's max, or wallHeight() on a flat wall). Every lower band's own
   *  top is at or below this. */
  heightMm: number;
  /** The wall's top from x = 0 to x = lengthMm, y up from the floor: two
   *  points on a flat wall, one per profile breakpoint on a sloped one. */
  topLine: { x: number; y: number }[];
  members: PlacedMember[];
  /** Openings as holes in the plane: x from the a end, y the sill, w the width, h the opening height. */
  openings: { openingId: Id; x: number; y: number; w: number; h: number }[];
  /**
   * Openings whose sill-to-head range crosses a frame break -- reported, not
   * corrected. The opening is still framed whole, in the band holding its
   * head (see Wall.frameBreaksMm).
   */
  openingsAcrossBreak: Id[];
  /**
   * The smallest number of equal-height breaks over the wall's FULL height
   * (measured at the profile's max, i.e. the worst case) that would let
   * every stud fit the longest stock length -- present only when the
   * CURRENT layout already orders a stud, king or backing stud too long to
   * fit. Reported, never applied: see core/materials.ts's stockLengths().
   */
  suggestedBreaksMm?: number[];
}

/**
 * A framed wall's share of the backing stud(s) standing at each of its own
 * ends -- see computeBacking(). Split by end rather than carried as a single
 * total because the same wall can be the claiming wall at BOTH its ends (an
 * L at one end, a T at the other), and a placed member has to stand beside
 * the right end stud.
 */
export interface WallBacking { a: number; b: number }

const EMPTY_BACKING: WallBacking = { a: 0, b: 0 };

/** ~5 degrees either side of exactly opposite, in cosine terms -- the
 *  tolerance below treats two collinear wall-ends as a straight pass-through
 *  rather than a corner. */
const STRAIGHT_COS = -Math.cos(5 * Math.PI / 180);

/**
 * The backing stud(s) hidden in a corner or T/cross, per node, assigned to
 * exactly one of the framed walls that meet there -- the one with the lowest
 * `id`, so per-wall figures sum to the storey figure without double
 * counting -- and to whichever of ITS OWN ends touches that node, so a
 * placed member can stand beside the right end stud. Only walls stating both
 * a framed material and a post width count toward a node's degree; a block
 * wall meeting a framed one triggers nothing and is not counted.
 *
 * Degree 2: one backing stud (the three-stud corner) unless the two walls'
 * outgoing tangents at the node are within ~5 degrees of exactly opposite --
 * a straight run split into two walls, which resolveFloor() itself treats as
 * a plain pass-through (see its "parallel" miter case) and which needs no
 * extra stud. Degree 3+ (T or cross): two backing studs, no angle check --
 * every branch needs something to nail into regardless of the angle it
 * meets at.
 */
export function computeBacking(f: Floor): Map<Id, WallBacking> {
  const nodePos = new Map<Id, Vec>();
  for (const n of f.nodes) nodePos.set(n.id, v(n.x, n.y));

  const byNode = new Map<Id, { wall: Wall; out: Vec }[]>();
  const addEnd = (nodeId: Id, e: { wall: Wall; out: Vec }): void => {
    const arr = byNode.get(nodeId);
    if (arr) arr.push(e); else byNode.set(nodeId, [e]);
  };
  for (const w of f.walls) {
    if (!isFramedMaterial(w.material) || wallPostWidthMm(w) === undefined) continue;
    const A = nodePos.get(w.a), B = nodePos.get(w.b);
    if (!A || !B) continue;
    addEnd(w.a, { wall: w, out: arcTangentAt(A, B, w.bulge, 0) });
    addEnd(w.b, { wall: w, out: scale(arcTangentAt(A, B, w.bulge, 1), -1) });
  }

  const result = new Map<Id, WallBacking>();
  for (const [nodeId, ends] of byNode) {
    if (ends.length < 2) continue;
    if (ends.length === 2 && dot(ends[0]!.out, ends[1]!.out) <= STRAIGHT_COS) continue;
    const count = ends.length === 2 ? 1 : 2;
    const chosen = ends.reduce((min, e) => (e.wall.id < min.wall.id ? e : min), ends[0]!);
    const end: "a" | "b" = chosen.wall.a === nodeId ? "a" : "b";
    const cur = result.get(chosen.wall.id) ?? { a: 0, b: 0 };
    cur[end] += count;
    result.set(chosen.wall.id, cur);
  }
  return result;
}

/**
 * The equal-bay division of one opening's own span, the same way postBays()
 * divides a run of wall body: `ceil(width / spacing)` bays, rounded before
 * the ceiling so an exact division does not tip into an extra bay. Cripples
 * stand at the interior division points, one fewer than the bay count.
 * Only the "even" postLayout (see Wall.postLayout) uses this -- a "grid" wall's
 * cripples stand at whichever wall-wide grid positions fall inside the
 * opening instead (see layoutWithBacking()'s own cripple placement).
 */
function crippleCount(width: number, spacing: number): number {
  const bays = Math.max(1, Math.ceil(Number((width / spacing).toFixed(6))));
  return bays - 1;
}

// ── stacked frames ──────────────────────────────────────────────────────
//
// A wall with no frameBreaksMm is one band: [0, undefined], "undefined" top
// meaning "follows the profile" -- which is also exactly what a flat wall's
// single band does (the profile is flat at wallHeight() when the wall states
// none), so the general per-band code below reduces to the original
// single-frame layout without a special case for it.

interface Band { bottom: number; top?: number }

/** The wall's bands, bottom to top. Every band but the last has a constant
 *  (flat) top at its break height; the last band's top is undefined,
 *  meaning "follows the profile" -- see frameLayout(). Breaks are expected
 *  pre-clamped (model/profile.ts's clampFrameBreaks()); filtered here again,
 *  defensively, against a document written by something else. */
function bandsOf(w: Wall, topMax: number): Band[] {
  const breaks = [...new Set(w.frameBreaksMm ?? [])]
    .filter(b => Number.isFinite(b) && b > 0 && b < topMax)
    .sort((a, b) => a - b);
  const bands: Band[] = [];
  let bottom = 0;
  for (const b of breaks) {
    if (b <= bottom) continue;
    bands.push({ bottom, top: b });
    bottom = b;
  }
  bands.push({ bottom });
  return bands;
}

/** The band whose range holds a head height: the first band (bottom to top)
 *  whose own top is at or above it, or the last (top) band when none is --
 *  including when the wall has no breaks at all. */
function bandForHead(bands: readonly Band[], head: number): number {
  for (let i = 0; i + 1 < bands.length; i++) {
    if (head <= bands[i]!.top!) return i;
  }
  return bands.length - 1;
}

/**
 * Whether an opening's [sill, head] range reaches into a band's own
 * [bottom, top) span at all -- true for the band bandForHead() assigns it
 * to, and, for an opening that crosses a break, true for every OTHER band
 * its range passes through too (an opening that does not cross a break
 * never overlaps more than the one band its head is in). This is what a
 * band's own runs are cut around -- see bandRunIntervals().
 */
function bandOverlapsOpening(band: Band, o: Opening): boolean {
  const sill = openingSill(o), head = sill + openingHeight(o);
  return sill < (band.top ?? Infinity) && head > band.bottom;
}

/**
 * The solid runs (WallRun[], the shape postPositions() and postsFor() in
 * resolve.ts read) over [0, L] cut around the openings that overlap THIS
 * band -- not every wall opening. Mirrors resolveFloor()'s own cut, applied
 * to a band-specific subset: a window whose head sits in a lower band cuts
 * no run out of a band above it, so that band's studs and noggings run
 * clear across, the same as an unbroken span anywhere else.
 */
function bandRunIntervals(openings: readonly Opening[], L: number): WallRun[] {
  const sorted = [...openings].sort((a, b) => a.t - b.t);
  const intervals: WallRun[] = [];
  let cursor = 0;
  for (const o of sorted) {
    const from = o.t - o.width / 2, to = o.t + o.width / 2;
    if (from > cursor + 1) intervals.push({ from: cursor, to: from });
    cursor = Math.max(cursor, to);
  }
  if (cursor < L - 1) intervals.push({ from: cursor, to: L });
  if (intervals.length === 0) intervals.push({ from: 0, to: L });
  return intervals;
}

/**
 * The higher of a member's own two edges (x and x+width) on the wall's top,
 * OR of any profile breakpoint strictly inside that span (a ridge or valley
 * vertex the member straddles, which stands higher than both edges) -- and
 * the slope between the two edges, undefined where they agree, which is
 * what keeps a flat run's members free of a `slope` field entirely (see
 * PlacedMember.slope). Shared by every full-height member (stud, king,
 * backing, cripple): each is cut to its own highest point so nothing is
 * ever ordered short of the roofline crossing its width.
 */
function edgeTop(f: Floor, w: Wall, x: number, width: number): { hi: number; slope?: number } {
  if (width <= 0) return { hi: wallTopAt(f, w, x) };
  const tl = wallTopAt(f, w, x), tr = wallTopAt(f, w, x + width);
  let hi = Math.max(tl, tr);
  for (const p of wallTopPolyline(f, w, x + width)) {
    if (p.s > x && p.s < x + width) hi = Math.max(hi, p.h);
  }
  return { hi, slope: tl === tr ? undefined : (tr - tl) / width };
}

/** The wall's top polyline no higher than `cap`, with a point inserted
 *  wherever it crosses the cap. Unchanged when `cap` is undefined. */
function cappedTop(poly: { s: number; h: number }[], cap: number | undefined): { s: number; h: number }[] {
  if (cap === undefined) return poly;
  const out: { s: number; h: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const prev = poly[i - 1];
    if (prev && (prev.h - cap) * (p.h - cap) < 0) {
      out.push({ s: prev.s + (cap - prev.h) / (p.h - prev.h) * (p.s - prev.s), h: cap });
    }
    out.push({ s: p.s, h: Math.min(p.h, cap) });
  }
  return out;
}

/** The spans along the wall where its top is at or above `level`, clamped to
 *  [0, Lf]. A band's bottom plate runs only there: beyond them the top leaves
 *  no room for the band's two plates. */
function spansAbove(poly: readonly { s: number; h: number }[], level: number, Lf: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const prev = poly[i - 1];
    if (prev && (prev.h - level) * (p.h - level) < 0) {
      const x = prev.s + (level - prev.h) / (p.h - prev.h) * (p.s - prev.s);
      if (start === null) start = x; else { out.push({ from: start, to: x }); start = null; }
    }
    if (p.h >= level && start === null) start = p.s;
    if (p.h < level && start !== null && !(prev && (prev.h - level) * (p.h - level) < 0)) {
      out.push({ from: start, to: prev ? prev.s : p.s }); start = null;
    }
  }
  if (start !== null) out.push({ from: start, to: poly[poly.length - 1]!.s });
  return out
    .map(r => ({ from: Math.max(0, Math.min(Lf, r.from)), to: Math.max(0, Math.min(Lf, r.to)) }))
    .filter(r => r.to - r.from >= 1);
}

/**
 * The top band's own top plate: one member per straight segment of the
 * profile, clipped to the span where the top band actually exists (its top
 * above `bandBottom` -- see the module doc comment on bandsOf()). Length is
 * along the slope, rounded UP so nothing is ordered short; a flat segment
 * (including a flat wall's single implied one) carries no `slope` and
 * reduces to the plain flat plate frameLayout() has always cut.
 */
function rakedTopPlateSegments(
  f: Floor, w: Wall, L: number, Lf: number, bandBottom: number, pw: number,
  plateName: MemberName, section: { w: number; d: number }, cap?: number,
): PlacedMember[] {
  const poly = cappedTop(wallTopPolyline(f, w, L), cap);
  // The plate's underside rests on the band's bottom plate, so it starts
  // where the top clears that plate and its own depth.
  const clip = bandBottom + 2 * pw;
  const out: PlacedMember[] = [];
  for (let i = 0; i + 1 < poly.length; i++) {
    let s0 = poly[i]!.s, h0 = poly[i]!.h;
    let s1 = poly[i + 1]!.s, h1 = poly[i + 1]!.h;
    if (s1 <= s0) continue;
    if (h0 <= clip && h1 <= clip) continue; // no room for the band's plates over this span
    if (h0 < clip) {
      const frac = (clip - h0) / (h1 - h0);
      s0 = s0 + frac * (s1 - s0); h0 = clip;
    } else if (h1 < clip) {
      const frac = (clip - h0) / (h1 - h0);
      s1 = s0 + frac * (s1 - s0); h1 = clip;
    }
    const x = Math.max(0, Math.min(Lf, s0));
    const x1 = Math.max(0, Math.min(Lf, s1));
    const width = x1 - x;
    if (width < 1) continue;
    const slope = h1 === h0 ? undefined : (h1 - h0) / (s1 - s0);
    out.push({
      name: plateName, x, y: h0 - pw, w: width, h: pw,
      sectionMm: section, lengthMm: Math.ceil(Math.hypot(s1 - s0, h1 - h0)),
      count: 1, spliceable: true, slope,
    });
  }
  return out;
}

/**
 * The smallest number of equal-height bands over the wall's full height
 * (measured to the profile's max, the worst case) whose studs all fit
 * `maxStockMm` -- see FrameLayout.suggestedBreaksMm. Undefined once a single
 * frame already fits, or where there is no stock to fit against.
 */
function suggestBreaks(topMax: number, pw: number, maxStockMm: number): number[] | undefined {
  if (!isFinite(maxStockMm) || maxStockMm <= 0) return undefined;
  const fits = (n: number): boolean => topMax / n - 2 * pw <= maxStockMm;
  let n = 1;
  while (n < 1000 && !fits(n)) n++;
  if (n <= 1) return undefined;
  const out: number[] = [];
  for (let i = 1; i < n; i++) out.push(Math.floor(topMax * i / n));
  return out;
}

/**
 * One framed wall's members, placed in the wall's own plane (x along the
 * frame from the a end, y up from the floor), plus its openings as holes in
 * that plane. Null unless the wall is framed with a stated post width --
 * a frame at these centres exists, but its member sizes do not.
 *
 * `x`/`y` positions use the centerline distances the document stores (t for
 * an opening, postPositions() for a stud) directly against
 * the frame length `lengthMm` (the mean of the two mitered faces, same as
 * core/materials.ts's own WallTakeoff.lengthMm) -- the two differ only where
 * a mitered face runs long or short at the wall's ends, which is exactly
 * where every rectangle here is clamped back into [0, lengthMm]. The wall's
 * top profile (model/profile.ts) is read the same way: a profile point's `t`
 * and a member's `x` are the same centerline mm, so `wallTopAt(f, w, x)`
 * reads directly off a member's own frame position.
 *
 * The bottom plate is drawn as one continuous rectangle even under a
 * sill-less door: a real bottom plate stands first and is cut away for the
 * threshold afterwards, so the takeoff counts the continuous piece rather
 * than two short ones either side of the doorway.
 *
 * A wall stating `frameBreaksMm` is more than one such frame stacked: see
 * bandsOf() above. Every band gets its own bottom and top plate (a break is
 * a double plate), its own studs/kings/backing, and -- unless the band is
 * flat -- its members are cut to the profile the way a single-band wall's
 * are. An opening is framed whole, in the band holding its head
 * (bandForHead()); one whose sill-to-head range crosses a break is listed in
 * `openingsAcrossBreak` but not otherwise treated specially.
 *
 * `maxStockMm` is only consulted for `suggestedBreaksMm` -- omit it (or pass
 * Infinity) where the caller does not need the suggestion; it never changes
 * what gets placed.
 */
export function frameLayout(
  f: Floor, w: Wall, rw: ResolvedWall, maxStockMm = Infinity,
): FrameLayout | null {
  return layoutWithBacking(f, w, rw, computeBacking(f).get(w.id) ?? EMPTY_BACKING, maxStockMm);
}

/**
 * Same as frameLayout(), but takes the floor's backing already computed --
 * for a caller (core/materials.ts) building every wall's layout in one pass,
 * so computeBacking() -- itself O(walls) -- runs once per floor rather than
 * once per wall.
 */
export function frameLayoutOf(
  f: Floor, w: Wall, rw: ResolvedWall, backing: ReadonlyMap<Id, WallBacking>, maxStockMm = Infinity,
): FrameLayout | null {
  return layoutWithBacking(f, w, rw, backing.get(w.id) ?? EMPTY_BACKING, maxStockMm);
}

function layoutWithBacking(
  f: Floor, w: Wall, rw: ResolvedWall, backing: WallBacking, maxStockMm: number,
): FrameLayout | null {
  if (!isFramedMaterial(w.material) || wallPostMm(w) === undefined) return null;
  const pw = wallPostWidthMm(w);
  if (pw === undefined) return null;

  const T = w.thickness;
  const L = rw.length;
  const Lf = Math.round((rw.faces.left + rw.faces.right) / 2);
  const topMax = wallTopRange(f, w, L).max;
  const steel = w.material === "steel";
  const plateName: MemberName = steel ? "rail" : "plate";
  const section = { w: pw, d: T };
  const grid = postLayoutOf(w) === "grid";
  // Every band reads the SAME wall-wide grid, ignoring every band's own run
  // cuts -- the [0, L] interval keeps a position that falls inside an
  // opening too, which a band's own runs (bandIntervals, below) would
  // otherwise hide; that is exactly what the cripple placement further down
  // needs to tell "inside this opening" from "outside every opening".
  const rawGrid = grid ? postPositions(w, L, [{ from: 0, to: L }]) : [];

  const bands = bandsOf(w, topMax);
  const openingsAcrossBreak: Id[] = [];
  for (const o of w.openings) {
    const sill = openingSill(o), head = sill + openingHeight(o);
    for (let i = 0; i + 1 < bands.length; i++) {
      if (sill < bands[i]!.top! && head > bands[i]!.top!) { openingsAcrossBreak.push(o.id); break; }
    }
  }
  const openingsByBand = new Map<number, Opening[]>();
  for (const o of w.openings) {
    const sill = openingSill(o), head = sill + openingHeight(o);
    const idx = bandForHead(bands, head);
    const arr = openingsByBand.get(idx);
    if (arr) arr.push(o); else openingsByBand.set(idx, [o]);
  }
  // Each band divides its OWN runs -- cut around the openings that overlap
  // that band, not every opening on the wall (see bandOverlapsOpening()).
  // The single-band (no frameBreaksMm) case reuses rw.intervals directly
  // rather than recomputing it, so an ordinary wall's studs -- the plan's
  // own drawn posts -- and its takeoff keep agreeing exactly.
  const bandIntervals = new Map<Band, WallRun[]>();
  if (bands.length === 1) {
    bandIntervals.set(bands[0]!, rw.intervals);
  } else {
    for (const band of bands) {
      const cutting = w.openings.filter(o => bandOverlapsOpening(band, o));
      bandIntervals.set(band, bandRunIntervals(cutting, L));
    }
  }

  const members: PlacedMember[] = [];
  const clampX = (x: number, width: number): number => Math.max(0, Math.min(Lf - width, x));

  // A full-height member (stud/king/backing) in a band spanning [bottom, top
  // ?? profile]; x is the rectangle's left edge. Cut to its own higher edge
  // when the band follows the profile (see edgeTop()); dropped entirely
  // where even the higher edge sits at or below the band's own bottom.
  const full = (name: MemberName, x: number, band: Band): PlacedMember | null => {
    const cx = clampX(x, pw);
    let h: number, slope: number | undefined;
    if (band.top !== undefined) {
      h = band.top - band.bottom - 2 * pw;
      slope = undefined;
    } else {
      // The exact top at the higher edge is generally a fraction of a mm; the
      // ORDERED length rounds down to whole mm -- immaterial at this scale
      // and never short, since the higher-edge choice above already gives
      // more length than the lower edge alone would need.
      const edge = edgeTop(f, w, cx, pw);
      h = Math.floor(edge.hi - band.bottom - 2 * pw);
      slope = edge.slope;
    }
    if (h <= 0) return null;
    return { name, x: cx, y: band.bottom + pw, w: pw, h, sectionMm: section, lengthMm: h, count: 1, spliceable: false, slope };
  };

  // Every band's own full-height member centres, gathered while they are
  // placed below -- read back by the "grid" nogging pass further down.
  const bandFullCenters = new Map<Band, number[]>();

  for (const band of bands) {
    const bandOpenings = openingsByBand.get(bands.indexOf(band)) ?? [];
    // Every full-height member this band places (end studs, kings, grid/even
    // studs, backing) -- not cripples, which stop at the header or the sill.
    // Collected as centres so the nogging pass below can bridge the actual
    // gaps between them, the way a builder sets noggings between whichever
    // studs happen to stand either side.
    const bandCenters: number[] = [];

    // A stud at each drawn post position, over THIS band's own runs
    // (bandIntervals.get(band)), cut only around the openings that reach
    // into this band. A band with no opening of its own runs clear across
    // even where a band below or above it is cut -- see bandRunIntervals().
    // "grid": postPositions() already drops a position inside this band's
    // own opening (no run there) or too close to its jamb to clear a king
    // (WallRun.ts's 1.5*postWidth run-end margin) -- exactly the two "drops
    // a grid position" cases CLAUDE.md's stud-layout paragraph states.
    // "even": postBays()'s own equal division, unchanged.
    if (grid) {
      for (const s of postPositions(w, L, bandIntervals.get(band)!)) {
        const m = full("stud", s - pw / 2, band);
        if (m) { members.push(m); bandCenters.push(s); }
      }
    } else {
      for (const bay of postBays(w, bandIntervals.get(band)!)) {
        for (let i = 1; i < bay.bays; i++) {
          const s = bay.from + bay.widthMm * i;
          const m = full("stud", s - pw / 2, band);
          if (m) { members.push(m); bandCenters.push(s); }
        }
      }
    }
    const nearA = bandOpenings.length > 0 ? Math.min(...bandOpenings.map(o => o.t - o.width / 2)) : Infinity;
    const nearB = bandOpenings.length > 0 ? Math.min(...bandOpenings.map(o => rw.length - (o.t + o.width / 2))) : Infinity;
    if (nearA > pw) { const m = full("stud", 0, band); if (m) { members.push(m); bandCenters.push(pw / 2); } }
    if (nearB > pw) { const m = full("stud", Lf - pw, band); if (m) { members.push(m); bandCenters.push(Lf - pw / 2); } }

    // Plates (rails for steel): the band's own bottom plate always flat;
    // its top plate flat too, except in the top band, where it follows the
    // profile -- see rakedTopPlateSegments(). A break is a double plate:
    // this band's own top plate and the next band's own bottom plate are
    // two separate members, never merged into one.
    if (Lf > 0) {
      // A band above the floor stops its bottom plate where the wall's top
      // no longer leaves room for both plates, so the plate does not stand
      // out past a gable's raked plates at the eaves.
      const topPoly = wallTopPolyline(f, w, L);
      const spans = band.bottom > 0 ? spansAbove(topPoly, band.bottom + 2 * pw, Lf) : [{ from: 0, to: Lf }];
      for (const sp of spans) {
        const isWholeSpan = sp.from === 0 && sp.to === Lf;
        members.push({
          name: plateName, x: sp.from, y: band.bottom, w: sp.to - sp.from, h: pw,
          sectionMm: section, lengthMm: isWholeSpan ? Lf : Math.ceil(sp.to - sp.from), count: 1, spliceable: true,
        });
      }
      const topClears = band.top !== undefined && topPoly.every(p => p.h >= band.top!);
      if (band.top !== undefined && topClears) {
        members.push({
          name: plateName, x: 0, y: band.top - pw, w: Lf, h: pw,
          sectionMm: section, lengthMm: Lf, count: 1, spliceable: true,
        });
      } else {
        // The top band, or a lower band the profile dips into: the top plate
        // follows the lower of the band's break and the wall's top.
        members.push(...rakedTopPlateSegments(f, w, L, Lf, band.bottom, pw, plateName, section, band.top));
      }
    }

    // King studs stand full height beside every jamb of an opening THIS
    // band holds -- timber outside the jack stud, steel directly against
    // the jamb (no jack).
    for (const o of bandOpenings) {
      const jambL = o.t - o.width / 2, jambR = o.t + o.width / 2;
      const pair = steel ? [jambL - pw, jambR] : [jambL - 2 * pw, jambR + pw];
      for (const x of pair) { const m = full("king", x, band); if (m) { members.push(m); bandCenters.push(x + pw / 2); } }
    }

    // Backing at this wall's share of its corners and junctions -- see
    // computeBacking(). Every band gets its own: a corner needs a nailing
    // face at every storey of a stacked frame, not only the lowest.
    for (let k = 0; k < backing.a; k++) {
      const x = pw + k * pw;
      const m = full("backing", x, band); if (m) { members.push(m); bandCenters.push(x + pw / 2); }
    }
    for (let k = 0; k < backing.b; k++) {
      const x = Lf - 2 * pw - k * pw;
      const m = full("backing", x, band); if (m) { members.push(m); bandCenters.push(x + pw / 2); }
    }
    bandFullCenters.set(band, bandCenters);
  }

  const openings: FrameLayout["openings"] = w.openings.map(o => ({
    openingId: o.id, x: o.t - o.width / 2, y: openingSill(o), w: o.width, h: openingHeight(o),
  }));

  const finish = (): FrameLayout => {
    const unfit = members.some(m => !m.spliceable && m.lengthMm > maxStockMm);
    const suggestedBreaksMm = unfit ? suggestBreaks(topMax, pw, maxStockMm) : undefined;
    const topLine = wallTopPolyline(f, w, Lf).map(p => ({ x: p.s, y: p.h }));
    return { lengthMm: Lf, heightMm: topMax, topLine, members, openings, openingsAcrossBreak, suggestedBreaksMm };
  };

  if (steel) return finish(); // no noggings, headers or jacks; a door frame is its own trade

  const spacing = wallPostMm(w)!; // defined: the guard at the top would not have gotten here otherwise

  for (const band of bands) {
    const bandOpenings = openingsByBand.get(bands.indexOf(band)) ?? [];

    // Jack (trimmer) studs carry the header, one pair per opening this band holds.
    for (const o of bandOpenings) {
      const jambL = o.t - o.width / 2, jambR = o.t + o.width / 2;
      const head = openingSill(o) + openingHeight(o);
      const jackLen = head - band.bottom - pw; // stands on this band's own bottom plate
      if (jackLen > 0) {
        const jack = (x: number): PlacedMember => ({
          name: "jack", x: clampX(x, pw), y: band.bottom + pw, w: pw, h: jackLen,
          sectionMm: section, lengthMm: jackLen, count: 1, spliceable: false,
        });
        members.push(jack(jambL - pw), jack(jambR));
      }
    }

    // Noggings: level rows across the WHOLE band -- ordinary building
    // practice, easier to set out and lining up for fixing boards, rather
    // than stepping up the slope with each bay's own local height. Row
    // heights are spaced over the band's own bandHeight: its flat top on a
    // flat band, or the band's own HIGHEST top (topMax) on the top band of a
    // sloped wall, so rows are spread over the full height of the gable. A
    // row is kept in a bay only where its own top (centre + half a post)
    // sits at least a post width below the top at BOTH of that bay's edges
    // -- the lower edge governs -- dropped, never shortened: a short bay
    // near the eaves then carries no nogging, which is normal for short
    // studs.
    if (w.noggingRows && w.noggingRows > 0) {
      const bandHeight = band.top ?? topMax;
      const clear = bandHeight - band.bottom - 2 * pw;
      if (clear > 0) {
        const rowCenters: number[] = [];
        for (let r = 1; r <= w.noggingRows; r++) {
          rowCenters.push(band.bottom + pw + r * clear / (w.noggingRows + 1));
        }
        const nogging = (x0: number, cutW: number, topAt0: number, topAt1: number): void => {
          if (cutW <= 0) return;
          const bound = Math.min(topAt0, topAt1) - pw;
          for (const centerY of rowCenters) {
            if (centerY + pw / 2 > bound) continue;
            members.push({
              name: "nogging", x: clampX(x0, cutW), y: centerY - pw / 2, w: cutW, h: pw,
              sectionMm: section, lengthMm: cutW, count: 1, spliceable: false,
            });
          }
        };
        if (grid) {
          // Per actual gap between consecutive full-height members THIS band
          // placed (end studs, kings, grid studs, backing -- bandFullCenters,
          // gathered above; a cripple does not count, it stops at the header
          // or the sill) -- a builder's own noggings run stud to stud,
          // whatever the two studs either side of a gap happen to be, not to
          // an equal bay. A gap is skipped unless some run holds it whole:
          // that is what keeps a king-to-king gap across a door from getting
          // one nogging spanning the opening's own hole.
          const runs = bandIntervals.get(band)!;
          const centers = [...new Set(bandFullCenters.get(band) ?? [])].sort((a, b) => a - b);
          for (let i = 0; i + 1 < centers.length; i++) {
            const c1 = centers[i]!, c2 = centers[i + 1]!;
            if (!runs.some(r => c1 >= r.from - 0.5 && c2 <= r.to + 0.5)) continue;
            const cutW = Math.round(c2 - c1 - pw);
            if (cutW < 100) continue;
            nogging(c1 + pw / 2, cutW, band.top ?? wallTopAt(f, w, c1), band.top ?? wallTopAt(f, w, c2));
          }
        } else {
          for (const bay of postBays(w, bandIntervals.get(band)!)) {
            for (let j = 0; j < bay.bays; j++) {
              const cellStart = bay.from + bay.widthMm * j;
              nogging(cellStart + pw / 2, Math.round(bay.widthMm - pw),
                band.top ?? wallTopAt(f, w, cellStart), band.top ?? wallTopAt(f, w, cellStart + bay.widthMm));
            }
          }
        }
      }
    }

    for (const o of bandOpenings) {
      const jambL = o.t - o.width / 2;
      const sill = openingSill(o), oh = openingHeight(o);
      const head = sill + oh;
      const headerLen = o.width + 2 * pw;
      if (headerLen > 0) {
        members.push({
          name: "header", x: clampX(jambL - pw, headerLen), y: head, w: headerLen, h: T,
          sectionMm: section, lengthMm: headerLen, count: 2, spliceable: false,
        });
      }
      if (sill > band.bottom && headerLen > 0) {
        members.push({
          name: "sill", x: clampX(jambL - pw, headerLen), y: sill - pw, w: headerLen, h: pw,
          sectionMm: section, lengthMm: headerLen, count: 1, spliceable: false,
        });
      }

      // "grid": the wall-wide grid positions that fall strictly inside this
      // opening's own span -- CLAUDE.md's stud-layout paragraph. A position
      // near enough a jamb to be in the king's own territory never reaches
      // here at all: rawGrid is the unfiltered wall-wide candidate list, but
      // jambL/jambR are the opening's own bounds, so a position between them
      // is "inside the opening" regardless of how close it stands to a jamb
      // -- which is right, since nothing else stands there to fill the gap.
      // "even": crippleCount()'s own equal division, unchanged.
      const jambR = o.t + o.width / 2;
      const cripplePositions = grid
        ? rawGrid.filter(g => g > jambL + 0.5 && g < jambR - 0.5)
        : (() => {
            const cripples = crippleCount(o.width, spacing);
            const bays = cripples + 1;
            return cripples > 0
              ? Array.from({ length: cripples }, (_, i) => jambL + (i + 1) * (o.width / bays))
              : [];
          })();
      for (const cx of cripplePositions) {
        // Above the header: cut to the top at the cripple's own position, the
        // same way a stud is -- never shortened, and dropped where even the
        // top plate has nothing left above it.
        const edge = band.top !== undefined
          ? { hi: band.top, slope: undefined }
          : edgeTop(f, w, clampX(cx - pw / 2, pw), pw);
        const above = Math.floor(edge.hi - pw - T - head);
        if (above > 0) {
          members.push({
            name: "cripple", x: clampX(cx - pw / 2, pw), y: head + T, w: pw, h: above,
            sectionMm: section, lengthMm: above, count: 1, spliceable: false, slope: edge.slope,
          });
        }
        // Below the sill: the sill height less the bottom plate and the sill
        // piece itself -- always well clear of the roofline, so unaffected
        // by the profile.
        const below = sill - band.bottom - 2 * pw;
        if (sill > band.bottom && below > 0) {
          members.push({
            name: "cripple", x: clampX(cx - pw / 2, pw), y: band.bottom + pw, w: pw, h: below,
            sectionMm: section, lengthMm: below, count: 1, spliceable: false,
          });
        }
      }
    }
  }

  return finish();
}

// ── every wall's elevation ──────────────────────────────────────────────
//
// wallElevation() generalises frameLayout() to every wall, not only a
// framed one with a stated post width: a block wall's own courses, a
// sandwich wall's own panel lines, or -- any other material, or one of
// those three missing the one fact its own kind needs -- the face outline
// and its openings alone. There is always something to return, which is
// what lets the Aanzicht button (ui/frame.ts) stay enabled unconditionally:
// `notes` says what could not be drawn and why, rather than the button
// being disabled with nothing to show for it.

export type ElevationKind = "frame" | "block" | "panel" | "plain";

/** One block-coursed row, in stretcher bond from the a end. `h` is this
 *  row's own height: the block format's height, except for the row nearest
 *  the wall's own highest point, which is capped to fit under it -- see
 *  buildCourses(). */
export interface Course {
  row: number;
  y: number;
  h: number;
  /** `h` is the course's own height; a block cut down by the wall's top
   *  states its own smaller `h`, so the drawing does not stand a cut block
   *  proud of the roofline it was cut to. */
  blocks: { x: number; w: number; cut: boolean; h?: number }[];
}

export interface WallElevation {
  kind: ElevationKind;
  lengthMm: number;
  heightMm: number;
  /** The wall's top from x = 0 to x = lengthMm -- see FrameLayout.topLine. */
  topLine: { x: number; y: number }[];
  openings: FrameLayout["openings"];
  /** Frame: the placed members, as frameLayout() returns them. Empty otherwise. */
  members: PlacedMember[];
  /** Block: the courses in stretcher bond. Empty otherwise. */
  courses: Course[];
  /** Panel: edges along the wall, mm from the a end -- interior divisions
   *  only, never at x = 0 or x = lengthMm. Empty otherwise. */
  panelEdges: number[];
  /** What the drawing could not show, and why: a frame without any posts
   *  stated at all, a frame with posts but no post width, a block wall
   *  without a format, a sandwich wall without a panel width. The face and
   *  its openings draw regardless. */
  notes: ("posts" | "postWidth" | "block" | "panel")[];
}

/**
 * One course's block segments: stretcher bond from the a end (alternate
 * rows offset by half a block -- halfsteensverband), cut at the wall's own
 * ends, cut or dropped around every opening whose [sill, head] range reaches
 * this row, and cut or dropped wherever the wall's own sloped top crosses
 * it. A block is "cut" for any of those three reasons; a block dropped
 * rather than cut is simply absent from the row, which is what "a course
 * entirely above the top is not drawn" means at a given x. A course whose
 * y-range does not reach an opening's [sill, head] runs straight through
 * that opening's span uncut -- the header/lintel line above a window is not
 * modelled, so nothing marks the course that happens to stand over one.
 *
 * The sloped-top test reads each block's own two edges the way
 * frameLayout()'s edgeTop() does: `lo`/`hi` are the lower/higher of the top
 * at x0 and at x1. A block already entirely above the higher edge is
 * dropped; one reaching only partway above the lower edge is kept and
 * marked cut. Rows are generated up to the wall's own highest point
 * (topMax), with the last row's `h` capped to fit under it (buildCourses());
 * that cap only ever matters near the peak of a sloped wall. Away from the
 * peak, a row this cap would otherwise leave full-height is cut or dropped
 * anyway by this same per-block check, now against the LOCAL top rather
 * than topMax -- which is what steps a gable's course line down rather than
 * cutting it on one straight diagonal.
 */
function courseBlocks(
  f: Floor, w: Wall, Lf: number, row: number, y: number, h: number, bl: number,
): Course["blocks"] {
  const offset = row % 2 === 1 ? bl / 2 : 0;
  interface Seg { x0: number; x1: number; cut: boolean }
  let segs: Seg[] = [];
  for (let x0 = -offset; x0 < Lf; x0 += bl) {
    const x1 = x0 + bl;
    const cx0 = Math.max(0, x0), cx1 = Math.min(Lf, x1);
    if (cx1 - cx0 < 1) continue;
    segs.push({ x0: cx0, x1: cx1, cut: cx0 > x0 + 0.5 || cx1 < x1 - 0.5 });
  }
  for (const o of w.openings) {
    const sill = openingSill(o), head = sill + openingHeight(o);
    if (sill >= y + h || head <= y) continue;
    const jambL = o.t - o.width / 2, jambR = o.t + o.width / 2;
    const next: Seg[] = [];
    for (const s of segs) {
      if (jambR <= s.x0 || jambL >= s.x1) { next.push(s); continue; }
      if (jambL <= s.x0 && jambR >= s.x1) continue; // wholly inside the hole
      if (jambL > s.x0) next.push({ x0: s.x0, x1: Math.min(s.x1, jambL), cut: true });
      if (jambR < s.x1) next.push({ x0: Math.max(s.x0, jambR), x1: s.x1, cut: true });
    }
    segs = next.filter(s => s.x1 - s.x0 >= 1);
  }
  const out: Course["blocks"] = [];
  for (const s of segs) {
    const tl = wallTopAt(f, w, s.x0), tr = wallTopAt(f, w, s.x1);
    const lo = Math.min(tl, tr), hi = Math.max(tl, tr);
    if (y >= hi - 0.5) continue;
    // A block the top crosses is cut to the LOWER of its two edges: the piece
    // that survives the cut is the one standing under the roofline at both.
    const cutByTop = y + h > lo + 0.5;
    const blockH = cutByTop ? Math.max(0, Math.min(h, lo - y)) : h;
    if (blockH < 1) continue;
    out.push({
      x: s.x0, w: s.x1 - s.x0, cut: s.cut || cutByTop,
      ...(blockH < h - 0.5 ? { h: blockH } : {}),
    });
  }
  return out;
}

/** The wall's block courses -- see courseBlocks(). A row left with no blocks
 *  at all (every one dropped, e.g. beyond a gable's eaves) is left out of
 *  the result entirely rather than kept empty. */
function buildCourses(
  f: Floor, w: Wall, Lf: number, topMax: number, blockMm: { length: number; height: number },
): Course[] {
  const courses: Course[] = [];
  let row = 0;
  for (let y = 0; y < topMax - 0.5; y += blockMm.height, row++) {
    const h = Math.min(blockMm.height, topMax - y);
    const blocks = courseBlocks(f, w, Lf, row, y, h, blockMm.length);
    if (blocks.length > 0) courses.push({ row, y, h, blocks });
  }
  return courses;
}

/** Panel edges at every `panelMm` from the a end, interior divisions only:
 *  an edge exactly at `Lf` would not divide anything, so an exact division
 *  simply ends in one full-width panel rather than gaining a zero-width one,
 *  and an inexact one leaves its last panel short -- the "cut fifth panel"
 *  a sandwich wall's legend counts. */
function panelEdgePositions(Lf: number, panelMm: number): number[] {
  const edges: number[] = [];
  for (let x = panelMm; x < Lf - 0.5; x += panelMm) edges.push(Math.round(x));
  return edges;
}

/**
 * Every wall's elevation. `kind` always names the wall's own material
 * family (frame/block/panel/plain), whether or not there was enough to draw
 * beyond the face -- see the module comment above. `lengthMm`/`heightMm`/
 * `topLine`/`openings` are read the same way for every kind, the same
 * centerline mm frameLayout() itself reads member positions against.
 */
export function wallElevation(f: Floor, w: Wall, rw: ResolvedWall): WallElevation {
  const L = rw.length;
  const Lf = Math.round((rw.faces.left + rw.faces.right) / 2);
  const topMax = wallTopRange(f, w, L).max;
  const topLine = wallTopPolyline(f, w, Lf).map(p => ({ x: p.s, y: p.h }));
  const openings: FrameLayout["openings"] = w.openings.map(o => ({
    openingId: o.id, x: o.t - o.width / 2, y: openingSill(o), w: o.width, h: openingHeight(o),
  }));
  const base = { lengthMm: Lf, heightMm: topMax, topLine, openings };

  if (isFramedMaterial(w.material)) {
    const layout = frameLayout(f, w, rw);
    const notes: WallElevation["notes"] = layout
      ? []
      : wallPostMm(w) === undefined ? ["posts"] : ["postWidth"];
    return { ...base, kind: "frame", members: layout?.members ?? [], courses: [], panelEdges: [], notes };
  }
  if (isBlockMaterial(w.material)) {
    const fmt = w.blockMm;
    const hasFormat = fmt !== undefined && fmt.length > 0 && fmt.height > 0;
    const courses = hasFormat ? buildCourses(f, w, Lf, topMax, fmt!) : [];
    return { ...base, kind: "block", members: [], courses, panelEdges: [], notes: hasFormat ? [] : ["block"] };
  }
  if (w.material === "sandwich") {
    const hasWidth = w.panelMm !== undefined && w.panelMm > 0;
    const panelEdges = hasWidth ? panelEdgePositions(Lf, w.panelMm!) : [];
    return { ...base, kind: "panel", members: [], courses: [], panelEdges, notes: hasWidth ? [] : ["panel"] };
  }
  return { ...base, kind: "plain", members: [], courses: [], panelEdges: [], notes: [] };
}
