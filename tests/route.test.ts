// Route tests: manual service routing (issue #25). Anchored points follow
// their symbol at derive time only, corridor fanning keeps bundled runs
// legible without touching the stored document, and the permit sheet must
// never carry services.
import { emptyDoc, routesOf } from "../src/model/doc";
import {
  Route, DISCIPLINES, ROUTE_KINDS, routeKind, routeVeins,
  ROUTE_WATERS, routeWater, routeDiameter, WATER_SUPPLY_DIAMETERS, WATER_DRAIN_DIAMETERS,
  ROUTE_VENTS, routeVent, routeDuctDiameter, routeFlow, VENT_DIAMETERS,
} from "../src/model/route";
import {
  resolveRoutePoints, routeLength, resolveRoutes, routeDistance, routeGroupSummaries, routeKindSummaries,
  routeWaterSummaries,
} from "../src/core/route";
import { arcLength } from "../src/geometry/arc";
import { unanchorRoutePoints } from "../src/model/ops";
import { toDxf } from "../src/io/dxf";
import { toSvg, routeSvgParts } from "../src/io/svg";
import { permitSvg } from "../src/io/permit";
import { planSchema, validate } from "../scripts/site/schema";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const route = (over: Partial<Route> = {}): Route =>
  ({ id: "rt1", discipline: "electrical", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }], segments: [{ id: "s0", a: "p0", b: "p1" }], ...over });

/* ── resolveRoutePoints: anchors ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push({ id: "s1", type: "socket-single", x: 500, y: 500, rotation: 0 });
  const rt: Route = { id: "rt1", discipline: "water", points: [{ id: "p0", x: 0, y: 0, anchor: "s1" }, { id: "p1", x: 1000, y: 1000 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]};
  f.routes = [rt];

  let pts = resolveRoutePoints(f, rt);
  check("an anchored point reads the symbol's position", pts[0]!.x === 500 && pts[0]!.y === 500, JSON.stringify(pts[0]));

  const sym = f.symbols[0]!;
  sym.x = 900; sym.y = 700;
  pts = resolveRoutePoints(f, rt);
  check("moving the symbol moves the resolved point without touching the route",
    pts[0]!.x === 900 && pts[0]!.y === 700 && rt.points[0]!.x === 0 && rt.points[0]!.y === 0,
    JSON.stringify({ resolved: pts[0], stored: rt.points[0] }));

  f.symbols = [];
  pts = resolveRoutePoints(f, rt);
  check("a dangling anchor falls back to the point's own stored x/y",
    pts[0]!.x === 0 && pts[0]!.y === 0, JSON.stringify(pts[0]));
}

/* ── unanchorRoutePoints: symbol deletion ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const sym = { id: "s1", type: "socket-single", x: 500, y: 500, rotation: 0 };
  f.symbols.push(sym);
  const rt: Route = { id: "rt1", discipline: "vent", points: [{ id: "p0", x: 0, y: 0, anchor: "s1" }, { id: "p1", x: 1000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]};
  f.routes = [rt];

  sym.x = 777; sym.y = 333; // moved before the symbol is deleted
  unanchorRoutePoints(f, sym);
  check("un-anchoring clears the anchor", rt.points[0]!.anchor === undefined);
  check("un-anchoring captures the symbol's LAST position, not the original stored one",
    rt.points[0]!.x === 777 && rt.points[0]!.y === 333, JSON.stringify(rt.points[0]));
  check("un-anchoring a different symbol's id is a no-op",
    rt.points[1]!.x === 1000 && rt.points[1]!.y === 0);
}

/* ── routeLength ── */

{
  const f = emptyDoc().floors[0]!;
  const straight = route({ points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 3000, y: 0 }, { id: "p2", x: 3000, y: 4000 }] , segments: [{ id: "s0", a: "p0", b: "p1" }, { id: "s1", a: "p1", b: "p2" }]});
  check("straight length sums the segments", routeLength(f, straight) === 7000, String(routeLength(f, straight)));

  // A bulged segment's contribution has to be the true arc length, not the
  // chord -- checked against geometry/arc.ts's own arcLength() rather than a
  // hand-derived figure, since that is the formula routeLength must delegate to.
  const bulge = 0.3;
  const p0 = { x: 0, y: 0 }, p1 = { x: 1000, y: 0 };
  const bulged = route({
    points: [{ id: "p0", ...p0 }, { id: "p1", ...p1 }],
    segments: [{ id: "s0", a: "p0", b: "p1", bulge }],
  });
  const len = routeLength(f, bulged);
  const expectedArc = arcLength(p0, p1, bulge);
  check("a bulged segment is longer than its chord",
    len > 1000 && expectedArc > 1000, String(len));
  check("routeLength matches the arc-aware formula, not the straight chord",
    Math.abs(len - expectedArc) < 1e-6, `${len} vs ${expectedArc}`);
}

/* ── integer rounding ── */

{
  check("route points are the document's own integer-mm type",
    Number.isInteger(route().points[0]!.x) && Number.isInteger(route().points[0]!.y));
}

/* ── graph branches and wall attachment ── */

{
  const f = emptyDoc().floors[0]!;
  const branched: Route = {
    id: "tree", discipline: "water", water: "afvoer",
    points: [
      { id: "source", x: 0, y: 0, terminal: "source" },
      { id: "tee", x: 1000, y: 0 },
      { id: "left", x: 2000, y: -1000, terminal: "capped" },
      { id: "right", x: 2000, y: 1000, terminal: "capped" },
    ],
    segments: [
      { id: "trunk", a: "source", b: "tee" },
      { id: "branch-a", a: "tee", b: "left" },
      { id: "branch-b", a: "tee", b: "right" },
    ],
  };
  f.routes = [branched];
  check("a branched network resolves every stored edge once", resolveRoutes(f)[0]!.segments.length === 3);
  check("a shared trunk contributes once to network length",
    Math.abs(routeLength(f, branched) - (1000 + 2 * Math.sqrt(2_000_000))) < 1e-6,
    String(routeLength(f, branched)));

  f.nodes.push({ id: "na", x: 0, y: 0 }, { id: "nb", x: 2000, y: 0 });
  f.walls.push({ id: "wall", a: "na", b: "nb", thickness: 100, bulge: 0, openings: [] });
  const surface: Route = {
    id: "surface", discipline: "gas", installation: "surface",
    points: [
      { id: "wa", x: 500, y: 0, wallId: "wall", wallT: 500, wallSide: 1 },
      { id: "wb", x: 1500, y: 0, wallId: "wall", wallT: 1500, wallSide: 1 },
    ],
    segments: [{ id: "ws", a: "wa", b: "wb" }],
  };
  check("surface mounting resolves to the wall face, not a fixed centerline offset",
    resolveRoutePoints(f, surface)[0]!.y === 50, JSON.stringify(resolveRoutePoints(f, surface)[0]));
  f.nodes[0]!.y = 100; f.nodes[1]!.y = 100;
  check("a wall-attached surface route follows a moved wall",
    resolveRoutePoints(f, surface)[0]!.y === 150, JSON.stringify(resolveRoutePoints(f, surface)[0]));
}

/* ── resolveRoutes: corridor fanning ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  // Two routes over the exact same straight span.
  const a: Route = { id: "aaa", discipline: "electrical", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 2000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]};
  const b: Route = { id: "bbb", discipline: "water", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 2000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]};
  f.routes = [a, b];

  const resolved1 = resolveRoutes(f);
  const resolved2 = resolveRoutes(f);
  const segOf = (id: string, r: typeof resolved1) => r.find(x => x.route.id === id)!.segments[0]!;
  const a1 = segOf("aaa", resolved1), b1 = segOf("bbb", resolved1);
  const a2 = segOf("aaa", resolved2), b2 = segOf("bbb", resolved2);

  check("two routes sharing a corridor resolve to DISTINCT offset lines",
    a1.a.y !== b1.a.y, JSON.stringify({ a: a1.a, b: b1.a }));
  check("the fan is symmetric about the shared line",
    Math.abs(a1.a.y - (-b1.a.y)) < 1e-9 && a1.a.x === 0 && b1.a.x === 0,
    JSON.stringify({ a: a1.a, b: b1.a }));
  check("the offset segments keep the route's own length (a pure translation)",
    Math.abs(a1.b.x - a1.a.x - 2000) < 1e-9);
  check("two calls against the same floor fan the same routes into the same lanes",
    a1.a.y === a2.a.y && b1.a.y === b2.a.y && a1.a.x === a2.a.x,
    JSON.stringify({ first: a1.a, second: a2.a }));
  check("distance picking can distinguish the visually nearest fanned lane",
    routeDistance(resolved1.find(r => r.route.id === "aaa")!, a1.a)
      < routeDistance(resolved1.find(r => r.route.id === "bbb")!, a1.a));

  // A lone route with nothing to bundle with stays exactly on its own points.
  const solo: Route = { id: "ccc", discipline: "vent", points: [{ id: "p0", x: 5000, y: 5000 }, { id: "p1", x: 6000, y: 5000 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]};
  const withSolo = resolveRoutes({ ...f, routes: [solo] });
  const seg = withSolo[0]!.segments[0]!;
  check("a lone route is not nudged off its stored points",
    seg.a.x === 5000 && seg.a.y === 5000 && seg.b.x === 6000 && seg.b.y === 5000,
    JSON.stringify(seg));
}

/* ── the document and its exports ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [
    { id: "e1", discipline: "electrical", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 2000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    { id: "w1", discipline: "water", points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 2000, y: 500 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];
  check("a floor's routes read back", routesOf(f).length === 2);
  check("an absent list is not an error", routesOf({ ...f, routes: undefined }).length === 0);

  const svg = toSvg(doc) ?? "";
  check("routes get a per-discipline SVG group", svg.includes('id="routes-electrical"') && svg.includes('id="routes-water"'));
  check("an absent discipline gets no group", !svg.includes('id="routes-vent"'));

  const permit = permitSvg(doc) ?? "";
  check("the permit sheet does not carry services", !permit.includes("routes-electrical") && !permit.includes("routes-water"));

  // The three layer names are declared together once the floor has any
  // routes at all -- not one at a time per discipline actually drawn, the
  // way every other DXF layer in this file is always declared regardless of
  // whether that kind of object is on the floor.
  const dxf = toDxf(doc) ?? "";
  check("routes get all four DXF layer names once the floor has routes",
    dxf.includes("ROUTES-ELECTRICAL") && dxf.includes("ROUTES-WATER")
      && dxf.includes("ROUTES-VENT") && dxf.includes("ROUTES-GAS"));

  const noRoutes = emptyDoc();
  const dxfNoRoutes = toDxf(noRoutes) ?? "";
  check("a plan with no routes carries none of the three DXF layer names",
    !dxfNoRoutes.includes("ROUTES-ELECTRICAL") && !dxfNoRoutes.includes("ROUTES-WATER")
      && !dxfNoRoutes.includes("ROUTES-VENT") && !dxfNoRoutes.includes("ROUTES-GAS"));
}

/* ── the published format ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.routes = [
    { id: "r1", discipline: "electrical",
      points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }, { id: "p2", x: 2000, y: 500 }],
      segments: [{ id: "s0", a: "p0", b: "p1", bulge: 0.2 }, { id: "s1", a: "p1", b: "p2" }] },
  ];
  check("a document with a route validates", validate(schema, doc).length === 0, validate(schema, doc).join(" | "));

  // JSON round-trip.
  const again = JSON.parse(JSON.stringify(doc));
  check("a route round-trips through JSON",
    JSON.stringify(again.floors[0].routes) === JSON.stringify(doc.floors[0]!.routes));
  check("the round-tripped document still validates", validate(schema, again).length === 0);

  const badDiscipline = JSON.parse(JSON.stringify(doc));
  badDiscipline.floors[0].routes[0].discipline = "steam";
  check("an unknown discipline is rejected", validate(schema, badDiscipline).length > 0);

  const missingPoints = JSON.parse(JSON.stringify(doc));
  delete missingPoints.floors[0].routes[0].points;
  check("a route without points is rejected", validate(schema, missingPoints).length > 0);

  const extraProp = JSON.parse(JSON.stringify(doc));
  extraProp.floors[0].routes[0].color = "#ff0000";
  check("an unknown route property is rejected (a route carries no colour of its own)",
    validate(schema, extraProp).length > 0);

  const badPoint = JSON.parse(JSON.stringify(doc));
  badPoint.floors[0].routes[0].points[0].z = 5;
  check("an unknown routePoint property is rejected", validate(schema, badPoint).length > 0);
}

/* ── electrical vocabulary: accessors ── */

{
  check("routeKind defaults to power when absent", routeKind(route()) === "power");
  check("routeKind reads an explicit kind", routeKind(route({ kind: "utp" })) === "utp");
  check("routeVeins defaults to 3 when absent", routeVeins(route()) === 3);
  check("routeVeins reads an explicit count", routeVeins(route({ veins: 5 })) === 5);
  check("every route kind is offered", ROUTE_KINDS.length === 3
    && ROUTE_KINDS.includes("power") && ROUTE_KINDS.includes("utp") && ROUTE_KINDS.includes("coax"));
}

/* ── electrical vocabulary: the schema ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.routes = [
    { id: "r2", discipline: "electrical", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }], segments: [{ id: "s0", a: "p0", b: "p1" }],
      kind: "power", veins: 4, group: "K1" },
    { id: "r3", discipline: "electrical", points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 1000, y: 500 }], segments: [{ id: "s0", a: "p0", b: "p1" }],
      kind: "utp", spec: "Cat6" },
  ];
  check("a document with the electrical fields validates", validate(schema, doc).length === 0,
    validate(schema, doc).join(" | "));

  const lowVeins = JSON.parse(JSON.stringify(doc));
  lowVeins.floors[0].routes[0].veins = 1;
  check("veins below the schema minimum is rejected", validate(schema, lowVeins).length > 0);

  const highVeins = JSON.parse(JSON.stringify(doc));
  highVeins.floors[0].routes[0].veins = 9;
  check("veins above the schema maximum is rejected", validate(schema, highVeins).length > 0);

  const badKind = JSON.parse(JSON.stringify(doc));
  badKind.floors[0].routes[0].kind = "gas";
  check("an unknown route kind is rejected", validate(schema, badKind).length > 0);

  // JSON round-trip.
  const again = JSON.parse(JSON.stringify(doc));
  check("electrical fields round-trip through JSON",
    JSON.stringify(again.floors[0].routes) === JSON.stringify(doc.floors[0]!.routes));
  check("the round-tripped document still validates", validate(schema, again).length === 0);
}

/* ── electrical vocabulary: reported figures ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push({ id: "s1", type: "socket-single", x: 1000, y: 0, rotation: 0 });
  f.symbols.push({ id: "s2", type: "socket-single", x: 1000, y: 1000, rotation: 0 });
  f.routes = [
    // Two power runs sharing groep "1", one of them anchoring two devices.
    { id: "p1", discipline: "electrical", group: "1",
      points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0, anchor: "s1" }, { id: "p2", x: 1000, y: 1000, anchor: "s2" }] , segments: [{ id: "s0", a: "p0", b: "p1" }, { id: "s1", a: "p1", b: "p2" }]},
    { id: "p2", discipline: "electrical", group: "1", veins: 4,
      points: [{ id: "p0", x: 0, y: 2000 }, { id: "p1", x: 1000, y: 2000 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    // A data run, no groep.
    { id: "d1", discipline: "electrical", kind: "utp", spec: "Cat6",
      points: [{ id: "p0", x: 0, y: 3000 }, { id: "p1", x: 500, y: 3000 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];

  const groups = routeGroupSummaries(f);
  check("one summary per groep", groups.length === 1, JSON.stringify(groups));
  const g1 = groups[0]!;
  check("groep length sums both runs sharing it",
    Math.abs(g1.lengthMm - (2000 + 1000)) < 1e-6, String(g1.lengthMm));
  check("groep device count is the distinct anchored symbols on it", g1.devices === 2, String(g1.devices));

  const kinds = routeKindSummaries(f);
  const power3 = kinds.find(k => k.kind === "power" && k.veins === 3);
  const power4 = kinds.find(k => k.kind === "power" && k.veins === 4);
  const utp = kinds.find(k => k.kind === "utp");
  check("power runs are split by veins count", power3 !== undefined && power4 !== undefined,
    JSON.stringify(kinds));
  check("the 3-aders power total is that one run's length",
    power3 !== undefined && Math.abs(power3.lengthMm - 2000) < 1e-6);
  check("a data run's summary carries no veins count",
    utp !== undefined && utp.veins === undefined, JSON.stringify(utp));
}

/* ── electrical vocabulary: SVG dash and DXF layer ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [
    { id: "power", discipline: "electrical", tag: "E-01", group: "K1",
      points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }],
      segments: [{ id: "s0", a: "p0", b: "p1" }] },
    { id: "data", discipline: "electrical", kind: "utp",
      points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 1000, y: 500 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];

  const svg = toSvg(doc) ?? "";
  check("the electrical group still carries one id", svg.includes('id="routes-electrical"'));
  check("the SVG carries a dash pattern for the data sub-group", svg.includes("stroke-dasharray"));
  check("the SVG prints route tags and groups on the plan", svg.includes("E-01") && svg.includes("K1"));
  const beforeDash = svg.split("stroke-dasharray")[0]!;
  check("the power run's geometry is drawn before the dashed sub-group opens",
    beforeDash.includes("routes-electrical"));

  const dxfBoth = toDxf(doc) ?? "";
  check("a floor with a data run gets the ROUTES-ELECTRICAL-DATA layer",
    dxfBoth.includes("ROUTES-ELECTRICAL-DATA"));
  check("the DXF prints route tags and groups", dxfBoth.includes("E-01") && dxfBoth.includes("K1"));

  const powerOnly = emptyDoc();
  powerOnly.floors[0]!.routes = [
    { id: "power", discipline: "electrical", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];
  const dxfPowerOnly = toDxf(powerOnly) ?? "";
  check("a floor with only power runs carries no ROUTES-ELECTRICAL-DATA layer",
    !dxfPowerOnly.includes("ROUTES-ELECTRICAL-DATA"));
}

/* ── water vocabulary: accessors ── */

{
  const wroute = (over: Partial<Route> = {}): Route =>
    ({ id: "w1", discipline: "water", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }], segments: [{ id: "s0", a: "p0", b: "p1" }], ...over });

  check("routeWater defaults to koud when absent", routeWater(wroute()) === "koud");
  check("routeWater reads an explicit kind", routeWater(wroute({ water: "warm" })) === "warm");
  check("routeDiameter defaults to 15 for koud", routeDiameter(wroute()) === 15);
  check("routeDiameter defaults to 15 for warm", routeDiameter(wroute({ water: "warm" })) === 15);
  check("routeDiameter defaults to 50 for afvoer", routeDiameter(wroute({ water: "afvoer" })) === 50);
  check("routeDiameter reads an explicit value", routeDiameter(wroute({ diameter: 28 })) === 28);
  check("every water kind is offered", ROUTE_WATERS.length === 3
    && ROUTE_WATERS.includes("koud") && ROUTE_WATERS.includes("warm") && ROUTE_WATERS.includes("afvoer"));
  check("the supply ladder is ordered in steps", WATER_SUPPLY_DIAMETERS.join(",") === "15,22,28");
  check("the drain ladder is ordered in steps", WATER_DRAIN_DIAMETERS.join(",") === "40,50,75,110");
}

/* ── water vocabulary: the schema ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.routes = [
    { id: "w2", discipline: "water", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }], segments: [{ id: "s0", a: "p0", b: "p1" }], water: "warm", diameter: 22 },
    { id: "w3", discipline: "water", points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 1000, y: 500 }], segments: [{ id: "s0", a: "p0", b: "p1" }], water: "afvoer" },
  ];
  check("a document with the water fields validates", validate(schema, doc).length === 0,
    validate(schema, doc).join(" | "));

  const lowDiameter = JSON.parse(JSON.stringify(doc));
  lowDiameter.floors[0].routes[0].diameter = 7;
  check("diameter below the schema minimum is rejected", validate(schema, lowDiameter).length > 0);

  const highDiameter = JSON.parse(JSON.stringify(doc));
  highDiameter.floors[0].routes[0].diameter = 201;
  check("diameter above the schema maximum is rejected", validate(schema, highDiameter).length > 0);

  const badWater = JSON.parse(JSON.stringify(doc));
  badWater.floors[0].routes[0].water = "gas";
  check("an unknown water kind is rejected", validate(schema, badWater).length > 0);

  // JSON round-trip.
  const again = JSON.parse(JSON.stringify(doc));
  check("water fields round-trip through JSON",
    JSON.stringify(again.floors[0].routes) === JSON.stringify(doc.floors[0]!.routes));
  check("the round-tripped document still validates", validate(schema, again).length === 0);
}

/* ── water vocabulary: reported figures ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [
    // Two koud runs at the default diameter -- summed into one entry.
    { id: "k1", discipline: "water", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    { id: "k2", discipline: "water", points: [{ id: "p0", x: 0, y: 100 }, { id: "p1", x: 500, y: 100 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    // A warm run at a non-default diameter.
    { id: "h1", discipline: "water", water: "warm", diameter: 22,
      points: [{ id: "p0", x: 0, y: 200 }, { id: "p1", x: 2000, y: 200 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    // An afvoer run at its own default diameter.
    { id: "a1", discipline: "water", water: "afvoer",
      points: [{ id: "p0", x: 0, y: 300 }, { id: "p1", x: 1200, y: 300 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];

  const waters = routeWaterSummaries(f);
  const koud15 = waters.find(w => w.water === "koud" && w.diameter === 15);
  const warm22 = waters.find(w => w.water === "warm" && w.diameter === 22);
  const afvoer50 = waters.find(w => w.water === "afvoer" && w.diameter === 50);
  check("koud runs at the same diameter are summed into one entry",
    koud15 !== undefined && Math.abs(koud15.lengthMm - 1500) < 1e-6, JSON.stringify(waters));
  check("warm is reported separately at its own diameter",
    warm22 !== undefined && Math.abs(warm22.lengthMm - 2000) < 1e-6, JSON.stringify(waters));
  check("afvoer is reported separately at its own default diameter",
    afvoer50 !== undefined && Math.abs(afvoer50.lengthMm - 1200) < 1e-6, JSON.stringify(waters));
  check("exactly three water summary entries", waters.length === 3, JSON.stringify(waters));
}

/* ── water vocabulary: SVG dash/tint and DXF layer ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [
    { id: "koud", discipline: "water", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    { id: "warm", discipline: "water", water: "warm", points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 1000, y: 500 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    { id: "afvoer", discipline: "water", water: "afvoer", points: [{ id: "p0", x: 0, y: 1000 }, { id: "p1", x: 1000, y: 1000 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];

  const svg = toSvg(doc) ?? "";
  check("the water group still carries one id", svg.includes('id="routes-water"'));
  check("the SVG carries a dash pattern for the afvoer sub-group", svg.includes("stroke-dasharray"));
  const beforeDash = svg.split("stroke-dasharray")[0]!;
  check("koud's geometry is drawn before the dashed sub-group opens",
    beforeDash.includes("routes-water"));
  check("warm draws in its own tinted sub-group stroke",
    /<g stroke="#[0-9a-f]{6}">/i.test(svg.split('id="routes-water"')[1]!.split("</g>")[0] ?? ""));

  const dxfAll = toDxf(doc) ?? "";
  check("a floor with an afvoer run gets the ROUTES-WATER-AFVOER layer",
    dxfAll.includes("ROUTES-WATER-AFVOER"));

  const supplyOnly = emptyDoc();
  supplyOnly.floors[0]!.routes = [
    { id: "koud", discipline: "water", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    { id: "warm", discipline: "water", water: "warm", points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 1000, y: 500 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];
  const dxfSupplyOnly = toDxf(supplyOnly) ?? "";
  check("a floor with only supply runs carries no ROUTES-WATER-AFVOER layer",
    !dxfSupplyOnly.includes("ROUTES-WATER-AFVOER"));
}

/* ── vent vocabulary: accessors ── */

{
  const vroute = (over: Partial<Route> = {}): Route =>
    ({ id: "v1", discipline: "vent", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }], segments: [{ id: "s0", a: "p0", b: "p1" }], ...over });

  check("routeVent defaults to toevoer when absent", routeVent(vroute()) === "toevoer");
  check("routeVent reads an explicit kind", routeVent(vroute({ vent: "afvoer" })) === "afvoer");
  check("routeDuctDiameter defaults to 125", routeDuctDiameter(vroute()) === 125);
  check("routeDuctDiameter reads an explicit value", routeDuctDiameter(vroute({ ductDiameter: 160 })) === 160);
  check("routeFlow is undefined when absent -- no default", routeFlow(vroute()) === undefined);
  check("routeFlow reads an explicit value", routeFlow(vroute({ flow: 90 })) === 90);
  check("every vent kind is offered", ROUTE_VENTS.length === 2
    && ROUTE_VENTS.includes("toevoer") && ROUTE_VENTS.includes("afvoer"));
  check("the duct diameter ladder is ordered in steps",
    VENT_DIAMETERS.join(",") === "100,125,150,160,180,200");
}

/* ── vent vocabulary: the schema ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.routes = [
    { id: "v2", discipline: "vent", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }], segments: [{ id: "s0", a: "p0", b: "p1" }],
      vent: "afvoer", ductDiameter: 160, flow: 90 },
    { id: "v3", discipline: "vent", points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 1000, y: 500 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];
  check("a document with the vent fields validates", validate(schema, doc).length === 0,
    validate(schema, doc).join(" | "));

  const lowDiameter = JSON.parse(JSON.stringify(doc));
  lowDiameter.floors[0].routes[0].ductDiameter = 62;
  check("duct diameter below the schema minimum is rejected", validate(schema, lowDiameter).length > 0);

  const highDiameter = JSON.parse(JSON.stringify(doc));
  highDiameter.floors[0].routes[0].ductDiameter = 401;
  check("duct diameter above the schema maximum is rejected", validate(schema, highDiameter).length > 0);

  const badFlow = JSON.parse(JSON.stringify(doc));
  badFlow.floors[0].routes[0].flow = 0;
  check("flow below the schema minimum is rejected", validate(schema, badFlow).length > 0);

  const badVent = JSON.parse(JSON.stringify(doc));
  badVent.floors[0].routes[0].vent = "gas";
  check("an unknown vent kind is rejected", validate(schema, badVent).length > 0);

  // JSON round-trip.
  const again = JSON.parse(JSON.stringify(doc));
  check("vent fields round-trip through JSON",
    JSON.stringify(again.floors[0].routes) === JSON.stringify(doc.floors[0]!.routes));
  check("the round-tripped document still validates", validate(schema, again).length === 0);
}

/* ── vent vocabulary: SVG dash/width and DXF layer ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.routes = [
    { id: "toevoer", discipline: "vent", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    { id: "afvoer", discipline: "vent", vent: "afvoer", points: [{ id: "p0", x: 0, y: 500 }, { id: "p1", x: 1000, y: 500 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
    { id: "elec", discipline: "electrical", points: [{ id: "p0", x: 0, y: 1000 }, { id: "p1", x: 1000, y: 1000 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];

  const svg = toSvg(doc) ?? "";
  check("the vent group carries one id", svg.includes('id="routes-vent"'));
  check("the SVG carries a dash pattern for the vent afvoer sub-group", svg.includes("stroke-dasharray"));

  // Each discipline's markup is self-contained (routeSvgParts nests its own
  // <g>...</g> per discipline before moving to the next), so splitting right
  // before each "<g id=\"routes-..." isolates one discipline's own tags --
  // unlike splitting the full document string, which would also catch every
  // sub-group after it.
  const segments = routeSvgParts(f).join("\n").split(/(?=<g id="routes-)/);
  const ventSeg = segments.find(s => s.startsWith('<g id="routes-vent"')) ?? "";
  const electricalSeg = segments.find(s => s.startsWith('<g id="routes-electrical"')) ?? "";
  const maxWidth = (seg: string): number =>
    Math.max(0, ...[...seg.matchAll(/stroke-width="(\d+(?:\.\d+)?)"/g)].map(m => Number(m[1])));
  check("vent runs draw wider than electrical runs",
    maxWidth(ventSeg) > maxWidth(electricalSeg), `${maxWidth(ventSeg)} vs ${maxWidth(electricalSeg)}`);

  const dxfBoth = toDxf(doc) ?? "";
  check("a floor with an afvoer vent run gets the ROUTES-VENT-AFVOER layer",
    dxfBoth.includes("ROUTES-VENT-AFVOER"));

  const toevoerOnly = emptyDoc();
  toevoerOnly.floors[0]!.routes = [
    { id: "toevoer", discipline: "vent", points: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 1000, y: 0 }] , segments: [{ id: "s0", a: "p0", b: "p1" }]},
  ];
  const dxfToevoerOnly = toDxf(toevoerOnly) ?? "";
  check("a floor with only toevoer runs carries no ROUTES-VENT-AFVOER layer",
    !dxfToevoerOnly.includes("ROUTES-VENT-AFVOER"));
}

/* ── discipline list ── */

{
  const doc = emptyDoc();
  doc.floors[0]!.routes = [{
    id: "gas-1", discipline: "gas", tag: "G-01", diameter: 22, installation: "surface", height: 300,
    points: [
      { id: "g0", x: 0, y: 0, terminal: "source" },
      { id: "g1", x: 1000, y: 0, terminal: "capped" },
    ],
    segments: [{ id: "gs", a: "g0", b: "g1" }],
  }];
  const schema = planSchema("");
  check("a surface-mounted gas network with explicit endpoints validates",
    validate(schema, doc).length === 0, validate(schema, doc).join(" | "));
  check("gas gets its own SVG group", (toSvg(doc) ?? "").includes('id="routes-gas"'));
  check("gas gets its own DXF layer", (toDxf(doc) ?? "").includes("ROUTES-GAS"));

  const missingSegments = JSON.parse(JSON.stringify(doc));
  delete missingSegments.floors[0].routes[0].segments;
  check("a network without explicit graph edges is rejected", validate(schema, missingSegments).length > 0);
}

check("every discipline is offered", DISCIPLINES.length === 4
  && DISCIPLINES.includes("electrical") && DISCIPLINES.includes("water")
  && DISCIPLINES.includes("vent") && DISCIPLINES.includes("gas"));

for (const lng of ["nl", "en"] as const) {
  const panel = ((resources[lng].translation as unknown) as Record<string, Record<string, unknown>>).panel ?? {};
  for (const d of DISCIPLINES) {
    const key = "discipline" + d[0]!.toUpperCase() + d.slice(1);
    check(`${lng} names discipline "${d}"`, typeof panel[key] === "string", key);
  }
  for (const k of ROUTE_KINDS) {
    const key = "routeKind" + k[0]!.toUpperCase() + k.slice(1);
    check(`${lng} names route kind "${k}"`, typeof panel[key] === "string", key);
  }
  for (const w of ROUTE_WATERS) {
    const key = "routeWater" + w[0]!.toUpperCase() + w.slice(1);
    check(`${lng} names water kind "${w}"`, typeof panel[key] === "string", key);
  }
  for (const v of ROUTE_VENTS) {
    const key = "routeVent" + v[0]!.toUpperCase() + v.slice(1);
    check(`${lng} names vent kind "${v}"`, typeof panel[key] === "string", key);
  }
  check(`${lng} names the flow field`, typeof panel.routeFlow === "string");
}

console.log(failures === 0 ? "ALL ROUTE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
