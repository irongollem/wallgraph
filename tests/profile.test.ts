// A wall's top profile: the model in src/model/profile.ts, and the
// corner-mismatch report in src/core/profile.ts.
import { emptyDoc, newId, floorHeight, Wall, Floor } from "../src/model/doc";
import { wallLength, splitWall, flipWall } from "../src/model/ops";
import {
  wallTopAt, wallTopPolyline, wallTopRange, wallAreaUnder, clampProfile,
  gableProfile, leanToProfile, addProfilePoint,
  PROFILE_HEIGHT_MIN, PROFILE_HEIGHT_MAX,
} from "../src/model/profile";
import { topMismatches } from "../src/core/profile";
import { planNodeDissolve, applyNodeDissolve, isDissolvePlan } from "../src/core/join";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1e-6): boolean { return Math.abs(a - b) <= tol; }

/** A single straight wall of length L (default 4000), on its own floor. */
function wallFloor(L = 4000): { f: Floor; w: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const a = newId("n"), b = newId("n");
  f.nodes.push({ id: a, x: 0, y: 0 }, { id: b, x: L, y: 0 });
  const w: Wall = { id: newId("w"), a, b, thickness: 100, bulge: 0, openings: [] };
  f.walls.push(w);
  return { f, w };
}

/** A diagonal wall, whose own length (1000*sqrt(2) mm) is not a whole mm. */
function diagonalWallFloor(): { f: Floor; w: Wall } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const a = newId("n"), b = newId("n");
  f.nodes.push({ id: a, x: 0, y: 0 }, { id: b, x: 1000, y: 1000 });
  const w: Wall = { id: newId("w"), a, b, thickness: 100, bulge: 0, openings: [] };
  f.walls.push(w);
  return { f, w };
}

// ---- wallTopAt --------------------------------------------------------------

{
  const { f, w } = wallFloor();
  const h = floorHeight(f);
  check("flat without a profile", [0, 1000, 4000].every(s => wallTopAt(f, w, s) === h));
}

{
  const { f, w } = wallFloor();
  w.profile = [{ t: 1000, height: 3000 }, { t: 3000, height: 3600 }];
  check("linear between points", near(wallTopAt(f, w, 2000), 3300));
}

{
  // The wall's own ends anchor at wallHeight() wherever the profile does not
  // state a point there -- what makes a one-point gable a triangle rather
  // than a uniform raised roof.
  const { f, w } = wallFloor();
  const h = floorHeight(f);
  w.profile = [{ t: 2000, height: h + 1000 }];
  check("flat before the first implied anchor is the wall's own height",
    wallTopAt(f, w, 0) === h);
  check("flat beyond the ends: querying past the wall holds the boundary",
    wallTopAt(f, w, -500) === wallTopAt(f, w, 0)
    && wallTopAt(f, w, 4500) === wallTopAt(f, w, 4000));
}

{
  const { f, w } = wallFloor();
  const L = wallLength(f, w);
  w.profile = gableProfile(f, w, L);
  check("a gable at L/2 gives its peak there",
    wallTopAt(f, w, Math.round(L / 2)) === floorHeight(f) + 1000);
}

// ---- wallTopPolyline / wallTopRange ------------------------------------------

{
  const { f, w } = wallFloor();
  const h = floorHeight(f);
  const poly = wallTopPolyline(f, w, 4000);
  check("a flat wall's polyline is just its two ends",
    poly.length === 2 && poly[0]!.s === 0 && poly[0]!.h === h && poly[1]!.s === 4000 && poly[1]!.h === h);
  const range = wallTopRange(f, w, 4000);
  check("a flat wall's range is wallHeight() at both ends", range.min === h && range.max === h);
}

{
  const { f, w } = wallFloor();
  w.profile = [{ t: 2000, height: floorHeight(f) + 1000 }];
  const range = wallTopRange(f, w, 4000);
  check("a gable's range spans eave to ridge",
    range.min === floorHeight(f) && range.max === floorHeight(f) + 1000);
}

// ---- wallAreaUnder ------------------------------------------------------------

{
  const { f, w } = wallFloor(4000);
  w.height = 2600;
  w.profile = [{ t: 2000, height: 4600 }];
  const area = wallAreaUnder(f, w, 4000, 0, 4000);
  check("a 4000 wall, ends 2600, peak 4600 at 2000 -> 4000 x 3600",
    near(area, 4000 * 3600, 1), String(area));
}

{
  // A point past the wall's own end (issue #55) extends the domain unless
  // breakpoints() clips it: it must fold in at L by interpolation (here flat
  // extrapolation, the only point in play) rather than be read as if the
  // wall were 5000 mm long.
  const { f, w } = wallFloor(3000);
  const h = floorHeight(f);
  const L = wallLength(f, w);
  w.profile = [{ t: 5000, height: 4000 }];
  const area = wallAreaUnder(f, w, L, 0, L);
  const expected = (h + 4000) / 2 * L;
  check("a point past the wall's end folds in at the boundary, not left in place",
    near(area, expected, 1), `${area} vs ${expected}`);
  check("the clipped trapezoid never exceeds L x the highest stated height",
    area <= L * 4000 + 1e-6, String(area));
  check("wallTopAt at L reads the folded-in height",
    wallTopAt(f, w, L) === 4000);
}

// ---- splitWall ----------------------------------------------------------------

{
  // At the peak: the cut lands exactly on a stated point.
  const { f, w } = wallFloor(4000);
  const h = floorHeight(f);
  w.profile = [{ t: 2000, height: h + 1000 }];
  const originalProfile = w.profile;
  const mid = splitWall(f, w, 2000)!;
  check("split succeeded", mid !== null);
  const w2 = f.walls.find(x => x.id !== w.id)!;
  check("both halves peak at the cut", w.profile!.some(p => p.height === h + 1000)
    && w2.profile!.some(p => p.height === h + 1000));
  check("both halves are flat at wallHeight at their far end",
    near(wallTopAt(f, w, 0), h) && near(wallTopAt(f, w2, wallLength(f, w2)), h));
  check("the far half's array is its own",
    w2.profile !== originalProfile && w2.profile !== w.profile);
}

{
  // Off the peak: the cut falls strictly between two stated points.
  const { f, w } = wallFloor(4000);
  w.profile = [{ t: 1000, height: 3000 }, { t: 3000, height: 3600 }];
  const before = (s: number): number => wallTopAt(f, w, s);
  const atCut = before(2500);
  const atFarEnd = before(4000);   // ramps back down toward wallHeight() past t=3000
  const mid = splitWall(f, w, 2500)!;
  check("split succeeded", mid !== null);
  const w2 = f.walls.find(x => x.id !== w.id)!;
  check("the near half ends at the cut's interpolated height",
    near(wallTopAt(f, w, wallLength(f, w)), atCut));
  check("the far half starts at the same height",
    near(wallTopAt(f, w2, 0), atCut));
  check("the far half keeps the rest of the shape, including the point at t=3000",
    near(wallTopAt(f, w2, 500), 3600));
  check("and the same far end the combined wall had",
    near(wallTopAt(f, w2, wallLength(f, w2)), atFarEnd));
  check("the far half's array is its own", w2.profile !== w.profile);
}

// ---- flipWall -------------------------------------------------------------------

{
  const { f, w } = wallFloor(4000);
  w.profile = [{ t: 1000, height: 3000 }, { t: 3000, height: 3600 }];
  flipWall(f, w);
  const ts = w.profile!.map(p => p.t).sort((a, b) => a - b);
  check("reversing a wall mirrors the points (t -> L - t)",
    ts.length === 2 && ts[0] === 1000 && ts[1] === 3000
    && w.profile!.find(p => p.t === 1000)!.height === 3600
    && w.profile!.find(p => p.t === 3000)!.height === 3000);
}

{
  // A diagonal wall's own length is fractional, so t -> L - t is fractional
  // too: flipWall() has to re-run clampProfile() to round and re-sort, the
  // same pass any other geometry change gets.
  const { f, w } = diagonalWallFloor();
  const L = wallLength(f, w); // 1000 * sqrt(2) = 1414.213562...
  w.profile = [{ t: 500, height: 3200 }];
  flipWall(f, w);
  check("flipping a fractional-length wall rounds the mirrored point to a whole mm",
    w.profile!.length === 1 && Number.isInteger(w.profile![0]!.t), JSON.stringify(w.profile));
  check("at the correctly rounded position",
    w.profile![0]!.t === Math.round(L - 500), `${w.profile![0]!.t} vs L=${L}`);
  check("the height carries over unchanged", w.profile![0]!.height === 3200);
}

// ---- clampProfile ---------------------------------------------------------------

{
  const { f, w } = wallFloor(4000);
  w.profile = [{ t: -500, height: 50 }, { t: 4500, height: 99000 }, { t: 2000.6, height: 3000.4 }];
  clampProfile(f, w);
  const [p0, p1, p2] = [...w.profile!].sort((a, b) => a.t - b.t);
  check("t is clamped into [0, L]", p0!.t === 0 && p2!.t === 4000, JSON.stringify(w.profile));
  check("height is clamped into [PROFILE_HEIGHT_MIN, PROFILE_HEIGHT_MAX]",
    p0!.height === PROFILE_HEIGHT_MIN && p2!.height === PROFILE_HEIGHT_MAX);
  check("an in-range point is rounded to integer mm", p1!.t === 2001 && p1!.height === 3000);
  check("sorted by t", w.profile!.every((p, i) => i === 0 || w.profile![i - 1]!.t <= p.t));
}

{
  // A diagonal wall's own length is fractional (1000 * sqrt(2) mm): clamping
  // a point past its end must not leave that fractional length itself as the
  // clamped t, which would break invariant 1 (integer mm in the document).
  const { f, w } = diagonalWallFloor();
  const L = wallLength(f, w);
  w.profile = [{ t: 5000, height: 3000 }];
  clampProfile(f, w);
  check("t clamps to a whole mm even on a fractional-length wall",
    Number.isInteger(w.profile![0]!.t), String(w.profile![0]!.t));
  check("landing at the wall's own length floored, not its fractional value",
    w.profile![0]!.t === Math.floor(L), `${w.profile![0]!.t} vs L=${L}`);
}

{
  // A node move leaves `t` as it is; clampProfile() then keeps it on the wall,
  // the same as clampOpening().
  const { f, w } = wallFloor(4000);
  w.profile = [{ t: 3900, height: 3200 }];
  const b = f.nodes.find(n => n.id === w.b)!;
  b.x = 1000;   // the wall shrinks to 1000 mm
  clampProfile(f, w);
  check("clampProfile after a node move brings the point back onto the wall",
    w.profile![0]!.t === 1000);
}

{
  const { f, w } = wallFloor(4000);
  w.profile = [];
  clampProfile(f, w);
  check("clampProfile on an empty profile is a no-op", w.profile!.length === 0);
}

// ---- panel presets ----------------------------------------------------------------

{
  const { f, w } = wallFloor(4000);
  const h = floorHeight(f);
  const pts = gableProfile(f, w, 4000);
  check("gableProfile is one point at L/2, wallHeight + 1000",
    pts.length === 1 && pts[0]!.t === 2000 && pts[0]!.height === h + 1000);
}

{
  const { f, w } = wallFloor(4000);
  const h = floorHeight(f);
  const pts = leanToProfile(f, w, 4000);
  check("leanToProfile runs wallHeight at a to wallHeight + 1000 at b",
    pts.length === 2 && pts[0]!.t === 0 && pts[0]!.height === h
    && pts[1]!.t === 4000 && pts[1]!.height === h + 1000);
}

{
  const { f, w } = wallFloor(4000);
  w.profile = [{ t: 1000, height: 3200 }];
  const p = addProfilePoint(f, w, 4000);
  check("addProfilePoint finds the widest gap",
    p.t === 2500, String(p.t));   // gaps: [0,1000]=1000, [1000,4000]=3000 -> mid 2500
  check("and interpolates the top's own height there",
    near(p.height, wallTopAt(f, w, 2500), 1));
}

// ---- topMismatches -----------------------------------------------------------------

/** Two walls meeting at a shared node: p0->mid (wall 1) and mid->p1 (wall 2). */
function corner(): { f: Floor; w1: Wall; w2: Wall; mid: string } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const p0 = newId("n"), mid = newId("n"), p1 = newId("n");
  f.nodes.push({ id: p0, x: 0, y: 0 }, { id: mid, x: 4000, y: 0 }, { id: p1, x: 4000, y: 3000 });
  const w1: Wall = { id: newId("w"), a: p0, b: mid, thickness: 100, bulge: 0, openings: [] };
  const w2: Wall = { id: newId("w"), a: mid, b: p1, thickness: 100, bulge: 0, openings: [] };
  f.walls.push(w1, w2);
  return { f, w1, w2, mid };
}

{
  const { f } = corner();
  check("an L corner whose walls agree gives none", topMismatches(f).length === 0);
}

{
  const { f, w1 } = corner();
  w1.profile = [{ t: 4000, height: floorHeight(f) + 200 }];
  const mism = topMismatches(f);
  check("one 200 mm apart gives one", mism.length === 1, String(mism.length));
}

{
  const { f, w2 } = corner();
  w2.height = floorHeight(f) - 1500;
  check("flat walls of different heights meeting are not reported", topMismatches(f).length === 0);
}

{
  // A flat wall meeting a gable's LOW end: the gable's t=0 anchors at
  // wallHeight(), which is what the flat wall states there too.
  const { f, w1, w2 } = corner();
  const h = floorHeight(f);
  w2.profile = [{ t: 3000, height: h + 1000 }];   // peaks at its far (b) end
  check("a flat wall meeting a gable end at its low end gives none",
    topMismatches(f).length === 0);
  check("but the reported height there is still the low end",
    wallTopAt(f, w1, wallLength(f, w1)) === h && wallTopAt(f, w2, 0) === h);
}

{
  // A T-junction: a long wall split into two collinear segments sharing a
  // node, plus a third (a partition) ending at that same node. All three END
  // there -- a wall can only meet a node in this graph by sharing it as an
  // endpoint, never by merely running near it -- so all three are compared.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const l0 = newId("n"), mid = newId("n"), l1 = newId("n"), p = newId("n");
  f.nodes.push(
    { id: l0, x: 0, y: 0 }, { id: mid, x: 4000, y: 0 },
    { id: l1, x: 8000, y: 0 }, { id: p, x: 4000, y: 3000 },
  );
  const seg1: Wall = { id: newId("w"), a: l0, b: mid, thickness: 100, bulge: 0, openings: [] };
  const seg2: Wall = { id: newId("w"), a: mid, b: l1, thickness: 100, bulge: 0, openings: [] };
  const stem: Wall = {
    id: newId("w"), a: mid, b: p, thickness: 100, bulge: 0, openings: [],
    height: floorHeight(f) - 1000,
  };
  seg1.profile = [{ t: 0, height: floorHeight(f) + 1000 }];
  f.walls.push(seg1, seg2, stem);
  check("a lower partition ending at a sloped T is not reported",
    topMismatches(f).find(m => m.nodeId === mid) === undefined);
  stem.height = floorHeight(f) + 300;
  const mism = topMismatches(f).find(m => m.nodeId === mid);
  check("a partition rising above the through wall at a T is reported, listing all three",
    mism !== undefined && mism.walls.length === 3, JSON.stringify(mism));
}

// ---- merge through a node ---------------------------------------------------

{
  // Split a gable off its peak, then dissolve the node again: the ends each
  // half left to wallHeight() must not straighten the merged top.
  const { f, w } = wallFloor();
  const h = floorHeight(f);
  w.profile = [{ t: 2000, height: h + 2000 }];
  const before = [0, 500, 1000, 2000, 3000, 4000].map(s => wallTopAt(f, w, s));
  const mid = splitWall(f, w, 1000);
  const plan = mid ? planNodeDissolve(f, mid.id) : null;
  check("a split gable can be dissolved again", isDissolvePlan(plan), JSON.stringify(plan));
  if (isDissolvePlan(plan)) {
    applyNodeDissolve(f, plan);
    const merged = f.walls[0]!;
    const after = [0, 500, 1000, 2000, 3000, 4000].map(s => wallTopAt(f, merged, s));
    check("dissolving keeps the top's shape", f.walls.length === 1
      && before.every((b, i) => near(b, after[i]!, 1)), JSON.stringify({ before, after }));
  }
}

{
  // A sloped wall merged with a flat one keeps both parts' own heights.
  const { f, w } = wallFloor();
  const h = floorHeight(f);
  const mid = splitWall(f, w, 2000)!;
  const near2 = f.walls.find(x => x.b === mid.id)!;
  near2.profile = [{ t: 1000, height: h + 1000 }];
  const plan = planNodeDissolve(f, mid.id);
  if (isDissolvePlan(plan)) {
    applyNodeDissolve(f, plan);
    const merged = f.walls[0]!;
    check("merging a sloped half with a flat half keeps the flat half flat",
      near(wallTopAt(f, merged, 1000), h + 1000, 1) && near(wallTopAt(f, merged, 3000), h, 1),
      JSON.stringify(merged.profile));
  } else {
    check("a sloped and a flat half can be dissolved", false, JSON.stringify(plan));
  }
}

console.log(failures === 0 ? "ALL PROFILE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
