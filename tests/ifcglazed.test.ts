// A glazed door in IFC: its body is core/solids.ts's rim and pane, and the
// pane carries a translucent surface style -- read back through web-ifc.
import { createRequire } from "node:module";
import type * as WebIFC from "web-ifc";
import { emptyDoc, type Opening, type PlanDoc } from "../src/model/doc";
import { toIfc } from "../src/io/ifc";

const require = createRequire(import.meta.url);
const webifc = require("web-ifc") as typeof WebIFC;

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function roomWith(door: Partial<Opening>): PlanDoc {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 },
    { id: "n3", x: 4000, y: 3000 }, { id: "n4", x: 0, y: 3000 });
  const d: Opening = { id: "o1", kind: "door", t: 2000, width: 1600, sashes: [], ...door };
  f.walls.push(
    { id: "w1", a: "n1", b: "n2", thickness: 100, bulge: 0, openings: [d] },
    { id: "w2", a: "n2", b: "n3", thickness: 100, bulge: 0, openings: [] },
    { id: "w3", a: "n3", b: "n4", thickness: 100, bulge: 0, openings: [] },
    { id: "w4", a: "n4", b: "n1", thickness: 100, bulge: 0, openings: [] },
  );
  return doc;
}

/** Each of the door's geometries as its alpha, read through web-ifc. */
function doorAlphas(api: WebIFC.IfcAPI, text: string): number[] {
  const id = api.OpenModel(new TextEncoder().encode(text));
  const doors = new Set<number>();
  const ids = api.GetLineIDsWithType(id, webifc.IFCDOOR);
  for (let i = 0; i < ids.size(); i++) doors.add(ids.get(i));
  const out: number[] = [];
  api.StreamAllMeshes(id, mesh => {
    if (!doors.has(mesh.expressID)) return;
    for (let i = 0; i < mesh.geometries.size(); i++) out.push(mesh.geometries.get(i).color.w);
  });
  api.CloseModel(id);
  return out;
}

async function run(): Promise<void> {
  const api = new webifc.IfcAPI();
  await api.Init();

  const plain = toIfc(roomWith({}), 0);
  check("a plain door states no glass style", !plain.includes("IFCSURFACESTYLE("));
  const plainAlphas = doorAlphas(api, plain);
  check("a plain door is one opaque leaf", plainAlphas.length === 1 && plainAlphas[0] === 1, JSON.stringify(plainAlphas));

  const two = [{ action: "turn", hinge: "a" }, { action: "turn", hinge: "b" }] as Opening["sashes"];
  const glazed = toIfc(roomWith({ glazed: true, sashes: two }), 0);
  const alphas = doorAlphas(api, glazed);
  check("a glazed double door is a rim of four pieces and a pane, per leaf", alphas.length === 10, JSON.stringify(alphas));
  check("its two panes are translucent", alphas.filter(a => a < 1).length === 2, JSON.stringify(alphas));
  check("its rim is opaque", alphas.filter(a => a === 1).length === 8, JSON.stringify(alphas));
  check("one glass style serves every pane", (glazed.match(/IFCSURFACESTYLE\(/g) ?? []).length === 1);
}

await run();
console.log(failures === 0 ? "ALL IFC GLAZED TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
