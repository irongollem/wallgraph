// Dining chair: the preset, the authored pull-out space and where it is carried.
// The zone is a reservation drawn behind the backrest; it is part of the crop and
// of the exports, and never of the footprint a click selects.
import {
  Furnishing, FURNISHING_PRESETS, CHAIR_PULL_OUT_MM, CHAIR_SEAT_MM, FORM_DEPTHS, FORM_WIDTHS,
  chairPullOutMm, furnishingDefaults, furnishingPreset, furnishingSpecOf, clampFurnishing,
  writeSpec, furnishingClass,
} from "../src/model/furnishing";
import { furnishingBox, furnishingClearance, furnishingHit } from "../src/core/furnishing";
import { furnishingSolids } from "../src/core/furnishing3d";
import { furnishingPrims, furnishingClearancePrims } from "../src/io/furnishing";
import { planBounds } from "../src/core/bounds";
import { resolveFloor } from "../src/core/resolve";
import { toDxf } from "../src/io/dxf";
import { toSvg } from "../src/io/svg";
import { emptyDoc, newId } from "../src/model/doc";
import { planSchema, validate } from "../scripts/site/schema";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const chair = (over: Partial<Furnishing> = {}): Furnishing => ({
  id: newId("fit"), form: "chair", x: 2000, y: 1000, rotation: 0,
  width: 450, depth: 500, height: 900, ...over,
});

{
  const p = furnishingPreset("stoel");
  check("the stoel preset exists", !!p && p.form === "chair" && p.group === "meubels");
  check("it is placed at 450 x 500 x 900",
    !!p && p.width === 450 && p.depth === 500 && p.height === 900);
  const ids = FURNISHING_PRESETS.map(q => q.id);
  check("it is listed after the fauteuil", ids.indexOf("stoel") === ids.indexOf("fauteuil") + 1);
  check("a chair is furniture", furnishingClass("chair") === "furniture");
  check("width and depth ladders follow the table ones",
    JSON.stringify(FORM_WIDTHS.chair) === "[400,450,500,550]"
    && JSON.stringify(FORM_DEPTHS.chair) === "[450,500,550]");
}

{
  check("the pull-out space defaults to 300", chairPullOutMm(chair()) === 300 && CHAIR_PULL_OUT_MM === 300);
  check("an authored figure is read", chairPullOutMm(chair({ pullOutMm: 450 })) === 450);
  check("it clamps at both ends",
    chairPullOutMm(chair({ pullOutMm: -20 })) === 0 && chairPullOutMm(chair({ pullOutMm: 9000 })) === 1500);
  check("it rounds to whole mm", chairPullOutMm(chair({ pullOutMm: 412.6 })) === 413);
  check("only a chair carries one",
    chairPullOutMm({ ...chair({ pullOutMm: 700 }), form: "table" }) === CHAIR_PULL_OUT_MM);

  const spec = { ...furnishingSpecOf(chair()), pullOutMm: 9000 };
  check("clampFurnishing bounds it", clampFurnishing(spec).pullOutMm === 1500);
  const f = chair();
  writeSpec(f, { ...furnishingDefaults("chair"), pullOutMm: 600 });
  check("a chair stores an authored figure", f.pullOutMm === 600);
  writeSpec(f, { ...furnishingDefaults("chair"), pullOutMm: 300 });
  check("the default is left out", f.pullOutMm === undefined);
  const t: Furnishing = { ...chair(), form: "table", pullOutMm: 600 };
  writeSpec(t, { ...furnishingDefaults("table"), pullOutMm: 600 });
  check("another form drops the field", t.pullOutMm === undefined);
}

{
  const c = chair({ pullOutMm: 400 });
  const z = furnishingClearance(c)!;
  const b = furnishingBox(c);
  check("the zone lies behind the backrest, the chair's width wide",
    z.x0 === b.x0 && z.x1 === b.x1 && z.y1 === b.y0 && z.y0 === b.y0 - 400);
  check("no zone for a zero pull-out or another form",
    furnishingClearance(chair({ pullOutMm: 0 })) === null
    && furnishingClearance({ ...c, form: "table" }) === null);
  check("a click in the zone does not select the chair",
    !furnishingHit(c, v(2000, 1000 - 250 - 200)) && furnishingHit(c, v(2000, 1000)));

  const doc = emptyDoc(), floor = doc.floors[0]!;
  floor.furnishings = [c];
  const bounds = planBounds(floor, resolveFloor(floor))!;
  check("planBounds reaches the zone's far edge", bounds.min.y <= 1000 - 250 - 400, JSON.stringify(bounds));
  check("and the front of the seat", bounds.max.y >= 1000 + 250);

  check("the body prims exclude the zone",
    furnishingPrims(c).length > 0 && furnishingClearancePrims(c).length > 0
    && furnishingClearancePrims({ ...c, form: "table" }).length === 0);

  const svg = toSvg(doc) ?? "";
  const zoneAt = svg.indexOf('id="furnishing-clearance"');
  check("the SVG carries the zone in a dashed group",
    zoneAt > 0 && svg.slice(zoneAt, zoneAt + 300).includes("stroke-dasharray"));
  const plain = emptyDoc();
  plain.floors[0]!.furnishings = [chair({ pullOutMm: 0 })];
  check("a chair with no zone writes no zone group",
    !(toSvg(plain) ?? "").includes('id="furnishing-clearance"'));

  const layer = (s: string): number => s.split("FURNISHING-CLEARANCE").length - 1;
  check("the DXF carries the zone on its own layer",
    layer(toDxf(doc) ?? "") > layer(toDxf(plain) ?? ""));
}

{
  const parts = furnishingSolids(chair());
  check("the 3D parts are non-empty", parts.length > 0);
  check("the seat is at 450 and the backrest reaches the height",
    parts.some(p => p.z1 === CHAIR_SEAT_MM) && Math.max(...parts.map(p => p.z1)) === 900);
  check("four legs stand under the seat", parts.filter(p => p.z0 === 0).length === 4);
  const z = furnishingClearance(chair())!;
  check("the zone has no body",
    parts.every(p => p.poly.every(q => q.y >= 1000 - 250 - 1 && q.y <= 1000 + 250 + 1)) && z.y0 < 750);
}

{
  const doc = emptyDoc();
  doc.floors[0]!.furnishings = [chair({ pullOutMm: 450 })];
  check("a chair with a pull-out space passes the schema", validate(planSchema(""), doc).length === 0);
  const bad = JSON.parse(JSON.stringify(doc));
  bad.floors[0].furnishings[0].pullOutMm = 2000;
  check("a pull-out beyond 1500 is rejected", validate(planSchema(""), bad).length > 0);
}

console.log(failures === 0 ? "ALL CHAIR TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
