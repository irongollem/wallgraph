// Permit sheet tests: the layout picks a real sheet at a standard scale, the
// SVG is well-formed paper (page millimetres, no NaN), the title block carries
// what the document states, and the checklist reports without blocking.
import { seedDoc } from "../src/seed";
import { emptyDoc, newId } from "../src/model/doc";
import { permitLayout, permitChecklist, PERMIT_SCALES, FRAME_MM, STRIP_MM } from "../src/core/permit";
import { permitSvg } from "../src/io/permit";
import { toSvg } from "../src/io/svg";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

// ── layout ──────────────────────────────────────────────────────────────────

const ISO = { a4: [210, 297], a3: [297, 420] } as const;

{
  const layout = permitLayout(seedDoc(), 0);
  check("a plan lays out", layout !== null);
  if (layout) {
    check("the scale is a standard one", PERMIT_SCALES.includes(layout.scale), String(layout.scale));
    const [pw, ph] = ISO[layout.paper];
    const long = Math.max(layout.pageW, layout.pageH), short = Math.min(layout.pageW, layout.pageH);
    check("the page is a real ISO sheet", short === pw && long === ph, `${layout.pageW}x${layout.pageH}`);
    check("the demo plan fits its sheet", layout.fits);
    check("the drawing area leaves the strip",
      layout.drawing.h === layout.frame.h - STRIP_MM && layout.frame.x === FRAME_MM);
    check("the placed extent fits the drawing area",
      layout.extent.w / layout.scale <= layout.drawing.w + 0.01
      && layout.extent.h / layout.scale <= layout.drawing.h + 0.01);
  }
  check("an empty document lays out nothing", permitLayout(emptyDoc(), 0) === null);
}

// A plan too large for A3 at 1:100 steps to the coarser standard scale rather
// than refusing or shrinking to a non-standard one.
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const n0 = { id: newId("n"), x: 0, y: 0 };
  const n1 = { id: newId("n"), x: 60000, y: 0 };
  const n2 = { id: newId("n"), x: 60000, y: 30000 };
  const n3 = { id: newId("n"), x: 0, y: 30000 };
  f.nodes.push(n0, n1, n2, n3);
  const wall = (a: string, b: string) =>
    ({ id: newId("w"), a, b, thickness: 300, bulge: 0, openings: [] });
  f.walls.push(wall(n0.id, n1.id), wall(n1.id, n2.id), wall(n2.id, n3.id), wall(n3.id, n0.id));
  const layout = permitLayout(doc, 0);
  check("a 60 m building lays out", layout !== null);
  if (layout) check("a 60 m building takes 1:200", layout.scale === 200, String(layout.scale));
}

// ── sheet SVG ───────────────────────────────────────────────────────────────

const sheet = permitSvg(seedDoc(), 0) ?? "";
check("a plan produces a sheet", sheet.length > 0);
check("an empty document produces no sheet", permitSvg(emptyDoc(), 0) === null);
check("no NaN or Infinity in the sheet", !/NaN|Infinity/.test(sheet));

{
  const open = (sheet.match(/<(?!\/)(?!\?)[a-z]/g) ?? []).length;
  const close = (sheet.match(/<\//g) ?? []).length;
  const selfClose = (sheet.match(/\/>/g) ?? []).length;
  check("sheet tags balance", open === close + selfClose, `${open} open, ${close} close, ${selfClose} self`);
}

// Page millimetres: printing at 100% yields the stated scale, so the width and
// viewBox must agree one-to-one exactly as the plain SVG export's do.
{
  const m = sheet.match(/width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  check("the page is sized in millimetres", m !== null);
  if (m) check("the viewBox is the page 1:1",
    Math.abs(Number(m[1]) - Number(m[3])) < 0.01 && Math.abs(Number(m[2]) - Number(m[4])) < 0.01);
}

for (const id of ["plan", "dimensions", "scalebar", "titleblock"])
  check(`the sheet has a ${id} group`, sheet.includes(`id="${id}"`));

// The plan group embeds the same drawing the plain export emits.
check("the sheet carries the walls group", sheet.includes(`id="walls"`));
check("the sheet states its scale", /1:(100|200)/.test(sheet));

// ── north arrow ─────────────────────────────────────────────────────────────

{
  check("no stated north, no arrow", !sheet.includes(`id="north"`));
  const doc = seedDoc();
  doc.northDeg = 45;
  const withNorth = permitSvg(doc, 0) ?? "";
  check("a stated north draws the arrow", withNorth.includes(`id="north"`));
  check("the arrow turns to the stated degrees", withNorth.includes("rotate(45"));
}

// ── title block ─────────────────────────────────────────────────────────────

{
  const doc = seedDoc();
  doc.project = { name: "Villa T&J", address: "Dorpsstraat 1, Zoetermeer", number: "2026-01", author: "J. Ernst" };
  const out = permitSvg(doc, 0) ?? "";
  check("the title block states the project", out.includes("Villa T&amp;J"));
  check("the title block states the address", out.includes("Dorpsstraat 1, Zoetermeer"));
  check("the title block states the number", out.includes("2026-01"));
  check("the title block states the author", out.includes("J. Ernst"));
  check("the title block names the storey", out.includes(doc.floors[0]!.name));
}

// ── checklist ───────────────────────────────────────────────────────────────

{
  const doc = seedDoc();
  const by = (id: string) => permitChecklist(doc, 0).find(c => c.id === id)!;
  check("the checklist reports five checks", permitChecklist(doc, 0).length === 5);
  check("no title-block data reads as missing", !by("title").ok);
  check("no stated north reads as missing", !by("north").ok);
  doc.project = { name: "Villa", address: "Dorpsstraat 1" };
  doc.northDeg = 0;
  check("filled title-block data reads as present", by("title").ok);
  check("a stated north reads as present, 0 included", by("north").ok);
  check("the fitting demo passes the paper check", by("paper").ok);
  // Reporting, not enforcing: the sheet still exports with checks failing.
  const bare = seedDoc();
  check("an incomplete plan still exports", (permitSvg(bare, 0) ?? "").length > 0);
}

// The refactor split the plain export in two; it must still emit whole.
check("the plain SVG export still carries its groups",
  ["rooms", "walls", "openings", "symbols", "labels"]
    .every(id => (toSvg(seedDoc(), 0) ?? "").includes(`id="${id}"`)));

console.log(failures === 0 ? "ALL PERMIT TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
