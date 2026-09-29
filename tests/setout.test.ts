// Setting-out dimensions: the distances from a placed item to the structural
// wall faces around it. They are derived from the resolved plan; the item only
// states that it wants them.
import { emptyDoc, newId, Floor, Wall, SymbolInstance, type PlanDoc } from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { setOutDims } from "../src/core/setout";
import { toSvg } from "../src/io/svg";
import { toDxf } from "../src/io/dxf";
import { v, dist } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const W = 4000, D = 3000, TH = 100;

/** A closed 4000x3000 room of 100 walls. Wall 3 is the left one, running a=(0,D) to b=(0,0). */
function room(): { doc: PlanDoc; f: Floor } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(W, 0), v(W, D), v(0, D)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    f.walls.push({
      id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: TH, bulge: 0, openings: [],
    } satisfies Wall);
  }
  return { doc, f };
}

function socket(f: Floor, x: number, y: number, rotation = 0): SymbolInstance {
  const s: SymbolInstance = { id: newId("s"), type: "smoke-detector", x, y, rotation, setOut: true };
  f.symbols.push(s);
  return s;
}

const dimsOf = (f: Floor, s: SymbolInstance) => setOutDims(f, resolveFloor(f), s);

// 1200 from the left inner face (x = 50), 850 from the top one (y = 50).
{
  const { f } = room();
  const s = socket(f, 1250, 900);
  const dims = dimsOf(f, s);
  check("one dimension per axis", dims.length === 2);
  const left = dims.find(d => d.to.x < s.x);
  const top = dims.find(d => d.to.y < s.y);
  check("the shorter hit of each pair is kept", left?.lengthMm === 1200 && top?.lengthMm === 850,
    dims.map(d => d.lengthMm).join(","));
  check("the ray ends on the inner face", left !== undefined && Math.abs(left.to.x - 50) < 0.5
    && top !== undefined && Math.abs(top.to.y - 50) < 0.5);
  check("the dimension starts at the anchor", dims.every(d => dist(d.from, v(s.x, s.y)) === 0));
  const wallAt = (px: number, py: number): string | undefined =>
    f.walls.find(w => {
      const a = f.nodes.find(n => n.id === w.a)!, b = f.nodes.find(n => n.id === w.b)!;
      return Math.abs((a.x + b.x) / 2 - px) < 1 && Math.abs((a.y + b.y) / 2 - py) < 1;
    })?.id;
  check("each dimension names the wall it meets",
    left?.wallId === wallAt(0, D / 2) && top?.wallId === wallAt(W / 2, 0));
}

// A wall-snapped item stands on its host: only the run along the wall is measured.
{
  const { f } = room();
  const s = socket(f, 1250, TH / 2);
  s.wallId = f.walls[0]!.id;
  const dims = dimsOf(f, s);
  check("a wall-snapped item yields one dimension, along its wall",
    dims.length === 1 && dims[0]!.lengthMm === 1200, JSON.stringify(dims.map(d => d.lengthMm)));
  check("none equals the host wall's thickness", dims.every(d => d.lengthMm !== TH));
}

// A doorway does not interrupt the ray: the builder sets out from the wall.
{
  const { f } = room();
  const left = f.walls[3]!;
  left.openings.push({ id: newId("o"), kind: "door", t: D - 900, width: 900, sashes: [] });
  const s = socket(f, 1250, 900);
  const d = dimsOf(f, s).find(x => x.to.x < s.x);
  check("a ray through a door measures to the wall line", d?.lengthMm === 1200, String(d?.lengthMm));
}

// Rotation carries the rays with the item.
{
  const { f } = room();
  const s = socket(f, 2000, 1500, Math.PI / 4);
  const dims = dimsOf(f, s);
  check("a rotated item measures along its own axes",
    dims.length === 2 && dims.every(d => {
      const ang = Math.atan2(d.to.y - d.from.y, d.to.x - d.from.x);
      return Math.abs(Math.cos(2 * (ang - Math.PI / 4))) > 0.999 || Math.abs(Math.sin(2 * (ang - Math.PI / 4))) > 0.999;
    }), JSON.stringify(dims.map(d => d.lengthMm)));
}

// Outside every wall: nothing to hit on one axis or both.
{
  const { f } = room();
  const outside = socket(f, W + 5000, 1500);
  check("an item beside the room yields at most one dimension", dimsOf(f, outside).length <= 1);
  const far = socket(f, 90000, 90000);
  check("an item far from every wall yields none", dimsOf(f, far).length === 0);
  const above = socket(f, 2000, -800);
  const a = dimsOf(f, above);
  check("one axis with no hit yields one dimension", a.length === 1 && a[0]!.lengthMm === 800 - TH / 2,
    JSON.stringify(a.map(d => d.lengthMm)));
}

// A build-up is drawn outside the structural face and is not measured to.
{
  const { f } = room();
  const s = socket(f, 1250, 900);
  const before = dimsOf(f, s).map(d => d.lengthMm);
  for (const w of f.walls) {
    w.material = "timber";
    w.buildUp = { left: { boards: [{ kind: "gypsum", mm: 12 }] }, right: { boards: [{ kind: "gypsum", mm: 12 }] } };
  }
  check("a build-up on the face does not change the figure",
    dimsOf(f, s).map(d => d.lengthMm).join() === before.join());
}

// Exports.
{
  const { doc, f } = room();
  socket(f, 1250, 900);
  const svg = toSvg(doc, 0) ?? "";
  check("SVG carries a setout group", svg.includes('id="setout"'));
  check("SVG carries the figure", svg.includes(">1200</text>") && svg.includes(">850</text>"));
  const dxf = toDxf(doc, 0) ?? "";
  const lines = dxf.split("\r\n");
  check("DXF declares the SETOUT layer", lines.includes("SETOUT"));
  check("DXF carries the figure on it", lines.includes("1200"));

  delete f.symbols[0]!.setOut;
  check("without the flag SVG has no setout group", !(toSvg(doc, 0) ?? "").includes('id="setout"'));
}

console.log(failures === 0 ? "ALL SETOUT TESTS PASSED" : `${failures} SETOUT TEST FAILURES`);
process.exit(failures === 0 ? 0 : 1);
