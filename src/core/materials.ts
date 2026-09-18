// Material takeoff: what a storey's walls need, counted off the construction
// facts on each wall and the mitered geometry resolveFloor() derives, and what
// its decks need, counted off their joist set-out; nested into stock lengths
// per system. Pure and uncached like the
// rest of core/ -- `resolved` and `surface` are passed in rather than
// recomputed so a caller already holding revision-cached geometry does not
// derive the floor twice. Reported, never enforced: nothing here decides what
// gets built, only what the drawn construction implies.
import type { Floor, Id, PlanDoc, Wall, BoardKind } from "../model/doc";
import {
  isBlockMaterial, isFramedMaterial, buildUpOf, frameOf, BOARD_KINDS, wallPostMm, decksOf,
} from "../model/doc";
import { wallTopRange } from "../model/profile";
import { type Deck, bearingOf } from "../model/deck";
import { deckAcrossMm, deckSpanMm } from "./deck";
import { trimDeck } from "./trimmer";
import { kerfMm, sheetOf, stockLengths, wastePct } from "../model/materials";
import type { Resolved, ResolvedWall } from "./resolve";
import { floorSurface, type FloorSurface, type WallSurface } from "./surface";
import { detectRooms } from "./rooms";
import { resolveLeaves } from "./leaf";
import { nest, type NestResult, type Piece } from "./stock";
import { computeBacking, frameLayoutOf, wallElevation, type PlacedMember, type WallBacking } from "./frame";

/** What a wall's frame is built as -- decides which members and quantities
 *  the takeoff counts, not just what draws as poché. */
export type WallSystem = "framed-timber" | "framed-steel" | "block" | "sandwich" | "other";

/**
 * A timber wall counts as "framed-timber" and a steel one as "framed-steel"
 * only when it also states `postMm` -- a frame with no drawn posts is not a
 * frame this takeoff can count members for, and reads as "other" with no
 * members, the same way a wall with no material at all does.
 */
function systemOf(w: Wall): WallSystem {
  if (isFramedMaterial(w.material)) {
    if (wallPostMm(w) === undefined) return "other";
    return w.material === "steel" ? "framed-steel" : "framed-timber";
  }
  if (isBlockMaterial(w.material)) return "block";
  if (w.material === "sandwich") return "sandwich";
  return "other";
}

/**
 * A leaf's system, unlike systemOf(): a voorzetwand is a frame regardless of
 * whether it states `postMm`. systemOf() falls to "other" -- silently
 * dropping every member -- for exactly the wall a document-stated frame
 * would report as incomplete instead. A leaf's material is always "timber"
 * or "steel" (FaceFrame), so the block/sandwich branches never fire; they
 * are kept only so this stays systemOf()'s obvious counterpart.
 */
function leafSystemOf(w: Wall): WallSystem {
  if (isFramedMaterial(w.material)) return w.material === "steel" ? "framed-steel" : "framed-timber";
  if (isBlockMaterial(w.material)) return "block";
  if (w.material === "sandwich") return "sandwich";
  return "other";
}

/** A structural member of a wall system: one shape, one count. `header` is a
 *  wall frame's own lintel member (over a door or window); a deck's header
 *  across a trimmed opening (issue #64) is `deckHeader` -- the Dutch labels
 *  differ (latei vs. kopbalk) and conflating them would misname one on the
 *  materiaalstaat. `trimmer` is the doubled joist either side of the hole
 *  (wisselbalk); its own `Member.count` already carries the doubling (2 per
 *  trimmer position), so its section is the single, undoubled joist size. */
export type MemberName =
  | "stud" | "plate" | "nogging" | "header" | "sill" | "cripple" | "rail"
  | "king" | "jack" | "backing" | "joist" | "rim" | "deckHeader" | "trimmer";

export interface Member {
  name: MemberName;
  sectionMm: { w: number; d: number };
  lengthMm: number;
  count: number;
  spliceable: boolean;
}

export interface WallTakeoff {
  wallId: Id;
  /**
   * The host wall and face this takeoff's voorzetwand stands on, absent on a
   * wall the document itself states. `wallId` stays the id of the wall the
   * figures are OF, so a leaf can be looked up; this is what says whose face
   * it is.
   */
  host?: { wallId: Id; side: "left" | "right" };
  system: WallSystem;
  /** Frame length: mean of the two mitered face lengths from resolveFloor(). */
  lengthMm: number;
  heightMm: number;
  /** Studs, plates/rails, noggings, headers, sills, cripples, king studs,
   *  jack studs and backing -- empty for "block", "sandwich" and "other". */
  members: Member[];
  /** core/frame.ts's FrameLayout.suggestedBreaksMm for this wall -- present
   *  only where the current frame already orders a stud, king or backing
   *  stud too long for the document's longest stock length. */
  suggestedBreaksMm?: number[];
  /**
   * Build-up board area, one entry per kind present on either face (see
   * buildUpOf()): a kind on both faces, or twice in one face's own stack,
   * sums into that one entry. Waste is not included here -- only in the
   * aggregate `sheets` count below, the same split boardMm2/sheets used.
   */
  boards: { kind: BoardKind; areaMm2: number }[];
  insulationMm2: number;
  blocks: number;
  blockMm2: number;
  panels: number;
  /** What could not be counted and why. */
  incomplete: ("postWidth" | "block" | "panel" | "boards")[];
}

export interface DeckTakeoff {
  deckId: Id;
  /** Clear span between the supports, mm. */
  spanMm: number;
  /** Joists and the two rim boards, empty when no section is stated. */
  members: Member[];
  /** Decking area, mm²; 0 when the deck states no decking. Waste is in `sheets` only. */
  deckingMm2: number;
  sheets: number;
  incomplete: "joist"[];
}

export interface FloorMaterials {
  walls: WallTakeoff[];
  /** The storey's decks: per deck, and summed and nested as one system. */
  decks: {
    perDeck: DeckTakeoff[];
    members: Member[];
    nested: NestResult;
    deckingMm2: number;
    sheets: number;
  };
  bySystem: {
    system: WallSystem;
    walls: number;
    members: Member[];
    nested: NestResult;
    /** Summed from every wall's own `boards`, one entry per kind present in
     *  the system, with `sheets` nested at that kind's own sheet size --
     *  offcuts carry between walls, so this is not the per-wall counts summed. */
    boards: { kind: BoardKind; areaMm2: number; sheets: number }[];
    insulationMm2: number;
    blocks: number;
    panels: number;
  }[];
}

function sameMember(a: Member, b: Member): boolean {
  return a.name === b.name && a.spliceable === b.spliceable && a.lengthMm === b.lengthMm
    && a.sectionMm.w === b.sectionMm.w && a.sectionMm.d === b.sectionMm.d;
}

function mergeMembers(into: Member[], add: readonly Member[]): void {
  for (const m of add) {
    const existing = into.find(x => sameMember(x, m));
    if (existing) existing.count += m.count;
    else into.push({ ...m, sectionMm: { ...m.sectionMm } });
  }
}

/** A PlacedMember dropped to the shape mergeMembers() aggregates on -- its
 *  rectangle (x/y/w/h) is frame.ts's own placement concern, not the takeoff's. */
function asMember(p: PlacedMember): Member {
  return { name: p.name, sectionMm: p.sectionMm, lengthMm: p.lengthMm, count: p.count, spliceable: p.spliceable };
}

/**
 * One framed wall's members, aggregated from frame.ts's placed layout by
 * (name, spliceable, section, length) -- the takeoff counts total board feet
 * per shape, not where each piece stands. Empty with
 * `incomplete: ["postWidth"]` when the wall states no post profile width --
 * frameLayoutOf() returns null in exactly that case, since a frame at these
 * centres exists but its member sizes do not.
 */
function framedMembers(
  f: Floor, w: Wall, rw: ResolvedWall, backing: ReadonlyMap<Id, WallBacking>,
  incomplete: WallTakeoff["incomplete"], maxStockMm: number,
): { members: Member[]; suggestedBreaksMm?: number[] } {
  const layout = frameLayoutOf(f, w, rw, backing, maxStockMm);
  if (!layout) {
    incomplete.push("postWidth");
    return { members: [] };
  }
  const members: Member[] = [];
  mergeMembers(members, layout.members.map(asMember));
  return { members, suggestedBreaksMm: layout.suggestedBreaksMm };
}

/**
 * `leaf`, present only when `w` is itself a voorzetwand leaf: the host face
 * it stands on (carried into `WallTakeoff.host`) and where its ROOM face
 * sits. A leaf's own tangent runs the same direction as its host's (see
 * leaf.ts's buildLeafWall(): its `a`/`b` are the host's mapped `a`/`b`, not
 * swapped), so its "left"/"right" split by invariant 2 lines up with the
 * host's -- a leaf derived from the host's `left` face stands further along
 * +perp(tangent) than the host's own left face, i.e. further from the host
 * and so still facing the same room, on the leaf's own `left`. A leaf derived
 * from `right` is room-side on its own `right` the same way.
 *
 * `leafSurfaceOf`, present only when `w` is a HOST wall, looks up the
 * WallSurface of the leaf standing on one of its faces (undefined where that
 * face states no frame), for the board-area rule below.
 */
function wallTakeoffOf(
  f: Floor, w: Wall, rw: ResolvedWall, surface: FloorSurface, waste: number,
  backing: ReadonlyMap<Id, WallBacking>, maxStockMm: number,
  opts: {
    leaf?: { host: { wallId: Id; side: "left" | "right" } };
    leafSurfaceOf?: (wallId: Id, side: "left" | "right") => WallSurface | undefined;
  } = {},
): WallTakeoff {
  const system = opts.leaf ? leafSystemOf(w) : systemOf(w);
  // Whole mm: a cut length, and what nest() and the member merge compare exactly.
  const lengthMm = Math.round((rw.faces.left + rw.faces.right) / 2);
  const heightMm = wallTopRange(f, w, rw.length).max;
  const incomplete: WallTakeoff["incomplete"] = [];

  const framed = system === "framed-timber" || system === "framed-steel"
    ? framedMembers(f, w, rw, backing, incomplete, maxStockMm)
    : { members: [] as Member[] };
  const members = framed.members;

  const wsurf = surface.walls.find(s => s.wallId === w.id);

  let blocks = 0, blockMm2 = 0;
  if (system === "block") {
    // One face's net area -- the smaller of the two, the same conservative
    // choice ResolvedWall.clearLength makes, since the two faces can differ
    // when the rooms either side carry different ceiling heights.
    const faceArea = wsurf ? Math.min(wsurf.faces[0].netMm2, wsurf.faces[1].netMm2) : 0;
    blockMm2 = faceArea;
    if (w.blockMm && w.blockMm.length > 0 && w.blockMm.height > 0) {
      // core/frame.ts's own courses, not a second area-based estimate: a
      // whole block and a cut piece each count as one, so the count already
      // reflects the stretcher bond and the cuts at the ends and jambs
      // rather than approximating them from an area.
      const elevation = wallElevation(f, w, rw);
      const pieces = elevation.courses.reduce((n, c) => n + c.blocks.length, 0);
      blocks = Math.ceil(pieces * (1 + waste));
    } else {
      incomplete.push("block");
    }
  }

  let panels = 0;
  if (system === "sandwich") {
    if (w.panelMm && w.panelMm > 0) panels = Math.ceil(lengthMm / w.panelMm);
    else incomplete.push("panel");
  }

  // One entry per kind present on either face: a board's own area is the
  // FACE's net area it stands on (see floorSurface()), regardless of the
  // board's own thickness, so a kind stacked twice on one face -- or once on
  // each -- counts twice. #71 moves this to each board's own face; today
  // every board on a face shares that face's one structural-face figure.
  //
  // A face that carries a frame (frameOf() set) is hung on the LEAF, not on
  // the host's own structural face -- the boards stand on the studs, at a
  // stand-off in front of the wall they are drawn against. An unframed face
  // is unchanged (#71 is what refines the finish face for those).
  const boardAreas = new Map<BoardKind, number>();
  let boardsIncomplete = false;
  for (const side of ["left", "right"] as const) {
    const fu = buildUpOf(w, side);
    if (!fu) continue;
    let area: number | undefined;
    if (frameOf(w, side)) {
      const leafSurf = opts.leafSurfaceOf?.(w.id, side);
      // Room face = same side letter as the host frame side, see the
      // function comment above.
      area = leafSurf?.faces[side === "left" ? 0 : 1].netMm2;
    } else {
      area = wsurf?.faces[side === "left" ? 0 : 1].netMm2;
    }
    if (area === undefined) { boardsIncomplete = true; continue; }
    for (const b of fu.boards) boardAreas.set(b.kind, (boardAreas.get(b.kind) ?? 0) + area);
  }
  if (boardsIncomplete) incomplete.push("boards");
  const boards = BOARD_KINDS
    .filter(kind => boardAreas.has(kind))
    .map(kind => ({ kind, areaMm2: boardAreas.get(kind)! }));

  // The cavity's own area: one face's net area. A host wall reads the
  // smaller of the two, the same conservative choice the block body makes --
  // see above. A leaf's two faces are not two room faces (one looks into the
  // room, the other at the stand-off against the host), so a leaf reads its
  // own room face instead -- see the function comment above.
  const insulationMm2 = !w.insulated || !wsurf ? 0
    : opts.leaf ? wsurf.faces[opts.leaf.host.side === "left" ? 0 : 1].netMm2
    : Math.min(wsurf.faces[0].netMm2, wsurf.faces[1].netMm2);

  return {
    wallId: w.id, ...(opts.leaf ? { host: opts.leaf.host } : {}),
    system, lengthMm, heightMm, members, suggestedBreaksMm: framed.suggestedBreaksMm,
    boards, insulationMm2, blocks, blockMm2, panels, incomplete,
  };
}

/**
 * One deck's timber: a joist at every UNCUT set-out position, cut to the
 * clear span plus the bearing at both ends and never spliced, since a joist
 * spliced between its supports is not the member that was set out; a rim
 * board across each joist end at the same section, spliceable like a wall
 * plate; and, where trimDeck() (core/trimmer.ts) finds a hole in the deck
 * (issue #64), the shortened cut-joist stubs in place of the full-length
 * joists they replace, one `deckHeader` per header the hole needs and one
 * `trimmer` entry per hole counting all its doubled pieces (both positions,
 * each doubled -- see TrimmedDeck's own comment on why one entry covers
 * both). Decking sheets come off the platform area, unreduced by the hole --
 * an opening's own decking is simply not there to sheet, not a cut piece to
 * count.
 */
export function deckTakeoffOf(f: Floor, d: Deck, waste: number, sheetArea: number): DeckTakeoff {
  const spanMm = deckSpanMm(d);
  const incomplete: DeckTakeoff["incomplete"] = [];
  const members: Member[] = [];
  if (d.joist) {
    const sectionMm = { w: d.joist.w, d: d.joist.d };
    const trimmed = trimDeck(f, d);
    if (trimmed.fullJoists > 0) {
      members.push({
        name: "joist", sectionMm: { ...sectionMm }, lengthMm: spanMm + 2 * bearingOf(d),
        count: trimmed.fullJoists, spliceable: false,
      });
    }
    for (const cut of trimmed.cutJoists) {
      members.push({ name: "joist", sectionMm: { ...sectionMm }, lengthMm: cut.lengthMm, count: cut.count, spliceable: false });
    }
    for (const header of trimmed.headers) {
      members.push({ name: "deckHeader", sectionMm: { ...sectionMm }, lengthMm: header.spanMm, count: 1, spliceable: false });
    }
    for (const trimmer of trimmed.trimmers) {
      members.push({ name: "trimmer", sectionMm: { ...sectionMm }, lengthMm: trimmer.spanMm, count: trimmer.count, spliceable: false });
    }
    members.push({ name: "rim", sectionMm: { ...sectionMm }, lengthMm: deckAcrossMm(d), count: 2, spliceable: true });
  } else {
    incomplete.push("joist");
  }
  const deckingMm2 = d.deckingMm ? d.width * d.depth : 0;
  const sheets = deckingMm2 > 0 ? Math.ceil((deckingMm2 * (1 + waste)) / sheetArea) : 0;
  return { deckId: d.id, spanMm, members, deckingMm2, sheets, incomplete };
}

export function floorMaterials(doc: PlanDoc, f: Floor, resolved: Resolved, surface: FloorSurface): FloorMaterials {
  const waste = wastePct(doc) / 100;
  const stockList = stockLengths(doc);
  const maxStockMm = stockList.length > 0 ? stockList[stockList.length - 1]! : Infinity;

  // The leaf floor is derived here rather than taken as a parameter, unlike
  // `resolved`/`surface`: those are the caller's own revision-cached
  // geometry of THIS floor, but an optional or caller-supplied leaf floor
  // would let a consumer hand in one that disagrees with the plan this
  // takeoff was otherwise drawn from. Deriving it from the same `resolved`
  // this function already received keeps the two in agreement by
  // construction.
  const leaves = resolveLeaves(f, resolved);
  const leafRooms = detectRooms(leaves.leaf.floor);
  const leafSurface = floorSurface(leaves.leaf.floor, leaves.resolved, leafRooms);
  const leafBacking = computeBacking(leaves.leaf.floor);
  const leafSurfaceOf = (wallId: Id, side: "left" | "right"): WallSurface | undefined => {
    const leafWall = leaves.leaf.leafOf(wallId, side);
    if (!leafWall) return undefined;
    return leafSurface.walls.find(s => s.wallId === leafWall.id);
  };

  const backing = computeBacking(f);
  const walls: WallTakeoff[] = [];
  for (const w of f.walls) {
    const rw = resolved.walls.get(w.id);
    if (!rw) continue;
    walls.push(wallTakeoffOf(f, w, rw, surface, waste, backing, maxStockMm, { leafSurfaceOf }));
  }
  // Every voorzetwand leaf as one more wall of its own system, appended into
  // the same array: bySystem below groups everything in `walls` by
  // systemOf()'s key regardless of where it came from, so a leaf's members
  // nest into the SAME stock buy as an ordinary partition of that system.
  for (const w of leaves.leaf.floor.walls) {
    const rw = leaves.resolved.walls.get(w.id);
    if (!rw) continue;
    const host = leaves.leaf.hostOf.get(w.id)!;
    walls.push(wallTakeoffOf(leaves.leaf.floor, w, rw, leafSurface, waste, leafBacking, maxStockMm, { leaf: { host } }));
  }

  interface SystemEntry {
    walls: number; members: Member[]; boards: Map<BoardKind, number>;
    insulationMm2: number; blocks: number; panels: number;
  }
  const bySystemMap = new Map<WallSystem, SystemEntry>();
  const order: WallSystem[] = [];
  for (const wt of walls) {
    let entry = bySystemMap.get(wt.system);
    if (!entry) {
      entry = { walls: 0, members: [], boards: new Map(), insulationMm2: 0, blocks: 0, panels: 0 };
      bySystemMap.set(wt.system, entry);
      order.push(wt.system);
    }
    entry.walls++;
    for (const b of wt.boards) entry.boards.set(b.kind, (entry.boards.get(b.kind) ?? 0) + b.areaMm2);
    entry.insulationMm2 += wt.insulationMm2;
    entry.blocks += wt.blocks;
    entry.panels += wt.panels;
    mergeMembers(entry.members, wt.members);
  }

  const kerf = kerfMm(doc);
  const bySystem = order.map(system => {
    const entry = bySystemMap.get(system)!;
    const pieces: Piece[] = entry.members.map(m => (
      { name: m.name, lengthMm: m.lengthMm, count: m.count, spliceable: m.spliceable }
    ));
    // From the summed area per kind, not the per-wall sheet counts: offcuts
    // carry between walls, and each kind nests against its own sheet size.
    const boards = BOARD_KINDS
      .filter(kind => entry.boards.has(kind))
      .map(kind => {
        const areaMm2 = entry.boards.get(kind)!;
        const sheet = sheetOf(doc, kind);
        return { kind, areaMm2, sheets: Math.ceil((areaMm2 * (1 + waste)) / (sheet.width * sheet.height)) };
      });
    return {
      system, walls: entry.walls, members: entry.members, nested: nest(pieces, stockList, kerf),
      boards, insulationMm2: entry.insulationMm2,
      blocks: entry.blocks, panels: entry.panels,
    };
  });

  // Decking carries no board kind of its own (Deck states no `kind` field),
  // so it nests against OSB's own sheet size -- the ordinary decking board.
  const deckSheet = sheetOf(doc, "osb");
  const deckSheetArea = deckSheet.width * deckSheet.height;
  const perDeck = decksOf(f).map(d => deckTakeoffOf(f, d, waste, deckSheetArea));
  const deckMembers: Member[] = [];
  let deckingMm2 = 0;
  for (const dt of perDeck) { mergeMembers(deckMembers, dt.members); deckingMm2 += dt.deckingMm2; }
  const decks = {
    perDeck, members: deckMembers,
    nested: nest(deckMembers.map(m => ({ name: m.name, lengthMm: m.lengthMm, count: m.count, spliceable: m.spliceable })), stockList, kerf),
    deckingMm2,
    sheets: deckingMm2 > 0 ? Math.ceil((deckingMm2 * (1 + waste)) / deckSheetArea) : 0,
  };

  return { walls, bySystem, decks };
}
