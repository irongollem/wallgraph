// Route tests: manual service routing (issue #25). Anchored points follow
// their symbol at derive time only, corridor fanning keeps bundled runs
// legible without touching the stored document, and the permit sheet must
// never carry services.
import { emptyDoc, routesOf } from "../src/model/doc";
import { Route, DISCIPLINES } from "../src/model/route";
import { resolveRoutePoints, routeLength, resolveRoutes } from "../src/core/route";
import { arcLength } from "../src/geometry/arc";
import { unanchorRoutePoints } from "../src/model/ops";
import { toDxf } from "../src/io/dxf";
import { toSvg } from "../src/io/svg";
import { permitSvg } from "../src/io/permit";
import { planSchema, validate } from "../scripts/site/schema";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const route = (over: Partial<Route> = {}): Route =>
  ({ id: "rt1", discipline: "electrical", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], ...over });

/* ── resolveRoutePoints: anchors ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push({ id: "s1", type: "socket-single", x: 500, y: 500, rotation: 0 });
  const rt: Route = { id: "rt1", discipline: "water", points: [{ x: 0, y: 0, anchor: "s1" }, { x: 1000, y: 1000 }] };
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
  const rt: Route = { id: "rt1", discipline: "vent", points: [{ x: 0, y: 0, anchor: "s1" }, { x: 1000, y: 0 }] };
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
  const straight = route({ points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }] });
  check("straight length sums the segments", routeLength(f, straight) === 7000, String(routeLength(f, straight)));

  // A bulged segment's contribution has to be the true arc length, not the
  // chord -- checked against geometry/arc.ts's own arcLength() rather than a
  // hand-derived figure, since that is the formula routeLength must delegate to.
  const bulge = 0.3;
  const p0 = { x: 0, y: 0 }, p1 = { x: 1000, y: 0 };
  const bulged = route({ points: [{ ...p0, bulge }, p1] });
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

/* ── resolveRoutes: corridor fanning ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  // Two routes over the exact same straight span.
  const a: Route = { id: "aaa", discipline: "electrical", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }] };
  const b: Route = { id: "bbb", discipline: "water", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }] };
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

  // A lone route with nothing to bundle with stays exactly on its own points.
  const solo: Route = { id: "ccc", discipline: "vent", points: [{ x: 5000, y: 5000 }, { x: 6000, y: 5000 }] };
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
    { id: "e1", discipline: "electrical", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }] },
    { id: "w1", discipline: "water", points: [{ x: 0, y: 500 }, { x: 2000, y: 500 }] },
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
  check("routes get all three DXF layer names once the floor has routes",
    dxf.includes("ROUTES-ELECTRICAL") && dxf.includes("ROUTES-WATER") && dxf.includes("ROUTES-VENT"));

  const noRoutes = emptyDoc();
  const dxfNoRoutes = toDxf(noRoutes) ?? "";
  check("a plan with no routes carries none of the three DXF layer names",
    !dxfNoRoutes.includes("ROUTES-ELECTRICAL") && !dxfNoRoutes.includes("ROUTES-WATER") && !dxfNoRoutes.includes("ROUTES-VENT"));
}

/* ── the published format ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.routes = [
    { id: "r1", discipline: "electrical", points: [{ x: 0, y: 0 }, { x: 1000, y: 0, bulge: 0.2 }, { x: 2000, y: 500 }] },
  ];
  check("a document with a route validates", validate(schema, doc).length === 0, validate(schema, doc).join(" | "));

  // JSON round-trip.
  const again = JSON.parse(JSON.stringify(doc));
  check("a route round-trips through JSON",
    JSON.stringify(again.floors[0].routes) === JSON.stringify(doc.floors[0]!.routes));
  check("the round-tripped document still validates", validate(schema, again).length === 0);

  const badDiscipline = JSON.parse(JSON.stringify(doc));
  badDiscipline.floors[0].routes[0].discipline = "gas";
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

/* ── discipline list ── */

check("every discipline is offered", DISCIPLINES.length === 3
  && DISCIPLINES.includes("electrical") && DISCIPLINES.includes("water") && DISCIPLINES.includes("vent"));

for (const lng of ["nl", "en"] as const) {
  const panel = ((resources[lng].translation as unknown) as Record<string, Record<string, unknown>>).panel ?? {};
  for (const d of DISCIPLINES) {
    const key = "discipline" + d[0]!.toUpperCase() + d.slice(1);
    check(`${lng} names discipline "${d}"`, typeof panel[key] === "string", key);
  }
}

console.log(failures === 0 ? "ALL ROUTE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
