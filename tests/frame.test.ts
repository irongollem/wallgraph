// frameLayout() places one framed wall's studs, plates, king/jack studs,
// backing, noggings and header/sill/cripples in the wall's own plane; the
// takeoff (core/materials.ts) aggregates the same placed members by shape
// rather than re-deriving them. See tests/materials.test.ts for the count
// and length assertions this exercises geometrically.
import {
  emptyDoc, newId, type Floor, type Opening, type PlanDoc, type Wall,
} from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { detectRooms } from "../src/core/rooms";
import { floorSurface } from "../src/core/surface";
import { floorMaterials } from "../src/core/materials";
import { computeBacking, frameLayout, type PlacedMember } from "../src/core/frame";
import { recordSymbol } from "../src/io/record";
import { drawFrame } from "../src/render/frame";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

const H = 2600, POST_MM = 600, POST_WIDTH = 38, FRAME_TH = 89, LEN = 4000;

function straightWall(over: Partial<Wall> = {}): { doc: PlanDoc; f: Floor; w: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: LEN, y: 0 }];
  const w: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH, ...over,
  };
  f.walls = [w];
  return { doc, f, w };
}

function layoutOf(f: Floor, w: Wall) {
  const resolved = resolveFloor(f);
  const rw = resolved.walls.get(w.id)!;
  const layout = frameLayout(f, w, rw)!;
  return { resolved, rw, layout };
}

interface Rect { x: number; y: number; w: number; h: number }
function overlaps(a: Rect, b: Rect, eps = 1): boolean {
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}

function comboWall(): { doc: PlanDoc; f: Floor; w: Wall } {
  const { doc, f, w } = straightWall({ noggingRows: 1 });
  const door = opening({ kind: "door", t: 1000, width: 900, sillHeight: 0, height: 2315 });
  const win = opening({ kind: "window", t: 3000, width: 900, sillHeight: 900, height: 1200 });
  w.openings = [door, win];
  return { doc, f, w };
}

// ---- studs and plates on a bare frame ---------------------------------------

{
  const { f, w } = straightWall();
  const { rw, layout } = layoutOf(f, w);
  check("frameLayout is non-null for a framed wall with a post width", layout !== null);

  const studs = layout.members.filter(m => m.name === "stud");
  check("8 studs on a 4000mm run at 600mm centres (7 bays: 6 interior + 2 end studs)",
    studs.length === 8, String(studs.length));
  check("stud count matches rw.posts.length + 2 end studs",
    studs.length === rw.posts.length + 2, `${studs.length} vs ${rw.posts.length} + 2`);

  const widthMm = LEN / 7;
  for (let i = 1; i <= 6; i++) {
    const center = widthMm * i;
    check(`an interior stud stands at centre ${center.toFixed(1)}`,
      studs.some(s => near(s.x + s.w / 2, center, 1)));
  }
  check("an end stud stands at [0, 38]", studs.some(s => near(s.x, 0, 1) && near(s.x + s.w, POST_WIDTH, 1)));
  check("an end stud stands at [3962, 4000]",
    studs.some(s => near(s.x, LEN - POST_WIDTH, 1) && near(s.x + s.w, LEN, 1)));
  check("every stud rectangle is clamped into [0, lengthMm]",
    studs.every(s => s.x >= -1 && s.x + s.w <= layout.lengthMm + 1));
  check("stud length is storey height less two post widths",
    studs.every(s => s.lengthMm === H - 2 * POST_WIDTH));

  const plates = layout.members.filter(m => m.name === "plate");
  check("two plates", plates.length === 2, String(plates.length));
  check("a plate at y 0", plates.some(p => near(p.y, 0, 1)));
  check("a plate at y 2562 (storey height less a post width)", plates.some(p => near(p.y, H - POST_WIDTH, 1)));
}

// ---- a door: header and cripples above it ------------------------------------

{
  const { f, w } = straightWall();
  const door = opening({ kind: "door", t: 2000, width: 900, sillHeight: 0, height: 2315 });
  w.openings = [door];
  const { layout } = layoutOf(f, w);

  const head = 0 + 2315;
  const headers = layout.members.filter(m => m.name === "header");
  check("one header rectangle", headers.length === 1, String(headers.length));
  const header = headers[0]!;
  check("header width is opening width + 2 post widths",
    header.w === door.width + 2 * POST_WIDTH, String(header.w));
  check("header height is the wall thickness (on edge)", header.h === FRAME_TH, String(header.h));
  check("header sits at the head height", header.y === head, String(header.y));
  check("header stands for two members", header.count === 2, String(header.count));

  check("a sill-less door gets no sill piece", layout.members.every(m => m.name !== "sill"));

  const cripples = layout.members.filter(m => m.name === "cripple");
  check("one cripple above a sill-less door (900 at 600 spacing is 2 bays)",
    cripples.length === 1, String(cripples.length));
  check("the door's cripple stands at its own midpoint", near(cripples[0]!.x + cripples[0]!.w / 2, door.t, 1));
}

// ---- a door's king and jack studs ---------------------------------------------

{
  const { f, w } = straightWall();
  const door = opening({ kind: "door", t: 2000, width: 900, sillHeight: 0, height: 2315 });
  w.openings = [door];
  const { layout } = layoutOf(f, w);
  const jambL = door.t - door.width / 2, jambR = door.t + door.width / 2;
  const head = 0 + 2315;

  const kings = layout.members.filter(m => m.name === "king");
  check("two king studs", kings.length === 2, String(kings.length));
  check("a king stands outside the jack on the left", kings.some(k => near(k.x, jambL - 2 * POST_WIDTH, 1)));
  check("a king stands outside the jack on the right", kings.some(k => near(k.x, jambR + POST_WIDTH, 1)));

  const jacks = layout.members.filter(m => m.name === "jack");
  check("two jack studs", jacks.length === 2, String(jacks.length));
  check("jacks stand at the jambs",
    jacks.some(j => near(j.x, jambL - POST_WIDTH, 1)) && jacks.some(j => near(j.x, jambR, 1)));
  check("a jack stud's top is the header's underside", jacks.every(j => near(j.y + j.h, head, 1)));
}

// ---- a window adds a sill and cripples below it ------------------------------

{
  const { f, w } = straightWall();
  const win = opening({ kind: "window", t: 1500, width: 1200, sillHeight: 900, height: 1200 });
  w.openings = [win];
  const { layout } = layoutOf(f, w);

  const sills = layout.members.filter(m => m.name === "sill");
  check("a window gets a sill piece", sills.length === 1, String(sills.length));
  check("sill sits at sillHeight - postWidth", near(sills[0]!.y, 900 - POST_WIDTH, 1), String(sills[0]!.y));

  const cripples = layout.members.filter(m => m.name === "cripple");
  check("both above and below cripples exist for a window", cripples.length === 2, String(cripples.length));
}

// ---- noggings sit in their bay cell, clear of the interior division studs ---

{
  const { f, w } = straightWall({ noggingRows: 1 });
  const { layout } = layoutOf(f, w);
  const noggings = layout.members.filter(m => m.name === "nogging");
  check("noggings exist with noggingRows 1", noggings.length > 0, String(noggings.length));

  // An interior cell, away from the run's own ends -- there a nogging is
  // documented to overlap the end/king stud by half a post (see frame.ts).
  const widthMm = LEN / 7;
  const cellIndex = 3;
  const cellStart = widthMm * cellIndex;
  const nogging = noggings.find(n => near(n.x, cellStart + POST_WIDTH / 2, 2));
  check("the interior cell's nogging exists", nogging !== undefined);

  check("the nogging lies within its bay cell",
    nogging!.x >= cellStart - 1 && nogging!.x + nogging!.w <= cellStart + widthMm + 1);

  const studs = layout.members.filter(m => m.name === "stud");
  const leftStud = studs.find(s => near(s.x + s.w / 2, cellStart, 1));
  const rightStud = studs.find(s => near(s.x + s.w / 2, cellStart + widthMm, 1));
  check("both bounding studs of the cell are found", leftStud !== undefined && rightStud !== undefined);
  check("the nogging does not overlap its left bounding stud",
    nogging!.x + 1 >= leftStud!.x + leftStud!.w);
  check("the nogging does not overlap its right bounding stud",
    nogging!.x + nogging!.w <= rightStud!.x + 1);
}

// ---- no member overlaps an opening's hole, except the bottom plate ----------

{
  const { f, w } = comboWall();
  const { layout } = layoutOf(f, w);
  check("the combo wall has openings to check against", layout.openings.length === 2);
  for (const o of layout.openings) {
    for (const m of layout.members) {
      // The bottom plate stands first, continuous, and is cut for the
      // threshold afterwards -- see frame.ts's own comment on frameLayout().
      if ((m.name === "plate" || m.name === "rail") && m.y === 0 && o.y === 0) continue;
      check(`${m.name} at x=${m.x.toFixed(0)} y=${m.y.toFixed(0)} does not overlap opening ${o.openingId}`,
        !overlaps(m, o));
    }
  }
}

// ---- steel: no jack, header, sill, cripple or nogging ------------------------

{
  const { f, w } = straightWall({ material: "steel", noggingRows: 1 });
  const door = opening({ kind: "door", t: 2000, width: 900, sillHeight: 0, height: 2315 });
  w.openings = [door];
  const { layout } = layoutOf(f, w);

  check("no jack studs on a steel wall", layout.members.every(m => m.name !== "jack"));
  check("no header on a steel wall", layout.members.every(m => m.name !== "header"));
  check("no sill on a steel wall", layout.members.every(m => m.name !== "sill"));
  check("no cripples on a steel wall", layout.members.every(m => m.name !== "cripple"));
  check("no noggings on a steel wall", layout.members.every(m => m.name !== "nogging"));

  const jambL = door.t - door.width / 2, jambR = door.t + door.width / 2;
  const kings = layout.members.filter(m => m.name === "king");
  check("steel still gets king studs", kings.length === 2, String(kings.length));
  check("steel king studs stand directly at the jambs (no jack in between)",
    kings.some(k => near(k.x, jambL - POST_WIDTH, 1)) && kings.some(k => near(k.x, jambR, 1)));
}

// ---- a backed corner: backing on the claiming wall, at the shared end -------

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = H;
  const n1 = newId("n"), n2 = newId("n"), n3 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }, { id: n3, x: 4000, y: 3000 }];
  const w1: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
  const w2: Wall = {
    id: newId("w"), a: n2, b: n3, thickness: FRAME_TH, bulge: 0, openings: [],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH,
  };
  f.walls = [w1, w2];
  const resolved = resolveFloor(f);
  const backing = computeBacking(f);

  const b1 = backing.get(w1.id) ?? { a: 0, b: 0 };
  const b2 = backing.get(w2.id) ?? { a: 0, b: 0 };
  check("exactly one backing stud total across the L", (b1.a + b1.b) + (b2.a + b2.b) === 1,
    `${JSON.stringify(b1)} / ${JSON.stringify(b2)}`);

  const claimant = (b1.a + b1.b) > 0 ? { w: w1, backing: b1 } : { w: w2, backing: b2 };
  const other = claimant.w === w1 ? w2 : w1;

  const otherLayout = frameLayout(f, other, resolved.walls.get(other.id)!)!;
  check("the non-claiming wall has no backing member", otherLayout.members.every(m => m.name !== "backing"));

  const layout = frameLayout(f, claimant.w, resolved.walls.get(claimant.w.id)!)!;
  const backingMembers = layout.members.filter(m => m.name === "backing");
  check("the claiming wall has exactly one backing stud", backingMembers.length === 1, String(backingMembers.length));

  const expectedEnd: "a" | "b" = claimant.w.a === n2 ? "a" : "b";
  check("computeBacking assigns the count to the end touching the shared node",
    expectedEnd === "a" ? claimant.backing.a === 1 : claimant.backing.b === 1,
    JSON.stringify(claimant.backing));
  const expectedX = expectedEnd === "a" ? POST_WIDTH : layout.lengthMm - 2 * POST_WIDTH;
  check("the backing stud stands beside the end stud at the claimed end",
    near(backingMembers[0]!.x, expectedX, 1), `${backingMembers[0]!.x} vs ${expectedX}`);
}

// ---- frameLayout's members aggregate to the same WallTakeoff.members --------

{
  const { doc, f, w } = comboWall();
  const resolved = resolveFloor(f);
  const rw = resolved.walls.get(w.id)!;
  const layout = frameLayout(f, w, rw)!;

  interface AggMember {
    name: string; sectionMm: { w: number; d: number }; lengthMm: number; count: number; spliceable: boolean;
  }
  function aggregate(members: readonly PlacedMember[]): AggMember[] {
    const out: AggMember[] = [];
    for (const m of members) {
      const existing = out.find(x => x.name === m.name && x.spliceable === m.spliceable && x.lengthMm === m.lengthMm
        && x.sectionMm.w === m.sectionMm.w && x.sectionMm.d === m.sectionMm.d);
      if (existing) existing.count += m.count;
      else out.push({ name: m.name, sectionMm: { ...m.sectionMm }, lengthMm: m.lengthMm, count: m.count, spliceable: m.spliceable });
    }
    return out;
  }
  const aggregated = aggregate(layout.members);

  const rooms = detectRooms(f);
  const surface = floorSurface(f, resolved, rooms);
  const materials = floorMaterials(doc as PlanDoc, f, resolved, surface);
  const wt = materials.walls.find(x => x.wallId === w.id)!;

  check("frameLayout's aggregated members deep-equal floorMaterials()'s WallTakeoff.members",
    JSON.stringify(aggregated) === JSON.stringify(wt.members),
    `${JSON.stringify(aggregated)} vs ${JSON.stringify(wt.members)}`);
}

// ---- the recorder replay stays inside the frame -----------------------------

{
  const { f, w } = comboWall();
  const { layout } = layoutOf(f, w);
  const prims = recordSymbol({ draw: ctx => drawFrame(ctx, layout) }, 0, 0, 0, false);
  const pts: { x: number; y: number }[] = [];
  for (const p of prims) {
    if (p.kind === "line") pts.push(p.a, p.b);
    else if (p.kind === "poly") pts.push(...p.pts);
    else if (p.kind === "text") pts.push(p.at);
    else pts.push({ x: p.c.x - p.r, y: p.c.y - p.r }, { x: p.c.x + p.r, y: p.c.y + p.r });
  }
  check("the replay records geometry", pts.length > 0);
  const outside = pts.filter(p => p.x < -1 || p.y < -1 || p.x > layout.lengthMm + 1 || p.y > layout.heightMm + 1);
  check("the replay draws nothing outside the frame's bounds", outside.length === 0, JSON.stringify(outside.slice(0, 3)));
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
