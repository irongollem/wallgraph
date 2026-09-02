// Stepped stair solids: one prism per tread, landing, ramp slice or rung,
// laid out to match the 2D plan drawing of each kind.
import {
  Stair, ResolvedStair, StairKind, STAIR_KINDS, stairDefaults,
} from "../src/model/stair";
import {
  stairBox, landingSplit, straightTreads, stairRun, stairMetrics, resolveStair,
  WINDERS_PER_QUARTER, spiralOf,
} from "../src/core/stair";
import {
  stairSteps, StairStep, RAMP_PLATE, RUNG_DEPTH, RUNG_HEIGHT,
} from "../src/core/stair3d";
import { Vec, v, dist, polygonArea } from "../src/geometry/vec";
import type { Floor } from "../src/model/doc";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

const mk = (kind: StairKind, over: Partial<ResolvedStair> = {}): ResolvedStair =>
  ({ id: "t1", kind, x: 0, y: 0, rotation: 0, ...stairDefaults(kind), ...over });

const floorWith = (stairs: Stair[], height?: number): Floor =>
  ({ id: "f", name: "F", nodes: [], walls: [], symbols: [], stairs, ...(height ? { height } : {}) });

const f0 = floorWith([]);
const steps = (s: Stair): StairStep[] => stairSteps(f0, s);

const areaOf = (st: StairStep): number => Math.abs(polygonArea(st.poly));
const totalArea = (ss: StairStep[]): number => ss.reduce((acc, st) => acc + areaOf(st), 0);
const hasVertexAt = (st: StairStep, q: Vec, tol = 0.5): boolean =>
  st.poly.some(pt => dist(pt, q) <= tol);

// ── a straight flight ───────────────────────────────────────────────────────

{
  const s = mk("steektrap");
  const riser = stairMetrics(s).riser!;
  const ss = steps(s);
  check("a straight flight yields one step per tread", ss.length === s.treads, String(ss.length));
  check("the entry step starts on the floor", near(ss[0]!.z0, 0));
  check("z-bands rise monotonically, one riser per step",
    ss.every((st, k) => near(st.z0, k * riser) && near(st.z1, (k + 1) * riser)),
    JSON.stringify(ss.map(st => st.z1)));
  check("each step is one riser thick", ss.every(st => near(st.z1 - st.z0, riser)));
  check("the top tread tops out at rise - riser, never rise",
    near(ss[ss.length - 1]!.z1, s.rise - riser), String(ss[ss.length - 1]!.z1));
  check("the treads together cover treads x going x width",
    near(totalArea(ss), s.treads * s.going * s.width), String(totalArea(ss)));
  check("every tread is a quad", ss.every(st => st.poly.length === 4));
}

// ── placement: anchor, rotation ─────────────────────────────────────────────

{
  const s = mk("steektrap", { x: 1000, y: 2000, rotation: Math.PI / 2 });
  const ss = steps(s);
  // Local (-450, 0) turned a quarter clockwise about the anchor.
  check("footprints are placed through the anchor and rotation",
    hasVertexAt(ss[0]!, v(1000, 1550)) && hasVertexAt(ss[0]!, v(1000, 2450)),
    JSON.stringify(ss[0]!.poly));
}

// ── the storey height a stair follows ───────────────────────────────────────

{
  const plain: Stair = { id: "s", kind: "steektrap", x: 0, y: 0, rotation: 0,
    width: 900, going: 220, treads: 15 };
  const tall = floorWith([plain], 3200);
  const riser = stairMetrics(resolveStair(tall, plain)).riser!;
  const ss = stairSteps(tall, plain);
  check("a stair with no rise climbs its storey",
    near(riser, 200) && near(ss[ss.length - 1]!.z1, 3200 - riser),
    String(ss[ss.length - 1]!.z1));
}

// ── bordestrap: two flights and a landing ───────────────────────────────────

{
  const s = mk("bordestrap");
  const riser = stairMetrics(s).riser!;
  const split = landingSplit(s);
  const ss = steps(s);
  check("a bordestrap yields lower + upper + 1 landing prisms",
    ss.length === split.lower + split.upper + 1, String(ss.length));

  const landingArea = (2 * s.width + s.well!) * s.width;
  const landings = ss.filter(st => near(areaOf(st), landingArea, 10));
  check("exactly one prism spans the full landing", landings.length === 1, String(landings.length));
  const landing = landings[0]!;
  check("the landing is one riser thick", near(landing.z1 - landing.z0, riser));
  check("the landing tops out one riser above the lower flight",
    near(landing.z1, (split.lower + 1) * riser), String(landing.z1));

  const treads = ss.filter(st => st !== landing);
  const lower = treads.filter(st => st.z1 <= landing.z0 + 1);
  const upper = treads.filter(st => st.z1 > landing.z0 + 1);
  check("the treads divide over the two flights",
    lower.length === split.lower && upper.length === split.upper,
    `${lower.length} + ${upper.length}`);
  check("the landing sits between the flights in z",
    lower.every(st => st.z1 <= landing.z1 + 1) && upper.every(st => st.z0 >= landing.z0 - 1));
  check("the lower flight runs left of the well",
    lower.every(st => st.poly.every(q => q.x <= -s.well! / 2 + 0.5)));
  check("the upper flight runs right of the well",
    upper.every(st => st.poly.every(q => q.x >= s.well! / 2 - 0.5)));
  check("the bordestrap tops out at rise - riser",
    near(Math.max(...ss.map(st => st.z1)), s.rise - riser),
    String(Math.max(...ss.map(st => st.z1))));
}

// ── quarter kinds: straight treads plus winder fans ─────────────────────────

{
  const s = mk("bovenkwart");
  const riser = stairMetrics(s).riser!;
  const run = stairRun(s);
  const pivot = v(s.width / 2, run);
  const ss = steps(s);
  check("a bovenkwart yields one prism per tread", ss.length === s.treads, String(ss.length));
  // Steps come back in walking order: the straight flight, then the fan.
  const winders = ss.slice(straightTreads(s));
  check("WINDERS_PER_QUARTER winders fan from the inside corner",
    winders.length === WINDERS_PER_QUARTER && winders.every(st => hasVertexAt(st, pivot)),
    String(winders.length));
  check("the winders are the top steps",
    Math.min(...winders.map(st => st.z0)) >= straightTreads(s) * riser - 1);
  check("the fan tiles the quarter's square",
    near(totalArea(winders), s.width * s.width), String(totalArea(winders)));
  const straight = ss.slice(0, straightTreads(s));
  check("the straight treads are quads of going x width",
    straight.every(st => st.poly.length === 4 && near(areaOf(st), s.going * s.width)));
  const b = stairBox(s);
  check("every step stays inside the footprint", ss.every(st => st.poly.every(q =>
    q.x >= b.x0 - 0.5 && q.x <= b.x1 + 0.5 && q.y >= b.y0 - 0.5 && q.y <= b.y1 + 0.5)));
}

{
  const s = mk("onderkwart");
  const pivot = v(s.width / 2, s.width);
  const ss = steps(s);
  check("an onderkwart's winders come first",
    ss.slice(0, WINDERS_PER_QUARTER).every(st => hasVertexAt(st, pivot))
    && near(ss[0]!.z0, 0));
}

{
  const s = mk("onder-bovenkwart");
  const top = s.width + stairRun(s);
  // The last WINDERS_PER_QUARTER steps are the top fan; all fan from a shared pivot.
  const topFan = (over: Partial<ResolvedStair>): StairStep[] =>
    steps(mk("onder-bovenkwart", over)).slice(-WINDERS_PER_QUARTER);
  check("the top quarter fans from the entry side by default",
    topFan({}).every(st => hasVertexAt(st, v(s.width / 2, top))));
  check("counter-turned, it fans from the other side",
    topFan({ counterTurn: true }).every(st => hasVertexAt(st, v(-s.width / 2, top))));
}

// ── spirals ─────────────────────────────────────────────────────────────────

{
  const s = mk("wenteltrap");
  const g = spiralOf(s);
  const riser = stairMetrics(s).riser!;
  const b = stairBox(s);
  const outer = (b.x1 - b.x0) / 2;
  const ss = steps(s);
  check("a spiral yields one sector per tread", ss.length === s.treads, String(ss.length));
  check("a spiral's steps stay within the outer radius of its box",
    ss.every(st => st.poly.every(q => dist(q, g.c) <= outer + 0.5)));
  check("a wenteltrap leaves its well open",
    ss.every(st => st.poly.every(q => dist(q, g.c) >= g.inner - 0.5)));
  check("the entry sector lands on the anchor", hasVertexAt(ss[0]!, v(0, 0)));
  check("a spiral climbs one riser per tread",
    ss.every((st, k) => near(st.z0, k * riser) && near(st.z1, (k + 1) * riser)));
  check("a spiral tops out at rise - riser",
    near(ss[ss.length - 1]!.z1, s.rise - riser), String(ss[ss.length - 1]!.z1));
}

// ── hellingbaan: a sloping plate in slices ──────────────────────────────────

{
  const s = mk("hellingbaan");
  const ss = steps(s);
  check("a ramp yields one slice per going of run", ss.length === s.treads, String(ss.length));
  check("each slice reaches the ramp height at its far edge",
    ss.every((st, i) => near(st.z1, (s.rise * (i + 1)) / s.treads)),
    JSON.stringify(ss.map(st => st.z1)));
  check("a ramp arrives at the floor, not a riser below it",
    near(ss[ss.length - 1]!.z1, s.rise), String(ss[ss.length - 1]!.z1));
  check("slices are at most one plate thick",
    ss.every(st => st.z1 - st.z0 <= RAMP_PLATE + 1e-6 && st.z0 >= 0));
}

// ── klimijzers: rungs, not treads ───────────────────────────────────────────

{
  const s = mk("klimijzers");   // rise 3000
  const ss = steps(s);
  check("klimijzers produce their rung count", ss.length === 9, String(ss.length));
  const pitch = ss[0]!.z1;
  check("rungs are pitched evenly",
    ss.every((st, i) => near(st.z1, (i + 1) * pitch)), String(pitch));
  check("the pitch is roughly 280-300 mm", pitch >= 260 && pitch <= 320, String(pitch));
  check("the top rung sits one pitch below the rise",
    near(ss[ss.length - 1]!.z1, s.rise - pitch), String(ss[ss.length - 1]!.z1));
  check("a rung is a thin bar against the anchor line",
    ss.every(st => near(st.z1 - st.z0, RUNG_HEIGHT)
      && st.poly.every(q => q.y >= -0.5 && q.y <= RUNG_DEPTH + 0.5)
      && near(areaOf(st), s.width * RUNG_DEPTH)));
}

// ── the mirrored flag reflects world x about the anchor ─────────────────────

{
  const plain = mk("bovenkwart", { x: 1234, y: 500 });
  const flipped = mk("bovenkwart", { x: 1234, y: 500, mirrored: true });
  const a = steps(plain), b = steps(flipped);
  check("mirroring changes no counts or bands",
    a.length === b.length && a.every((st, i) =>
      st.poly.length === b[i]!.poly.length
      && near(st.z0, b[i]!.z0, 1e-6) && near(st.z1, b[i]!.z1, 1e-6)));
  const winder = straightTreads(plain);   // first winder's index
  check("a mirrored step vertex reflects about the anchor's x",
    a[winder]!.poly.every((q, i) =>
      near(b[winder]!.poly[i]!.x, 2 * plain.x - q.x, 1e-6)
      && near(b[winder]!.poly[i]!.y, q.y, 1e-6)),
    JSON.stringify({ a: a[winder]!.poly, b: b[winder]!.poly }));
}

// ── every kind, sanity across the sheet ─────────────────────────────────────

for (const kind of STAIR_KINDS) {
  const s = mk(kind);
  const ss = steps(s);
  check(`${kind} yields steps`, ss.length > 0, String(ss.length));
  check(`${kind} vertices are finite`,
    ss.every(st => st.poly.every(q => isFinite(q.x) && isFinite(q.y)))
    && ss.every(st => isFinite(st.z0) && isFinite(st.z1)));
  check(`${kind} polys are simple with non-zero area`,
    ss.every(st => st.poly.length >= 3 && areaOf(st) > 0));
  check(`${kind} z-bands are real and above the floor`,
    ss.every(st => st.z1 > st.z0 && st.z0 >= 0));
  check(`${kind} stays at or below its rise`,
    ss.every(st => st.z1 <= s.rise + 1e-6), String(Math.max(...ss.map(st => st.z1))));
  check(`${kind} z-bands never fall back`,
    ss.every((st, i) => i === 0 || st.z0 >= ss[i - 1]!.z0 - 1e-6));
}

console.log(failures === 0 ? "ALL STAIR3D TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
