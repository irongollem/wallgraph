// Deck tests: a timber floor placed on a storey. The mark, the hit-test and the
// export crop have to agree about where it is, and the joist set-out has to be
// the one the takeoff and the 3D view count.
import {
  Deck, DECK_DEFAULT, BEARING_DEFAULT_MM, clampDeck, clampDeckSize, deckUseOf, DECK_USES,
} from "../src/model/deck";
import {
  deckBox, deckCorners, deckHit, deckLabelAt, deckJoists, deckJoistsLocal, deckSpanMm,
  deckTop, deckBottom, deckSolids,
} from "../src/core/deck";
import { deckPrims } from "../src/io/deck";
import { Prim } from "../src/io/record";
import { Vec, v } from "../src/geometry/vec";
import { emptyDoc, decksOf } from "../src/model/doc";
import { Store } from "../src/model/store";
import { cloneOnFloor } from "../src/model/ops";
import { toDxf } from "../src/io/dxf";
import { toSvg } from "../src/io/svg";
import { planBounds } from "../src/core/bounds";
import { resolveFloor } from "../src/core/resolve";
import { planSchema, validate } from "../scripts/site/schema";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const mk = (over: Partial<Deck> = {}): Deck =>
  ({ id: "d1", x: 0, y: 0, rotation: 0, ...DECK_DEFAULT, ...over });

function points(prims: Prim[]): Vec[] {
  const out: Vec[] = [];
  for (const p of prims) {
    if (p.kind === "line") out.push(p.a, p.b);
    else if (p.kind === "poly") out.push(...p.pts);
    else if (p.kind === "text") out.push(p.at);
  }
  return out;
}

/* ── geometry ── */

{
  const dk = mk();
  const b = deckBox(dk);
  check("the anchor is the centre of the platform",
    b.x0 === -b.x1 && b.y0 === -b.y1 && b.x1 - b.x0 === dk.width && b.y1 - b.y0 === dk.depth,
    JSON.stringify(b));
  check("a point inside hits", deckHit(dk, v(0, 0)) && deckHit(dk, v(1100, 1700)));
  check("a point outside misses", !deckHit(dk, v(0, 2000)));
  check("the grab margin extends the platform", deckHit(dk, v(0, 1810), 30));
  const turned = mk({ rotation: Math.PI / 2 });
  check("the hit-test follows the rotation", deckHit(turned, v(1700, 0)) && !deckHit(turned, v(0, 1700)));
  check("the corners come back in world millimetres",
    deckCorners(mk({ x: 1000, y: 500 })).every(c => isFinite(c.x) && isFinite(c.y)));
}

{
  const s = clampDeckSize({ width: 2399.6, depth: 0, joistAxis: "x", joistMm: 5000 });
  check("sizes are whole millimetres and in range",
    s.width === 2400 && s.depth === 300 && s.joistMm === 1200 && s.joistAxis === "x", JSON.stringify(s));
  check("nonsense does not become NaN",
    isFinite(clampDeckSize({ width: NaN, depth: NaN, joistAxis: "y", joistMm: NaN }).width));
  const c = clampDeck(mk({ joist: { w: 5, d: 900 }, bearingMm: 10, deckingMm: 0, topMm: 9000 }), 2600);
  check("a section is clamped to 30–400", c.joist?.w === 30 && c.joist.d === 400, JSON.stringify(c.joist));
  check("a bearing is clamped to 50–300", c.bearingMm === 50);
  check("a decking of 0 states nothing", c.deckingMm === undefined);
  check("a top stays inside the storey", c.topMm === 2600);
}

{
  // Joists run along y here, so they are set out across the width.
  const seven = deckJoistsLocal(mk({ width: 3600 }));
  check("a 3600 set-out at 600 gives 7 joists, edges included", seven.length === 7, String(seven.length));
  check("the edge joists stand on the edges",
    seven[0]!.a.x === -1800 && seven[6]!.a.x === 1800, `${seven[0]!.a.x} ${seven[6]!.a.x}`);
  const narrower = deckJoistsLocal(mk({ width: 3500 }));
  const bay = narrower[1]!.a.x - narrower[0]!.a.x;
  check("3500 is still 7 joists, at narrower bays", narrower.length === 7 && bay < 600, `${narrower.length} ${bay}`);
  check("3700 needs an eighth joist, since no bay may exceed the centres",
    deckJoistsLocal(mk({ width: 3700 })).length === 8);
  const sectioned = deckJoistsLocal(mk({ width: 3600, joist: { w: 71, d: 171 } }));
  check("with a section the edge joists sit inside the box",
    Math.abs(sectioned[0]!.a.x - (-1800 + 35.5)) < 1e-9, String(sectioned[0]!.a.x));
  check("every joist crosses the clear span",
    seven.every(j => j.a.y === -1800 && j.b.y === 1800) && deckSpanMm(mk()) === 3600);
  const across = deckJoistsLocal(mk({ joistAxis: "x" }));
  check("joists along x span the width and are set out across the depth",
    across.every(j => j.a.x === -1200 && j.b.x === 1200) && across.length === 7);
  // A quarter turn lays joists that ran along local y along world x.
  const world = deckJoists(mk({ x: 1000, y: 0, rotation: Math.PI / 2 }));
  check("world joists follow the placement",
    world.length === 5 && world.every(j => Math.abs(j.a.y - j.b.y) < 1e-9 && Math.abs(Math.abs(j.a.x - j.b.x) - 3600) < 1e-9),
    JSON.stringify(world[0]));
}

{
  check("a deck without a height is the storey floor", deckTop(mk()) === 0);
  const loft = mk({ topMm: 2200, joist: { w: 71, d: 171 }, deckingMm: 18 });
  check("the underside sits below the joists and the decking", deckBottom(loft) === 2200 - 171 - 18);
  const solids = deckSolids(loft);
  check("a loft carries a decking slab and a prism per joist",
    solids.filter(s => s.part === "decking").length === 1
    && solids.filter(s => s.part === "joist").length === deckJoistsLocal(loft).length);
  const joist = solids.find(s => s.part === "joist")!;
  const ys = joist.poly.map(p => p.y);
  check("a joist runs the span plus the bearing at both ends",
    Math.max(...ys) - Math.min(...ys) === 3600 + 2 * BEARING_DEFAULT_MM, JSON.stringify(ys));
  check("the joists stand under the decking", joist.z1 === 2200 - 18 && joist.z0 === 2200 - 18 - 171);
  const floorLevel = deckSolids(mk({ joist: { w: 71, d: 171 }, deckingMm: 18 }));
  check("a balklaag at floor level draws no slab of its own",
    floorLevel.every(s => s.part === "joist") && floorLevel.every(s => s.z1 <= 0));
  check("without a section there are no joists to extrude", deckSolids(mk()).length === 0);
}

{
  check("no loads is no use", deckUseOf(mk()) === "");
  const w = DECK_USES.find(u => u.id === "wonen")!;
  check("preset figures read back as the preset", deckUseOf(mk({ loadG: w.loadG, loadQ: w.loadQ })) === "wonen");
  check("other figures read as custom", deckUseOf(mk({ loadG: 1, loadQ: 2 })) === "custom");
}

{
  const at = deckLabelAt(mk());
  check("the label sits inside the top edge", at.x === 0 && at.y < 0 && at.y > -DECK_DEFAULT.depth / 2,
    JSON.stringify(at));
}

/* ── the mark ── */

{
  const dk = mk({ label: "vliering", joist: { w: 71, d: 171 } });
  const prims = deckPrims(dk, "balklaag");
  const b = deckBox(dk);
  check("the mark draws", prims.length > 0);
  check("it carries the caption it was given", prims.some(p => p.kind === "text" && p.text === "vliering"));
  check("an unnamed deck falls back to the plain word",
    deckPrims(mk(), "balklaag").some(p => p.kind === "text" && p.text === "balklaag"));
  const stray = points(prims).filter(q =>
    q.x < b.x0 - 5 || q.x > b.x1 + 5 || q.y < b.y0 - 5 || q.y > b.y1 + 5);
  check("nothing is drawn outside the platform", stray.length === 0,
    stray.slice(0, 2).map(q => `${Math.round(q.x)},${Math.round(q.y)}`).join(" "));
  check("a line per joist is drawn",
    prims.filter(p => p.kind === "line").length >= deckJoistsLocal(dk).length
    || prims.some(p => p.kind === "poly"));
}

/* ── the document and its exports ── */

{
  const doc = emptyDoc();
  const floor = doc.floors[0]!;
  check("a new plan seeds an empty deck list", Array.isArray(floor.decks) && floor.decks.length === 0);
  floor.decks = [mk({ id: "d9", x: 2000, y: 1500 })];
  check("a floor's decks read back", decksOf(floor).length === 1);
  check("an absent list is not an error", decksOf({ ...floor, decks: undefined }).length === 0);

  const bounds = planBounds(floor, resolveFloor(floor))!;
  check("the crop takes the deck in",
    bounds !== null && bounds.min.x <= 800 && bounds.max.y >= 3300, JSON.stringify(bounds));

  const dxf = toDxf(doc) ?? "";
  check("a plan of nothing but a deck still exports", dxf.length > 0);
  check("decks get their own DXF layer", dxf.includes("DECKS"));

  const svg = toSvg(doc) ?? "";
  check("decks get their own SVG group", svg.includes('id="decks"'));
  check("a floor-level deck is not dashed", !(svg.split('id="decks"')[1] ?? "").split("</g>")[0]!.includes("dasharray"));
  floor.decks[0]!.topMm = 2000;
  check("a raised deck is dashed", (toSvg(doc) ?? "").split('id="decks"')[1]?.includes("stroke-dasharray") === true);
  check("a raised deck lands on the overhead layer", (toDxf(doc) ?? "").includes("DECKS-OVERHEAD"));

  const made = cloneOnFloor(floor, "deck", ["d9"]);
  const copy = decksOf(floor).find(d => d.id === made.get("d9"));
  check("a clone copies everything but the id", copy !== undefined && copy.id !== "d9" && copy.topMm === 2000);
  copy!.x += 100;
  check("a clone shares nothing with its original", decksOf(floor)[0]!.x === 2000);
}

{
  const store = new Store();
  store.mutate(d => { d.floors[0]!.decks = [mk({ id: "d1" })]; });
  store.duplicateFloor("2");
  const up = store.doc.floors[1]!;
  check("a duplicated storey carries its decks under fresh ids",
    decksOf(up).length === 1 && decksOf(up)[0]!.id !== "d1");
  store.addFloor("3");
  check("an added storey seeds an empty deck list", Array.isArray(store.floor.decks) && store.floor.decks.length === 0);
}

/* ── the published format ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.decks = [{
    id: "d1", x: 0, y: 0, rotation: 0, width: 2400, depth: 3600, joistAxis: "y", joistMm: 600,
    joist: { w: 71, d: 171 }, bearingMm: 100, deckingMm: 18, topMm: 2200, loadG: 500, loadQ: 1750,
    label: "vliering", color: "#d0342c",
  }];
  check("a document with a deck validates", validate(schema, doc).length === 0, validate(schema, doc).join(" | "));

  const bad = JSON.parse(JSON.stringify(doc));
  delete bad.floors[0].decks[0].joistAxis;
  check("a deck without a joist direction is rejected", validate(schema, bad).length > 0);

  const extra = JSON.parse(JSON.stringify(doc));
  extra.floors[0].decks[0].height = 2400;
  check("an unknown deck property is rejected", validate(schema, extra).length > 0);

  const axis = JSON.parse(JSON.stringify(doc));
  axis.floors[0].decks[0].joistAxis = "z";
  check("a joist direction other than x or y is rejected", validate(schema, axis).length > 0);
}

for (const lng of ["nl", "en"] as const) {
  const dict = (resources[lng].translation as unknown) as Record<string, Record<string, string>>;
  const deck = dict.deck ?? {};
  check(`the ${lng} plan word exists`, typeof deck.label === "string", JSON.stringify(deck));
  check(`the ${lng} use presets are named`, DECK_USES.every(u => typeof deck["use_" + u.id] === "string"));
}

console.log(failures === 0 ? "ALL DECK TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
