// Furnishing tests.
//
// A furnishing is a parametric document object, so the things worth holding are
// the ones that would drift silently: that every drawn mark lands inside the
// footprint the hit-test, the crop and the selection frame all trust; that the
// named presets stay in step with the fields they write and with both
// translation dictionaries; that a form only stores the fields it reads; and
// that a placed piece survives the document schema and both vector exports.
import {
  Furnishing, FurnishingSpec, FurnishingForm, FURNISHING_FORMS, FURNISHING_PRESETS,
  FURNISHING_GROUPS, CABINET_KINDS, CABINET_FRONTS, CABINET_WIDTHS, CABINET_DEPTHS,
  APPLIANCE_MARKS, TOILET_CISTERNS, SHOWER_TRAYS, FORM_WIDTHS,
  cabinetDefaults, furnishingDefaults, furnishingPreset, furnishingPresetOf,
  furnishingHinge, furnishingHeight, furnishingDrawers, furnishingOverhead,
  furnishingWallMounted, furnishingClass, furnishingSpecOf, bedPlaces, rackBays,
  clampFurnishing, writeSpec, nearestModule,
} from "../src/model/furnishing";
import {
  furnishingBox, furnishingCorners, furnishingHit, cabinetOutline, cabinetFront,
  cabinetFrontBand, cabinetHingeMarks, cabinetDrawerLines, cabinetWorktopEdge,
  furnishingLabelAt, cornerCut,
} from "../src/core/furnishing";
import { turnAbout } from "../src/core/placed";
import { furnishingPrims } from "../src/io/furnishing";
import { Prim } from "../src/io/record";
import { Vec, v } from "../src/geometry/vec";
import { emptyDoc, furnishingsOf, newId } from "../src/model/doc";
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

const mk = (over: Partial<Furnishing> = {}): Furnishing => ({
  id: "i1", form: "cabinet", kind: "base", x: 0, y: 0, rotation: 0,
  width: 600, depth: 600, front: "door", ...over,
});

/** A furnishing built from a specification, the way the tool and seed do. */
function fromSpec(spec: FurnishingSpec, over: Partial<Furnishing> = {}): Furnishing {
  const f: Furnishing = {
    id: "i1", form: spec.form, x: 0, y: 0, rotation: 0,
    width: spec.width, depth: spec.depth,
  };
  writeSpec(f, spec);
  return { ...f, ...over };
}

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
  const b = furnishingBox(c);
  // The wall-mounted footprint the symbol library uses: x symmetric about the
  // anchor, y running one way only, into the room.
  check("a wall-mounted anchor is the middle of the wall-touching edge",
    b.x0 === -300 && b.x1 === 300 && b.y0 === 0 && b.y1 === 600, JSON.stringify(b));
  check("a point inside hits", furnishingHit(c, v(0, 300)) && furnishingHit(c, v(-290, 10)));
  check("a point on the room side of the front misses", !furnishingHit(c, v(0, 700)));
  check("a point behind the wall edge misses", !furnishingHit(c, v(0, -50)));
  check("the grab margin extends the carcass", furnishingHit(c, v(0, 620), 30));

  // A free-standing piece is anchored at the middle of its footprint instead.
  const table = mk({ form: "table", width: 1600, depth: 900 });
  const tb = furnishingBox(table);
  check("a free-standing anchor is the middle of the footprint",
    tb.x0 === -800 && tb.x1 === 800 && tb.y0 === -450 && tb.y1 === 450, JSON.stringify(tb));
  check("a free-standing piece is hit on both sides of its anchor",
    furnishingHit(table, v(0, -400)) && furnishingHit(table, v(0, 400)));

  const turned = mk({ rotation: Math.PI / 2 });
  check("the hit-test follows the rotation",
    furnishingHit(turned, v(-300, 0)) && !furnishingHit(turned, v(300, 0)),
    JSON.stringify(furnishingCorners(turned)));
}

{
  // A wall-mounted piece is anchored to the edge that meets the wall, so a turn
  // about the anchor would swing it a full depth across the room.
  const middle = (c: Furnishing): Vec => {
    const cs = furnishingCorners(c);
    return v(cs.reduce((a, q) => a + q.x, 0) / cs.length, cs.reduce((a, q) => a + q.y, 0) / cs.length);
  };
  const c = mk({ x: 2000, y: -500 });
  const before = middle(c);
  for (const angle of [Math.PI / 2, Math.PI, 2.4]) {
    const t: Furnishing = { ...c, ...turnAbout(c, furnishingBox(c), angle), rotation: angle };
    const after = middle(t);
    check(`a piece turned to ${angle.toFixed(2)} rad stays where it was`,
      Math.hypot(after.x - before.x, after.y - before.y) <= 1,
      `${Math.round(after.x - before.x)},${Math.round(after.y - before.y)}`);
    check(`a turned piece keeps whole millimetres`, Number.isInteger(t.x) && Number.isInteger(t.y));
  }
}

{
  // Everything drawn has to stay inside the box the crop and the selection
  // frame use, or a piece exports cropped and selects a frame that misses it.
  // The slack is what two marks are allowed past the carcass on purpose: the
  // toestel's connection stub reaches into the wall, and a worktop oversails.
  const slack = 80;
  const outside = (c: Furnishing): Vec[] => {
    const b = furnishingBox(c);
    return points(furnishingPrims({ ...c, x: 0, y: 0, rotation: 0 }))
      .filter(p => p.x < b.x0 - slack || p.x > b.x1 + slack
                || p.y < b.y0 - slack || p.y > b.y1 + slack);
  };

  for (const kind of CABINET_KINDS) {
    for (const front of CABINET_FRONTS) {
      for (const corner of [false, true]) {
        const d = cabinetDefaults(kind);
        const c = mk({
          kind, front, depth: d.depth, height: d.height,
          worktop: true, drawers: 4, ...(corner ? { corner: true, depth: 600 } : {}),
        });
        const out = outside(c);
        check(`${kind}/${front}${corner ? "/corner" : ""} draws inside its footprint`,
          out.length === 0, JSON.stringify(out.slice(0, 2)));
      }
    }
  }

  // Every named piece, at the size it is placed at.
  for (const p of FURNISHING_PRESETS) {
    const { id: _id, group: _group, ...spec } = p;
    const out = outside(fromSpec(spec));
    check(`${p.id} draws inside its footprint`, out.length === 0, JSON.stringify(out.slice(0, 2)));
  }

  // And every form resized well away from its default, since the marks are
  // written as fractions of the stored size rather than in millimetres.
  for (const form of FURNISHING_FORMS) {
    for (const [w, d] of [[300, 300], [2400, 1200]] as const) {
      const c = fromSpec({ ...furnishingDefaults(form), width: w, depth: d });
      const out = outside(c);
      check(`${form} at ${w}x${d} draws inside its footprint`,
        out.length === 0, JSON.stringify(out.slice(0, 2)));
    }
  }

  // A mark that draws nothing would pass the test above trivially.
  for (const form of FURNISHING_FORMS) {
    const drawn = points(furnishingPrims(fromSpec(furnishingDefaults(form))));
    check(`${form} draws something`, drawn.length > 2, String(drawn.length));
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
  check("the drawer count is bounded", furnishingDrawers(mk({ drawers: 99 })) === 8);
}

{
  const c = mk({ x: 1000, y: 500 });
  const at = furnishingLabelAt(c);
  check("the label sits in the middle of a wall-mounted piece",
    at.x === 1000 && at.y === 800, JSON.stringify(at));
  const free = mk({ form: "bed", width: 1600, depth: 2000, x: 1000, y: 500 });
  const freeAt = furnishingLabelAt(free);
  check("and on the anchor of a free-standing one",
    freeAt.x === 1000 && freeAt.y === 500, JSON.stringify(freeAt));
}

/* ── the model ── */

{
  check("a wall unit is overhead", furnishingOverhead(mk({ kind: "wall" })));
  check("base and tall units are not",
    !furnishingOverhead(mk({ kind: "base" })) && !furnishingOverhead(mk({ kind: "tall" })));
  // An afzuigkap hangs over the worktop, so it is overhead work too.
  check("an extractor hood is overhead",
    furnishingOverhead(mk({ form: "appliance", mark: "hood" })));
  check("another appliance is not",
    !furnishingOverhead(mk({ form: "appliance", mark: "fridge" })));
  check("the hinge defaults to left", furnishingHinge(mk()) === "left");
  check("the height defaults from the class",
    furnishingHeight(mk({ kind: "wall" })) === 700 && furnishingHeight(mk({ kind: "tall" })) === 2000,
    `${furnishingHeight(mk({ kind: "wall" }))} / ${furnishingHeight(mk({ kind: "tall" }))}`);
  check("and from the form for everything else",
    furnishingHeight(mk({ form: "table" })) === 750, String(furnishingHeight(mk({ form: "table" }))));
  check("a stated height wins", furnishingHeight(mk({ height: 1234 })) === 1234);
  check("a base unit carries a worktop by default", cabinetDefaults("base").worktop);
  check("a wall unit does not", !cabinetDefaults("wall").worktop);
}

{
  // Counts read off the size rather than stored, so a resize cannot leave a
  // stale field behind.
  check("a narrow bed is made up for one", bedPlaces(mk({ form: "bed", width: 900 })) === 1);
  check("a wide bed for two", bedPlaces(mk({ form: "bed", width: 1600 })) === 2);
  check("a rack is divided into bays of about a metre",
    rackBays(mk({ form: "rack", width: 2700 })) === 3, String(rackBays(mk({ form: "rack", width: 2700 }))));
  check("a rack always has at least one bay", rackBays(mk({ form: "rack", width: 100 })) === 1);
}

{
  // Every form is placed one way or the other, classed for export, and named.
  check("every form is classed",
    FURNISHING_FORMS.every(f => ["cabinetry", "appliance", "sanitary", "furniture"]
      .includes(furnishingClass(f))));
  check("cabinetry is wall-mounted and a table is not",
    furnishingWallMounted("cabinet") && !furnishingWallMounted("table"));
  check("a bowl is classed as a fixture", furnishingClass("counter") === "sanitary");
}

{
  const clamped = clampFurnishing({ ...cabinetDefaults("base"), width: 9e9, depth: -5, drawers: 0 });
  check("dimensions clamp to what can be built",
    clamped.width === 6000 && clamped.depth === 100 && clamped.drawers === 1,
    JSON.stringify(clamped));
  check("dimensions round to whole millimetres",
    Number.isInteger(clampFurnishing({ ...cabinetDefaults("base"), width: 601.7 }).width));
  check("a module width is the nearest step",
    nearestModule(580) === 600 && nearestModule(410) === 400 && nearestModule(1e6) === 1200,
    `${nearestModule(580)} / ${nearestModule(410)}`);
}

{
  // writeSpec drops what the form does not read: a bed carrying a hinge side
  // would survive undo, reach the export, and mean nothing.
  const bed = fromSpec({ ...furnishingDefaults("bed"), front: "drawers", hinge: "right", corner: true });
  check("a bed stores no cabinet fields",
    bed.front === undefined && bed.hinge === undefined && bed.corner === undefined,
    JSON.stringify(bed));
  const cab = fromSpec({ ...cabinetDefaults("base"), front: "drawers", drawers: 4, mark: "fridge" });
  check("a cabinet stores its drawers and not an appliance mark",
    cab.drawers === 4 && cab.mark === undefined, JSON.stringify(cab));
  check("a default is left out rather than written",
    fromSpec(cabinetDefaults("base")).kind === undefined
    && fromSpec(cabinetDefaults("base")).hinge === undefined);
  const shower = fromSpec({ ...furnishingDefaults("shower"), tray: "linear" });
  check("a shower keeps its tray", shower.tray === "linear");
}

{
  // The presets are what the builder asked for: named pieces at stock sizes.
  const cabinets = FURNISHING_PRESETS.filter(p => p.form === "cabinet");
  check("every cabinet preset is a stock module width",
    cabinets.every(p => CABINET_WIDTHS.includes(p.width)),
    cabinets.filter(p => !CABINET_WIDTHS.includes(p.width)).map(p => p.id).join(", "));
  check("a straight cabinet preset uses a depth its height class offers",
    cabinets.every(p => p.corner || CABINET_DEPTHS[p.kind].includes(p.depth)),
    cabinets.filter(p => !p.corner && !CABINET_DEPTHS[p.kind].includes(p.depth))
      .map(p => `${p.id}:${p.depth}`).join(", "));
  check("the kitchen sizes the feedback asked for are offered",
    [400, 600, 800].every(w => CABINET_WIDTHS.includes(w)));
  check("preset ids are unique",
    new Set(FURNISHING_PRESETS.map(p => p.id)).size === FURNISHING_PRESETS.length);
  check("every preset lands in a group the picker shows",
    FURNISHING_PRESETS.every(p => FURNISHING_GROUPS.includes(p.group)));
  check("every group has something in it",
    FURNISHING_GROUPS.every(g => FURNISHING_PRESETS.some(p => p.group === g)));
  check("every form is reachable from a preset",
    FURNISHING_FORMS.every(f => FURNISHING_PRESETS.some(p => p.form === f)),
    FURNISHING_FORMS.filter(f => !FURNISHING_PRESETS.some(p => p.form === f)).join(", "));
  // A width ladder that does not carry the size its own presets are placed at
  // would offer a chip nobody can land on.
  check("a form's width ladder covers its presets' widths",
    FURNISHING_PRESETS.every(p => !FORM_WIDTHS[p.form] || FORM_WIDTHS[p.form]!.includes(p.width)),
    FURNISHING_PRESETS.filter(p => FORM_WIDTHS[p.form] && !FORM_WIDTHS[p.form]!.includes(p.width))
      .map(p => `${p.id}:${p.width}`).join(", "));
  check("a preset resolves by id", furnishingPreset("onderkast")?.kind === "base");
  check("an unknown preset resolves to nothing", furnishingPreset("nope") === undefined);
}

{
  // Round trip: a piece built from a preset reads back as that preset.
  for (const p of FURNISHING_PRESETS) {
    const { id: _id, group: _group, ...spec } = p;
    check(`${p.id} reads back as itself`, furnishingPresetOf(fromSpec(spec))?.id === p.id,
      String(furnishingPresetOf(fromSpec(spec))?.id));
  }
  // The hinge side is a tuning, not an identity: a unit hung the other way is
  // still the same unit, the way doorKindOf() ignores which jamb hangs a leaf.
  check("the hinge side does not change what a unit is",
    furnishingPresetOf(mk({ hinge: "right", worktop: true }))?.id === "onderkast",
    String(furnishingPresetOf(mk({ hinge: "right", worktop: true }))?.id));
  check("a tuned size is custom", furnishingPresetOf(mk({ width: 550 })) === null);
  // A placed piece reads back as the specification the pane edits.
  const spec = furnishingSpecOf(mk({ front: "drawers", drawers: 4 }));
  check("a placed piece reads back as its specification",
    spec.form === "cabinet" && spec.front === "drawers" && spec.drawers === 4,
    JSON.stringify(spec));
}

/* ── the document ── */

{
  const doc = emptyDoc(), floor = doc.floors[0]!;
  check("a floor with no furnishings reads back empty",
    furnishingsOf({ ...floor, furnishings: undefined }).length === 0);
  floor.furnishings = [mk({ id: newId("i") })];
  check("a floor's furnishings read back", furnishingsOf(floor).length === 1);

  const errs = validate(planSchema(""), doc);
  check("a document with a furnishing validates", errs.length === 0, errs.join(" | "));

  // Every named piece has to survive the schema, not just the one above.
  const all = emptyDoc();
  all.floors[0]!.furnishings = FURNISHING_PRESETS.map((p, i) => {
    const { id: _id, group: _group, ...spec } = p;
    return fromSpec(spec, { id: "i" + i, x: i * 3000, y: 0 });
  });
  const allErrs = validate(planSchema(""), all);
  check("every preset validates", allErrs.length === 0, allErrs.slice(0, 3).join(" | "));

  const bad = JSON.parse(JSON.stringify(doc));
  bad.floors[0].furnishings[0].form = "hovercraft";
  check("an unknown form is rejected", validate(planSchema(""), bad).length > 0);

  const bad2 = JSON.parse(JSON.stringify(doc));
  delete bad2.floors[0].furnishings[0].form;
  check("a furnishing without a form is rejected", validate(planSchema(""), bad2).length > 0);

  const bad3 = JSON.parse(JSON.stringify(doc));
  bad3.floors[0].furnishings[0].shelves = 3;
  check("an unknown furnishing property is rejected", validate(planSchema(""), bad3).length > 0);
}

{
  // A plan of nothing but a furnishing still frames and still exports:
  // planBounds walks the footprint corners, so the crop is not empty.
  const doc = emptyDoc(), floor = doc.floors[0]!;
  floor.furnishings = [mk({ id: newId("i"), x: 2000, y: 1000 })];
  const b = planBounds(floor, resolveFloor(floor));
  check("a furnishing alone gives the crop something to frame", b !== null);
  check("the crop covers the carcass",
    !!b && b.min.x <= 1700 && b.max.y >= 1600, JSON.stringify(b));

  const dxf = toDxf(doc);
  check("a plan of nothing but a furnishing still exports", dxf !== null);
  check("cabinetry gets its own DXF layer", !!dxf && dxf.includes("CABINETS"));
  const svg = toSvg(doc);
  check("furnishings get their own SVG group", !!svg && svg.includes('id="furnishings"'));

  // The fit-out splits by trade, so a plumber can turn one layer on.
  const trades = emptyDoc();
  trades.floors[0]!.furnishings = [
    mk({ id: "i1", form: "bath", width: 1700, depth: 750, x: 0, y: 0 }),
    mk({ id: "i2", form: "appliance", mark: "cooktop", width: 600, depth: 600, x: 3000, y: 0 }),
    mk({ id: "i3", form: "bed", width: 1600, depth: 2000, x: 6000, y: 0 }),
  ];
  const tradeDxf = toDxf(trades) ?? "";
  check("a fixture lands on the sanitary layer", tradeDxf.includes("SANITARY"));
  check("an appliance lands on the appliance layer", tradeDxf.includes("APPLIANCES"));
  check("loose furniture lands on the furniture layer", tradeDxf.includes("FURNITURE"));

  // Overhead work: the layer says so in DXF, the dash in SVG.
  const over = emptyDoc();
  over.floors[0]!.furnishings = [mk({ id: newId("i"), kind: "wall", depth: 350 })];
  check("a wall unit lands on the overhead layer",
    (toDxf(over) ?? "").includes("CABINETS-OVERHEAD"));
  check("a wall unit is dashed in SVG",
    (toSvg(over) ?? "").includes("stroke-dasharray"));
}

/* ── names ── */

const dict = (lng: "nl" | "en", key: string): Record<string, string> =>
  (resources[lng].translation as unknown as Record<string, Record<string, string>>)[key] ?? {};

for (const lng of ["nl", "en"] as const) {
  const names = dict(lng, "furnishing");
  const missing = FURNISHING_PRESETS.filter(p => typeof names[p.id] !== "string").map(p => p.id);
  check(`every preset has a ${lng} name`, missing.length === 0, missing.join(", "));
  const stale = Object.keys(names).filter(k => !FURNISHING_PRESETS.some(p => p.id === k));
  check(`no ${lng} names for removed presets`, stale.length === 0, stale.join(", "));

  const forms = dict(lng, "form");
  check(`every form has a ${lng} name`,
    FURNISHING_FORMS.every(f => typeof forms[f] === "string"),
    FURNISHING_FORMS.filter(f => typeof forms[f] !== "string").join(", "));
  const groups = dict(lng, "furnishingGroup");
  check(`every group has a ${lng} name`, FURNISHING_GROUPS.every(g => typeof groups[g] === "string"));
  const kinds = dict(lng, "cabinetKind");
  check(`every height class has a ${lng} name`, CABINET_KINDS.every(k => typeof kinds[k] === "string"));
  const fronts = dict(lng, "cabinetFront");
  check(`every front has a ${lng} name`, CABINET_FRONTS.every(f => typeof fronts[f] === "string"));
  const marks = dict(lng, "applianceMark");
  check(`every appliance mark has a ${lng} name`, APPLIANCE_MARKS.every(m => typeof marks[m] === "string"));
  const cisterns = dict(lng, "toiletCistern");
  check(`every cistern has a ${lng} name`, TOILET_CISTERNS.every(c => typeof cisterns[c] === "string"));
  const trays = dict(lng, "showerTray");
  check(`every shower tray has a ${lng} name`, SHOWER_TRAYS.every(x => typeof trays[x] === "string"));
}

const formCount = new Set<FurnishingForm>(FURNISHING_PRESETS.map(p => p.form)).size;
console.log(`${FURNISHING_PRESETS.length} presets over ${formCount} forms, ${CABINET_WIDTHS.length} module widths`);
console.log(failures === 0 ? "ALL FURNISHING TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
