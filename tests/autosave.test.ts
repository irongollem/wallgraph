// The browser-storage autosave (io/json.ts): a door's swing, set the way the
// property pane sets it, has to come back from a reload. Two ways it did not:
// a reload inside the write's 400 ms quiet period dropped the pending edit,
// and a second tab holding an older copy of the plan wrote that copy over the
// newer one on its next change, a bare selection included.
import { scheduleAutosave, flushAutosave, tryLoadAutosave, watchAutosave, clearAutosave } from "../src/io/json";
import { Store } from "../src/model/store";
import { emptyDoc, newId, sashSpecsOf, type PlanDoc, type Sash } from "../src/model/doc";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

// --- a minimal browser: one localStorage, window/document event targets ---
const KEY = "floorplan-doc-v1";
const data = new Map<string, string>();
let writes = 0;
const storage = {
  getItem: (k: string): string | null => data.get(k) ?? null,
  setItem: (k: string, value: string): void => { writes++; data.set(k, String(value)); },
  removeItem: (k: string): void => { data.delete(k); },
};
type Handler = (e: { key?: string | null; newValue?: string | null }) => void;
const windowHandlers = new Map<string, Handler[]>();
const documentHandlers = new Map<string, Handler[]>();
const on = (map: Map<string, Handler[]>) => (type: string, fn: Handler): void => {
  map.set(type, [...(map.get(type) ?? []), fn]);
};
const fire = (map: Map<string, Handler[]>, type: string, e: Parameters<Handler>[0] = {}): void => {
  for (const fn of map.get(type) ?? []) fn(e);
};
const doc = { visibilityState: "visible", addEventListener: on(documentHandlers) };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "window", {
  value: { setTimeout, clearTimeout, addEventListener: on(windowHandlers) }, configurable: true,
});
Object.defineProperty(globalThis, "document", { value: doc, configurable: true });

// One editor per process, wired the way mountWallgraph() wires it.
const store = new Store();
store.onChange(() => scheduleAutosave(store.doc));
watchAutosave(d => store.replace(d, true));

/** A plan with one wall and one door on it, as the door tool places it. */
function planWithDoor(): { plan: PlanDoc; doorId: string } {
  const plan = emptyDoc();
  const f = plan.floors[0]!;
  f.nodes.push({ id: "na", x: 0, y: 0 }, { id: "nb", x: 4000, y: 0 });
  const doorId = newId("o");
  f.walls.push({
    id: "w1", a: "na", b: "nb", thickness: 100, bulge: 0,
    openings: [{ id: doorId, kind: "door", t: 1000, width: 930,
      sashes: [{ action: "turn", hinge: "a", outward: false }] }],
  });
  return { plan, doorId };
}

/** The panel's leaf write-back: copy the sash list, edit it, write it back. */
function flipDoor(s: Store, doorId: string): void {
  s.mutate(d => {
    const o = s.floorOf(d).walls.flatMap(w => w.openings).find(x => x.id === doorId);
    if (!o) return;
    const list = sashSpecsOf(o);
    list[0]!.hinge = "b";
    list[0]!.outward = true;
    o.sashes = list;
  });
}

const leafOf = (d: PlanDoc | null, doorId: string): Sash | undefined =>
  d?.floors[0]?.walls.flatMap(w => w.openings).find(o => o.id === doorId)?.sashes[0];
const flipped = (s: Sash | undefined): boolean => s?.hinge === "b" && s.outward === true;

// --- a reload inside the quiet period still saves the edit ---
{
  clearAutosave();
  const { plan, doorId } = planWithDoor();
  store.replace(plan);
  flushAutosave();
  flipDoor(store, doorId);
  check("the edit waits for the quiet period", !flipped(leafOf(tryLoadAutosave(), doorId)));
  fire(windowHandlers, "pagehide");
  const reloaded = tryLoadAutosave();
  check("pagehide writes the pending edit", flipped(leafOf(reloaded, doorId)),
    JSON.stringify(leafOf(reloaded, doorId)));
}

// --- hiding the page writes it too: a mobile browser may never fire pagehide ---
{
  const { plan, doorId } = planWithDoor();
  store.replace(plan);
  flushAutosave();
  flipDoor(store, doorId);
  doc.visibilityState = "hidden";
  fire(documentHandlers, "visibilitychange");
  doc.visibilityState = "visible";
  check("visibilitychange to hidden writes the pending edit",
    flipped(leafOf(tryLoadAutosave(), doorId)));
}

// --- a second tab's newer plan is adopted before this tab writes again ---
{
  const { plan, doorId } = planWithDoor();
  store.replace(plan);          // this tab: the door as placed
  flushAutosave();
  // The other tab flips the door and saves.
  const newer = JSON.parse(JSON.stringify(plan)) as PlanDoc;
  const leaf = newer.floors[0]!.walls[0]!.openings[0]!.sashes[0]!;
  leaf.hinge = "b"; leaf.outward = true;
  const json = JSON.stringify(newer);
  data.set(KEY, json);
  fire(windowHandlers, "storage", { key: KEY, newValue: json });
  check("the other tab's plan is adopted", flipped(leafOf(store.doc, doorId)));
  // An ordinary click in this tab: a selection change notifies, and so saves.
  store.select({ kind: "wall", id: "w1" });
  flushAutosave();
  check("this tab's next save keeps the other tab's swing", flipped(leafOf(tryLoadAutosave(), doorId)));
  store.undo();
  check("undo reaches this tab's own plan again", !flipped(leafOf(store.doc, doorId)));
}

// --- storage written by something else, and a write that changes nothing ---
{
  const before = store.doc;
  fire(windowHandlers, "storage", { key: "wallgraph-lang", newValue: "en" });
  fire(windowHandlers, "storage", { key: KEY, newValue: "{not json" });
  check("unrelated or unreadable storage events are ignored", store.doc === before);
  flushAutosave();
  const n = writes;
  store.select(null);
  flushAutosave();
  check("a change that leaves the document as saved writes nothing", writes === n);
}

console.log(failures === 0 ? "ALL AUTOSAVE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
