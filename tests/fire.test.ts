// Compartment boundaries: rated walls chained into runs, and where each run
// repeats its label.
import { emptyDoc, fireLabel, type FireRating, type Floor } from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { fireRuns, fireLabels, FIRE_LABEL_MM, FIRE_LABEL_OFFSET_MM } from "../src/core/fire";
import { distToSeg, type Vec } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const W30: FireRating = { kind: "wbdbo", minutes: 30 };
const W60: FireRating = { kind: "wbdbo", minutes: 60 };

type Spec = { id: string; a: string; b: string; rating?: FireRating; bulge?: number };

function plan(nodes: Record<string, [number, number]>, walls: Spec[]): Floor {
  const f = emptyDoc().floors[0]!;
  for (const [id, [x, y]] of Object.entries(nodes)) f.nodes.push({ id, x, y });
  for (const w of walls) {
    f.walls.push({
      id: w.id, a: w.a, b: w.b, thickness: 100, bulge: w.bulge ?? 0, openings: [],
      ...(w.rating ? { fireRating: w.rating } : {}),
    });
  }
  return f;
}
const runsOf = (f: Floor) => fireRuns(f, resolveFloor(f));
const line = { n0: [0, 0], n1: [3000, 0], n2: [6000, 0], n3: [9000, 0] } as Record<string, [number, number]>;

{
  const f = plan(line, [
    { id: "w1", a: "n0", b: "n1" }, { id: "w2", a: "n1", b: "n2" },
  ]);
  check("no rated wall yields no runs", runsOf(f).length === 0);
}

{
  const f = plan(line, [
    { id: "w1", a: "n0", b: "n1", rating: W30 },
    { id: "w2", a: "n1", b: "n2", rating: W30 },
    { id: "w3", a: "n2", b: "n3", rating: W30 },
  ]);
  const runs = runsOf(f);
  check("three same-rating walls in a line are one run", runs.length === 1, String(runs.length));
  const r = runs[0]!;
  check("the run lists all three walls in order", r.wallIds.join() === "w1,w2,w3", r.wallIds.join());
  check("the run chains without a repeated junction point",
    r.pts.length === 4 && r.pts.every((p, i) => i === 0 || p.x !== r.pts[i - 1]!.x || p.y !== r.pts[i - 1]!.y));
  check("the run length is the sum of the walls", Math.abs(r.lengthMm - 9000) < 1e-6);
  check("the run carries the rating", r.rating.kind === "wbdbo" && r.rating.minutes === 30);
}

{
  // Same chain drawn against the direction of the second wall.
  const f = plan(line, [
    { id: "w1", a: "n0", b: "n1", rating: W30 },
    { id: "w2", a: "n2", b: "n1", rating: W30 },
  ]);
  const r = runsOf(f)[0]!;
  check("a wall drawn against the path is reversed to chain",
    runsOf(f).length === 1 && r.pts.map(p => p.x).join() === "0,3000,6000", r.pts.map(p => p.x).join());
}

{
  const f = plan(line, [
    { id: "w1", a: "n0", b: "n1", rating: W30 },
    { id: "w2", a: "n1", b: "n2" },
    { id: "w3", a: "n2", b: "n3", rating: W30 },
  ]);
  check("an unrated wall between two rated ones gives two runs", runsOf(f).length === 2);
}

{
  const f = plan(line, [
    { id: "w1", a: "n0", b: "n1", rating: W30 },
    { id: "w2", a: "n1", b: "n2", rating: W60 },
  ]);
  const runs = runsOf(f);
  check("different ratings at a shared node give two runs", runs.length === 2);
  check("each run keeps its own rating",
    runs.some(r => r.rating.minutes === 30) && runs.some(r => r.rating.minutes === 60));
}

{
  const f = plan({ c: [0, 0], l: [-3000, 0], r: [3000, 0], d: [0, 3000] }, [
    { id: "t1", a: "l", b: "c", rating: W30 },
    { id: "t2", a: "c", b: "r", rating: W30 },
    { id: "t3", a: "c", b: "d", rating: W30 },
  ]);
  const runs = runsOf(f);
  check("a T of three walls gives three runs, each ending at the junction", runs.length === 3, String(runs.length));
  check("no run lists all three walls", runs.every(r => r.wallIds.length < 3));
  check("every wall is in exactly one run",
    runs.flatMap(r => r.wallIds).sort().join() === "t1,t2,t3");
}

{
  const f = plan({ p: [0, 0], q: [4000, 0], r: [4000, 3000], s: [0, 3000] }, [
    { id: "a", a: "p", b: "q", rating: W30 },
    { id: "b", a: "q", b: "r", rating: W30 },
    { id: "c", a: "r", b: "s", rating: W30 },
    { id: "d", a: "s", b: "p", rating: W30 },
  ]);
  const runs = runsOf(f);
  check("a closed loop of four walls is one run", runs.length === 1 && runs[0]!.wallIds.length === 4);
  const pts = runs[0]!.pts;
  const first = pts[0]!, last = pts[pts.length - 1]!;
  check("the loop's first and last point coincide", first.x === last.x && first.y === last.y);
  check("the loop's length is its perimeter", Math.abs(runs[0]!.lengthMm - 14000) < 1e-6);
}

{
  const f = plan({ p: [0, 0], q: [4000, 0] }, [{ id: "arc", a: "p", b: "q", rating: W30, bulge: 0.5 }]);
  const r = runsOf(f)[0]!;
  check("an arc wall contributes more than two points", r.pts.length > 2, String(r.pts.length));
  check("an arc wall is longer than its chord", r.lengthMm > 4000, String(r.lengthMm));
}

{
  const distToLine = (p: Vec, pts: Vec[]): number => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSeg(p, pts[i - 1]!, pts[i]!).d);
    return best;
  };
  const shortF = plan({ p: [0, 0], q: [1500, 0] }, [{ id: "s", a: "p", b: "q", rating: W60 }]);
  const short = runsOf(shortF)[0]!;
  const sl = fireLabels(short);
  check("a run shorter than one interval gets exactly one label", sl.length === 1, String(sl.length));
  check("that label sits near the middle", Math.abs(sl[0]!.at.x - 750) < 1e-6);

  const longF = plan({ p: [0, 0], q: [FIRE_LABEL_MM * 3 + 500, 0] }, [{ id: "l", a: "p", b: "q", rating: W60 }]);
  const long = runsOf(longF)[0]!;
  const ll = fireLabels(long);
  check("a long run gets more than one label", ll.length > 1, String(ll.length));
  check("every label reads fireLabel(rating)", [...sl, ...ll].every(l => l.text === fireLabel(W60)));
  check("labels are offset clear of the line",
    ll.every(l => Math.abs(distToLine(l.at, long.pts) - FIRE_LABEL_OFFSET_MM) < 1e-6));
  check("a degenerate run yields no labels",
    fireLabels({ rating: W30, pts: [{ x: 0, y: 0 }], wallIds: [], lengthMm: 0 }).length === 0
    && fireLabels({ rating: W30, pts: [{ x: 0, y: 0 }, { x: 0, y: 0 }], wallIds: [], lengthMm: 0 }).length === 0);
}

{
  const f = plan({ c: [0, 0], l: [-3000, 0], r: [3000, 0], d: [0, 3000], e: [9000, 0], g: [12000, 0] }, [
    { id: "t3", a: "c", b: "d", rating: W30 },
    { id: "t1", a: "l", b: "c", rating: W30 },
    { id: "t2", a: "c", b: "r", rating: W30 },
    { id: "z", a: "e", b: "g", rating: W60 },
  ]);
  const a = runsOf(f).map(r => r.wallIds.join("+")).join("|");
  const b = runsOf(f).map(r => r.wallIds.join("+")).join("|");
  check("fireRuns is deterministic", a === b && a.length > 0, `${a} / ${b}`);
  check("runs are ordered by first wall id", a === "t1|t2|t3|z", a);
}

process.exit(failures === 0 ? 0 : 1);
