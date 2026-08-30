// Editor store: mutable document + snapshot undo/redo (documents are small; a
// command-object migration path exists if they ever aren't) + change notification.
import { PlanDoc, emptyDoc, Floor, Id, newId } from "./doc";

export type SelKind = "wall" | "node" | "opening" | "symbol" | "stair" | "vide" | "cabinet" | "roomName";
export interface Selection { kind: SelKind; id: Id; wallId?: Id } // opening carries wallId

type Listener = () => void;

export class Store {
  doc: PlanDoc = emptyDoc();
  sel: Selection | null = null;
  revision = 0;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];
  private lastCoalesceKey: string | null = null;
  private gestureKey: string | null = null;
  private lastMutateAt = 0;

  /**
   * Index of the floor being edited. floors[0] is the lowest storey, so the
   * ghost underlay is always the entry below this one.
   *
   * Not part of the document: which storey you happen to be looking at is
   * editor state, not a property of the plan, and putting it in the document
   * would make every floor switch an undo step.
   */
  activeFloor = 0;

  get floor(): Floor { return this.doc.floors[this.activeFloor] ?? this.doc.floors[0]!; }

  /**
   * The active floor inside `doc` — for use in mutate() callbacks, which get the
   * document as an argument and must not reach back through `this.doc`.
   */
  floorOf(doc: PlanDoc): Floor { return doc.floors[this.activeFloor] ?? doc.floors[0]!; }

  /** The storey drawn as a ghost underneath, or null on the lowest floor. */
  get floorBelow(): Floor | null {
    return this.activeFloor > 0 ? this.doc.floors[this.activeFloor - 1] ?? null : null;
  }

  setActiveFloor(i: number): void {
    const next = Math.max(0, Math.min(this.doc.floors.length - 1, i));
    if (next === this.activeFloor) return;
    this.activeFloor = next;
    this.sel = null;          // a selection on another storey means nothing here
    this.notify();
  }

  /** Add an empty storey above the active one and switch to it. */
  addFloor(name: string): void {
    this.mutate(d => {
      d.floors.splice(this.activeFloor + 1, 0,
        {
          id: newId("f"), name,
          nodes: [], walls: [], symbols: [], stairs: [], vides: [], cabinets: [], roomNames: [],
        });
    });
    this.activeFloor = Math.min(this.activeFloor + 1, this.doc.floors.length - 1);
    this.sel = null;
    this.notify();
  }

  /** Copy the active storey above itself — the usual way to start an upper floor. */
  duplicateFloor(name: string): void {
    this.mutate(d => {
      const src = this.floorOf(d);
      const copy = JSON.parse(JSON.stringify(src)) as Floor;
      copy.id = newId("f");
      copy.name = name;
      // Fresh ids throughout: sharing them across storeys would make every
      // lookup ambiguous and let an edit on one floor hit another.
      const nodeMap = new Map<Id, Id>();
      for (const n of copy.nodes) { const id = newId("n"); nodeMap.set(n.id, id); n.id = id; }
      for (const w of copy.walls) {
        w.id = newId("w");
        w.a = nodeMap.get(w.a) ?? w.a;
        w.b = nodeMap.get(w.b) ?? w.b;
        for (const o of w.openings) o.id = newId("o");
      }
      for (const sym of copy.symbols) { sym.id = newId("s"); if (sym.wallId) delete sym.wallId; }
      for (const st of copy.stairs ?? []) st.id = newId("t");
      for (const vd of copy.vides ?? []) vd.id = newId("v");
      for (const cb of copy.cabinets ?? []) cb.id = newId("k");
      for (const rn of copy.roomNames ?? []) rn.id = newId("r");
      d.floors.splice(this.activeFloor + 1, 0, copy);
    });
    this.activeFloor = Math.min(this.activeFloor + 1, this.doc.floors.length - 1);
    this.sel = null;
    this.notify();
  }

  renameFloor(name: string): void {
    this.mutate(d => { this.floorOf(d).name = name; });
  }

  /** Remove the active storey. The last one is never removed. */
  deleteFloor(): void {
    if (this.doc.floors.length <= 1) return;
    const removing = this.activeFloor;
    this.mutate(d => { d.floors.splice(removing, 1); });
    this.activeFloor = Math.max(0, Math.min(removing, this.doc.floors.length - 1));
    this.sel = null;
    this.notify();
  }

  /** Undo/redo/replace can shrink floors[]; never leave the index dangling. */
  private clampFloor(): void {
    this.activeFloor = Math.max(0, Math.min(this.activeFloor, this.doc.floors.length - 1));
  }

  onChange(fn: Listener): void { this.listeners.push(fn); }
  private notify(): void { this.revision++; for (const l of this.listeners) l(); }

  /** Apply a mutation with undo. Same coalesceKey within 900ms merges into one undo step. */
  /**
   * Group a continuous gesture -- a scrubbed number field, a drag -- into ONE
   * undo step. It overrides the per-call key so callers that already exist do
   * not have to thread one through; without it a scrub would push an undo
   * entry per animation frame.
   */
  beginGesture(key: string): void { this.gestureKey = key; }
  endGesture(): void { this.gestureKey = null; this.lastCoalesceKey = null; }

  mutate(fn: (doc: PlanDoc) => void, coalesceKey?: string): void {
    const now = performance.now();
    const key = this.gestureKey ?? coalesceKey;
    const coalesce = key !== undefined && key === this.lastCoalesceKey && now - this.lastMutateAt < 900;
    if (!coalesce) {
      this.undoStack.push(JSON.stringify(this.doc));
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.lastCoalesceKey = key ?? null;
    this.lastMutateAt = now;
    fn(this.doc);
    this.notify();
  }

  /** Swap the whole document. undoable=true keeps the old doc one Ctrl+Z away
   * (used by New/Demo/Open so no blocking confirm dialog is needed — those are
   * unavailable in sandboxed hosting anyway). */
  replace(doc: PlanDoc, undoable = false): void {
    if (undoable) {
      this.undoStack.push(JSON.stringify(this.doc));
      this.redoStack.length = 0;
    } else {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
    }
    this.doc = doc;
    this.clampFloor();
    this.sel = null;
    this.lastCoalesceKey = null;
    this.notify();
  }

  select(sel: Selection | null): void { this.sel = sel; this.notify(); }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev) as PlanDoc;
    this.clampFloor();
    this.sel = null;
    this.lastCoalesceKey = null;
    this.notify();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next) as PlanDoc;
    this.clampFloor();
    this.sel = null;
    this.notify();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}
