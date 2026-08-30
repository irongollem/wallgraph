// Cabinet tests.
//
// A cabinet is a parametric document object, so the things worth holding are
// the ones that would drift silently: that every drawn mark lands inside the
// footprint the hit-test, the crop and the selection frame all trust; that the
// named presets stay in step with the fields they write and with both
// translation dictionaries; and that a placed unit survives the document
// schema and both vector exports.
import {
  Cabinet, CabinetSpec, CABINET_PRESETS, CABINET_KINDS, CABINET_FRONTS, CABINET_WIDTHS,
  CABINET_DEPTHS, cabinetDefaults, cabinetPreset, cabinetPresetOf, cabinetHinge,
  cabinetHeight, cabinetDrawers, cabinetOverhead, clampCabinet, nearestModule,
} from "../src/model/cabinet";
import {
  cabinetBox, cabinetCorners, cabinetHit, cabinetOutline, cabinetFront,
  cabinetFrontBand, cabinetHingeMarks, cabinetDrawerLines, cabinetWorktopEdge,
  cabinetLabelAt, cornerCut,
} from "../src/core/cabinet";
import { turnAbout } from "../src/core/placed";
import { cabinetPrims } from "../src/io/cabinet";
import { Prim } from "../src/io/record";
import { Vec, v } from "../src/geometry/vec";
import { emptyDoc, cabinetsOf, newId } from "../src/model/doc";
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

const mk = (over: Partial<Cabinet> = {}): Cabinet => ({
  id: "k1", kind: "base", x: 0, y: 0, rotation: 0,
  width: 600, depth: 600, front: "door", ...over,
});

const specOf = (p: CabinetSpec): CabinetSpec => ({ ...p });

function points(prims: Prim[]): Vec[] {
  const out: Vec[] = [];
  for (const p of prims) {
    if (p.kind === "line") out.push(p.a, p.b);
    else if (p.kind === "poly") out.push(...p.pts);
    else if (p.kind === "text") out.push(p.at);
    else if (p.kind === "arc") out.push(v(p.c.x - p.r, p.c.y - p.r), v(p.c.x + p.r, p.c.y + p.r));
  }
  return out;
}

/* ── geometry ── */

{
  const c = mk();
  const b = cabinetBox(c);
  // The wall-mounted footprint the symbol library uses: x symmetric about the
  // anchor, y running one way only, into the room.
  check("the anchor is the middle of the wall-touching edge",
    b.x0 === -300 && b.x1 === 300 && b.y0 === 0 && b.y1 === 600, JSON.stringify(b));
  check("a point inside hits", cabinetHit(c, v(0, 300)) && cabinetHit(c, v(-290, 10)));
  check("a point on the room side of the front misses", !cabinetHit(c, v(0, 700)));
  check("a point behind the wall edge misses", !cabinetHit(c, v(0, -50)));
  check("the grab margin extends the carcass", cabinetHit(c, v(0, 620), 30));

  const turned = mk({ rotation: Math.PI / 2 });
  check("the hit-test follows the rotation",
    cabinetHit(turned, v(-300, 0)) && !cabinetHit(turned, v(300, 0)),
    JSON.stringify(cabinetCorners(turned)));
}

{
  // A unit is anchored to the edge that meets the wall, so a turn about the
  // anchor would swing it a full depth across the room.
  const middle = (c: Cabinet): Vec => {
    const cs = cabinetCorners(c);
    return v(cs.reduce((a, q) => a + q.x, 0) / cs.length, cs.reduce((a, q) => a + q.y, 0) / cs.length);
  };
  const c = mk({ x: 2000, y: -500 });
  const before = middle(c);
  for (const angle of [Math.PI / 2, Math.PI, 2.4]) {
    const t: Cabinet = { ...c, ...turnAbout(c, cabinetBox(c), angle), rotation: angle };
    const after = middle(t);
    check(`a unit turned to ${angle.toFixed(2)} rad stays where it was`,
      Math.hypot(after.x - before.x, after.y - before.y) <= 1,
      `${Math.round(after.x - before.x)},${Math.round(after.y - before.y)}`);
    check(`a turned unit keeps whole millimetres`, Number.isInteger(t.x) && Number.isInteger(t.y));
  }
}

{
  // Everything drawn has to stay inside the box the crop and the selection
  // frame use, or a unit exports cropped and selects a frame that misses it.
  for (const kind of CABINET_KINDS) {
    for (const front of CABINET_FRONTS) {
      for (const corner of [false, true]) {
        const d = cabinetDefaults(kind);
        const c = mk({
          kind, front, depth: d.depth, height: d.height,
          worktop: true, drawers: 4, ...(corner ? { corner: true, depth: 600 } : {}),
        });
        const b = cabinetBox(c);
        // The worktop oversails the front on purpose; that is the one mark
        // allowed past the carcass, and by no more than its overhang.
        const slack = 25;
        const out = points(cabinetPrims({ ...c, x: 0, y: 0, rotation: 0 }))
          .filter(p => p.x < b.x0 - slack || p.x > b.x1 + slack
                    || p.y < b.y0 - slack || p.y > b.y1 + slack);
        check(`${kind}/${front}${corner ? "/corner" : ""} draws inside its footprint`,
          out.length === 0, JSON.stringify(out.slice(0, 2)));
      }
    }
  }
}

{
  const c = mk({ corner: true, width: 900, depth: 900 });
  check("a corner unit cuts the room-facing corner", cabinetOutline(c).length === 5,
    String(cabinetOutline(c).length));
  check("a straight unit is a rectangle", cabinetOutline(mk()).length === 4);
  check("the corner cut is half the smaller dimension", cornerCut(c) === 450, String(cornerCut(c)));
  const [p, q] = cabinetFront(c);
  check("the corner front is the diagonal", p.x !== q.x && p.y !== q.y, JSON.stringify([p, q]));
  const [sp, sq] = cabinetFront(mk());
  check("a straight front runs along the room edge", sp.y === sq.y && sp.y === 600);
}

{
  // The front band is pushed INTO the carcass, never out of it.
  const band = cabinetFrontBand(mk());
  check("the front band lies inside the carcass",
    band.every(p => p.y <= 600 && p.y >= 580), JSON.stringify(band));
  // The worktop edge is pushed the other way: a blad oversails.
  const [wa] = cabinetWorktopEdge(mk({ worktop: true }));
  check("the worktop oversails the front", wa.y > 600, String(wa.y));
}

{
  const left = cabinetHingeMarks(mk({ hinge: "left" }));
  const right = cabinetHingeMarks(mk({ hinge: "right" }));
  check("a single door draws one hinge mark", left.length === 1 && right.length === 1);
  // Left is the viewer's left standing in the room, which is local -x.
  check("the hinge mark starts at the hung end",
    left[0]![0]!.x < 0 && right[0]![0]!.x > 0,
    `${left[0]![0]!.x} / ${right[0]![0]!.x}`);
  check("a pair of doors draws two marks", cabinetHingeMarks(mk({ front: "double" })).length === 2);
  check("an open unit draws none", cabinetHingeMarks(mk({ front: "open" })).length === 0);
  check("drawers draw no hinge mark", cabinetHingeMarks(mk({ front: "drawers" })).length === 0);
}

{
  check("a drawer front is divided once per drawer",
    cabinetDrawerLines(mk({ front: "drawers", drawers: 3 })).length === 2,
    String(cabinetDrawerLines(mk({ front: "drawers", drawers: 3 })).length));
  check("one drawer needs no division",
    cabinetDrawerLines(mk({ front: "drawers", drawers: 1 })).length === 0);
  check("a door has no drawer lines", cabinetDrawerLines(mk()).length === 0);
  check("the drawer count is bounded", cabinetDrawers(mk({ drawers: 99 })) === 8);
}

{
  const c = mk({ x: 1000, y: 500 });
  const at = cabinetLabelAt(c);
  check("the label sits in the middle of the carcass",
    at.x === 1000 && at.y === 800, JSON.stringify(at));
}

/* ── the model ── */

{
  check("a wall unit is overhead", cabinetOverhead(mk({ kind: "wall" })));
  check("base and tall units are not",
    !cabinetOverhead(mk({ kind: "base" })) && !cabinetOverhead(mk({ kind: "tall" })));
  check("the hinge defaults to left", cabinetHinge(mk()) === "left");
  check("the height defaults from the class",
    cabinetHeight(mk({ kind: "wall" })) === 700 && cabinetHeight(mk({ kind: "tall" })) === 2000,
    `${cabinetHeight(mk({ kind: "wall" }))} / ${cabinetHeight(mk({ kind: "tall" }))}`);
  check("a stated height wins", cabinetHeight(mk({ height: 1234 })) === 1234);
  check("a base unit carries a worktop by default", cabinetDefaults("base").worktop);
  check("a wall unit does not", !cabinetDefaults("wall").worktop);
}

{
  const clamped = clampCabinet({ ...cabinetDefaults("base"), width: 9e9, depth: -5, drawers: 0 });
  check("dimensions clamp to what can be built",
    clamped.width === 3000 && clamped.depth === 100 && clamped.drawers === 1,
    JSON.stringify(clamped));
  check("dimensions round to whole millimetres",
    Number.isInteger(clampCabinet({ ...cabinetDefaults("base"), width: 601.7 }).width));
  check("a module width is the nearest step",
    nearestModule(580) === 600 && nearestModule(410) === 400 && nearestModule(1e6) === 1200,
    `${nearestModule(580)} / ${nearestModule(410)}`);
}

{
  // The presets are what the builder asked for: named units at stock sizes.
  check("every preset is a stock module width",
    CABINET_PRESETS.every(p => CABINET_WIDTHS.includes(p.width)),
    CABINET_PRESETS.filter(p => !CABINET_WIDTHS.includes(p.width)).map(p => p.id).join(", "));
  check("a straight preset uses a depth its height class offers",
    CABINET_PRESETS.every(p => p.corner || CABINET_DEPTHS[p.kind].includes(p.depth)),
    CABINET_PRESETS.filter(p => !p.corner && !CABINET_DEPTHS[p.kind].includes(p.depth))
      .map(p => `${p.id}:${p.depth}`).join(", "));
  check("the kitchen sizes the feedback asked for are offered",
    [400, 600, 800].every(w => CABINET_WIDTHS.includes(w)));
  check("preset ids are unique",
    new Set(CABINET_PRESETS.map(p => p.id)).size === CABINET_PRESETS.length);
  check("a preset resolves by id", cabinetPreset("onderkast")?.kind === "base");
  check("an unknown preset resolves to nothing", cabinetPreset("nope") === undefined);
}

{
  // Round trip: a cabinet built from a preset reads back as that preset.
  for (const p of CABINET_PRESETS) {
    const { id, ...spec } = specOf(p) as CabinetSpec & { id?: string };
    void id;
    const c = mk({
      kind: spec.kind, width: spec.width, depth: spec.depth, front: spec.front,
      ...(spec.corner ? { corner: true } : {}),
      ...(spec.worktop ? { worktop: true } : {}),
    });
    check(`${p.id} reads back as itself`, cabinetPresetOf(c)?.id === p.id,
      String(cabinetPresetOf(c)?.id));
  }
  // The hinge side is a tuning, not an identity: a unit hung the other way is
  // still the same unit, the way doorKindOf() ignores which jamb hangs a leaf.
  check("the hinge side does not change what a unit is",
    cabinetPresetOf(mk({ hinge: "right", worktop: true }))?.id === "onderkast",
    String(cabinetPresetOf(mk({ hinge: "right", worktop: true }))?.id));
  check("a tuned size is custom", cabinetPresetOf(mk({ width: 550 })) === null);
}

/* ── the document ── */

{
  const doc = emptyDoc(), floor = doc.floors[0]!;
  check("a floor with no cabinets reads back empty", cabinetsOf({ ...floor, cabinets: undefined }).length === 0);
  floor.cabinets = [mk({ id: newId("k") })];
  check("a floor's cabinets read back", cabinetsOf(floor).length === 1);

  const errs = validate(planSchema(""), doc);
  check("a document with a cabinet validates", errs.length === 0, errs.join(" | "));

  const bad = JSON.parse(JSON.stringify(doc));
  bad.floors[0].cabinets[0].kind = "floating";
  check("an unknown height class is rejected", validate(planSchema(""), bad).length > 0);

  const bad2 = JSON.parse(JSON.stringify(doc));
  delete bad2.floors[0].cabinets[0].front;
  check("a cabinet without a front is rejected", validate(planSchema(""), bad2).length > 0);

  const bad3 = JSON.parse(JSON.stringify(doc));
  bad3.floors[0].cabinets[0].shelves = 3;
  check("an unknown cabinet property is rejected", validate(planSchema(""), bad3).length > 0);
}

{
  // A plan of nothing but a cabinet still frames and still exports: planBounds
  // walks the carcass corners, so the crop is not empty.
  const doc = emptyDoc(), floor = doc.floors[0]!;
  floor.cabinets = [mk({ id: newId("k"), x: 2000, y: 1000 })];
  const b = planBounds(floor, resolveFloor(floor));
  check("a cabinet alone gives the crop something to frame", b !== null);
  check("the crop covers the carcass",
    !!b && b.min.x <= 1700 && b.max.y >= 1600, JSON.stringify(b));

  const dxf = toDxf(doc);
  check("a plan of nothing but a cabinet still exports", dxf !== null);
  check("cabinets get their own DXF layer", !!dxf && dxf.includes("CABINETS"));
  const svg = toSvg(doc);
  check("cabinets get their own SVG group", !!svg && svg.includes('id="cabinets"'));

  // A wall unit is overhead work: the layer says so in DXF, the dash in SVG.
  const over = emptyDoc();
  over.floors[0]!.cabinets = [mk({ id: newId("k"), kind: "wall", depth: 350 })];
  check("a wall unit lands on the overhead layer",
    (toDxf(over) ?? "").includes("CABINETS-OVERHEAD"));
  check("a wall unit is dashed in SVG",
    (toSvg(over) ?? "").includes("stroke-dasharray"));
}

/* ── names ── */

for (const lng of ["nl", "en"] as const) {
  const dict = (resources[lng].translation as unknown as Record<string, Record<string, string>>).cabinet ?? {};
  const missing = CABINET_PRESETS.filter(p => typeof dict[p.id] !== "string").map(p => p.id);
  check(`every preset has a ${lng} name`, missing.length === 0, missing.join(", "));
  const stale = Object.keys(dict).filter(k => !CABINET_PRESETS.some(p => p.id === k));
  check(`no ${lng} names for removed presets`, stale.length === 0, stale.join(", "));

  const kinds = (resources[lng].translation as unknown as Record<string, Record<string, string>>).cabinetKind ?? {};
  check(`every height class has a ${lng} name`,
    CABINET_KINDS.every(k => typeof kinds[k] === "string"));
  const fronts = (resources[lng].translation as unknown as Record<string, Record<string, string>>).cabinetFront ?? {};
  check(`every front has a ${lng} name`,
    CABINET_FRONTS.every(f => typeof fronts[f] === "string"));
}

console.log(`${CABINET_PRESETS.length} cabinet presets, ${CABINET_WIDTHS.length} module widths`);
console.log(failures === 0 ? "ALL CABINET TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
