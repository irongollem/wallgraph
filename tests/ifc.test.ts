// IFC export tests. A STEP file that looks fine can still be rejected by every
// viewer for a missing reference or a malformed GlobalId, so the structural
// rules are checked here rather than eyeballed.
import {
  emptyDoc, newId, floorElevation, DOOR_HEIGHT_DEFAULT, WINDOW_HEIGHT_DEFAULT, wallHeight,
  type Floor, type Wall, type Opening, type Id, type SymbolInstance,
} from "../src/model/doc";
import { wallLength } from "../src/model/ops";
import { toIfc } from "../src/io/ifc";
import { detectRooms } from "../src/core/rooms";
import { SLAB_DEFAULT_MM } from "../src/core/solids";
import { ifcGuid } from "../src/model/guid";
import { v } from "../src/geometry/vec";
import { bulgeFromSagitta } from "../src/geometry/arc";
import type { Vide } from "../src/model/vide";
import type { Stair } from "../src/model/stair";
import type { Cabinet } from "../src/model/cabinet";
import { SYMBOLS } from "../src/render/symbols";

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

// ── BIM 6: derived slabs and vides ──────────────────────────────────────────

/** A closed square, offset so a second call on the same floor doesn't overlap
 *  the first — same shape addRect() uses in the BIM 4 block above, but this
 *  file's blocks don't share scope. */
function addSquare(f: Floor, offset: number, size = 4000): void {
  const pts = [v(0, 0), v(size, 0), v(size, size), v(0, size)];
  const ids = pts.map(p => {
    const id = newId("n");
    f.nodes.push({ id, x: p.x + offset, y: p.y + offset });
    return id;
  });
  for (let i = 0; i < 4; i++) {
    f.walls.push({ id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 300, bulge: 0, openings: [] });
  }
}

// ── a closed rectangle on each of two storeys: one IFCSLAB per storey ──────
{
  const doc2 = emptyDoc();
  doc2.floors[0]!.name = "Begane grond";
  addSquare(doc2.floors[0]!, 0);
  const upper: Floor = {
    id: newId("f"), name: "Verdieping", nodes: [], walls: [], symbols: [],
    stairs: [], vides: [], cabinets: [], roomNames: [],
  };
  addSquare(upper, 0);
  doc2.floors.push(upper);

  const out = toIfc(doc2);
  const ents = out.split("\n").filter(l => l.startsWith("#"));
  const slabLines = ents.filter(l => l.includes("=IFCSLAB("));

  check("one IFCSLAB per storey", slabLines.length === doc2.floors.length, String(slabLines.length));
  check("every slab carries .FLOOR.", slabLines.every(l => l.includes(".FLOOR.")), slabLines.join("|"));

  const guidOf = (l: string): string => /^#\d+=IFCSLAB\('([^']*)'/.exec(l)![1]!;
  const idOf = (l: string): number => Number(/^#(\d+)=/.exec(l)![1]);
  for (let i = 0; i < doc2.floors.length; i++) {
    const floor = doc2.floors[i]!;
    const expected = ifcGuid(doc2.guid ?? "", `${floor.id}:slab`);
    check(`slab GlobalId for storey ${i} matches ifcGuid(seed, floor.id + ':slab')`,
      slabLines.some(l => guidOf(l) === expected), slabLines.map(guidOf).join(","));
  }

  const containmentLines = ents.filter(l => l.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE("));
  const slabIds = slabLines.map(idOf);
  check("every slab appears in exactly one storey's containment rel",
    slabIds.every(id => containmentLines.filter(l => new RegExp(`#${id}(?!\\d)`).test(l)).length === 1));

  // ── extrusion sits at the negative z0, extrudes a positive depth ─────────
  {
    const extrusions = ents.filter(l => l.includes("=IFCEXTRUDEDAREASOLID("));
    const positions = new Set<number>();
    for (const l of extrusions) {
      const m = /^#\d+=IFCEXTRUDEDAREASOLID\(#\d+,#(\d+),#\d+,(-?\d+\.?\d*(?:E[+-]?\d+)?)\);$/.exec(l);
      if (m) { positions.add(Number(m[1])); check("extrusion depth is positive", Number(m[2]) > 0, l); }
    }
    const posPoints = ents.filter(l => positions.has(idOf(l)) && l.includes("=IFCAXIS2PLACEMENT3D("));
    const zOf = (placementLine: string): number | undefined => {
      const ptId = /^#\d+=IFCAXIS2PLACEMENT3D\(#(\d+)/.exec(placementLine)?.[1];
      const ptLine = ents.find(l => l.startsWith(`#${ptId}=IFCCARTESIANPOINT(`));
      const m = ptLine ? /,(-?\d+\.?\d*(?:E[+-]?\d+)?)\)\)/.exec(ptLine) : null;
      return m ? Number(m[1]) : undefined;
    };
    const zValues = posPoints.map(zOf);
    check(`at least one extrusion sits at z0 = -${SLAB_DEFAULT_MM} (the slab)`,
      zValues.some(z => z === -SLAB_DEFAULT_MM), zValues.join(","));
  }

  // ── byte-stable re-export ─────────────────────────────────────────────────
  {
    const again = toIfc(doc2);
    const a = out.split("\n"), b = again.split("\n");
    const diffLines = a.length === b.length
      ? a.map((l, i) => l === b[i] || l.startsWith("FILE_NAME(") ? null : i).filter((i): i is number => i !== null)
      : [-1];
    check("slab export is byte-identical across re-export apart from FILE_NAME's timestamp",
      diffLines.length === 0, diffLines.join(","));
  }
}

// ── a vide cuts a real void in its storey's slab ────────────────────────────
{
  const doc3 = emptyDoc();
  const floor = doc3.floors[0]!;
  floor.name = "Begane grond";
  addSquare(floor, 0, 6000);
  const vide: Vide = { id: newId("v"), x: 3000, y: 3000, rotation: 0, width: 1200, depth: 2600 };
  floor.vides = [vide];

  const out = toIfc(doc3);
  const ents = out.split("\n").filter(l => l.startsWith("#"));
  const seed = doc3.guid ?? "";

  const expectedOpeningGuid = ifcGuid(seed, vide.id);
  const expectedVoidGuid = ifcGuid(seed, `${vide.id}:void`);

  const openingLines = ents.filter(l => l.includes("=IFCOPENINGELEMENT(") && l.includes(`'${expectedOpeningGuid}'`));
  const voidLines = ents.filter(l => l.includes("=IFCRELVOIDSELEMENT(") && l.includes(`'${expectedVoidGuid}'`));
  check("exactly one slab-void IFCOPENINGELEMENT for the vide", openingLines.length === 1, openingLines.join("|"));
  check("exactly one IFCRELVOIDSELEMENT pairing it with the slab", voidLines.length === 1, voidLines.join("|"));

  const slabLine = ents.find(l => l.includes("=IFCSLAB("));
  const slabId = slabLine ? Number(/^#(\d+)=/.exec(slabLine)![1]) : undefined;
  check("the void rel's RelatingBuildingElement is the slab, not a wall",
    slabId !== undefined && voidLines.some(l => new RegExp(`#${slabId}(?!\\d)`).test(l)), voidLines.join("|"));

  const containmentLines = ents.filter(l => l.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE("));
  const openingId = openingLines.length === 1 ? Number(/^#(\d+)=/.exec(openingLines[0]!)![1]) : undefined;
  check("the vide's opening element is not contained anywhere",
    openingId !== undefined && containmentLines.every(l => !new RegExp(`#${openingId}(?!\\d)`).test(l)));

  // ── GlobalId stability across a re-export ─────────────────────────────────
  {
    const again = toIfc(doc3);
    const stillOpening = again.includes("=IFCOPENINGELEMENT(") && again.includes(`'${expectedOpeningGuid}'`);
    const stillVoid = again.includes(`'${expectedVoidGuid}'`);
    check("the vide's opening GlobalId is stable across a re-export", stillOpening);
    check("the vide's void-rel GlobalId is stable across a re-export", stillVoid);
  }
}

// ── an open chain (two walls, nothing enclosed) has walls but no slab ──────
{
  const doc4 = emptyDoc();
  const floor = doc4.floors[0]!;
  floor.name = "Begane grond";
  const n0 = newId("n"), n1 = newId("n"), n2 = newId("n");
  floor.nodes.push({ id: n0, x: 0, y: 0 }, { id: n1, x: 4000, y: 0 }, { id: n2, x: 4000, y: 3000 });
  floor.walls.push(
    { id: newId("w"), a: n0, b: n1, thickness: 300, bulge: 0, openings: [] },
    { id: newId("w"), a: n1, b: n2, thickness: 300, bulge: 0, openings: [] },
  );

  const out = toIfc(doc4);
  check("an open chain still emits its IFCWALLs", (out.match(/=IFCWALL\(/g) ?? []).length === 2);
  check("an open chain emits no IFCSLAB", !out.includes("=IFCSLAB("));
  check("an open chain emits no slab-related void rel",
    !out.includes("=IFCRELVOIDSELEMENT(") || (out.match(/=IFCOPENINGELEMENT\(/g) ?? []).length === 0);
}

// ── the empty document has no slab either ───────────────────────────────────
{
  const bare = toIfc(emptyDoc());
  check("an empty document has no slab", !bare.includes("=IFCSLAB("));
}

// ── BIM 7: stairs, cabinets and symbols ─────────────────────────────────────
//
// A closed room (addSquare() from the BIM 6 block above; still in scope --
// this file's blocks share top-level declarations) so floorSolids() returns
// non-null and the per-floor loop actually runs, carrying one straight
// stair, a base and a wall cabinet, and two symbols.
{
  /** Every ref (`#n`) an entity's OWN argument list carries. */
  function refsIn7(line: string): number[] {
    return [...line.slice(line.indexOf("=") + 1).matchAll(/#(\d+)/g)].map(m => Number(m[1]));
  }
  /** The bare integer id an entity line defines. */
  function idOf7(line: string): number {
    return Number(/^#(\d+)=/.exec(line)![1]);
  }
  /** The `#n` ref in argument slot `index` (0-based, GlobalId first) of an
   *  entity line, for a slot that is never itself a multi-item list -- true
   *  for Representation and every link this chases down to it below. */
  function refAt7(line: string, index: number): number | undefined {
    const body = line.slice(line.indexOf("(") + 1, line.length - 2);
    const token = body.split(",")[index];
    const m = token ? /#(\d+)/.exec(token) : undefined;
    return m ? Number(m[1]) : undefined;
  }
  /** z of an IFCCARTESIANPOINT entity (its last coordinate). */
  function pointZ7(entities: string[], ptId: number): number | undefined {
    const line = entities.find(l => l.startsWith(`#${ptId}=IFCCARTESIANPOINT(`));
    const m = line ? /,(-?\d+\.?\d*(?:E[+-]?\d+)?)\)\)/.exec(line) : null;
    return m ? Number(m[1]) : undefined;
  }
  /**
   * z0 of the single extrusion behind a product's Representation (arg slot
   * 6, the same slot for every element this export gives box geometry --
   * GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement,
   * Representation, ...): Representation -> IFCPRODUCTDEFINITIONSHAPE ->
   * IFCSHAPEREPRESENTATION -> IFCEXTRUDEDAREASOLID -> its Position ->
   * IFCCARTESIANPOINT.
   */
  function extrusionZ07(entities: string[], entityLine: string): number | undefined {
    const repId = refAt7(entityLine, 6);
    if (repId === undefined) return undefined;
    const pdsLine = entities.find(l => l.startsWith(`#${repId}=IFCPRODUCTDEFINITIONSHAPE(`));
    const shapeRepId = pdsLine ? refAt7(pdsLine, 2) : undefined;
    if (shapeRepId === undefined) return undefined;
    const shapeRepLine = entities.find(l => l.startsWith(`#${shapeRepId}=IFCSHAPEREPRESENTATION(`));
    const solidId = shapeRepLine ? refAt7(shapeRepLine, 3) : undefined;
    if (solidId === undefined) return undefined;
    const solidLine = entities.find(l => l.startsWith(`#${solidId}=IFCEXTRUDEDAREASOLID(`));
    const posId = solidLine ? refAt7(solidLine, 1) : undefined;
    if (posId === undefined) return undefined;
    const posLine = entities.find(l => l.startsWith(`#${posId}=IFCAXIS2PLACEMENT3D(`));
    const ptId = posLine ? refAt7(posLine, 0) : undefined;
    return ptId === undefined ? undefined : pointZ7(entities, ptId);
  }

  const doc7 = emptyDoc();
  const floor7 = doc7.floors[0]!;
  floor7.name = "Begane grond";
  addSquare(floor7, 0, 6000);

  const stair: Stair = {
    id: newId("st"), kind: "steektrap", x: 3000, y: 500, rotation: 0,
    width: 900, going: 220, treads: 15, rise: 2800,
  };
  floor7.stairs = [stair];

  const baseCabinet: Cabinet = {
    id: newId("cab"), kind: "base", x: 500, y: 500, rotation: 0,
    width: 600, depth: 600, front: "door",
  };
  const wallCabinet: Cabinet = {
    id: newId("cab"), kind: "wall", x: 500, y: 5500, rotation: 0,
    width: 600, depth: 350, front: "door", label: "Bovenkast",
  };
  floor7.cabinets = [baseCabinet, wallCabinet];

  const socket: SymbolInstance = { id: newId("sym"), type: "socket-single", x: 100, y: 100, rotation: 0 };
  const toilet: SymbolInstance = { id: newId("sym"), type: "toilet", x: 200, y: 200, rotation: 0 };
  floor7.symbols = [socket, toilet];

  const text7 = toIfc(doc7);
  const ents7 = text7.split("\n").filter(l => l.startsWith("#"));
  const seed7 = doc7.guid ?? "";
  const countOf7 = (t: string): number => ents7.filter(l => l.includes(`=${t}(`)).length;

  // ── stair: one IFCSTAIR aggregating one IFCSTAIRFLIGHT ───────────────────
  check("exactly one IFCSTAIR for the placed stair", countOf7("IFCSTAIR") === 1, String(countOf7("IFCSTAIR")));
  check("exactly one IFCSTAIRFLIGHT aggregated to it",
    countOf7("IFCSTAIRFLIGHT") === 1, String(countOf7("IFCSTAIRFLIGHT")));

  const stairGuid = ifcGuid(seed7, stair.id);
  const flightGuid = ifcGuid(seed7, `${stair.id}:flight`);
  const partsGuid = ifcGuid(seed7, `${stair.id}:parts`);
  const stairLine = ents7.find(l => l.includes(`=IFCSTAIR('${stairGuid}'`));
  const flightLine = ents7.find(l => l.includes(`=IFCSTAIRFLIGHT('${flightGuid}'`));
  const partsLine = ents7.find(l => l.includes(`=IFCRELAGGREGATES('${partsGuid}'`));
  check("the stair's GlobalId is ifcGuid(seed, stair.id)", stairLine !== undefined);
  check("the flight's GlobalId is ifcGuid(seed, stair.id + ':flight')", flightLine !== undefined);
  check("the stair-parts aggregation's GlobalId is ifcGuid(seed, stair.id + ':parts')", partsLine !== undefined);
  check("the stair carries .STRAIGHT_RUN_STAIR. (steektrap)",
    !!stairLine && stairLine.includes(".STRAIGHT_RUN_STAIR."), stairLine);

  const expectedRisers = stair.treads + 1;
  const expectedRiserHeight = stair.rise! / expectedRisers;
  check("the flight's NumberOfRisers/NumberOfTreads/RiserHeight/TreadLength match the resolved figures",
    !!flightLine
      && flightLine.includes(`,${expectedRisers},${stair.treads},${expectedRiserHeight}.,${stair.going}.,$)`),
    flightLine);

  if (stairLine && flightLine && partsLine) {
    const stairId = idOf7(stairLine), flightId = idOf7(flightLine);
    const partsRefs = refsIn7(partsLine); // [OwnerHistory, RelatingObject, ...RelatedObjects]
    check("the aggregation's RelatingObject is the stair", partsRefs[1] === stairId, partsLine);
    check("the aggregation's RelatedObjects is exactly the flight",
      partsRefs.slice(2).length === 1 && partsRefs[2] === flightId, partsLine);

    const containmentLines7 = ents7.filter(l => l.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE("));
    check("the stair (not the flight) is contained in the storey",
      containmentLines7.some(l => refsIn7(l).includes(stairId))
        && containmentLines7.every(l => !refsIn7(l).includes(flightId)));
  }

  // ── cabinets: one IFCFURNITURE each, wall unit hung at z0 = 1400 ────────
  check("exactly two IFCFURNITURE for the two cabinets", countOf7("IFCFURNITURE") === 2, String(countOf7("IFCFURNITURE")));
  const baseLine = ents7.find(l => l.includes(`=IFCFURNITURE('${ifcGuid(seed7, baseCabinet.id)}'`));
  const wallLine = ents7.find(l => l.includes(`=IFCFURNITURE('${ifcGuid(seed7, wallCabinet.id)}'`));
  check("the base cabinet's own IFCFURNITURE is found", baseLine !== undefined);
  check("the wall cabinet's own IFCFURNITURE is found", wallLine !== undefined);
  check("the wall cabinet's Name is its label", !!wallLine && wallLine.includes("'Bovenkast'"), wallLine);
  check("the base cabinet's Name falls back to its kind (no label)",
    !!baseLine && baseLine.includes("'base'"), baseLine);
  check("the base cabinet's extrusion sits at z0 = 0",
    baseLine !== undefined && extrusionZ07(ents7, baseLine) === 0, String(baseLine && extrusionZ07(ents7, baseLine)));
  check("the wall cabinet's extrusion sits at z0 = 1400",
    wallLine !== undefined && extrusionZ07(ents7, wallLine) === 1400,
    String(wallLine && extrusionZ07(ents7, wallLine)));

  // ── symbols: class from the registry mapping ─────────────────────────────
  const socketLine = ents7.find(l => l.includes(`'${ifcGuid(seed7, socket.id)}'`));
  const toiletLine = ents7.find(l => l.includes(`'${ifcGuid(seed7, toilet.id)}'`));
  check("the electrical socket symbol maps to IFCOUTLET (the electrical category default)",
    !!socketLine && socketLine.includes("=IFCOUTLET("), socketLine);
  check("the sanitary symbol maps to IFCSANITARYTERMINAL",
    !!toiletLine && toiletLine.includes("=IFCSANITARYTERMINAL("), toiletLine);
  check("both mapped symbols carry .NOTDEFINED. as their trailing PredefinedType",
    !!socketLine && socketLine.trimEnd().endsWith(".NOTDEFINED.);")
      && !!toiletLine && toiletLine.trimEnd().endsWith(".NOTDEFINED.);"),
    `${socketLine} | ${toiletLine}`);

  // ── whole-file integrity over this plan ───────────────────────────────────
  {
    const defined = new Set<number>();
    for (const l of ents7) { const m = /^#(\d+)=/.exec(l); if (m) defined.add(Number(m[1])); }
    const referenced = new Set<number>();
    for (const l of ents7) for (const r of refsIn7(l)) referenced.add(r);
    const dangling = [...referenced].filter(id => !defined.has(id));
    check("every #n referenced is defined (BIM7 plan)", dangling.length === 0, dangling.join(","));
  }
  check("no NaN in the BIM7 plan", !text7.includes("NaN"));
  check("no byte over 126 in the BIM7 plan", [...text7].every(ch => ch.codePointAt(0)! <= 126));
  {
    const guids: string[] = [];
    for (const l of ents7) { const m = /^#\d+=\w+\('([0-9A-Za-z_$]{22})'/.exec(l); if (m) guids.push(m[1]!); }
    check("all GlobalIds in the BIM7 plan are unique", new Set(guids).size === guids.length, String(guids.length));
  }
  {
    const again7 = toIfc(doc7);
    const a = text7.split("\n"), b = again7.split("\n");
    const diffLines = a.length === b.length
      ? a.map((l, i) => l === b[i] || l.startsWith("FILE_NAME(") ? null : i).filter((i): i is number => i !== null)
      : [-1];
    check("BIM7 export is byte-identical across re-export apart from FILE_NAME's timestamp",
      diffLines.length === 0, diffLines.join(","));
  }
}

// ── registry completeness: every SYMBOLS category has a real IFC class ─────
//
// Not IFCBUILDINGELEMENTPROXY for anything the registry actually defines --
// a new category added to render/symbols/index.ts without a matching entry
// in io/ifc.ts's CATEGORY_DEFAULTS must fail here, not export silently.
{
  const categories = [...new Set(SYMBOLS.map(s => s.category))];
  const catDoc = emptyDoc();
  const catFloor = catDoc.floors[0]!;
  catFloor.name = "Begane grond";
  addSquare(catFloor, 0, 6000);
  const placed: Array<{ id: Id; category: string; type: string }> = [];
  for (const category of categories) {
    const def = SYMBOLS.find(s => s.category === category)!;
    const id = newId("sym");
    catFloor.symbols.push({ id, type: def.type, x: 100, y: 100, rotation: 0 });
    placed.push({ id, category, type: def.type });
  }
  const catSeed = catDoc.guid ?? "";
  const catText = toIfc(catDoc);
  const catEnts = catText.split("\n").filter(l => l.startsWith("#"));
  check(`every SYMBOLS category was exercised (${categories.length} categories)`,
    placed.length === categories.length);
  for (const p of placed) {
    const line = catEnts.find(l => l.includes(`'${ifcGuid(catSeed, p.id)}'`));
    check(`category "${p.category}" (type ${p.type}) has a mapping entry, not the proxy fallback`,
      !!line && !line.includes("=IFCBUILDINGELEMENTPROXY("), line);
  }
}

// ── an empty document emits none of BIM 7's element kinds ──────────────────
{
  const bare = toIfc(emptyDoc());
  check("an empty document has no stairs", !bare.includes("=IFCSTAIR(") && !bare.includes("=IFCSTAIRFLIGHT("));
  check("an empty document has no cabinets", !bare.includes("=IFCFURNITURE("));
  check("an empty document has no symbol elements",
    !bare.includes("=IFCOUTLET(") && !bare.includes("=IFCSANITARYTERMINAL(")
      && !bare.includes("=IFCBUILDINGELEMENTPROXY("));
}

// ── BIM 8: property sets and quantities ─────────────────────────────────────
//
// Two 4x3 m rooms side by side (same shape as the BIM 5 block above), split
// by a partition wall so IsExternal has both a true case and a false case to
// prove. The bottom-left wall carries loadBearing + a fire rating and a
// fire-rated, self-closing door of its own (a different rating, to prove the
// two properties are read independently rather than one copying the other).
{
  function addNode8(f: Floor, x: number, y: number): Id {
    const id = newId("n");
    f.nodes.push({ id, x, y });
    return id;
  }
  function addWall8(f: Floor, a: Id, b: Id, thickness: number): Wall {
    const wall: Wall = { id: newId("w"), a, b, thickness, bulge: 0, openings: [] };
    f.walls.push(wall);
    return wall;
  }
  /** Every ref (`#n`) an entity's OWN argument list carries. */
  function argRefs8(line: string): number[] {
    return [...line.slice(line.indexOf("=") + 1).matchAll(/#(\d+)/g)].map(m => Number(m[1]));
  }

  const doc8 = emptyDoc();
  const floor8 = doc8.floors[0]!;
  floor8.name = "Begane grond";
  const n0 = addNode8(floor8, 0, 0), n4 = addNode8(floor8, 4000, 0), n1 = addNode8(floor8, 8000, 0);
  const n3 = addNode8(floor8, 0, 3000), n5 = addNode8(floor8, 4000, 3000), n2 = addNode8(floor8, 8000, 3000);
  const wBottomLeft = addWall8(floor8, n0, n4, 300);   // facade: loadBearing + fireRating + door
  addWall8(floor8, n4, n1, 300);                        // facade
  addWall8(floor8, n1, n2, 300);                        // facade
  addWall8(floor8, n2, n5, 300);                        // facade
  addWall8(floor8, n5, n3, 300);                        // facade
  addWall8(floor8, n3, n0, 300);                        // facade
  const wPartition = addWall8(floor8, n4, n5, 150);     // interior, between the two rooms

  wBottomLeft.loadBearing = true;
  wBottomLeft.fireRating = { kind: "wbdbo", minutes: 60 };

  const door: Opening = {
    id: newId("o"), kind: "door", t: 1500, width: 900,
    sashes: [{ action: "turn", hinge: "a" }],
    fireRating: { kind: "wbdbo", minutes: 30 }, selfClosing: true,
  };
  wBottomLeft.openings.push(door);

  const rooms8 = detectRooms(floor8);
  check("BIM8 test doc encloses exactly two rooms", rooms8.length === 2, String(rooms8.length));

  const text8 = toIfc(doc8);
  const ents8 = text8.split("\n").filter(l => l.startsWith("#"));
  const seed8 = doc8.guid ?? "";

  /** A Pset_*Common's properties for a `${id}:pset`-or-`${id}:fillpset`-keyed
   *  set, Name -> the property's raw serialized NominalValue. */
  function parsedPset8(guidKey: string): Record<string, string> | undefined {
    const guid = ifcGuid(seed8, guidKey);
    const line = ents8.find(l => l.includes(`=IFCPROPERTYSET('${guid}'`));
    if (!line) return undefined;
    const propRefs = argRefs8(line).slice(1); // drop OwnerHistory
    const out: Record<string, string> = {};
    for (const id of propRefs) {
      const pLine = ents8.find(l => l.startsWith(`#${id}=IFCPROPERTYSINGLEVALUE(`));
      const m = pLine ? /^#\d+=IFCPROPERTYSINGLEVALUE\('([^']*)',\$,(.*),\$\);$/.exec(pLine) : null;
      if (m) out[m[1]!] = m[2]!;
    }
    return out;
  }

  /** A Qto_WallBaseQuantities's quantities for a `${wall.id}:qto`-keyed set,
   *  Name -> its numeric value. */
  function parsedQto8(guidKey: string): Record<string, number> | undefined {
    const guid = ifcGuid(seed8, guidKey);
    const line = ents8.find(l => l.includes(`=IFCELEMENTQUANTITY('${guid}'`));
    if (!line) return undefined;
    const qtyRefs = argRefs8(line).slice(1); // drop OwnerHistory
    const out: Record<string, number> = {};
    for (const id of qtyRefs) {
      const qLine = ents8.find(l =>
        l.startsWith(`#${id}=IFCQUANTITYLENGTH(`) || l.startsWith(`#${id}=IFCQUANTITYVOLUME(`));
      const m = qLine
        ? /^#\d+=IFCQUANTITY(?:LENGTH|VOLUME)\('([^']*)',\$,\$,(-?\d+\.?\d*(?:E[+-]?\d+)?),\$\);$/.exec(qLine)
        : null;
      if (m) out[m[1]!] = Number(m[2]!);
    }
    return out;
  }

  const psetCountOf8 = (name: string): number =>
    ents8.filter(l => l.includes("=IFCPROPERTYSET(") && l.includes(`'${name}'`)).length;

  // ── Pset_WallCommon: one per wall — IsExternal is always stated once
  //    rooms exist, so every wall carries at least one property ───────────
  check("Pset_WallCommon is emitted once per wall (7 walls: 6 facade + 1 partition)",
    psetCountOf8("Pset_WallCommon") === 7, String(psetCountOf8("Pset_WallCommon")));

  // ── IsExternal: true on a facade wall, false on the partition ──────────
  const facadeWall = floor8.walls.find(w => w.id !== wPartition.id && w.id !== wBottomLeft.id)!;
  const facadePset = parsedPset8(`${facadeWall.id}:pset`);
  const partitionPset = parsedPset8(`${wPartition.id}:pset`);
  const loadBearingPset = parsedPset8(`${wBottomLeft.id}:pset`);
  check("a facade wall's IsExternal serializes IFCBOOLEAN(.T.)",
    facadePset?.IsExternal === "IFCBOOLEAN(.T.)", JSON.stringify(facadePset));
  check("the partition wall's IsExternal serializes IFCBOOLEAN(.F.)",
    partitionPset?.IsExternal === "IFCBOOLEAN(.F.)", JSON.stringify(partitionPset));
  check("the loadBearing facade wall's IsExternal is also true",
    loadBearingPset?.IsExternal === "IFCBOOLEAN(.T.)", JSON.stringify(loadBearingPset));

  // ── LoadBearing: only the wall that states it ───────────────────────────
  check("LoadBearing appears on the wall that states it",
    loadBearingPset?.LoadBearing === "IFCBOOLEAN(.T.)", JSON.stringify(loadBearingPset));
  check("LoadBearing is absent from a wall that states nothing",
    facadePset?.LoadBearing === undefined, JSON.stringify(facadePset));
  check("LoadBearing is absent from the partition (states nothing)",
    partitionPset?.LoadBearing === undefined, JSON.stringify(partitionPset));

  // ── FireRating: the exact fireLabel text ────────────────────────────────
  check("the wall's FireRating carries the exact fireLabel text",
    loadBearingPset?.FireRating === "IFCLABEL('WBDBO 60')", JSON.stringify(loadBearingPset));
  check("a wall stating no fireRating carries none",
    facadePset?.FireRating === undefined, JSON.stringify(facadePset));

  // ── the door's Pset_DoorCommon ───────────────────────────────────────────
  const doorPset = parsedPset8(`${door.id}:fillpset`);
  check("the door's Pset_DoorCommon carries SelfClosing IFCBOOLEAN(.T.)",
    doorPset?.SelfClosing === "IFCBOOLEAN(.T.)", JSON.stringify(doorPset));
  check("the door's Pset_DoorCommon FireRating matches its own fireLabel (not the wall's)",
    doorPset?.FireRating === "IFCLABEL('WBDBO 30')", JSON.stringify(doorPset));
  check("the door's Pset_DoorCommon IsExternal matches its wall's (true, a facade wall)",
    doorPset?.IsExternal === "IFCBOOLEAN(.T.)", JSON.stringify(doorPset));
  check("exactly one Pset_DoorCommon (the door) and none named Pset_WindowCommon",
    psetCountOf8("Pset_DoorCommon") === 1 && psetCountOf8("Pset_WindowCommon") === 0);

  // ── Qto_WallBaseQuantities ───────────────────────────────────────────────
  const qto = parsedQto8(`${wBottomLeft.id}:qto`);
  const expectedLength = wallLength(floor8, wBottomLeft);
  const expectedHeight = wallHeight(floor8, wBottomLeft);
  const expectedGrossVolume = (expectedLength * wBottomLeft.thickness * expectedHeight) / 1e9;
  check("Qto_WallBaseQuantities.Length matches wallLength()",
    qto?.Length === expectedLength, `${qto?.Length} vs ${expectedLength}`);
  check("Qto_WallBaseQuantities.Width matches the wall's thickness",
    qto?.Width === wBottomLeft.thickness, `${qto?.Width} vs ${wBottomLeft.thickness}`);
  check("Qto_WallBaseQuantities.Height matches wallHeight()",
    qto?.Height === expectedHeight, `${qto?.Height} vs ${expectedHeight}`);
  check("Qto_WallBaseQuantities.GrossVolume matches length*width*height/1e9 (openings NOT subtracted)",
    qto?.GrossVolume !== undefined && Math.abs(qto.GrossVolume - expectedGrossVolume) < 1e-9,
    `${qto?.GrossVolume} vs ${expectedGrossVolume}`);
  check("Qto_WallBaseQuantities is emitted once per wall (7 walls, unconditional)",
    ents8.filter(l => l.includes("=IFCELEMENTQUANTITY(") && l.includes("'Qto_WallBaseQuantities'")).length === 7);

  // ── pset/qto GlobalIds are unique and stable across a re-export ─────────
  {
    const guids: string[] = [];
    for (const l of ents8) {
      const m = /^#\d+=IFC(?:PROPERTYSET|ELEMENTQUANTITY|RELDEFINESBYPROPERTIES)\('([^']*)'/.exec(l);
      if (m) guids.push(m[1]!);
    }
    check("every pset/qto GlobalId in the BIM8 plan is present and unique",
      guids.length > 0 && new Set(guids).size === guids.length, String(guids.length));

    const again8ForGuids = toIfc(doc8);
    const againGuids = again8ForGuids.split("\n")
      .map(l => /^#\d+=IFC(?:PROPERTYSET|ELEMENTQUANTITY|RELDEFINESBYPROPERTIES)\('([^']*)'/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => m[1]!);
    check("pset/qto GlobalIds are stable across a re-export",
      JSON.stringify([...guids].sort()) === JSON.stringify([...againGuids].sort()));
  }

  // ── byte-stable re-export ────────────────────────────────────────────────
  {
    const again8 = toIfc(doc8);
    const a = text8.split("\n"), b = again8.split("\n");
    const diffLines = a.length === b.length
      ? a.map((l, i) => l === b[i] || l.startsWith("FILE_NAME(") ? null : i).filter((i): i is number => i !== null)
      : [-1];
    check("BIM8 export is byte-identical across re-export apart from FILE_NAME's timestamp",
      diffLines.length === 0, diffLines.join(","));
  }

  // ── whole-file integrity ─────────────────────────────────────────────────
  {
    const defined = new Set<number>();
    for (const l of ents8) { const m = /^#(\d+)=/.exec(l); if (m) defined.add(Number(m[1])); }
    const referenced = new Set<number>();
    for (const l of ents8) for (const r of argRefs8(l)) referenced.add(r);
    const dangling = [...referenced].filter(id => !defined.has(id));
    check("every #n referenced is defined (BIM8 plan)", dangling.length === 0, dangling.join(","));
  }
  check("no NaN in the BIM8 plan", !text8.includes("NaN"));

  // ── psets/quantities are never added to a storey's containment rel ─────
  {
    const containmentLines8 = ents8.filter(l => l.includes("=IFCRELCONTAINEDINSPATIALSTRUCTURE("));
    const psetIds = new Set<number>();
    for (const l of ents8) {
      if (l.includes("=IFCPROPERTYSET(") || l.includes("=IFCELEMENTQUANTITY(")) {
        const m = /^#(\d+)=/.exec(l); if (m) psetIds.add(Number(m[1]));
      }
    }
    check("no pset/qto entity appears in any containment rel",
      containmentLines8.every(l => argRefs8(l).every(id => !psetIds.has(id))));
  }
}

// ── an empty plan, and a wall with no rooms to derive IsExternal from,
//    emit no property sets ──────────────────────────────────────────────────
{
  const bare = toIfc(emptyDoc());
  check("an empty document has no property sets or wall quantities",
    !bare.includes("=IFCPROPERTYSET(") && !bare.includes("Qto_WallBaseQuantities"));

  // Two walls, nothing enclosed: Qto_WallBaseQuantities is unconditional so
  // it still appears once per wall, but Pset_WallCommon needs at least one
  // stated property and gets none here — no rooms to derive IsExternal from,
  // and nothing else authored.
  const openDoc = emptyDoc();
  const floor = openDoc.floors[0]!;
  const n0 = newId("n"), n1 = newId("n"), n2 = newId("n");
  floor.nodes.push({ id: n0, x: 0, y: 0 }, { id: n1, x: 4000, y: 0 }, { id: n2, x: 4000, y: 3000 });
  floor.walls.push(
    { id: newId("w"), a: n0, b: n1, thickness: 300, bulge: 0, openings: [] },
    { id: newId("w"), a: n1, b: n2, thickness: 300, bulge: 0, openings: [] },
  );
  const openText = toIfc(openDoc);
  check("an open, unenclosed chain emits no Pset_WallCommon (IsExternal has nothing to derive)",
    !openText.includes("=IFCPROPERTYSET("));
  check("an open, unenclosed chain still emits Qto_WallBaseQuantities (unconditional)",
    (openText.match(/=IFCELEMENTQUANTITY\(/g) ?? []).length === 2);
}

console.log(failures === 0 ? "ALL IFC TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
