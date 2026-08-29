// Toolbar, selection-driven property panel, status bar. Plain DOM.
import { Store } from "../model/store";
import { Tools, ToolName } from "../input/tools";
import { clampOpening, wallLength, deleteWall } from "../model/ops";
import { SYMBOLS, CATEGORIES, SymbolDef } from "../render/symbols";
import { sagittaFromBulge, bulgeFromSagitta } from "../geometry/arc";
import { v, norm, sub, add, scale } from "../geometry/vec";
import { exportJson, copyJson, importJsonFile, parseDoc, clearAutosave } from "../io/json";
import { seedDoc } from "../seed";
import { emptyDoc } from "../model/doc";

export class Panel {
  private toolbar: HTMLElement;
  private props: HTMLElement;
  private status: HTMLElement;
  private openCats = new Set<string>(["electrical"]);
  private searchQ = "";

  constructor(root: HTMLElement, private store: Store, private tools: Tools) {
    this.toolbar = el("div", "toolbar");
    this.props = el("div", "props");
    this.status = el("div", "status");
    root.append(this.toolbar, this.props, this.status);
    this.renderToolbar();
    this.renderProps();
    store.onChange(() => { this.renderProps(); this.renderStatus(); });
    this.renderStatus();
  }

  refreshToolbar(): void { this.renderToolbar(); this.renderProps(); this.renderStatus(); }

  private renderToolbar(): void {
    const t = this.toolbar;
    t.innerHTML = "";
    const toolBtn = (label: string, tool: ToolName, key: string, title: string): HTMLButtonElement => {
      const b = el("button", "tool-btn") as HTMLButtonElement;
      b.textContent = label;
      b.title = `${title} (${key})`;
      if (this.tools.tool === tool && tool !== "symbol") b.classList.add("active");
      b.onclick = () => { this.tools.setTool(tool); this.renderToolbar(); };
      return b;
    };
    t.append(
      toolBtn("⬚", "select", "V", "Select / move"),
      toolBtn("╱", "wall", "W", "Draw walls"),
      toolBtn("🚪", "door", "D", "Place door"),
      toolBtn("⊞", "window", "N", "Place window"),
      toolBtn("⌒", "passage", "P", "Open passage"),
      el("hr", "sep"),
    );
    // Symbol palette: search + collapsible category fold-outs with icon buttons.
    const search = el("input", "sym-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = `Search ${SYMBOLS.length} symbols…`;
    search.value = this.searchQ;
    const grids = el("div", "sym-grids");
    search.oninput = () => { this.searchQ = search.value; renderGrids(); };
    t.append(search, grids);

    const iconBtn = (def: SymbolDef): HTMLButtonElement => {
      const b = el("button", "sym-icon") as HTMLButtonElement;
      b.title = def.label;
      if (this.tools.tool === "symbol" && this.tools.symbolType === def.type) b.classList.add("active");
      const cv = el("canvas") as HTMLCanvasElement;
      cv.width = 112; cv.height = 112;
      b.append(cv, Object.assign(el("span"), { textContent: def.label }));
      const ctx = cv.getContext("2d")!;
      ctx.scale(2, 2); // crisp on hidpi
      const pad = 7;
      const sc = (56 - 2 * pad) / Math.max(def.width, def.depth);
      if (def.wallMounted) {
        ctx.strokeStyle = "#c8c3b5";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(4, pad); ctx.lineTo(52, pad); ctx.stroke();
        ctx.translate(28, pad);
      } else {
        ctx.translate(28, 28);
      }
      ctx.scale(sc, sc);
      ctx.strokeStyle = "#4a5568";
      ctx.fillStyle = "#4a5568";
      ctx.lineWidth = 20;
      def.draw(ctx);
      b.onclick = () => { this.tools.setTool("symbol", def.type); this.renderToolbar(); };
      return b;
    };

    const renderGrids = (): void => {
      grids.innerHTML = "";
      const q = this.searchQ.trim().toLowerCase();
      if (q) {
        const grid = el("div", "sym-grid");
        for (const def of SYMBOLS.filter(x => x.label.toLowerCase().includes(q) || x.type.includes(q)))
          grid.append(iconBtn(def));
        grids.append(grid);
        return;
      }
      for (const [cat, label] of CATEGORIES) {
        const defs = SYMBOLS.filter(x => x.category === cat);
        if (defs.length === 0) continue;
        const open = this.openCats.has(cat);
        const head = el("button", "sym-cat-head") as HTMLButtonElement;
        head.innerHTML = `<span class="tri">${open ? "▾" : "▸"}</span> ${label} <span class="count">${defs.length}</span>`;
        head.onclick = () => {
          if (open) this.openCats.delete(cat); else this.openCats.add(cat);
          renderGrids();
        };
        grids.append(head);
        if (open) {
          const grid = el("div", "sym-grid");
          for (const def of defs) grid.append(iconBtn(def));
          grids.append(grid);
        }
      }
    };
    renderGrids();
    t.append(el("hr", "sep"));
    const act = (label: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = el("button", "tool-btn small") as HTMLButtonElement;
      b.textContent = label; b.title = title; b.onclick = fn;
      return b;
    };
    t.append(
      act("↩", "Undo (Ctrl+Z)", () => this.store.undo()),
      act("↪", "Redo (Ctrl+Shift+Z)", () => this.store.redo()),
      el("hr", "sep"),
      act("New", "New empty plan (Ctrl+Z restores the old one)", () => { clearAutosave(); this.store.replace(emptyDoc(), true); this.flash("new plan — Ctrl+Z restores the old one"); }),
      act("Demo", "Load the demo plan (Ctrl+Z restores the old one)", () => { this.store.replace(seedDoc(), true); this.flash("demo loaded — Ctrl+Z restores your plan"); }),
      act("Save", "Save floorplan.json", () => { void exportJson(this.store.doc); }),
      act("Copy", "Copy plan JSON to clipboard", () => { void copyJson(this.store.doc).then(ok => this.flash(ok ? "copied" : "copy failed")); }),
      act("Open", "Open a floorplan.json file", () => importJsonFile(
        doc => { this.store.replace(doc, true); this.flash("plan loaded"); },
        () => this.flash("not a valid floorplan JSON file"),
      )),
      act("Paste", "Load plan from pasted JSON", () => this.pasteDialog()),
    );
  }

  private pasteDialog(): void {
    document.querySelector(".overlay")?.remove();
    const overlay = el("div", "overlay");
    const box = el("div", "dialog");
    box.append(Object.assign(el("div", "props-title"), { textContent: "Paste floorplan JSON" }));
    const ta = el("textarea") as HTMLTextAreaElement;
    ta.placeholder = '{"version":1,"unit":"mm",...}';
    const row = el("div", "dialog-row");
    const load = el("button", "tool-btn small") as HTMLButtonElement;
    load.textContent = "Load";
    load.onclick = () => {
      const doc = parseDoc(ta.value);
      if (!doc) { this.flash("not a valid floorplan JSON"); return; }
      overlay.remove();
      this.store.replace(doc, true);
      this.flash("plan loaded — Ctrl+Z restores the previous one");
    };
    const cancel = el("button", "tool-btn small") as HTMLButtonElement;
    cancel.textContent = "Cancel";
    cancel.onclick = () => overlay.remove();
    row.append(load, cancel);
    box.append(ta, row);
    overlay.append(box);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    document.body.append(overlay);
    ta.focus();
  }

  private flash(msg: string): void {
    this.status.textContent = msg;
    setTimeout(() => this.renderStatus(), 1200);
  }

  private renderStatus(): void {
    this.tools.updateHint();
    this.status.textContent = this.tools.hint;
  }

  private renderProps(): void {
    const p = this.props;
    p.innerHTML = "";
    const sel = this.store.sel;
    const f = this.store.floor;
    const title = (s: string): void => { p.append(Object.assign(el("div", "props-title"), { textContent: s })); };

    const numRow = (label: string, value: number, onCommit: (n: number) => void, step = 10): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const input = el("input") as HTMLInputElement;
      input.type = "number"; input.value = String(Math.round(value)); input.step = String(step);
      input.onchange = () => { const n = parseFloat(input.value); if (isFinite(n)) onCommit(n); };
      row.append(input);
      p.append(row);
    };
    const selRow = (label: string, value: string, options: Array<[string, string]>, onCommit: (s: string) => void): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const s = el("select") as HTMLSelectElement;
      for (const [val, lab] of options) {
        const o = el("option") as HTMLOptionElement;
        o.value = val; o.textContent = lab; if (val === value) o.selected = true;
        s.append(o);
      }
      s.onchange = () => onCommit(s.value);
      row.append(s);
      p.append(row);
    };
    const btnRow = (label: string, fn: () => void): void => {
      const b = el("button", "tool-btn small wide") as HTMLButtonElement;
      b.textContent = label; b.onclick = fn;
      p.append(b);
    };

    if (!sel) {
      title("Plan");
      numRow("Grid (mm)", this.store.doc.gridMm, n => this.store.mutate(d => { d.gridMm = Math.max(1, n); }), 10);
      const orthoRow = el("label", "prop-row");
      orthoRow.append(Object.assign(el("span"), { textContent: "Angle snap (O)" }));
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox"; cb.checked = this.tools.ortho;
      cb.onchange = () => { this.tools.ortho = cb.checked; };
      orthoRow.append(cb);
      p.append(orthoRow);
      const dimsRow = el("label", "prop-row");
      dimsRow.append(Object.assign(el("span"), { textContent: "Measurements (L)" }));
      const dimsCb = el("input") as HTMLInputElement;
      dimsCb.type = "checkbox"; dimsCb.checked = this.tools.showDims;
      dimsCb.onchange = () => { this.tools.showDims = dimsCb.checked; this.store.select(this.store.sel); };
      dimsRow.append(dimsCb);
      p.append(dimsRow);
      numRow("New wall thickness", this.tools.lastThickness, n => { this.tools.lastThickness = Math.max(20, n); }, 10);
      return;
    }

    if (sel.kind === "wall") {
      const w = f.walls.find(x => x.id === sel.id);
      if (!w) return;
      title("Wall");
      const L = wallLength(f, w);
      numRow("Length (mm)", L, n => {
        if (n < 50) return;
        this.store.mutate(d => {
          const fl = d.floors[0]!;
          const wall = fl.walls.find(x => x.id === sel.id);
          if (!wall) return;
          const a = fl.nodes.find(x => x.id === wall.a)!, b = fl.nodes.find(x => x.id === wall.b)!;
          // Move node b along the wall direction (straight-wall semantics; for
          // arcs this scales the chord).
          const dir = norm(sub(v(b.x, b.y), v(a.x, a.y)));
          const nb = add(v(a.x, a.y), scale(dir, w.bulge === 0 ? n : n * (dist2(a, b) / L)));
          b.x = Math.round(nb.x); b.y = Math.round(nb.y);
        });
      });
      numRow("Thickness (mm)", w.thickness, n => {
        this.tools.lastThickness = Math.max(20, n);
        this.store.mutate(d => {
          const wall = d.floors[0]!.walls.find(x => x.id === sel.id);
          if (wall) wall.thickness = Math.max(20, n);
        });
      });
      const a = f.nodes.find(x => x.id === w.a)!, b = f.nodes.find(x => x.id === w.b)!;
      numRow("Curve sagitta (mm)", sagittaFromBulge(v(a.x, a.y), v(b.x, b.y), w.bulge), n => {
        this.store.mutate(d => {
          const fl = d.floors[0]!;
          const wall = fl.walls.find(x => x.id === sel.id);
          if (!wall) return;
          const aa = fl.nodes.find(x => x.id === wall.a)!, bb = fl.nodes.find(x => x.id === wall.b)!;
          wall.bulge = bulgeFromSagitta(v(aa.x, aa.y), v(bb.x, bb.y), n);
        });
      }, 50);
      btnRow("Delete wall (Del)", () => { this.store.mutate(d => deleteWall(d.floors[0]!, sel.id)); this.store.select(null); });
      return;
    }

    if (sel.kind === "opening") {
      let wall = sel.wallId ? f.walls.find(x => x.id === sel.wallId) : undefined;
      if (!wall) wall = f.walls.find(x => x.openings.some(o => o.id === sel.id));
      const o = wall?.openings.find(x => x.id === sel.id);
      if (!wall || !o) return;
      const wid = wall.id;
      const mutOpening = (fn: (o2: NonNullable<typeof o>, fl2: typeof f, w2: NonNullable<typeof wall>) => void): void => {
        this.store.mutate(d => {
          const fl = d.floors[0]!;
          const w2 = fl.walls.find(x => x.id === wid);
          const o2 = w2?.openings.find(x => x.id === sel.id);
          if (w2 && o2) { fn(o2, fl, w2); clampOpening(fl, w2, o2); }
        });
      };
      title(o.kind === "door" ? "Door" : o.kind === "window" ? "Window" : "Passage");
      numRow("Width (mm)", o.width, n => mutOpening(o2 => { o2.width = n; }));
      numRow("From corner (mm)", o.t - o.width / 2, n => mutOpening(o2 => { o2.t = n + o2.width / 2; }));
      if (o.kind === "door") {
        selRow("Hinge", o.hinge ?? "a", [["a", "start side"], ["b", "end side"]], s2 => mutOpening(o2 => { o2.hinge = s2 as "a" | "b"; }));
        selRow("Swing", (o.swingIn ?? true) ? "in" : "out", [["in", "inward"], ["out", "outward"]], s2 => mutOpening(o2 => { o2.swingIn = s2 === "in"; }));
      }
      if (o.kind === "window") {
        selRow("Type", o.windowType ?? "fixed", [["fixed", "fixed"], ["casement", "casement"], ["sliding", "sliding"]],
          s2 => mutOpening(o2 => { o2.windowType = s2 as "fixed" | "casement" | "sliding"; }));
        if ((o.windowType ?? "fixed") === "sliding")
          selRow("Slides toward", o.slideTo ?? "b", [["a", "start side"], ["b", "end side"]], s2 => mutOpening(o2 => { o2.slideTo = s2 as "a" | "b"; }));
      }
      btnRow("Delete (Del)", () => this.tools.deleteSelected());
      return;
    }

    if (sel.kind === "symbol") {
      const s = f.symbols.find(x => x.id === sel.id);
      if (!s) return;
      title("Symbol: " + s.type);
      numRow("Rotation (°)", (s.rotation * 180) / Math.PI, n => this.store.mutate(d => {
        const s2 = d.floors[0]!.symbols.find(x => x.id === sel.id);
        if (s2) s2.rotation = (n * Math.PI) / 180;
      }), 15);
      btnRow("Mirror (M)", () => this.store.mutate(d => {
        const s2 = d.floors[0]!.symbols.find(x => x.id === sel.id);
        if (s2) s2.mirrored = !s2.mirrored;
      }));
      btnRow("Delete (Del)", () => this.tools.deleteSelected());
      return;
    }

    if (sel.kind === "node") {
      const n = f.nodes.find(x => x.id === sel.id);
      if (!n) return;
      title("Corner");
      numRow("X (mm)", n.x, val => this.store.mutate(d => {
        const n2 = d.floors[0]!.nodes.find(x => x.id === sel.id);
        if (n2) n2.x = Math.round(val);
      }));
      numRow("Y (mm)", n.y, val => this.store.mutate(d => {
        const n2 = d.floors[0]!.nodes.find(x => x.id === sel.id);
        if (n2) n2.y = Math.round(val);
      }));
      btnRow("Delete with walls (Del)", () => this.tools.deleteSelected());
    }
  }
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
