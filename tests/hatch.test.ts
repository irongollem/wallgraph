// Hatch pattern tests, run with tsx.
import { v, dot, pointInPolygon, type Vec } from "../src/geometry/vec";
import { WALL_MATERIALS, type WallMaterial } from "../src/model/doc";
import {
  hatchFor, wallHatch, hatchVisible, hatchSegments, hatchLegend,
  HATCH_VISIBLE_PX, type HatchSeg,
} from "../src/render/hatch";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function segLen(s: HatchSeg): number { return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y); }

// --- 1. every WallMaterial resolves, patterns are mutually distinguishable ---
{
  const seen = new Set<string>();
  let allResolve = true;
  let allDistinct = true;
  for (const m of WALL_MATERIALS) {
    const p = hatchFor(m);
    if (p !== null && p.lines.length < 1) allResolve = false;
    if (p !== null) {
      const key = JSON.stringify([...p.lines].sort((a, b) => a.angleDeg - b.angleDeg));
      if (seen.has(key)) allDistinct = false;
      seen.add(key);
    }
  }
  check("every material resolves to a pattern or null", allResolve);
  check("no two non-null patterns are identical", allDistinct);
  check("glass carries no hatch", hatchFor("glass") === null);
  check("undefined material hatches like masonry",
    JSON.stringify(hatchFor(undefined)) === JSON.stringify(hatchFor("masonry")));
}

// --- 2. simple square ---
{
  const w = 200, h = 150;
  const poly: Vec[] = [v(0, 0), v(w, 0), v(w, h), v(0, h)];
  const pattern = hatchFor("masonry")!;
  const segs = hatchSegments(poly, pattern);
  check("square produces segments", segs.length > 0, String(segs.length));
  let allInBounds = true, allNonZero = true;
  const eps = 1e-6;
  for (const s of segs) {
    for (const p of [s.a, s.b]) {
      if (p.x < -eps || p.x > w + eps || p.y < -eps || p.y > h + eps) allInBounds = false;
    }
    if (segLen(s) < 1e-6) allNonZero = false;
  }
  check("every endpoint lies within the square", allInBounds);
  check("no segment has zero length", allNonZero);
}

// --- 3. concave L-shape: no segment crosses the notch ---
{
  // Outer 200x200 square missing its top-right 100x100 quadrant.
  const poly: Vec[] = [v(0, 0), v(200, 0), v(200, 100), v(100, 100), v(100, 200), v(0, 200)];
  const pattern = hatchFor("concrete")!; // two crossed families: exercises both angles
  const segs = hatchSegments(poly, pattern);
  check("L-shape produces segments", segs.length > 0, String(segs.length));
  let allMidInside = true;
  for (const s of segs) {
    const mid = v((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2);
    if (!pointInPolygon(mid, [...poly])) allMidInside = false;
  }
  check("every segment's midpoint is inside the L-shape (none crosses the notch)", allMidInside);
}

// --- 4a. phase alignment: a translated copy keeps its lines on the same lattice ---
{
  // Timber (angle 0, spacing 30): lines are horizontal, y = k * 30 in world
  // space, so a copy translated only in y is easy to reason about directly.
  const pattern = hatchFor("timber")!;
  const spacing = pattern.lines[0]!.spacingMm;
  const shift = spacing * 3; // exact multiple of the spacing
  const base: Vec[] = [v(10, 10), v(110, 10), v(110, 110), v(10, 110)];
  const moved: Vec[] = base.map(p => v(p.x, p.y + shift));

  const segsBase = hatchSegments(base, pattern);
  const segsMoved = hatchSegments(moved, pattern);
  check("translated square also hatches", segsBase.length > 0 && segsMoved.length > 0,
    `${segsBase.length} ${segsMoved.length}`);

  const ysBase = segsBase.map(s => Math.round(s.a.y)).sort((a, b) => a - b);
  const ysMoved = segsMoved.map(s => Math.round(s.a.y - shift)).sort((a, b) => a - b);
  check("shifting by an exact multiple of the spacing reuses the same line positions",
    JSON.stringify(ysBase) === JSON.stringify(ysMoved),
    `${JSON.stringify(ysBase)} vs ${JSON.stringify(ysMoved)}`);
}

// --- 4b. phase alignment: two adjacent wall pieces (e.g. split by an opening) ---
// line up on the same world lattice instead of each starting its own phase.
// Uses a 45-degree family so the split (along x) actually perturbs the
// per-piece projection, unlike an axis-aligned family split along that axis.
{
  const pattern = hatchFor("masonry")!;
  const n = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }; // perp(fromAngle(45deg))
  const vOf = (s: HatchSeg) => Math.round(dot(s.a, n) * 1000) / 1000;

  const full: Vec[] = [v(0, 0), v(200, 0), v(200, 200), v(0, 200)];
  const left: Vec[] = [v(0, 0), v(83, 0), v(83, 200), v(0, 200)];
  const right: Vec[] = [v(83, 0), v(200, 0), v(200, 200), v(83, 200)];

  const vFull = new Set(hatchSegments(full, pattern).map(vOf));
  const vSplit = new Set([...hatchSegments(left, pattern).map(vOf), ...hatchSegments(right, pattern).map(vOf)]);
  check("splitting a wall piece in two reuses exactly the same world lines",
    vFull.size > 0 && vFull.size === vSplit.size && [...vFull].every(x => vSplit.has(x)),
    `${JSON.stringify([...vFull])} vs ${JSON.stringify([...vSplit])}`);
}

// --- 5. wallHatch guards ---
{
  check("a coloured wall takes no hatch",
    wallHatch({ material: "masonry", color: "#ff0000", height: undefined }) === null);
  check("a wall below the section plane takes no hatch",
    wallHatch({ material: "masonry", color: undefined, height: 900 }) === null);
  check("a glass wall takes no hatch",
    wallHatch({ material: "glass", color: undefined, height: undefined }) === null);
  const ordinary = wallHatch({ material: "masonry", color: undefined, height: undefined });
  check("an ordinary masonry wall takes a pattern",
    ordinary !== null && ordinary.lines.length >= 1);
  check("an invalid colour string does not suppress the hatch (matches wallPen's HEX test)",
    wallHatch({ material: "masonry", color: "red", height: undefined }) !== null);
}

// --- 6. hatchVisible threshold ---
{
  const REFERENCE_SPACING_MM = hatchFor("steel")!.lines[0]!.spacingMm; // tightest in the table
  const thresholdPx = REFERENCE_SPACING_MM / HATCH_VISIBLE_PX;
  check("zoomed far out, hatch is not visible", hatchVisible(thresholdPx * 4) === false);
  check("zoomed in, hatch is visible", hatchVisible(thresholdPx / 4) === true);
  check("at the documented threshold, hatch is visible", hatchVisible(thresholdPx) === true);
  check("just past the documented threshold, hatch is not visible",
    hatchVisible(thresholdPx * 1.0001) === false);
}

// --- 7. degenerate input never throws and never returns garbage ---
{
  const pattern = hatchFor("masonry")!;
  const cases: { name: string; poly: Vec[] }[] = [
    { name: "empty", poly: [] },
    { name: "one point", poly: [v(0, 0)] },
    { name: "two points", poly: [v(0, 0), v(10, 10)] },
    { name: "zero area (collinear)", poly: [v(0, 0), v(10, 0), v(20, 0)] },
    { name: "all coincident", poly: [v(5, 5), v(5, 5), v(5, 5)] },
    { name: "non-finite coordinate", poly: [v(0, 0), v(100, 0), v(100, NaN), v(0, 100)] },
    { name: "infinite coordinate", poly: [v(0, 0), v(100, 0), v(Infinity, 100), v(0, 100)] },
  ];
  for (const c of cases) {
    let result: HatchSeg[] | undefined;
    let threw = false;
    try { result = hatchSegments(c.poly, pattern); } catch { threw = true; }
    check(`degenerate (${c.name}) does not throw`, !threw);
    check(`degenerate (${c.name}) returns []`, !threw && Array.isArray(result) && result.length === 0,
      JSON.stringify(result));
  }
}

// --- 8. hatchLegend dedupes and orders by WALL_MATERIALS ---
{
  const walls: { material?: WallMaterial; color?: string; height?: number }[] = [
    { material: "steel" },
    { material: "masonry" },
    { material: "masonry" }, // duplicate
    { material: "glass" }, // hatches nothing
    { material: "timber", color: "#ff0000" }, // coloured, excluded
    { material: undefined }, // hatches like masonry
    { material: "concrete" },
  ];
  const legend = hatchLegend(walls);
  const expectedSet = new Set<WallMaterial>(["masonry", "concrete", "steel"]);
  check("legend has no duplicates", new Set(legend).size === legend.length, JSON.stringify(legend));
  check("legend contains exactly the materials that actually hatch",
    legend.length === expectedSet.size && legend.every(m => expectedSet.has(m)), JSON.stringify(legend));
  const order = legend.map(m => WALL_MATERIALS.indexOf(m));
  check("legend follows WALL_MATERIALS order", order.every((idx, i) => i === 0 || idx > order[i - 1]!),
    JSON.stringify(legend));
}

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
