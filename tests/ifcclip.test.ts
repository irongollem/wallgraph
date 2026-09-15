// Sloped wall clipping, read back as geometry: web-ifc evaluates the exported
// IfcBooleanClippingResult chain and every wall vertex is compared with the
// profile. The structural checks in ifc.test.ts count the half-spaces; this
// file checks what they cut.
import { createRequire } from "node:module";
import type * as WebIFC from "web-ifc";
import { emptyDoc, floorHeight, type ProfilePoint } from "../src/model/doc";
import { toIfc } from "../src/io/ifc";
import { wallTopAt } from "../src/model/profile";

const require = createRequire(import.meta.url);
const webifc = require("web-ifc") as typeof WebIFC;

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const TOL_MM = 1;

/** A 4000 × 3000 room whose y = 0 wall carries `profile`. */
function room(profile: (h: number) => ProfilePoint[]) {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.nodes.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 },
    { id: "n3", x: 4000, y: 3000 }, { id: "n4", x: 0, y: 3000 });
  f.walls.push(
    { id: "w1", a: "n1", b: "n2", thickness: 150, bulge: 0, openings: [], profile: profile(floorHeight(f)) },
    { id: "w2", a: "n2", b: "n3", thickness: 150, bulge: 0, openings: [] },
    { id: "w3", a: "n3", b: "n4", thickness: 150, bulge: 0, openings: [] },
    { id: "w4", a: "n4", b: "n1", thickness: 150, bulge: 0, openings: [] },
  );
  return { doc, f, wall: f.walls[0]! };
}

/** Wall vertices within 200 mm of the y = 0 line, as (s along the wall, z), mm. */
function wallVertices(api: WebIFC.IfcAPI, text: string): { s: number; z: number }[] {
  const id = api.OpenModel(new TextEncoder().encode(text));
  const walls = new Set<number>();
  const ids = api.GetLineIDsWithType(id, webifc.IFCWALL);
  for (let i = 0; i < ids.size(); i++) walls.add(ids.get(i));
  const out: { s: number; z: number }[] = [];
  api.StreamAllMeshes(id, mesh => {
    if (!walls.has(mesh.expressID)) return;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const g = api.GetGeometry(id, pg.geometryExpressID);
      const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const m = pg.flatTransformation;
      for (let k = 0; k < verts.length; k += 6) {
        const x = verts[k]!, y = verts[k + 1]!, z = verts[k + 2]!;
        // web-ifc returns y-up metres; plan y is -z.
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        if (Math.abs(wz * 1000) > 200) continue;
        out.push({ s: wx * 1000, z: wy * 1000 });
      }
    }
  });
  api.CloseModel(id);
  return out;
}

async function run(): Promise<void> {
  const api = new webifc.IfcAPI();
  await api.Init();

  const cases: [string, (h: number) => ProfilePoint[], number[]][] = [
    // Two slopes of different pitch: the lower segment's high end is below the
    // wall's maximum, which is where an over-tall extrusion survives the clip.
    ["two-slope gable", h => [{ t: 1000, height: h + 1200 }, { t: 2000, height: h + 1800 }], [1000, 2000]],
    ["valley", h => [{ t: 0, height: h + 1800 }, { t: 2000, height: h }, { t: 4000, height: h + 1800 }], [0, 2000, 4000]],
  ];
  for (const [name, profile, breakpoints] of cases) {
    const { doc, f, wall } = room(profile);
    const verts = wallVertices(api, toIfc(doc, 0));
    const inSpan = verts.filter(p => p.s >= -200 && p.s <= 4200);
    const above = inSpan.filter(p => p.z - wallTopAt(f, wall, Math.max(0, Math.min(4000, p.s))) > TOL_MM);
    check(`${name}: no wall vertex stands above the profile`, inSpan.length > 0 && above.length === 0,
      JSON.stringify(above.slice(0, 5)));
    for (const bp of breakpoints) {
      const zs = inSpan.filter(p => Math.abs(p.s - bp) < 2).map(p => p.z);
      const top = wallTopAt(f, wall, bp);
      check(`${name}: the body reaches the profile at s = ${bp}`,
        zs.length > 0 && Math.abs(Math.max(...zs) - top) <= TOL_MM, `${Math.max(...zs)} vs ${top}`);
    }
  }
}

await run();
console.log(failures === 0 ? "ALL IFC CLIP TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
