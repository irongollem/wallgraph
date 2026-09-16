// What a hole in a deck does to its joists (issue #64): a stair opening or a
// vide that lies inside a deck cuts the joists crossing it. A header
// (raveelbalk) picks up the cut joists' ends and spans the hole; the joists
// either side of the hole -- the trimmers (wisselbalken) -- carry that
// header as a point load in addition to their own strip of floor, and are
// doubled by convention. Nothing here is stored: like every derived-geometry
// module, this is recomputed from the deck and the floor's vides on every
// document revision.
//
// Only a Vide is trimmed. A stair's own trapgat is the same kind of hole,
// but core/stair.ts exposes only the whole flight's footprint (stairBox()),
// which includes the run standing on the floor BELOW -- not the rectangular
// opening this floor's deck is cut for, and the two can differ (a winder's
// footprint is not its trapgat). Without a stored or derived trapgat
// rectangle to trim against, guessing one would silently mis-shape a real
// hole; a stair opening is out of scope for this issue (see the issue's own
// text) and reports nothing here.
//
// Bearing convention: a cut joist's own bearing onto its header is a hanger,
// flush, with no bearing length of its own the way a wall bearing has -- so
// a cut joist's surviving physical length is its clear run to the hole edge
// plus ONE bearingOf(deck) at the wall end only, the same "full bearing
// overhang at a true support" reading deckSolids() and deckTakeoffOf() give
// an ordinary joist's own two ends. That same figure is reused as the
// tributary length over which its own line load acts when finding its
// reaction onto the header -- marginally longer than the pure structural
// span between bearing centrelines, which is conservative for the
// header/trimmer check. A header's and a trimmer's own STRUCTURAL span
// (what headerCheck()/trimmerCheck() in core/checks.ts hand to checkSpan())
// instead follows joistCheck()'s own convention exactly: clear distance plus
// one bearingOf(deck) total (half at each end, centre-to-centre of the
// bearings), so a trimmer's reported span is the same figure joistCheck()
// would report for an ordinary joist at that position.
//
// ONE derived layout, deckJoistLayout(), is what every drawing and export
// path reads: render/deck.ts's canvas mark (and, through it, the SVG and DXF
// prims, which replay the same draw call), core/deck.ts's deckSolids() (and
// through it the 3D view and io/ifc.ts's IFCMEMBERs), and core/materials.ts's
// takeoff. None of them re-derives which joists a hole cuts; they read
// full/cut/headers/trimmers off this one function, so a drawing cannot show
// timber where the takeoff says there is none, or vice versa.
//
// trimDeck() (the structural aggregate headerCheck()/trimmerCheck() and the
// takeoff's counts read) and deckJoistLayout() (the positioned segments the
// drawing and 3D/IFC read) are both views over the same internal pass,
// computeTrim() -- there is exactly one place that decides which joists a
// hole cuts and where its header and trimmers land.
import type { Id, Floor } from "../model/doc";
import { videsOf } from "../model/doc";
import type { Deck } from "../model/deck";
import { bearingOf } from "../model/deck";
import type { Vide } from "../model/vide";
import { Vec, v } from "../geometry/vec";
import { deckBox, deckJoistsLocal, deckSpanMm } from "./deck";
import { localPoint } from "./placed";
import { videCorners } from "./vide";

export interface DeckOpening {
  id: Id;
  kind: "vide" | "stair";
  /** Local to the deck: along the joists and across them, mm. */
  from: number;
  to: number;
  left: number;
  right: number;
  /**
   * True when the opening's footprint lies fully inside the deck's own (not
   * part of the issue's own sketch of this interface, added because the
   * issue also asks a hole that is only partly inside, or not inside at
   * all, to be reported rather than guessed at). False means nothing below
   * was trimmed for it: the model cannot say what carries its far edge, so
   * it carries no cut joists, header or trimmer of its own.
   */
  complete: boolean;
}

export interface TrimmedDeck {
  /** Joists that run past every hole, unchanged. */
  fullJoists: number;
  /** Joists cut by a hole, with the length that survives at each end,
   *  grouped by that length. */
  cutJoists: { lengthMm: number; count: number }[];
  /**
   * The headers across a hole: one at each end that has cut joists bearing
   * on it -- none where that end reaches the deck's own edge. `reactionG`
   * and `reactionQ` are the header's own end reaction (what lands on ONE
   * trimmer), kept apart rather than combined and split back by ratio,
   * because they come from the deck's own loadG and loadQ separately (see
   * computeTrim()) -- trimDeck() has no document to factor them with, so
   * both stay characteristic (unfactored) here; headerCheck() applies
   * gammaG/gammaQ.
   */
  headers: { spanMm: number; carriesJoists: number; reactionG: number; reactionQ: number }[];
  /**
   * The joists either side of a hole, doubled by convention -- ONE entry per
   * opening, since the header's own reaction is identical at both its ends
   * (simple statics), so the left and right trimmer positions always face
   * the same load and share one check. `points` is every header's reaction
   * landing on it -- ONE when the hole reaches one edge of the deck (a
   * single header), TWO when it is fully interior (a header at each end,
   * both landing on the same physical trimmer) -- see trimmerCheck() in
   * core/checks.ts, which superposes all of them rather than checking the
   * worse alone. `count` is the PHYSICAL piece count this ONE checked entry
   * stands for: 2 positions (left, right) x 2 boards each (doubled) = 4.
   */
  trimmers: { spanMm: number; points: { g: number; q: number; atMm: number }[]; count: number }[];
  openings: DeckOpening[];
}

export interface JoistSegment { a: Vec; b: Vec }

export interface DeckJoistLayout {
  /** Untouched joist centrelines, in the deck's own local millimetres,
   *  extended by bearingOf(deck) at BOTH ends -- the same physical-length
   *  convention deckSolids()/deckTakeoffOf() already give an ordinary
   *  joist. A 2D drawer that wants the clear platform only (deckJoistsLocal()'s
   *  own convention) clips each segment to the deck's own box. */
  full: JoistSegment[];
  /** Every surviving joist stub after the holes that cut it -- 0, 1 or 2
   *  segments per cut joist. Extended by bearingOf(deck) at an end that
   *  reaches the deck's own edge; flush (no extension -- a hanger, not a
   *  bearing) at an end that stops at a header. */
  cut: JoistSegment[];
  /** One centreline per header, across the hole between the two trimmer
   *  positions -- the hole's own across extent, no bearing added (the same
   *  "drawn length excludes bearing" reading an ordinary joist's own 2D
   *  mark already gives; header.spanMm, in TrimmedDeck, is the figure WITH
   *  bearing that the check and the materiaalstaat order length use). */
  headers: JoistSegment[];
  /** One centreline per trimmer POSITION, extended by bearingOf(deck) at
   *  both ends like an ordinary full joist (a trimmer runs the deck's whole
   *  span). Not yet doubled: a 2D drawer offsets a small, purely legible gap
   *  either side (render/deck.ts's TRIMMER_GAP_MM); a 3D/IFC consumer places
   *  two ADJACENT, touching prisms of the joist's own single width instead
   *  -- two real members, not one double-width one. Empty where the deck
   *  states no joist section: there is no width to place two members at. */
  trimmers: JoistSegment[];
  openings: DeckOpening[];
}

/** Rounding tolerance for "reaches the deck's edge" / "fully inside", mm. */
const EDGE_TOL_MM = 2;

interface LocalBoxXY { x0: number; y0: number; x1: number; y1: number }

function openingLocalBox(deck: Deck, vd: Vide): LocalBoxXY {
  const corners = videCorners(vd).map(c => localPoint(deck, c));
  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** [start,end] minus [holeStart,holeEnd] -- 0, 1 or 2 pieces. */
function subtractInterval(seg: [number, number], hole: [number, number]): [number, number][] {
  const [s, e] = seg, [hl, hh] = hole;
  if (hh <= s + EDGE_TOL_MM || hl >= e - EDGE_TOL_MM) return [seg];
  const out: [number, number][] = [];
  if (hl > s + EDGE_TOL_MM) out.push([s, hl]);
  if (hh < e - EDGE_TOL_MM) out.push([hh, e]);
  return out;
}

/** One surviving piece extended by bearingOf(deck) at an end that still
 *  reaches the deck's true edge, [-spanHalf, spanHalf]. */
function extendPiece(spanHalf: number, bearing: number, seg: [number, number]): [number, number] {
  const [s, e] = seg;
  return [
    s <= -spanHalf + EDGE_TOL_MM ? s - bearing : s,
    e >= spanHalf - EDGE_TOL_MM ? e + bearing : e,
  ];
}

/** A joist's own local span extent, [-spanHalf, spanHalf], cut by every hole
 *  that applies to it, each surviving piece extended by bearingOf(deck) at
 *  an end that still reaches the deck's true edge. */
function clipAndExtend(spanHalf: number, bearing: number, holes: [number, number][]): [number, number][] {
  let segs: [number, number][] = [[-spanHalf, spanHalf]];
  for (const hole of holes) segs = segs.flatMap(seg => subtractInterval(seg, hole));
  return segs.filter(([s, e]) => e - s > EDGE_TOL_MM).map(seg => extendPiece(spanHalf, bearing, seg));
}

/** The extended, uncut span -- the same figure clipAndExtend() would give
 *  with no holes, without the array-destructure TypeScript cannot prove
 *  non-empty. */
function extendFull(spanHalf: number, bearing: number): [number, number] {
  return extendPiece(spanHalf, bearing, [-spanHalf, spanHalf]);
}

interface TrimResult { trimmed: TrimmedDeck; layout: DeckJoistLayout }

/**
 * The one pass that decides which joists a deck's holes cut, and where the
 * headers and trimmers land -- trimDeck() and deckJoistLayout() are both
 * thin views over this. See the module header.
 */
function computeTrim(f: Floor, deck: Deck): TrimResult {
  const db = deckBox(deck);
  const axisIsX = deck.joistAxis === "x";
  const spanHalf = deckSpanMm(deck) / 2;
  const bearing = bearingOf(deck);
  const joists = deckJoistsLocal(deck);
  const acrossOf = (j: { a: { x: number; y: number } }): number => (axisIsX ? j.a.y : j.a.x);
  const mkSpanSeg = (s: number, e: number, acrossPos: number): JoistSegment =>
    axisIsX ? { a: v(s, acrossPos), b: v(e, acrossPos) } : { a: v(acrossPos, s), b: v(acrossPos, e) };
  const mkAcrossSeg = (spanPos: number, s: number, e: number): JoistSegment =>
    axisIsX ? { a: v(spanPos, s), b: v(spanPos, e) } : { a: v(s, spanPos), b: v(e, spanPos) };

  const openings: DeckOpening[] = [];
  const cutJoistLengths = new Map<number, number>();
  const headers: TrimmedDeck["headers"] = [];
  const trimmers: TrimmedDeck["trimmers"] = [];
  const headerSegs: JoistSegment[] = [];
  const trimmerSegs: JoistSegment[] = [];
  // Per-joist list of [spanLo, spanHi] hole bands that apply to it, keyed by
  // its index in `joists` (a Map keyed on the joist object itself would work
  // too, but an index is simpler to dedupe fullness against).
  const holesPerJoist = new Map<number, [number, number][]>();

  const trimmerSpanMm = deckSpanMm(deck) + bearing;

  for (const vd of videsOf(f)) {
    const box = openingLocalBox(deck, vd);
    const overlaps = box.x0 < db.x1 && box.x1 > db.x0 && box.y0 < db.y1 && box.y1 > db.y0;
    if (!overlaps) continue;

    const complete = box.x0 >= db.x0 - EDGE_TOL_MM && box.x1 <= db.x1 + EDGE_TOL_MM
      && box.y0 >= db.y0 - EDGE_TOL_MM && box.y1 <= db.y1 + EDGE_TOL_MM;

    const spanLo = axisIsX ? box.x0 : box.y0;
    const spanHi = axisIsX ? box.x1 : box.y1;
    const acrossLo = axisIsX ? box.y0 : box.x0;
    const acrossHi = axisIsX ? box.y1 : box.x1;

    openings.push({ id: vd.id, kind: "vide", from: spanLo, to: spanHi, left: acrossLo, right: acrossHi, complete });
    if (!complete) continue;

    const cutIdx: number[] = [];
    joists.forEach((j, i) => {
      const c = acrossOf(j);
      if (c >= acrossLo - EDGE_TOL_MM && c <= acrossHi + EDGE_TOL_MM) cutIdx.push(i);
    });
    if (cutIdx.length === 0) continue;
    for (const i of cutIdx) {
      const list = holesPerJoist.get(i) ?? [];
      list.push([spanLo, spanHi]);
      holesPerJoist.set(i, list);
    }

    const nearEdge = spanLo <= -spanHalf + EDGE_TOL_MM;
    const farEdge = spanHi >= spanHalf - EDGE_TOL_MM;
    // g and q kept apart from the start -- headerCheck()/trimmerCheck() need
    // both separately to apply gammaG/gammaQ, and this module has no
    // document to read those factors from, so there is nothing to combine
    // them FOR here; keeping them apart also means neither call has to
    // split a combined figure back by ratio.
    const gLinePerJoistNmm = (deck.loadG ?? 0) * deck.joistMm / 1_000_000;
    const qLinePerJoistNmm = (deck.loadQ ?? 0) * deck.joistMm / 1_000_000;
    const headerSpanMm = (acrossHi - acrossLo) + bearing;
    const trimmerPoints: { g: number; q: number; atMm: number }[] = [];

    if (!nearEdge) {
      const stubMm = (spanLo - (-spanHalf)) + bearing;
      cutJoistLengths.set(stubMm, (cutJoistLengths.get(stubMm) ?? 0) + cutIdx.length);
      // Each cut joist is itself simply supported between the header and its
      // own wall bearing: reaction at each end = (line load * length)/2.
      // The header, in turn, is simply supported on the two trimmers: its
      // own end reaction (what lands on ONE trimmer) is half of its own
      // total load, i.e. a quarter of (count * per-joist reaction) -- for
      // g and q each.
      const reactionG = (cutIdx.length * gLinePerJoistNmm * stubMm) / 4;
      const reactionQ = (cutIdx.length * qLinePerJoistNmm * stubMm) / 4;
      headers.push({ spanMm: headerSpanMm, carriesJoists: cutIdx.length, reactionG, reactionQ });
      headerSegs.push(mkAcrossSeg(spanLo, acrossLo, acrossHi));
      trimmerPoints.push({ g: reactionG, q: reactionQ, atMm: spanLo + spanHalf + bearing / 2 });
    }
    if (!farEdge) {
      const stubMm = (spanHalf - spanHi) + bearing;
      cutJoistLengths.set(stubMm, (cutJoistLengths.get(stubMm) ?? 0) + cutIdx.length);
      const reactionG = (cutIdx.length * gLinePerJoistNmm * stubMm) / 4;
      const reactionQ = (cutIdx.length * qLinePerJoistNmm * stubMm) / 4;
      headers.push({ spanMm: headerSpanMm, carriesJoists: cutIdx.length, reactionG, reactionQ });
      headerSegs.push(mkAcrossSeg(spanHi, acrossLo, acrossHi));
      trimmerPoints.push({ g: reactionG, q: reactionQ, atMm: trimmerSpanMm - (spanHalf - spanHi + bearing / 2) });
    }
    // A trimmer beside a fully interior hole carries BOTH headers' points at
    // once -- one trimmers[] entry per opening (not per header), covering
    // both physical sides at once too: the header's own reaction is the
    // same at both its ends by simple statics, so the left and right
    // trimmer positions always face an identical load and need only one
    // check between them. `count: 4` is the physical piece count both
    // positions doubled come to (see TrimmedDeck's own comment).
    if (trimmerPoints.length > 0) trimmers.push({ spanMm: trimmerSpanMm, points: trimmerPoints, count: 4 });

    // Trimmer centrelines run the deck's whole span, like an ordinary joist,
    // extended by bearing at both true ends -- extendFull() gives the same
    // figure clipAndExtend() would with no holes to cut against.
    const [ts, te] = extendFull(spanHalf, bearing);
    for (const acrossPos of [acrossLo, acrossHi]) trimmerSegs.push(mkSpanSeg(ts, te, acrossPos));
  }

  const full: JoistSegment[] = [];
  const cut: JoistSegment[] = [];
  const [fs, fe] = extendFull(spanHalf, bearing);
  joists.forEach((j, i) => {
    const acrossPos = acrossOf(j);
    const holes = holesPerJoist.get(i);
    if (!holes || holes.length === 0) {
      full.push(mkSpanSeg(fs, fe, acrossPos));
      return;
    }
    for (const [s, e] of clipAndExtend(spanHalf, bearing, holes)) cut.push(mkSpanSeg(s, e, acrossPos));
  });

  const cutJoists = [...cutJoistLengths.entries()].map(([lengthMm, count]) => ({ lengthMm, count }));
  const trimmed: TrimmedDeck = { fullJoists: full.length, cutJoists, headers, trimmers, openings };
  const layout: DeckJoistLayout = { full, cut, headers: headerSegs, trimmers: deck.joist ? trimmerSegs : [], openings };
  return { trimmed, layout };
}

export function trimDeck(f: Floor, deck: Deck): TrimmedDeck {
  return computeTrim(f, deck).trimmed;
}

/** The positioned layout every drawing and export path reads -- see the
 *  module header. */
export function deckJoistLayout(f: Floor, deck: Deck): DeckJoistLayout {
  return computeTrim(f, deck).layout;
}
