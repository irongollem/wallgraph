// Vide tests: an opening in the floor slab is a feature of the floor, and the
// mark drawn for it has to land where the hit-test and the export crop say.
import { Vide, VIDE_DEFAULT, clampVide } from "../src/model/vide";
import { videBox, videCorners, videHit, videLabelAt } from "../src/core/vide";
import { videPrims } from "../src/io/vide";
import { Prim } from "../src/io/record";
import { Vec, v } from "../src/geometry/vec";
import { emptyDoc, videsOf } from "../src/model/doc";
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

const mk = (over: Partial<Vide> = {}): Vide =>
  ({ id: "v1", x: 0, y: 0, rotation: 0, ...VIDE_DEFAULT, ...over });

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
  const vd = mk();
  const b = videBox(vd);
  check("the anchor is the centre of the opening",
    b.x0 === -b.x1 && b.y0 === -b.y1 && b.x1 - b.x0 === vd.width && b.y1 - b.y0 === vd.depth,
    JSON.stringify(b));
  check("a point inside hits", videHit(vd, v(0, 0)) && videHit(vd, v(500, 1000)));
  check("a point outside misses", !videHit(vd, v(0, 2000)));
  check("the grab margin extends the opening", videHit(vd, v(0, 1310), 30));
  const turned = mk({ rotation: Math.PI / 2 });
  check("the hit-test follows the rotation",
    videHit(turned, v(1000, 0)) && !videHit(turned, v(0, 1000)));
  check("the corners come back in world millimetres",
    videCorners(mk({ x: 1000, y: 500 })).every(c => isFinite(c.x) && isFinite(c.y)));
}

{
  const s = clampVide({ width: 1199.6, depth: 0 });
  check("dimensions are whole millimetres and never a slot",
    Number.isInteger(s.width) && s.width === 1200 && s.depth >= 200, JSON.stringify(s));
  check("nonsense does not become NaN", isFinite(clampVide({ width: NaN, depth: NaN }).width));
}

{
  // The word sits inside the top edge, clear of where the diagonals cross.
  const at = videLabelAt(mk());
  check("the label clears the crossing", at.x === 0 && at.y < 0 && at.y > -VIDE_DEFAULT.depth / 2,
    JSON.stringify(at));
  const shallow = videLabelAt(mk({ depth: 300 }));
  check("a shallow vide still keeps its label inside",
    shallow.y > -150 && shallow.y <= 0, JSON.stringify(shallow));
}

/* ── the mark ── */

{
  const vd = mk({ label: "trapgat" });
  const prims = videPrims(vd, "vide");
  const b = videBox(vd);
  check("the mark draws", prims.length > 0);
  check("it carries the caption it was given",
    prims.some(p => p.kind === "text" && p.text === "trapgat"),
    JSON.stringify(prims.filter(p => p.kind === "text")));
  check("an unnamed vide falls back to the plain word",
    videPrims(mk(), "vide").some(p => p.kind === "text" && p.text === "vide"));
  const stray = points(prims).filter(q =>
    q.x < b.x0 - 5 || q.x > b.x1 + 5 || q.y < b.y0 - 5 || q.y > b.y1 + 5);
  check("nothing is drawn outside the opening", stray.length === 0,
    stray.slice(0, 2).map(q => `${Math.round(q.x)},${Math.round(q.y)}`).join(" "));
  check("the diagonals are there",
    points(prims).some(q => q.x === b.x0 && q.y === b.y0)
    && points(prims).some(q => q.x === b.x1 && q.y === b.y0));
}

/* ── the document and its exports ── */

{
  const doc = emptyDoc();
  const floor = doc.floors[0]!;
  floor.vides = [mk({ id: "v9", x: 2000, y: 1500 })];
  check("a floor's vides read back", videsOf(floor).length === 1);
  check("an absent list is not an error", videsOf({ ...floor, vides: undefined }).length === 0);

  const bounds = planBounds(floor, resolveFloor(floor))!;
  check("the crop takes the vide in",
    bounds !== null && bounds.min.x <= 1400 && bounds.max.y >= 2790, JSON.stringify(bounds));

  const dxf = toDxf(doc);
  check("a plan of nothing but a vide still exports", typeof dxf === "string" && dxf.length > 0);
  check("vides get their own DXF layer", (dxf ?? "").includes("VOIDS"));

  const svg = toSvg(doc);
  check("vides get their own SVG group", (svg ?? "").includes('id="vides"'));
  check("the SVG cuts the floor under the opening",
    ((svg ?? "").split('id="vides"')[1] ?? "").includes("#f4f2ec"));
}

/* ── the published format ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.vides = [
    { id: "v1", x: 0, y: 0, rotation: 0, width: 1200, depth: 2600, label: "trapgat", color: "#d0342c" },
  ];
  check("a document with a vide validates", validate(schema, doc).length === 0,
    validate(schema, doc).join(" | "));

  const bad = JSON.parse(JSON.stringify(doc));
  delete bad.floors[0].vides[0].depth;
  check("a vide without a depth is rejected", validate(schema, bad).length > 0);

  const extra = JSON.parse(JSON.stringify(doc));
  extra.floors[0].vides[0].height = 2400;
  check("an unknown vide property is rejected", validate(schema, extra).length > 0);
}

for (const lng of ["nl", "en"] as const) {
  const dict = ((resources[lng].translation as unknown) as Record<string, { label?: string }>).vide ?? {};
  check(`the ${lng} plan word exists`, typeof dict.label === "string", JSON.stringify(dict));
}

console.log(failures === 0 ? "ALL VIDE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
