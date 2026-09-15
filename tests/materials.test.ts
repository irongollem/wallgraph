// Wall material takeoff: stud/plate counts off the drawn posts, a door's
// header and cripples, lining sheets and block counts off the mitered face
// areas core/surface.ts already reports, and the incomplete markers a
// missing construction fact produces. floorMaterials() is a pure function of
// its arguments -- no cache to invalidate -- so "revision" is exercised by
// calling it again after mutating the document and checking the result
// tracks the change.
import {
  emptyDoc, newId, Wall, Opening, Floor, PlanDoc,
} from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { detectRooms } from "../src/core/rooms";
import { floorSurface, type FloorSurface } from "../src/core/surface";
import { floorMaterials } from "../src/core/materials";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

const W = 4000, D = 3000, H = 2600;
const POST_MM = 600, POST_WIDTH = 38, FRAME_TH = 89;

/**
 * A 4000x3000 rectangle. top: bare timber frame (stud/plate). right: timber
 * frame with a door (header/cripples). bottom: lined. left: cellenbeton
 * block.
 */
function buildDoc(): {
  doc: PlanDoc; f: Floor; top: Wall; right: Wall; bottom: Wall; left: Wall; door: Opening;
} {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const pts = [v(0, 0), v(W, 0), v(W, D), v(0, D)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });

  const top: Wall = {
    id: newId("w"), a: ids[0]!, b: ids[1]!, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
  const door = opening({ kind: "door", t: 1500, width: 830, sillHeight: 0, height: 2315 });
  const right: Wall = {
    id: newId("w"), a: ids[1]!, b: ids[2]!, thickness: FRAME_TH, bulge: 0, openings: [door],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
  const bottom: Wall = {
    id: newId("w"), a: ids[2]!, b: ids[3]!, thickness: 100, bulge: 0, openings: [],
    lining: { boardMm: 12, layers: 2 },
  };
  const left: Wall = {
    id: newId("w"), a: ids[3]!, b: ids[0]!, thickness: 240, bulge: 0, openings: [],
    material: "aerated", blockMm: { length: 600, height: 250 },
  };
  f.walls = [top, right, bottom, left];
  return { doc, f, top, right, bottom, left, door };
}

const materialsOf = (doc: PlanDoc, f: Floor) => {
  const resolved = resolveFloor(f);
  const rooms = detectRooms(f);
  const surface = floorSurface(f, resolved, rooms);
  return { resolved, surface, m: floorMaterials(doc, f, resolved, surface) };
};

// ---- studs and plates on a bare frame ---------------------------------------

{
  const { doc, f, top } = buildDoc();
  const { resolved, m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === top.id)!;
  check("a bare timber frame is classified framed-timber", wt.system === "framed-timber", wt.system);

  const rw = resolved.walls.get(top.id)!;
  const stud = wt.members.find(x => x.name === "stud");
  check("a stud member exists", stud !== undefined);
  check("stud count equals the drawn post count", stud!.count === rw.posts.length,
    `${stud!.count} vs ${rw.posts.length}`);
  check("stud count is 6 (a 4000 mm run at 600 mm centres takes 7 bays, 6 interior posts)",
    rw.posts.length === 6, String(rw.posts.length));
  check("stud length is storey height less two post widths",
    stud!.lengthMm === H - 2 * POST_WIDTH, String(stud!.lengthMm));
  check("stud section is postWidth x thickness",
    stud!.sectionMm.w === POST_WIDTH && stud!.sectionMm.d === FRAME_TH);
  check("a stud is not spliceable", stud!.spliceable === false);

  const plate = wt.members.find(x => x.name === "plate");
  check("a plate member exists", plate !== undefined);
  check("two plates", plate!.count === 2, String(plate!.count));
  check("plate is spliceable", plate!.spliceable === true);
  const frameLen = (rw.faces.left + rw.faces.right) / 2;
  check("plate length is the frame length (mean of the mitered faces)",
    near(plate!.lengthMm, frameLen, 1), `${plate!.lengthMm} vs ${frameLen}`);
  check("wt.lengthMm is the same frame length", near(wt.lengthMm, frameLen, 1));

  check("no noggings without noggingRows", wt.members.every(x => x.name !== "nogging"));
  check("no headers on an opening-free wall", wt.members.every(x => x.name !== "header"));
}

// ---- noggings ----------------------------------------------------------------

{
  const { doc, f, top } = buildDoc();
  top.noggingRows = 1;
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === top.id)!;
  const nogging = wt.members.find(x => x.name === "nogging");
  check("a nogging row produces a nogging member", nogging !== undefined);
  check("nogging is not spliceable", nogging?.spliceable === false);
}

// ---- a door pushes a header and cripples above it ----------------------------

{
  const { doc, f, right, door } = buildDoc();
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === right.id)!;

  const header = wt.members.find(x => x.name === "header");
  check("a door produces a header", header !== undefined);
  check("header length is opening width + 2 x post width",
    header!.lengthMm === door.width + 2 * POST_WIDTH, String(header?.lengthMm));
  check("header is doubled on edge", header!.count === 2, String(header?.count));
  check("header is not spliceable", header!.spliceable === false);

  check("a sill-less door (sillHeight 0) gets no sill piece", wt.members.every(x => x.name !== "sill"));

  const above = wt.members.find(x => x.name === "cripple");
  check("cripples stand above the header", above !== undefined);
  const expectedAbove = H - 2 * POST_WIDTH - (0 + 2315); // storey - 2 posts - head (sill 0 + height)
  check("cripple-above length is storey height less two posts and the head",
    above!.lengthMm === expectedAbove, `${above?.lengthMm} vs ${expectedAbove}`);
  check("no below-sill cripples for a door with no sill",
    wt.members.filter(x => x.name === "cripple").length === 1);
}

// ---- a window also gets a sill piece and cripples below it ------------------

{
  const { doc, f, right } = buildDoc();
  right.openings = [opening({ kind: "window", t: 1500, width: 1200, sillHeight: 900, height: 1200 })];
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === right.id)!;

  const sill = wt.members.find(x => x.name === "sill");
  check("a window with a sill produces a sill piece", sill !== undefined);
  check("sill length matches the header length", sill!.lengthMm === 1200 + 2 * POST_WIDTH);
  check("one sill piece", sill!.count === 1);

  const cripples = wt.members.filter(x => x.name === "cripple");
  check("both above and below cripples exist for a window", cripples.length === 2, String(cripples.length));
}

// ---- lining sheets on a 4000x3000 room ---------------------------------------

{
  const { doc, f, bottom } = buildDoc();
  const { surface, m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === bottom.id)!;
  const wsurf = surface.walls.find(x => x.wallId === bottom.id)!;

  // No facade stated: both faces are lined.
  const expectedBoard = (wsurf.faces[0].netMm2 + wsurf.faces[1].netMm2) * bottom.lining!.layers;
  check("boardMm2 is both faces' net area times the layer count",
    near(wt.boardMm2, expectedBoard, 1), `${wt.boardMm2} vs ${expectedBoard}`);

  const waste = 0.10, sheetArea = 1200 * 2600; // document defaults
  const expectedSheets = Math.ceil((expectedBoard * (1 + waste)) / sheetArea);
  check("sheets is the board area with waste over the default sheet size",
    wt.sheets === expectedSheets, `${wt.sheets} vs ${expectedSheets}`);
  check("lining produces no members (not a frame)", wt.members.length === 0);
  check("no lining incomplete marker when the surface is present",
    !wt.incomplete.includes("lining"));
}

// ---- block count for a cellenbeton wall ---------------------------------------

{
  const { doc, f, left } = buildDoc();
  const { surface, m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === left.id)!;
  const wsurf = surface.walls.find(x => x.wallId === left.id)!;

  check("aerated concrete is classified block", wt.system === "block", wt.system);
  const faceArea = Math.min(wsurf.faces[0].netMm2, wsurf.faces[1].netMm2);
  check("blockMm2 is the smaller face's net area", near(wt.blockMm2, faceArea, 1));
  const expectedBlocks = Math.ceil((faceArea * 1.10) / (600 * 250));
  check("blocks is the face area with waste over one block's area",
    wt.blocks === expectedBlocks, `${wt.blocks} vs ${expectedBlocks}`);
  check("a block wall carries no frame members", wt.members.length === 0);
}

// ---- incomplete markers -------------------------------------------------------

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];

  const framedNoWidth: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: 89, bulge: 0, openings: [],
    material: "timber", postMm: 600, // no postWidthMm
  };
  f.walls = [framedNoWidth];
  const { resolved, m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === framedNoWidth.id)!;
  check("a frame with no post width is incomplete", wt.incomplete.includes("postWidth"));
  check("no members when the frame is incomplete", wt.members.length === 0);
  check("still classified framed-timber", wt.system === "framed-timber");

  const rw = resolved.walls.get(framedNoWidth.id);
  check("resolveFloor still resolves the wall itself", rw !== undefined);
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  const blockNoFormat: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0, openings: [],
    material: "masonry", // no blockMm
  };
  f.walls = [blockNoFormat];
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === blockNoFormat.id)!;
  check("a block wall with no block format is incomplete", wt.incomplete.includes("block"));
  check("blocks is 0 without a format", wt.blocks === 0);
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  const sandwichNoPanel: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: 200, bulge: 0, openings: [],
    material: "sandwich", // no panelMm
  };
  f.walls = [sandwichNoPanel];
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === sandwichNoPanel.id)!;
  check("a sandwich wall with no panel width is incomplete", wt.incomplete.includes("panel"));
  check("panels is 0 without a width", wt.panels === 0);
}

{
  // A wall stating a lining whose surface entry is missing (a mismatched
  // FloorSurface, as if the caller passed one from a different derivation).
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  const linedWall: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: 100, bulge: 0, openings: [],
    lining: { boardMm: 12, layers: 1 },
  };
  f.walls = [linedWall];
  const resolved = resolveFloor(f);
  const emptySurface: FloorSurface = {
    walls: [], rooms: [], grossMm2: 0, openingsMm2: 0, netMm2: 0, revealsMm2: 0,
    finishMm2: 0, innerMm2: 0, unroomedMm2: 0, cladFaces: 0,
  };
  const m = floorMaterials(doc, f, resolved, emptySurface);
  const wt = m.walls.find(x => x.wallId === linedWall.id)!;
  check("a stated lining with no surface entry is incomplete",
    wt.incomplete.includes("lining"));
  check("boardMm2 is 0 when the surface entry is missing", wt.boardMm2 === 0);
}

// ---- bySystem nests members through the document's stock lengths ------------

{
  const { doc, f, top } = buildDoc();
  const { m } = materialsOf(doc, f);
  const framed = m.bySystem.find(x => x.system === "framed-timber")!;
  check("bySystem groups both framed walls (top and right)", framed.walls === 2, String(framed.walls));
  const stud = m.walls.find(x => x.wallId === top.id)!.members.find(x => x.name === "stud")!;
  check("nested totalMm covers at least the top wall's own studs",
    framed.nested.totalMm >= stud.count * stud.lengthMm);
  check("nested buys at least one bar when there are members", framed.nested.boughtMm > 0);
}

// ---- purity: mutating the wall changes the result on the next call ----------

{
  const { doc, f, top } = buildDoc();
  const before = materialsOf(doc, f).m.walls.find(x => x.wallId === top.id)!;
  const beforeStud = before.members.find(x => x.name === "stud")!.lengthMm;

  top.postWidthMm = 60;
  const after = materialsOf(doc, f).m.walls.find(x => x.wallId === top.id)!;
  const afterStud = after.members.find(x => x.name === "stud")!.lengthMm;

  check("floorMaterials is not cached -- a changed post width changes the next call's result",
    afterStud !== beforeStud, `${beforeStud} -> ${afterStud}`);
  check("the new stud length reflects the new post width", afterStud === H - 2 * 60);
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
