// A window sash swings to the same side on screen (render/draw.ts) as in the
// SVG and DXF marks (io/marks.ts), whichever jamb it hinges on. Run with tsx.
import { emptyDoc, newId, type Floor, type Opening, type Sash } from "../src/model/doc";
import { resolveFloor } from "../src/core/resolve";
import { openingMarks } from "../src/io/marks";
import { recordSymbol, type Prim } from "../src/io/record";
import { drawWindow } from "../src/render/draw";
import type { Vec } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

type Seg = [Vec, Vec];
function segments(prims: Prim[]): Seg[] {
  const out: Seg[] = [];
  for (const p of prims) {
    if (p.kind === "line") out.push([p.a, p.b]);
    else if (p.kind === "poly") for (let i = 1; i < p.pts.length; i++) out.push([p.pts[i - 1]!, p.pts[i]!]);
  }
  return out;
}
const near = (a: Vec, b: Vec): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1;
const len = ([a, b]: Seg): number => Math.hypot(b.x - a.x, b.y - a.y);

function windowWall(sash: Sash): Floor {
  const f = emptyDoc().floors[0]!;
  const a = newId("n"), b = newId("n");
  f.nodes.push({ id: a, x: 0, y: 0 }, { id: b, x: 3000, y: 0 });
  const o: Opening = { id: newId("o"), kind: "window", t: 1500, width: 900, sashes: [sash] };
  f.walls.push({ id: newId("w"), a, b, thickness: 100, bulge: 0, openings: [o] });
  return f;
}

for (const outward of [false, true]) {
  const tips: number[] = [];
  for (const hinge of ["a", "b"] as const) {
    const rw = [...resolveFloor(windowWall({ action: "turn", hinge, outward })).walls.values()][0]!;
    const og = rw.openings[0]!;
    const jamb = hinge === "a" ? og.p0 : og.p1;
    // The leaf: a segment from the hinge jamb, one sash width long, leaving
    // the wall line (the glass line runs jamb to jamb along it).
    const leafOf = (segs: Seg[]): Vec | undefined => {
      for (const s of segs) {
        if (Math.abs(len(s) - 900) > 1 || Math.abs(s[1].y - s[0].y) < 1) continue;
        if (near(s[0], jamb)) return s[1];
        if (near(s[1], jamb)) return s[0];
      }
      return undefined;
    };
    const exported = leafOf(segments(openingMarks(rw)));
    const drawn = leafOf(segments(recordSymbol({ draw: ctx => drawWindow(ctx, og, 1, "#000") }, 0, 0, 0, false)));
    const tag = `hinge ${hinge}, ${outward ? "outward" : "inward"}`;
    check(`${tag}: the export draws the leaf`, exported !== undefined);
    check(`${tag}: the screen draws the same leaf as the export`,
      exported !== undefined && drawn !== undefined && near(exported, drawn),
      JSON.stringify({ exported, drawn }));
    if (drawn) tips.push(Math.sign(drawn.y));
  }
  check(`${outward ? "outward" : "inward"}: both hinges swing to the same side of the wall`,
    tips.length === 2 && tips[0] === tips[1] && tips[0] !== 0, JSON.stringify(tips));
}

if (failures > 0) { console.error(`${failures} SASH TEST(S) FAILED`); process.exit(1); }
console.log("ALL SASH TESTS PASSED");
