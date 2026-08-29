// Editor store: mutable document + snapshot undo/redo (documents are small; a
// command-object migration path exists if they ever aren't) + change notification.
import { PlanDoc, emptyDoc, Floor, Id } from "./doc";

export type SelKind = "wall" | "node" | "opening" | "symbol";
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
  private lastMutateAt = 0;

  get floor(): Floor { return this.doc.floors[0]!; }

  onChange(fn: Listener): void { this.listeners.push(fn); }
  private notify(): void { this.revision++; for (const l of this.listeners) l(); }

  /** Apply a mutation with undo. Same coalesceKey within 900ms merges into one undo step. */
  mutate(fn: (doc: PlanDoc) => void, coalesceKey?: string): void {
    const now = performance.now();
    const coalesce = coalesceKey !== undefined && coalesceKey === this.lastCoalesceKey && now - this.lastMutateAt < 900;
    if (!coalesce) {
      this.undoStack.push(JSON.stringify(this.doc));
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.lastCoalesceKey = coalesceKey ?? null;
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
    this.sel = null;
    this.lastCoalesceKey = null;
    this.notify();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next) as PlanDoc;
    this.sel = null;
    this.notify();
  }
}
