// DXF export tests. The format is unforgiving in ways that produce a file which
// looks fine and that no CAD package will open, so these check the structural
// rules as well as the geometry.
import { seedDoc } from "../src/seed";
import { emptyDoc } from "../src/model/doc";
import { toDxf } from "../src/io/dxf";
import { SYMBOLS } from "../src/render/symbols";
import { recordSymbol } from "../src/io/record";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const dxf = toDxf(seedDoc(), 0);
check("a plan produces DXF", typeof dxf === "string" && dxf.length > 0);
check("an empty document produces nothing", toDxf(emptyDoc(), 0) === null);

const lines = (dxf ?? "").split("\r\n").filter(l => l !== "");

// The whole format is (group code, value) pairs; a stray line shifts everything
// after it and the file becomes gibberish.
{
  const bad = lines.filter((_, i) => i % 2 === 0 && !/^-?\d+$/.test(lines[i]!));
  check("group codes and values strictly alternate", bad.length === 0, bad.slice(0, 3).join(","));
}
{
  const open = lines.filter((l, i) => l === "SECTION" && lines[i - 1] === "0").length;
  const close = lines.filter((l, i) => l === "ENDSEC" && lines[i - 1] === "0").length;
  check("sections balance", open === close && open === 3, `${open}/${close}`);
  check("file ends with EOF", lines[lines.length - 1] === "EOF");
}

check("declares millimetres", (dxf ?? "").includes("$INSUNITS"));
check("declares a DXF version with LWPOLYLINE", (dxf ?? "").includes("AC1015"));

// R13+ requires a subclass marker on every entity and a handle on every object.
// Without them ezdxf refuses the file with "missing AcDbPolyline subclass".
{
  const entities = ["LWPOLYLINE", "LINE", "ARC", "TEXT"];
  let missing = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] !== "0" || !entities.includes(lines[i + 1]!)) continue;
    const window = lines.slice(i, i + 12);
    if (!window.includes("AcDbEntity") || window[2] !== "5") missing++;
  }
  check("every entity carries a handle and AcDbEntity", missing === 0, `${missing} without`);
  check("polylines carry AcDbPolyline", (dxf ?? "").includes("AcDbPolyline"));
  check("arcs carry AcDbCircle and AcDbArc",
    (dxf ?? "").includes("AcDbCircle") && (dxf ?? "").includes("AcDbArc"));
}

// DXF is y-up and the document is y-down. Getting this wrong mirrors the plan,
// which still looks like a floorplan — so it is asserted, not eyeballed.
{
  const ys: number[] = [];
  for (let i = 0; i < lines.length - 1; i++)
    if (lines[i] === "20") ys.push(Number(lines[i + 1]));
  check("y is flipped: the plan lies below the axis",
    ys.length > 0 && Math.min(...ys) < -5000 && Math.max(...ys) <= 200,
    `min ${Math.min(...ys)} max ${Math.max(...ys)}`);
}

// A door swings a quarter turn. DXF arcs run counter-clockwise from 50 to 51
// with no direction flag, so emitting the pair in a fixed order silently draws
// the complementary arc — a 90 degree swing becomes 270.
{
  const sweeps: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] !== "0" || lines[i + 1] !== "ARC") continue;
    const seg = lines.slice(i, i + 24);
    const at = (c: string): number => Number(seg[seg.indexOf(c) + 1]);
    sweeps.push(((at("51") - at("50")) % 360 + 360) % 360);
  }
  check("door swings are quarter circles", sweeps.length > 0 && sweeps.every(s => Math.abs(s - 90) < 0.5),
    sweeps.map(s => s.toFixed(1)).join(","));
}

// Every symbol has to survive being replayed through the recorder, or it simply
// vanishes from the export with no error.
{
  let empty = 0, broken = 0;
  for (const s of SYMBOLS) {
    let prims;
    try { prims = recordSymbol(s, 0, 0, 0.7, true); } catch { broken++; continue; }
    if (prims.length === 0) empty++;
    for (const p of prims)
      if (p.kind === "poly" && p.pts.some(q => !isFinite(q.x) || !isFinite(q.y))) broken++;
  }
  check("every symbol replays to geometry", empty === 0 && broken === 0,
    `${empty} empty, ${broken} broken of ${SYMBOLS.length}`);
}

console.log(failures === 0 ? "ALL DXF TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
