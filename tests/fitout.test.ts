// Fit-out figure tests (workstations, daylight ratio, ventilation demand),
// run with tsx.
import {
  emptyDoc, newId, WINDOW_HEIGHT_DEFAULT, type Wall, type Opening, type PlanDoc, type Floor, type AreaMode,
} from "../src/model/doc";
import { detectRooms } from "../src/core/rooms";
import { roomFigures, roomVentRouted, WORKPLACE_MIN_M2, VENT_DM3S_PER_PERSON } from "../src/core/fitout";
import type { RoomUse } from "../src/model/room";
import type { Route } from "../src/model/route";
import { v } from "../src/geometry/vec";
import { planSchema, validate } from "../scripts/site/schema";
import { t, resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1e-6): boolean { return Math.abs(a - b) <= tol; }

/** A closed rectangular room, `w` x `d` mm, wall thickness `wallTh`. */
function rectFloor(w: number, d: number, wallTh = 100): Floor {
  const f = emptyDoc().floors[0]!;
  const pts = [v(0, 0), v(w, 0), v(w, d), v(0, d)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    const wall: Wall = { id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: wallTh, bulge: 0, openings: [] };
    f.walls.push(wall);
  }
  return f;
}

/** Writes a name at (x, y), optionally stating a use, and returns its id. */
function nameRoom(f: Floor, x: number, y: number, name: string, use?: RoomUse): string {
  const id = newId("r");
  (f.roomNames ??= []).push({ id, x, y, name, ...(use ? { use } : {}) });
  return id;
}

function docWith(areaMode?: AreaMode): PlanDoc {
  const doc = emptyDoc();
  if (areaMode) doc.areaMode = areaMode;
  return doc;
}

// --- capacity from net area at the 7 m^2 figure ---
{
  const f = rectFloor(4000, 3000, 100);
  nameRoom(f, 2000, 1500, "Kantoor", "verblijf");
  const rooms = detectRooms(f);
  check("one room detected", rooms.length === 1, String(rooms.length));
  const r = rooms[0]!;
  check("room takes the name", r.name === "Kantoor");
  const figures = roomFigures(f, r, docWith());
  check("verblijf room gets figures", figures !== null);
  if (figures) {
    // Net area: 4000x3000 inset by half of a 100mm wall on every side -> 3900x2900.
    check("area is the net dagmaat by default", near(figures.areaM2, (3900 * 2900) / 1e6));
    check("workstations = floor(net area / 7)", figures.workstations === Math.floor((3900 * 2900) / 1e6 / WORKPLACE_MIN_M2),
      String(figures.workstations));
  }
}

// --- area basis flips with areaMode ---
{
  const f = rectFloor(4000, 3600, 100);
  nameRoom(f, 2000, 1800, "Kantoor", "verblijf");
  const r = detectRooms(f)[0]!;

  const net = roomFigures(f, r, docWith("net"))!;
  const centerline = roomFigures(f, r, docWith("centerline"))!;
  // net: 3900x3500 = 13.65 m^2 -> 1 workstation. centerline: 4000x3600 = 14.4 m^2 -> 2.
  check("net area figure", near(net.areaM2, (3900 * 3500) / 1e6), String(net.areaM2));
  check("centerline area figure", near(centerline.areaM2, (4000 * 3600) / 1e6), String(centerline.areaM2));
  check("net workstations", net.workstations === 1, String(net.workstations));
  check("centerline workstations differs from net for the same room", centerline.workstations === 2,
    String(centerline.workstations));
}

// --- a room without a stated use gets no figures ---
{
  const f = rectFloor(4000, 3000, 100);
  nameRoom(f, 2000, 1500, "Berging"); // no use stated
  const r = detectRooms(f)[0]!;
  check("no stated use -> null", roomFigures(f, r, docWith()) === null);
}
{
  const f = rectFloor(4000, 3000, 100);
  nameRoom(f, 2000, 1500, "Toilet", "sanitair");
  const r = detectRooms(f)[0]!;
  check("a non-verblijf use -> null", roomFigures(f, r, docWith()) === null);
}

// --- a window on a bounding wall contributes width x height to glazing ---
{
  const f = rectFloor(4000, 3000, 100);
  const win: Opening = { id: newId("o"), kind: "window", t: 2000, width: 1200, sashes: [] };
  f.walls[0]!.openings.push(win); // top wall, (0,0)-(4000,0)
  nameRoom(f, 2000, 1500, "Kantoor", "verblijf");
  const r = detectRooms(f)[0]!;
  check("the window's wall bounds the room", r.boundingWallIds.includes(f.walls[0]!.id));
  const figures = roomFigures(f, r, docWith())!;
  const glazingMm2 = 1200 * WINDOW_HEIGHT_DEFAULT;
  const expectedRatio = glazingMm2 / (3900 * 2900);
  check("daylight ratio from one window", near(figures.daylightRatio, expectedRatio, 1e-9),
    `${figures.daylightRatio} vs ${expectedRatio}`);
}
{
  const f = rectFloor(4000, 3000, 100);
  nameRoom(f, 2000, 1500, "Kantoor", "verblijf"); // no openings anywhere
  const r = detectRooms(f)[0]!;
  const figures = roomFigures(f, r, docWith())!;
  check("no glazing -> zero daylight ratio", figures.daylightRatio === 0, String(figures.daylightRatio));
}

// --- ventilation demand arithmetic ---
{
  const f = rectFloor(8000, 6000, 100);
  nameRoom(f, 4000, 3000, "Kantoor", "verblijf");
  const r = detectRooms(f)[0]!;
  const figures = roomFigures(f, r, docWith())!;
  check("has workstations to ventilate", figures.workstations > 0, String(figures.workstations));
  const expected = figures.workstations * VENT_DM3S_PER_PERSON * 3.6;
  check("ventilation demand = workstations x 6.5 dm3/s x 3.6", near(figures.ventilationM3h, expected, 1e-9));
}

// --- workplaceNone flag on a tiny verblijf room ---
{
  const f = rectFloor(1500, 1500, 100);
  nameRoom(f, 750, 750, "Kastje", "verblijf");
  const r = detectRooms(f)[0]!;
  const figures = roomFigures(f, r, docWith())!;
  check("tiny room has zero workstations", figures.workstations === 0, String(figures.workstations));
  check("workplaceNone is flagged", figures.issues.some(i => i.code === "workplaceNone"), JSON.stringify(figures.issues));
  const issue = figures.issues.find(i => i.code === "workplaceNone")!;
  check("the flag's limit is WORKPLACE_MIN_M2", issue.limit === WORKPLACE_MIN_M2);
}
// ...and no flag on a room that clears one workstation.
{
  const f = rectFloor(4000, 3000, 100);
  nameRoom(f, 2000, 1500, "Kantoor", "verblijf");
  const r = detectRooms(f)[0]!;
  const figures = roomFigures(f, r, docWith())!;
  check("an ordinary room is not flagged", figures.issues.length === 0, JSON.stringify(figures.issues));
}

// --- schema: use is accepted, an unknown value is rejected ---
{
  const schema = planSchema("");
  const full: PlanDoc = {
    version: 1, unit: "mm", gridMm: 100,
    floors: [{
      id: "f1", name: "Begane grond",
      nodes: [{ id: "n1", x: 0, y: 0 }],
      walls: [],
      symbols: [],
      roomNames: [{ id: "r1", x: 100, y: 100, name: "Kantoor", use: "verblijf" }],
    }],
  };
  check("a roomName with use validates", validate(schema, full).length === 0, validate(schema, full).join(" | "));

  const noUse: PlanDoc = JSON.parse(JSON.stringify(full));
  delete noUse.floors[0]!.roomNames![0]!.use;
  check("use may be absent", validate(schema, noUse).length === 0);

  const bad = JSON.parse(JSON.stringify(full)) as PlanDoc;
  (bad.floors[0]!.roomNames![0]! as unknown as Record<string, unknown>).use = "kantoor";
  check("an unknown use value is rejected", validate(schema, bad).length > 0);
}

// --- roomVentRouted: no vent routes at all -> everything zero ---
{
  const f = rectFloor(8000, 6000, 100);
  nameRoom(f, 4000, 3000, "Kantoor", "verblijf");
  const r = detectRooms(f)[0]!;
  const routed = roomVentRouted(f, r);
  check("no routes -> zero toevoer/afvoer and zero unstated counts",
    routed.toevoer === 0 && routed.afvoer === 0 && routed.toevoerUnstated === 0 && routed.afvoerUnstated === 0,
    JSON.stringify(routed));
}

// --- roomVentRouted: sums stated flow of vent routes ending in the room, per kind ---
{
  const f = rectFloor(8000, 6000, 100);
  nameRoom(f, 4000, 3000, "Kantoor", "verblijf");
  const r = detectRooms(f)[0]!;

  // Ends inside the room, no stated flow -> counted as an unstated toevoer run.
  const toevoerUnstated: Route = {
    id: "toevoer-in", discipline: "vent",
    points: [{ id: "p0", x: -2000, y: 3000 }, { id: "p1", x: 4000, y: 3000 }], segments: [{ id: "s0", a: "p0", b: "p1" }],
  };
  // Ends inside the room, stated flow -> summed.
  const toevoerStated: Route = {
    id: "toevoer-in2", discipline: "vent",
    points: [{ id: "p0", x: -2000, y: 2000 }, { id: "p1", x: 3000, y: 2000 }], segments: [{ id: "s0", a: "p0", b: "p1" }], flow: 40,
  };
  const afvoerStated: Route = {
    id: "afvoer-in", discipline: "vent", vent: "afvoer",
    points: [{ id: "p0", x: -2000, y: 4000 }, { id: "p1", x: 5000, y: 4000 }], segments: [{ id: "s0", a: "p0", b: "p1" }], flow: 60,
  };
  const afvoerUnstated: Route = {
    id: "afvoer-in-unstated", discipline: "vent", vent: "afvoer",
    points: [{ id: "p0", x: -2000, y: 4500 }, { id: "p1", x: 4500, y: 4500 }], segments: [{ id: "s0", a: "p0", b: "p1" }],
  };
  // Ends outside the room entirely -- must not contribute, however much it states.
  const outside: Route = {
    id: "toevoer-out", discipline: "vent",
    points: [{ id: "p0", x: -2000, y: -2000 }, { id: "p1", x: -1000, y: -1000 }], segments: [{ id: "s0", a: "p0", b: "p1" }], flow: 999,
  };
  // Starts inside the room but ENDS outside it -- passing through, not terminating.
  const passingThrough: Route = {
    id: "toevoer-through", discipline: "vent",
    points: [{ id: "p0", x: 4000, y: 3000 }, { id: "p1", x: -3000, y: 3000 }], segments: [{ id: "s0", a: "p0", b: "p1" }], flow: 500,
  };
  // Ends inside the room, but is not a vent route -- must be ignored regardless.
  const otherDiscipline: Route = {
    id: "elec", discipline: "electrical",
    points: [{ id: "p0", x: -2000, y: 3000 }, { id: "p1", x: 4000, y: 3000 }], segments: [{ id: "s0", a: "p0", b: "p1" }],
  };
  f.routes = [toevoerUnstated, toevoerStated, afvoerStated, afvoerUnstated, outside, passingThrough, otherDiscipline];

  const routed = roomVentRouted(f, r);
  check("toevoer sums only the stated-flow run ending in the room",
    routed.toevoer === 40, JSON.stringify(routed));
  check("afvoer sums only the stated-flow run ending in the room",
    routed.afvoer === 60, JSON.stringify(routed));
  check("the unstated toevoer run is counted, not summed as zero",
    routed.toevoerUnstated === 1, JSON.stringify(routed));
  check("the unstated afvoer run is counted, not summed as zero",
    routed.afvoerUnstated === 1, JSON.stringify(routed));
}

// --- i18n: every new string exists in both languages ---
{
  for (const lng of ["nl", "en"] as const) {
    const dict = resources[lng].translation as unknown as Record<string, Record<string, unknown> | undefined>;
    const roomUse = dict.roomUse ?? {};
    const fitout = dict.fitout ?? {};
    const fitoutIssue = dict.fitoutIssue ?? {};
    check(`${lng} has all roomUse keys`,
      ["none", "verblijf", "verkeer", "sanitair", "techniek"].every(k => typeof roomUse[k] === "string"));
    check(`${lng} has all fitout keys`,
      ["workstations", "daylight", "ventilation", "ventRouted", "ventRoutedBelow", "ventRoutedUnstated"]
        .every(k => typeof fitout[k] === "string"));
    check(`${lng} has fitoutIssue.workplaceNone`, typeof fitoutIssue.workplaceNone === "string");
    check(`${lng} has panel.roomUse`, typeof (dict.panel as Record<string, unknown> | undefined)?.roomUse === "string");
  }
  // The parity test in tests/i18n.test.ts checks the full nl/en key sets match;
  // this checks the indicative figures actually say so, not only that they exist.
  check("workstation figure states it is indicative", /indicatief/i.test(t("fitout.workstations", { n: 1 })));
  check("ventilation figure states it is indicative", /indicatief/i.test(t("fitout.ventilation", { m3h: 1 })));
  check("routed vent figure states it is indicative too", /indicatief|indicative/i.test(t("fitout.ventRouted", { toevoer: 1, afvoer: 1 })));
  check("routed-below-demand note carries no compliance claim",
    !/voldoet|compliant|toets(en|ing)?\b/i.test(t("fitout.ventRoutedBelow")));
  check("daylight figure is named a ratio, not a compliance check",
    /verhouding/i.test(t("fitout.daylight", { pct: 1 })) && !/toets(en|ing)?\b.*ok|voldoet/i.test(t("fitout.daylight", { pct: 1 })));
}

console.log(failures === 0 ? "ALL FITOUT TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
