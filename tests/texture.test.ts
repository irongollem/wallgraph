// User-loaded textures: the fallback for a missing one, removal across every
// element that can name one, the share link leaving them out, and the mesh
// surface layer.
import { emptyDoc, newId, type PlanDoc, type Wall } from "../src/model/doc";
import { resolveAppearance, removeTexture, texturesOf, textureById, type Texture } from "../src/model/appearance";
import { buildSceneMesh } from "../src/render3d/mesh";
import { encodePlan, decodePlan } from "../src/io/link";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const tex = (id: string): Texture => ({ id, name: id, dataUrl: "data:image/jpeg;base64,AAAA", widthMm: 215, heightMm: 65 });

function docWithWall(appearance?: Wall["appearance"]): PlanDoc {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const pts = [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)];
  const ids = pts.map(p => { const id = newId("n"); f.nodes.push({ id, x: p.x, y: p.y }); return id; });
  for (let i = 0; i < 4; i++) {
    f.walls.push({
      id: newId("w"), a: ids[i]!, b: ids[(i + 1) % 4]!, thickness: 100, bulge: 0, openings: [],
      material: "masonry", ...(i === 0 && appearance ? { appearance } : {}),
    });
  }
  return doc;
}

// Accessors and fallback.
const d0 = emptyDoc();
check("no textures reads as empty", texturesOf(d0).length === 0 && textureById(d0, "x") === undefined);
const named = resolveAppearance({ part: "wall", material: "masonry" }, { pattern: "tile", texture: "gone" });
check("an override keeps its pattern beside a texture id", named.pattern === "tile" && named.texture === "gone");

// Mesh layers.
const held = docWithWall({ texture: "t1" });
held.textures = [tex("t1")];
const m = buildSceneMesh(held);
const layers = new Set<number>();
for (let i = 3; i < m.surfaces.length; i += 4) layers.add(m.surfaces[i]!);
check("the mesh carries the texture list", m.textures.length === 1 && m.textures[0]!.id === "t1");
check("a held texture sets layer 0", layers.has(0));
check("other surfaces stay at -1", layers.has(-1));
const lit = (() => {
  let n = 0;
  for (let i = 0; i < m.surfaces.length; i += 4) if (m.surfaces[i + 3] === 0) {
    n++;
    const k = i / 4 * 3;
    if (m.colors[k] !== 1 || m.colors[k + 1] !== 1 || m.colors[k + 2] !== 1 || m.surfaces[i + 1] !== 0) return -1;
  }
  return n;
})();
check("a textured vertex is untinted with no pattern", lit > 0);

const missing = docWithWall({ texture: "gone", pattern: "tile" });
const mm = buildSceneMesh(missing);
let anyLayer = false, anyTile = false;
const tileIdx = 6;
for (let i = 0; i < mm.surfaces.length; i += 4) {
  if (mm.surfaces[i + 3]! >= 0) anyLayer = true;
  if (mm.surfaces[i + 1] === tileIdx) anyTile = true;
}
check("a missing texture leaves no layer", !anyLayer);
check("a missing texture falls back to its pattern", anyTile);

// Removal clears overrides everywhere.
const all = docWithWall({ texture: "t1", color: "#aa0000" });
all.textures = [tex("t1"), tex("t2")];
const f = all.floors[0]!;
const w0 = f.walls[0]!;
w0.facadeAppearance = { texture: "t1" };
w0.buildUp = { left: { boards: [{ kind: "gypsum", mm: 12 }], appearance: { texture: "t1" } } };
w0.openings.push({ id: "o1", kind: "door", t: 1000, width: 900, sashes: [], appearance: { texture: "t1" } } as never);
f.walls[1]!.appearance = { texture: "t2" };
f.roofPlanes = [{ id: "r1", appearance: { texture: "t1", pattern: "tile" } } as never];
f.furnishings = [{ id: "u1", appearance: { texture: "t1" } } as never];
f.stairs = [{ id: "s1", appearance: { texture: "t1" } } as never];
f.structure = [{ id: "c1", appearance: { texture: "t1" } } as never];
f.decks = [{ id: "k1", appearance: { texture: "t1" } } as never];
removeTexture(all, "t1");
check("the texture is gone", texturesOf(all).map(x => x.id).join() === "t2");
check("a colour beside it survives", JSON.stringify(w0.appearance) === '{"color":"#aa0000"}');
check("an override left empty is removed",
  w0.facadeAppearance === undefined && w0.buildUp!.left!.appearance === undefined
  && w0.openings[0]!.appearance === undefined && f.furnishings![0]!.appearance === undefined
  && f.stairs![0]!.appearance === undefined && f.structure![0]!.appearance === undefined
  && f.decks![0]!.appearance === undefined);
check("a pattern beside it survives", JSON.stringify(f.roofPlanes![0]!.appearance) === '{"pattern":"tile"}');
check("another texture's override is untouched", f.walls[1]!.appearance?.texture === "t2");
removeTexture(all, "t2");
check("the last removal drops the field", all.textures === undefined && f.walls[1]!.appearance === undefined);

// Share link.
const shared = docWithWall({ texture: "t1" });
shared.textures = [tex("t1")];
const back = await decodePlan(await encodePlan(shared));
check("the share link omits textures", back !== null && back.textures === undefined);
check("the link keeps the override", back?.floors[0]?.walls[0]?.appearance?.texture === "t1");
check("encoding does not touch the document", shared.textures.length === 1);

console.log(failures === 0 ? "ALL TEXTURE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
