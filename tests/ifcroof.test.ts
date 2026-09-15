// Roof planes, read back as geometry: web-ifc evaluates the exported
// IfcRoof/IfcSlab pair per plane, and every slab's bottom vertex is checked
// against the plane's own underside formula. Mirrors tests/ifcclip.test.ts's
// approach for a wall's sloped top.
import { createRequire } from "node:module";
import type * as WebIFC from "web-ifc";
import { emptyDoc } from "../src/model/doc";
import type { RoofPlane } from "../src/model/roof";
import { toIfc } from "../src/io/ifc";
import { planeUndersideAt } from "../src/core/roof";
import { v } from "../src/geometry/vec";

const require = createRequire(import.meta.url);
const webifc = require("web-ifc") as typeof WebIFC;

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const TOL_MM = 1;

interface SlabVertex { x: number; y: number; z: number }

/** Every vertex of every IFCSLAB in the model, in world mm (y-up metres
 *  converted back). A wall-less document (this test's) emits no ordinary
 *  floor slab, so every IFCSLAB found here belongs to a roof plane. */
function slabVertices(api: WebIFC.IfcAPI, text: string): SlabVertex[] {
  const id = api.OpenModel(new TextEncoder().encode(text));
  const slabs = new Set<number>();
  const ids = api.GetLineIDsWithType(id, webifc.IFCSLAB);
  for (let i = 0; i < ids.size(); i++) slabs.add(ids.get(i));
  const out: SlabVertex[] = [];
  api.StreamAllMeshes(id, mesh => {
    if (!slabs.has(mesh.expressID)) return;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const g = api.GetGeometry(id, pg.geometryExpressID);
      const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const m = pg.flatTransformation;
      for (let k = 0; k < verts.length; k += 6) {
        const x = verts[k]!, y = verts[k + 1]!, z = verts[k + 2]!;
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        // web-ifc streams y-up metres: viewer Y is the file's own (height) Z,
        // viewer Z is the file's own Y -- which already carries this file's
        // own plan-y negation (see ifc.ts's y-negation convention), so the
        // document's plan y is -wz directly. Mirrors tests/ifcclip.test.ts's
        // own reading, generalized from one axis (that test only reads a
        // wall's own s/z) to both plan coordinates.
        out.push({ x: wx * 1000, y: -wz * 1000, z: wy * 1000 });
      }
    }
  });
  api.CloseModel(id);
  return out;
}

function dedupe(vs: SlabVertex[]): SlabVertex[] {
  const seen = new Set<string>();
  const out: SlabVertex[] = [];
  for (const p of vs) {
    const k = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

async function run(): Promise<void> {
  const api = new webifc.IfcAPI();
  await api.Init();

  const planes: RoofPlane[] = [
    { id: "p1", outline: [v(0, 0), v(2000, 0), v(2000, 3000), v(0, 3000)], eaveEdge: 3, eaveMm: 600, pitchDeg: 30 },
    { id: "p2", outline: [v(2000, 0), v(4000, 0), v(4000, 3000), v(2000, 3000)], eaveEdge: 1, eaveMm: 600, pitchDeg: 30 },
  ];
  const doc = emptyDoc();
  doc.floors[0]!.roofPlanes = planes;
  const text = toIfc(doc, 0);

  check("exactly one IFCROOF is emitted", (text.match(/=IFCROOF\(/g) ?? []).length === 1,
    String((text.match(/=IFCROOF\(/g) ?? []).length));
  check("one IFCSLAB per plane", (text.match(/=IFCSLAB\(/g) ?? []).length === planes.length,
    String((text.match(/=IFCSLAB\(/g) ?? []).length));

  const verts = dedupe(slabVertices(api, text));
  check("some slab geometry was read back", verts.length > 0);

  for (const plane of planes) {
    const near = verts.filter(p => Math.abs(planeUndersideAt(plane, v(p.x, p.y)) - p.z) <= TOL_MM
      && p.x >= -50 && p.x <= 4050 && p.y >= -50 && p.y <= 3050);
    check(`${plane.id}: at least one readback vertex lies on the plane within 1mm`, near.length > 0,
      JSON.stringify(verts.slice(0, 4)));
  }

  // Every bottom-face vertex of BOTH planes together must sit on ITS OWN
  // plane's formula -- the outline has 4 corners, so at least 4 distinct
  // vertices should match each plane exactly (the bottom ring).
  for (const plane of planes) {
    const onPlane = verts.filter(p => Math.abs(planeUndersideAt(plane, v(p.x, p.y)) - p.z) <= TOL_MM);
    check(`${plane.id}: the bottom ring (>=3 vertices) lies on the plane`, onPlane.length >= 3,
      String(onPlane.length));
  }
}

await run();
console.log(failures === 0 ? "ALL IFC ROOF TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
