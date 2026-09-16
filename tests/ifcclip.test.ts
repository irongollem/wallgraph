// Sloped wall clipping, read back as geometry: web-ifc evaluates the exported
// IfcBooleanClippingResult chain and every wall vertex is compared with the
// profile. The structural checks in ifc.test.ts count the half-spaces; this
// file checks what they cut.
import { createRequire } from "node:module";
import type * as WebIFC from "web-ifc";
import {
  emptyDoc, floorHeight, type ProfilePoint, type Opening, type Wall,
  WINDOW_SILL_DEFAULT, WINDOW_HEIGHT_DEFAULT, DOOR_HEIGHT_DEFAULT,
} from "../src/model/doc";
import { toIfc } from "../src/io/ifc";
import { wallTopAt } from "../src/model/profile";
import { arcLength, arcPointAt } from "../src/geometry/arc";

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

interface Pt { s: number; z: number }

/** Wall vertices within 200 mm of the y = 0 line, as (s along the wall, z), mm. */
function wallVertices(api: WebIFC.IfcAPI, text: string): Pt[] {
  return wallTriangles(api, text).flat();
}

/**
 * Every wall triangle within 200 mm of the y = 0 line, as its three (s, z)
 * corners, mm. Some checks below (a band's own existence, not just where
 * material may not stand) need the triangle, not just the raw vertex soup:
 * web-ifc's flattened mesh marks the void's own boundary against a piece
 * that merely TOUCHES it (no volume actually removed, since an adjacent
 * piece and a void are adjacent, not overlapping) with vertices at that
 * boundary's own z, even when the piece carries no material there at all --
 * an artifact of the boolean engine, not a face. A face that genuinely spans
 * the opening's width is what tells the two apart.
 */
function wallTriangles(api: WebIFC.IfcAPI, text: string): Pt[][] {
  const id = api.OpenModel(new TextEncoder().encode(text));
  const walls = new Set<number>();
  const ids = api.GetLineIDsWithType(id, webifc.IFCWALL);
  for (let i = 0; i < ids.size(); i++) walls.add(ids.get(i));
  const out: Pt[][] = [];
  api.StreamAllMeshes(id, mesh => {
    if (!walls.has(mesh.expressID)) return;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const g = api.GetGeometry(id, pg.geometryExpressID);
      const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      const m = pg.flatTransformation;
      // web-ifc returns y-up metres; plan y is -z (see the module comment).
      const corner = (vi: number): Pt & { t: number } => {
        const k = vi * 6;
        const x = verts[k]!, y = verts[k + 1]!, z = verts[k + 2]!;
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        return { s: wx * 1000, z: wy * 1000, t: wz * 1000 };
      };
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const tri = [corner(idx[t]!), corner(idx[t + 1]!), corner(idx[t + 2]!)];
        if (tri.some(p => Math.abs(p.t) > 200)) continue;
        out.push(tri);
      }
    }
  });
  api.CloseModel(id);
  return out;
}

/**
 * Whether some triangle's own footprint runs the whole [sLo, sHi] span at a
 * roughly constant z -- a real, filled band, not a boundary artifact (see
 * wallTriangles()).
 */
function hasSpanningFaceAt(tris: Pt[][], sLo: number, sHi: number, z: number): boolean {
  return tris.some(tri => {
    const ss = tri.map(p => p.s);
    return Math.min(...ss) <= sLo + TOL_MM && Math.max(...ss) >= sHi - TOL_MM
      && tri.every(p => Math.abs(p.z - z) <= TOL_MM);
  });
}

/**
 * Whether some triangle connects a corner near (sLo, zLo) to one near
 * (sHi, zHi) -- the sloped-band equivalent of hasSpanningFaceAt() above, for
 * a band whose two jambs sit at different heights.
 */
function hasSlopingFaceBetween(tris: Pt[][], sLo: number, zLo: number, sHi: number, zHi: number): boolean {
  const near = (p: Pt, s: number, z: number): boolean => Math.abs(p.s - s) <= TOL_MM && Math.abs(p.z - z) <= TOL_MM;
  return tris.some(tri => tri.some(p => near(p, sLo, zLo)) && tri.some(p => near(p, sHi, zHi)));
}


/**
 * The volume of every exported wall body, m³, by the divergence theorem over
 * its triangles. The plainest statement of issue #59: a wall's exported body
 * is the wall LESS its openings, and omitting the bands under a sill and over
 * a head shows up here as missing material, where a vertex check cannot see
 * it (web-ifc carves the void out of the body it is given, so the jamb's own
 * corners look the same either way).
 */
function wallVolumesM3(api: WebIFC.IfcAPI, text: string): number[] {
  const id = api.OpenModel(new TextEncoder().encode(text));
  const walls = new Map<number, number>();
  const ids = api.GetLineIDsWithType(id, webifc.IFCWALL);
  for (let i = 0; i < ids.size(); i++) walls.set(ids.get(i), 0);
  api.StreamAllMeshes(id, mesh => {
    if (!walls.has(mesh.expressID)) return;
    let vol = 0;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const g = api.GetGeometry(id, pg.geometryExpressID);
      const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      const m = pg.flatTransformation;
      const at = (vi: number): [number, number, number] => {
        const k = vi * 6;
        const x = verts[k]!, y = verts[k + 1]!, z = verts[k + 2]!;
        return [
          m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
          m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
          m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
        ];
      };
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = at(idx[t]!), b = at(idx[t + 1]!), c = at(idx[t + 2]!);
        vol += (a[0] * (b[1] * c[2] - c[1] * b[2])
          - a[1] * (b[0] * c[2] - c[0] * b[2])
          + a[2] * (b[0] * c[1] - c[0] * b[1])) / 6;
      }
    }
    walls.set(mesh.expressID, Math.abs(vol));
  });
  api.CloseModel(id);
  return [...walls.values()];
}

/**
 * Every wall vertex, in world mm: (x, y) plan position and z height -- unlike
 * wallVertices()/wallTriangles() above, not filtered to near the y = 0 line,
 * since a bulged wall's own footprint does not stay near its chord.
 */
function allWallPoints(api: WebIFC.IfcAPI, text: string): { x: number; y: number; z: number }[] {
  const id = api.OpenModel(new TextEncoder().encode(text));
  const walls = new Set<number>();
  const ids = api.GetLineIDsWithType(id, webifc.IFCWALL);
  for (let i = 0; i < ids.size(); i++) walls.add(ids.get(i));
  const out: { x: number; y: number; z: number }[] = [];
  api.StreamAllMeshes(id, mesh => {
    if (!walls.has(mesh.expressID)) return;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const g = api.GetGeometry(id, pg.geometryExpressID);
      const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const m = pg.flatTransformation;
      for (let vi = 0; vi * 6 < verts.length; vi++) {
        const k = vi * 6;
        const x = verts[k]!, y = verts[k + 1]!, z = verts[k + 2]!;
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        // web-ifc returns y-up metres; plan y is -z (see the module comment).
        out.push({ x: wx * 1000, y: wz * 1000, z: wy * 1000 });
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

  // ── issue #59: the sill and lintel bands around a flat wall's opening ────
  {
    const { doc, wall } = room(() => []);
    const win: Opening = { id: "o-win", kind: "window", t: 2000, width: 1000, sashes: [{ action: "fixed" }] };
    wall.openings.push(win);
    const text = toIfc(doc, 0);
    const verts = wallVertices(api, text);
    const tris = wallTriangles(api, text);
    const sLo = win.t - win.width / 2, sHi = win.t + win.width / 2;
    const sillZ = WINDOW_SILL_DEFAULT, headZ = WINDOW_SILL_DEFAULT + WINDOW_HEIGHT_DEFAULT;

    const nearSpan = verts.filter(p => p.s >= sLo - 3 && p.s <= sHi + 3);
    check("flat wall + window: no wall vertex stands inside the opening itself (sill < z < head)",
      nearSpan.length > 0 && nearSpan.every(p => p.z <= sillZ + TOL_MM || p.z >= headZ - TOL_MM),
      JSON.stringify(nearSpan.filter(p => p.z > sillZ + TOL_MM && p.z < headZ - TOL_MM).slice(0, 5)));
    check("flat wall + window: a real face fills the sill band across the opening's span",
      hasSpanningFaceAt(tris, sLo, sHi, sillZ));
    check("flat wall + window: a real face fills the lintel band across the opening's span",
      hasSpanningFaceAt(tris, sLo, sHi, headZ));
  }


  // ── issue #59: the wall's exported volume is the wall less its opening ────
  {
    // The opposite wall is thinner, so the windowed wall is the only body of
    // its own size and the check cannot read the wrong one.
    const { doc, wall } = room(() => []);
    const f0 = doc.floors[0]!;
    f0.walls[2]!.thickness = 100;
    wall.openings.push({ id: "o-vol", kind: "window", t: 2000, width: 1000, sillHeight: 900, height: 1200, sashes: [] });
    const h = floorHeight(f0);
    const piecesOnly = (3000 * 150 * h) / 1e9;                       // the two pieces beside the opening
    const lessOpening = (4000 * 150 * h - 1000 * 150 * 1200) / 1e9;  // what the wall should be
    const vols = wallVolumesM3(api, toIfc(doc, 0));
    const windowWall = vols.reduce((best, x) =>
      Math.abs(x - lessOpening) < Math.abs(best - lessOpening) ? x : best, Infinity);
    check("a wall with a window exports the wall less the opening, not the pieces beside it",
      Math.abs(windowWall - lessOpening) < 0.08 && windowWall > piecesOnly + 0.05,
      `${windowWall.toFixed(3)} m³, pieces only ${piecesOnly.toFixed(3)}, less opening ${lessOpening.toFixed(3)}, all ${JSON.stringify(vols.map(x => +x.toFixed(3)))}`);
  }

  // ── issue #59: a door with no sill gets a band above only ────────────────
  {
    const { doc, wall } = room(() => []);
    const door: Opening = { id: "o-door", kind: "door", t: 2000, width: 900, sashes: [{ action: "turn", hinge: "a" }] };
    wall.openings.push(door);
    const text = toIfc(doc, 0);
    const verts = wallVertices(api, text);
    const tris = wallTriangles(api, text);
    const sLo = door.t - door.width / 2, sHi = door.t + door.width / 2;

    const nearSpan = verts.filter(p => p.s >= sLo - 3 && p.s <= sHi + 3);
    check("door, no sill: no wall vertex stands between the floor and the head (no phantom sill band)",
      nearSpan.length > 0 && nearSpan.every(p => p.z <= TOL_MM || p.z >= DOOR_HEIGHT_DEFAULT - TOL_MM),
      JSON.stringify(nearSpan.filter(p => p.z > TOL_MM && p.z < DOOR_HEIGHT_DEFAULT - TOL_MM).slice(0, 5)));
    check("door, no sill: a real face fills the lintel band across the opening's span",
      hasSpanningFaceAt(tris, sLo, sHi, DOOR_HEIGHT_DEFAULT));
  }

  // ── issue #59: a gable wall's window under the ridge -- the band above
  //    follows the roof profile instead of the wall's own flat maximum ─────
  {
    const gable = (h: number): ProfilePoint[] =>
      [{ t: 0, height: h }, { t: 2000, height: h + 1600 }, { t: 4000, height: h }];
    const { doc, f, wall } = room(gable);
    // Off-centre from the ridge (t = 2000), so the roof over the opening's own
    // span is neither flat nor equal to the wall's overall maximum -- a band
    // extruded flat to that maximum would poke out above the true roof line.
    const win: Opening = { id: "o-gw", kind: "window", t: 2600, width: 800, sashes: [{ action: "fixed" }] };
    wall.openings.push(win);
    const text = toIfc(doc, 0);
    const verts = wallVertices(api, text);
    const tris = wallTriangles(api, text);
    const sLo = win.t - win.width / 2, sHi = win.t + win.width / 2; // 2200..3000
    const topLo = wallTopAt(f, wall, sLo), topHi = wallTopAt(f, wall, sHi);

    const inSpan = verts.filter(p => p.s >= -200 && p.s <= 4200);
    const above = inSpan.filter(p => p.z - wallTopAt(f, wall, Math.max(0, Math.min(4000, p.s))) > TOL_MM);
    check("gable window: no wall vertex, including the band above the head, stands above the roof profile",
      inSpan.length > 0 && above.length === 0, JSON.stringify(above.slice(0, 5)));
    // A flat band extruded to the wall's own overall maximum (h + 1600, the
    // ridge) would fail this: neither jamb sits at the ridge, so a real,
    // profile-following band connects two DIFFERENT heights end to end.
    check("gable window: the band above reaches the profile at both jambs, not a flat top",
      Math.abs(topLo - topHi) > 10 && hasSlopingFaceBetween(tris, sLo, topLo, sHi, topHi),
      `topLo=${topLo} topHi=${topHi}`);
  }

  // ── issue #54: slopedPieceSolid() must project via arc length, not chord ──
  {
    // A bulge-1 (semicircle) wall carrying a lean-to profile: wallTopAt() is
    // parameterised by arc length s, from 0 at node a to L (the arc length,
    // not the chord) at node b. slopedPieceSolid() used to project the
    // piece's own vertices onto the CHORD to read those two end heights,
    // which agrees with wallTopAt() only when the wall is straight -- here
    // the chord (4000 mm) is well under the arc length L (a full semicircle,
    // ~6283 mm), so the old height at node b read as if only 4000 of the
    // 6283 mm had been travelled.
    const doc = emptyDoc();
    const f = doc.floors[0]!;
    const h = floorHeight(f);
    f.nodes.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 });
    const A = { x: 0, y: 0 }, B = { x: 4000, y: 0 }, bulge = 1;
    const L = arcLength(A, B, bulge); // > the 4000 mm chord
    const wall: Wall = {
      id: "w-arc", a: "n1", b: "n2", thickness: 150, bulge, openings: [],
      profile: [{ t: 0, height: h }, { t: L, height: h + 1000 }],
    };
    f.walls.push(wall);
    const text = toIfc(doc, 0);
    const points = allWallPoints(api, text);

    // The wall's own reported top (Math.max over every exported vertex) is
    // slopedPieceSolid()'s flat extrusion height BEFORE the tilted clip --
    // Math.max(h0, h1) -- which the clip can only lower, never raise. h0 (at
    // node a, s = 0) reads the same under either projection, so this figure
    // is entirely decided by h1, read at node b: exactly the value the fix
    // changes. This is a robust, tessellation-independent readout, unlike
    // probing the interior of a heavily curved boolean-clip result, which a
    // very large bulge can leave web-ifc unable to evaluate cleanly.
    const gotTop = Math.max(...points.map(p => p.z));
    const expected = wallTopAt(f, wall, L); // the profile's own peak, h + 1000
    check("an arc wall's exported top reaches wallTopAt(L), not a chord-distance mismeasure",
      Math.abs(gotTop - expected) <= 1, `${gotTop} vs ${expected}`);

    // The wall's own true midpoint (s = L/2): by the semicircle's symmetry,
    // this is also the apex, and the apex's tangent is parallel to the
    // chord, so a face vertex there is displaced purely PERPENDICULAR to the
    // chord and still projects onto it at exactly half the chord length --
    // the clip plane's own linear interpolation and wallTopAt() therefore
    // agree there exactly, in principle. In practice a bulge this large
    // pushes the boundary rectangle slopedPieceSolid() builds (itself a
    // tangent-line approximation, like an arc's own miter) past what the
    // tessellator resolves cleanly, so this is read with a wide tolerance,
    // as a second, independent confirmation rather than the primary check.
    const mid = arcPointAt(A, B, bulge, 0.5);
    const near = points.filter(p => Math.hypot(p.x - mid.x, p.y - mid.y) <= wall.thickness);
    const midExpected = wallTopAt(f, wall, L / 2);
    const midGot = near.length > 0 ? Math.max(...near.map(p => p.z)) : NaN;
    check("and the apex is at least closer to wallTopAt(L/2) than to the wall's flat height",
      near.length > 0 && Math.abs(midGot - midExpected) < Math.abs(midGot - h),
      `${midGot} vs ${midExpected} (wall height ${h})`);
  }
}

await run();
console.log(failures === 0 ? "ALL IFC CLIP TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
