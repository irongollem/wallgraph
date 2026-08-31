// IFC export tests. A STEP file that looks fine can still be rejected by every
// viewer for a missing reference or a malformed GlobalId, so the structural
// rules are checked here rather than eyeballed.
import { emptyDoc, newId, floorElevation, type Floor } from "../src/model/doc";
import { toIfc } from "../src/io/ifc";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

// A document with a stated ground elevation and two storeys of different
// heights, so floorElevation() actually has something to add up.
const doc = emptyDoc();
doc.groundMm = 300;
doc.floors[0]!.name = "Begane grond";
doc.floors[0]!.height = 2600;
const upper: Floor = {
  id: newId("f"), name: "Verdieping", nodes: [], walls: [], symbols: [],
  stairs: [], vides: [], cabinets: [], roomNames: [], height: 2500,
};
doc.floors.push(upper);

const text = toIfc(doc);
const lines = text.split("\n");
const entityLines = lines.filter(l => l.startsWith("#"));

// ── framing ──────────────────────────────────────────────────────────────────

check("starts with ISO-10303-21;", lines[0] === "ISO-10303-21;");
check("ends with END-ISO-10303-21;", lines[lines.length - 2] === "END-ISO-10303-21;", lines[lines.length - 2]);
check("states the IFC4 schema", text.includes("FILE_SCHEMA(('IFC4'));"));
{
  const open = (text.match(/\(/g) ?? []).length;
  const close = (text.match(/\)/g) ?? []).length;
  check("parens balance", open === close, `${open} open, ${close} close`);
}
check("no NaN in the file", !text.includes("NaN"));
check("declares millimetres", text.includes(".MILLI.") && text.includes(".METRE."));

// ── spine cardinality ────────────────────────────────────────────────────────

const countOf = (type: string): number =>
  entityLines.filter(l => l.includes(`=${type}(`)).length;

check("exactly one IFCPROJECT", countOf("IFCPROJECT") === 1);
check("exactly one IFCSITE", countOf("IFCSITE") === 1);
check("exactly one IFCBUILDING", countOf("IFCBUILDING") === 1);
check("one IFCBUILDINGSTOREY per floor", countOf("IFCBUILDINGSTOREY") === doc.floors.length);

{
  const storeyLines = entityLines.filter(l => l.includes("=IFCBUILDINGSTOREY("));
  const elevations = [floorElevation(doc, 0), floorElevation(doc, 1)];
  const found = elevations.every(z => storeyLines.some(l => l.endsWith(`,${z}.);`)));
  check("storey elevations match floorElevation()", found, `${elevations.join(",")} in ${storeyLines.join(" | ")}`);
}

// ── referential integrity ────────────────────────────────────────────────────

{
  const defined = new Set<number>();
  for (const l of entityLines) {
    const m = /^#(\d+)=/.exec(l);
    if (m) defined.add(Number(m[1]));
  }
  const referenced = new Set<number>();
  for (const l of entityLines) {
    const args = l.slice(l.indexOf("=") + 1);
    for (const m of args.matchAll(/#(\d+)/g)) referenced.add(Number(m[1]));
  }
  const dangling = [...referenced].filter(id => !defined.has(id));
  check("every #n referenced is defined", dangling.length === 0, dangling.join(","));
}

// ── GlobalIds ────────────────────────────────────────────────────────────────

{
  const guids: string[] = [];
  for (const l of entityLines) {
    const m = /^#\d+=IFC(?:PROJECT|SITE|BUILDING|BUILDINGSTOREY|RELAGGREGATES)\('([^']*)'/.exec(l);
    if (m) guids.push(m[1]!);
  }
  check("found a GlobalId on every spine entity", guids.length === 3 + doc.floors.length + 3, String(guids.length));
  const wellFormed = guids.every(g => /^[0-9A-Za-z_$]{22}$/.test(g) && "0123".includes(g[0]!));
  check("every GlobalId is 22 IFC-alphabet chars starting 0-3", wellFormed, guids.join(","));
  check("all GlobalIds are distinct", new Set(guids).size === guids.length);
}

// ── GlobalId stability ───────────────────────────────────────────────────────

{
  const again = toIfc(doc);
  const a = text.split("\n"), b = again.split("\n");
  const diffLines = a.length === b.length
    ? a.map((l, i) => l === b[i] || l.startsWith("FILE_NAME(") ? null : i).filter((i): i is number => i !== null)
    : [-1];
  check("two exports are byte-identical apart from FILE_NAME's timestamp",
    diffLines.length === 0, diffLines.join(","));
}

// ── non-ASCII round-trip ─────────────────────────────────────────────────────

{
  const dutch = emptyDoc();
  dutch.floors[0]!.name = "Zolder-ëtage"; // Zolder-ëtage
  const out = toIfc(dutch);
  check("non-ASCII storey name is \\X2\\-encoded", out.includes("\\X2\\00EB\\X0\\"));
  check("no byte over 126 in the file", [...out].every(ch => ch.codePointAt(0)! <= 126));
}

// ── empty document ───────────────────────────────────────────────────────────

{
  const bare = toIfc(emptyDoc());
  check("an empty document still yields IFCPROJECT/SITE/BUILDING",
    bare.includes("=IFCPROJECT(") && bare.includes("=IFCSITE(") && bare.includes("=IFCBUILDING("));
  check("an empty document still yields one storey",
    (bare.match(/=IFCBUILDINGSTOREY\(/g) ?? []).length === 1);
  check("an empty document still ends the file", bare.trimEnd().endsWith("END-ISO-10303-21;"));
}

console.log(failures === 0 ? "ALL IFC TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
