// Auto-routing along walls (issue #29).
//
// The engine proposes; the user owns the result. What these check is that the
// proposal is a sensible run along the fabric and nothing more: it follows the
// walls rather than cutting across a room, it turns at junctions, it keeps a
// stated stand-off on one side of the wall it is following, and it is plain
// waypoints -- there is no second representation to keep true afterwards.
import { emptyDoc, type Floor } from "../src/model/doc";
import { autoRoutePath, snapToFabric, offsetPolyline, AUTOROUTE_REACH_MM } from "../src/core/autoroute";
import { dist, v, type Vec } from "../src/geometry/vec";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

/** A closed rectangle of walls, corners at (0,0)-(w,h). */
function room(w: number, h: number): Floor {
  const f = emptyDoc().floors[0]!;
  const corners: Array<[number, number]> = [[0, 0], [w, 0], [w, h], [0, h]];
  corners.forEach(([x, y], i) => f.nodes.push({ id: `n${i}`, x, y }));
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: `w${i}`, a: `n${i}`, b: `n${(i + 1) % 4}`, thickness: 100, bulge: 0, openings: [] });
  }
  return f;
}

const length = (pts: Vec[]): number => {
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i]!, pts[i + 1]!);
  return total;
};

/* ── the path follows the fabric ── */

{
  const f = room(4000, 3000);
  // Two points on opposite walls of one room. The straight line between them
  // crosses the room; the proposal must not.
  const from = v(1000, 0), to = v(1000, 3000);
  const path = autoRoutePath(f, from, to)!;
  check("a path is proposed between two points on the fabric", path !== null);
  check("it starts and ends where it was asked to",
    path[0]!.x === from.x && path[0]!.y === from.y
    && path[path.length - 1]!.x === to.x && path[path.length - 1]!.y === to.y);
  check("it turns at the corners rather than cutting across the room",
    path.length > 2, JSON.stringify(path));
  check("and it is longer than the straight line, because it went round",
    length(path) > dist(from, to));
  // Left round the near corner is 1000 + 3000 + 1000; right is 3000 + 3000 + 3000.
  check("it takes the shorter way round", Math.abs(length(path) - 5000) < 1,
    String(length(path)));
  check("every waypoint is whole millimetres",
    path.every(p => Number.isInteger(p.x) && Number.isInteger(p.y)));
}

{
  const f = room(4000, 3000);
  // Two points on the SAME wall: the run is that wall's own leg, with nothing
  // in between to turn at.
  const path = autoRoutePath(f, v(500, 0), v(3000, 0))!;
  check("two points on one wall give a straight run", path.length === 2);
  check("of exactly the distance between them",
    Math.abs(length(path) - 2500) < 1, String(length(path)));
}

{
  const f = room(4000, 3000);
  check("a point far off the fabric has no path to propose",
    autoRoutePath(f, v(500, 0), v(90000, 90000)) === null);
  check("and neither does an empty plan",
    autoRoutePath(emptyDoc().floors[0]!, v(0, 0), v(1000, 1000)) === null);
}

{
  // Two rooms that share no wall: there is no route along the fabric between
  // them, and the engine says so rather than inventing one across the gap.
  const f = room(2000, 2000);
  const away: Array<[number, number]> = [[9000, 9000], [11000, 9000], [11000, 11000], [9000, 11000]];
  away.forEach(([x, y], i) => f.nodes.push({ id: `m${i}`, x, y }));
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: `v${i}`, a: `m${i}`, b: `m${(i + 1) % 4}`, thickness: 100, bulge: 0, openings: [] });
  }
  check("two unconnected pieces of fabric have no path between them",
    autoRoutePath(f, v(500, 0), v(10000, 9000)) === null);
  check("but each piece still routes within itself",
    autoRoutePath(f, v(9500, 9000), v(11000, 10000)) !== null);
}

/* ── the stand-off ── */

{
  const f = room(4000, 3000);
  const centre = autoRoutePath(f, v(1000, 0), v(1000, 3000))!;
  check("a centreline run turns on the wall lines themselves",
    JSON.stringify(centre.slice(1, -1)) === JSON.stringify([v(0, 0), v(0, 3000)]),
    JSON.stringify(centre));

  // Picked 200 mm off each wall, and asked for a 200 mm stand-off: the run
  // takes the same way round, held clear of the masonry the whole way.
  const inset = autoRoutePath(f, v(1000, 200), v(1000, 2800), { offsetMm: 200 })!;
  check("an offset run turns at the intersection of its own offset legs, not on the wall",
    JSON.stringify(inset.slice(1, -1)) === JSON.stringify([v(200, 200), v(200, 2800)]),
    JSON.stringify(inset));
  check("and it still starts and ends exactly where it was picked",
    inset[0]!.x === 1000 && inset[0]!.y === 200
    && inset[inset.length - 1]!.x === 1000 && inset[inset.length - 1]!.y === 2800);
  check("the offset run is shorter than the centreline one, being inside the corner",
    length(inset) < length(centre), `${length(inset)}/${length(centre)}`);
}

{
  // The side is taken from where the start was picked, and held for the whole
  // run -- a run that changed hands at a corner would cross through the wall.
  const line: Vec[] = [v(0, 0), v(1000, 0), v(1000, 1000)];
  const right = offsetPolyline(line, 100, 1);
  const left = offsetPolyline(line, 100, -1);
  check("the two hands fall on opposite sides", right[0]!.y === 100 && left[0]!.y === -100);
  check("the corner miters on the right hand",
    Math.abs(right[1]!.x - 900) < 1 && Math.abs(right[1]!.y - 100) < 1, JSON.stringify(right[1]));
  check("and on the left", Math.abs(left[1]!.x - 1100) < 1 && Math.abs(left[1]!.y + 100) < 1,
    JSON.stringify(left[1]));
  check("a zero offset changes nothing", offsetPolyline(line, 0, 1) === line);
}

/* ── snapping a pick onto the fabric ── */

{
  const f = room(4000, 3000);
  const on = snapToFabric(f, v(1000, 40))!;
  check("a pick near a wall lands on its centerline", on.y === 0 && Math.abs(on.x - 1000) < 1);
  check("a pick beyond the reach lands nowhere",
    snapToFabric(f, v(1000, 3000 + AUTOROUTE_REACH_MM * 2)) === null);
  check("a bowed wall is reachable too", (() => {
    f.walls[0]!.bulge = 0.4;
    return snapToFabric(f, v(2000, 300)) !== null;
  })());
}

/* ── the proposal is an ordinary run ── */

{
  const f = room(4000, 3000);
  const path = autoRoutePath(f, v(1000, 0), v(1000, 3000))!;
  // Nothing is stored beyond the waypoints: no per-leg metadata, no marker
  // that the run was proposed, nothing a later edit could contradict.
  check("what comes back is plain waypoints",
    path.every(p => Object.keys(p).sort().join(",") === "x,y"), JSON.stringify(path[0]));
  // Repeating the request gives the same run: an equal-length alternative
  // never displaces the first one found.
  check("the same request proposes the same run",
    JSON.stringify(autoRoutePath(f, v(1000, 0), v(1000, 3000))) === JSON.stringify(path));
}

/* ── both languages name the option ── */

{
  for (const lang of ["nl", "en"] as const) {
    const panel = resources[lang].translation.panel as Record<string, string>;
    check(`${lang} names the auto-routing option`,
      ["routeAuto", "routeOffset", "routeAutoNote"].every(k => typeof panel[k] === "string" && panel[k]!.length > 0));
  }
}

console.log(failures === 0 ? "ALL AUTOROUTE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
