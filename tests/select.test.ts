// Multi-select and bulk edit (issue #2). What is checked here is the part
// decidable without a browser -- store semantics, the marquee's pure pick
// logic, one-undo-step bulk mutation, group delete, mixed-value detection,
// and the i18n surface -- the same boundary tests/mobile.test.ts draws for
// the touch gestures themselves, which need a live canvas and pointers.
import { emptyDoc, newId, type Wall } from "../src/model/doc";
import { Store, MULTI_SELECT_KINDS, type SelKind, type Selection } from "../src/model/store";
import { deleteWall } from "../src/model/ops";
import { marqueePick, type MarqueeRect } from "../src/input/marquee";
import { isMixed } from "../src/core/mixed";
import { stairDefaults } from "../src/model/stair";
import { stairBox, resolveStair } from "../src/core/stair";
import { furnishingBox } from "../src/core/furnishing";
import { videBox } from "../src/core/vide";
import { Vec, v } from "../src/geometry/vec";
import { resources } from "../src/i18n";
import { isHandleDrag } from "../src/input/tools";
import { resolveFloor } from "../src/core/resolve";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

/** Grows a box by `margin` on every side -- guarantees containment for a
 *  positive margin, or forces exclusion (one corner pokes out) for a
 *  negative one smaller than the box's own half-size. */
function growRect(min: Vec, max: Vec, margin: number): MarqueeRect {
  return { min: v(min.x - margin, min.y - margin), max: v(max.x + margin, max.y + margin) };
}
function boundsOf(pts: readonly Vec[]): { min: Vec; max: Vec } {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { min: v(Math.min(...xs), Math.min(...ys)), max: v(Math.max(...xs), Math.max(...ys)) };
}

// --- MULTI_SELECT_KINDS: node is deliberately excluded ---
{
  check("node is not a multi-select kind", !MULTI_SELECT_KINDS.has("node"));
  const rest: SelKind[] = ["wall", "opening", "symbol", "stair", "vide", "structure", "furnishing", "route"];
  check("every other kind is", rest.every(k => MULTI_SELECT_KINDS.has(k)));
}

// --- isHandleDrag: selectDownHold()'s guard against arming the long-press
// hold on a press that landed on a handle (a selected route's waypoint, a
// selected wall's bow handle) rather than picking the object up fresh. Both
// own kinds ("route", "wall") ARE in MULTI_SELECT_KINDS, so without this
// guard the hold would still arm and fire mid-aim. Pure predicate -- no DOM,
// no fake timers; the timer wiring itself needs a live canvas (see
// tests/mobile.test.ts's note on that boundary). ---
{
  check("routeVertex is a handle drag", isHandleDrag("routeVertex"));
  check("bow is a handle drag", isHandleDrag("bow"));
  check("node is not a handle drag", !isHandleDrag("node"));
  check("wall is not a handle drag", !isHandleDrag("wall"));
  check("symbol is not a handle drag", !isHandleDrag("symbol"));
  check("pan is not a handle drag", !isHandleDrag("pan"));
}

// --- store: undo()/redo()/replace() clear selMore alongside sel -- "sel plus
// selMore is the whole selection" must hold even right after one of these,
// or the compact layout keeps showing a stale "Done (n)" pill with nothing
// selected (see model/store.ts's Selection comment). ---
{
  const mkDoc = () => {
    const doc = emptyDoc();
    const f = doc.floors[0]!;
    const mkWall = (x: number): string => {
      const a = { id: newId("n"), x, y: 0 }, b = { id: newId("n"), x, y: 1000 };
      f.nodes.push(a, b);
      const w: Wall = { id: newId("w"), a: a.id, b: b.id, thickness: 100, bulge: 0, openings: [] };
      f.walls.push(w);
      return w.id;
    };
    return { doc, ids: [mkWall(0), mkWall(1000), mkWall(2000)] };
  };

  // undo()
  {
    const { doc, ids } = mkDoc();
    const st = new Store();
    st.replace(doc);
    st.selectMany("wall", ids);
    st.mutate(d => { st.floorOf(d).walls[0]!.thickness = 250; });
    check("group still selected right before undo", st.selMore.length === 2);
    st.undo();
    check("undo clears sel", st.sel === null);
    check("undo clears selMore too", st.selMore.length === 0, String(st.selMore.length));
  }
  // redo()
  {
    const { doc, ids } = mkDoc();
    const st = new Store();
    st.replace(doc);
    st.selectMany("wall", ids);
    st.mutate(d => { st.floorOf(d).walls[0]!.thickness = 250; });
    st.undo();
    st.selectMany("wall", ids); // reselect, as a visitor would after the undo
    st.redo();
    check("redo clears sel", st.sel === null);
    check("redo clears selMore too", st.selMore.length === 0, String(st.selMore.length));
  }
  // replace()
  {
    const { doc, ids } = mkDoc();
    const st = new Store();
    st.replace(doc);
    st.selectMany("wall", ids);
    check("group selected before replace", st.selMore.length === 2);
    st.replace(emptyDoc(), true);
    check("replace clears sel", st.sel === null);
    check("replace clears selMore too", st.selMore.length === 0, String(st.selMore.length));
  }
}

// --- marqueePick: per-kind containment and dominant-kind resolution ---
{
  const f = emptyDoc().floors[0]!;

  // Two trench convectors (free-standing, 1000x200), well apart.
  f.symbols.push(
    { id: "sym1", type: "convector-pit", x: 0, y: 0, rotation: 0 },
    { id: "sym2", type: "convector-pit", x: 6000, y: 0, rotation: 0 },
  );
  // One cabinet, between the two.
  const cab = {
    id: "cab1", form: "cabinet" as const, kind: "base" as const, x: 3000, y: 2000,
    rotation: 0, width: 600, depth: 600, front: "door" as const,
  };
  f.furnishings = [cab];
  // One stair.
  const stair = { id: "st1", kind: "steektrap" as const, x: 3000, y: 5000, rotation: 0, ...stairDefaults("steektrap") };
  f.stairs = [stair];
  // One vide.
  const vide = { id: "vd1", x: 3000, y: 8000, rotation: 0, width: 1200, depth: 2600 };
  f.vides = [vide];
  // One route, three waypoints.
  f.routes = [{ id: "rt1", discipline: "electrical", points: [{ id: "p0", x: 3000, y: 10500 }, { id: "p1", x: 3200, y: 10500 }, { id: "p2", x: 3200, y: 10700 }] , segments: [{ id: "s0", a: "p0", b: "p1" }, { id: "s1", a: "p1", b: "p2" }]}];
  // Two walls with an opening on the first.
  const n = (x: number, y: number) => { const id = newId("n"); f.nodes.push({ id, x, y }); return id; };
  const wa = n(0, 13000), wb = n(2000, 13000), wc = n(2000, 15000);
  const wall1: Wall = { id: "w1", a: wa, b: wb, thickness: 100, bulge: 0, openings: [{ id: "o1", kind: "door", t: 1000, width: 900, sashes: [] }] };
  const wall2: Wall = { id: "w2", a: wb, b: wc, thickness: 100, bulge: 0, openings: [] };
  f.walls.push(wall1, wall2);

  // -- containment: a rect exactly around one object catches only it --
  {
    const b = boundsOf([v(-500, -100), v(500, 100)]); // sym1's footprint at the origin
    const picked = marqueePick(f, growRect(b.min, b.max, 10));
    check("a rect around one symbol picks only it", picked?.kind === "symbol" && picked.ids.length === 1 && picked.ids[0] === "sym1",
      JSON.stringify(picked));
  }
  {
    const box = furnishingBox(cab);
    const corners = [v(cab.x + box.x0, cab.y + box.y0), v(cab.x + box.x1, cab.y + box.y1)];
    const bb = boundsOf(corners);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a rect around the cabinet picks only it", picked?.kind === "furnishing" && picked.ids.join() === "cab1",
      JSON.stringify(picked));
  }
  {
    const box = stairBox(resolveStair(f, stair));
    const corners = [v(stair.x + box.x0, stair.y + box.y0), v(stair.x + box.x1, stair.y + box.y1)];
    const bb = boundsOf(corners);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a rect around the stair picks only it", picked?.kind === "stair" && picked.ids.join() === "st1",
      JSON.stringify(picked));
  }
  {
    const box = videBox(vide);
    const corners = [v(vide.x + box.x0, vide.y + box.y0), v(vide.x + box.x1, vide.y + box.y1)];
    const bb = boundsOf(corners);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a rect around the vide picks only it", picked?.kind === "vide" && picked.ids.join() === "vd1",
      JSON.stringify(picked));
  }
  {
    const bb = boundsOf([v(3000, 10500), v(3200, 10500), v(3200, 10700)]);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a rect around the route's points picks only it", picked?.kind === "route" && picked.ids.join() === "rt1",
      JSON.stringify(picked));
  }
  {
    // wall2 (no opening on it), so the rect catches only the wall -- wall1
    // would also catch its door's jambs, which is its own containment test
    // just below. Bounds come from the wall's own RESOLVED outline (offset by
    // half-thickness, mitered at the shared node with wall1), not just its
    // two centerline endpoints -- a rect that tight would exclude the outline
    // itself now that marqueePick tests the full footprint (see the bulged-
    // wall test further down).
    const rw2 = resolveFloor(f).walls.get("w2")!;
    const bb = boundsOf(rw2.outline);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a rect around one wall's outline picks only it", picked?.kind === "wall" && picked.ids.join() === "w2",
      JSON.stringify(picked));
  }
  {
    // The door's jambs sit at t=1000, width=900 -> centre 550..1450 along wall1.
    const bb = boundsOf([v(550, 13000), v(1450, 13000)]);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a rect around the opening's jambs picks only it", picked?.kind === "opening" && picked.ids.join() === "o1",
      JSON.stringify(picked));
  }

  // -- exclusion: a footprint poking even slightly out of the rect is not caught --
  {
    const b = boundsOf([v(-500, -100), v(500, 100)]);
    const picked = marqueePick(f, growRect(b.min, b.max, -10)); // shrunk: corners now outside
    check("a rect that clips a corner does not catch it", picked === null, JSON.stringify(picked));
  }

  // -- dominant kind: whichever kind has the most matches, by count --
  {
    // A rect wide enough for both desks and the cabinet, nothing else.
    const rect: MarqueeRect = { min: v(-800, -400), max: v(6800, 2700) };
    const picked = marqueePick(f, rect);
    check("two symbols beat one cabinet", picked?.kind === "symbol" && picked.ids.length === 2,
      JSON.stringify(picked));
  }

  // -- tie-break: equal counts fall back to KIND_PRIORITY (symbol > cabinet
  // > stair > vide > route > opening > wall) --
  {
    // A rect around just the cabinet and the stair: 1 vs 1, cabinet wins.
    const cBox = furnishingBox(cab);
    const sBox = stairBox(resolveStair(f, stair));
    const bb = boundsOf([
      v(cab.x + cBox.x0, cab.y + cBox.y0), v(cab.x + cBox.x1, cab.y + cBox.y1),
      v(stair.x + sBox.x0, stair.y + sBox.y0), v(stair.x + sBox.x1, stair.y + sBox.y1),
    ]);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a 1-1 tie between cabinet and stair favours cabinet",
      picked?.kind === "furnishing" && picked.ids.join() === "cab1", JSON.stringify(picked));
  }
  {
    // A rect around just the stair and the vide: 1 vs 1, stair wins.
    const sBox = stairBox(resolveStair(f, stair));
    const vBox = videBox(vide);
    const bb = boundsOf([
      v(stair.x + sBox.x0, stair.y + sBox.y0), v(stair.x + sBox.x1, stair.y + sBox.y1),
      v(vide.x + vBox.x0, vide.y + vBox.y0), v(vide.x + vBox.x1, vide.y + vBox.y1),
    ]);
    const picked = marqueePick(f, growRect(bb.min, bb.max, 10));
    check("a 1-1 tie between stair and vide favours stair",
      picked?.kind === "stair" && picked.ids.join() === "st1", JSON.stringify(picked));
  }

  // -- nothing caught --
  {
    const picked = marqueePick(f, { min: v(-100, -100), max: v(-50, -50) });
    check("an empty rect catches nothing", picked === null);
  }

  // -- node is never returned, whatever the rect --
  {
    const picked = marqueePick(f, { min: v(-1e6, -1e6), max: v(1e6, 1e6) });
    check("the dominant kind is never node", picked !== null && (picked.kind as string) !== "node", JSON.stringify(picked));
  }
}

// --- marqueePick: a bulged wall's arc must count against "fully inside" --
// resolveFloor() (called two lines up in candidatesByKind) already carries
// each wall's flattened outline; testing only the two centerline endpoints
// let a wall bowing well outside a tightly-drawn rect count as caught. ---
{
  const f = emptyDoc().floors[0]!;
  const a = { id: newId("n"), x: 0, y: 0 };
  const b = { id: newId("n"), x: 4000, y: 0 };
  f.nodes.push(a, b);
  // bulge=1 is a full semicircle: sagitta == radius == chord/2 == 2000mm,
  // bowing toward perp((1,0)) = (0,1) -- +y (down), per the DXF bulge
  // convention (geometry/arc.ts).
  const wall: Wall = { id: newId("w"), a: a.id, b: b.id, thickness: 100, bulge: 1, openings: [] };
  f.walls.push(wall);
  check("resolveFloor's outline actually reaches past the endpoint rect", (() => {
    const rw = [...resolveFloor(f).walls.values()][0]!;
    return rw.outline.some(p => p.y > 200);
  })());

  // Tight around the two centerline endpoints plus a little for half-
  // thickness -- nowhere near the arc's ~2000mm bow.
  const tightRect: MarqueeRect = { min: v(-10, -110), max: v(4010, 110) };
  check("a rect tight around a bulged wall's endpoints does not catch it",
    marqueePick(f, tightRect) === null, JSON.stringify(marqueePick(f, tightRect)));

  // Sanity check: a rect grown to the wall's own resolved outline (bow
  // included) DOES catch it.
  const rw = [...resolveFloor(f).walls.values()][0]!;
  const outlineBounds = boundsOf(rw.outline);
  const picked = marqueePick(f, growRect(outlineBounds.min, outlineBounds.max, 10));
  check("a rect grown to cover the bow catches the wall",
    picked?.kind === "wall" && picked.ids.join() === wall.id, JSON.stringify(picked));
}

// --- bulk mutation writes every member in ONE undo step ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const mkWall = (x: number): string => {
    const a = { id: newId("n"), x, y: 0 }, b = { id: newId("n"), x, y: 1000 };
    f.nodes.push(a, b);
    const w: Wall = { id: newId("w"), a: a.id, b: b.id, thickness: 100, bulge: 0, openings: [] };
    f.walls.push(w);
    return w.id;
  };
  const ids = [mkWall(0), mkWall(1000), mkWall(2000)];
  const st = new Store();
  st.replace(doc);
  st.selectMany("wall", ids);
  check("all three selected", st.selectedOf("wall").length === 3);

  // The pattern every bulk pane commits with (panel.ts's mutAll closures):
  // one store.mutate() touching every selected member.
  const group = st.selectedOf("wall");
  st.mutate(d => {
    for (const w of st.floorOf(d).walls) if (group.includes(w.id)) w.thickness = 250;
  });
  check("every member wrote the new value", st.floor.walls.every(w => w.thickness === 250));
  st.undo();
  check("one undo restores every member",
    st.floor.walls.length === 3 && st.floor.walls.every(w => w.thickness === 100),
    JSON.stringify(st.floor.walls.map(w => w.thickness)));
}

// --- group delete removes all, in one mutation (Tools.deleteSelected's pattern) ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const mkWall = (x: number): string => {
    const a = { id: newId("n"), x, y: 0 }, b = { id: newId("n"), x, y: 1000 };
    f.nodes.push(a, b);
    const w: Wall = { id: newId("w"), a: a.id, b: b.id, thickness: 100, bulge: 0, openings: [] };
    f.walls.push(w);
    return w.id;
  };
  const ids = [mkWall(0), mkWall(1000), mkWall(2000)];
  const st = new Store();
  st.replace(doc);
  st.selectMany("wall", ids);
  const group = st.selectedOf("wall");
  st.mutate(d => {
    const fl = st.floorOf(d);
    for (const id of group) deleteWall(fl, id);
  });
  check("every selected wall is gone", st.floor.walls.length === 0);
  check("their nodes are gone too (deleteWall cleans orphans)", st.floor.nodes.length === 0);
  st.undo();
  check("one undo restores all three walls", st.floor.walls.length === 3);
}

// --- mixed-value detection helper ---
{
  const items = [{ v: 1 }, { v: 1 }, { v: 1 }];
  check("all-equal is not mixed", isMixed(items, x => x.v) === false);
  check("one differing value is mixed", isMixed([...items, { v: 2 }], x => x.v) === true);
  check("a single item is never mixed", isMixed([{ v: 1 }], x => x.v) === false);
  check("an empty list is never mixed", isMixed([] as Array<{ v: number }>, x => x.v) === false);
  check("undefined counts as a value like any other",
    isMixed([{ v: undefined }, { v: undefined }] as Array<{ v: number | undefined }>, x => x.v) === false);
}

// --- long-press mode's core mechanism: restoring the pre-press selection and
// adding the pressed object to it -- this is exactly what Tools.
// fireLongPress() does; the timer/pointer wiring around it needs a live
// canvas (see tests/mobile.test.ts's note on the same boundary) ---
{
  const st = new Store();
  st.replace(emptyDoc());
  const sym = (id: string) => ({ kind: "symbol" as const, id });
  // selectDown() replaced the selection on contact; the hold puts the
  // pre-press selection back and adds the target unless it is already in it.
  const hold = (base: { sel: Selection | null; selMore: string[] }, target: Selection): void => {
    st.sel = base.sel; st.selMore = base.selMore;
    if (!st.isSelected(target.kind, target.id)) st.selectAlso(target);
  };

  // Nothing selected before the hold: firing enters the mode with just the
  // pressed object, same as an ordinary select.
  st.select(null);
  const base1 = { sel: st.sel, selMore: [...st.selMore] };
  st.select(sym("a"));
  hold(base1, st.sel!);
  check("a hold from nothing selected enters the mode with just that object",
    st.sel?.id === "a" && st.selMore.length === 0);

  // Something of the same kind already selected: the hold ADDS the pressed
  // object to it, rather than losing what was there to the replace.
  st.select(sym("x"));
  const base2 = { sel: st.sel, selMore: [...st.selMore] };
  st.select(sym("y"));
  hold(base2, st.sel!);
  check("a hold with an existing selection adds to it instead of replacing it",
    st.sel?.id === "y" && st.selMore.join() === "x", `${st.sel?.id} / ${st.selMore.join()}`);

  // Holding what is already selected keeps it: a tap selects a thing and a
  // hold on the same thing gathers more from it, never opens the mode empty.
  const base3 = { sel: st.sel, selMore: [...st.selMore] };
  st.select(sym("y"));
  hold(base3, st.sel!);
  check("holding a selected member keeps it selected",
    st.sel?.id === "y" && st.selMore.join() === "x", `${st.sel?.id} / ${st.selMore.join()}`);
  st.select(sym("z"));
  const base4 = { sel: st.sel, selMore: [...st.selMore] };
  st.select(sym("z"));
  hold(base4, st.sel!);
  check("holding the one selected object does not empty the selection",
    st.sel?.id === "z" && st.selMore.length === 0);
}

// --- i18n: the bulk pane's count header, the Done label, and the touch hint ---
for (const lang of ["nl", "en"] as const) {
  const panel = resources[lang].translation.panel as Record<string, string | undefined>;
  const hint = resources[lang].translation.hint as Record<string, string | undefined>;
  check(`${lang} has the selection count header`, typeof panel.selectionHeader === "string");
  check(`${lang} selection header interpolates n and label`,
    (panel.selectionHeader ?? "").includes("{{n}}") && (panel.selectionHeader ?? "").includes("{{label}}"));
  check(`${lang} has the Done label`, typeof panel.selectModeDone === "string");
  check(`${lang} Done label interpolates n`, (panel.selectModeDone ?? "").includes("{{n}}"));
  check(`${lang} has a desktop select-mode hint`, typeof hint.selectMode === "string");
  check(`${lang} has a touch select-mode hint`, typeof hint.touchSelectMode === "string");
  // The touch hint must not send a phone visitor looking for a mouse button
  // or a key -- same rule tests/mobile.test.ts enforces for the rest.
  const mouseWords = /\b(klik|click|rechtermuis|right-click|Del\b|Esc\b|Enter\b)/i;
  check(`${lang} touch select hint names no keys or buttons`, !mouseWords.test(hint.touchSelect ?? ""));
  check(`${lang} touch select-mode hint names no keys or buttons`, !mouseWords.test(hint.touchSelectMode ?? ""));
}

console.log(failures === 0 ? "ALL SELECT TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
