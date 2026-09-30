// Compartment boundaries: rated walls chained into runs, and where each run
// repeats its label.
import { emptyDoc, fireLabel, type FireRating, type Floor } from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { detectRooms, type Room } from "../src/core/rooms";
import {
  fireRuns, fireLayout, readableAngleDeg, FIRE_LABEL_MM, FIRE_LABEL_SIZE_MM, type FireLabel,
} from "../src/core/fire";
import { textWidth } from "../src/render/textwidth";
import { shapeOf, shapesOverlap } from "../src/geometry/overlap";
import { seedDoc } from "../src/seed";
import type { Vec } from "../src/geometry/vec";

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

const layoutOf = (f: Floor, rooms: readonly Room[] = []) => fireLayout(f, resolveFloor(f), rooms);

/** A label's rectangle from the exported constants alone: no clearance, turned by angleDeg. */
function rectOf(l: FireLabel, grow = 0) {
  const hw = textWidth(l.text, false) * FIRE_LABEL_SIZE_MM / 2 + grow, hh = FIRE_LABEL_SIZE_MM / 2 + grow;
  const a = l.angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const pt = (x: number, y: number): Vec => ({ x: l.at.x + x * c - y * s, y: l.at.y + x * s + y * c });
  return shapeOf([pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)], true);
}

/** A room stand-in: only the centroid and name are read by the layout. */
const fakeRoom = (x: number, y: number, name?: string): Room =>
  ({ centroid: { x, y }, ...(name ? { name } : {}) }) as unknown as Room;

{
  const ang = (x: number, y: number) => readableAngleDeg({ x, y });
  check("angle: +x is 0", ang(1, 0) === 0);
  check("angle: -x is 0", ang(-1, 0) === 0, String(ang(-1, 0)));
  check("angle: down is -90", ang(0, 1) === -90, String(ang(0, 1)));
  check("angle: up is -90", ang(0, -1) === -90, String(ang(0, -1)));
  check("angle: 45 degrees stays 45", Math.abs(ang(1, 1) - 45) < 1e-9);
  check("angle: 135 degrees turns to -45", Math.abs(ang(-1, 1) + 45) < 1e-9, String(ang(-1, 1)));
  const all = [ang(1, 0), ang(-1, 0), ang(0, 1), ang(0, -1), ang(1, 1), ang(-1, 1), ang(1, -1), ang(-1, -1)];
  check("every angle lies in [-90, 90)", all.every(a => a >= -90 && a < 90));
}

{
  const f = plan({ p: [0, 0], q: [FIRE_LABEL_MM * 3 + 500, 0] }, [{ id: "l", a: "p", b: "q", rating: W60 }]);
  const { labels } = layoutOf(f);
  check("an empty plan labels once per interval", labels.length === 3, String(labels.length));
  check("labels read fireLabel(rating)", labels.every(l => l.text === fireLabel(W60)));
  check("a horizontal run reads at 0 degrees", labels.every(l => l.angleDeg === 0));
  check("nominal positions are kept where nothing is in the way",
    labels.every((l, i) => Math.abs(l.at.x - (FIRE_LABEL_MM / 2 + i * FIRE_LABEL_MM)) < 1e-6));
  const halfThick = 50;
  check("a label sits beyond the wall face",
    labels.every(l => Math.abs(l.at.y) - FIRE_LABEL_SIZE_MM / 2 >= halfThick));
  const walls = [...resolveFloor(f).walls.values()].flatMap(w => w.pieces.map(p => shapeOf(p.poly, true)));
  check("no label rectangle touches the wall body",
    labels.every(l => walls.every(w => !shapesOverlap(rectOf(l), w))));

  const short = layoutOf(plan({ p: [0, 0], q: [1500, 0] }, [{ id: "s", a: "p", b: "q", rating: W60 }])).labels;
  check("a run shorter than one interval gets exactly one label at its middle",
    short.length === 1 && Math.abs(short[0]!.at.x - 750) < 1e-6, String(short.length));
  check("a degenerate run yields no labels",
    layoutOf(plan({ p: [0, 0], q: [0, 0] }, [{ id: "z", a: "p", b: "q", rating: W30 }])).labels.length === 0);
}

{
  const f = plan({ p: [0, 0], q: [0, 3000] }, [{ id: "v", a: "p", b: "q", rating: W30 }]);
  const { labels } = layoutOf(f);
  check("a vertical run reads at -90 degrees", labels.length === 1 && labels[0]!.angleDeg === -90,
    labels.map(l => l.angleDeg).join());
}

{
  const doc = seedDoc();
  const f = doc.floors[0]!;
  for (const w of f.walls) w.fireRating = W30;
  const resolved = resolveFloor(f);
  const rooms = detectRooms(f);
  const { runs, labels } = fireLayout(f, resolved, rooms);
  check("seed plan: every run has a label", runs.length > 0 && runs.every(r => r.lengthMm > 0) && labels.length >= runs.length,
    `${runs.length} runs, ${labels.length} labels`);
  const rects = labels.map(l => rectOf(l));
  let pair = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    if (shapesOverlap(rects[i]!, rects[j]!)) pair++;
  }
  check("seed plan: no two labels overlap", pair === 0, String(pair));
  const pieces = [...resolved.walls.values()].flatMap(w => w.pieces.map(p => shapeOf(p.poly, true)));
  check("seed plan: no label overlaps a wall piece", rects.every(r => pieces.every(p => !shapesOverlap(r, p))));
  const segs = runs.flatMap(r => r.pts.slice(1).map((p, i) => shapeOf([r.pts[i]!, p], false)));
  check("seed plan: no label crosses a run line", rects.every(r => segs.every(s => !shapesOverlap(r, s))));
  const again = fireLayout(f, resolved, rooms);
  check("the layout is deterministic", JSON.stringify(again) === JSON.stringify({ runs, labels }));
}

{
  // A room centred beside the wall: its name and area block is 880 mm tall and
  // 1300 mm wide at least, so a label at the wall's middle would land in it.
  const f = plan({ p: [0, 0], q: [3000, 0] }, [{ id: "w", a: "p", b: "q", rating: W30 }]);
  const room = fakeRoom(1500, 400, "Badkamer");
  const { labels } = layoutOf(f, [room]);
  const w = Math.max(textWidth("Badkamer", true) * 220, 1300);
  const box = shapeOf([
    { x: 1500 - w / 2, y: 400 - 520 }, { x: 1500 + w / 2, y: 400 - 520 },
    { x: 1500 + w / 2, y: 400 + 360 }, { x: 1500 - w / 2, y: 400 + 360 },
  ], true);
  check("a label stays out of a neighbouring room's label block",
    labels.length === 1 && labels.every(l => !shapesOverlap(rectOf(l), box)), JSON.stringify(labels));
}

{
  // Every position around the run is covered by room label blocks.
  const f = plan({ p: [0, 0], q: [2000, 0] }, [{ id: "w", a: "p", b: "q", rating: W30 }]);
  const rooms: Room[] = [];
  for (let x = -4000; x <= 6000; x += 1000) for (let y = -3000; y <= 3000; y += 600) rooms.push(fakeRoom(x, y, "Kamer"));
  const { labels } = layoutOf(f, rooms);
  check("a run with every candidate blocked still yields exactly one label", labels.length === 1, String(labels.length));
}

{
  const a = shapeOf([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 8, y: 10 }, { x: 8, y: 2 }, { x: 0, y: 2 }], true);
  const inNotch = shapeOf([{ x: 2, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 8 }, { x: 2, y: 8 }], true);
  const across = shapeOf([{ x: 5, y: -1 }, { x: 5, y: 5 }], false);
  const inside = shapeOf([{ x: 1, y: 0.5 }, { x: 2, y: 0.5 }, { x: 2, y: 1 }, { x: 1, y: 1 }], true);
  check("a polygon in a concave notch does not overlap", !shapesOverlap(a, inNotch));
  check("a segment through an edge overlaps", shapesOverlap(a, across));
  check("a polygon wholly inside overlaps", shapesOverlap(a, inside) && shapesOverlap(inside, a));
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
