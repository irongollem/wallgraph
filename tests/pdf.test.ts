// PDF sheet tests. A PDF is not forgiving the way an SVG is: a cross-reference
// offset that is one byte out, or a /Length that disagrees with its stream, and
// the file does not open at all. So what is checked here is the file's own
// bookkeeping, the paper it declares, and the escaping that keeps a project
// name from ending a string literal early.
import { seedDoc } from "../src/seed";
import { emptyDoc, newId } from "../src/model/doc";
import { permitLayout } from "../src/core/permit";
import { permitPdf, permitSvg } from "../src/io/permit";
import { pdfBytes, textWidth } from "../src/io/pdf";
import { stairDefaults } from "../src/model/stair";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const PT_PER_MM = 72 / 25.4;

const pdf = permitPdf(seedDoc(), 0) ?? "";
check("a plan produces a PDF", pdf.length > 0);
check("an empty document produces no PDF", permitPdf(emptyDoc(), 0) === null);

// ── the file's own bookkeeping ───────────────────────────────────────────────

check("the file declares its version", pdf.startsWith("%PDF-1."));
check("the file ends where a reader looks for the trailer", pdf.trimEnd().endsWith("%%EOF"));
check("the sheet is one page", /\/Type \/Pages \/Kids \[3 0 R\] \/Count 1/.test(pdf));

// Every offset in the cross-reference table has to land exactly on its object;
// a reader seeks straight to it and reads whatever is there.
{
  const start = /startxref\n(\d+)\n/.exec(pdf);
  check("the trailer states where the table is", start !== null);
  const at = Number(start?.[1] ?? -1);
  check("that offset lands on the table", pdf.startsWith("xref\n", at), String(at));
  const head = /^xref\n0 (\d+)\n/.exec(pdf.slice(at));
  const count = Number(head?.[1] ?? 0);
  const rows = [...pdf.slice(at + (head?.[0].length ?? 0)).matchAll(/(\d{10}) (\d{5}) ([nf]) \n/g)]
    .slice(0, count);
  check("the table has one row per object", rows.length === count && count > 1, `${rows.length}/${count}`);
  check("object 0 is the free head", rows[0]?.[3] === "f");
  const wrong = rows.slice(1)
    .map((r, i) => ({ i: i + 1, at: Number(r[1]) }))
    .filter(o => !pdf.startsWith(`${o.i} 0 obj`, o.at));
  check("every offset lands on its object", wrong.length === 0, JSON.stringify(wrong));
  check("the trailer sizes the table", pdf.includes(`/Size ${count}`));
}

// A stream whose /Length disagrees with its content truncates or overruns.
{
  const m = /<< \/Length (\d+) >>\nstream\n/.exec(pdf);
  check("the content stream states a length", m !== null);
  if (m) {
    const body = m.index + m[0].length;
    check("the stated length reaches exactly to endstream",
      pdf.startsWith("endstream", body + Number(m[1])), m[1]);
  }
}

check("no NaN or Infinity in the content", !/NaN|Infinity/.test(pdf));

// ── the paper ────────────────────────────────────────────────────────────────

{
  const layout = permitLayout(seedDoc(), 0)!;
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf);
  check("the page states a MediaBox", box !== null);
  if (box) {
    check("the MediaBox is the sheet's paper, in points",
      Math.abs(Number(box[1]) - layout.pageW * PT_PER_MM) < 0.01
      && Math.abs(Number(box[2]) - layout.pageH * PT_PER_MM) < 0.01,
      `${box[1]}x${box[2]} vs ${layout.pageW}x${layout.pageH}mm`);
  }
  // The page transform flips y once, so the document's y-down world lands the
  // right way up on a page whose origin is bottom-left.
  check("the page transform flips y and converts to points",
    pdf.includes(`${(72 / 25.4).toFixed(4)} 0 0 -${(72 / 25.4).toFixed(4)} 0 `));
}

// The scale factor is the sheet's whole claim. Two decimals would round 1/200
// to 1/100 and draw a 60 m building at twice its stated scale.
{
  check("a 1:100 sheet places the plan at 1/100", pdf.includes("0.01 0 0 0.01 "));

  const big = emptyDoc();
  const f = big.floors[0]!;
  const ns = [[0, 0], [60000, 0], [60000, 30000], [0, 30000]]
    .map(([x, y]) => ({ id: newId("n"), x: x!, y: y! }));
  f.nodes.push(...ns);
  for (let i = 0; i < 4; i++)
    f.walls.push({ id: newId("w"), a: ns[i]!.id, b: ns[(i + 1) % 4]!.id, thickness: 300, bulge: 0, openings: [] });
  check("a 60 m building takes 1:200", permitLayout(big, 0)?.scale === 200);
  check("a 1:200 sheet places the plan at 1/200",
    (permitPdf(big, 0) ?? "").includes("0.005 0 0 0.005 "));
  check("its SVG twin scales the same",
    (permitSvg(big, 0) ?? "").includes("scale(0.005)"));
}

// ── text ─────────────────────────────────────────────────────────────────────

check("the core fonts are declared with the encoding they are measured in",
  (pdf.match(/\/BaseFont \/Helvetica(-Bold)? \/Encoding \/WinAnsiEncoding/g) ?? []).length === 2);

{
  const doc = seedDoc();
  doc.project = { name: "Villa (T&J) \\ Co", address: "Dorpsstraat 1", author: "Jasmijn Ernst", number: "2026-01" };
  const out = permitPdf(doc, 0) ?? "";
  // An unescaped bracket in a name would end the string literal early and
  // leave the rest of the title block as stray operators.
  check("a bracket in a project name is escaped", out.includes("Villa \\(T&J\\) \\\\ Co"));
  check("the escaped name still leaves the stream length right",
    (() => {
      const m = /<< \/Length (\d+) >>\nstream\n/.exec(out);
      return m !== null && out.startsWith("endstream", m.index + m[0].length + Number(m[1]));
    })());
}

{
  const doc = seedDoc();
  doc.project = { name: "Café Zoetermeer", address: "Dorpsstraat 1" };
  const out = permitPdf(doc, 0) ?? "";
  // WinAnsi puts e-acute at 0xE9; the content stream carries it as an octal
  // escape rather than as a raw byte the file would have to be read as UTF-8 for.
  check("an accented letter travels as its WinAnsi code", out.includes("Caf\\351"));
  // The information dictionary is not WinAnsi -- it is read as PDFDocEncoding,
  // which disagrees from 0x80 up -- so a title goes as UTF-16BE behind a BOM.
  check("the title is UTF-16BE behind a byte-order mark", /\/Title \(\\376\\377/.test(out));
}

// Every centred string is placed by its own width, because PDF has no anchor.
check("a wide glyph measures wider than a narrow one",
  textWidth("mmm", false) > textWidth("iii", false));
check("a digit measures at the tabular advance", Math.abs(textWidth("0", false) - 0.556) < 1e-9);
check("bold measures on its own metrics", textWidth("Wallgraph", true) > textWidth("Wallgraph", false));
check("an accented letter measures as its base letter",
  Math.abs(textWidth("é", false) - textWidth("e", false)) < 1e-9);

// ── translucency ─────────────────────────────────────────────────────────────

// A stair's wash is the one part of the drawing that is not opaque, and PDF
// carries constant alpha in a graphics-state resource rather than in the colour.
{
  check("a sheet with nothing translucent declares no graphics state",
    !pdf.includes("/ExtGState"));
  const doc = seedDoc();
  doc.floors[0]!.stairs = [{
    id: newId("t"), kind: "steektrap", x: 3000, y: 2500, rotation: 0, ...stairDefaults("steektrap"),
  }];
  const out = permitPdf(doc, 0) ?? "";
  check("a stair's wash becomes a graphics state", /\/ca 0\.4/.test(out));
  check("the wash is referenced from the content", /\/GS0 gs/.test(out));
}

// ── bytes ────────────────────────────────────────────────────────────────────

{
  const bytes = pdfBytes(pdf);
  check("one character of the file is one byte", bytes.length === pdf.length);
  check("the bytes start with the PDF magic",
    [...bytes.slice(0, 5)].join(",") === "37,80,68,70,45");
  // The header's binary comment is what marks the file as not plain text.
  check("the header carries high bytes", [...bytes.slice(10, 14)].every(b => b > 127));
}

console.log(failures === 0 ? "ALL PDF TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
