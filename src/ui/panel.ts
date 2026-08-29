// Toolbar, selection-driven property panel, status bar. Plain DOM.
import { Store } from "../model/store";
import { Tools, ToolName } from "../input/tools";
import { clampOpening, wallLength, deleteWall } from "../model/ops";
import { SYMBOLS, CATEGORIES, SymbolDef } from "../render/symbols";
import { sagittaFromBulge, bulgeFromSagitta } from "../geometry/arc";
import { v, norm, sub, add, scale } from "../geometry/vec";
import { exportJson, copyJson, importJsonFile, parseDoc, clearAutosave } from "../io/json";
import { exportPng } from "../io/image";
import { seedDoc } from "../seed";
import { emptyDoc } from "../model/doc";
import { t, language, changeLanguage, allTranslations, LANGUAGES, on as onI18n, type Lang } from "../i18n";

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
    onI18n("languageChanged", () => this.refreshToolbar());
  }

  refreshToolbar(): void { this.renderToolbar(); this.renderProps(); this.renderStatus(); }

  private renderToolbar(): void {
    const bar = this.toolbar;
    bar.innerHTML = "";
    const toolBtn = (label: string, tool: ToolName, key: string, title: string): HTMLButtonElement => {
      const b = el("button", "tool-btn") as HTMLButtonElement;
      b.textContent = label;
      b.title = `${title} (${key})`;
      if (this.tools.tool === tool && tool !== "symbol") b.classList.add("active");
      b.onclick = () => { this.tools.setTool(tool); this.renderToolbar(); };
      return b;
    };
    bar.append(
      toolBtn("⬚", "select", "V", t("tool.select")),
      toolBtn("╱", "wall", "W", t("tool.wall")),
      toolBtn("🚪", "door", "D", t("tool.door")),
      toolBtn("⊞", "window", "N", t("tool.window")),
      toolBtn("⌒", "passage", "P", t("tool.passage")),
      el("hr", "sep"),
    );
    // Symbol palette: search + collapsible category fold-outs with icon buttons.
    const search = el("input", "sym-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = t("symbolSearch", { count: SYMBOLS.length });
    search.value = this.searchQ;
    const grids = el("div", "sym-grids");
    search.oninput = () => { this.searchQ = search.value; renderGrids(); };
    bar.append(search, grids);

    const iconBtn = (def: SymbolDef): HTMLButtonElement => {
      const b = el("button", "sym-icon") as HTMLButtonElement;
      b.title = t("symbol." + def.type);
      if (this.tools.tool === "symbol" && this.tools.symbolType === def.type) b.classList.add("active");
      const cv = el("canvas") as HTMLCanvasElement;
      cv.width = 112; cv.height = 112;
      b.append(cv, Object.assign(el("span"), { textContent: t("symbol." + def.type) }));
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
        for (const def of SYMBOLS.filter(x => matches(x, q)))
          grid.append(iconBtn(def));
        grids.append(grid);
        return;
      }
      for (const [cat] of CATEGORIES) {
        const defs = SYMBOLS.filter(x => x.category === cat);
        if (defs.length === 0) continue;
        const open = this.openCats.has(cat);
        const head = el("button", "sym-cat-head") as HTMLButtonElement;
        head.innerHTML = `<span class="tri">${open ? "▾" : "▸"}</span> ${t("category." + cat, {})} <span class="count">${defs.length}</span>`;
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
    bar.append(el("hr", "sep"));
    const act = (label: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = el("button", "tool-btn small") as HTMLButtonElement;
      b.textContent = label; b.title = title; b.onclick = fn;
      return b;
    };
    bar.append(
      act("↩", t("action.undo"), () => this.store.undo()),
      act("↪", t("action.redo"), () => this.store.redo()),
      el("hr", "sep"),
      act(t("action.new"), t("action.newTitle"), () => { clearAutosave(); this.store.replace(emptyDoc(), true); this.flash(t("status.newPlan")); }),
      act(t("action.demo"), t("action.demoTitle"), () => { this.store.replace(seedDoc(), true); this.flash(t("status.demoLoaded")); }),
      act(t("action.save"), t("action.saveTitle"), () => { void exportJson(this.store.doc); }),
      act(t("action.copy"), t("action.copyTitle"), () => { void copyJson(this.store.doc).then(ok => this.flash(ok ? t("status.copied") : t("status.copyFailed"))); }),
      act(t("action.png"), t("action.pngTitle"), () => { void this.savePng(); }),
      act(t("action.open"), t("action.openTitle"), () => importJsonFile(
        doc => { this.store.replace(doc, true); this.flash(t("status.planLoaded")); },
        () => this.flash(t("status.invalidFile")),
      )),
      act(t("action.paste"), t("action.pasteTitle"), () => this.pasteDialog()),
    );
  }

  /** Keys spelled out rather than built from the result, so they stay greppable. */
  private async savePng(): Promise<void> {
    const result = await exportPng(this.store.doc);
    this.flash(t(result === "saved" ? "status.pngSaved"
      : result === "copied" ? "status.pngCopied"
      : result === "empty" ? "status.pngEmpty"
      : "status.pngFailed"));
  }

  private pasteDialog(): void {
    document.querySelector(".overlay")?.remove();
    const overlay = el("div", "overlay");
    const box = el("div", "dialog");
    box.append(Object.assign(el("div", "props-title"), { textContent: t("panel.pasteJson") }));
    const ta = el("textarea") as HTMLTextAreaElement;
    ta.placeholder = '{"version":1,"unit":"mm",...}';
    const row = el("div", "dialog-row");
    const load = el("button", "tool-btn small") as HTMLButtonElement;
    load.textContent = t("action.load");
    load.onclick = () => {
      const doc = parseDoc(ta.value);
      if (!doc) { this.flash(t("status.invalidJson")); return; }
      overlay.remove();
      this.store.replace(doc, true);
      this.flash(t("status.planLoadedUndo"));
    };
    const cancel = el("button", "tool-btn small") as HTMLButtonElement;
    cancel.textContent = t("action.cancel");
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
    const checkRow = (label: string, value: boolean, onCommit: (b: boolean) => void): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox"; cb.checked = value;
      cb.onchange = () => onCommit(cb.checked);
      row.append(cb);
      p.append(row);
    };
    const btnRow = (label: string, fn: () => void): void => {
      const b = el("button", "tool-btn small wide") as HTMLButtonElement;
      b.textContent = label; b.onclick = fn;
      p.append(b);
    };

    if (!sel) {
      title(t("panel.plan"));
      numRow(t("panel.grid"), this.store.doc.gridMm, n => this.store.mutate(d => { d.gridMm = Math.max(1, n); }), 10);
      checkRow(t("tool.gridSnap"), this.tools.snapGrid, b => { this.tools.snapGrid = b; this.store.select(this.store.sel); });
      checkRow(t("tool.angleSnap"), this.tools.ortho, b => { this.tools.ortho = b; });
      checkRow(t("tool.measurements"), this.tools.showDims, b => { this.tools.showDims = b; this.store.select(this.store.sel); });
      numRow(t("panel.newWallThickness"), this.tools.lastThickness, n => { this.tools.lastThickness = Math.max(20, n); }, 10);
      selRow(t("panel.language"), language(),
        LANGUAGES.map(l => [l.code, l.label] as [string, string]),
        code => changeLanguage(code as Lang));
      return;
    }

    if (sel.kind === "wall") {
      const w = f.walls.find(x => x.id === sel.id);
      if (!w) return;
      title(t("panel.wall"));
      const L = wallLength(f, w);
      numRow(t("panel.length"), L, n => {
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
      numRow(t("panel.thickness"), w.thickness, n => {
        this.tools.lastThickness = Math.max(20, n);
        this.store.mutate(d => {
          const wall = d.floors[0]!.walls.find(x => x.id === sel.id);
          if (wall) wall.thickness = Math.max(20, n);
        });
      });
      const a = f.nodes.find(x => x.id === w.a)!, b = f.nodes.find(x => x.id === w.b)!;
      numRow(t("panel.sagitta"), sagittaFromBulge(v(a.x, a.y), v(b.x, b.y), w.bulge), n => {
        this.store.mutate(d => {
          const fl = d.floors[0]!;
          const wall = fl.walls.find(x => x.id === sel.id);
          if (!wall) return;
          const aa = fl.nodes.find(x => x.id === wall.a)!, bb = fl.nodes.find(x => x.id === wall.b)!;
          wall.bulge = bulgeFromSagitta(v(aa.x, aa.y), v(bb.x, bb.y), n);
        });
      }, 50);
      btnRow(t("panel.deleteWall"), () => { this.store.mutate(d => deleteWall(d.floors[0]!, sel.id)); this.store.select(null); });
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
      title(o.kind === "door" ? t("panel.door") : o.kind === "window" ? t("panel.window") : t("panel.passage"));
      numRow(t("panel.width"), o.width, n => mutOpening(o2 => { o2.width = n; }));
      numRow(t("panel.fromCorner"), o.t - o.width / 2, n => mutOpening(o2 => { o2.t = n + o2.width / 2; }));
      if (o.kind === "door") {
        selRow(t("panel.hinge"), o.hinge ?? "a", [["a", t("panel.hingeA")], ["b", t("panel.hingeB")]], s2 => mutOpening(o2 => { o2.hinge = s2 as "a" | "b"; }));
        selRow(t("panel.swing"), (o.swingIn ?? true) ? "in" : "out", [["in", t("panel.swingIn")], ["out", t("panel.swingOut")]], s2 => mutOpening(o2 => { o2.swingIn = s2 === "in"; }));
      }
      if (o.kind === "window") {
        selRow(t("panel.type"), o.windowType ?? "fixed", [["fixed", t("panel.typeFixed")], ["casement", t("panel.typeCasement")], ["sliding", t("panel.typeSliding")]],
          s2 => mutOpening(o2 => { o2.windowType = s2 as "fixed" | "casement" | "sliding"; }));
        if ((o.windowType ?? "fixed") === "sliding")
          selRow(t("panel.slidesToward"), o.slideTo ?? "b", [["a", t("panel.hingeA")], ["b", t("panel.hingeB")]], s2 => mutOpening(o2 => { o2.slideTo = s2 as "a" | "b"; }));
      }
      btnRow(t("panel.deleteOpening"), () => this.tools.deleteSelected());
      return;
    }

    if (sel.kind === "symbol") {
      const s = f.symbols.find(x => x.id === sel.id);
      if (!s) return;
      title(t("panel.symbol", { type: t("symbol." + s.type) }));
      numRow(t("panel.rotation"), (s.rotation * 180) / Math.PI, n => this.store.mutate(d => {
        const s2 = d.floors[0]!.symbols.find(x => x.id === sel.id);
        if (s2) s2.rotation = (n * Math.PI) / 180;
      }), 15);
      btnRow(t("panel.mirror"), () => this.store.mutate(d => {
        const s2 = d.floors[0]!.symbols.find(x => x.id === sel.id);
        if (s2) s2.mirrored = !s2.mirrored;
      }));
      btnRow(t("panel.deleteOpening"), () => this.tools.deleteSelected());
      return;
    }

    if (sel.kind === "node") {
      const n = f.nodes.find(x => x.id === sel.id);
      if (!n) return;
      title(t("panel.corner"));
      numRow(t("panel.x"), n.x, val => this.store.mutate(d => {
        const n2 = d.floors[0]!.nodes.find(x => x.id === sel.id);
        if (n2) n2.x = Math.round(val);
      }));
      numRow(t("panel.y"), n.y, val => this.store.mutate(d => {
        const n2 = d.floors[0]!.nodes.find(x => x.id === sel.id);
        if (n2) n2.y = Math.round(val);
      }));
      btnRow(t("panel.deleteWithWalls"), () => this.tools.deleteSelected());
    }
  }
}

/** True when the query matches the symbol's name in ANY language, or its id. */
function matches(def: SymbolDef, q: string): boolean {
  return allTranslations("symbol." + def.type).some(n => n.toLowerCase().includes(q))
      || def.label.toLowerCase().includes(q)
      || def.type.includes(q);
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
