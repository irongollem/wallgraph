// Opening materials: the accessors, the IFC material constituent set, the
// steel leaf colour in 3D and the honeycomb fire predicate.
import { createRequire } from "node:module";
import type * as WebIFC from "web-ifc";
import {
  emptyDoc, frameMaterialOf, leafMaterialOf, leafFireConcern, type Opening, type PlanDoc,
} from "../src/model/doc";
import { toIfc } from "../src/io/ifc";
import { buildSceneMesh, DOOR_COLOR, STEEL_COLOR, type Mesh3D } from "../src/render3d/mesh";

const require = createRequire(import.meta.url);
const webifc = require("web-ifc") as typeof WebIFC;

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function roomWith(over: Partial<Opening>): PlanDoc {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 },
    { id: "n3", x: 4000, y: 3000 }, { id: "n4", x: 0, y: 3000 });
  const o: Opening = { id: "o1", kind: "door", t: 2000, width: 900, sashes: [], ...over };
  f.walls.push(
    { id: "w1", a: "n1", b: "n2", thickness: 100, bulge: 0, openings: [o] },
    { id: "w2", a: "n2", b: "n3", thickness: 100, bulge: 0, openings: [] },
    { id: "w3", a: "n3", b: "n4", thickness: 100, bulge: 0, openings: [] },
    { id: "w4", a: "n4", b: "n1", thickness: 100, bulge: 0, openings: [] },
  );
  return doc;
}

/** Volume-free colour census: number of triangles in the given colour. */
function trisOf(m: Mesh3D, rgb: readonly [number, number, number]): number {
  let n = 0;
  for (let i = 0; i + 2 < m.colors.length; i += 9) {
    if (Math.abs(m.colors[i]! - rgb[0]) < 1e-3 && Math.abs(m.colors[i + 1]! - rgb[1]) < 1e-3
      && Math.abs(m.colors[i + 2]! - rgb[2]) < 1e-3) n++;
  }
  return n;
}

// 1. accessors
{
  const door = (o: Partial<Opening>): Opening => ({ id: "a", kind: "door", t: 0, width: 900, sashes: [], ...o });
  check("frame material reads back", frameMaterialOf(door({ frameMaterial: "pvc" })) === "pvc");
  check("leaf material reads back", leafMaterialOf(door({ leafMaterial: "honeycomb" })) === "honeycomb");
  check("an invalid frame material reads undefined",
    frameMaterialOf(door({ frameMaterial: "oak" as never })) === undefined);
  check("an invalid leaf material reads undefined",
    leafMaterialOf(door({ leafMaterial: "oak" as never })) === undefined);
  check("a window has no leaf material",
    leafMaterialOf(door({ kind: "window", leafMaterial: "steel" })) === undefined);
  check("a passage has no frame material",
    frameMaterialOf(door({ kind: "passage", frameMaterial: "steel" })) === undefined);
}

// 4. fire predicate
{
  const fire = { kind: "wbdbo", minutes: 30 } as const;
  const base: Opening = { id: "a", kind: "door", t: 0, width: 900, sashes: [] };
  check("honeycomb under a rating is a concern", leafFireConcern({ ...base, leafMaterial: "honeycomb", fireRating: fire }));
  check("honeycomb without a rating is not", !leafFireConcern({ ...base, leafMaterial: "honeycomb" }));
  check("solid timber under a rating is not", !leafFireConcern({ ...base, leafMaterial: "solidTimber", fireRating: fire }));
}

// 3. mesh
{
  const steel = buildSceneMesh(roomWith({ leafMaterial: "steel" }));
  check("a steel leaf is drawn in the steel colour", trisOf(steel, STEEL_COLOR) > 0);
  check("a steel leaf leaves no door-coloured triangles", trisOf(steel, DOOR_COLOR) === 0);
  const plain = buildSceneMesh(roomWith({}));
  check("an unstated leaf keeps the door colour", trisOf(plain, DOOR_COLOR) > 0 && trisOf(plain, STEEL_COLOR) === 0);
  const glazed = buildSceneMesh(roomWith({ glazed: true, leafMaterial: "steel" }));
  check("a glazed steel leaf has a steel rim", trisOf(glazed, STEEL_COLOR) > 0 && trisOf(glazed, DOOR_COLOR) === 0);
}

// 2. IFC
function constituents(text: string): string[] {
  return [...text.matchAll(/IFCMATERIALCONSTITUENT\('(\w+)',\$,#(\d+),/g)].map(m => {
    const mat = text.match(new RegExp(`#${m[2]}=IFCMATERIAL\\('([^']*)'`));
    return `${m[1]}=${mat?.[1]}`;
  });
}

async function run(): Promise<void> {
  const api = new webifc.IfcAPI();
  await api.Init();

  const door = toIfc(roomWith({ frameMaterial: "aluminium", leafMaterial: "tubularChipboard", glazed: true }), 0);
  check("one constituent set for the door", (door.match(/IFCMATERIALCONSTITUENTSET\(/g) ?? []).length === 1);
  check("door set is named Door", door.includes("IFCMATERIALCONSTITUENTSET('Door'"));
  const dc = constituents(door);
  check("door constituents Lining, Framing, Glazing",
    dc.join() === "Lining=Aluminium,Framing=Tubular chipboard,Glazing=Glass", dc.join());

  const win = toIfc(roomWith({ kind: "window", frameMaterial: "pvc" }), 0);
  const wc = constituents(win);
  check("window constituents Lining, Glazing", wc.join() === "Lining=PVC,Glazing=Glass", wc.join());
  check("window set is named Window", win.includes("IFCMATERIALCONSTITUENTSET('Window'"));

  const none = toIfc(roomWith({}), 0);
  check("no materials, no constituent set", !none.includes("IFCMATERIALCONSTITUENTSET"));

  const id = api.OpenModel(new TextEncoder().encode(door));
  const rels = api.GetLineIDsWithType(id, webifc.IFCRELASSOCIATESMATERIAL);
  check("web-ifc parses the file and finds the material association", rels.size() > 0);
  api.CloseModel(id);
}

await run();
console.log(failures === 0 ? "ALL OPENING MATERIAL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
