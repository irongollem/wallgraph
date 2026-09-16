// Deck/vide corner and edge resize handles (issue #65). resizeRect() is the
// pure math -- everything about which side stays fixed, Shift's aspect lock,
// Alt's centre lock and the minimum-size stop -- and nearestWallFace() is the
// wall-face snap input/tools.ts's drag reads before calling it. Neither
// needs a canvas or a live pointer, so both are exercised directly here, the
// same boundary tests/select.test.ts and tests/mobile.test.ts already draw
// for the rest of the select tool's handles.
import {
  resizeRect, RESIZE_HANDLES, handleLocalPoint, type ResizeHandle, type ResizeOpts,
} from "../src/core/resize";
import { worldPoint, localPoint, type Placed } from "../src/core/placed";
import { nearestWallFace } from "../src/core/deck";
import { DECK_LIMITS } from "../src/model/deck";
import { Vec, v, dist } from "../src/geometry/vec";
import { emptyDoc, newId, type Floor, type Wall } from "../src/model/doc";
import type { Deck } from "../src/model/deck";
import type { Vide } from "../src/model/vide";
import { deckJoistLayout } from "../src/core/trimmer";
import { Store } from "../src/model/store";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

/**
 * The exact pipeline input/tools.ts's dragMove() runs for a "resize" drag,
 * minus the grid/wall snap (covered separately below): a world drag target
 * converted to local, through resizeRect(), and the returned centre OFFSET
 * turned back into world millimetres against the object's ORIGINAL pose.
 */
function drag(placed: Placed, size: { width: number; depth: number }, handle: ResizeHandle, worldTarget: Vec, opts: ResizeOpts):
{ x: number; y: number; rotation: number; width: number; depth: number } {
  const local = localPoint(placed, worldTarget);
  const res = resizeRect(size, handle, local, opts);
  const centre = worldPoint(placed, v(res.dx, res.dy));
  return { x: Math.round(centre.x), y: Math.round(centre.y), rotation: placed.rotation, width: res.width, depth: res.depth };
}

const OPPOSITE: Record<ResizeHandle, ResizeHandle> = {
  nw: "se", ne: "sw", se: "nw", sw: "ne", n: "s", s: "n", e: "w", w: "e",
};

/** worldPoint(placed, handleLocalPoint(...)) in one call -- every test below
 *  checks a handle's WORLD position, never the local one. */
function handleWorld(placed: Placed, size: { width: number; depth: number }, h: ResizeHandle): Vec {
  return worldPoint(placed, handleLocalPoint(h, size.width, size.depth));
}

const opts: ResizeOpts = { min: DECK_LIMITS.size.min, max: DECK_LIMITS.size.max };

// --- corner drag: the opposite corner stays put in WORLD space, unrotated ---
{
  const placed: Placed = { x: 5000, y: 3000, rotation: 0 };
  const size = { width: 2000, depth: 1000 };
  const before = handleWorld(placed, size, "nw");
  // Pull the SE corner 300mm further out in the deck's own frame -- for an
  // unrotated deck that is also 300mm in world x and y.
  const target = worldPoint(placed, v(size.width / 2 + 300, size.depth / 2 + 300));
  const out = drag(placed, size, "se", target, opts);
  const after = handleWorld(out, out, "nw");
  check("unrotated corner drag: width grew by the dragged amount", out.width === size.width + 300, String(out.width));
  check("unrotated corner drag: depth grew by the dragged amount", out.depth === size.depth + 300, String(out.depth));
  check("unrotated corner drag: opposite corner fixed within 1mm", dist(before, after) <= 1, JSON.stringify({ before, after }));
  check("unrotated corner drag: integer mm",
    [out.x, out.y, out.width, out.depth].every(Number.isInteger), JSON.stringify(out));
}

// --- the same drag on a deck rotated 30 degrees ---
{
  const placed: Placed = { x: 5000, y: 3000, rotation: Math.PI / 6 };
  const size = { width: 2000, depth: 1000 };
  const before = handleWorld(placed, size, "nw");
  // Expressed as a LOCAL pull (worldPoint then, in drag(), localPoint back)
  // so the test is exact regardless of the rotation's own trig.
  const target = worldPoint(placed, v(size.width / 2 + 300, size.depth / 2 + 300));
  const out = drag(placed, size, "se", target, opts);
  const after = handleWorld(out, out, "nw");
  check("rotated corner drag: width grew by the dragged amount", out.width === size.width + 300, String(out.width));
  check("rotated corner drag: depth grew by the dragged amount", out.depth === size.depth + 300, String(out.depth));
  check("rotated corner drag: opposite corner fixed within 1mm", dist(before, after) <= 1, JSON.stringify({ before, after }));
  check("rotated corner drag: integer mm",
    [out.x, out.y, out.width, out.depth].every(Number.isInteger), JSON.stringify(out));
}

// --- edge drag changes one dimension only ---
{
  const placed: Placed = { x: 0, y: 0, rotation: 0 };
  const size = { width: 2000, depth: 1000 };
  const target = worldPoint(placed, v(size.width / 2 + 400, 0));
  const out = drag(placed, size, "e", target, opts);
  check("edge drag: the dragged dimension changed", out.width === size.width + 400, String(out.width));
  check("edge drag: the other dimension is untouched", out.depth === size.depth, String(out.depth));
  const before = handleWorld(placed, size, "w");
  const after = handleWorld(out, out, "w");
  check("edge drag: the opposite edge stayed fixed", dist(before, after) <= 1);
}

// --- Shift keeps the aspect ratio of the size at drag start ---
{
  const placed: Placed = { x: 0, y: 0, rotation: 0 };
  const size = { width: 2000, depth: 1000 }; // 2:1
  const target = worldPoint(placed, v(size.width / 2 + 1000, size.depth / 2 + 100));
  const out = drag(placed, size, "se", target, { ...opts, keepAspect: true });
  const ratio0 = size.width / size.depth, ratio1 = out.width / out.depth;
  check("shift: aspect ratio preserved", Math.abs(ratio1 - ratio0) < 0.02, `${ratio0} -> ${ratio1}`);
  check("shift: the box actually grew", out.width > size.width && out.depth > size.depth, JSON.stringify(out));
}

// --- Alt resizes about the centre ---
{
  const placed: Placed = { x: 5000, y: 3000, rotation: 0 };
  const size = { width: 2000, depth: 1000 };
  const target = worldPoint(placed, v(size.width / 2 + 300, 0));
  const out = drag(placed, size, "e", target, { ...opts, aboutCenter: true });
  check("alt: the centre does not move", out.x === placed.x && out.y === placed.y, JSON.stringify(out));
  check("alt: the dragged dimension grew on both sides", out.width === size.width + 600, String(out.width));
}

// --- a drag past the opposite side stops at the minimum size ---
{
  const placed: Placed = { x: 0, y: 0, rotation: 0 };
  const size = { width: 2000, depth: 1000 };
  // Drag the east edge back past the west one entirely.
  const target = worldPoint(placed, v(-size.width * 3, 0));
  const out = drag(placed, size, "e", target, opts);
  check("past the opposite side: clamped to the minimum, not flipped",
    out.width === DECK_LIMITS.size.min, String(out.width));
}

// --- an edge within tolerance of a wall face lands on it ---
{
  const doc = emptyDoc();
  const f: Floor = doc.floors[0]!;
  const a = { id: newId("n"), x: 0, y: 0 }, b = { id: newId("n"), x: 0, y: 5000 };
  f.nodes.push(a, b);
  const wall: Wall = { id: newId("w"), a: a.id, b: b.id, thickness: 100, bulge: 0, openings: [] };
  f.walls.push(wall);
  // The wall runs straight up (+y): perp(dir) is (-1,0), so the LEFT face
  // sits at x=-50 and the right face at x=+50 (half the 100mm thickness).
  const near = v(48, 2500); // 2mm off the right face, inside the 40mm tolerance
  const snap = nearestWallFace(f, near);
  check("a nearby point snaps onto the wall face", snap !== null && Math.abs(snap.p.x - 50) < 1e-6, JSON.stringify(snap));
  check("the snapped point keeps its position along the wall",
    snap !== null && Math.abs(snap.p.y - 2500) < 1e-6, JSON.stringify(snap));
  const far = v(200, 2500); // well outside the 40mm tolerance
  check("a point outside the tolerance does not snap", nearestWallFace(f, far) === null);
}

// --- one drag produces one undo step (Store.mutate with the coalesce key) ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const deck: Deck = {
    id: newId("dk"), x: 0, y: 0, rotation: 0,
    width: 2000, depth: 1000, joistAxis: "y", joistMm: 600,
  };
  f.decks = [deck];
  const st = new Store();
  st.replace(doc);
  const key = "resize" + deck.id;
  st.mutate(d => { d.floors[0]!.decks!.find(x => x.id === deck.id)!.width = 2100; }, key);
  st.mutate(d => { d.floors[0]!.decks!.find(x => x.id === deck.id)!.width = 2300; }, key);
  check("both mutations landed", st.floor.decks!.find(x => x.id === deck.id)!.width === 2300);
  st.undo();
  check("one undo restores the pre-drag width",
    st.floor.decks!.find(x => x.id === deck.id)!.width === 2000,
    String(st.floor.decks!.find(x => x.id === deck.id)!.width));
}

// --- a vide resized inside a deck changes the trim layout ---
{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const deck: Deck = {
    id: newId("dk"), x: 0, y: 0, rotation: 0,
    width: 4200, depth: 3600, joistAxis: "y", joistMm: 600,
    joist: { w: 44, d: 195 }, loadG: 500, loadQ: 1750,
  };
  const vide: Vide = { id: newId("vd"), x: 0, y: 0, rotation: 0, width: 1000, depth: 1000 };
  f.decks = [deck];
  f.vides = [vide];
  const before = deckJoistLayout(f, deck);
  // Widen the vide the way a drag would (through the same clamp a corner
  // drag's resizeRect() output gets): more joists now fall inside its span.
  vide.width = 2400;
  const after = deckJoistLayout(f, deck);
  check("a wider vide cuts more (or as many) joists",
    after.cut.length >= before.cut.length && after.cut.length > 0,
    `${before.cut.length} -> ${after.cut.length}`);
  check("the trim layout actually changed", JSON.stringify(before) !== JSON.stringify(after));
}

// --- every handle's local point agrees with resizeRect()'s own axis rules ---
{
  const size = { width: 4000, depth: 2000 };
  for (const { id, corner } of RESIZE_HANDLES) {
    const p = handleLocalPoint(id, size.width, size.depth);
    check(`${id}: on the box boundary`, Math.abs(Math.abs(p.x) - size.width / 2) < 1e-9 || Math.abs(Math.abs(p.y) - size.depth / 2) < 1e-9);
    if (corner) {
      check(`${id}: a corner sits on both edges`,
        Math.abs(Math.abs(p.x) - size.width / 2) < 1e-9 && Math.abs(Math.abs(p.y) - size.depth / 2) < 1e-9);
    }
  }
  check("every handle has an opposite listed", RESIZE_HANDLES.every(h => OPPOSITE[h.id] !== undefined));
}

{
  // Two drags of the same object in quick succession are two undo steps: a
  // new press closes the previous gesture before its writes coalesce.
  const store = new Store();
  const original = store.doc.floors[0]!.height;
  store.mutate(d => { d.floors[0]!.height = 2700; }, "resize:x");
  store.mutate(d => { d.floors[0]!.height = 2750; }, "resize:x");
  store.endGesture(); // what Tools.onDown does on the next press
  store.mutate(d => { d.floors[0]!.height = 2800; }, "resize:x");
  store.undo();
  check("a second quick drag undoes on its own", store.doc.floors[0]!.height === 2750,
    String(store.doc.floors[0]!.height));
  store.undo();
  check("and the first drag's writes still undo as one step", store.doc.floors[0]!.height === original,
    String(store.doc.floors[0]!.height));
}

console.log(failures === 0 ? "ALL RESIZE TESTS PASSED" : `${failures} RESIZE TEST FAILURES`);
process.exit(failures === 0 ? 0 : 1);
