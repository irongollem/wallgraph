// SVG export tests. The file is artwork rather than geometry, so what matters
// is that it is well-formed, at true scale, and carries no NaN — a single NaN
// in a path silently drops that whole path in every renderer.
import { seedDoc } from "../src/seed";
import { emptyDoc } from "../src/model/doc";
import { toSvg } from "../src/io/svg";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const svg = toSvg(seedDoc(), 0);
check("a plan produces SVG", typeof svg === "string" && svg.length > 0);
check("an empty document produces nothing", toSvg(emptyDoc(), 0) === null);
const s = svg ?? "";

check("declares the SVG namespace", s.includes('xmlns="http://www.w3.org/2000/svg"'));

// Tags must balance, or the file will not parse at all.
{
  const open = (s.match(/<(?!\/)(?!\?)[a-z]/g) ?? []).length;
  const close = (s.match(/<\//g) ?? []).length;
  const selfClose = (s.match(/\/>/g) ?? []).length;
  check("tags balance", open === close + selfClose, `${open} open, ${close} close, ${selfClose} self-closing`);
}

// True scale is the reason to export SVG rather than PNG: width in millimetres
// with a viewBox matching one-to-one means printing at 100% gives real size.
{
  const m = s.match(/width="([\d.]+)mm" height="([\d.]+)mm" viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
  check("width and height are in millimetres", m !== null);
  if (m) {
    check("viewBox matches the physical size 1:1",
      Math.abs(Number(m[1]) - Number(m[5])) < 0.01 && Math.abs(Number(m[2]) - Number(m[6])) < 0.01,
      `${m[1]}x${m[2]}mm vs viewBox ${m[5]}x${m[6]}`);
  }
}

// One NaN drops a whole path without any error being reported.
check("no NaN or Infinity in path data", !/NaN|Infinity/.test(s));

// The layer groups a document tool needs in order to restyle the drawing.
for (const id of ["rooms", "walls", "openings", "symbols", "labels"])
  check(`has a ${id} group`, s.includes(`id="${id}"`));

// A window that exports as a bare gap reads as a doorway; the frame is what
// distinguishes them.
{
  const openings = s.slice(s.indexOf('id="openings"'), s.indexOf('id="symbols"'));
  const paths = (openings.match(/<path/g) ?? []).length;
  // The demo has 5 openings: 2 jambs each, plus frames and glass for 2 windows,
  // plus leaf and arc for 3 doors.
  check("openings carry more than bare jambs", paths >= 16, `${paths} paths`);
}

// SVG shares the document's y-down axis, so nothing should be flipped: the
// plan's own coordinates must appear as they are.
{
  const vb = s.match(/viewBox="([-\d.]+) ([-\d.]+)/);
  check("viewBox origin sits above-left of the plan with a margin",
    vb !== null && Number(vb[1]) < 0 && Number(vb[2]) < 0, vb ? `${vb[1]},${vb[2]}` : "");
}

console.log(failures === 0 ? "ALL SVG TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
