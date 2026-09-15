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

// ---- a sloped top: every stud cut to its own higher edge, raked plates ------
//
// A 4000mm gable at 600mm centres, eaves at the storey height (2600) and a
// peak of 4600 at the midpoint -- the isolated wall's own faces equal its
// centerline length exactly (no neighbours to miter against), so Lf === LEN
// and a member's x reads directly off the same profile this hand formula
// reproduces.

/** The gable's own top, independent of wallTopAt() -- linear from 2600 at
 *  each end to 4600 at the midpoint. */
function gableTop(x: number): number {
  return 2600 + Math.min(x, LEN - x);
}
function higherEdge(x: number, w: number): number {
  return Math.max(gableTop(x), gableTop(x + w));
}

{
  const { f, w } = straightWall();
  w.profile = [{ t: LEN / 2, height: 4600 }];
  const { layout } = layoutOf(f, w);
  check("Lf equals the centerline length for an isolated wall", layout.lengthMm === LEN, String(layout.lengthMm));

  const studs = layout.members.filter(m => m.name === "stud");
  check("still 8 studs under a sloped top", studs.length === 8, String(studs.length));
  let expectedTotal = 0, actualTotal = 0;
  for (const s of studs) {
    const expected = Math.floor(higherEdge(s.x, s.w) - 2 * POST_WIDTH);
    check(`stud at x=${s.x.toFixed(1)} is cut to its higher edge, rounded down`,
      s.lengthMm === expected, `${s.lengthMm} vs ${expected}`);
    check(`stud at x=${s.x.toFixed(1)} carries lengthMm === h`, s.h === s.lengthMm);
    expectedTotal += expected;
    actualTotal += s.lengthMm;
  }
  check("total stud length matches a hand sum", actualTotal === expectedTotal, `${actualTotal} vs ${expectedTotal}`);
  check("no stud stands above the wall's overall top",
    studs.every(s => s.y + s.h <= layout.heightMm + 1));

  const plates = layout.members.filter(m => m.name === "plate" && m.slope !== undefined);
  check("the raked top plate is one member per straight profile segment (two, either side of the peak)",
    plates.length === 2, String(plates.length));
  for (const p of plates) {
    check(`raked plate at x=${p.x.toFixed(1)} runs the slope length hypot(2000, 2000)`,
      near(p.lengthMm, Math.hypot(2000, 2000), 1), String(p.lengthMm));
    check("a raked plate is spliceable", p.spliceable === true);
  }
  check("the bottom plate is unchanged (flat, no slope)",
    layout.members.some(m => m.name === "plate" && m.slope === undefined && near(m.y, 0, 1)));

  check("no member of a sloped frame is shorter than the space it fills",
    studs.every(s => s.lengthMm >= higherEdge(s.x, s.w) - 2 * POST_WIDTH - 1));
}

// ---- a flat wall's layout is unchanged by the sloped-top machinery --------

{
  const { f, w } = straightWall();
  const flat = layoutOf(f, w).layout;
  w.profile = [{ t: 0, height: 2600 }, { t: LEN, height: 2600 }]; // stated but flat
  const stillFlat = layoutOf(f, w).layout;
  check("a stated-but-flat profile gives the same member count as no profile at all",
    flat.members.length === stillFlat.members.length);
  check("every member is unaffected: no slope anywhere on a flat top",
    stillFlat.members.every(m => m.slope === undefined));
  const flatPlates = flat.members.filter(m => m.name === "plate");
  const stillFlatPlates = stillFlat.members.filter(m => m.name === "plate");
  check("still exactly two plates", stillFlatPlates.length === 2 && flatPlates.length === 2);
  check("the top plate's length is unchanged", near(
    stillFlatPlates.find(p => p.y > 0)!.lengthMm, flatPlates.find(p => p.y > 0)!.lengthMm, 0.01));
}

// ---- a valley profile: the top dips, plates rake down then up -------------

{
  const { f, w } = straightWall();
  w.profile = [{ t: LEN / 2, height: 1400 }]; // eaves 2600, valley 1400 at the midpoint
  const { layout } = layoutOf(f, w);
  const studs = layout.members.filter(m => m.name === "stud");
  const nearEnd = studs.find(s => near(s.x, 0, 1))!;
  const nearValley = studs.reduce((a, b) => (Math.abs(a.x + a.w / 2 - LEN / 2) < Math.abs(b.x + b.w / 2 - LEN / 2) ? a : b));
  check("a stud near the valley is shorter than one near the eaves",
    nearValley.lengthMm < nearEnd.lengthMm, `${nearValley.lengthMm} vs ${nearEnd.lengthMm}`);

  const plates = layout.members.filter(m => m.name === "plate" && m.slope !== undefined);
  check("a valley also breaks the top plate into two raked segments", plates.length === 2, String(plates.length));
  check("one segment slopes down toward the valley, the other up out of it",
    plates.some(p => p.slope! < 0) && plates.some(p => p.slope! > 0));
}

// ---- a break above the lowest top: no upper-band members over the eaves ---
//
// A gable end (eaves 2600, peak 4600 at the midpoint) with a break at 3000 --
// above the eaves. The lower band is unaffected (flat, full length); the top
// band does not exist wherever the profile dips below 3000, which happens
// within 400mm of each end (2600 + 400 = 3000).

{
  const { f, w } = straightWall();
  w.profile = [{ t: LEN / 2, height: 4600 }];
  w.frameBreaksMm = [3000];
  const { layout } = layoutOf(f, w);

  const lowerStuds = layout.members.filter(m => m.name === "stud" && near(m.y, POST_WIDTH, 1));
  check("the lower band still has its own end stud at the wall's own start",
    lowerStuds.some(s => near(s.x, 0, 1)));
  check("the lower band still has its own end stud at the wall's own end",
    lowerStuds.some(s => near(s.x + s.w, LEN, 1)));

  const upperFull = layout.members.filter(m =>
    (m.name === "stud" || m.name === "king" || m.name === "backing") && m.y >= 3000 - 0.5);
  check("no upper-band member stands over the left eave span (x + w <= 400)",
    upperFull.every(m => m.x + m.w > 400));
  check("no upper-band member stands over the right eave span (x >= 3600)",
    upperFull.every(m => m.x < 3600));
  check("the upper band does have members nearer the peak", upperFull.length > 0);

  const plates = layout.members.filter(m => m.name === "plate");
  check("a break is a double plate: the lower band's own top plate at 2962",
    plates.some(p => near(p.y, 3000 - POST_WIDTH, 1) && p.slope === undefined));
  check("and the upper band's own bottom plate at 3000",
    plates.some(p => near(p.y, 3000, 1)));
}

// ---- stacked frames: a flat lower frame and a triangular upper one --------
//
// The eaves height (2600) itself as the break: the lower band is exactly the
// old single-frame layout at 2600, and the upper band -- following the
// profile from 2600 up to the 4600 peak -- spans almost the whole wall.

{
  const { f, w } = straightWall({ height: 2600 });
  w.profile = [{ t: LEN / 2, height: 4600 }];
  w.frameBreaksMm = [2600];
  const { layout } = layoutOf(f, w);

  const lowerStuds = layout.members.filter(m => m.name === "stud" && near(m.y, POST_WIDTH, 1));
  check("every lower-band stud is exactly the flat-frame length (2600 less two plates)",
    lowerStuds.length > 0 && lowerStuds.every(s => s.lengthMm === 2600 - 2 * POST_WIDTH));

  const upperStuds = layout.members.filter(m => m.name === "stud" && near(m.y, 2600 + POST_WIDTH, 1));
  check("the upper band has studs of its own", upperStuds.length > 0);
  check("the upper band's studs vary in length -- they follow the profile",
    new Set(upperStuds.map(s => s.lengthMm)).size > 1);
  check("every upper-band stud carries a slope", upperStuds.every(s => s.slope !== undefined));

  const plates = layout.members.filter(m => m.name === "plate");
  check("two plates at the break: the lower band's own top plate at 2562",
    plates.some(p => near(p.y, 2600 - POST_WIDTH, 1)));
  check("and the upper band's own bottom plate at 2600",
    plates.some(p => near(p.y, 2600, 1) && p.h === POST_WIDTH));
}

// ---- an opening crossing a break is listed, and framed in the head's band -

{
  const { f, w } = straightWall();
  w.frameBreaksMm = [1500];
  const door = opening({ kind: "door", t: 2000, width: 900, sillHeight: 0, height: 2000 }); // 0..2000 crosses 1500
  w.openings = [door];
  const { layout } = layoutOf(f, w);
  check("an opening whose sill-to-head range crosses a break is listed",
    layout.openingsAcrossBreak.includes(door.id));

  const head = 2000;
  check("its header is framed in the band holding its head (above the break)",
    layout.members.some(m => m.name === "header" && near(m.y, head, 1)));
  check("its jack studs stand on the break's own band, not the floor",
    layout.members.some(m => m.name === "jack" && near(m.y, 1500 + POST_WIDTH, 1)));
}

// ---- a band divides its OWN runs -- a window in a lower band leaves no gap
// ---- in the band above it -------------------------------------------------
//
// Regression for a bug where every band reused rw.intervals (cut around
// EVERY wall opening) instead of cutting only around the openings that
// overlap that band: the upper band here has no opening of its own -- the
// window's head (2100) sits below the break (2600) -- so it must run clear
// across, with a stud within one bay width of everywhere and a nogging in
// every bay, the same as an ordinary unbanded wall would.

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = 2800;
  const n1 = newId("n"), n2 = newId("n");
  f.nodes = [{ id: n1, x: 0, y: 0 }, { id: n2, x: 4000, y: 0 }];
  const win = opening({ kind: "window", t: 2000, width: 1200, sillHeight: 900, height: 1200 });
  const w: Wall = {
    id: newId("w"), a: n1, b: n2, thickness: FRAME_TH, bulge: 0, openings: [win],
    material: "timber", postMm: POST_MM, postWidthMm: POST_WIDTH, noggingRows: 1,
    profile: [{ t: 2000, height: 4600 }], frameBreaksMm: [2600],
  };
  f.walls = [w];
  const { layout } = layoutOf(f, w);

  const upper = layout.members.filter(m => m.y >= 2600 - 0.5);
  const studXs = upper.filter(m => m.name === "stud").map(m => m.x + m.w / 2).sort((a, b) => a - b);
  check("the window (head 2100, below the break at 2600) is not framed in the upper band",
    upper.every(m => m.name !== "king" && m.name !== "jack" && m.name !== "header" && m.name !== "sill"));
  check("the upper band has a stud within one bay width (600mm) of the wall's own start",
    studXs.length > 0 && studXs[0]! <= 600);
  check("the upper band has a stud within one bay width of the wall's own end",
    studXs.length > 0 && LEN - studXs[studXs.length - 1]! <= 600);
  for (let i = 1; i < studXs.length; i++) {
    check(`no gap wider than one bay width between studs at ${studXs[i - 1]!.toFixed(0)} and ${studXs[i]!.toFixed(0)}`,
      studXs[i]! - studXs[i - 1]! <= 600 + 1);
  }
  check("a stud stands under the peak (within 300mm of x=2000)",
    studXs.some(x => Math.abs(x - 2000) <= 300));

  // 4000mm at 600mm centres is 7 equal bays (widthMm = 4000/7).
  const bayWidth = LEN / 7;
  const noggingXs = upper.filter(m => m.name === "nogging").map(m => m.x + m.w / 2);
  check("the upper band's noggings cover every one of the 7 bays",
    noggingXs.length === 7, String(noggingXs.length));
  for (let i = 0; i < 7; i++) {
    const cellCenter = bayWidth * i + bayWidth / 2;
    check(`a nogging covers bay ${i} (centre ${cellCenter.toFixed(0)})`,
      noggingXs.some(x => near(x, cellCenter, 5)));
  }
}

{
  // The elevation's outline reads the top line: two points on a flat wall,
  // the breakpoints on a gable.
  const flat = straightWall();
  check("a flat wall's top line is its two ends at the wall height",
    JSON.stringify(layoutOf(flat.f, flat.w).layout.topLine) === JSON.stringify([{ x: 0, y: H }, { x: LEN, y: H }]),
    JSON.stringify(layoutOf(flat.f, flat.w).layout.topLine));
  const gable = straightWall({ profile: [{ t: LEN / 2, height: H + 1000 }] });
  const line = layoutOf(gable.f, gable.w).layout.topLine;
  check("a gable's top line runs through its peak",
    line.length === 3 && line[1]!.x === LEN / 2 && line[1]!.y === H + 1000, JSON.stringify(line));
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
