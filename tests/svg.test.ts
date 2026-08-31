// SVG export tests. The file is artwork rather than geometry, so what matters
// is that it is well-formed, at true scale, and carries no NaN — a single NaN
// in a path silently drops that whole path in every renderer.
import { seedDoc } from "../src/seed";
import { emptyDoc, newId } from "../src/model/doc";
import { toSvg } from "../src/io/svg";
import { COLORS } from "../src/render/draw";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const svg = toSvg(seedDoc(), 0);
check("a plan produces SVG", typeof svg === "string" && svg.length > 0);
check("an empty document produces nothing", toSvg(emptyDoc(), 0) === null);

{
  const doc = emptyDoc();
  doc.floors[0]!.symbols.push({
    id: newId("s"), type: "smoke-detector", x: 100, y: 200, rotation: 0, color: "#d0342c",
  });
  const symbolSvg = toSvg(doc, 0) ?? "";
  check("symbol-only floor produces SVG", symbolSvg.length > 0);
  check("SVG preserves semantic symbol colour", symbolSvg.includes('stroke="#d0342c"'));
  check("SVG preserves standard symbol code text", symbolSvg.includes(">RM</text>"));
}
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

// A room name carries no pen: it draws in the label grey, on the canvas and on
// the sheet alike. parseDoc accepts any JSON with a version and a floor, so a
// pasted or hand-edited document can still carry a stray `color` — nothing may
// interpolate it into a file the user hands to someone else.
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.roomNames = [
    { id: newId("rn"), name: "Woonkamer", x: 0, y: 0 },
    { id: newId("rn"), name: "Keuken", x: 2000, y: 0 },
    { id: newId("rn"), name: "Hal", x: 4000, y: 0 },
  ];
  // Not part of RoomName any more; this is what arrives from outside.
  Object.assign(f.roomNames[1]!, { color: "#zzzzzz" });
  Object.assign(f.roomNames[2]!, { color: 'red" onload="boom' });
  const out = toSvg(doc, 0) ?? "";
  check("an invalid hex is not emitted", !out.includes("#zzzzzz"));
  check("a stray colour cannot break out of an attribute", !out.includes("onload"));
  // Every name still draws.
  for (const name of ["Woonkamer", "Keuken", "Hal"])
    check(`${name} is still exported`, out.includes(`>${name}</text>`));
}

// --- wall material and pen reach the artwork ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push(
    { id: "vn0", x: 0, y: 0 }, { id: "vn1", x: 6000, y: 0 },
    { id: "vn2", x: 6000, y: 3000 }, { id: "vn3", x: 0, y: 3000 },
  );
  f.walls.push(
    // Glazed, with stijlen; a run of 6000 at 1200 divides on four of them.
    { id: "vw0", a: "vn0", b: "vn1", thickness: 100, bulge: 0, openings: [],
      material: "glass", mullionMm: 1200 },
    // Marked as work to be built: the colour takes the fill, not just the line.
    { id: "vw1", a: "vn1", b: "vn2", thickness: 300, bulge: 0, openings: [], color: "#d0342c" },
    { id: "vw2", a: "vn2", b: "vn3", thickness: 300, bulge: 0, openings: [] },
    { id: "vw3", a: "vn3", b: "vn0", thickness: 300, bulge: 0, openings: [] },
  );
  const out = toSvg(doc, 0) ?? "";
  check("a glazing group is emitted for the stijlen", out.includes('id="glazing"'));
  check("a coloured wall takes the pen as its FILL", out.includes('fill="#d0342c"'));
  check("the plan still carries a default-pen wall group",
    out.includes(COLORS.wallFill), COLORS.wallFill);
  check("the glazed body is not drawn as poche", out.includes(COLORS.glassFill));
  check("no NaN reaches a glazed wall's paths", !out.includes("NaN"));

  // A wall stating nothing keeps the artwork it had before walls could differ.
  const plainDoc = emptyDoc();
  const pf = plainDoc.floors[0]!;
  pf.nodes.push({ id: "pn0", x: 0, y: 0 }, { id: "pn1", x: 4000, y: 0 });
  pf.walls.push({ id: "pw", a: "pn0", b: "pn1", thickness: 300, bulge: 0, openings: [] });
  const plain = toSvg(plainDoc, 0) ?? "";
  check("a plan of plain walls emits no glazing group", !plain.includes('id="glazing"'));
}

console.log(failures === 0 ? "ALL SVG TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
