// Cross-floor risers and route continuations (issue #43).
//
// A continuation is the authored fact that two floor-local endpoints are one
// service through the slab. Routes stay per-storey drawing objects; the link
// lives on the document and names its ends by (floorId, routeId, pointId).
// Everything derived from it -- the plan marks, the vertical length, the
// storey schedule -- is recomputed, so what these cover is that the STORED
// link survives the edits a plan gets: moved ports, deleted floors, deleted
// routes, undo and redo.
import {
  emptyDoc, floorElevation, floorHeight, newId, routesOf, type Floor, type PlanDoc,
} from "../src/model/doc";
import {
  continuationsOf, continuationAt, continueRoutePorts, type RouteContinuation,
} from "../src/model/continuation";
import {
  riserMembers, riserMarks, continuationLength, serviceNetworkLength,
  continuationIssues, issuesForRoute, storeyServices, isContinuationPort,
} from "../src/core/continuation";
import { routePlaneHeight } from "../src/core/route";
import { roomVentRouted } from "../src/core/fitout";
import { detectRooms } from "../src/core/rooms";
import { Store } from "../src/model/store";
import { planSchema, validate } from "../scripts/site/schema";
import { toSvg } from "../src/io/svg";
import { toDxf } from "../src/io/dxf";
import { permitSvg } from "../src/io/permit";
import type { Route } from "../src/model/route";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

/** A document with `n` storeys, each empty but for the routes a test adds. */
function storeys(n: number): PlanDoc {
  const doc = emptyDoc();
  doc.floors[0]!.name = "Begane grond";
  for (let i = 1; i < n; i++) {
    doc.floors.push({
      id: `f${i}`, name: `${i}e`,
      nodes: [], walls: [], symbols: [], stairs: [], vides: [], furnishings: [], routes: [], roomNames: [],
    });
  }
  return doc;
}

function run(id: string, over: Partial<Route> = {}): Route {
  return {
    id, discipline: "electrical",
    points: [{ id: `${id}a`, x: 0, y: 0 }, { id: `${id}b`, x: 2000, y: 0 }],
    segments: [{ id: `${id}s`, a: `${id}a`, b: `${id}b` }],
    ...over,
  };
}

/* ── one continuation ── */

{
  const doc = storeys(2);
  doc.floors[0]!.routes = [run("r", { tag: "E-01", group: "1" })];
  const result = continueRoutePorts(doc, 0, 1, [{ routeId: "r", pointId: "rb", x: 2000, y: 0 }]);

  check("continuing an endpoint makes a starter on the target storey",
    result.routeIds.length === 1 && routesOf(doc.floors[1]!).length === 1);
  const starter = routesOf(doc.floors[1]!)[0]!;
  check("the starter is one point awaiting a local run",
    starter.points.length === 1 && starter.segments.length === 0);
  check("it lands at the same plan position",
    starter.points[0]!.x === 2000 && starter.points[0]!.y === 0);
  // Identity carries across the slab: it is the same circuit above and below.
  check("the starter carries the service the run states",
    starter.tag === "E-01" && starter.group === "1" && starter.discipline === "electrical");
  check("but not the points and segments of the run it came from",
    starter.id !== "r");

  check("one link now joins the two ends", continuationsOf(doc).length === 1
    && continuationsOf(doc)[0]!.ports.length === 2);
  check("the link is findable from either end",
    continuationAt(doc, { floorId: doc.floors[0]!.id, routeId: "r", pointId: "rb" }) !== undefined
    && continuationAt(doc, { floorId: "f1", routeId: starter.id, pointId: starter.points[0]!.id }) !== undefined);
  check("and the point knows it is a port",
    isContinuationPort(doc, { floorId: doc.floors[0]!.id, routeId: "r", pointId: "rb" }));

  // A connected riser endpoint is neither a source nor a capped end.
  check("continuing clears any terminal the end was carrying",
    routesOf(doc.floors[0]!)[0]!.points[1]!.terminal === undefined);

  const below = riserMembers(doc, 0);
  const above = riserMembers(doc, 1);
  check("the lower storey shows it going up", below.length === 1 && below[0]!.direction === "up");
  check("the upper storey shows it coming from below",
    above.length === 1 && above[0]!.direction === "down");

  // Vertical length is derived from storey elevations and the plane each run
  // is installed in -- never stored a second time.
  const link = continuationsOf(doc)[0]!;
  const expected = (floorElevation(doc, 1) + routePlaneHeight(doc.floors[1]!, starter))
    - (floorElevation(doc, 0) + routePlaneHeight(doc.floors[0]!, routesOf(doc.floors[0]!)[0]!));
  check("its vertical length follows the storey heights",
    continuationLength(doc, link) === expected, String(continuationLength(doc, link)));
  check("a one-storey building would have no vertical run at all",
    floorHeight(doc.floors[0]!) === expected, String(expected));

  const schema = planSchema("");
  check("the document with a continuation validates",
    validate(schema, doc).length === 0, JSON.stringify(validate(schema, doc)));
}

/* ── an endpoint that cannot be continued ── */

{
  const doc = storeys(2);
  const anchored = run("r");
  anchored.points[1]!.anchor = "some-socket";
  doc.floors[0]!.routes = [anchored, run("mid")];
  // A point in the middle of a run is not an end, and an end already following
  // a device is that device's connection, not a riser.
  const bad = continueRoutePorts(doc, 0, 1, [
    { routeId: "r", pointId: "rb", x: 0, y: 0 },
    { routeId: "mid", pointId: "nope", x: 0, y: 0 },
  ]);
  check("an anchored end and a missing point are both skipped",
    bad.routeIds.length === 0 && continuationsOf(doc).length === 0);
  check("continuing to a storey that is not there does nothing",
    continueRoutePorts(doc, 0, 9, [{ routeId: "mid", pointId: "mida", x: 0, y: 0 }]).routeIds.length === 0);
}

/* ── five coincident electrical continuations ── */

{
  const doc = storeys(2);
  const ids = ["c1", "c2", "c3", "c4", "c5"];
  doc.floors[0]!.routes = ids.map((id, i) => run(id, { group: String(i + 1) }));
  const made = continueRoutePorts(doc, 0, 1,
    ids.map(id => ({ routeId: id, pointId: `${id}b`, x: 2000, y: 0 })));

  check("five endpoints continue in one operation", made.routeIds.length === 5);
  check("five separate links, not one cable with a count",
    continuationsOf(doc).length === 5);
  check("five starters on the storey above", routesOf(doc.floors[1]!).length === 5);
  // Five circuits in one shaft stay five circuits: the identity of each is
  // preserved across the boundary.
  check("each starter keeps its own groep",
    routesOf(doc.floors[1]!).map(r => r.group).sort().join(",") === "1,2,3,4,5");

  const marks = riserMarks(doc, 0);
  check("the coincident marks group into one pickable marker", marks.length === 1);
  check("with a count of five", marks[0]!.members.length === 5);
  check("and every member individually addressable",
    new Set(marks[0]!.members.map(m => m.routeId)).size === 5);
  check("the mark states the direction the group is going", marks[0]!.direction === "up");

  // Vertical length is counted once per link, however many floors see it.
  const perLink = continuationLength(doc, continuationsOf(doc)[0]!);
  const network = serviceNetworkLength(doc, { floorId: doc.floors[0]!.id, routeId: "c1" });
  check("a network's vertical length counts its own link once",
    network.verticalLengthMm === perLink && network.continuations === 1,
    `${network.verticalLengthMm}/${perLink}`);
  check("and its floor length spans both storeys' runs",
    network.routes === 2 && network.floorLengthMm === 2000);
}

/* ── a through-riser with an intermediate branch ── */

{
  const doc = storeys(3);
  // A trunk rising from the ground floor to the second, branching on the first.
  doc.floors[0]!.routes = [run("gf")];
  continueRoutePorts(doc, 0, 1, [{ routeId: "gf", pointId: "gfb", x: 2000, y: 0 }]);
  const middle = routesOf(doc.floors[1]!)[0]!;
  // The first floor grows a local leg off its starter, then carries on up.
  middle.points.push({ id: "m1", x: 2000, y: 1500 });
  middle.segments.push({ id: "ms1", a: middle.points[0]!.id, b: "m1" });
  continueRoutePorts(doc, 1, 2, [{ routeId: middle.id, pointId: "m1", x: 2000, y: 1500 }]);

  const marks = riserMarks(doc, 1);
  check("the intermediate storey shows two marks, not one merged riser",
    marks.length === 2, String(marks.length));
  check("one reaching down and one reaching up",
    marks.map(m => m.direction).sort().join(",") === "down,up");

  const network = serviceNetworkLength(doc, { floorId: doc.floors[0]!.id, routeId: "gf" });
  check("the network reaches all three storeys", network.routes === 3, String(network.routes));
  check("and counts both vertical links once each", network.continuations === 2);
  check("total is floor length plus vertical length",
    network.totalLengthMm === network.floorLengthMm + network.verticalLengthMm);

  // The storey schedule: each link charged to the lowest storey it reaches, so
  // reading every storey in turn counts each shaft exactly once.
  const perStorey = [0, 1, 2].map(i => storeyServices(doc, i));
  const summed = perStorey.flat().reduce((n, row) => n + row.verticalLengthMm, 0);
  check("the storey schedules do not double-count vertical length",
    Math.abs(summed - network.verticalLengthMm) < 1e-6, `${summed}/${network.verticalLengthMm}`);
  check("the ground floor reports one service leaving upward",
    perStorey[0]![0]!.outgoing === 1 && perStorey[0]![0]!.incoming === 0);
  check("the middle storey reports one arriving and one leaving",
    perStorey[1]![0]!.incoming === 1 && perStorey[1]![0]!.outgoing === 1);
  check("the top storey reports one arriving and none leaving",
    perStorey[2]![0]!.incoming === 1 && perStorey[2]![0]!.outgoing === 0);
}

/* ── a moved target port ── */

{
  const doc = storeys(2);
  doc.floors[0]!.routes = [run("r")];
  continueRoutePorts(doc, 0, 1, [{ routeId: "r", pointId: "rb", x: 2000, y: 0 }]);
  const starter = routesOf(doc.floors[1]!)[0]!;
  starter.points[0]!.x = 5000;
  starter.points[0]!.y = 3000;

  check("moving the upper port leaves the lower one where it was",
    routesOf(doc.floors[0]!)[0]!.points[1]!.x === 2000);
  check("the link survives the move", continuationsOf(doc).length === 1);
  check("each storey draws its own mark where its own port stands",
    riserMarks(doc, 0)[0]!.at.x === 2000 && riserMarks(doc, 1)[0]!.at.x === 5000);
}

/* ── deleting a floor, and deleting a route ── */

{
  const store = new Store();
  store.replace(storeys(3), false);
  store.doc.floors[0]!.routes = [run("r")];
  store.mutate(d => { continueRoutePorts(d, 0, 1, [{ routeId: "r", pointId: "rb", x: 0, y: 0 }]); });
  check("the link exists before the storey goes", continuationsOf(store.doc).length === 1);

  store.setActiveFloor(1);
  store.deleteFloor();
  check("deleting a storey removes its ports and the link with them",
    continuationsOf(store.doc).length === 0, JSON.stringify(store.doc.continuations));
  check("but the remaining network is untouched",
    routesOf(store.doc.floors[0]!).length === 1);
  // Non-destructive: the opposite endpoint is an ordinary open end again.
  const end = routesOf(store.doc.floors[0]!)[0]!.points[1]!;
  check("and its endpoint is an ordinary open end again",
    end.terminal === undefined
    && !isContinuationPort(store.doc, { floorId: store.doc.floors[0]!.id, routeId: "r", pointId: end.id }));

  store.undo();
  check("undo brings the storey and its link back",
    store.doc.floors.length === 3 && continuationsOf(store.doc).length === 1);
  store.redo();
  check("redo takes them away again",
    store.doc.floors.length === 2 && continuationsOf(store.doc).length === 0);
}

{
  const doc = storeys(2);
  doc.floors[0]!.routes = [run("r")];
  continueRoutePorts(doc, 0, 1, [{ routeId: "r", pointId: "rb", x: 0, y: 0 }]);
  // Deleting the route on one side is the delete path in Tools.deleteSelected.
  doc.floors[0]!.routes = [];
  for (const link of doc.continuations!) {
    link.ports = link.ports.filter(p => p.floorId !== doc.floors[0]!.id);
  }
  doc.continuations = doc.continuations!.filter(link => link.ports.length >= 2);
  check("a link that loses a side is removed rather than left half-connected",
    continuationsOf(doc).length === 0);
  check("and the far storey keeps its own starter", routesOf(doc.floors[1]!).length === 1);
}

/* ── the topology report ── */

{
  const doc = storeys(2);
  doc.floors[0]!.routes = [run("r")];
  continueRoutePorts(doc, 0, 1, [{ routeId: "r", pointId: "rb", x: 0, y: 0 }]);
  check("a sound network reports nothing", continuationIssues(doc).length === 0,
    JSON.stringify(continuationIssues(doc)));

  // A dangling port is what riserMembers() silently skips: the mark vanishes
  // from both storeys and nothing else would say why.
  const dangling: RouteContinuation = {
    id: newId("rc"),
    ports: [
      { floorId: doc.floors[0]!.id, routeId: "r", pointId: "no-such-point" },
      { floorId: "f1", routeId: routesOf(doc.floors[1]!)[0]!.id, pointId: routesOf(doc.floors[1]!)[0]!.points[0]!.id },
    ],
  };
  doc.continuations!.push(dangling);
  const issues = continuationIssues(doc);
  check("a port naming a point that is not there is reported",
    issues.some(i => i.kind === "dangling"), JSON.stringify(issues));
  check("and the report names the route it belongs to",
    issuesForRoute(doc, doc.floors[0]!.id, "r").some(i => i.kind === "dangling"));
  // Reporting, never enforcing: the document still renders.
  check("a dangling reference does not stop the drawing",
    typeof toSvg(doc, 0) === "string" && typeof toDxf(doc) === "string");
  doc.continuations = doc.continuations!.filter(l => l.id !== dangling.id);
}

{
  const doc = storeys(2);
  doc.floors[0]!.routes = [run("r", { group: "1" })];
  continueRoutePorts(doc, 0, 1, [{ routeId: "r", pointId: "rb", x: 0, y: 0 }]);
  const starter = routesOf(doc.floors[1]!)[0]!;

  starter.discipline = "water";
  check("a riser joining two disciplines is reported",
    continuationIssues(doc).some(i => i.kind === "discipline"));
  starter.discipline = "electrical";

  starter.group = "7";
  check("a circuit whose groep changes across the slab is reported",
    continuationIssues(doc).some(i => i.kind === "metadata"));
  starter.group = "1";
  // Identity a storey may legitimately restate is NOT a conflict: the run
  // above may be tagged and installed differently on its own floor.
  starter.tag = "E-01-boven";
  starter.installation = "ceiling";
  starter.height = 2400;
  check("a different tag, installation or height on the upper leg is fine",
    continuationIssues(doc).length === 0, JSON.stringify(continuationIssues(doc)));
}

{
  const doc = storeys(2);
  doc.floors[0]!.routes = [run("a"), run("b")];
  doc.continuations = [{
    id: "c",
    ports: [
      { floorId: doc.floors[0]!.id, routeId: "a", pointId: "ab" },
      { floorId: doc.floors[0]!.id, routeId: "b", pointId: "bb" },
    ],
  }];
  check("a link that never leaves one storey is reported",
    continuationIssues(doc).some(i => i.kind === "sameFloor"));
  check("and it draws no riser mark", riserMarks(doc, 0).length === 0);
}

/* ── a duct that only passes through a room ── */

{
  const doc = storeys(2);
  const f: Floor = doc.floors[0]!;
  // One closed room, 4 x 4 m.
  const corners = [[0, 0], [4000, 0], [4000, 4000], [0, 4000]];
  corners.forEach(([x, y], i) => f.nodes.push({ id: `n${i}`, x: x!, y: y! }));
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: `w${i}`, a: `n${i}`, b: `n${(i + 1) % 4}`, thickness: 100, bulge: 0, openings: [] });
  }
  const duct: Route = {
    id: "d", discipline: "vent", vent: "afvoer", flow: 75,
    points: [{ id: "da", x: 500, y: 2000 }, { id: "db", x: 2000, y: 2000 }],
    segments: [{ id: "ds", a: "da", b: "db" }],
  };
  f.routes = [duct];
  const room = detectRooms(f)[0]!;
  check("a duct terminating in the room counts toward its extract",
    roomVentRouted(f, room, doc).afvoer === 75);

  continueRoutePorts(doc, 0, 1, [{ routeId: "d", pointId: "db", x: 2000, y: 2000 }]);
  check("once that end becomes a riser it no longer terminates there",
    roomVentRouted(f, room, doc).afvoer === 0, String(roomVentRouted(f, room, doc).afvoer));
  check("and it is not silently counted as unstated either",
    roomVentRouted(f, room, doc).afvoerUnstated === 0);
}

/* ── the marks the exports carry ── */

{
  const doc = storeys(2);
  doc.floors[0]!.routes = [run("r", { tag: "E-01" })];
  continueRoutePorts(doc, 0, 1, [{ routeId: "r", pointId: "rb", x: 2000, y: 0 }]);
  doc.continuations![0]!.tag = "SCH-1";

  const svg = toSvg(doc, 0) ?? "";
  const dxf = toDxf(doc) ?? "";
  check("the SVG carries the riser tag", svg.includes("SCH-1"));
  check("the DXF carries the riser tag", dxf.includes("SCH-1"));
  check("the DXF keeps the riser on its discipline's own layer",
    dxf.includes("ROUTES-ELECTRICAL"));
  // The permit sheet is bouwkundig and carries no services at all -- a
  // deliberate exclusion, so the riser marks must not leak into it either.
  const permit = permitSvg(doc, 0);
  check("the permit sheet carries no riser mark",
    permit === null || !permit.includes("SCH-1"));
}

/* ── both languages name what the panel shows ── */

{
  const keys = ["routeEndpointExternal", "routeIssues", "routeIssueDangling", "routeIssueSameFloor",
    "routeIssueDiscipline", "routeIssueMetadata", "storeyServices", "storeyServicesValue",
    "storeyVerticalLength", "routeContinuationValue", "routeRiserTag", "routeJumpTo"];
  for (const lang of ["nl", "en"] as const) {
    const panel = resources[lang].translation.panel as Record<string, string>;
    check(`${lang} names every cross-floor field`,
      keys.every(k => typeof panel[k] === "string" && panel[k]!.length > 0),
      keys.filter(k => !panel[k]).join(","));
  }
}

console.log(failures === 0 ? "ALL CONTINUATION TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
