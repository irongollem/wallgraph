// The 3D appearance table, its overrides, and how the document fields travel
// through wall split, flip and merge.
import {
  PATTERN_IDS, patchAppearance, defaultAppearance, resolveAppearance, parseHexColor, FITOUT_MATERIALS,
  WALL_COLOR, GLASS_COLOR, type AppearanceKey,
} from "../src/model/appearance";
import { WALL_MATERIALS, BOARD_KINDS, emptyDoc, newId, type Wall } from "../src/model/doc";
import { MESH_PARTS } from "../src/render3d/mesh";
import { patchOverride } from "../src/ui/appearance";
import { Store } from "../src/model/store";
import { splitWall, flipWall } from "../src/model/ops";
import { planNodeDissolve, isDissolvePlan, applyNodeDissolve } from "../src/core/join";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}
const sameRgb = (a: readonly number[], b: readonly number[]): boolean => a.every((x, i) => Math.abs(x - b[i]!) < 1e-9);
const valid = (k: AppearanceKey): boolean => {
  const a = defaultAppearance(k);
  return a.color.length === 3 && a.color.every(c => c >= 0 && c <= 1)
    && a.roughness >= 0 && a.roughness <= 1 && PATTERN_IDS.includes(a.pattern);
};

// Every key resolves to a well-formed appearance.
check("every WallMaterial resolves", WALL_MATERIALS.every(material => valid({ part: "wall", material })));
check("an unstated wall material resolves", valid({ part: "wall" }));
check("every BoardKind resolves", BOARD_KINDS.every(kind => valid({ part: "board", kind })));
check("every FitoutMaterial resolves", FITOUT_MATERIALS.every(material => valid({ part: "fitout", material })));
check("both frame materials resolve", (["timber", "steel"] as const).every(material => valid({ part: "frame", material })));
const keyOf = (part: typeof MESH_PARTS[number]): AppearanceKey =>
  part === "wall" ? { part } : part === "board" ? { part, kind: "gypsum" }
    : part === "frame" ? { part, material: "timber" } : part === "fitout" ? { part, material: "casework" }
      : { part };
check("every MeshPart resolves", MESH_PARTS.every(p => valid(keyOf(p))));

// The table's stated entries.
const patternOf = (k: AppearanceKey) => defaultAppearance(k).pattern;
check("masonry is brick", patternOf({ part: "wall", material: "masonry" }) === "brick");
check("calcium silicate and aerated are block",
  patternOf({ part: "wall", material: "calciumsilicate" }) === "block" && patternOf({ part: "wall", material: "aerated" }) === "block");
check("concrete, timber, steel and sandwich patterns",
  patternOf({ part: "wall", material: "concrete" }) === "concrete" && patternOf({ part: "wall", material: "timber" }) === "timber"
  && patternOf({ part: "wall", material: "steel" }) === "steel" && patternOf({ part: "wall", material: "sandwich" }) === "panel");
check("gypsum boards are plaster, osb and plywood timber",
  patternOf({ part: "board", kind: "gypsum" }) === "plaster" && patternOf({ part: "board", kind: "gypsumFibre" }) === "plaster"
  && patternOf({ part: "board", kind: "osb" }) === "timber" && patternOf({ part: "board", kind: "plywood" }) === "timber");
check("facade is brick and roof is tile", patternOf({ part: "facade" }) === "brick" && patternOf({ part: "roof" }) === "tile");
const unstated = defaultAppearance({ part: "wall" });
check("an unstated wall keeps the neutral tone with no pattern", sameRgb(unstated.color, WALL_COLOR) && unstated.pattern === "none");
check("glass keeps its wash", sameRgb(defaultAppearance({ part: "wall", material: "glass" }).color, GLASS_COLOR)
  && sameRgb(defaultAppearance({ part: "glass" }).color, GLASS_COLOR));
check("roughness follows the stated figures",
  defaultAppearance({ part: "wall", material: "masonry" }).roughness === 0.9
  && defaultAppearance({ part: "wall", material: "timber" }).roughness === 0.6
  && defaultAppearance({ part: "wall", material: "steel" }).roughness === 0.35
  && defaultAppearance({ part: "glass" }).roughness === 0.2
  && defaultAppearance({ part: "fitout", material: "sanitary" }).roughness === 0.3
  && defaultAppearance({ part: "fitout", material: "appliance" }).roughness === 0.5);

// Overrides.
{
  const key: AppearanceKey = { part: "wall", material: "masonry" };
  const a = resolveAppearance(key, { color: "#ff8000", pattern: "concrete" });
  check("an override colour applies", sameRgb(a.color, [1, 128 / 255, 0]));
  check("an override pattern applies", a.pattern === "concrete");
  check("roughness stays the table's", a.roughness === defaultAppearance(key).roughness);
  const c = resolveAppearance(key, { color: "#00ff00" });
  check("a colour alone keeps the table pattern", c.pattern === "brick");
  const bad = resolveAppearance(key, { color: "red", pattern: "marble" as never });
  check("a malformed colour and unknown pattern fall back to the table",
    sameRgb(bad.color, defaultAppearance(key).color) && bad.pattern === "brick");
  check("a short hex is malformed", parseHexColor("#fff") === null && parseHexColor("#12345g") === null);
  check("resolving without an override equals the default", sameRgb(resolveAppearance(key).color, defaultAppearance(key).color));
}

// Split, flip and merge.
function pair(): { f: ReturnType<typeof emptyDoc>["floors"][number]; w: Wall } {
  const f = emptyDoc().floors[0]!;
  f.nodes.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 });
  const w: Wall = { id: newId("w"), a: "n1", b: "n2", thickness: 100, bulge: 0, openings: [] };
  f.walls.push(w);
  return { f, w };
}
{
  const { f, w } = pair();
  w.appearance = { color: "#112233", pattern: "brick" };
  w.facadeAppearance = { pattern: "tile" };
  w.buildUp = { left: { boards: [{ kind: "gypsum", mm: 12 }], appearance: { color: "#445566" } } };
  const mid = splitWall(f, w, 1500)!;
  const far = f.walls.find(x => x.id !== w.id)!;
  check("a split carries the body appearance to both halves",
    far.appearance?.color === "#112233" && w.appearance?.pattern === "brick");
  check("a split carries the facade appearance to both halves", far.facadeAppearance?.pattern === "tile");
  check("a split carries a face's appearance to both halves",
    far.buildUp?.left?.appearance?.color === "#445566" && w.buildUp?.left?.appearance?.color === "#445566");
  check("the halves share no override object",
    far.appearance !== w.appearance && far.facadeAppearance !== w.facadeAppearance
    && far.buildUp!.left!.appearance !== w.buildUp!.left!.appearance);
  const plan = planNodeDissolve(f, mid.id);
  check("halves that agree re-merge", isDissolvePlan(plan));
  if (isDissolvePlan(plan)) {
    applyNodeDissolve(f, plan);
    check("the merged wall keeps the appearance", f.walls.length === 1 && f.walls[0]!.appearance?.color === "#112233");
  }
  const mid2 = splitWall(f, f.walls[0]!, 2000)!;
  const far2 = f.walls.find(x => x.id !== f.walls[0]!.id)!;
  far2.appearance = { color: "#998877", pattern: "brick" };
  check("a differing body appearance refuses the merge", !isDissolvePlan(planNodeDissolve(f, mid2.id)));
  far2.appearance = { color: "#112233", pattern: "brick" };
  far2.buildUp!.left!.appearance = { color: "#000000" };
  check("a differing face appearance refuses the merge", !isDissolvePlan(planNodeDissolve(f, mid2.id)));
}
{
  const { f, w } = pair();
  w.buildUp = { left: { boards: [{ kind: "gypsum", mm: 12 }], appearance: { color: "#445566" } }, right: { boards: [{ kind: "osb", mm: 15 }] } };
  w.appearance = { color: "#112233" };
  flipWall(f, w);
  check("a flip moves a face's appearance with its face",
    w.buildUp?.right?.appearance?.color === "#445566" && w.buildUp?.left?.appearance === undefined);
  check("a flip leaves the body appearance", w.appearance?.color === "#112233");
}

// A patch describes one field; a bulk edit keeps each member's other fields.
{
  const a: { appearance?: import("../src/model/appearance").AppearanceOverride } = { appearance: { color: "#111111", texture: "t1" } };
  const b: typeof a = { appearance: { color: "#222222", pattern: "brick" } };
  const c: typeof a = {};
  for (const w of [a, b, c]) patchOverride(w, "appearance", { pattern: "tile" });
  check("a pattern patch keeps each member's colour and texture",
    a.appearance?.color === "#111111" && a.appearance.texture === "t1" && a.appearance.pattern === "tile"
    && b.appearance?.color === "#222222" && b.appearance.pattern === "tile"
    && c.appearance?.pattern === "tile" && c.appearance.color === undefined);
  for (const w of [a, b, c]) patchOverride(w, "appearance", { pattern: null });
  check("a null field clears only that field",
    a.appearance?.color === "#111111" && a.appearance.pattern === undefined && b.appearance?.color === "#222222");
  check("an override that empties is deleted", (() => { patchOverride(c, "appearance", { pattern: null }); return !("appearance" in c); })());
  patchOverride(a, "appearance", null);
  check("a null patch clears the whole override", !("appearance" in a));
  check("patchAppearance with an empty patch changes nothing", patchAppearance({ color: "#333333" }, {})?.color === "#333333");
}

// Adding a texture and assigning it under one coalesce key is one undo step.
{
  const store = new Store();
  store.replace(emptyDoc());
  const w = store.floor.walls;
  w.push({ id: "w1", a: "n1", b: "n2", thickness: 100, bulge: 0, openings: [] });
  const before = JSON.stringify(store.doc);
  const key = "appearance:wall:w1:appearance";
  store.mutate(d => { (d.textures ?? (d.textures = [])).push({ id: "tx1", name: "x", dataUrl: "data:image/png;base64,AA", widthMm: 1, heightMm: 1 }); }, key);
  store.mutate(d => { patchOverride(store.floorOf(d).walls[0]!, "appearance", { texture: "tx1" }); }, key);
  check("the texture and its assignment landed", store.doc.textures?.length === 1 && store.floor.walls[0]!.appearance?.texture === "tx1");
  store.undo();
  check("one undo removes both", JSON.stringify(store.doc) === before);
}

console.log(failures === 0 ? "ALL APPEARANCE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
