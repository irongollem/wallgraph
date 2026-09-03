// Structure tests: columns, beams and railings are placed objects carrying
// their own figures, drawn by their relation to the section plane and handed
// to every export as one prism each.
import {
  Column, Beam, Railing, COLUMN_DEFAULT, BEAM_DEFAULT, STEEL_PROFILES, STRUCTURE_LIMITS,
  CUT_PLANE_MM, belowCutPlane, clampColumnSize, clampBeamSize, clampRailWidth, clampRailHeight,
  clampPostMm, clampStructureHeight, moveStructure, SPAN_MIN_MM,
} from "../src/model/structure";
import {
  columnBox, columnProfile, columnOutline, columnHeight, beamBottom, beamTop, spanLength, spanPlaced,
  spanBox, spanTurned, spanQuad, structureCorners, structureHit, structureLabelAt, railingPosts,
  structureSolid, structureSolids, isSpan,
} from "../src/core/structure";
import { structurePrims } from "../src/io/structure";
import { Prim } from "../src/io/record";
import { Vec, v, dist } from "../src/geometry/vec";
import { emptyDoc, structureOf, floorHeight } from "../src/model/doc";
import { cloneOnFloor } from "../src/model/ops";
import { marqueePick } from "../src/input/marquee";
import { toDxf } from "../src/io/dxf";
import { toSvg } from "../src/io/svg";
import { toIfc } from "../src/io/ifc";
import { buildSceneMesh } from "../src/render3d/mesh";
import { planBounds } from "../src/core/bounds";
import { resolveFloor } from "../src/core/resolve";
import { wallPen, COLORS } from "../src/render/draw";
import { planSchema, validate } from "../scripts/site/schema";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
const nearVec = (a: Vec, b: Vec, eps = 1e-6): boolean => near(a.x, b.x, eps) && near(a.y, b.y, eps);

const column = (over: Partial<Column> = {}): Column =>
  ({ id: "c1", kind: "column", x: 0, y: 0, rotation: 0, ...COLUMN_DEFAULT, ...over });
const beam = (over: Partial<Beam> = {}): Beam =>
  ({ id: "b1", kind: "beam", a: v(0, 0), b: v(3000, 0), ...BEAM_DEFAULT, ...over });
const railing = (over: Partial<Railing> = {}): Railing =>
  ({ id: "r1", kind: "railing", a: v(0, 0), b: v(2400, 0), width: 50, height: 1000, postMm: 1000, ...over });

function points(prims: Prim[]): Vec[] {
  const out: Vec[] = [];
  for (const p of prims) {
    if (p.kind === "line") out.push(p.a, p.b);
    else if (p.kind === "poly") out.push(...p.pts);
    else if (p.kind === "text") out.push(p.at);
  }
  return out;
}

/* ── the figures ── */

{
  const lim = STRUCTURE_LIMITS;
  check("a column side is held to the section range",
    clampColumnSize({ shape: "rect", width: 5, depth: 99999 }).width === lim.section.min
    && clampColumnSize({ shape: "rect", width: 5, depth: 99999 }).depth === lim.section.max);
  const round = clampColumnSize({ shape: "round", width: 250, depth: 900 });
  check("a round column's depth is its width", round.depth === round.width && round.width === 250);
  check("a beam's depth has its own range",
    clampBeamSize({ width: 200, depth: 1 }).depth === lim.beamDepth.min);
  check("a clamped figure is a whole millimetre", clampBeamSize({ width: 200.4, depth: 190.6 }).depth === 191);
  check("a handrail is held to its range", clampRailWidth(1) === lim.railWidth.min && clampRailWidth(9999) === lim.railWidth.max);
  check("a railing height is held to its range", clampRailHeight(1) === lim.railHeight.min);
  check("no posts is a legal spacing", clampPostMm(0) === 0 && clampPostMm(-5) === 0);
  check("a stated height cannot be zero", clampStructureHeight(0) === lim.height.min);
  check("the section plane sits at 1200", CUT_PLANE_MM === 1200);
  check("a borstwering is below the plane", belowCutPlane({ height: 1200 }) && belowCutPlane({ height: 900 }));
  check("a full wall is cut", !belowCutPlane({ height: 1201 }) && !belowCutPlane({}));
  check("a span has a minimum run", SPAN_MIN_MM > 0);
}

{
  check("every steel profile carries its two figures and a designation",
    STEEL_PROFILES.every(p => p.width > 0 && p.depth > 0 && /^(HEA|HEB|IPE) \d+$/.test(p.label)));
  check("designations are unique", new Set(STEEL_PROFILES.map(p => p.label)).size === STEEL_PROFILES.length);
  const hea200 = STEEL_PROFILES.find(p => p.label === "HEA 200")!;
  check("HEA 200 is 190 deep and 200 wide", hea200.depth === 190 && hea200.width === 200);
  const ipe200 = STEEL_PROFILES.find(p => p.label === "IPE 200")!;
  check("an IPE is narrower than it is deep", ipe200.width < ipe200.depth);
  check("the beam default is HEA 200", BEAM_DEFAULT.width === hea200.width && BEAM_DEFAULT.depth === hea200.depth);
}

/* ── the column ── */

{
  const c = column({ width: 300, depth: 200 });
  const b = columnBox(c);
  check("the anchor is the centre of the section", b.x0 === -150 && b.x1 === 150 && b.y0 === -100 && b.y1 === 100);
  const r = columnBox(column({ shape: "round", width: 300, depth: 900 }));
  check("a round column's box ignores its stored depth", r.y0 === -150 && r.y1 === 150);

  const rect = columnProfile("rect", 300, 200);
  check("a rectangle is four corners", rect.length === 4);
  const h = columnProfile("h", 200, 190);
  check("an H-section is twelve corners", h.length === 12);
  check("the H's flanges span the full breadth", h.every(p => Math.abs(p.x) <= 100) && h.some(p => p.x === 100 && p.y === -95));
  check("the H has a web between the flanges", h.some(p => Math.abs(p.x) < 20 && Math.abs(p.y) < 95));
  const rd = columnProfile("round", 300, 0);
  check("a round column is a polygon on its diameter",
    rd.length >= 16 && rd.every(p => near(Math.hypot(p.x, p.y), 150)));

  const turned = column({ width: 400, depth: 200, x: 1000, y: 1000, rotation: Math.PI / 2 });
  const corners = structureCorners(turned);
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  check("a quarter-turned column's width lies along y",
    near(Math.max(...xs) - Math.min(...xs), 200) && near(Math.max(...ys) - Math.min(...ys), 400));
  check("the outline is drawn in world millimetres",
    columnOutline(turned).every(p => Math.abs(p.x - 1000) <= 100.001 && Math.abs(p.y - 1000) <= 200.001));

  check("a hit inside the section counts", structureHit(c, v(140, 90)));
  check("a hit outside does not", !structureHit(c, v(160, 0)));
  check("the grab margin reaches past the edge", structureHit(c, v(160, 0), 30));

  const f = emptyDoc().floors[0]!;
  check("a column reaches the storey unless it says otherwise", columnHeight(f, c) === floorHeight(f));
  check("a stated height wins", columnHeight(f, column({ height: 900 })) === 900);
}

/* ── the spans ── */

{
  const b = beam({ a: v(1000, 1000), b: v(4000, 1000) });
  check("a beam is a span", isSpan(b) && !isSpan(column()));
  check("the run is measured between its ends", spanLength(b) === 3000);
  const p = spanPlaced(b);
  check("a span is placed at its midpoint", p.x === 2500 && p.y === 1000 && near(p.rotation, 0));
  const box = spanBox(b);
  check("the box is the run by the breadth", box.x0 === -1500 && box.x1 === 1500 && box.y0 === -100 && box.y1 === 100);

  const diag = beam({ a: v(0, 0), b: v(3000, 3000) });
  check("a diagonal run is turned to its direction", near(spanPlaced(diag).rotation, Math.PI / 4));
  const q = spanQuad(diag);
  check("the quad has four corners on the run's sides",
    q.length === 4 && q.every(c => near(Math.abs((c.x - c.y) / Math.SQRT2), 100, 1e-6)));

  const t = spanTurned(b, Math.PI / 2);
  check("a quarter turn stands the run up about its midpoint",
    t.a.x === 2500 && t.a.y === -500 && t.b.x === 2500 && t.b.y === 2500, JSON.stringify(t));
  check("turned ends are whole millimetres",
    Number.isInteger(spanTurned(diag, 0.3).a.x) && Number.isInteger(spanTurned(diag, 0.3).b.y));
  check("a full turn comes back where it was",
    nearVec(spanTurned(b, Math.PI * 2).a, b.a) && nearVec(spanTurned(b, Math.PI * 2).b, b.b));

  check("a hit on the run counts", structureHit(b, v(2000, 1050)));
  check("a hit beside it does not", !structureHit(b, v(2000, 1200)));
  check("a hit past the end does not", !structureHit(b, v(4100, 1000)));

  const f = emptyDoc().floors[0]!;
  check("a beam carries the floor above unless it says otherwise",
    beamTop(f, b) === floorHeight(f) && beamBottom(f, b) === floorHeight(f) - b.depth);
  const low = beam({ bottomMm: 2100 });
  check("a stated underside wins", beamBottom(f, low) === 2100 && beamTop(f, low) === 2100 + low.depth);
}

{
  const r = railing({ a: v(0, 0), b: v(2400, 0), postMm: 1000 });
  const posts = railingPosts(r);
  check("posts stand at both ends", posts.length >= 2 && nearVec(posts[0]!, r.a) && nearVec(posts[posts.length - 1]!, r.b));
  check("bays are no wider than the spacing", posts.length === 4);
  const bays = posts.slice(1).map((p, i) => dist(posts[i]!, p));
  check("bays are equal", bays.every(w => near(w, 800)), JSON.stringify(bays));
  check("an exact division gives exact bays", railingPosts(railing({ b: v(3000, 0) })).length === 4);
  check("no spacing means no posts", railingPosts(railing({ postMm: 0 })).length === 0);
  check("a spacing wider than the run still gives the two end posts",
    railingPosts(railing({ b: v(500, 0), postMm: 1000 })).length === 2);
}

/* ── moving and turning ── */

{
  const c = column({ x: 100, y: 200 });
  moveStructure(c, 50, -25);
  check("a column moves by its centre", c.x === 150 && c.y === 175);
  const b = beam({ a: v(0, 0), b: v(3000, 0) });
  moveStructure(b, 10, 20);
  check("a span moves both ends", b.a.x === 10 && b.a.y === 20 && b.b.x === 3010 && b.b.y === 20);
}

/* ── the label ── */

{
  const c = column({ width: 300, depth: 300 });
  const at = structureLabelAt(c);
  check("a column's label sits under it", at.x === 0 && at.y > 150);
  const b = beam({ a: v(0, 0), b: v(3000, 0), label: "HEA 200" });
  const bl = structureLabelAt(b);
  check("a span's label sits beside its midpoint on the clockwise side", bl.x === 1500 && bl.y > 100, JSON.stringify(bl));
  // Upright text beside a vertical run: the run is at x = 1000, 200 wide, so
  // the text's near edge has to stay left of 900.
  const up = beam({ a: v(1000, 0), b: v(1000, 3000), width: 200, label: "HEA 200" });
  const ul = structureLabelAt(up);
  const halfText = 150 * 0.6 * "HEA 200".length / 2;
  check("beside a vertical run the label clears the run by half its width",
    ul.y === 1500 && ul.x + halfText < 900, JSON.stringify(ul));
  const unlabelled = structureLabelAt(beam({ a: v(1000, 0), b: v(1000, 3000) }));
  check("an unlabelled span still has a position", Number.isFinite(unlabelled.x));
}

/* ── the marks ── */

{
  const prims = structurePrims(column({ shape: "h", width: 200, depth: 190, x: 1000, y: 1000, label: "HEA 200" }));
  check("a column draws", prims.length > 0);
  check("it carries its designation", prims.some(p => p.kind === "text" && p.text === "HEA 200"));
  const pts = points(prims.filter(p => p.kind !== "text"));
  check("the section is drawn about the anchor",
    pts.every(p => Math.abs(p.x - 1000) <= 100.5 && Math.abs(p.y - 1000) <= 95.5));
  check("an unlabelled column writes nothing", !structurePrims(column()).some(p => p.kind === "text"));

  const rd = structurePrims(column({ shape: "round", width: 300, depth: 300 }));
  check("a round column is a closed ring in the export",
    points(rd).length >= 12 && points(rd).every(p => near(Math.hypot(p.x, p.y), 150, 1)));

  const bp = structurePrims(beam({ a: v(0, 0), b: v(3000, 0), width: 200 }));
  const bpts = points(bp);
  check("a beam draws its outline along the run",
    bpts.some(p => near(p.x, 0, 1) && near(p.y, -100, 1)) && bpts.some(p => near(p.x, 3000, 1) && near(p.y, 100, 1)),
    JSON.stringify(bpts.slice(0, 4)));

  const rp = structurePrims(railing({ a: v(0, 0), b: v(2000, 0), postMm: 1000 }));
  const rpts = points(rp);
  check("a railing draws its posts",
    rpts.some(p => near(p.x, 1000, 1)) && rpts.some(p => near(p.x, 0, 1)) && rpts.some(p => near(p.x, 2000, 1)));
}

/* ── the half wall's pen ── */

{
  const cut = wallPen({ color: undefined, material: undefined, height: undefined });
  const low = wallPen({ color: undefined, material: undefined, height: 900 });
  check("a full wall takes poché", !cut.infill && cut.fill !== COLORS.bg);
  check("a wall below the section plane is outlined on the paper colour", low.infill && low.fill === COLORS.bg);
  const red = wallPen({ color: "#d0342c", material: undefined, height: 900 });
  check("a coloured borstwering keeps its ink on the line", red.stroke === "#d0342c" && red.fill !== "#d0342c");
  const col = wallPen({ color: "#d0342c", material: "steel" });
  check("a column takes the wall pen: poché in its ink", col.fill === "#d0342c" && !col.infill);
}

/* ── the storey ── */

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.height = 2600;
  f.structure = [
    column({ id: "c1", x: 500, y: 500, material: "steel" }),
    beam({ id: "b1", a: v(0, 2000), b: v(4000, 2000) }),
    railing({ id: "r1", a: v(0, 3000), b: v(2000, 3000), height: 1000 }),
  ];
  check("a floor's structure reads back", structureOf(f).length === 3);
  check("an absent list is not an error", structureOf({ ...f, structure: undefined }).length === 0);

  const solids = structureSolids(f);
  check("one solid per element", solids.length === 3);
  const [cs, bs, rs] = solids as [ReturnType<typeof structureSolid>, ReturnType<typeof structureSolid>, ReturnType<typeof structureSolid>];
  check("a column stands from the floor to the storey", cs.z0 === 0 && cs.z1 === 2600);
  check("it keeps its material", cs.material === "steel");
  check("a beam hangs under the floor above", bs.z1 === 2600 && bs.z0 === 2600 - BEAM_DEFAULT.depth);
  check("a railing stands to its guarding height", rs.z0 === 0 && rs.z1 === 1000);
  check("an element with no material states none", !("material" in bs));
  check("a low column stops where it says", structureSolid(f, column({ height: 1100 })).z1 === 1100);

  const bounds = planBounds(f, resolveFloor(f))!;
  check("the crop takes the structure in",
    bounds !== null && bounds.min.x <= 0 && bounds.max.x >= 4000 && bounds.max.y >= 3000, JSON.stringify(bounds));

  const dxf = toDxf(doc) ?? "";
  check("a plan of nothing but structure still exports to DXF", dxf.length > 0);
  check("each kind gets its own DXF layer",
    dxf.includes("COLUMNS") && dxf.includes("BEAMS") && dxf.includes("RAILINGS"));

  const svg = toSvg(doc) ?? "";
  check("structure gets its own SVG group", svg.includes('id="structure"'));
  const group = svg.split('id="structure"')[1] ?? "";
  check("a beam is dashed in the SVG", /stroke-dasharray="120[ ,]80"/.test(group), group.slice(0, 300));

  const ifc = toIfc(doc, 0);
  check("a column is an IFCCOLUMN", ifc.includes("IFCCOLUMN("));
  check("a beam is an IFCBEAM", ifc.includes("IFCBEAM("));
  check("a railing is an IFCRAILING", ifc.includes("IFCRAILING("));
  check("a beam states its span", ifc.includes("'Span'") && ifc.includes("IFCPOSITIVELENGTHMEASURE(4000"));
  check("the steel column joins a material association", ifc.includes("IFCMATERIAL('Steel'"));

  const mesh = buildSceneMesh(doc);
  check("structure alone builds a 3D scene", mesh.positions.length > 0);
  const zs: number[] = [];
  for (let i = 2; i < mesh.positions.length; i += 3) zs.push(mesh.positions[i]!);
  check("the scene reaches the storey height", Math.max(...zs) >= 2600 - 10.5 && Math.min(...zs) <= 0.5);
}

/* ── selection ── */

{
  const f = emptyDoc().floors[0]!;
  f.structure = [
    column({ id: "c1", x: 500, y: 500 }),
    beam({ id: "b1", a: v(2000, 0), b: v(5000, 0) }),
  ];
  const pick = marqueePick(f, { min: v(0, 0), max: v(1000, 1000) });
  check("a marquee around a column picks it", pick?.kind === "structure" && pick.ids.length === 1 && pick.ids[0] === "c1");
  const half = marqueePick(f, { min: v(1500, -500), max: v(3000, 500) });
  check("a marquee across half a beam does not take it", half === null || !half.ids.includes("b1"));
  const both = marqueePick(f, { min: v(-100, -500), max: v(6000, 1000) });
  check("a marquee around both takes both", both?.kind === "structure" && both.ids.length === 2);

  const made = cloneOnFloor(f, "structure", ["b1"]);
  check("a copy is a new element", made.size === 1 && structureOf(f).length === 3);
  const copy = structureOf(f).find(el => el.id === made.get("b1"))! as Beam;
  const orig = structureOf(f).find(el => el.id === "b1")! as Beam;
  moveStructure(copy, 100, 100);
  check("the copy's ends are its own", orig.a.x === 2000 && copy.a.x === 2100);
}

/* ── the published format ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.structure = [
    column({ id: "c1", shape: "h", width: 200, depth: 190, height: 2100, label: "HEA 200", material: "steel", color: "#d0342c" }),
    beam({ id: "b1", bottomMm: 2200 }),
    railing({ id: "r1" }),
  ];
  check("a document with structure validates", validate(schema, doc).length === 0, validate(schema, doc).join(" | "));

  type Loose = { floors: { structure: Record<string, unknown>[] }[] };
  const clone = (): Loose => JSON.parse(JSON.stringify(doc)) as Loose;
  const noKind = clone();
  delete noKind.floors[0]!.structure[0]!.kind;
  check("an element without a kind is rejected", validate(schema, noKind).length > 0);

  const mixed = clone();
  mixed.floors[0]!.structure[1]!.postMm = 1000;
  check("a beam with a railing's field is rejected", validate(schema, mixed).length > 0);

  const short = clone();
  short.floors[0]!.structure[0]!.width = 1;
  check("a section below the range is rejected", validate(schema, short).length > 0);

  const badShape = clone();
  badShape.floors[0]!.structure[0]!.shape = "oval";
  check("an unknown column shape is rejected", validate(schema, badShape).length > 0);

  const noEnd = clone();
  delete noEnd.floors[0]!.structure[2]!.b;
  check("a railing without its far end is rejected", validate(schema, noEnd).length > 0);

  const bare = emptyDoc();
  delete bare.floors[0]!.structure;
  check("a storey without structure validates", validate(schema, bare).length === 0);
}

/* ── the words ── */

for (const lng of ["nl", "en"] as const) {
  const dict = (resources[lng].translation as unknown) as Record<string, Record<string, string>>;
  const tool = dict.tool ?? {}, panel = dict.panel ?? {}, hint = dict.hint ?? {};
  check(`${lng}: the tool is named`, typeof tool.structure === "string" && typeof tool.shortStructure === "string");
  check(`${lng}: every kind has a name`,
    ["structureColumn", "structureBeam", "structureRailing", "structureVide"].every(k => typeof panel[k] === "string"));
  check(`${lng}: the span hints name the kind`,
    (hint.structureSpan ?? "").includes("{{label}}") && (hint.structureSpanTo ?? "").includes("{{label}}"));
}

console.log(failures === 0 ? "ALL STRUCTURE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
