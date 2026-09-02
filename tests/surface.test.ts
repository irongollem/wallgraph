// Wall face area: what a stucco, paint or wallpaper quantity is read off.
// The facts under test are the three that decide whether such a quantity is
// usable -- that the length measured is the MITERED face rather than the
// centerline, that an opening is deducted from both faces and clamped to the
// wall, and that a clad face is the one left out of the interior figure.
import {
  emptyDoc, newId, floorHeight, FLOOR_HEIGHT_DEFAULT,
  Wall, Opening, Floor,
} from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { detectRooms, roomKey } from "../src/core/rooms";
import { floorSurface } from "../src/core/surface";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

const W = 4000, D = 3000, TH = 100;

/** A closed 4000x3000 rectangle, one node per corner, walls in order. */
function rectFloor(): Floor {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(W, 0), v(W, D), v(0, D)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    f.walls.push({
      id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!,
      thickness: TH, bulge: 0, openings: [],
    } satisfies Wall);
  }
  return f;
}

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

const surfaceOf = (f: Floor) => floorSurface(f, resolveFloor(f), detectRooms(f));
/** The one room a closed rectangle encloses. */
const theRoom = (f: Floor) => surfaceOf(f).rooms[0]!;

// ---- face lengths -----------------------------------------------------------

{
  const f = rectFloor();
  const s = surfaceOf(f);
  const h = floorHeight(f);
  check("storey height is the default", h === FLOOR_HEIGHT_DEFAULT, String(h));

  // Every corner is a right-angle miter, so one face runs long by half a
  // thickness at each end and the other is eaten in by the same: the two faces
  // of a wall differ by 2 * TH even though they sum to twice the centerline.
  const long = surfaceOf(f).walls.find(x => x.wallId === f.walls[0]!.id)!;
  const lens = long.faces.map(x => x.lengthMm).sort((a, b) => a - b);
  check("a wall's two faces are the mitered ones, not the centerline",
    near(lens[0]!, W - TH) && near(lens[1]!, W + TH), lens.join(" / "));
  check("the two faces still sum to twice the centerline",
    near(lens[0]! + lens[1]!, 2 * W), String(lens[0]! + lens[1]!));

  // Which is the inner face flips with the wall's own a->b direction, so the
  // storey total is what is stable: twice the centerline perimeter, full height.
  const perimeter = 2 * (W + D);
  check("the storey's gross area is both faces of the whole perimeter",
    near(s.grossMm2, 2 * perimeter * h, 10), String(s.grossMm2));
  check("with no openings, net equals gross", s.netMm2 === s.grossMm2);
  check("no openings means no reveals", s.revealsMm2 === 0 && s.finishMm2 === s.netMm2);
  check("with no cladding, the inner figure is the whole one", s.innerMm2 === s.finishMm2);
  check("nothing is reported as clad", s.cladFaces === 0);
  check("every wall is listed", s.walls.length === 4);
  check("the per-wall figures sum to the storey's",
    near(s.walls.reduce((n, x) => n + x.netMm2, 0), s.netMm2, 1));
}

// ---- openings ---------------------------------------------------------------

{
  const f = rectFloor();
  const bare = surfaceOf(f).netMm2;
  const w = f.walls[0]!;
  const door = opening({ kind: "door", t: 2000, width: 900, height: 2315 });
  w.openings.push(door);
  const s = surfaceOf(f);
  const cut = 900 * 2315;

  check("an opening is deducted from both faces of its wall",
    near(s.openingsMm2, 2 * cut, 1), String(s.openingsMm2));
  check("net is gross less the deduction", near(s.netMm2, s.grossMm2 - 2 * cut, 1));
  check("the deduction is the whole difference from a bare storey",
    near(s.netMm2, bare - 2 * cut, 1));

  const one = s.walls.find(x => x.wallId === w.id)!;
  check("the wall carrying it reports the count", one.openings === 1);
  const others = s.walls.filter(x => x.wallId !== w.id);
  check("no other wall is touched", others.every(x => x.openingsMm2 === 0));
}

{
  // Taller than the wall: an opening cuts the wall, not more than the wall.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.height = 2000;
  w.openings.push(opening({ kind: "door", t: 2000, width: 900, height: 4000 }));
  const one = surfaceOf(f).walls.find(x => x.wallId === w.id)!;
  check("an opening taller than its wall is clamped to it",
    near(one.openingsMm2, 2 * 900 * 2000, 1), String(one.openingsMm2));
  check("a wall's own height overrides the storey's", one.heightMm === 2000);
  check("and is what its faces are measured at",
    near(one.grossMm2, 2000 * one.faces.reduce((n, x) => n + x.lengthMm, 0), 1));
}

{
  // A window's sill is below the wall head, so the whole sash is deducted; a
  // sill above it leaves nothing to deduct.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.height = 1000;
  w.openings.push(opening({ kind: "window", t: 2000, width: 1200, sillHeight: 1500, height: 1400 }));
  const one = surfaceOf(f).walls.find(x => x.wallId === w.id)!;
  check("an opening entirely above its wall deducts nothing",
    one.openingsMm2 === 0, String(one.openingsMm2));
}

// ---- reveals (dagkanten) ----------------------------------------------------

const DOOR_H = 2315;
/** Two jambs and a head at the wall's thickness -- never a sill. */
const reveal = (w: number, h: number, th = TH): number => (2 * h + w) * th;

{
  const f = rectFloor();
  const w = f.walls[0]!;
  w.openings.push(opening({ kind: "door", t: 2000, width: 900, height: DOOR_H }));
  const s = surfaceOf(f);
  const one = s.walls.find(x => x.wallId === w.id)!;

  check("a door opens two jambs and a head",
    near(one.revealsMm2, reveal(900, DOOR_H), 1), String(one.revealsMm2));
  check("counted once across the two faces, half each",
    one.faces.every(x => near(x.revealsMm2, reveal(900, DOOR_H) / 2, 1)),
    one.faces.map(x => x.revealsMm2).join("/"));
  check("the net figure does not carry them",
    near(one.netMm2, one.grossMm2 - 2 * 900 * DOOR_H, 1));
  check("the finishing figure is net plus reveals",
    near(one.finishMm2, one.netMm2 + one.revealsMm2, 1));
  check("and the storey's is too", near(s.finishMm2, s.netMm2 + s.revealsMm2, 1));
  check("a wall with no openings has none",
    s.walls.filter(x => x.wallId !== w.id).every(x => x.revealsMm2 === 0));
}

{
  // No sill, so a window of the same clear size opens the same reveal as a
  // door: under a door the sill is the floor, under a window a vensterbank.
  const f = rectFloor();
  f.walls[0]!.openings.push(
    opening({ kind: "window", t: 2000, width: 900, sillHeight: 0, height: DOOR_H }));
  const win = surfaceOf(f).walls.find(x => x.wallId === f.walls[0]!.id)!;
  check("a window opens the same reveal as a door of its size",
    near(win.revealsMm2, reveal(900, DOOR_H), 1), String(win.revealsMm2));
}

{
  // The reveal runs through the wall, so it scales with the thickness.
  const thin = rectFloor();
  thin.walls[0]!.openings.push(opening({ kind: "door", t: 2000, width: 900, height: DOOR_H }));
  const thick = rectFloor();
  thick.walls[0]!.thickness = 2 * TH;
  thick.walls[0]!.openings.push(opening({ kind: "door", t: 2000, width: 900, height: DOOR_H }));
  const a = surfaceOf(thin).revealsMm2, b = surfaceOf(thick).revealsMm2;
  check("twice the wall is twice the reveal", near(b, 2 * a, 1), `${a} -> ${b}`);
}

{
  // A ceiling below the opening's head takes the head with it: what is above
  // the ceiling is not finished on that side, and the jambs stop at it.
  const f = rectFloor();
  f.ceilingMm = 2000;
  const w = f.walls[0]!;
  w.openings.push(opening({ kind: "door", t: 2000, width: 900, height: DOOR_H }));
  const one = surfaceOf(f).walls.find(x => x.wallId === w.id)!;
  const inside = one.faces.find(x => x.roomKey !== undefined)!;
  const outside = one.faces.find(x => x.roomKey === undefined)!;
  check("the lowered face keeps jambs to the ceiling and no head",
    near(inside.revealsMm2, (2 * 2000 * TH) / 2, 1), String(inside.revealsMm2));
  check("while the face at full height keeps the whole reveal",
    near(outside.revealsMm2, reveal(900, DOOR_H) / 2, 1), String(outside.revealsMm2));
}

{
  // The two rooms either side of a doorway each finish their half of it.
  const f = rectFloor();
  const t0 = newId("n"), b0 = newId("n");
  f.nodes.push({ id: t0, x: 2000, y: 0 }, { id: b0, x: 2000, y: D });
  const top = f.walls[0]!, bottom = f.walls[2]!;
  const topB = top.b, bottomB = bottom.b;
  top.b = t0;
  bottom.b = b0;
  f.walls.push(
    { id: newId("w"), a: t0, b: topB, thickness: TH, bulge: 0, openings: [] },
    { id: newId("w"), a: b0, b: bottomB, thickness: TH, bulge: 0, openings: [] },
    { id: newId("w"), a: t0, b: b0, thickness: TH, bulge: 0, openings: [] },
  );
  const partition = f.walls[6]!;
  partition.openings.push(opening({ kind: "passage", t: 1500, width: 900, height: DOOR_H }));
  const s = surfaceOf(f);
  check("the doorway is in two rooms", s.rooms.length === 2);
  const half = reveal(900, DOOR_H) / 2;
  check("each room finishes half the doorway's reveal",
    s.rooms.every(r => near(r.revealsMm2, half, 1)),
    s.rooms.map(r => r.revealsMm2).join("/"));
  check("and the two halves are the whole reveal",
    near(s.rooms.reduce((n, r) => n + r.revealsMm2, 0), reveal(900, DOOR_H), 1));
  // An internal doorway has no face outside, so no part of its reveal escapes
  // into the storey's unroomed figure -- unlike the window two blocks down.
  check("an internal doorway leaves no reveal outside",
    near(s.revealsMm2, s.rooms.reduce((n, r) => n + r.revealsMm2, 0), 1),
    String(s.revealsMm2));
}

{
  // An exterior window: the inner reveal is plastered inside, the outer half
  // belongs to the facade -- and lands outside, not in the room.
  const f = rectFloor();
  f.walls[0]!.openings.push(opening({ kind: "window", t: 2000, width: 1200, height: 1400 }));
  const s = surfaceOf(f);
  const room = theRoom(f);
  const whole = reveal(1200, 1400);
  check("the room takes half the window's reveal",
    near(room.revealsMm2, whole / 2, 1), String(room.revealsMm2));
  check("the other half is outside",
    near(s.revealsMm2 - room.revealsMm2, whole / 2, 1));
}

// ---- cladding ---------------------------------------------------------------

{
  const f = rectFloor();
  const w = f.walls[0]!;
  w.facadeMm = 100;
  w.facadeSide = "left";
  const s = surfaceOf(f);
  const one = s.walls.find(x => x.wallId === w.id)!;
  const left = one.faces.find(x => x.side === "left")!;
  const right = one.faces.find(x => x.side === "right")!;

  check("the clad face is the stated one", left.clad && !right.clad);
  check("the storey counts one clad face", s.cladFaces === 1);
  check("the clad face is left out of the wall's inner figure",
    near(one.innerMm2, right.finishMm2, 1), `${one.innerMm2} vs ${right.finishMm2}`);
  check("but stays in its net area", one.netMm2 === left.netMm2 + right.netMm2);
  check("the storey's inner figure drops by that one face",
    near(s.innerMm2, s.finishMm2 - left.finishMm2, 1));

  // A wall that states no cladding says nothing about which face is outside,
  // so it keeps both -- the interior figure never guesses.
  const plain = s.walls.find(x => x.wallId === f.walls[1]!.id)!;
  check("a wall with no cladding contributes both faces",
    plain.innerMm2 === plain.finishMm2);
}

{
  // The right side, to prove the side is read and not assumed.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.facadeMm = 100;
  w.facadeSide = "right";
  const one = surfaceOf(f).walls.find(x => x.wallId === w.id)!;
  check("cladding on the right marks the right face",
    !one.faces[0]!.clad && one.faces[1]!.clad);
}

// ---- listing ----------------------------------------------------------------

{
  const f = rectFloor();
  const s = surfaceOf(f);
  const nets = s.walls.map(x => x.finishMm2);
  check("walls are listed largest finishing area first",
    nets.every((n, i) => i === 0 || nets[i - 1]! >= n), nets.join(" / "));
}

{
  // resolveFloor() drops a wall whose nodes coincide, and a wall with no
  // geometry has no face to finish.
  const f = rectFloor();
  const id = newId("n");
  f.nodes.push({ id, x: 0, y: 0 });
  f.walls.push({ id: newId("w"), a: f.nodes[0]!.id, b: id, thickness: TH, bulge: 0, openings: [] });
  const s = surfaceOf(f);
  check("a degenerate wall is absent rather than zero-area", s.walls.length === 4);
}

{
  const doc = emptyDoc();
  const s = surfaceOf(doc.floors[0]!);
  check("an empty storey reports nothing",
    s.walls.length === 0 && s.grossMm2 === 0 && s.netMm2 === 0 && s.cladFaces === 0);
}

// ---- rooms ------------------------------------------------------------------

{
  const f = rectFloor();
  const rooms = detectRooms(f);
  check("the rectangle encloses one room", rooms.length === 1, String(rooms.length));

  // The face a room looks into is the one eaten in by its neighbours -- the
  // shorter of the two. This is the whole direction convention in one check:
  // get it backwards and every room reports its neighbours' outer faces.
  const s = surfaceOf(f);
  for (const wall of s.walls) {
    const inside = wall.faces.find(x => x.roomKey !== undefined);
    const outside = wall.faces.find(x => x.roomKey === undefined);
    check("a room looks into the shorter face of each of its walls",
      inside !== undefined && outside !== undefined && inside.lengthMm < outside.lengthMm,
      `${inside?.lengthMm} vs ${outside?.lengthMm}`);
  }

  const room = theRoom(f);
  check("the room is bounded by one face of each wall", room.faces === 4, String(room.faces));
  const h = floorHeight(f);
  const innerPerimeter = 2 * ((W - TH) + (D - TH));
  check("its wall area is the inner perimeter, full height",
    near(room.netMm2, innerPerimeter * h, 10), String(room.netMm2));
  check("the outer faces belong to no room",
    near(s.unroomedMm2, s.finishMm2 - room.finishMm2, 10), String(s.unroomedMm2));
  check("room and unroomed together are the whole storey",
    near(room.finishMm2 + s.unroomedMm2, s.finishMm2, 1));
  check("no ceiling is stated", room.ceilingMm === undefined);
}

{
  // A wall standing inside the room bounds it on BOTH sides, and a finishing
  // quantity has to count both.
  const f = rectFloor();
  const mid = newId("n");
  f.nodes.push({ id: mid, x: 2000, y: 1500 });
  f.walls.push({
    id: newId("w"), a: f.nodes[0]!.id, b: mid, thickness: TH, bulge: 0, openings: [],
  });
  const rooms = detectRooms(f);
  check("a peninsula does not divide the room", rooms.length === 1, String(rooms.length));
  const spur = rooms[0]!.boundingFaces.filter(rf => rf.wallId === f.walls[4]!.id);
  check("both of its faces look into the room",
    spur.length === 2 && spur.some(x => x.side === "left") && spur.some(x => x.side === "right"),
    JSON.stringify(spur));
  check("and both are counted", theRoom(f).faces === 6);
}

{
  // An open chain closes nothing, so every face is outside.
  const f = rectFloor();
  f.walls.pop();
  const s = surfaceOf(f);
  check("an open plan reports no rooms", s.rooms.length === 0);
  check("and puts all of its face area outside", near(s.unroomedMm2, s.finishMm2, 1));
}

// ---- suspended ceilings -----------------------------------------------------

{
  const f = rectFloor();
  const full = surfaceOf(f);
  f.ceilingMm = 2400;
  const s = surfaceOf(f);
  const h = floorHeight(f);

  check("the room is finished to the storey's ceiling", theRoom(f).ceilingMm === 2400);
  const inner = s.walls.flatMap(x => x.faces).filter(x => x.roomKey !== undefined);
  const outer = s.walls.flatMap(x => x.faces).filter(x => x.roomKey === undefined);
  check("faces looking into it are measured to it",
    inner.every(x => x.heightMm === 2400), inner.map(x => x.heightMm).join("/"));
  check("faces looking outside keep the wall's own height",
    outer.every(x => x.heightMm === h), outer.map(x => x.heightMm).join("/"));
  check("so the room's area drops in proportion",
    near(theRoom(f).netMm2, full.rooms[0]!.netMm2 * (2400 / h), 10));
  check("a wall still reports its structural height", s.walls.every(x => x.heightMm === h));
  check("and the storey total drops by only the inside",
    near(s.netMm2, full.netMm2 - (full.rooms[0]!.netMm2 - theRoom(f).netMm2), 10));
}

{
  // A ceiling at or above the storey height finishes nothing extra, so it is
  // not a ceiling: a face is already finished to the floor above.
  const f = rectFloor();
  const plain = surfaceOf(f).netMm2;
  f.ceilingMm = floorHeight(f);
  check("a ceiling at the storey height states nothing",
    theRoom(f).ceilingMm === undefined && near(surfaceOf(f).netMm2, plain, 1));
  f.ceilingMm = floorHeight(f) + 500;
  check("nor does one above it",
    theRoom(f).ceilingMm === undefined && near(surfaceOf(f).netMm2, plain, 1));
}

{
  // A room's own ceiling overrides the storey's, and only for that room.
  const f = rectFloor();
  f.ceilingMm = 2600;
  const anchor = detectRooms(f)[0]!.centroid;
  const nameId = newId("rn");
  f.roomNames = [{
    id: nameId, x: Math.round(anchor.x), y: Math.round(anchor.y),
    name: "Badkamer", ceilingMm: 2300,
  }];
  const room = theRoom(f);
  check("the room's own ceiling wins over the storey's", room.ceilingMm === 2300);
  check("and the row carries its name", room.name === "Badkamer");
  check("its key matches the room it came from",
    room.key === roomKey(detectRooms(f)[0]!));

  // Above the storey height it states nothing, and the storey answers instead.
  f.roomNames[0]!.ceilingMm = 4000;
  check("a room ceiling above the storey falls back to the storey's",
    theRoom(f).ceilingMm === 2600);
  delete f.roomNames[0]!.ceilingMm;
  check("an unstated room ceiling falls back too", theRoom(f).ceilingMm === 2600);
}

{
  // Two rooms, one with a low ceiling: the wall between them is finished to a
  // different height on each side, which is the whole reason a face carries
  // its own height rather than the wall carrying one.
  const f = rectFloor();
  const t0 = newId("n"), b0 = newId("n");
  f.nodes.push({ id: t0, x: 2000, y: 0 }, { id: b0, x: 2000, y: D });
  // Split the top and bottom walls at x=2000 and run a partition between them.
  const top = f.walls[0]!, bottom = f.walls[2]!;
  const topB = top.b, bottomB = bottom.b;
  top.b = t0;
  bottom.b = b0;
  f.walls.push(
    { id: newId("w"), a: t0, b: topB, thickness: TH, bulge: 0, openings: [] },
    { id: newId("w"), a: b0, b: bottomB, thickness: TH, bulge: 0, openings: [] },
    { id: newId("w"), a: t0, b: b0, thickness: TH, bulge: 0, openings: [] },
  );
  const partition = f.walls[6]!;
  const rooms = detectRooms(f);
  check("the partition makes two rooms", rooms.length === 2, String(rooms.length));

  const left = rooms.find(r => r.centroid.x < 2000)!;
  f.roomNames = [{
    id: newId("rn"), x: Math.round(left.centroid.x), y: Math.round(left.centroid.y),
    name: "Badkamer", ceilingMm: 2300,
  }];
  const s = surfaceOf(f);
  const wall = s.walls.find(x => x.wallId === partition.id)!;
  const heights = wall.faces.map(x => x.heightMm).sort((a, b) => a - b);
  check("the partition is finished to a different height on each side",
    heights[0] === 2300 && heights[1] === floorHeight(f), heights.join("/"));
  const named = s.rooms.find(r => r.name === "Badkamer")!;
  const other = s.rooms.find(r => r.name === undefined)!;
  check("only the named room is lowered",
    named.ceilingMm === 2300 && other.ceilingMm === undefined);
  check("both rooms are reported", s.rooms.length === 2);
  check("the partition's two faces land in different rooms",
    wall.faces[0]!.roomKey !== wall.faces[1]!.roomKey);
}

{
  // An opening is clamped to the FACE, so a door taller than a low ceiling is
  // deducted only down to it.
  const f = rectFloor();
  f.ceilingMm = 2000;
  const w = f.walls[0]!;
  w.openings.push(opening({ kind: "door", t: 2000, width: 900, height: 2315 }));
  const s = surfaceOf(f);
  const wall = s.walls.find(x => x.wallId === w.id)!;
  const inside = wall.faces.find(x => x.roomKey !== undefined)!;
  const outside = wall.faces.find(x => x.roomKey === undefined)!;
  check("the deduction on the lowered face stops at the ceiling",
    near(inside.openingsMm2, 900 * 2000, 1), String(inside.openingsMm2));
  check("while the face at full height loses the whole door",
    near(outside.openingsMm2, 900 * 2315, 1), String(outside.openingsMm2));
}

console.log(failures === 0 ? "ALL SURFACE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
