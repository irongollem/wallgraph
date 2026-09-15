// Wall material takeoff: what a storey's walls need, counted off the
// construction facts on each wall and the mitered geometry resolveFloor()
// derives, nested into stock lengths per system. Pure and uncached like the
// rest of core/ -- `resolved` and `surface` are passed in rather than
// recomputed so a caller already holding revision-cached geometry does not
// derive the floor twice. Reported, never enforced: nothing here decides what
// gets built, only what the drawn construction implies.
import type { Floor, Id, PlanDoc, Wall } from "../model/doc";
import {
  isBlockMaterial, isFramedMaterial, liningSideOf, wallHeight, wallPostMm,
} from "../model/doc";
import { kerfMm, sheetMm, stockLengths, wastePct } from "../model/materials";
import type { Resolved, ResolvedWall } from "./resolve";
import type { FloorSurface } from "./surface";
import { nest, type NestResult, type Piece } from "./stock";
import { computeBacking, frameLayoutOf, type PlacedMember, type WallBacking } from "./frame";

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
  incomplete: WallTakeoff["incomplete"],
): Member[] {
  const layout = frameLayoutOf(f, w, rw, backing);
  if (!layout) {
    incomplete.push("postWidth");
    return [];
  }
  const members: Member[] = [];
  mergeMembers(members, layout.members.map(asMember));
  return members;
}

function wallTakeoffOf(
  f: Floor, w: Wall, rw: ResolvedWall, surface: FloorSurface, waste: number, sheetArea: number,
  backing: ReadonlyMap<Id, WallBacking>,
): WallTakeoff {
  const system = systemOf(w);
  // Whole mm: a cut length, and what nest() and the member merge compare exactly.
  const lengthMm = Math.round((rw.faces.left + rw.faces.right) / 2);
  const heightMm = wallHeight(f, w);
  const incomplete: WallTakeoff["incomplete"] = [];

  const members = system === "framed-timber" || system === "framed-steel"
    ? framedMembers(f, w, rw, backing, incomplete)
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

export function floorMaterials(doc: PlanDoc, f: Floor, resolved: Resolved, surface: FloorSurface): FloorMaterials {
  const waste = wastePct(doc) / 100;
  const sheet = sheetMm(doc);
  const sheetArea = sheet.width * sheet.height;

  const backing = computeBacking(f);
  const walls: WallTakeoff[] = [];
  for (const w of f.walls) {
    const rw = resolved.walls.get(w.id);
    if (!rw) continue;
    walls.push(wallTakeoffOf(f, w, rw, surface, waste, sheetArea, backing));
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
