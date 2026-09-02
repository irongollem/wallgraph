// Wall face area: what a stucco, paint or wallpaper quantity is read off.
// The facts under test are the three that decide whether such a quantity is
// usable -- that the length measured is the MITERED face rather than the
// centerline, that an opening is deducted from both faces and clamped to the
// wall, and that a clad face is the one left out of the interior figure.
import {
  emptyDoc, newId, floorHeight, FLOOR_HEIGHT_DEFAULT,
  Wall, Opening, Floor,
} from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { floorSurface, wallSurface } from "../src/core/surface";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

const W = 4000, D = 3000, TH = 100;

/** A closed 4000x3000 rectangle, one node per corner, walls in order. */
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

function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

const surfaceOf = (f: Floor) => floorSurface(f, resolveFloor(f));

// ---- face lengths -----------------------------------------------------------

{
  const f = rectFloor();
  const s = surfaceOf(f);
  const h = floorHeight(f);
  check("storey height is the default", h === FLOOR_HEIGHT_DEFAULT, String(h));

  // Every corner is a right-angle miter, so one face runs long by half a
  // thickness at each end and the other is eaten in by the same: the two faces
  // of a wall differ by 2 * TH even though they sum to twice the centerline.
  const long = surfaceOf(f).walls.find(x => x.wallId === f.walls[0]!.id)!;
  const lens = long.faces.map(x => x.lengthMm).sort((a, b) => a - b);
  check("a wall's two faces are the mitered ones, not the centerline",
    near(lens[0]!, W - TH) && near(lens[1]!, W + TH), lens.join(" / "));
  check("the two faces still sum to twice the centerline",
    near(lens[0]! + lens[1]!, 2 * W), String(lens[0]! + lens[1]!));

  // Which is the inner face flips with the wall's own a->b direction, so the
  // storey total is what is stable: twice the centerline perimeter, full height.
  const perimeter = 2 * (W + D);
  check("the storey's gross area is both faces of the whole perimeter",
    near(s.grossMm2, 2 * perimeter * h, 10), String(s.grossMm2));
  check("with no openings, net equals gross", s.netMm2 === s.grossMm2);
  check("with no cladding, the inner figure is the net one", s.innerMm2 === s.netMm2);
  check("nothing is reported as clad", s.cladFaces === 0);
  check("every wall is listed", s.walls.length === 4);
  check("the per-wall figures sum to the storey's",
    near(s.walls.reduce((n, x) => n + x.netMm2, 0), s.netMm2, 1));
}

// ---- openings ---------------------------------------------------------------

{
  const f = rectFloor();
  const bare = surfaceOf(f).netMm2;
  const w = f.walls[0]!;
  const door = opening({ kind: "door", t: 2000, width: 900, height: 2315 });
  w.openings.push(door);
  const s = surfaceOf(f);
  const cut = 900 * 2315;

  check("an opening is deducted from both faces of its wall",
    near(s.openingsMm2, 2 * cut, 1), String(s.openingsMm2));
  check("net is gross less the deduction", near(s.netMm2, s.grossMm2 - 2 * cut, 1));
  check("the deduction is the whole difference from a bare storey",
    near(s.netMm2, bare - 2 * cut, 1));

  const one = s.walls.find(x => x.wallId === w.id)!;
  check("the wall carrying it reports the count", one.openings === 1);
  const others = s.walls.filter(x => x.wallId !== w.id);
  check("no other wall is touched", others.every(x => x.openingsMm2 === 0));
}

{
  // Taller than the wall: an opening cuts the wall, not more than the wall.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.height = 2000;
  w.openings.push(opening({ kind: "door", t: 2000, width: 900, height: 4000 }));
  const one = surfaceOf(f).walls.find(x => x.wallId === w.id)!;
  check("an opening taller than its wall is clamped to it",
    near(one.openingsMm2, 2 * 900 * 2000, 1), String(one.openingsMm2));
  check("a wall's own height overrides the storey's", one.heightMm === 2000);
  check("and is what its faces are measured at",
    near(one.grossMm2, 2000 * one.faces.reduce((n, x) => n + x.lengthMm, 0), 1));
}

{
  // A window's sill is below the wall head, so the whole sash is deducted; a
  // sill above it leaves nothing to deduct.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.height = 1000;
  w.openings.push(opening({ kind: "window", t: 2000, width: 1200, sillHeight: 1500, height: 1400 }));
  const one = surfaceOf(f).walls.find(x => x.wallId === w.id)!;
  check("an opening entirely above its wall deducts nothing",
    one.openingsMm2 === 0, String(one.openingsMm2));
}

// ---- cladding ---------------------------------------------------------------

{
  const f = rectFloor();
  const w = f.walls[0]!;
  w.facadeMm = 100;
  w.facadeSide = "left";
  const s = surfaceOf(f);
  const one = s.walls.find(x => x.wallId === w.id)!;
  const left = one.faces.find(x => x.side === "left")!;
  const right = one.faces.find(x => x.side === "right")!;

  check("the clad face is the stated one", left.clad && !right.clad);
  check("the storey counts one clad face", s.cladFaces === 1);
  check("the clad face is left out of the wall's inner figure",
    near(one.innerMm2, right.netMm2, 1), `${one.innerMm2} vs ${right.netMm2}`);
  check("but stays in its net area", one.netMm2 === left.netMm2 + right.netMm2);
  check("the storey's inner figure drops by that one face",
    near(s.innerMm2, s.netMm2 - left.netMm2, 1));

  // A wall that states no cladding says nothing about which face is outside,
  // so it keeps both -- the interior figure never guesses.
  const plain = s.walls.find(x => x.wallId === f.walls[1]!.id)!;
  check("a wall with no cladding contributes both faces",
    plain.innerMm2 === plain.netMm2);
}

{
  // The right side, to prove the side is read and not assumed.
  const f = rectFloor();
  const w = f.walls[0]!;
  w.facadeMm = 100;
  w.facadeSide = "right";
  const one = surfaceOf(f).walls.find(x => x.wallId === w.id)!;
  check("cladding on the right marks the right face",
    !one.faces[0]!.clad && one.faces[1]!.clad);
}

// ---- listing ----------------------------------------------------------------

{
  const f = rectFloor();
  const s = surfaceOf(f);
  const nets = s.walls.map(x => x.netMm2);
  check("walls are listed largest net area first",
    nets.every((n, i) => i === 0 || nets[i - 1]! >= n), nets.join(" / "));
}

{
  // resolveFloor() drops a wall whose nodes coincide, and a wall with no
  // geometry has no face to finish.
  const f = rectFloor();
  const id = newId("n");
  f.nodes.push({ id, x: 0, y: 0 });
  f.walls.push({ id: newId("w"), a: f.nodes[0]!.id, b: id, thickness: TH, bulge: 0, openings: [] });
  const s = surfaceOf(f);
  check("a degenerate wall is absent rather than zero-area", s.walls.length === 4);
}

{
  const doc = emptyDoc();
  const s = surfaceOf(doc.floors[0]!);
  check("an empty storey reports nothing",
    s.walls.length === 0 && s.grossMm2 === 0 && s.netMm2 === 0 && s.cladFaces === 0);
}

// ---- one wall, directly -----------------------------------------------------

{
  const f = rectFloor();
  const resolved = resolveFloor(f);
  const w = f.walls[0]!;
  const one = wallSurface(f, resolved.walls.get(w.id)!);
  const fromFloor = floorSurface(f, resolved).walls.find(x => x.wallId === w.id)!;
  check("wallSurface() and floorSurface() state the same wall identically",
    JSON.stringify(one) === JSON.stringify(fromFloor));
}

console.log(failures === 0 ? "ALL SURFACE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
