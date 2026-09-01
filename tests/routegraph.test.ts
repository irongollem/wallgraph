// Editing a service network after it is drawn: taking a waypoint back out,
// joining separately drawn runs, and connecting a device to a loose end.
//
// The behaviour these cover is the difference between a drawing that LOOKS
// wired and one that is: an endpoint sitting under a socket without an anchor
// does not follow the socket when it moves, and reports itself as loose.
import { emptyDoc, routesOf, type Floor, type SymbolInstance } from "../src/model/doc";
import type { Route } from "../src/model/route";
import type { RouteContinuation } from "../src/model/continuation";
import {
  removeRoutePoint, planRouteMerge, canMergeRoutes, mergeRoutes, routeDegrees, ROUTE_WELD_MM,
  insertRouteTap, disconnectDevice,
} from "../src/core/routegraph";
import {
  routeTakesSymbol, routeTakesFurnishing, routeEndsUnder, linkDeviceToRouteEnds,
  routeLegsUnder, connectDevice, nearestDeviceFor, ROUTE_LINK_MM,
} from "../src/core/attach";
import { resolveRoutePoints, routeLength } from "../src/core/route";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

/** A straight run of `n` points 1000 mm apart along y = `y`. */
function chain(id: string, n: number, y = 0, over: Partial<Route> = {}): Route {
  const points = Array.from({ length: n }, (_, i) => ({ id: `${id}p${i}`, x: i * 1000, y }));
  const segments = Array.from({ length: n - 1 }, (_, i) =>
    ({ id: `${id}s${i}`, a: `${id}p${i}`, b: `${id}p${i + 1}` }));
  return { id, discipline: "electrical", points, segments, ...over };
}

const degreeOf = (route: Route, id: string): number => routeDegrees(route).get(id) ?? 0;

/* ── removeRoutePoint ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 4)];

  check("removing a loose end drops it and the leg that held it",
    removeRoutePoint(doc, 0, "r", "rp0"));
  const r = routesOf(f)[0]!;
  check("the run is one point shorter", r.points.length === 3, String(r.points.length));
  check("no segment still names the removed point",
    !r.segments.some(s => s.a === "rp0" || s.b === "rp0"));
  check("the next point along is now the loose end", degreeOf(r, "rp1") === 1);
}

{
  // A redundant bend in the middle: removing it must shorten the drawing, not
  // cut the run in two.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 3)];
  removeRoutePoint(doc, 0, "r", "rp1");
  const r = routesOf(f)[0]!;
  check("a degree-2 point dissolves rather than splitting the run",
    r.segments.length === 1 && r.points.length === 2);
  check("its neighbours are reconnected to each other",
    r.segments[0]!.a === "rp0" && r.segments[0]!.b === "rp2");
  check("the reconnection is straight, not an invented arc",
    r.segments[0]!.bulge === undefined);
}

{
  // A branch point: three legs, and no pair of them is "the" continuation, so
  // all three go.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const branch = chain("r", 3);
  branch.points.push({ id: "rp3", x: 1000, y: 1000 });
  branch.segments.push({ id: "rs2", a: "rp1", b: "rp3" });
  f.routes = [branch];
  removeRoutePoint(doc, 0, "r", "rp1");
  const r = routesOf(f)[0]!;
  check("removing a branch point takes every leg that met there",
    r.segments.length === 0 && r.points.length === 3, JSON.stringify(r.segments));
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 2)];
  removeRoutePoint(doc, 0, "r", "rp0");
  check("a run reduced to one point is kept -- that is a cross-floor starter",
    routesOf(f).length === 1 && routesOf(f)[0]!.points.length === 1);
  removeRoutePoint(doc, 0, "r", "rp1");
  check("a run with no points left is removed", routesOf(f).length === 0);
}

{
  // A stated terminal describes a free end and nothing else.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const r = chain("r", 3);
  r.points[2]!.terminal = "capped";
  r.points[0]!.terminal = "source";
  f.routes = [r];
  removeRoutePoint(doc, 0, "r", "rp2");
  const after = routesOf(f)[0]!;
  check("a capped end that is gone takes its terminal with it",
    !after.points.some(p => p.terminal === "capped"));
  check("an end that is still free keeps its terminal",
    after.points.find(p => p.id === "rp0")?.terminal === "source");
}

{
  // The document-level fact: a continuation names a point, and a point that no
  // longer exists must not be left named.
  const doc = emptyDoc();
  doc.floors.push({ ...emptyDoc().floors[0]!, id: "f2", name: "1e" });
  const f = doc.floors[0]!;
  f.routes = [chain("r", 2)];
  doc.floors[1]!.routes = [{ id: "up", discipline: "electrical", points: [{ id: "upp", x: 0, y: 0 }], segments: [] }];
  const link: RouteContinuation = {
    id: "c1",
    ports: [
      { floorId: f.id, routeId: "r", pointId: "rp0" },
      { floorId: "f2", routeId: "up", pointId: "upp" },
    ],
  };
  doc.continuations = [link];
  removeRoutePoint(doc, 0, "r", "rp0");
  check("a continuation naming the removed point is dropped, not left dangling",
    (doc.continuations ?? []).length === 0, JSON.stringify(doc.continuations));
}

/* ── merging two runs into one network ── */

function twoRuns(gap: number): { doc: ReturnType<typeof emptyDoc>; f: Floor } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const a = chain("a", 3, 0, { tag: "E-01", group: "1" });
  // Starts where `a` ends (or `gap` mm away from it) and runs down.
  const b: Route = {
    id: "b", discipline: "electrical", tag: "E-02",
    points: [{ id: "bp0", x: 2000 + gap, y: 0 }, { id: "bp1", x: 2000 + gap, y: 2000 }],
    segments: [{ id: "bs0", a: "bp0", b: "bp1" }],
  };
  f.routes = [a, b];
  return { doc, f };
}

{
  const { doc, f } = twoRuns(0);
  check("two runs meeting end to end can be merged", canMergeRoutes(f, ["a", "b"]));
  const id = mergeRoutes(doc, 0, ["a", "b"]);
  check("the run the pane was editing survives", id === "a" && routesOf(f).length === 1);
  const merged = routesOf(f)[0]!;
  check("the survivor keeps its own identity", merged.tag === "E-01" && merged.group === "1");
  check("the coincident ends welded into one point",
    merged.points.length === 4, String(merged.points.length));
  check("every leg of both runs is still there",
    merged.segments.length === 3, String(merged.segments.length));
  // The point of merging: the join is now a real graph vertex, so the network
  // is one connected thing rather than two runs that happen to touch.
  const join = merged.points.find(p => p.x === 2000 && p.y === 0)!;
  check("the join is a vertex of degree 2, not two loose ends",
    degreeOf(merged, join.id) === 2, String(degreeOf(merged, join.id)));
}

{
  const { f } = twoRuns(ROUTE_WELD_MM * 3);
  check("runs that do not touch are not offered a merge", !canMergeRoutes(f, ["a", "b"]));
  const plan = planRouteMerge(f, ["a", "b"])!;
  check("and the pane can say which of the two conditions failed",
    plan.sameDiscipline && !plan.connected);
}

{
  const { doc, f } = twoRuns(0);
  routesOf(f)[1]!.discipline = "water";
  check("runs of different disciplines are not merged", !canMergeRoutes(f, ["a", "b"]));
  check("and the attempt changes nothing", mergeRoutes(doc, 0, ["a", "b"]) === null
    && routesOf(f).length === 2);
}

{
  // The T a branch drawn onto an existing trunk actually is: the spur's end
  // lands in the MIDDLE of a leg, where the trunk has no point at all.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [
    chain("trunk", 3),
    { id: "spur", discipline: "electrical",
      points: [{ id: "sp0", x: 500, y: 0 }, { id: "sp1", x: 500, y: 1500 }],
      segments: [{ id: "ss0", a: "sp0", b: "sp1" }] },
  ];
  check("a spur landing on a trunk's leg can be merged", canMergeRoutes(f, ["trunk", "spur"]));
  mergeRoutes(doc, 0, ["trunk", "spur"]);
  const merged = routesOf(f)[0]!;
  check("the leg it landed on was split at the junction",
    merged.segments.length === 4, String(merged.segments.length));
  check("the junction carries three legs", degreeOf(merged, "sp0") === 3,
    String(degreeOf(merged, "sp0")));
}

{
  // Two runs that merely cross are not a connection: a circuit passing over
  // another circuit is not wired to it.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [
    chain("a", 3),
    { id: "b", discipline: "electrical",
      points: [{ id: "bp0", x: 1000, y: -2000 }, { id: "bp1", x: 1000, y: 2000 }],
      segments: [{ id: "bs0", a: "bp0", b: "bp1" }] },
  ];
  // Neither run's ENDS come near the other, so nothing welds and the merge is
  // not offered even though the two lines cross on the plan.
  check("two runs that only cross are not merged", !canMergeRoutes(f, ["a", "b"]));
}

{
  // An anchored point wins the weld: it is the one carrying the device.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push({ id: "sock", type: "socket-single", x: 2000, y: 0, rotation: 0 });
  const a = chain("a", 3);
  const b: Route = {
    id: "b", discipline: "electrical",
    points: [{ id: "bp0", x: 2000, y: 0, anchor: "sock" }, { id: "bp1", x: 2000, y: 2000 }],
    segments: [{ id: "bs0", a: "bp0", b: "bp1" }],
  };
  f.routes = [a, b];
  mergeRoutes(doc, 0, ["a", "b"]);
  const merged = routesOf(f)[0]!;
  const join = merged.points.find(p => p.anchor === "sock");
  check("the welded point keeps the device it reaches", join !== undefined);
  check("and it is the junction, carrying both runs' legs",
    join !== undefined && degreeOf(merged, join.id) === 2);
}

{
  // Continuations follow the merge: a riser that reached the absorbed run
  // still reaches the network it is now part of.
  const doc = emptyDoc();
  doc.floors.push({ ...emptyDoc().floors[0]!, id: "f2", name: "1e" });
  const f = doc.floors[0]!;
  const a = chain("a", 3);
  const b: Route = {
    id: "b", discipline: "electrical",
    points: [{ id: "bp0", x: 2000, y: 0 }, { id: "bp1", x: 2000, y: 2000 }],
    segments: [{ id: "bs0", a: "bp0", b: "bp1" }],
  };
  f.routes = [a, b];
  doc.floors[1]!.routes = [{ id: "up", discipline: "electrical", points: [{ id: "upp", x: 2000, y: 2000 }], segments: [] }];
  doc.continuations = [{
    id: "c1",
    ports: [
      { floorId: f.id, routeId: "b", pointId: "bp1" },
      { floorId: "f2", routeId: "up", pointId: "upp" },
    ],
  }];
  mergeRoutes(doc, 0, ["a", "b"]);
  const port = doc.continuations![0]!.ports.find(p => p.floorId === f.id)!;
  check("the port now names the surviving route", port.routeId === "a", port.routeId);
  check("and still names a point that exists",
    routesOf(f)[0]!.points.some(p => p.id === port.pointId), port.pointId);
}

/* ── connecting a device to a loose end ── */

const socket = (over: Partial<SymbolInstance> = {}): SymbolInstance =>
  ({ id: "sock", type: "socket-single", x: 0, y: 0, rotation: 0, ...over });

{
  check("an electrical run ends at an electrical symbol",
    routeTakesSymbol("electrical", "socket-single"));
  check("but not at a tap", !routeTakesSymbol("electrical", "water-point"));
  check("a water run ends at a tap", routeTakesSymbol("water", "water-point"));
  check("a gas run ends at the heating symbols", routeTakesSymbol("gas", "cv-boiler"));
  check("an unknown type is nobody's terminal", !routeTakesSymbol("electrical", "nope"));
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 3)];
  const device = socket({ x: 2000, y: 0 });
  f.symbols.push(device);

  const ends = routeEndsUnder(f, device, d => routeTakesSymbol(d, device.type));
  check("a device on a run's loose end finds it", ends.length === 1 && ends[0]!.id === "rp2");
  check("linking writes the anchor",
    linkDeviceToRouteEnds(f, device, d => routeTakesSymbol(d, device.type)) === 1
    && routesOf(f)[0]!.points[2]!.anchor === "sock");
  // The user-visible consequence: the run now follows the device.
  device.x = 5000;
  check("the run follows the device once it is linked",
    resolveRoutePoints(f, routesOf(f)[0]!)[2]!.x === 5000);
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 3)];
  // A point in the MIDDLE of a run is not something a device placed nearby
  // silently captures; that would reroute a trunk by accident.
  const mid = socket({ x: 1000, y: 0 });
  check("a device over a mid-run point captures nothing",
    routeEndsUnder(f, mid, d => routeTakesSymbol(d, mid.type)).length === 0);

  // An end already following another device keeps it.
  routesOf(f)[0]!.points[2]!.anchor = "other";
  const late = socket({ id: "late", x: 2000, y: 0 });
  check("an end already connected is not taken over",
    routeEndsUnder(f, late, d => routeTakesSymbol(d, late.type)).length === 0);
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 3, 0, { discipline: "water" })];
  const device = socket({ x: 2000, y: 0 });
  check("a socket does not connect itself to a water run",
    routeEndsUnder(f, device, d => routeTakesSymbol(d, device.type)).length === 0);
}

{
  // Half a wall apart, which is where a wall-mounted socket and a concealed
  // run's centerline endpoint actually sit. The shared wall admits that
  // perpendicular gap, but must not match an endpoint far along the wall.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 5000, y: 0 });
  f.walls.push({
    id: "w1", a: "n1", b: "n2", thickness: 600, bulge: 0, openings: [],
  });
  const r = chain("r", 2);
  r.points[1]!.wallId = "w1";
  r.points[1]!.wallT = 2000;
  f.routes = [r];
  const far = socket({ x: 2000, y: 300, wallId: "w1" });
  check("a device on the same wall reaches across the masonry",
    routeEndsUnder(f, far, d => routeTakesSymbol(d, far.type)).length === 1);
  const distant = socket({ id: "d", x: 1000, y: 300, wallId: "w1" });
  check("a device does not capture a distant endpoint on the same wall",
    routeEndsUnder(f, distant, d => routeTakesSymbol(d, distant.type)).length === 0);
  const elsewhere = socket({ id: "e", x: 2000, y: 300, wallId: "w2" });
  check("a device on a different wall does not",
    routeEndsUnder(f, elsewhere, d => routeTakesSymbol(d, elsewhere.type)).length === 0);
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push(socket({ x: 400, y: 0 }));
  const near = nearestDeviceFor(f, { discipline: "electrical" }, { x: 0, y: 0 });
  check("the pane can name the device a loose end belongs to",
    near?.id === "sock" && near.kind === "symbol" && near.name === "socket-single");
  check("and offers nothing when the trade does not match",
    nearestDeviceFor(f, { discipline: "vent" }, { x: 0, y: 0 }) === null);
  check("nor anything a long way off",
    nearestDeviceFor(f, { discipline: "electrical" }, { x: 90000, y: 0 }) === null);
}

{
  // The fit-out side of the same rule.
  const hood = { id: "h", form: "appliance", mark: "hood", x: 0, y: 0, rotation: 0, width: 600, depth: 500 } as never;
  check("a vent run ends at an afzuigkap", routeTakesFurnishing("vent", "koud", hood));
  check("but a water run does not", !routeTakesFurnishing("vent", "koud",
    { ...(hood as object), mark: "fridge" } as never));
}

/* ── a device standing ON a run's line ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 3)];
  // Part-way along the first leg, not at either end.
  const device = socket({ x: 500, y: 0 });
  f.symbols.push(device);

  const legs = routeLegsUnder(f, device, d => routeTakesSymbol(d, device.type));
  check("a device on a run's line finds the leg it stands on",
    legs.length === 1 && legs[0]!.segmentId === "rs0", JSON.stringify(legs));
  check("and where along it", Math.abs(legs[0]!.t - 0.5) < 1e-6, String(legs[0]!.t));

  check("connecting splices a junction into that leg",
    connectDevice(f, device, d => routeTakesSymbol(d, device.type)) === 1);
  const r = routesOf(f)[0]!;
  check("the leg became two", r.segments.length === 3, String(r.segments.length));
  const tap = r.points.find(p => p.anchor === "sock")!;
  check("the new point follows the device", tap !== undefined);
  check("and is a junction the run passes through, not a loose end",
    degreeOf(r, tap.id) === 2, String(degreeOf(r, tap.id)));
  // The user-visible consequence, same as for an endpoint: the run follows.
  device.x = 500; device.y = 400;
  const at = resolveRoutePoints(f, r)[r.points.indexOf(tap)]!;
  check("the run bends to reach the device once tapped", at.y === 400, JSON.stringify(at));
}

{
  // The ambiguous case: two circuits stored along the same line. Which one a
  // socket belongs to is not something the drawing knows.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("a", 3, 0, { tag: "E-01" }), chain("b", 3, 0, { tag: "E-02" })];
  const device = socket({ x: 500, y: 0 });
  f.symbols.push(device);

  const legs = routeLegsUnder(f, device, d => routeTakesSymbol(d, device.type));
  check("both runs under the device are offered", legs.length === 2, String(legs.length));
  check("placing it joins neither of them",
    connectDevice(f, device, d => routeTakesSymbol(d, device.type)) === 0);
  check("and neither run was touched",
    routesOf(f).every(r => r.segments.length === 2 && r.points.every(p => !p.anchor)));

  // Picking one is the panel's job; the op itself is unambiguous.
  insertRouteTap(f, "b", "bs0", device.id, legs[0]!.t);
  check("picking one splices only that run",
    routesOf(f)[1]!.segments.length === 3 && routesOf(f)[0]!.segments.length === 2);
  check("and the other is not offered again",
    routeLegsUnder(f, device, d => routeTakesSymbol(d, device.type))
      .map(l => l.routeId).join() === "a");
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 3)];
  // Standing on a CORNER of the run is the endpoint's business: taking the
  // corner over is what routeEndsUnder does, and splicing a second point a
  // millimetre from it would leave a zero-length leg.
  const onCorner = socket({ x: 1000, y: 0 });
  check("a device on a vertex splits nothing",
    routeLegsUnder(f, onCorner, d => routeTakesSymbol(d, onCorner.type)).length === 0);
  // The far end is a loose end, so that is a takeover rather than a split.
  const onEnd = socket({ id: "e", x: 2000, y: 0 });
  f.symbols.push(onEnd);
  check("a device on a loose end takes the end over rather than splitting",
    connectDevice(f, onEnd, d => routeTakesSymbol(d, onEnd.type)) === 1
    && routesOf(f)[0]!.segments.length === 2
    && routesOf(f)[0]!.points[2]!.anchor === "e");
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("w", 3, 0, { discipline: "water" })];
  const device = socket({ x: 500, y: 0 });
  check("a socket does not splice itself into a water run",
    routeLegsUnder(f, device, d => routeTakesSymbol(d, device.type)).length === 0);
  const tap = { id: "tap", type: "water-point", x: 500, y: 0, rotation: 0 };
  check("but a tappunt does",
    routeLegsUnder(f, tap, d => routeTakesSymbol(d, tap.type)).length === 1);
}

{
  // A bowed leg keeps its shape: splitting gives two arcs, not two chords.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const bowed: Route = {
    id: "r", discipline: "electrical",
    points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 2000, y: 0 }],
    segments: [{ id: "s", a: "a", b: "b", bulge: 0.5 }],
  };
  f.routes = [bowed];
  const before = routeLength(f, bowed);
  const id = insertRouteTap(f, "r", "s", "dev", 0.5);
  check("a bowed leg splices", id !== null);
  const after = routesOf(f)[0]!;
  check("into two bowed halves",
    after.segments.length === 2 && after.segments.every(s => (s.bulge ?? 0) !== 0),
    JSON.stringify(after.segments.map(s => s.bulge)));
  // Same arc, split -- so the run is the length it was, not the chord.
  check("and the run keeps the length it was drawn with",
    Math.abs(routeLength(f, after) - before) < 1, `${routeLength(f, after)}/${before}`);
}

{
  // Disconnecting leaves the waypoint where it stands rather than springing
  // the run back to wherever the point was first drawn.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [chain("r", 3)];
  const device = socket({ x: 500, y: 0 });
  f.symbols.push(device);
  connectDevice(f, device, d => routeTakesSymbol(d, device.type));
  device.x = 500; device.y = 900;
  check("disconnecting clears one anchor", disconnectDevice(f, "sock") === 1);
  const r = routesOf(f)[0]!;
  const moved = r.points.find(p => p.y === 900);
  check("and leaves the waypoint where the device had taken it",
    moved !== undefined && moved.anchor === undefined, JSON.stringify(r.points));
  check("the run keeps its shape", r.segments.length === 3);
}

/* ── both languages name what the panel shows ── */

{
  const keys = ["deviceConnected", "deviceDisconnect", "deviceConnectTo", "deviceConnectPick"];
  for (const lang of ["nl", "en"] as const) {
    const panel = resources[lang].translation.panel as Record<string, string>;
    check(`${lang} names every connection field`,
      keys.every(k => typeof panel[k] === "string" && panel[k]!.length > 0),
      keys.filter(k => !panel[k]).join(","));
  }
}

console.log(failures === 0 ? "ALL ROUTEGRAPH TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
