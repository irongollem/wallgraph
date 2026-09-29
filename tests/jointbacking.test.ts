// Joint backing: a row of pieces between the studs wherever a board fixed to
// a frame ends below the frame's top, placed by frameLayout() and counted by
// floorMaterials() from the same layout.
import { emptyDoc, newId, type Board, type FaceFrame, type Floor, type PlanDoc, type Wall } from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { resolveLeaves } from "../src/core/leaf";
import { detectRooms } from "../src/core/rooms";
import { floorSurface } from "../src/core/surface";
import { floorMaterials } from "../src/core/materials";
import { frameLayout, frameSheetHeightsMm, wallElevation, type PlacedMember } from "../src/core/frame";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const LEN = 4000;
const GYPSUM: Board = { kind: "gypsum", mm: 12 };
const OSB: Board = { kind: "osb", mm: 18 };

function wallOf(height: number, over: Partial<Wall>): { doc: PlanDoc; f: Floor; w: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = height;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: LEN, y: 0 }];
  const w: Wall = { id: newId("w"), a: n1, b: n2, thickness: 50, bulge: 0, openings: [], ...over };
  f.walls = [w];
  return { doc, f, w };
}

function layout(doc: PlanDoc, f: Floor, w: Wall): PlacedMember[] {
  const rw = resolveFloor(f).walls.get(w.id)!;
  return frameLayout(f, w, rw, Infinity, frameSheetHeightsMm(doc, w))!.members;
}

const rows = (ms: readonly PlacedMember[], name: string): number[] =>
  [...new Set(ms.filter(m => m.name === name).map(m => m.y + m.h / 2))].sort((a, b) => a - b);

// ---- a steel frame taller than its board gets one row at the sheet height ---

{
  const steel: Partial<Wall> = {
    material: "steel", postMm: 600, postWidthMm: 50, buildUp: { left: { boards: [GYPSUM] } },
  };
  const { doc, f, w } = wallOf(3730, steel);
  const ms = layout(doc, f, w);
  const backing = ms.filter(m => m.name === "jointBacking");
  check("steel 3730 with a 2600 sheet: one joint row at 2600", JSON.stringify(rows(ms, "jointBacking")) === "[2600]",
    JSON.stringify(rows(ms, "jointBacking")));
  // Studs at the two ends and every 600 from 600 to 3600: seven bays.
  check("one piece per bay", backing.length === 7, String(backing.length));
  // The eight studs take 8 * 50 of the 4000; the row fills the rest.
  check("the pieces fill the gaps between the studs",
    backing.reduce((n, m) => n + m.lengthMm, 0) === LEN - 8 * 50,
    String(backing.reduce((n, m) => n + m.lengthMm, 0)));
  check("still no noggings on steel", ms.every(m => m.name !== "nogging"));

  const low = wallOf(2600, steel);
  check("no joint where the sheet reaches the top", layout(low.doc, low.f, low.w).every(m => m.name !== "jointBacking"));

  const bare = wallOf(3730, { ...steel, buildUp: undefined });
  check("no joint without a board", layout(bare.doc, bare.f, bare.w).every(m => m.name !== "jointBacking"));
}

// ---- the sheet size is the document's own -----------------------------------

{
  const { doc, f, w } = wallOf(3730, {
    material: "steel", postMm: 600, postWidthMm: 50, buildUp: { left: { boards: [GYPSUM] } },
  });
  doc.materials = { sheets: { gypsum: { width: 1200, height: 3000 } } };
  check("a 3000 sheet moves the row to 3000", JSON.stringify(rows(layout(doc, f, w), "jointBacking")) === "[3000]");
}

// ---- only the first board of a stack, and both faces' own sheets ------------

{
  const { doc, f, w } = wallOf(3730, {
    material: "timber", postMm: 600, postWidthMm: 38, thickness: 89,
    buildUp: { left: { boards: [GYPSUM, OSB] }, right: { boards: [OSB] } },
  });
  check("sheet heights are the first board of each face", JSON.stringify(frameSheetHeightsMm(doc, w)) === "[2500,2600]",
    JSON.stringify(frameSheetHeightsMm(doc, w)));
  check("two faces with different sheets get a row each",
    JSON.stringify(rows(layout(doc, f, w), "jointBacking")) === "[2500,2600]");
}

// ---- a nogging row at a joint gives way to the joint row --------------------

{
  // One row over 5200 - 2 * 38 of clear height stands at exactly 2600.
  const { doc, f, w } = wallOf(5200, {
    material: "timber", postMm: 600, postWidthMm: 38, thickness: 89, noggingRows: 1,
    buildUp: { right: { boards: [GYPSUM] } },
  });
  const ms = layout(doc, f, w);
  check("the nogging row at the joint is left out", ms.every(m => m.name !== "nogging"));
  check("the joint row stands in its place", JSON.stringify(rows(ms, "jointBacking")) === "[2600]");
}

// ---- a voorzetwand reads the boards on its host face -------------------------

{
  const frame: FaceFrame = { gapMm: 20, depthMm: 50, material: "steel", postMm: 600, postWidthMm: 50 };
  const { doc, f, w: host } = wallOf(3730, {
    thickness: 100, material: "masonry", buildUp: { left: { frame, boards: [GYPSUM] } },
  });
  check("a face carrying a frame adds nothing to the host's own frame", frameSheetHeightsMm(doc, host).length === 0);

  const resolved = resolveFloor(f);
  const leaves = resolveLeaves(f, resolved);
  const leafWall = leaves.leaf.leafOf(host.id, "left")!;
  const rw = leaves.resolved.walls.get(leafWall.id)!;
  const sheets = frameSheetHeightsMm(doc, leafWall, { wall: host, side: "left" });
  check("the leaf takes its host face's sheet", JSON.stringify(sheets) === "[2600]", JSON.stringify(sheets));
  const elevation = wallElevation(leaves.leaf.floor, leafWall, rw, sheets);
  const drawn = elevation.members.filter(m => m.name === "jointBacking").reduce((n, m) => n + m.count, 0);
  check("the leaf's elevation draws the joint row", drawn > 0);

  const materials = floorMaterials(doc, f, resolved, floorSurface(f, resolved, detectRooms(f)));
  const wt = materials.walls.find(x => x.host?.wallId === host.id && x.host.side === "left")!;
  const counted = wt.members.filter(m => m.name === "jointBacking").reduce((n, m) => n + m.count, 0);
  check("the takeoff counts what the elevation draws", counted === drawn, `${counted} vs ${drawn}`);
}

if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
