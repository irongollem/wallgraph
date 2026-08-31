// BIM 1 foundations: IFC GUID derivation, ground elevation, wall/opening
// height accessors, and schema coverage of the new fields.
import { ifcGuid, newDocGuid } from "../src/model/guid";
import {
  emptyDoc, newId, floorElevation, wallHeight, openingSill, openingHeight,
  DOOR_HEIGHT_DEFAULT, PASSAGE_HEIGHT_DEFAULT, WINDOW_HEIGHT_DEFAULT, WINDOW_SILL_DEFAULT,
  type PlanDoc, type Floor, type Wall, type Opening,
} from "../src/model/doc";
import { planSchema, validate } from "../scripts/site/schema";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const IFC_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

// --- ifcGuid ---
{
  const g = ifcGuid("seed1", "id1");
  check("ifcGuid is 22 characters", g.length === 22, g);
  check("every character is in the IFC alphabet", [...g].every(c => IFC_ALPHABET.includes(c)), g);
  check("the first character is '0'..'3'", "0123".includes(g[0]!), g[0]);

  check("stable across calls", ifcGuid("seed1", "id1") === ifcGuid("seed1", "id1"));
  check("distinct for a different id", ifcGuid("seed1", "id1") !== ifcGuid("seed1", "id2"));
  check("distinct for a different seed", ifcGuid("seed1", "id1") !== ifcGuid("seed2", "id1"));

  // First-char distribution: run enough ids that all four values should appear.
  const firsts = new Set<string>();
  for (let i = 0; i < 200; i++) firsts.add(ifcGuid("seed1", "id" + i)[0]!);
  check("the first character spans its whole range", [...firsts].sort().join("") === "0123", [...firsts].join());
}

// --- newDocGuid / emptyDoc ---
{
  const g = newDocGuid();
  check("newDocGuid is 32 hex characters", /^[0-9a-f]{32}$/.test(g), g);
  check("newDocGuid varies across calls", newDocGuid() !== newDocGuid());
  const doc = emptyDoc();
  check("emptyDoc carries a guid", typeof doc.guid === "string" && /^[0-9a-f]{32}$/.test(doc.guid), String(doc.guid));
}

// --- floorElevation ---
{
  const doc = emptyDoc();
  doc.groundMm = 300;
  doc.floors = [
    { id: newId("f"), name: "Begane grond", nodes: [], walls: [], symbols: [], height: 2800 },
    { id: newId("f"), name: "Eerste", nodes: [], walls: [], symbols: [], height: 2600 },
    { id: newId("f"), name: "Tweede", nodes: [], walls: [], symbols: [] }, // default height
  ];
  check("floor 0 sits at groundMm", floorElevation(doc, 0) === 300, String(floorElevation(doc, 0)));
  check("floor 1 stacks the first storey height", floorElevation(doc, 1) === 300 + 2800,
    String(floorElevation(doc, 1)));
  check("floor 2 stacks both storey heights", floorElevation(doc, 2) === 300 + 2800 + 2600,
    String(floorElevation(doc, 2)));

  const bare = emptyDoc();
  check("absent groundMm reads as 0", floorElevation(bare, 0) === 0);
}

// --- wallHeight ---
{
  const f: Floor = { id: "f1", name: "Floor 1", nodes: [], walls: [], symbols: [], height: 3000 };
  const wDefault: Wall = { id: "w1", a: "n1", b: "n2", thickness: 100, bulge: 0, openings: [] };
  const wOwn: Wall = { id: "w2", a: "n1", b: "n2", thickness: 100, bulge: 0, openings: [], height: 2400 };
  check("wallHeight falls back to the storey height", wallHeight(f, wDefault) === 3000);
  check("wallHeight honours an override", wallHeight(f, wOwn) === 2400);
}

// --- openingSill / openingHeight ---
{
  const door: Opening = { id: "o1", kind: "door", t: 1000, width: 830, sashes: [] };
  const window: Opening = { id: "o2", kind: "window", t: 1000, width: 1200, sashes: [] };
  const passage: Opening = { id: "o3", kind: "passage", t: 1000, width: 900, sashes: [] };

  check("door sill defaults to 0", openingSill(door) === 0);
  check("door height defaults to DOOR_HEIGHT_DEFAULT", openingHeight(door) === DOOR_HEIGHT_DEFAULT);
  check("passage height defaults to PASSAGE_HEIGHT_DEFAULT", openingHeight(passage) === PASSAGE_HEIGHT_DEFAULT);
  check("window sill defaults to WINDOW_SILL_DEFAULT", openingSill(window) === WINDOW_SILL_DEFAULT);
  check("window height defaults to WINDOW_HEIGHT_DEFAULT", openingHeight(window) === WINDOW_HEIGHT_DEFAULT);

  const overridden: Opening = { ...window, sillHeight: 450, height: 1800 };
  check("openingSill honours an override", openingSill(overridden) === 450);
  check("openingHeight honours an override", openingHeight(overridden) === 1800);

  const zeroSill: Opening = { ...door, sillHeight: 0 };
  check("an explicit 0 sill stays 0, not the default", openingSill(zeroSill) === 0);
}

// --- schema coverage of the new fields ---
{
  const schema = planSchema("");
  const full: PlanDoc = {
    version: 1, unit: "mm", gridMm: 100, guid: newDocGuid(), groundMm: -450,
    floors: [{
      id: "f1", name: "Begane grond",
      nodes: [{ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 }],
      walls: [{
        id: "w1", a: "n1", b: "n2", thickness: 300, bulge: 0,
        height: 2700, loadBearing: true, fireRating: { kind: "wbdbo", minutes: 60 },
        material: "glass", mullionMm: 1200, color: "#d0342c",
        openings: [{
          id: "o1", kind: "window", t: 2000, width: 1200, sashes: [],
          sillHeight: 900, height: 1400,
        }],
      }],
      symbols: [],
    }],
  };
  const errs = validate(schema, full);
  check("a document using every BIM field validates", errs.length === 0, errs.join(" | "));

  const notStated: PlanDoc = JSON.parse(JSON.stringify(full));
  delete notStated.floors[0]!.walls[0]!.loadBearing;
  check("loadBearing may be absent", validate(schema, notStated).length === 0);

  const noMaterial: PlanDoc = JSON.parse(JSON.stringify(full));
  delete noMaterial.floors[0]!.walls[0]!.material;
  delete noMaterial.floors[0]!.walls[0]!.mullionMm;
  check("a wall may state no material", validate(schema, noMaterial).length === 0);

  const badMaterial: PlanDoc = JSON.parse(JSON.stringify(full));
  (badMaterial.floors[0]!.walls[0]! as unknown as Record<string, unknown>).material = "brick";
  check("a material outside the list is rejected", validate(schema, badMaterial).length > 0);

  const badWallColor: PlanDoc = JSON.parse(JSON.stringify(full));
  (badWallColor.floors[0]!.walls[0]! as unknown as Record<string, unknown>).color = "red";
  check("a wall colour that is not #rrggbb is rejected", validate(schema, badWallColor).length > 0);

  const badGuid: PlanDoc = JSON.parse(JSON.stringify(full));
  badGuid.guid = "not-hex";
  check("a malformed guid is rejected", validate(schema, badGuid).length > 0);

  const badHeight: PlanDoc = JSON.parse(JSON.stringify(full));
  (badHeight.floors[0]!.walls[0]! as unknown as Record<string, unknown>).height = 0;
  check("a zero wall height is rejected (minimum 1)", validate(schema, badHeight).length > 0);
}

console.log(failures === 0 ? "ALL BIM TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
