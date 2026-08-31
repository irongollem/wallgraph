// IFC export tests. A STEP file that looks fine can still be rejected by every
// viewer for a missing reference or a malformed GlobalId, so the structural
// rules are checked here rather than eyeballed.
import {
  emptyDoc, newId, floorElevation, DOOR_HEIGHT_DEFAULT, WINDOW_HEIGHT_DEFAULT,
  type Floor, type Wall, type Opening, type Id,
} from "../src/model/doc";
import { toIfc } from "../src/io/ifc";
import { detectRooms } from "../src/core/rooms";
import { ifcGuid } from "../src/model/guid";
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
  check("an empty document has no spaces", !bare.includes("=IFCSPACE("));
  check("an empty document has no rels beyond the spine",
    !bare.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE(") && !bare.includes("=IFCRELVOIDSELEMENT(")
    && !bare.includes("=IFCRELFILLSELEMENT("));
  check("an empty document aggregates only the spine (no per-storey space rel)",
    (bare.match(/=IFCRELAGGREGATES\(/g) ?? []).length === 3);
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

// ── BIM 5: spaces from detected rooms ───────────────────────────────────────
//
// Two 4x3 m rooms side by side, split by a partition wall that tees into
// both the top and bottom outer walls (so each half closes into its own
// face). Only the right-hand room carries an authored name.
{
  function addNode(f: Floor, x: number, y: number): Id {
    const id = newId("n");
    f.nodes.push({ id, x, y });
    return id;
  }
  function addWall(f: Floor, a: Id, b: Id, thickness: number): void {
    f.walls.push({ id: newId("w"), a, b, thickness, bulge: 0, openings: [] });
  }

  const two = emptyDoc();
  const floor = two.floors[0]!;
  floor.name = "Begane grond";
  const n0 = addNode(floor, 0, 0), n4 = addNode(floor, 4000, 0), n1 = addNode(floor, 8000, 0);
  const n3 = addNode(floor, 0, 3000), n5 = addNode(floor, 4000, 3000), n2 = addNode(floor, 8000, 3000);
  addWall(floor, n0, n4, 300); addWall(floor, n4, n1, 300);
  addWall(floor, n1, n2, 300); addWall(floor, n2, n5, 300);
  addWall(floor, n5, n3, 300); addWall(floor, n3, n0, 300);
  addWall(floor, n4, n5, 150); // partition
  floor.roomNames = [{ id: newId("rn"), x: 6000, y: 1500, name: "Woonkamer" }];

  const rooms = detectRooms(floor);
  check("test doc encloses exactly two rooms", rooms.length === 2, String(rooms.length));
  const named = rooms.find(r => r.name === "Woonkamer");
  check("one room carries the authored name", named !== undefined);

  /** One parsed IFCSPACE: its entity id, GlobalId and raw Name argument. */
  interface ParsedSpace { id: number; guid: string; name: string }

  function parse(text: string): { entities: string[]; spaces: ParsedSpace[] } {
    const entities = text.split("\n").filter(l => l.startsWith("#"));
    const spaceRe = /^#(\d+)=IFCSPACE\('([0-9A-Za-z_$]{22})',#\d+,(\$|'[^']*'),\$,\$,#\d+,/;
    const spaces = entities.map(l => spaceRe.exec(l)).filter((m): m is RegExpExecArray => m !== null)
      .map(m => ({ id: Number(m[1]), guid: m[2]!, name: m[3]! }));
    return { entities, spaces };
  }

  /** Refs an entity's OWN argument list carries — excludes the leading `#N=`
   *  that names the entity itself, which a bare `/#(\d+)/g` over the whole
   *  line would otherwise pick up as if it were the first argument. */
  function argRefs(line: string): number[] {
    return [...line.slice(line.indexOf("=") + 1).matchAll(/#(\d+)/g)].map(m => Number(m[1]));
  }

  /** The NetFloorArea m² a space's Qto_SpaceBaseQuantities carries, chasing
   *  IFCSPACE -> IFCRELDEFINESBYPROPERTIES -> IFCELEMENTQUANTITY -> IFCQUANTITYAREA. */
  function qtoArea(entities: string[], spaceId: number): number | undefined {
    const rel = entities.find(l =>
      l.includes("=IFCRELDEFINESBYPROPERTIES(") && new RegExp(`#${spaceId}(?!\\d)`).test(l));
    if (!rel) return undefined;
    const refs = argRefs(rel);
    const qsetId = refs[refs.length - 1];
    const qsetLine = entities.find(l => l.startsWith(`#${qsetId}=IFCELEMENTQUANTITY(`));
    if (!qsetLine || !qsetLine.includes("'Qto_SpaceBaseQuantities'")) return undefined;
    const qrefs = argRefs(qsetLine).slice(1); // drop OwnerHistory; left with [area, height]
    const areaId = qrefs[0];
    const heightId = qrefs[1];
    const areaLine = entities.find(l => l.startsWith(`#${areaId}=IFCQUANTITYAREA(`));
    const heightLine = entities.find(l => l.startsWith(`#${heightId}=IFCQUANTITYLENGTH(`));
    if (!heightLine || !heightLine.includes("'Height'")) return undefined;
    const m = areaLine ? /IFCQUANTITYAREA\('NetFloorArea',\$,\$,([^,]+),\$\)/.exec(areaLine) : null;
    return m ? Number(m[1]) : undefined;
  }

  const twoText = toIfc(two);
  const { entities: twoEntities, spaces } = parse(twoText);

  check("IFCSPACE count equals detected room count", spaces.length === rooms.length, String(spaces.length));
  check("space GlobalIds are well-formed and unique",
    spaces.every(s => /^[0-9A-Za-z_$]{22}$/.test(s.guid) && "0123".includes(s.guid[0]!))
      && new Set(spaces.map(s => s.guid)).size === spaces.length);

  const namedSpace = spaces.find(s => s.name === "'Woonkamer'");
  check("the named room's IfcSpace carries the authored name", namedSpace !== undefined,
    spaces.map(s => s.name).join(" | "));

  // ── aggregation, not containment ─────────────────────────────────────────
  const seed = two.guid ?? "";
  const aggGuid = ifcGuid(seed, `${floor.id}:spaces`);
  const aggLine = twoEntities.find(l => l.includes(`=IFCRELAGGREGATES('${aggGuid}'`));
  check("the storey aggregates its spaces", aggLine !== undefined, twoEntities.join("|"));
  if (aggLine) {
    // [OwnerHistory, RelatingObject (the storey), ...RelatedObjects (the spaces)].
    const relatedObjects = argRefs(aggLine).slice(2);
    const spaceIds = spaces.map(s => s.id);
    check("the aggregation rel's RelatedObjects is exactly the space entities, once each",
      relatedObjects.length === spaceIds.length && spaceIds.every(id => relatedObjects.includes(id)),
      aggLine);
  }
  {
    const containmentLines = twoEntities.filter(l => l.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE("));
    const spaceIds = new Set(spaces.map(s => s.id));
    check("no space appears in any containment rel",
      containmentLines.every(l => argRefs(l).every(id => !spaceIds.has(id))));
  }

  // ── quantities on the document's default (net) area basis ────────────────
  if (namedSpace && named) {
    const expectedNet = named.netAreaMm2 / 1e6;
    const actualNet = qtoArea(twoEntities, namedSpace.id);
    check("named room's NetFloorArea matches the net basis (areaMode default)",
      actualNet !== undefined && Math.abs(actualNet - expectedNet) < 1e-6, `${actualNet} vs ${expectedNet}`);
  }

  // ── GlobalId stability across a re-export ─────────────────────────────────
  {
    const again = toIfc(two);
    const a = twoText.split("\n"), b = again.split("\n");
    const diffLines = a.length === b.length
      ? a.map((l, i) => l === b[i] || l.startsWith("FILE_NAME(") ? null : i).filter((i): i is number => i !== null)
      : [-1];
    check("two exports of the two-room plan are byte-identical apart from FILE_NAME's timestamp",
      diffLines.length === 0, diffLines.join(","));
  }

  // ── flipping areaMode changes the reported figure ─────────────────────────
  {
    two.areaMode = "centerline";
    const centerText = toIfc(two);
    const { entities: centerEntities, spaces: centerSpaces } = parse(centerText);
    const centerNamed = centerSpaces.find(s => s.name === "'Woonkamer'");
    check("the named space still resolves under areaMode centerline", centerNamed !== undefined);
    if (centerNamed && named) {
      const expectedCenterline = named.areaMm2 / 1e6;
      const actualCenterline = qtoArea(centerEntities, centerNamed.id);
      check("NetFloorArea follows areaMode to the centerline basis",
        actualCenterline !== undefined && Math.abs(actualCenterline - expectedCenterline) < 1e-6,
        `${actualCenterline} vs ${expectedCenterline}`);
      check("the centerline figure differs from the net figure (300mm walls make a real gap)",
        actualCenterline !== undefined && Math.abs(actualCenterline - named.netAreaMm2 / 1e6) > 1e-3);
    }
  }
}

console.log(failures === 0 ? "ALL IFC TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
