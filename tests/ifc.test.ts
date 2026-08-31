// IFC export tests. A STEP file that looks fine can still be rejected by every
// viewer for a missing reference or a malformed GlobalId, so the structural
// rules are checked here rather than eyeballed.
import {
  emptyDoc, newId, floorElevation, DOOR_HEIGHT_DEFAULT, WINDOW_HEIGHT_DEFAULT,
  type Floor, type Wall, type Opening,
} from "../src/model/doc";
import { toIfc } from "../src/io/ifc";
import { v } from "../src/geometry/vec";
import { bulgeFromSagitta } from "../src/geometry/arc";

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
  check("an empty document has no walls", !bare.includes("=IFCWALL("));
  check("an empty document has no rels beyond the spine",
    !bare.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE(") && !bare.includes("=IFCRELVOIDSELEMENT(")
    && !bare.includes("=IFCRELFILLSELEMENT("));
}

// ── BIM 4: walls, openings, doors and windows ───────────────────────────────
//
// A two-storey plan: the ground floor is a closed room (one wall bulged) with
// a door, a window and a passage; the upper floor is walls only, so the
// per-storey containment scoping has something to prove.
{
  function addRect(f: Floor, offset: number): Wall[] {
    const pts = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)];
    const ids = pts.map(p => {
      const id = newId("n");
      f.nodes.push({ id, x: p.x + offset, y: p.y + offset });
      return id;
    });
    const walls: Wall[] = [];
    for (let i = 0; i < 4; i++) {
      const wall: Wall = { id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 300, bulge: 0, openings: [] };
      f.walls.push(wall);
      walls.push(wall);
    }
    return walls;
  }

  const rich = emptyDoc();
  const ground = rich.floors[0]!;
  ground.name = "Begane grond";
  const groundWalls = addRect(ground, 0);
  // Bulge the top wall (index 2) without moving its endpoints.
  groundWalls[2]!.bulge = bulgeFromSagitta(v(4000, 3000), v(0, 3000), 400);

  const door: Opening = { id: newId("o"), kind: "door", t: 1000, width: 900, sashes: [{ action: "turn", hinge: "b" }] };
  const window: Opening = {
    id: newId("o"), kind: "window", t: 1500, width: 1200,
    sashes: [{ action: "fixed" }, { action: "turn", hinge: "a" }],
  };
  const passage: Opening = { id: newId("o"), kind: "passage", t: 2000, width: 900, sashes: [] };
  groundWalls[0]!.openings.push(door);
  groundWalls[1]!.openings.push(window);
  groundWalls[2]!.openings.push(passage);

  const upper: Floor = {
    id: newId("f"), name: "Verdieping", nodes: [], walls: [], symbols: [],
    stairs: [], vides: [], cabinets: [], roomNames: [],
  };
  addRect(upper, 100);
  rich.floors.push(upper);

  const totalWalls = ground.walls.length + upper.walls.length;
  const totalOpenings = 3;

  const richText = toIfc(rich);
  const richLines = richText.split("\n");
  const richEntities = richLines.filter(l => l.startsWith("#"));
  const richCountOf = (type: string): number => richEntities.filter(l => l.includes(`=${type}(`)).length;
  const refsIn = (line: string): Set<number> => new Set([...line.matchAll(/#(\d+)/g)].map(m => Number(m[1])));
  const idsOf = (type: string): number[] => {
    const re = new RegExp(`^#(\\d+)=${type}\\(`);
    const out: number[] = [];
    for (const l of richEntities) { const m = re.exec(l); if (m) out.push(Number(m[1])); }
    return out;
  };

  // ── wall cardinality and GlobalId stability ─────────────────────────────
  check("IFCWALL count equals the wall count", richCountOf("IFCWALL") === totalWalls, String(richCountOf("IFCWALL")));
  {
    const guidsOf = (t: string): string[] => richEntities
      .map(l => new RegExp(`^#\\d+=${t}\\('([^']*)'`).exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => m[1]!);
    const wallGuids = guidsOf("IFCWALL");
    check("every wall GlobalId is present and unique",
      wallGuids.length === totalWalls && new Set(wallGuids).size === totalWalls, String(wallGuids.length));
    const again = toIfc(rich);
    const againGuids = again.split("\n")
      .map(l => /^#\d+=IFCWALL\('([^']*)'/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => m[1]!);
    check("wall GlobalIds are stable across a re-export",
      JSON.stringify([...wallGuids].sort()) === JSON.stringify([...againGuids].sort()));
  }

  // ── opening / void cardinality ───────────────────────────────────────────
  check("IFCOPENINGELEMENT count equals the opening count",
    richCountOf("IFCOPENINGELEMENT") === totalOpenings, String(richCountOf("IFCOPENINGELEMENT")));
  check("one IFCRELVOIDSELEMENT per opening",
    richCountOf("IFCRELVOIDSELEMENT") === totalOpenings, String(richCountOf("IFCRELVOIDSELEMENT")));

  // ── door / window fills ──────────────────────────────────────────────────
  check("exactly one IFCDOOR (the passage fills neither)", richCountOf("IFCDOOR") === 1);
  check("exactly one IFCWINDOW (the passage fills neither)", richCountOf("IFCWINDOW") === 1);

  const doorLine = richEntities.find(l => l.includes("=IFCDOOR("));
  const windowLine = richEntities.find(l => l.includes("=IFCWINDOW("));
  check("the door carries .SINGLE_SWING_RIGHT. (hinge b)",
    !!doorLine && doorLine.includes(".SINGLE_SWING_RIGHT."), doorLine);
  check("the window carries .DOUBLE_PANEL_VERTICAL. (2 sashes)",
    !!windowLine && windowLine.includes(".DOUBLE_PANEL_VERTICAL."), windowLine);
  check("the door's OverallHeight/OverallWidth are serialized as reals",
    !!doorLine && doorLine.includes(`,${DOOR_HEIGHT_DEFAULT}.,900.,`), doorLine);
  check("the window's OverallHeight/OverallWidth are serialized as reals",
    !!windowLine && windowLine.includes(`,${WINDOW_HEIGHT_DEFAULT}.,1200.,`), windowLine);

  // ── file-level integrity, same checks as the spine, over the rich plan ──
  {
    const defined = new Set<number>();
    for (const l of richEntities) { const m = /^#(\d+)=/.exec(l); if (m) defined.add(Number(m[1])); }
    const referenced = new Set<number>();
    for (const l of richEntities) {
      for (const m of l.slice(l.indexOf("=") + 1).matchAll(/#(\d+)/g)) referenced.add(Number(m[1]));
    }
    const dangling = [...referenced].filter(id => !defined.has(id));
    check("every #n referenced is defined (rich plan)", dangling.length === 0, dangling.join(","));
  }
  {
    const open = (richText.match(/\(/g) ?? []).length;
    const close = (richText.match(/\)/g) ?? []).length;
    check("parens balance (rich plan)", open === close, `${open} open, ${close} close`);
  }
  check("no NaN in the rich plan", !richText.includes("NaN"));
  check("no byte over 126 in the rich plan", [...richText].every(ch => ch.codePointAt(0)! <= 126));
  {
    const again = toIfc(rich);
    const a = richText.split("\n"), b = again.split("\n");
    const diffLines = a.length === b.length
      ? a.map((l, i) => l === b[i] || l.startsWith("FILE_NAME(") ? null : i).filter((i): i is number => i !== null)
      : [-1];
    check("two rich exports are byte-identical apart from FILE_NAME's timestamp",
      diffLines.length === 0, diffLines.join(","));
  }

  // ── containment scoping ────────────────────────────────────────────────
  {
    const containmentLines = richEntities.filter(l => l.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE("));
    check("one containment rel per storey that has elements",
      containmentLines.length === 2, String(containmentLines.length));
    const containmentRefs = containmentLines.map(refsIn);
    const wallIds = idsOf("IFCWALL");
    const openingIds = idsOf("IFCOPENINGELEMENT");
    check("every wall is contained in exactly one storey's rel",
      wallIds.every(id => containmentRefs.filter(s => s.has(id)).length === 1));
    check("no opening element appears in any containment rel",
      openingIds.every(id => containmentRefs.every(s => !s.has(id))));
  }

  // ── geometry shape ────────────────────────────────────────────────────
  {
    const polylines = richEntities.filter(l => l.includes("=IFCPOLYLINE("));
    check("every profile polyline is closed (repeats its first point)",
      polylines.length > 0 && polylines.every(l => {
        const body = l.slice(l.indexOf("=IFCPOLYLINE(") + "=IFCPOLYLINE(".length);
        const ids = [...body.matchAll(/#(\d+)/g)].map(m => Number(m[1]));
        return ids.length >= 4 && ids[0] === ids[ids.length - 1];
      }));
    const extrusions = richEntities.filter(l => l.includes("=IFCEXTRUDEDAREASOLID("));
    check("every extrusion's depth is positive",
      extrusions.length > 0 && extrusions.every(l => {
        const m = /,(-?\d+\.?\d*(?:E[+-]?\d+)?)\);$/.exec(l);
        return m !== null && Number(m[1]) > 0;
      }));
  }
}

console.log(failures === 0 ? "ALL IFC TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
