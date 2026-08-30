// Stair tests: the registry, the derived geometry, and the promise the rest of
// the editor relies on — that a stair draws inside the footprint its hit-test,
// its selection frame and the export crop all use.
import {
  Stair, ResolvedStair, StairKind, STAIR_KINDS, stairDefaults, stairParams, stairFields,
  clampStair, stairAngle, inheritsRise,
} from "../src/model/stair";
import {
  stairBox, stairCorners, stairHit, spiralOf, stairRun, straightTreads, landingSplit,
  stairMetrics, cutTread, stairNote, stairNoteAt, CUT_HEIGHT, NOTE_OFFSET,
  resolveStair, stairIssues, STAIR_LIMITS,
} from "../src/core/stair";
import { STAIRS, getStair } from "../src/render/stairs";
import { stairPrims } from "../src/io/stair";
import { Prim } from "../src/io/record";
import { Vec, v } from "../src/geometry/vec";
import { emptyDoc, stairsOf, floorHeight, FLOOR_HEIGHT_DEFAULT, type Floor } from "../src/model/doc";
import { toDxf } from "../src/io/dxf";
import { toSvg } from "../src/io/svg";
import { resources } from "../src/i18n";
import { planSchema, validate } from "../scripts/site/schema";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const mk = (kind: StairKind, over: Partial<ResolvedStair> = {}): ResolvedStair =>
  ({ id: "t1", kind, x: 0, y: 0, rotation: 0, ...stairDefaults(kind), ...over });

const floorWith = (stairs: Stair[], height?: number): Floor =>
  ({ id: "f", name: "F", nodes: [], walls: [], symbols: [], stairs, ...(height ? { height } : {}) });

/** Every point a set of primitives touches. The recorder flattens curves. */
function points(prims: Prim[]): Vec[] {
  const out: Vec[] = [];
  for (const p of prims) {
    if (p.kind === "line") out.push(p.a, p.b);
    else if (p.kind === "poly") out.push(...p.pts);
    else if (p.kind === "text") out.push(p.at);
    else out.push(v(p.c.x - p.r, p.c.y - p.r), v(p.c.x + p.r, p.c.y + p.r));
  }
  return out;
}

/* ── registry ── */

check("every kind on the union has a drawing",
  STAIR_KINDS.every(k => getStair(k) !== undefined),
  STAIR_KINDS.filter(k => !getStair(k)).join(", "));
check("the registry is in the sheet's order",
  STAIRS.map(d => d.kind).join() === STAIR_KINDS.join(), STAIRS.map(d => d.kind).join());
check("kinds are unique", new Set(STAIR_KINDS).size === STAIR_KINDS.length);
check("labels are unique", new Set(STAIRS.map(d => d.label)).size === STAIRS.length);
check("no stair kind is also a symbol id", !STAIR_KINDS.some(k => k.includes(" ")));

/* ── parameters ── */

{
  const c = clampStair({ width: 900.4, going: 219.6, treads: 15.5, rise: 2800.4, well: 99.5 });
  check("parameters are whole millimetres",
    Number.isInteger(c.width) && Number.isInteger(c.going) && Number.isInteger(c.treads),
    JSON.stringify(c));
  const low = clampStair({ width: 1, going: 0, treads: 0, rise: 0, well: -50 });
  check("parameters cannot go degenerate",
    low.width >= 200 && low.going >= 50 && low.treads >= 1 && low.well === 0, JSON.stringify(low));
  const high = clampStair({ width: 1e9, going: 1e9, treads: 1e9, rise: 1e9, well: 1e9 });
  check("parameters stay finite", isFinite(high.width) && high.treads <= 60, JSON.stringify(high));
  check("nonsense does not become NaN",
    isFinite(clampStair({ width: NaN, going: NaN, treads: NaN, rise: NaN, well: NaN }).width));
}

check("klimijzers hide the fields they do not read",
  !stairFields("klimijzers").going && !stairFields("klimijzers").treads);
check("only the kinds with a well offer one",
  stairFields("bordestrap").well && stairFields("spiltrap-rond").well
  && !stairFields("steektrap").well);
check("a stored well of 0 is not read as the kind's default",
  stairParams(mk("bordestrap", { well: 0 })).well === 0);

/* ── derived geometry ── */

{
  const s = mk("steektrap");
  const b = stairBox(s);
  check("a straight flight is width by run",
    b.x1 - b.x0 === s.width && b.y1 - b.y0 === s.treads * s.going,
    `${b.x1 - b.x0} x ${b.y1 - b.y0}`);
  check("the anchor is the middle of the bottom edge", b.x0 === -b.x1 && b.y0 === 0);
}

{
  const s = mk("bovenkwart");
  const b = stairBox(s);
  check("a quarter turns inside a square the width of the flight",
    b.y1 - b.y0 === stairRun(s) + s.width, String(b.y1 - b.y0));
  check("winders come off the straight part's tread count",
    straightTreads(s) === s.treads - 3, String(straightTreads(s)));
}

{
  const s = mk("bordestrap");
  const b = stairBox(s);
  const split = landingSplit(s);
  check("a bordestrap is two flights and a well wide",
    b.x1 - b.x0 === 2 * s.width + (s.well ?? 0), String(b.x1 - b.x0));
  check("its treads divide over the two flights",
    split.lower + split.upper === s.treads, JSON.stringify(split));
}

{
  const s = mk("spiltrap-rond");
  const g = spiralOf(s);
  const entry = v(g.c.x + Math.cos(g.start) * g.outer, g.c.y + Math.sin(g.start) * g.outer);
  check("a spiral's entry tread lands on the anchor",
    Math.hypot(entry.x, entry.y) < 1e-9, `${entry.x}, ${entry.y}`);
  check("the going is what the walking line turns through",
    Math.abs(g.step * g.walk - s.going) < 1e-9, String(g.step * g.walk));
  const b = stairBox(s);
  check("a spiral's footprint is square", b.x1 - b.x0 === b.y1 - b.y0);
  const deeper = spiralOf(mk("spiltrap-rond", { going: 500 }));
  check("a deeper tread takes a wider bite of the circle",
    deeper.step > g.step, `${deeper.step} vs ${g.step}`);
  const wider = spiralOf(mk("spiltrap-rond", { width: 1600 }));
  check("a wider flight turns less per tread", wider.step < g.step, `${wider.step} vs ${g.step}`);
}

for (const kind of STAIR_KINDS) {
  const b = stairBox(mk(kind));
  check(`${kind} has a usable footprint`,
    isFinite(b.x0) && isFinite(b.y1) && b.x1 > b.x0 && b.y1 > b.y0,
    JSON.stringify(b));
  check(`${kind} is symmetric about its anchor`, b.x0 === -b.x1);
}

/* ── what the rise makes calculable ── */

{
  const s = mk("steektrap");
  const m = stairMetrics(s);
  check("a flight of n treads has n+1 risers", m.risers === s.treads + 1, String(m.risers));
  check("the default flight is an ordinary stair",
    m.riser === 175 && m.walkRule === 570, `${m.riser} / ${m.walkRule}`);
  check("the optrede follows the rise",
    stairMetrics(mk("steektrap", { rise: 3200 })).riser === 200,
    String(stairMetrics(mk("steektrap", { rise: 3200 })).riser));
  check("the annotation states risers and optrede", stairNote(s) === "16 \u00d7 175", String(stairNote(s)));
}

{
  // The break falls where the flight passes the section plane, not at halfway.
  const s = mk("steektrap-boven-elkaar");
  const riser = stairMetrics(s).riser!;
  check("the cut lands at the section plane",
    Math.abs(cutTread(s) * riser - CUT_HEIGHT) <= riser / 2 + 1e-9,
    `${cutTread(s)} x ${riser}`);
  const shallow = mk("steektrap-boven-elkaar", { rise: 900, treads: 15 });
  check("a shallow flight breaks further along", cutTread(shallow) > cutTread(s),
    `${cutTread(shallow)} vs ${cutTread(s)}`);
  check("the cut stays on the flight",
    cutTread(mk("steektrap-boven-elkaar", { rise: 20000 })) >= 1);
}

{
  const ramp = mk("hellingbaan");
  const m = stairMetrics(ramp);
  check("a ramp has a gradient and no riser",
    m.riser === null && m.slope === 12, JSON.stringify(m));
  check("a ramp is annotated with its gradient", stairNote(ramp) === "1:12", String(stairNote(ramp)));
  check("an awkward gradient keeps one decimal",
    stairNote(mk("hellingbaan", { rise: 514 })) === "1:11.7 !",
    String(stairNote(mk("hellingbaan", { rise: 514 }))));
  check("climbing irons state neither", stairNote(mk("klimijzers")) === null);
}

{
  // The annotation sits off the foot of the flight and turns with it, but the
  // text itself is placed upright by the caller.
  const at = stairNoteAt(mk("steektrap"));
  check("the annotation sits off the foot", at.x === 0 && at.y === -NOTE_OFFSET, JSON.stringify(at));
  const turned = stairNoteAt(mk("steektrap", { rotation: Math.PI / 2 }));
  check("the annotation follows the rotation",
    Math.abs(turned.x - NOTE_OFFSET) < 1e-9 && Math.abs(turned.y) < 1e-9, JSON.stringify(turned));
  const placed = mk("steektrap", { x: 5000, y: 400 });
  const notes = stairPrims(placed).filter(p => p.kind === "text");
  check("the exports carry the annotation", notes.length === 1
    && notes[0]!.kind === "text" && notes[0]!.text === "16 \u00d7 175",
    JSON.stringify(notes));
}

{
  const full = Math.PI * 2;
  check("a stair angle stays inside one turn",
    Math.abs(stairAngle(full * 3 + Math.PI / 2) - Math.PI / 2) < 1e-9 && stairAngle(-Math.PI / 2) > 0,
    `${stairAngle(full * 3 + Math.PI / 2)} / ${stairAngle(-Math.PI / 2)}`);
  check("a nonsense angle is zero", stairAngle(NaN) === 0);
}

/* ── the storey height a stair follows ── */

{
  const stair: Stair = { id: "s", kind: "steektrap", x: 0, y: 0, rotation: 0,
    width: 900, going: 220, treads: 15 };
  check("a storey has a height even unstated", floorHeight(floorWith([])) === FLOOR_HEIGHT_DEFAULT);
  check("a stair with no rise climbs its storey",
    resolveStair(floorWith([stair], 3200), stair).rise === 3200);
  check("a stated rise overrides the storey",
    resolveStair(floorWith([stair], 3200), { ...stair, rise: 1200 }).rise === 1200);
  check("changing the storey moves the stairs that follow it",
    stairMetrics(resolveStair(floorWith([stair], 3200), stair)).riser === 200,
    String(stairMetrics(resolveStair(floorWith([stair], 3200), stair)).riser));
  const ramp: Stair = { id: "r", kind: "hellingbaan", x: 0, y: 0, rotation: 0,
    width: 1200, going: 500, treads: 12 };
  check("a ramp never inherits a storey height",
    !inheritsRise("hellingbaan")
    && resolveStair(floorWith([ramp], 3200), ramp).rise === stairDefaults("hellingbaan").rise);
}

/* ── what is ordinary, and what is not ── */

{
  const ok = mk("steektrap");
  check("an ordinary flight raises nothing", stairIssues(ok).length === 0,
    JSON.stringify(stairIssues(ok)));

  // The case that started this: four treads climbing four metres.
  const absurd = mk("steektrap", { treads: 4, rise: 4000 });
  const codes = stairIssues(absurd).map(i => i.code);
  check("four treads up four metres is flagged", codes.includes("riserHigh"), codes.join(","));
  check("the flag names the figure and what it is read against",
    stairIssues(absurd)[0]!.value === 800 && stairIssues(absurd)[0]!.limit === STAIR_LIMITS.riserMax,
    JSON.stringify(stairIssues(absurd)[0]));
  check("the annotation carries the flag", (stairNote(absurd) ?? "").endsWith("!"), String(stairNote(absurd)));

  check("a shallow going is flagged",
    stairIssues(mk("steektrap", { going: 180 })).some(i => i.code === "goingShort"));
  check("a narrow flight is flagged",
    stairIssues(mk("steektrap", { width: 700 })).some(i => i.code === "widthNarrow"));
  check("a step that is not a step is flagged",
    stairIssues(mk("steektrap", { treads: 40, rise: 1000 })).some(i => i.code === "riserLow"));

  // Kinds that are steep by definition are held to the loose bound only.
  check("a vlizotrap is not judged as a woningtrap",
    stairIssues(mk("vlizotrap")).length === 0, JSON.stringify(stairIssues(mk("vlizotrap"))));
  check("a spiltrap is not judged as a woningtrap",
    stairIssues(mk("spiltrap-rond")).length === 0, JSON.stringify(stairIssues(mk("spiltrap-rond"))));
  check("but no kind escapes the loose bound",
    stairIssues(mk("vlizotrap", { treads: 4, rise: 4000 })).some(i => i.code === "riserHigh"));
  check("climbing irons have nothing to read", stairIssues(mk("klimijzers")).length === 0);
  check("a steep ramp is flagged",
    stairIssues(mk("hellingbaan", { rise: 900 })).some(i => i.code === "slopeSteep"));
}

/* ── hit-testing ── */

{
  const s = mk("steektrap");
  check("a point on the flight hits", stairHit(s, v(0, 100)));
  check("a point off the foot misses", !stairHit(s, v(0, -200)));
  check("the grab margin extends the footprint", stairHit(s, v(0, -200), 250));
  const turned = mk("steektrap", { rotation: Math.PI / 2 });
  check("the hit-test follows the rotation", stairHit(turned, v(-100, 0)) && !stairHit(turned, v(100, 0)));
  check("mirroring cannot move a symmetric footprint",
    stairHit(mk("steektrap", { mirrored: true }), v(300, 100)));
}

/* ── drawing ── */

// Every kind has to survive the recorder, at its defaults and at the extremes
// the clamp allows: a drawing that throws or emits NaN vanishes from the export
// with no error at all.
for (const kind of STAIR_KINDS) {
  for (const [name, over] of [
    ["default", {}],
    ["smallest", clampStair({ width: 0, going: 0, treads: 0, rise: 0, well: 0 })],
    ["largest", clampStair({ width: 4000, going: 600, treads: 99, rise: 99000, well: 2000 })],
  ] as Array<[string, Partial<Stair>]>) {
    let prims: Prim[] = [];
    let threw = false;
    try { prims = stairPrims(mk(kind, over)); } catch { threw = true; }
    const pts = points(prims);
    check(`${kind} draws at its ${name}`,
      !threw && prims.length > 0 && pts.every(q => isFinite(q.x) && isFinite(q.y)),
      threw ? "threw" : `${prims.length} prims`);
  }
}

// The footprint is not a label: the hit-test, the selection frame, the PNG crop
// and the SVG viewBox all trust it, so nothing a kind draws may fall outside it.
// The annotation is excluded on purpose — it is placed beside the flight by the
// caller, and the check below holds it to the margin every export leaves.
for (const kind of STAIR_KINDS) {
  const s = mk(kind);
  const b = stairBox(s);
  const stray = points(stairPrims(s).filter(p => p.kind !== "text")).filter(q =>
    q.x < b.x0 - 5 || q.x > b.x1 + 5 || q.y < b.y0 - 5 || q.y > b.y1 + 5);
  check(`${kind} draws inside its own footprint`, stray.length === 0,
    stray.slice(0, 2).map(q => `${Math.round(q.x)},${Math.round(q.y)}`).join(" "));
}

{
  // Placed, turned and mirrored, the drawing still lands within the corners the
  // export crops to.
  const s = mk("bordestrap", { x: 1234, y: -567, rotation: 0.7, mirrored: true });
  const cs = stairCorners(s);
  const minX = Math.min(...cs.map(c => c.x)), maxX = Math.max(...cs.map(c => c.x));
  const minY = Math.min(...cs.map(c => c.y)), maxY = Math.max(...cs.map(c => c.y));
  const stray = points(stairPrims(s).filter(p => p.kind !== "text")).filter(q =>
    q.x < minX - 5 || q.x > maxX + 5 || q.y < minY - 5 || q.y > maxY + 5);
  check("a placed stair stays within the corners the crop uses", stray.length === 0,
    String(stray.length));
}

/* ── exports ── */

{
  const doc = emptyDoc();
  doc.floors[0]!.stairs = [mk("steektrap", { id: "t9", x: 1000, y: 1000 })];
  check("a floor's stairs read back", stairsOf(doc.floors[0]!).length === 1);

  const dxf = toDxf(doc);
  check("a plan of nothing but a stair still exports", typeof dxf === "string" && dxf.length > 0);
  check("stairs get their own DXF layer", (dxf ?? "").includes("STAIRS"));
  check("the stair reaches the entities section",
    ((dxf ?? "").match(/LWPOLYLINE/g) ?? []).length > 0);

  const svg = toSvg(doc);
  check("stairs get their own SVG group", (svg ?? "").includes('id="stairs"'));
  check("the SVG carries the stair's geometry",
    ((svg ?? "").split('id="stairs"')[1] ?? "").includes("<path"));
}

/* ── the published format ── */

{
  const schema = planSchema("");
  const doc = emptyDoc();
  doc.floors[0]!.stairs = [
    { id: "t1", kind: "bordestrap", x: 0, y: 0, rotation: 0, mirrored: true,
      width: 900, going: 220, treads: 16, rise: 2800, well: 100, color: "#d0342c" },
  ];
  check("a document with a stair validates", validate(schema, doc).length === 0,
    validate(schema, doc).join(" | "));

  const bad = JSON.parse(JSON.stringify(doc));
  bad.floors[0].stairs[0].kind = "zweeftrap";
  check("an unknown kind is rejected", validate(schema, bad).length > 0);

  const short = JSON.parse(JSON.stringify(doc));
  delete short.floors[0].stairs[0].treads;
  check("a stair without a tread count is rejected", validate(schema, short).length > 0);

  const extra = JSON.parse(JSON.stringify(doc));
  extra.floors[0].stairs[0].risers = 17;
  check("an unknown stair property is rejected", validate(schema, extra).length > 0);

  const kinds = (schema.$defs as Record<string, { properties: { kind: { enum: string[] } } }>)
    .stair!.properties.kind.enum;
  check("the schema's kinds match the registry", kinds.join() === STAIR_KINDS.join(), kinds.join());
}

/* ── names ── */

for (const lng of ["nl", "en"] as const) {
  const dict = ((resources[lng].translation as Record<string, unknown>).stair ?? {}) as Record<string, string>;
  const missing = STAIR_KINDS.filter(k => typeof dict[k] !== "string");
  check(`every stair has a ${lng} name`, missing.length === 0, missing.join(", "));
  const stale = Object.keys(dict).filter(k => !STAIR_KINDS.includes(k as StairKind));
  check(`no ${lng} names for removed stairs`, stale.length === 0, stale.join(", "));
}
{
  const dict = ((resources.en.translation as Record<string, unknown>).stair ?? {}) as Record<string, string>;
  const drift = STAIRS.filter(d => dict[d.kind] !== d.label)
    .map(d => `${d.kind}: "${d.label}" vs "${dict[d.kind]}"`);
  check("en stair names match the registry", drift.length === 0, drift.join(" | "));
}

console.log(`${STAIR_KINDS.length} stair kinds`);
console.log(failures === 0 ? "ALL STAIR TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
