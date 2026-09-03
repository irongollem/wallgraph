// The tape measure: what a tape end lands on, and what the reading between two
// ends is. The facts under test are the ones that make a reading usable on
// site -- that a face, a jamb and a footprint side are reachable and the
// centerline graph is not the only target, that the second end can be held
// square to a wall, and that the angle lock gives the length along the ray.
import { emptyDoc, newId, Floor, Wall } from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { measureTargets, measureSnap, measurement } from "../src/core/measure";
import { v, dist, Vec } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
const near = (p: Vec, q: Vec, tol = 0.5): boolean => dist(p, q) <= tol;
const fmt = (p: Vec): string => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;

const W = 4000, D = 3000, TH = 100;

/** A closed 4000x3000 rectangle of 100 walls, node 0 at the origin. */
function rectFloor(): Floor {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(W, 0), v(W, D), v(0, D)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    f.walls.push({
      id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!,
      thickness: TH, bulge: 0, openings: [],
    } satisfies Wall);
  }
  return f;
}

const targetsOf = (f: Floor) => measureTargets(f, resolveFloor(f));
const opts = { tolCorner: 30, tolEdge: 20, grid: 1 };

// ---- what the tape lands on -------------------------------------------------

{
  const f = rectFloor();
  const t = targetsOf(f);
  const has = (p: Vec) => t.corners.some(c => near(c, p));

  check("a node is a corner", has(v(0, 0)));
  check("the mitered outer corner is a corner", has(v(-TH / 2, -TH / 2)));
  check("the mitered inner corner is a corner", has(v(TH / 2, TH / 2)));

  // The inner face of the top wall runs along y = 50; a cursor 8 mm off it
  // lands on it, not on the centerline 42 mm away.
  const face = measureSnap(t, v(1000, 58), opts);
  check("a wall face is an edge target", face.kind === "edge" && near(face.p, v(1000, TH / 2)), fmt(face.p));
  const axis = measureSnap(t, v(1000, 6), opts);
  check("the centerline is reachable between its nodes", axis.kind === "edge" && near(axis.p, v(1000, 0)), fmt(axis.p));

  const corner = measureSnap(t, v(40, 60), opts);
  check("a corner within reach wins over the faces beside it",
    corner.kind === "corner" && near(corner.p, v(TH / 2, TH / 2)), fmt(corner.p));

  const free = measureSnap(t, v(1500.4, 1500.6), opts);
  check("open floor reads as whole millimetres", free.kind === "free" && near(free.p, v(1500, 1501)), fmt(free.p));
  const grid = measureSnap(t, v(1540, 1560), { ...opts, grid: 100 });
  check("with a grid the open floor quantises to it", grid.kind === "grid" && near(grid.p, v(1500, 1600)), fmt(grid.p));
}

// ---- jambs -------------------------------------------------------------------

{
  const f = rectFloor();
  const top = f.walls[0]!;
  top.openings.push({ id: newId("o"), kind: "door", t: 2000, width: 900, sashes: [] });
  const t = targetsOf(f);
  const jamb = measureSnap(t, v(1560, 45), opts);
  check("a jamb is a corner", jamb.kind === "corner" && near(jamb.p, v(1550, TH / 2)), fmt(jamb.p));
  const other = measureSnap(t, v(2440, 55), opts);
  check("and so is the opposite one", other.kind === "corner" && near(other.p, v(2450, TH / 2)), fmt(other.p));
  check("the reading between them is the dagmaat", measurement(jamb.p, other.p).length === 900);
}

// ---- the second end ----------------------------------------------------------

{
  const f = rectFloor();
  const t = targetsOf(f);
  const from = v(1000, 1000);

  // Square to the top wall: the foot of the perpendicular onto its inner face
  // is offered as a corner, and the reading is the clear distance.
  const foot = measureSnap(t, v(1012, 64), { ...opts, from });
  check("the perpendicular foot on a face is a corner target",
    foot.kind === "corner" && near(foot.p, v(1000, TH / 2)), fmt(foot.p));
  check("which reads the clear distance to the wall", measurement(from, foot.p).length === 950);

  // The lock holds the second end to a ray from the first. Where the ray meets
  // an edge near the cursor the end lands there; otherwise it is the length
  // along the ray, quantised.
  const hit = measureSnap(t, v(3940, 1090), { ...opts, from, ortho: true });
  check("under the lock a ray meets the face it is aimed at",
    hit.kind === "edge" && near(hit.p, v(W - TH / 2, 1000)), fmt(hit.p));
  const along = measureSnap(t, v(2000, 1090), { ...opts, from, ortho: true, grid: 100 });
  check("or stops at the grid length along the ray",
    along.kind === "grid" && near(along.p, v(2000, 1000)), fmt(along.p));
  const diag = measureSnap(t, v(1700, 1720), { ...opts, from, ortho: true });
  const legs = measurement(from, diag.p);
  check("the eight directions include the diagonals, with equal whole legs",
    diag.kind === "free" && legs.dx === legs.dy && Number.isInteger(diag.p.x) && Number.isInteger(diag.p.y), fmt(diag.p));
  // On a diagonal it is the legs that sit on the grid, so the end is a grid
  // point; a whole length would put it between two.
  const diagGrid = measureSnap(t, v(1700, 1720), { ...opts, from, ortho: true, grid: 100 });
  check("with a grid a diagonal end lands on a grid point",
    diagGrid.kind === "grid" && near(diagGrid.p, v(1700, 1700)), fmt(diagGrid.p));

  // A corner near the raw cursor still wins under the lock, as it does for a
  // chained wall.
  const locked = measureSnap(t, v(60, 40), { ...opts, from, ortho: true });
  check("a corner under the cursor beats the ray",
    locked.kind === "corner" && near(locked.p, v(TH / 2, TH / 2)), fmt(locked.p));
}

// ---- objects on the plan -----------------------------------------------------

{
  const f = rectFloor();
  f.structure = [{ kind: "column", id: newId("c"), x: 2000, y: 1500, rotation: 0, shape: "rect", width: 300, depth: 300 }];
  f.routes = [{
    id: newId("r"), discipline: "electrical",
    points: [{ id: "p1", x: 500, y: 500 }, { id: "p2", x: 1500, y: 500 }],
    segments: [{ id: "s1", a: "p1", b: "p2" }],
  }];
  const t = targetsOf(f);

  const c = measureSnap(t, v(1845, 1345), opts);
  check("a column's corner is a target", c.kind === "corner" && near(c.p, v(1850, 1350)), fmt(c.p));
  // The side between two corners exists only if the box was rung in traversal
  // order; column by column would draw the diagonal instead.
  const side = measureSnap(t, v(2000, 1342), opts);
  check("and so is the side between two of them", side.kind === "edge" && near(side.p, v(2000, 1350)), fmt(side.p));

  const run = measureSnap(t, v(1000, 508), opts);
  check("a run is an edge target", run.kind === "edge" && near(run.p, v(1000, 500)), fmt(run.p));
  const end = measureSnap(t, v(1490, 510), opts);
  check("its waypoint is a corner", end.kind === "corner" && near(end.p, v(1500, 500)), fmt(end.p));
}

// ---- a curved wall -----------------------------------------------------------

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push({ id: "a", x: 0, y: 0 }, { id: "b", x: 2000, y: 0 });
  // bulge 0.5 bows 500 toward perp(chord) = +y: the arc's midpoint is (1000, 500).
  f.walls.push({ id: "w", a: "a", b: "b", thickness: TH, bulge: 0.5, openings: [] });
  const t = targetsOf(f);
  const arc = measureSnap(t, v(1000, 506), opts);
  check("a curved centerline is reachable along its chords", arc.kind === "edge" && near(arc.p, v(1000, 500), 2.5), fmt(arc.p));
}

// ---- the figure ----------------------------------------------------------------

{
  const m = measurement(v(0, 0), v(3000, 4000));
  check("length is the diagonal", m.length === 5000);
  check("dx and dy are the legs", m.dx === 3000 && m.dy === 4000);
  const back = measurement(v(3000, 4000), v(0, 0));
  check("the legs are unsigned", back.dx === 3000 && back.dy === 4000);
  check("the figure is whole millimetres", measurement(v(0, 0), v(10.4, 0.3)).length === 10);
}

console.log(failures === 0 ? "ALL MEASURE TESTS PASSED" : `${failures} MEASURE TEST FAILURES`);
process.exit(failures === 0 ? 0 : 1);
