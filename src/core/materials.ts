// Wall material takeoff: what a storey's walls need, counted off the
// construction facts on each wall and the mitered geometry resolveFloor()
// derives, nested into stock lengths per system. Pure and uncached like the
// rest of core/ -- `resolved` and `surface` are passed in rather than
// recomputed so a caller already holding revision-cached geometry does not
// derive the floor twice. Reported, never enforced: nothing here decides what
// gets built, only what the drawn construction implies.
import type { Floor, Id, PlanDoc, Wall } from "../model/doc";
import {
  isBlockMaterial, isFramedMaterial, liningSideOf, openingHeight, openingSill,
  wallHeight, wallPostMm, wallPostWidthMm,
} from "../model/doc";
import { kerfMm, sheetMm, stockLengths, wastePct } from "../model/materials";
import { postBays, type Resolved, type ResolvedWall } from "./resolve";
import type { FloorSurface } from "./surface";
import { nest, type NestResult, type Piece } from "./stock";
import { arcTangentAt } from "../geometry/arc";
import { dot, scale, v, type Vec } from "../geometry/vec";

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

/** A structural member of a wall system: one shape, one count. */
export type MemberName =
  | "stud" | "plate" | "nogging" | "header" | "sill" | "cripple" | "rail"
  | "king" | "jack" | "backing";

export interface Member {
  name: MemberName;
  sectionMm: { w: number; d: number };
  lengthMm: number;
  count: number;
  spliceable: boolean;
}

export interface WallTakeoff {
  wallId: Id;
  system: WallSystem;
  /** Frame length: mean of the two mitered face lengths from resolveFloor(). */
  lengthMm: number;
  heightMm: number;
  /** Studs, plates/rails, noggings, headers, sills, cripples, king studs,
   *  jack studs and backing -- empty for "block", "sandwich" and "other". */
  members: Member[];
  /** Lining board area over both lined faces (see liningSideOf), waste
   *  included only in `sheets`. */
  boardMm2: number;
  sheets: number;
  insulationMm2: number;
  blocks: number;
  blockMm2: number;
  panels: number;
  /** What could not be counted and why. */
  incomplete: ("postWidth" | "block" | "panel" | "lining")[];
}

export interface FloorMaterials {
  walls: WallTakeoff[];
  bySystem: {
    system: WallSystem;
    walls: number;
    members: Member[];
    nested: NestResult;
    boardMm2: number;
    sheets: number;
    insulationMm2: number;
    blocks: number;
    panels: number;
  }[];
}

/** postWidth x thickness for every frame member -- stud, plate/rail, nogging,
 *  header, sill and cripple all share the post's own profile; the takeoff
 *  states this rather than pricing a separate header/sill section nobody has
 *  chosen yet. */
function frameSection(postWidth: number, thickness: number): { w: number; d: number } {
  return { w: postWidth, d: thickness };
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

/** ~5 degrees either side of exactly opposite, in cosine terms -- the
 *  tolerance computeBacking() treats two collinear wall-ends as a straight
 *  pass-through rather than a corner. */
const STRAIGHT_COS = -Math.cos(5 * Math.PI / 180);

/**
 * The backing stud(s) hidden in a corner or T/cross, per node, assigned to
 * exactly one of the framed walls that meet there -- the one with the lowest
 * `id`, so per-wall figures sum to the storey figure without double
 * counting. Only walls stating both a framed material and a post width
 * count toward a node's degree; a block wall meeting a framed one triggers
 * nothing and is not counted.
 *
 * Degree 2: one backing stud (the three-stud corner) unless the two walls'
 * outgoing tangents at the node are within ~5 degrees of exactly opposite --
 * a straight run split into two walls, which resolveFloor() itself treats as
 * a plain pass-through (see its "parallel" miter case) and which needs no
 * extra stud. Degree 3+ (T or cross): two backing studs, no angle check --
 * every branch needs something to nail into regardless of the angle it
 * meets at.
 */
function computeBacking(f: Floor): Map<Id, number> {
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

  const result = new Map<Id, number>();
  for (const ends of byNode.values()) {
    if (ends.length < 2) continue;
    if (ends.length === 2 && dot(ends[0]!.out, ends[1]!.out) <= STRAIGHT_COS) continue;
    const count = ends.length === 2 ? 1 : 2;
    const wallId = ends.reduce((min, e) => (e.wall.id < min ? e.wall.id : min), ends[0]!.wall.id);
    result.set(wallId, (result.get(wallId) ?? 0) + count);
  }
  return result;
}

/**
 * Studs, plates (rails for steel), noggings, headers, sills, cripples, king
 * studs, jack studs and corner/junction backing of one framed wall. Empty
 * with `incomplete: ["postWidth"]` when the wall states no post profile
 * width -- a frame at these centres exists, but its member sizes do not.
 *
 * The count exceeds what `rw.posts` draws on the plan on purpose: a stud
 * also stands at each wall end (unless a king stud already stands there --
 * see below), a king beside each opening's jambs, a jack under each header,
 * and backing at every corner and junction a framed wall's own id claims.
 * This is what a real frame needs to stand, and a takeoff someone builds
 * from must not come out short.
 */
function framedMembers(
  w: Wall, rw: ResolvedWall, lengthMm: number, heightMm: number,
  system: "framed-timber" | "framed-steel", backingCount: number, incomplete: WallTakeoff["incomplete"],
): Member[] {
  const postWidth = wallPostWidthMm(w); // the takeoff's own figure -- not a per-bay clamp
  if (postWidth === undefined) {
    incomplete.push("postWidth");
    return [];
  }
  const section = frameSection(postWidth, w.thickness);
  const members: Member[] = [];
  const studLen = heightMm - 2 * postWidth; // plates laid flat, top and bottom

  // A stud at each drawn post position (postBays()/postsFor()'s own
  // division, so the order and the plan cannot disagree) plus one at each
  // wall end -- unless an opening's jamb sits within one post width of that
  // end, i.e. no run of body stands between the jamb and the node, in which
  // case the king stud below already occupies it.
  const nearA = w.openings.length > 0 ? Math.min(...w.openings.map(o => o.t - o.width / 2)) : Infinity;
  const nearB = w.openings.length > 0 ? Math.min(...w.openings.map(o => rw.length - (o.t + o.width / 2))) : Infinity;
  const endStuds = (nearA > postWidth ? 1 : 0) + (nearB > postWidth ? 1 : 0);
  const studCount = rw.posts.length + endStuds;
  if (studCount > 0 && studLen > 0) {
    members.push({ name: "stud", sectionMm: section, lengthMm: studLen, count: studCount, spliceable: false });
  }
  if (lengthMm > 0) {
    members.push({
      name: system === "framed-steel" ? "rail" : "plate",
      sectionMm: section, lengthMm, count: 2, spliceable: true,
    });
  }

  // King studs stand full height beside every opening's jambs, timber and
  // steel alike -- a metal-stud opening is trimmed the same way a timber one
  // is, even though its header is someone else's trade (see below).
  if (w.openings.length > 0 && studLen > 0) {
    members.push({
      name: "king", sectionMm: section, lengthMm: studLen, count: 2 * w.openings.length, spliceable: false,
    });
  }

  // Backing at this wall's share of its corners and junctions -- see
  // computeBacking(). Also shared by both systems: a corner needs a nailing
  // face whether the frame is timber or steel.
  if (backingCount > 0 && studLen > 0) {
    members.push({ name: "backing", sectionMm: section, lengthMm: studLen, count: backingCount, spliceable: false });
  }

  if (system === "framed-steel") return members; // no noggings, headers or jacks; a door frame is its own trade

  // Jack (trimmer) studs carry the header, one pair per opening.
  for (const o of w.openings) {
    const head = openingSill(o) + openingHeight(o);
    const jackLen = head - postWidth; // stands on the bottom plate
    if (jackLen > 0) {
      members.push({ name: "jack", sectionMm: section, lengthMm: jackLen, count: 2, spliceable: false });
    }
  }

  const spacing = wallPostMm(w); // defined: systemOf() would not have chosen "framed-*" otherwise
  if (spacing !== undefined && w.noggingRows && w.noggingRows > 0) {
    for (const bay of postBays(w, rw.intervals)) {
      const clear = Math.round(bay.widthMm - postWidth);
      if (clear > 0) {
        members.push({
          name: "nogging", sectionMm: section, lengthMm: clear,
          count: w.noggingRows * bay.bays, spliceable: false,
        });
      }
    }
  }

  if (spacing !== undefined) {
    for (const o of w.openings) {
      const headerLen = o.width + 2 * postWidth;
      if (headerLen > 0) {
        members.push({ name: "header", sectionMm: section, lengthMm: headerLen, count: 2, spliceable: false });
      }
      const sill = openingSill(o);
      if (sill > 0 && headerLen > 0) {
        members.push({ name: "sill", sectionMm: section, lengthMm: headerLen, count: 1, spliceable: false });
      }

      const cripples = crippleCount(o.width, spacing);
      if (cripples > 0) {
        // Above the header: storey height less the top plate (laid flat, one
        // post width), the header's own depth (on edge, so the frame's
        // thickness) and the head height.
        const head = sill + openingHeight(o);
        const above = heightMm - postWidth - w.thickness - head;
        if (above > 0) {
          members.push({ name: "cripple", sectionMm: section, lengthMm: above, count: cripples, spliceable: false });
        }
        // Below the sill: the sill height less the bottom plate and the sill
        // piece itself.
        const below = sill - 2 * postWidth;
        if (sill > 0 && below > 0) {
          members.push({ name: "cripple", sectionMm: section, lengthMm: below, count: cripples, spliceable: false });
        }
      }
    }
  }

  return members;
}

function wallTakeoffOf(
  f: Floor, w: Wall, rw: ResolvedWall, surface: FloorSurface, waste: number, sheetArea: number,
  backingCount: number,
): WallTakeoff {
  const system = systemOf(w);
  // Whole mm: a cut length, and what nest() and the member merge compare exactly.
  const lengthMm = Math.round((rw.faces.left + rw.faces.right) / 2);
  const heightMm = wallHeight(f, w);
  const incomplete: WallTakeoff["incomplete"] = [];

  const members = system === "framed-timber" || system === "framed-steel"
    ? framedMembers(w, rw, lengthMm, heightMm, system, backingCount, incomplete)
    : [];

  const wsurf = surface.walls.find(s => s.wallId === w.id);

  let blocks = 0, blockMm2 = 0;
  if (system === "block") {
    // One face's net area -- the smaller of the two, the same conservative
    // choice ResolvedWall.clearLength makes, since the two faces can differ
    // when the rooms either side carry different ceiling heights.
    const faceArea = wsurf ? Math.min(wsurf.faces[0].netMm2, wsurf.faces[1].netMm2) : 0;
    blockMm2 = faceArea;
    if (w.blockMm && w.blockMm.length > 0 && w.blockMm.height > 0) {
      blocks = faceArea > 0 ? Math.ceil((faceArea * (1 + waste)) / (w.blockMm.length * w.blockMm.height)) : 0;
    } else {
      incomplete.push("block");
    }
  }

  let panels = 0;
  if (system === "sandwich") {
    if (w.panelMm && w.panelMm > 0) panels = Math.ceil(lengthMm / w.panelMm);
    else incomplete.push("panel");
  }

  let boardMm2 = 0, sheets = 0;
  const linedLeft = liningSideOf(w, "left"), linedRight = liningSideOf(w, "right");
  if (linedLeft || linedRight) {
    if (!wsurf) {
      incomplete.push("lining");
    } else {
      const layers = w.lining!.layers;
      if (linedLeft) boardMm2 += wsurf.faces[0].netMm2 * layers;
      if (linedRight) boardMm2 += wsurf.faces[1].netMm2 * layers;
      sheets = boardMm2 > 0 ? Math.ceil((boardMm2 * (1 + waste)) / sheetArea) : 0;
    }
  }

  // The cavity's own area: one face's net area, the smaller of the two for
  // the same reason the block body reads one face -- see above.
  const insulationMm2 = w.insulated && wsurf ? Math.min(wsurf.faces[0].netMm2, wsurf.faces[1].netMm2) : 0;

  return {
    wallId: w.id, system, lengthMm, heightMm, members,
    boardMm2, sheets, insulationMm2, blocks, blockMm2, panels, incomplete,
  };
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

export function floorMaterials(doc: PlanDoc, f: Floor, resolved: Resolved, surface: FloorSurface): FloorMaterials {
  const waste = wastePct(doc) / 100;
  const sheet = sheetMm(doc);
  const sheetArea = sheet.width * sheet.height;

  const backing = computeBacking(f);
  const walls: WallTakeoff[] = [];
  for (const w of f.walls) {
    const rw = resolved.walls.get(w.id);
    if (!rw) continue;
    walls.push(wallTakeoffOf(f, w, rw, surface, waste, sheetArea, backing.get(w.id) ?? 0));
  }

  interface SystemEntry {
    walls: number; members: Member[]; boardMm2: number;
    insulationMm2: number; blocks: number; panels: number;
  }
  const bySystemMap = new Map<WallSystem, SystemEntry>();
  const order: WallSystem[] = [];
  for (const wt of walls) {
    let entry = bySystemMap.get(wt.system);
    if (!entry) {
      entry = { walls: 0, members: [], boardMm2: 0, insulationMm2: 0, blocks: 0, panels: 0 };
      bySystemMap.set(wt.system, entry);
      order.push(wt.system);
    }
    entry.walls++;
    entry.boardMm2 += wt.boardMm2;
    entry.insulationMm2 += wt.insulationMm2;
    entry.blocks += wt.blocks;
    entry.panels += wt.panels;
    mergeMembers(entry.members, wt.members);
  }

  const stock = stockLengths(doc);
  const kerf = kerfMm(doc);
  const bySystem = order.map(system => {
    const entry = bySystemMap.get(system)!;
    const pieces: Piece[] = entry.members.map(m => (
      { name: m.name, lengthMm: m.lengthMm, count: m.count, spliceable: m.spliceable }
    ));
    return {
      system, walls: entry.walls, members: entry.members, nested: nest(pieces, stock, kerf),
      // From the summed board, not the per-wall sheet counts: offcuts carry between walls.
      boardMm2: entry.boardMm2, sheets: entry.boardMm2 > 0 ? Math.ceil((entry.boardMm2 * (1 + waste)) / sheetArea) : 0,
      insulationMm2: entry.insulationMm2,
      blocks: entry.blocks, panels: entry.panels,
    };
  });

  return { walls, bySystem };
}
