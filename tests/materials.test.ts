// Wall material takeoff: stud/plate counts off the drawn posts, a door's
// header and cripples, lining sheets and block counts off the mitered face
// areas core/surface.ts already reports, and the incomplete markers a
// missing construction fact produces. floorMaterials() is a pure function of
// its arguments -- no cache to invalidate -- so "revision" is exercised by
// calling it again after mutating the document and checking the result
// tracks the change.
import {
  emptyDoc, newId, Wall, Opening, Floor, PlanDoc, Id,
} from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { detectRooms } from "../src/core/rooms";
import { floorSurface, type FloorSurface } from "../src/core/surface";
import { floorMaterials, type WallTakeoff } from "../src/core/materials";
import { stockPresetOf, STOCK_PRESETS, STOCK_MM_DEFAULT } from "../src/model/materials";
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
  check("stud count is the drawn posts plus one at each end of the run", stud!.count === rw.posts.length + 2,
    `${stud!.count} vs ${rw.posts.length} + 2`);
  check("stud count is 8 (a 4000 mm run at 600 mm centres takes 7 bays: 6 interior posts and 2 end studs)",
    stud!.count === 8, String(stud!.count));
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
  // storey - top plate (flat) - header (on edge: the frame thickness) - head (sill 0 + height)
  const expectedAbove = H - POST_WIDTH - FRAME_TH - (0 + 2315);
  check("cripple-above length is storey height less the plate, the header and the head",
    above!.lengthMm === expectedAbove, `${above?.lengthMm} vs ${expectedAbove}`);
  check("no below-sill cripples for a door with no sill",
    wt.members.filter(x => x.name === "cripple").length === 1);
}

// ---- a door's king and jack studs ---------------------------------------------

{
  const { doc, f, right } = buildDoc();
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === right.id)!;

  const king = wt.members.find(x => x.name === "king");
  check("a door produces two king studs", king !== undefined && king.count === 2, String(king?.count));
  check("king studs run full stud height", king?.lengthMm === H - 2 * POST_WIDTH, String(king?.lengthMm));
  check("king studs are not spliceable", king?.spliceable === false);

  const jack = wt.members.find(x => x.name === "jack");
  const expectedJack = (0 + 2315) - POST_WIDTH; // door sillHeight 0 + height, less the bottom plate
  check("a door produces two jack studs", jack !== undefined && jack.count === 2, String(jack?.count));
  check("jack studs run from the plate to the head",
    jack?.lengthMm === expectedJack, `${jack?.lengthMm} vs ${expectedJack}`);
  check("jack studs are not spliceable", jack?.spliceable === false);
}

// ---- an opening flush at a wall end drops that end's stud --------------------

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  // width 830 at t 415: the near jamb sits exactly at the wall's start.
  const flushDoor = opening({ kind: "door", t: 415, width: 830, sillHeight: 0, height: 2315 });
  const w: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: FRAME_TH, bulge: 0, openings: [flushDoor],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
  f.walls = [w];
  const { resolved, m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === w.id)!;
  const rw = resolved.walls.get(w.id)!;
  const stud = wt.members.find(x => x.name === "stud")!;
  check("a door flush at a wall end drops that end's stud",
    stud.count === rw.posts.length + 1, `${stud.count} vs ${rw.posts.length} + 1`);
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

// ---- corner and junction backing -----------------------------------------------

function framedWall(a: Id, b: Id): Wall {
  return {
    id: newId("w"), a, b, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
}
function backingCountOf(walls: WallTakeoff[]): number {
  return walls.reduce((n, wt) => n + (wt.members.find(x => x.name === "backing")?.count ?? 0), 0);
}

{
  // L corner: two framed walls meeting at a right angle.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n"), n3 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }, { id: n3, x: 4000, y: 3000 }];
  f.walls = [framedWall(n1, n2), framedWall(n2, n3)];
  const { m } = materialsOf(doc, f);
  check("an L of two framed walls yields exactly one backing stud", backingCountOf(m.walls) === 1,
    String(backingCountOf(m.walls)));
  const holders = m.walls.filter(wt => (wt.members.find(x => x.name === "backing")?.count ?? 0) > 0);
  check("the L's backing is assigned to exactly one wall", holders.length === 1, String(holders.length));
}

{
  // T: three framed walls at one node.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n"), n3 = newId("n"), n4 = newId("n");
  f.nodes = [
    { id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 },
    { id: n3, x: 8000, y: 0 }, { id: n4, x: 4000, y: 3000 },
  ];
  f.walls = [framedWall(n1, n2), framedWall(n2, n3), framedWall(n2, n4)];
  const { m } = materialsOf(doc, f);
  check("a T of three framed walls yields two backing studs", backingCountOf(m.walls) === 2,
    String(backingCountOf(m.walls)));
}

{
  // Straight split: two collinear framed walls -- resolveFloor()'s own
  // "parallel" pass-through, nothing to back.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n"), n3 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 2000, y: 0 }, { id: n3, x: 4000, y: 0 }];
  f.walls = [framedWall(n1, n2), framedWall(n2, n3)];
  const { m } = materialsOf(doc, f);
  check("a straight split yields no backing", backingCountOf(m.walls) === 0, String(backingCountOf(m.walls)));
}

{
  // A framed wall meeting a block wall: the block wall doesn't count toward
  // the node's degree, so there is nothing to back either.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n"), n3 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }, { id: n3, x: 4000, y: 3000 }];
  const blockWall: Wall = {
    id: newId("w"), a: n2, b: n3, thickness: 240, bulge: 0, openings: [],
    material: "aerated", blockMm: { length: 600, height: 250 },
  };
  f.walls = [framedWall(n1, n2), blockWall];
  const { m } = materialsOf(doc, f);
  check("a framed wall meeting a block wall yields no backing", backingCountOf(m.walls) === 0,
    String(backingCountOf(m.walls)));
}

{
  // Per-wall backing summed equals the system total: a closed rectangle of
  // four framed walls has four corners.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const pts = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  f.walls = [
    framedWall(ids[0]!, ids[1]!), framedWall(ids[1]!, ids[2]!),
    framedWall(ids[2]!, ids[3]!), framedWall(ids[3]!, ids[0]!),
  ];
  const { m } = materialsOf(doc, f);
  const perWallTotal = backingCountOf(m.walls);
  const framed = m.bySystem.find(x => x.system === "framed-timber")!;
  const systemTotal = framed.members.find(x => x.name === "backing")?.count ?? 0;
  check("a closed rectangle of framed walls has four corners' worth of backing", perWallTotal === 4,
    String(perWallTotal));
  check("per-wall backing summed equals the system total", perWallTotal === systemTotal,
    `${perWallTotal} vs ${systemTotal}`);
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

// ---- decks: joists at span plus bearing, rim boards, decking sheets ----------

{
  const { doc, f } = buildDoc();
  f.decks = [{
    id: "dk1", x: 2000, y: 1500, rotation: 0, width: 2400, depth: 3600, joistAxis: "y", joistMm: 600,
    joist: { w: 71, d: 171 }, deckingMm: 18,
  }];
  const { m } = materialsOf(doc, f);
  const dt = m.decks.perDeck[0]!;
  const joist = dt.members.find(x => x.name === "joist")!;
  check("a deck counts a joist at every set-out position", joist.count === 5, String(joist.count));
  check("a joist is the clear span plus the bearing at both ends", joist.lengthMm === 3600 + 2 * 100, String(joist.lengthMm));
  check("a joist is never spliced", !joist.spliceable);
  check("a joist carries the stated section", joist.sectionMm.w === 71 && joist.sectionMm.d === 171);
  const rim = dt.members.find(x => x.name === "rim")!;
  check("two rim boards across the joist ends, spliceable", rim.count === 2 && rim.lengthMm === 2400 && rim.spliceable);
  // 8.64 m² plus 10 % waste over 1200 × 2600 sheets.
  check("decking sheets come off the platform area with waste", dt.deckingMm2 === 2400 * 3600 && dt.sheets === 4,
    `${dt.deckingMm2} ${dt.sheets}`);
  check("the deck group nests its members", m.decks.nested.totalMm === 5 * 3800 + 2 * 2400, String(m.decks.nested.totalMm));

  f.decks[0]!.bearingMm = 150;
  check("a stated bearing lengthens every joist",
    materialsOf(doc, f).m.decks.perDeck[0]!.members.find(x => x.name === "joist")!.lengthMm === 3900);

  f.decks[0]!.depth = 6000;
  const long = materialsOf(doc, f).m.decks;
  check("a joist longer than every stock length fits no bar", long.nested.unfit.some(u => u.name === "joist" && u.lengthMm === 6300),
    JSON.stringify(long.nested.unfit));

  delete f.decks[0]!.joist;
  const bare = materialsOf(doc, f).m.decks.perDeck[0]!;
  check("a deck without a section is incomplete and counts no timber",
    bare.incomplete.includes("joist") && bare.members.length === 0 && bare.sheets > 0);
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

// ---- stacked frames: a break is a double plate in the takeoff too ---------
//
// A 4000mm wall, storey height 2600, gabled to a 4600 peak at the midpoint,
// with a break at 2600 (the eaves height): the lower band is the old
// single-frame layout, the upper band a triangular one following the
// profile. WallTakeoff.members carries no position, only shape, so the
// THREE flat plates (the lower band's own bottom and top, and the upper
// band's own bottom -- all the same length) merge into one entry, and the
// upper band's two raked segments (same length as each other, by symmetry)
// merge into a second.

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: W, y: 0 }];
  const w: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
    profile: [{ t: W / 2, height: 4600 }], frameBreaksMm: [H],
  };
  f.walls = [w];
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === w.id)!;

  const studs = wt.members.filter(x => x.name === "stud");
  check("a stacked frame yields many distinct stud lengths -- the sloped upper band",
    new Set(studs.map(s => s.lengthMm)).size > 2, String([...new Set(studs.map(s => s.lengthMm))]));
  check("the flat lower band's stud length (storey height less two plates) is among them",
    studs.some(s => s.lengthMm === H - 2 * POST_WIDTH));

  // The break sits exactly at the eave, so the upper band's OWN bottom plate
  // has no room to run full width -- near each end the profile has not yet
  // risen enough above the break to clear that plate and its own depth
  // (a 2*postWidth margin), so it -- and the raked segments standing on it --
  // are clipped short of the wall's own ends. Only the lower band's two flat
  // plates (bottom and top) are the full 4000; the upper band's own bottom
  // plate is a shorter, separate entry.
  const plates = wt.members.filter(x => x.name === "plate");
  const flatPlate = plates.find(p => p.lengthMm === W);
  check("the lower band's own bottom and top plates merge into one entry",
    flatPlate !== undefined && flatPlate.count === 2, JSON.stringify(flatPlate));
  const upperBottom = plates.find(p => p.lengthMm === W - 2 * POST_WIDTH * 2);
  check("the upper band's own (clipped) bottom plate is a separate entry",
    upperBottom !== undefined && upperBottom.count === 1, JSON.stringify(upperBottom));
  const rise = 2000 - POST_WIDTH * 2; // run once the plate clears the eave-end clip
  const rakedPlate = plates.find(p => near(p.lengthMm, Math.hypot(rise, rise), 1));
  check("the upper band's two raked top-plate segments merge into a second entry",
    rakedPlate !== undefined && rakedPlate.count === 2, JSON.stringify(rakedPlate));

  const framed = m.bySystem.find(x => x.system === "framed-timber")!;
  check("nest() handles the raked plate length without error", framed.nested.totalMm > 0);
  check("a spliceable raked plate never lands in unfit",
    framed.nested.unfit.every(u => u.name !== "plate"));
}

// ---- suggested frame breaks: reported when a stud fits no stock length ----

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = 7000; // taller than every default stock length
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: W, y: 0 }];
  const w: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
  f.walls = [w];
  const { m } = materialsOf(doc, f);
  const wt = m.walls.find(x => x.wallId === w.id)!;
  const stud = wt.members.find(x => x.name === "stud")!;
  check("a 7000mm wall's studs fit no default stock length (longest is 6000)",
    stud.lengthMm > 6000, String(stud.lengthMm));
  check("suggestedBreaksMm proposes the smallest break that would make every stud fit: 3500",
    JSON.stringify(wt.suggestedBreaksMm) === JSON.stringify([3500]), JSON.stringify(wt.suggestedBreaksMm));
}

// ---- stockPresetOf: which named preset the document's stock list matches --

{
  const doc = emptyDoc();
  check("a document with no stock list at all matches \"merchant\" (it equals the default)",
    stockPresetOf(doc) === "merchant");

  doc.materials = { stockMm: [...STOCK_MM_DEFAULT] };
  check("a stock list equal to STOCK_MM_DEFAULT matches \"merchant\"", stockPresetOf(doc) === "merchant");

  const diy = STOCK_PRESETS.find(p => p.id === "diy")!;
  doc.materials = { stockMm: [...diy.stockMm] };
  check("a stock list equal to the diy preset matches \"diy\"", stockPresetOf(doc) === "diy");

  doc.materials = { stockMm: [2400, 3000] };
  check("a stock list matching no preset returns null", stockPresetOf(doc) === null);

  doc.materials = { stockMm: [3000, 2700, 2400] }; // unsorted, same set as diy
  check("stockPresetOf reads the cleaned (sorted) list, so order in the field doesn't matter",
    stockPresetOf(doc) === "diy");
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
