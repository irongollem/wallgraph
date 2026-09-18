// A voorzetwand (Wall.buildUp's FaceFrame) is derived into a wall of its own
// by leafFloor()/resolveLeaves() -- see core/leaf.ts's module comment. These
// tests exercise the geometry that derivation produces: shared corner nodes,
// where a leaf stops against an unframed neighbour, opening and profile
// mapping onto the leaf's own centerline, and that a flip or an arc host
// carries through correctly.
import {
  emptyDoc, newId, type Floor, type Wall, type Opening, type FaceFrame,
  frameOf, buildUpMm,
} from "../src/model/doc";
import { nodeAt, splitWall, flipWall } from "../src/model/ops";
import { resolveFloor } from "../src/core/resolve";
import { leafFloor, resolveLeaves } from "../src/core/leaf";
import { detectRooms } from "../src/core/rooms";
import { lintelCheck } from "../src/core/checks";
import { wallTopAt } from "../src/model/profile";
import { v, dist } from "../src/geometry/vec";
import { arcInfo, arcLength, sweepOf } from "../src/geometry/arc";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
function near(a: number, b: number, tol = 1): boolean { return Math.abs(a - b) <= tol; }

function frame(over: Partial<FaceFrame> = {}): FaceFrame {
  return { gapMm: 20, depthMm: 50, material: "steel", ...over };
}
function opening(over: Partial<Opening> & Pick<Opening, "kind" | "t" | "width">): Opening {
  return { id: newId("o"), sashes: [], ...over };
}

// ---- a rectangular room, framed on the inside face of all four walls ------
//
// Walls a->b in the order rectFloor()-style tests use (0,0)->(4000,0)->
// (4000,3000)->(0,3000)->(0,0): under y-down this traversal keeps "left"
// (invariant 2, perp(tangent)) on the room's own inside for every one of the
// four walls, so buildUp.left is the voorzetwand facing into the room on
// each of them -- see CLAUDE.md's derivation for detectRooms()'s own
// boundingFaces.

{
  const f = emptyDoc().floors[0]!;
  const ids = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)].map(p => nodeAt(f, p).id);
  const boards = [{ kind: "gypsum" as const, mm: 12 }];
  for (let i = 0; i < 4; i++) {
    f.walls.push({
      id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 100, bulge: 0, openings: [],
      material: "steel", buildUp: { left: { frame: frame(), boards } },
    });
  }

  const resolved = resolveFloor(f);
  const leaf = leafFloor(f, resolved);
  check("four leaf walls, one per host wall's framed face", leaf.floor.walls.length === 4,
    String(leaf.floor.walls.length));
  // The proof that two leaves meeting at a corner share a POINT rather than
  // each ending at its own: 4 walls * 2 ends = 8 candidates, clustering into
  // the 4 physical corners.
  check("the leaf floor has four nodes, not eight", leaf.floor.nodes.length === 4,
    String(leaf.floor.nodes.length));
  check("every host wall's left face resolved to a leaf",
    f.walls.every(w => leaf.leafOf(w.id, "left") !== undefined));
  check("no host wall's right (unframed) face got a leaf",
    f.walls.every(w => leaf.leafOf(w.id, "right") === undefined));

  const inset = 100 / 2 + buildUpMm(f.walls[0]!, "left"); // half-thickness + gap + depth + boards
  check("inset is half-thickness plus buildUpMm (50 + 82 = 132)", inset === 132, String(inset));
  const room = detectRooms(f)[0]!;
  const expectedNet = (4000 - 2 * inset) * (3000 - 2 * inset);
  check("the room's net area is the centerline rectangle inset by gap + depth + boards on every side",
    near(room.netAreaMm2, expectedNet, 4), `${room.netAreaMm2} vs ${expectedNet}`);
}

// ---- a framed wall teeing into an unframed wall ----------------------------
//
// U (unframed, 200mm) runs the full 0..6000 span; splitWall() gives it a real
// node at (3000,0), the same graph move any T in this document goes through.
// H (framed on its own left, 100mm) starts there and runs into the page.
// Because U states no skin, the corner pass at the frame's own depth can only
// push H's own end out -- U's end stays at its own structural face -- so the
// leaf's "a" end lands offset along U's own length by exactly U's own half
// thickness (100mm), not at the host's centerline node (3000,0) itself.

{
  const f = emptyDoc().floors[0]!;
  const u: Wall = {
    id: "U", a: nodeAt(f, v(0, 0)).id, b: nodeAt(f, v(6000, 0)).id,
    thickness: 200, bulge: 0, openings: [], material: "concrete",
  };
  f.walls.push(u);
  const mid = splitWall(f, u, 3000)!;
  const h: Wall = {
    id: "H", a: mid.id, b: nodeAt(f, v(3000, 3000)).id,
    thickness: 100, bulge: 0, openings: [], material: "steel",
    buildUp: { left: { frame: frame(), boards: [] } },
  };
  f.walls.push(h);

  const resolved = resolveFloor(f);
  const leaf = leafFloor(f, resolved);
  const leafWall = leaf.leafOf("H", "left")!;
  check("the tee produces a leaf", leafWall !== undefined);
  const aNode = leaf.floor.nodes.find(n => n.id === leafWall.a)!;

  check("the leaf's near end is not at the host's centerline node (3000,0)",
    dist(v(aNode.x, aNode.y), v(3000, 0)) > 50, JSON.stringify(aNode));
  check("the leaf's near end sits on U's own face (100mm off U's centerline), not U's centerline itself",
    near(aNode.y, 100, 1), JSON.stringify(aNode));
  // The along-U offset is exactly what the corner pass at the frame's own
  // zone depths (20 and 70) resolves to: worked out by hand and checked
  // against the live geometry once (see the PR/commit history for the
  // derivation), then pinned here as the regression number.
  check("the leaf's near end lands at (2905, 100)",
    near(aNode.x, 2905, 1) && near(aNode.y, 100, 1), JSON.stringify(aNode));
}

// ---- a framed face meeting an unframed face of a neighbour at an L --------
//
// H (framed on its left, 100mm) runs (0,0)->(4000,0); N (unframed, 100mm)
// runs (4000,0)->(4000,3000), meeting H at an ordinary corner. N carries no
// skin, so the corner pass at each of H's own frame-zone depths (20 and 70)
// stops at N's own structural face (half N's thickness = 50mm off N's
// centerline, i.e. x = 3950) rather than at N's centerline (x = 4000) or at
// some point pushed further by N. H's own push (across its own thickness)
// still applies on the other axis, landing the corner's y at half + the
// zone's own mid-depth (50 + 45 = 95).

{
  const f = emptyDoc().floors[0]!;
  const h: Wall = {
    id: "H", a: nodeAt(f, v(0, 0)).id, b: nodeAt(f, v(4000, 0)).id,
    thickness: 100, bulge: 0, openings: [], material: "steel",
    buildUp: { left: { frame: frame(), boards: [] } },
  };
  const n: Wall = {
    id: "N", a: nodeAt(f, v(4000, 0)).id, b: nodeAt(f, v(4000, 3000)).id,
    thickness: 100, bulge: 0, openings: [], material: "concrete",
  };
  f.walls.push(h, n);

  const resolved = resolveFloor(f);
  const leaf = leafFloor(f, resolved);
  const leafWall = leaf.leafOf("H", "left")!;
  const bNode = leaf.floor.nodes.find(nd => nd.id === leafWall.b)!;

  check("the leaf's far end sits on N's own finished face (x = 4000 - 50), not N's centerline",
    near(bNode.x, 3950, 1), JSON.stringify(bNode));
  check("and at H's own frame-zone mid-depth off H's centerline (y = 95)",
    near(bNode.y, 95, 1), JSON.stringify(bNode));
}

// ---- opening mapping: a door at t=1000 on the host lands at the same ------
// ---- position along the wall on the leaf -----------------------------------
//
// A standalone straight wall (both ends free) offsets its leaf purely
// perpendicular to itself -- no miter shift along the wall's own length --
// so the leaf's own centerline runs exactly parallel to the host's, and a
// world position along the wall (x, here) carries straight across. Checking
// the WORLD position (not just the mapped `t`) is what catches a mapping
// that shifts (wrong startHostMm) as well as one that scales (wrong ratio):
// either would move this point away from x = 1000.

{
  const f = emptyDoc().floors[0]!;
  const w: Wall = {
    id: "H", a: nodeAt(f, v(0, 0)).id, b: nodeAt(f, v(5000, 0)).id,
    thickness: 100, bulge: 0, material: "steel",
    buildUp: { left: { frame: frame(), boards: [] } },
    openings: [opening({ kind: "door", t: 1000, width: 900 })],
  };
  f.walls.push(w);

  const resolved = resolveFloor(f);
  const leaf = leafFloor(f, resolved);
  const leafWall = leaf.leafOf("H", "left")!;
  const leafOpening = leafWall.openings[0]!;
  check("the leaf keeps the door's own t and width on a parallel offset",
    leafOpening.t === 1000 && leafOpening.width === 900,
    `t=${leafOpening.t} width=${leafOpening.width}`);

  const aNode = leaf.floor.nodes.find(n => n.id === leafWall.a)!;
  const bNode = leaf.floor.nodes.find(n => n.id === leafWall.b)!;
  const leafLen = dist(v(aNode.x, aNode.y), v(bNode.x, bNode.y));
  const worldCenter = {
    x: aNode.x + (bNode.x - aNode.x) * (leafOpening.t / leafLen),
    y: aNode.y + (bNode.y - aNode.y) * (leafOpening.t / leafLen),
  };
  check("the door's world position on the leaf sits at the same x as on the host (1000)",
    near(worldCenter.x, 1000, 1), JSON.stringify(worldCenter));
}

// ---- an arc host: the leaf's bulge matches, and its length is the ---------
// ---- concentric offset's own length -----------------------------------------
//
// A 2000mm chord, bulge 1 (a semicircle, radius 1000). The frame's own zone
// (20..70) plus the wall's half-thickness offsets the leaf by 50 + 45 = 95mm
// outward, along each endpoint's own radius (perpendicular to the tangent
// there, which for a circle IS the radius direction) -- a genuine concentric
// offset, radius 1095, same sweep. Its length is therefore 1095 * theta, not
// merely "longer than the host's".

{
  const f = emptyDoc().floors[0]!;
  const A = v(0, 0), B = v(2000, 0), bulge = 1;
  const w: Wall = {
    id: "H", a: nodeAt(f, A).id, b: nodeAt(f, B).id,
    thickness: 100, bulge, material: "steel",
    buildUp: { left: { frame: frame(), boards: [] } },
    openings: [],
  };
  f.walls.push(w);

  const resolved = resolveFloor(f);
  const leaf = leafFloor(f, resolved);
  const leafWall = leaf.leafOf("H", "left")!;
  check("the leaf carries the host's own bulge", leafWall.bulge === w.bulge,
    `${leafWall.bulge} vs ${w.bulge}`);

  const aNode = leaf.floor.nodes.find(n => n.id === leafWall.a)!;
  const bNode = leaf.floor.nodes.find(n => n.id === leafWall.b)!;
  const actualLen = arcLength(v(aNode.x, aNode.y), v(bNode.x, bNode.y), leafWall.bulge);

  const info = arcInfo(A, B, bulge)!;
  const theta = Math.abs(sweepOf(info));
  const offset = 100 / 2 + (20 + 70) / 2; // half-thickness + the frame zone's own mid-depth
  const expectedLen = (info.radius + offset) * theta;
  check("the leaf's length is the concentric offset's own radius times the same sweep",
    near(actualLen, expectedLen, 1), `${actualLen} vs ${expectedLen} (R=${info.radius}, offset=${offset})`);
}

// ---- flipping the host leaves the leaf floor geometrically identical ------
//
// flipWall() swaps buildUp.left/right whole (see model/ops.ts), so the frame
// that was on "left" is on "right" afterwards -- same physical face, new
// key. Querying the leaf under its new key must give back the same physical
// leaf: same pair of endpoints (as a SET -- a and b may swap), same length,
// same opening in the same world place. Ids and a/b order are free to differ.

{
  const build = (): Floor => {
    const f = emptyDoc().floors[0]!;
    f.walls.push({
      id: "H", a: nodeAt(f, v(0, 0)).id, b: nodeAt(f, v(5000, 0)).id,
      thickness: 100, bulge: 0, material: "steel",
      buildUp: { left: { frame: frame(), boards: [{ kind: "gypsum", mm: 12 }] } },
      openings: [opening({ kind: "door", t: 1000, width: 900 })],
    });
    return f;
  };

  const endsAndOpeningOf = (f: Floor, wallId: string, side: "left" | "right") => {
    const resolved = resolveFloor(f);
    const leaf = leafFloor(f, resolved);
    const leafWall = leaf.leafOf(wallId, side)!;
    const a = leaf.floor.nodes.find(n => n.id === leafWall.a)!;
    const b = leaf.floor.nodes.find(n => n.id === leafWall.b)!;
    const points = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort();
    const len = dist(v(a.x, a.y), v(b.x, b.y));
    const o = leafWall.openings[0]!;
    const worldCenter = { x: a.x + (b.x - a.x) * (o.t / len), y: a.y + (b.y - a.y) * (o.t / len) };
    return { points, len, worldCenter };
  };

  const before = build();
  const beforeGeom = endsAndOpeningOf(before, "H", "left");

  const after = build();
  flipWall(after, after.walls[0]!);
  check("the frame moved from left to right", frameOf(after.walls[0]!, "right") !== undefined
    && frameOf(after.walls[0]!, "left") === undefined);
  const afterGeom = endsAndOpeningOf(after, "H", "right");

  check("the leaf's endpoints are the same pair of points either way",
    JSON.stringify(beforeGeom.points) === JSON.stringify(afterGeom.points),
    `${JSON.stringify(beforeGeom.points)} vs ${JSON.stringify(afterGeom.points)}`);
  check("the leaf's length is unchanged", near(beforeGeom.len, afterGeom.len, 1),
    `${beforeGeom.len} vs ${afterGeom.len}`);
  check("the door lands at the same world position either way",
    near(beforeGeom.worldCenter.x, afterGeom.worldCenter.x, 1)
    && near(beforeGeom.worldCenter.y, afterGeom.worldCenter.y, 1),
    `${JSON.stringify(beforeGeom.worldCenter)} vs ${JSON.stringify(afterGeom.worldCenter)}`);
}

// ---- profile: a gable host yields a leaf whose top matches it at the ------
// ---- host's own stated points, capped by heightMm ---------------------------
//
// A standalone wall (own height 2600, a single stated ridge point of 4600 at
// its midpoint) maps straight across (ratio 1, no shift -- see the opening
// case above), so the leaf's own t equals world x exactly like the host's.
// mapProfile() only STATES the host's own points (its two ends and whatever
// interior points the host itself carries) on the leaf, each capped; it does
// not resample the host's curve at every position, so the comparison only
// holds AT those stated points, not at an arbitrary point between them.

{
  const f = emptyDoc().floors[0]!;
  const w: Wall = {
    id: "H", a: nodeAt(f, v(0, 0)).id, b: nodeAt(f, v(4000, 0)).id,
    thickness: 100, bulge: 0, material: "steel", height: 2600,
    profile: [{ t: 2000, height: 4600 }],
    buildUp: { left: { frame: frame({ heightMm: 3000 }), boards: [] } },
    openings: [],
  };
  f.walls.push(w);

  const resolved = resolveFloor(f);
  const leaf = leafFloor(f, resolved);
  const leafWall = leaf.leafOf("H", "left")!;

  for (const t of [0, 2000, 4000]) {
    const hostH = wallTopAt(f, w, t);
    const leafH = wallTopAt(leaf.floor, leafWall, t);
    const expected = Math.min(hostH, 3000);
    check(`at t=${t} the leaf's top is the host's own (${hostH}), capped at heightMm (3000)`,
      near(leafH, expected, 1), `leaf=${leafH} expected=${expected}`);
  }
  check("the ridge itself is capped below the host's own uncapped height",
    wallTopAt(leaf.floor, leafWall, 2000) < wallTopAt(f, w, 2000));
  check("the leaf's own nominal height is the host's wallHeight, also capped",
    leafWall.height === 2600); // 2600 is already under the 3000 cap
}

// ---- a frame with an empty board stack is a legitimate state --------------
//
// FaceBuildUp.boards may be empty while frame is present -- a voorzetwand
// with nothing hung on it yet (see model/doc.ts's own comment on
// FaceBuildUp). The emptiness rule buildUpOf() applies drops a face with
// NEITHER boards nor a frame; a frame alone must survive it, and so must the
// leaf derived from it.

{
  const f = emptyDoc().floors[0]!;
  const w: Wall = {
    id: "H", a: nodeAt(f, v(0, 0)).id, b: nodeAt(f, v(4000, 0)).id,
    thickness: 100, bulge: 0, material: "steel",
    buildUp: { left: { frame: frame(), boards: [] } },
    openings: [],
  };
  f.walls.push(w);

  check("a frame with no boards is still reported by frameOf()", frameOf(w, "left") !== undefined);
  check("buildUpMm is gap + depth alone, no board contribution",
    buildUpMm(w, "left") === 70, String(buildUpMm(w, "left")));

  const { leaf, resolved } = resolveLeaves(f, resolveFloor(f));
  const leafWall = leaf.leafOf("H", "left");
  check("a leaf is still derived for a frame with an empty board stack", leafWall !== undefined);
  if (leafWall) {
    check("the leaf's own thickness is the frame's depth", leafWall.thickness === 50,
      String(leafWall.thickness));
    const rw = resolved.walls.get(leafWall.id);
    check("the leaf resolves to at least one solid piece", (rw?.pieces.length ?? 0) >= 1);
  }
}

// ---- a mapped opening drops the host's own lintel and its floor load ------
//
// A voorzetwand's opening carries neither `lintel` (the host's own chosen
// section) nor `lintelLoadKNm` (a floor bearing on the HOST wall above it) --
// see leaf.ts's mapOpenings(). lintelCheck() (core/checks.ts) then reports
// the leaf opening as incomplete with its own proposal, rather than passing
// the host's section off as a header nobody specified for a stud frame that
// does not take the floor's load at all.

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const door = opening({
    kind: "door", t: 2000, width: 900, sillHeight: 0, height: 2315,
    lintel: { w: 89, d: 140 }, lintelLoadKNm: 3,
  });
  const w: Wall = {
    id: "H", a: nodeAt(f, v(0, 0)).id, b: nodeAt(f, v(4000, 0)).id,
    thickness: 100, bulge: 0, material: "masonry",
    buildUp: { left: { frame: frame(), boards: [] } },
    openings: [door],
  };
  f.walls.push(w);

  const resolved = resolveFloor(f);
  const leaf = leafFloor(f, resolved);
  const leafWall = leaf.leafOf("H", "left")!;
  const leafOpening = leafWall.openings[0]!;

  check("the leaf's mapped opening carries no lintel", leafOpening.lintel === undefined,
    JSON.stringify(leafOpening.lintel));
  check("the leaf's mapped opening carries no lintelLoadKNm", leafOpening.lintelLoadKNm === undefined,
    String(leafOpening.lintelLoadKNm));

  const hostResult = lintelCheck(doc, f, w, door);
  check("the host's own opening, with a stated lintel and load, checks ok",
    hostResult.status === "ok", hostResult.status);

  const leafResult = lintelCheck(doc, leaf.floor, leafWall, leafOpening);
  check("the leaf's own opening is incomplete -- it states no lintel section",
    leafResult.status === "incomplete" && leafResult.missing.includes("lintelSection"),
    JSON.stringify(leafResult));
  check("lintelCheck still proposes a section for the leaf, from the frame's own self-weight",
    leafResult.proposal !== null && leafResult.proposal !== undefined, JSON.stringify(leafResult.proposal));
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
