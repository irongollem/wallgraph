// One framed wall's members placed in the wall's own plane. The takeoff
// (core/materials.ts) counts this layout and the elevation (render/frame.ts)
// draws it, so the drawing and the order cannot disagree.
import type { Floor, Id, Opening, Wall } from "../model/doc";
import {
  isFramedMaterial, openingHeight, openingSill, wallPostMm, wallPostWidthMm,
} from "../model/doc";
import { wallTopAt, wallTopPolyline, wallTopRange } from "../model/profile";
import type { MemberName } from "./materials";
import { postBays, type ResolvedWall, type WallRun } from "./resolve";
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
 * The solid runs (WallRun[], the shape postBays() and postsFor() in
 * resolve.ts divide) over [0, L] cut around the openings that overlap THIS
 * band -- not every wall opening. Mirrors resolveFloor()'s own cut, applied
 * to a band-specific subset: a window whose head sits in a lower band cuts
 * no run out of a band above it, so that band's studs and noggings run
 * clear across, the same equal-bay division postBays() gives an unbroken
 * span anywhere else.
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
 * and the slope between them -- undefined where the two agree, which is
 * what keeps a flat run's members free of a `slope` field entirely (see
 * PlacedMember.slope). Shared by every full-height member (stud, king,
 * backing, cripple): each is cut to its own higher edge so nothing is ever
 * ordered short of the roofline crossing its width.
 */
function edgeTop(f: Floor, w: Wall, x: number, width: number): { hi: number; slope?: number } {
  if (width <= 0) return { hi: wallTopAt(f, w, x) };
  const tl = wallTopAt(f, w, x), tr = wallTopAt(f, w, x + width);
  return { hi: Math.max(tl, tr), slope: tl === tr ? undefined : (tr - tl) / width };
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
  plateName: MemberName, section: { w: number; d: number },
): PlacedMember[] {
  const poly = wallTopPolyline(f, w, L);
  const out: PlacedMember[] = [];
  for (let i = 0; i + 1 < poly.length; i++) {
    let s0 = poly[i]!.s, h0 = poly[i]!.h;
    let s1 = poly[i + 1]!.s, h1 = poly[i + 1]!.h;
    if (s1 <= s0) continue;
    if (h0 <= bandBottom && h1 <= bandBottom) continue; // the top band doesn't exist over this span
    if (h0 <= bandBottom) {
      const frac = (bandBottom - h0) / (h1 - h0);
      s0 = s0 + frac * (s1 - s0); h0 = bandBottom;
    } else if (h1 <= bandBottom) {
      const frac = (bandBottom - h0) / (h1 - h0);
      s1 = s0 + frac * (s1 - s0); h1 = bandBottom;
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
 * an opening, the bay divisions of postBays() for a stud) directly against
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

  for (const band of bands) {
    const bandOpenings = openingsByBand.get(bands.indexOf(band)) ?? [];

    // A stud at each drawn post position -- postBays()'s own division, but
    // over THIS band's own runs (bandIntervals.get(band)), cut only around
    // the openings that reach into this band. A band with no opening of its
    // own runs clear across even where a band below or above it is cut --
    // see bandRunIntervals(). Plus one at each wall end -- unless one of
    // THIS band's openings has a jamb within one post width of that end,
    // i.e. the king stud below already occupies it.
    for (const bay of postBays(w, bandIntervals.get(band)!)) {
      for (let i = 1; i < bay.bays; i++) {
        const m = full("stud", bay.from + bay.widthMm * i - pw / 2, band);
        if (m) members.push(m);
      }
    }
    const nearA = bandOpenings.length > 0 ? Math.min(...bandOpenings.map(o => o.t - o.width / 2)) : Infinity;
    const nearB = bandOpenings.length > 0 ? Math.min(...bandOpenings.map(o => rw.length - (o.t + o.width / 2))) : Infinity;
    if (nearA > pw) { const m = full("stud", 0, band); if (m) members.push(m); }
    if (nearB > pw) { const m = full("stud", Lf - pw, band); if (m) members.push(m); }

    // Plates (rails for steel): the band's own bottom plate always flat;
    // its top plate flat too, except in the top band, where it follows the
    // profile -- see rakedTopPlateSegments(). A break is a double plate:
    // this band's own top plate and the next band's own bottom plate are
    // two separate members, never merged into one.
    if (Lf > 0) {
      members.push({
        name: plateName, x: 0, y: band.bottom, w: Lf, h: pw,
        sectionMm: section, lengthMm: Lf, count: 1, spliceable: true,
      });
      if (band.top !== undefined) {
        members.push({
          name: plateName, x: 0, y: band.top - pw, w: Lf, h: pw,
          sectionMm: section, lengthMm: Lf, count: 1, spliceable: true,
        });
      } else {
        members.push(...rakedTopPlateSegments(f, w, L, Lf, band.bottom, pw, plateName, section));
      }
    }

    // King studs stand full height beside every jamb of an opening THIS
    // band holds -- timber outside the jack stud, steel directly against
    // the jamb (no jack).
    for (const o of bandOpenings) {
      const jambL = o.t - o.width / 2, jambR = o.t + o.width / 2;
      const pair = steel ? [jambL - pw, jambR] : [jambL - 2 * pw, jambR + pw];
      for (const x of pair) { const m = full("king", x, band); if (m) members.push(m); }
    }

    // Backing at this wall's share of its corners and junctions -- see
    // computeBacking(). Every band gets its own: a corner needs a nailing
    // face at every storey of a stacked frame, not only the lowest.
    for (let k = 0; k < backing.a; k++) { const m = full("backing", pw + k * pw, band); if (m) members.push(m); }
    for (let k = 0; k < backing.b; k++) { const m = full("backing", Lf - 2 * pw - k * pw, band); if (m) members.push(m); }
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

    // Noggings: rows are spaced proportionally within EACH BAY'S OWN local
    // height -- the band's own top for a flat band, or the profile at that
    // bay's own centre for the top band -- the same "own position" rule
    // every full member is cut by. A bay whose local height does not clear
    // two plates plus a whit has nothing to space a row within and is
    // dropped, never shortened.
    if (w.noggingRows && w.noggingRows > 0) {
      for (const bay of postBays(w, bandIntervals.get(band)!)) {
        for (let j = 0; j < bay.bays; j++) {
          const cellStart = bay.from + bay.widthMm * j;
          const cellCenter = cellStart + bay.widthMm / 2;
          const cutW = Math.round(bay.widthMm - pw);
          if (cutW <= 0) continue;
          const localTop = band.top ?? wallTopAt(f, w, cellCenter);
          const cellH = localTop - band.bottom - 2 * pw;
          if (cellH <= 0) continue;
          for (let r = 1; r <= w.noggingRows; r++) {
            const centerY = band.bottom + pw + r * cellH / (w.noggingRows + 1);
            members.push({
              name: "nogging", x: clampX(cellStart + pw / 2, cutW), y: centerY - pw / 2, w: cutW, h: pw,
              sectionMm: section, lengthMm: cutW, count: 1, spliceable: false,
            });
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

      const cripples = crippleCount(o.width, spacing);
      if (cripples > 0) {
        const bays = cripples + 1;
        for (let i = 1; i <= cripples; i++) {
          const cx = jambL + i * (o.width / bays);
          // Above the header: cut to the top at the cripple's own position,
          // the same way a stud is -- never shortened, and dropped where
          // even the top plate has nothing left above it.
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
          // Below the sill: the sill height less the bottom plate and the
          // sill piece itself -- always well clear of the roofline, so
          // unaffected by the profile.
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
  }

  return finish();
}
