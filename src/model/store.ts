// Editor store: mutable document + snapshot undo/redo (documents are small; a
// command-object migration path exists if they ever aren't) + change notification.
import { PlanDoc, emptyDoc, Floor, Id, newId } from "./doc";

export type SelKind = "wall" | "node" | "opening" | "symbol" | "stair" | "vide" | "cabinet" | "route";
/**
 * One picked object. `sel` plus `selMore` below is the WHOLE selection, and it
 * is always same-kind: a mixed bag of a wall and a cabinet has no field in
 * common to show in the property pane, and every group gesture (drag,
 * alt-copy, delete, bulk edit) means one thing for every member only because
 * they are all the same kind. `node` is deliberately never grouped -- a node
 * is a graph junction, not an object a plan bulk-edits, so the select tool's
 * shift-click and marquee paths both skip it (see input/tools.ts).
 */
export interface Selection { kind: SelKind; id: Id; wallId?: Id } // opening carries wallId

/**
 * The kinds a multi-select gesture (shift-click, touch hold, marquee) may
 * gather into a group. Every SelKind except "node" -- see the comment on
 * Selection above.
 */
export const MULTI_SELECT_KINDS: ReadonlySet<SelKind> =
  new Set(["wall", "opening", "symbol", "stair", "vide", "cabinet", "route"]);

type Listener = () => void;

export class Store {
  doc: PlanDoc = emptyDoc();
  /** The selected object the property pane edits. */
  sel: Selection | null = null;
  /**
   * Selected alongside `sel`, by id, all of the same kind as it. Read through
   * selectedOf() / isSelected(), which answer nothing once `sel` is gone.
   */
  selMore: Id[] = [];
  revision = 0;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];
  private lastCoalesceKey: string | null = null;
  private gestureKey: string | null = null;
  private lastMutateAt = 0;

  /**
   * Undo-snapshot storage for Floor.underlay images.
   *
   * A snapshot is JSON.stringify(doc), taken on every non-coalesced mutate()
   * — several hundred per session — and Floor.underlay.dataUrl is a several-
   * hundred-KB data URL. Embedding it in every snapshot on the 200-entry
   * stack retains up to ~100 MB and re-stringifies the image on every
   * discrete edit, for a single image that rarely changes.
   *
   * Instead, snapshotDoc() below replaces a floor's real dataUrl with a
   * content-keyed token (`underlay:<hash>`, never a valid data: URI prefix)
   * before stringifying, and stores the real dataUrl here under that token.
   * restoreDoc() reverses it on undo/redo. Keying by content hash means
   * repeated snapshots of the SAME image (the common case — most edits don't
   * touch the underlay) collapse onto one stored copy rather than one per
   * snapshot. purgeUnderlayStore() drops entries no stack entry references
   * any more, after every push/pop/clear of either stack.
   *
   * The LIVE document (`this.doc`) always carries the real dataUrl directly;
   * only strings pushed onto undoStack/redoStack are tokenized.
   */
  private underlayStore = new Map<string, string>();

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
          nodes: [], walls: [], symbols: [], stairs: [], vides: [], cabinets: [], routes: [], roomNames: [],
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
      const wallMap = new Map<Id, Id>();
      for (const w of copy.walls) {
        const wallId = newId("w"); wallMap.set(w.id, wallId); w.id = wallId;
        w.a = nodeMap.get(w.a) ?? w.a;
        w.b = nodeMap.get(w.b) ?? w.b;
        for (const o of w.openings) o.id = newId("o");
      }
      // Symbol ids are remapped too, and a route anchored to one has to follow
      // -- the anchor stores the OLD id at this point, and every symbol on the
      // copy is about to be assigned a fresh one.
      const symMap = new Map<Id, Id>();
      for (const sym of copy.symbols) {
        const id = newId("s"); symMap.set(sym.id, id); sym.id = id;
        if (sym.wallId) delete sym.wallId;
      }
      for (const st of copy.stairs ?? []) st.id = newId("t");
      for (const vd of copy.vides ?? []) vd.id = newId("v");
      for (const cb of copy.cabinets ?? []) cb.id = newId("k");
      for (const rt of copy.routes ?? []) {
        rt.id = newId("rt");
        const pointMap = new Map<Id, Id>();
        for (const p of rt.points) {
          const pointId = newId("rp"); pointMap.set(p.id, pointId); p.id = pointId;
          if (p.wallId) {
            const wallId = wallMap.get(p.wallId);
            if (wallId) p.wallId = wallId;
            else { delete p.wallId; delete p.wallT; delete p.wallSide; }
          }
          if (!p.anchor) continue;
          const mapped = symMap.get(p.anchor);
          // A dangling anchor stays dangling rather than pointing at whatever
          // fresh symbol id happens to come next; it falls back to its stored
          // x/y at derive time, same as on the original floor.
          if (mapped) p.anchor = mapped; else delete p.anchor;
        }
        for (const segment of rt.segments) {
          segment.id = newId("rse");
          segment.a = pointMap.get(segment.a) ?? segment.a;
          segment.b = pointMap.get(segment.b) ?? segment.b;
        }
      }
      // Room names do not come up with the walls. A name is authored, and it
      // names the room below: an upper storey duplicated off the ground floor
      // is a keuken and a woonkamer that have to be deleted one by one before
      // the storey can be named at all.
      copy.roomNames = [];
      // Nor does the trace-over image: a scan is a fact about the floor it was
      // made from, not the one being started, and carrying its (potentially
      // large) dataUrl into the copy would double the document for nothing.
      delete copy.underlay;
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

  /** Cheap 32-bit content hash (FNV-1a), hex-encoded — not cryptographic,
   *  just enough to key an undo-snapshot side table (see underlayStore). */
  private static hashToken(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `underlay:${(h >>> 0).toString(16)}`;
  }

  /** JSON.stringify(doc), except every floor's underlay.dataUrl (if any) is
   *  replaced by a token into underlayStore rather than embedded — see the
   *  field comment on underlayStore for why. */
  private snapshotDoc(doc: PlanDoc): string {
    if (!doc.floors.some(f => f.underlay)) return JSON.stringify(doc);
    const floors = doc.floors.map(f => {
      if (!f.underlay) return f;
      const token = Store.hashToken(f.underlay.dataUrl);
      if (!this.underlayStore.has(token)) this.underlayStore.set(token, f.underlay.dataUrl);
      return { ...f, underlay: { ...f.underlay, dataUrl: token } };
    });
    return JSON.stringify({ ...doc, floors });
  }

  /** Reverses snapshotDoc(): re-attaches each floor's real dataUrl from
   *  underlayStore. A token missing from the store (purged, or a corrupt
   *  snapshot) drops that floor's underlay rather than surfacing the raw
   *  token as if it were image data. */
  private restoreDoc(json: string): PlanDoc {
    const doc = JSON.parse(json) as PlanDoc;
    for (const f of doc.floors) {
      if (!f.underlay) continue;
      const real = this.underlayStore.get(f.underlay.dataUrl);
      if (real) f.underlay.dataUrl = real; else delete f.underlay;
    }
    return doc;
  }

  /** Drops any underlayStore entry no longer referenced by either stack.
   *  Call after every push, pop, or clear of undoStack/redoStack. */
  private purgeUnderlayStore(): void {
    if (this.underlayStore.size === 0) return;
    const referenced = new Set<string>();
    const re = /underlay:[0-9a-f]+/g;
    for (const s of this.undoStack) for (const m of s.matchAll(re)) referenced.add(m[0]);
    for (const s of this.redoStack) for (const m of s.matchAll(re)) referenced.add(m[0]);
    for (const token of this.underlayStore.keys()) if (!referenced.has(token)) this.underlayStore.delete(token);
  }

  /** Test-support only: the raw undo/redo snapshot strings, to assert they
   *  never embed image bytes (see underlayStore above). Not read by any
   *  production code path. */
  debugSnapshots(): readonly string[] { return [...this.undoStack, ...this.redoStack]; }

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
      this.undoStack.push(this.snapshotDoc(this.doc));
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack.length = 0;
      this.purgeUnderlayStore();
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
      this.undoStack.push(this.snapshotDoc(this.doc));
      this.redoStack.length = 0;
    } else {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
    }
    this.doc = doc;
    this.clampFloor();
    this.sel = null;
    this.selMore = [];
    this.lastCoalesceKey = null;
    this.purgeUnderlayStore();
    this.notify();
  }

  select(sel: Selection | null): void { this.sel = sel; this.selMore = []; this.notify(); }

  /** Select several at once, the first of them as the one the pane edits. */
  selectMany(kind: SelKind, ids: readonly Id[]): void {
    const [first, ...rest] = ids;
    this.sel = first === undefined ? null : { kind, id: first };
    this.selMore = [...rest];
    this.notify();
  }

  /**
   * Add to the selection, or take out what is already in it — a shift-click.
   *
   * Everything selected is of one kind: a gesture that means "move these" has
   * to mean the same thing for every member, and a mixed selection has no
   * properties to show. Clicking something of another kind therefore starts a
   * new selection rather than joining the two.
   */
  selectAlso(sel: Selection): void {
    if (!this.sel || this.sel.kind !== sel.kind) { this.select(sel); return; }
    if (this.sel.id === sel.id) {
      // The primary steps out and the next one selected takes its place, so
      // shift-clicking twice leaves what was there before.
      const [next, ...rest] = this.selMore;
      this.sel = next === undefined ? null : { kind: sel.kind, id: next };
      this.selMore = rest;
    } else if (this.selMore.includes(sel.id)) {
      this.selMore = this.selMore.filter(id => id !== sel.id);
    } else {
      this.selMore = [this.sel.id, ...this.selMore];
      this.sel = sel;
    }
    this.notify();
  }

  /** Every selected id, when the selection is of this kind. The primary first. */
  selectedOf(kind: SelKind): Id[] {
    return this.sel?.kind === kind ? [this.sel.id, ...this.selMore] : [];
  }

  isSelected(kind: SelKind, id: Id): boolean {
    return this.sel?.kind === kind && (this.sel.id === id || this.selMore.includes(id));
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.snapshotDoc(this.doc));
    this.doc = this.restoreDoc(prev);
    this.clampFloor();
    this.sel = null;
    this.selMore = [];
    this.lastCoalesceKey = null;
    this.purgeUnderlayStore();
    this.notify();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.snapshotDoc(this.doc));
    this.doc = this.restoreDoc(next);
    this.clampFloor();
    this.sel = null;
    this.selMore = [];
    this.purgeUnderlayStore();
    this.notify();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}
