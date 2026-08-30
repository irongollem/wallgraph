// Framing and room names.
//
// Two things landed together here because they are the same feature: a plan is
// read by going out to the whole thing and back in to one room, and a room is
// worth going back into once it has a name. So this covers what a view is
// fitted to (planBounds and Viewport.fitBox) and how a stored name finds the
// derived room it belongs to.
import { Viewport, MIN_PX_PER_MM, MAX_PX_PER_MM, clampZoom } from "../src/render/viewport";
import { planBounds, polyBounds } from "../src/core/bounds";
import { detectRooms } from "../src/core/rooms";
import { resolveFloor } from "../src/core/resolve";
import { emptyDoc, newId, roomNamesOf, Floor } from "../src/model/doc";
import { ROOM_NAMES } from "../src/model/room";
import { planSchema, validate } from "../scripts/site/schema";
import { v } from "../src/geometry/vec";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

/** A closed rectangular room of walls, in mm. */
function box(f: Floor, x0: number, y0: number, x1: number, y1: number, thickness = 100): void {
  const ids = [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)].map(p => {
    const id = newId("n");
    f.nodes.push({ id, x: p.x, y: p.y });
    return id;
  });
  for (let i = 0; i < 4; i++) {
    f.walls.push({
      id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness, bulge: 0, openings: [],
    });
  }
}

/* ── fitting a view ── */

{
  const vp = new Viewport();
  vp.fitBox(800, 600, v(0, 0), v(4000, 3000), 0);
  // The box is 4:3 and so is the canvas, so both axes bind at once.
  check("a fitted box fills the canvas", Math.abs(vp.pxPerMm - 0.2) < 1e-9, String(vp.pxPerMm));
  const c = vp.toScreen(v(2000, 1500));
  check("the box is centred", Math.abs(c.x - 400) < 1e-6 && Math.abs(c.y - 300) < 1e-6,
    JSON.stringify(c));
  // Round trip: the corners land on the canvas corners.
  const tl = vp.toScreen(v(0, 0)), br = vp.toScreen(v(4000, 3000));
  check("the corners land on the canvas corners",
    Math.abs(tl.x) < 1e-6 && Math.abs(br.x - 800) < 1e-6, `${tl.x} / ${br.x}`);
}

{
  const vp = new Viewport();
  // A tall box in a wide canvas binds on height, and stays centred horizontally.
  vp.fitBox(1000, 500, v(0, 0), v(1000, 4000), 0);
  check("the tighter axis decides the zoom", Math.abs(vp.pxPerMm - 0.125) < 1e-9,
    String(vp.pxPerMm));
  const c = vp.toScreen(v(500, 2000));
  check("it stays centred on the other axis", Math.abs(c.x - 500) < 1e-6, String(c.x));
}

{
  const vp = new Viewport();
  // A degenerate box is real: one node, or a zero-width drag. It must not
  // divide by zero or zoom to infinity.
  vp.fitBox(800, 600, v(1000, 1000), v(1000, 1000), 0);
  check("a point frames without dividing by zero", isFinite(vp.pxPerMm) && vp.pxPerMm > 0,
    String(vp.pxPerMm));
  check("a point's zoom stays inside the wheel's range", vp.pxPerMm <= MAX_PX_PER_MM);
  const c = vp.toScreen(v(1000, 1000));
  check("a point still centres", Math.abs(c.x - 400) < 1e-6 && Math.abs(c.y - 300) < 1e-6);
}

{
  const vp = new Viewport();
  // A plan the size of a city has to clamp rather than vanish, and the clamp
  // must be the one the wheel obeys or the view strands where zoom cannot return.
  vp.fitBox(800, 600, v(0, 0), v(1e9, 1e9), 0);
  check("a huge box clamps to the minimum zoom", vp.pxPerMm === MIN_PX_PER_MM, String(vp.pxPerMm));
  check("clampZoom agrees with the wheel's bounds",
    clampZoom(1e6) === MAX_PX_PER_MM && clampZoom(0) === MIN_PX_PER_MM);
  const zoomed = new Viewport();
  zoomed.zoomAt(v(0, 0), 1e9);
  check("the wheel stops at the same ceiling", zoomed.pxPerMm === MAX_PX_PER_MM);
}

{
  const vp = new Viewport();
  vp.fitBox(800, 600, v(0, 0), v(4000, 3000));
  // The default margin leaves paper around the plan rather than cropping to it.
  const tl = vp.toWorld(v(0, 0));
  check("the default margin leaves paper around the plan", tl.x < 0 && tl.y < 0,
    JSON.stringify(tl));
}

/* ── what gets framed ── */

{
  const doc = emptyDoc(), f = doc.floors[0]!;
  box(f, 0, 0, 4000, 3000, 300);
  const b = planBounds(f, resolveFloor(f))!;
  // Wall OUTLINES, not centerlines: a 300 mm wall reaches 150 past its centre.
  check("the crop covers the masonry, not just the centerlines",
    b.min.x <= -150 && b.max.x >= 4150, JSON.stringify(b));
}

{
  // The bug this replaced: main.ts framed the node positions alone, so a plan
  // whose symbols hung past the walls opened cropped while it exported whole.
  const doc = emptyDoc(), f = doc.floors[0]!;
  box(f, 0, 0, 4000, 3000);
  f.symbols.push({ id: newId("s"), type: "socket-single", x: 9000, y: 0, rotation: 0 });
  const b = planBounds(f, resolveFloor(f))!;
  check("a symbol outside the walls is still framed", b.max.x >= 9000, JSON.stringify(b));

  const g = emptyDoc().floors[0]!;
  g.cabinets = [{
    id: newId("k"), kind: "base", x: 5000, y: 200, rotation: 0,
    width: 600, depth: 600, front: "door",
  }];
  const cb = planBounds(g, resolveFloor(g))!;
  check("a cabinet alone is framed", cb.max.y >= 800 && cb.min.x <= 4700, JSON.stringify(cb));

  const h = emptyDoc().floors[0]!;
  h.roomNames = [{ id: newId("r"), x: 1500, y: 800, name: "Keuken" }];
  check("a plan of nothing but a name still frames", planBounds(h, resolveFloor(h)) !== null);
}

{
  check("an empty floor frames nothing",
    planBounds(emptyDoc().floors[0]!, resolveFloor(emptyDoc().floors[0]!)) === null);
  check("an empty polygon frames nothing", polyBounds([]) === null);
  const pb = polyBounds([v(0, 0), v(100, 400)])!;
  check("a polygon frames its extent",
    pb.min.x === 0 && pb.max.y === 400, JSON.stringify(pb));
}

/* ── room names ── */

{
  const doc = emptyDoc(), f = doc.floors[0]!;
  box(f, 0, 0, 4000, 3000);
  const rooms0 = detectRooms(f);
  check("one box is one room", rooms0.length === 1, String(rooms0.length));
  check("an unnamed room carries no name", rooms0[0]!.name === undefined);

  const id = newId("r");
  f.roomNames = [{ id, x: 2000, y: 1500, name: "Keuken" }];
  const rooms = detectRooms(f);
  check("a name inside a room attaches to it", rooms[0]!.name === "Keuken", String(rooms[0]!.name));
  check("the room remembers which name it took", rooms[0]!.nameId === id);
}

{
  const doc = emptyDoc(), f = doc.floors[0]!;
  box(f, 0, 0, 4000, 3000);
  // Outside the walls entirely: the name stays unattached rather than being
  // assigned to whatever room happens to be nearest.
  f.roomNames = [{ id: newId("r"), x: 9000, y: 9000, name: "Schuur" }];
  check("a name outside every room attaches to none",
    detectRooms(f).every(r => r.name === undefined));
}

{
  const doc = emptyDoc(), f = doc.floors[0]!;
  box(f, 0, 0, 4000, 3000);
  // Matched on the NET boundary, so a name written close to a wall face still
  // lands in the room rather than in the masonry.
  f.roomNames = [{ id: newId("r"), x: 100, y: 100, name: "Hal" }];
  check("a name near a wall face still lands in the room",
    detectRooms(f)[0]!.name === "Hal");
}

{
  const doc = emptyDoc(), f = doc.floors[0]!;
  box(f, 0, 0, 4000, 3000);
  // Two names in one room is a mistake, not a merge: the first wins and the
  // second stays unattached, so nothing silently concatenates.
  const a = newId("r"), b = newId("r");
  f.roomNames = [
    { id: a, x: 1000, y: 1000, name: "Keuken" },
    { id: b, x: 3000, y: 2000, name: "Woonkamer" },
  ];
  const rooms = detectRooms(f);
  check("a room takes one name", rooms.filter(r => r.name !== undefined).length === 1);
  check("the first name written wins", rooms[0]!.nameId === a, String(rooms[0]!.nameId));
}

{
  const doc = emptyDoc(), f = doc.floors[0]!;
  // Two rooms side by side, one named each.
  box(f, 0, 0, 3000, 3000);
  box(f, 4000, 0, 7000, 3000);
  const ka = newId("r"), wo = newId("r");
  f.roomNames = [
    { id: ka, x: 1500, y: 1500, name: "Keuken" },
    { id: wo, x: 5500, y: 1500, name: "Woonkamer" },
  ];
  const rooms = detectRooms(f);
  check("two rooms are detected", rooms.length === 2, String(rooms.length));
  const names = rooms.map(r => r.name).sort();
  check("each name finds its own room", names.join(",") === "Keuken,Woonkamer", names.join(","));

  // The colour rides along, so the canvas and the SVG can draw it in the pen
  // it was written with without looking the name up again.
  f.roomNames[0]!.color = "#d0342c";
  check("a name's pen reaches the room",
    detectRooms(f).find(r => r.name === "Keuken")?.nameColor === "#d0342c");
}

{
  const doc = emptyDoc(), f = doc.floors[0]!;
  box(f, 0, 0, 4000, 3000);
  f.roomNames = [{ id: newId("r"), x: 2000, y: 1500, name: "Keuken" }];
  check("a floor's room names read back", roomNamesOf(f).length === 1);
  check("a floor with none reads back empty", roomNamesOf({ ...f, roomNames: undefined }).length === 0);

  const errs = validate(planSchema(""), doc);
  check("a document with a room name validates", errs.length === 0, errs.join(" | "));

  const bad = JSON.parse(JSON.stringify(doc));
  bad.floors[0].roomNames[0].name = "";
  check("an empty name is rejected", validate(planSchema(""), bad).length > 0);

  const bad2 = JSON.parse(JSON.stringify(doc));
  bad2.floors[0].roomNames[0].room = "r1";
  // Which room a name belongs to is derived, so there is nothing to store.
  check("a stored room reference is rejected", validate(planSchema(""), bad2).length > 0);
}

for (const lng of ["nl", "en"] as const) {
  const dict = (resources[lng].translation as unknown as Record<string, Record<string, string>>).room ?? {};
  const missing = ROOM_NAMES.filter(id => typeof dict[id] !== "string");
  check(`every offered room name has a ${lng} translation`, missing.length === 0, missing.join(", "));
  const stale = Object.keys(dict).filter(k => !ROOM_NAMES.includes(k));
  check(`no ${lng} names for removed rooms`, stale.length === 0, stale.join(", "));
}

console.log(`${ROOM_NAMES.length} offered room names`);
console.log(failures === 0 ? "ALL VIEW TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
