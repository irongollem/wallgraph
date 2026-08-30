// Rail, storey/palette/property pane, and status bar. Plain DOM.
import { Store } from "../model/store";
import { Tools, ToolName } from "../input/tools";
import { clampOpening, wallLength, deleteWall } from "../model/ops";
import type { SymbolDef } from "../render/symbols";
import { sagittaFromBulge, bulgeFromSagitta } from "../geometry/arc";
import { v, norm, sub, add, scale } from "../geometry/vec";
import { exportJson, copyJson, importJsonFile, parseDoc, clearAutosave } from "../io/json";
import { exportPng } from "../io/image";
import { exportDxf } from "../io/dxf";
import { exportSvg } from "../io/svg";
import { seedDoc } from "../seed";
import { emptyDoc, areaModeOf, floorHeight, sashesOf, sashSpecsOf, windowKindOf, WINDOW_KINDS, doorKindOf, DOOR_KINDS, type AreaMode, type Sash, type HingeEdge, type Opening, type Wall } from "../model/doc";
import { t, language, changeLanguage, allTranslations, LANGUAGES, on as onI18n, type Lang } from "../i18n";
import { COLORS, INKS } from "../render/draw";
import { icon, type IconName } from "./icons";
import { docHref, DOC_IDS } from "../links";
import { openMenu, type MenuEntry } from "./menu";
import { Palette } from "./palette";
import { renderStairTool, renderStairProps, type StairRows } from "./stairs";
import { scrubbable } from "./scrub";

export class Panel {
  private rail: HTMLElement;
  private pane: HTMLElement;
  private status: HTMLElement;
  private foot: HTMLElement;
  private palette: Palette;
  /** Persistent pane children. The palette is never detached: removing it even
   *  for one frame drops focus out of its search box. */
  private paneScroll: HTMLElement;
  private paneBody: HTMLElement;
  private props: HTMLElement;
  private storeyEl: HTMLElement;
  private planEl: HTMLElement;
  /** Everything the pane's structure depends on; a change rebuilds it. */
  private lastPaneSig = "";
  /** Selection alone — drives the fade, so a grid tweak does not flash. */
  private lastSelSig = "";
  private planOpen = false;
  /** True mid drag-scrub: the pane must not rebuild and yank the input out
   *  from under the pointer. main.ts redraws the canvas independently, so
   *  the drawing still tracks the drag. */
  private scrubbing = false;

  constructor(root: HTMLElement, private store: Store, private tools: Tools) {
    const head = el("div", "side-head");
    const h1 = Object.assign(el("h1"), { textContent: t("app.title") });
    const docBtn = el("button", "rail-btn") as HTMLButtonElement;
    docBtn.type = "button";
    docBtn.title = t("action.documentTitle");
    docBtn.setAttribute("aria-label", t("action.document"));
    docBtn.append(icon("dots"));
    docBtn.onclick = () => openMenu(docBtn, this.documentMenuEntries());
    head.append(h1, docBtn);

    this.rail = el("div", "rail");
    this.pane = el("div", "pane");
    const sideBody = el("div", "side-body");
    sideBody.append(this.rail, this.pane);

    this.status = el("div", "status");
    this.foot = el("div", "side-foot");

    root.append(head, sideBody, this.status, this.foot);

    this.palette = new Palette(tools, () => this.refreshToolbar());

    // Fixed pane structure: storey, properties (hidden when nothing is
    // selected), the always-present palette, and the pinned Plan section.
    this.storeyEl = this.buildStoreyRow();
    this.paneBody = el("div", "pane-body");
    this.props = el("div", "props");
    this.paneBody.append(this.props);
    this.paneBody.hidden = true;
    // Selection properties and the symbol palette share ONE scroller: they read
    // as a single list, so neither gets an inner scrollbar of its own.
    this.paneScroll = el("div", "pane-scroll");
    this.paneScroll.append(this.paneBody, this.palette.el);
    this.planEl = this.buildPlanSection();
    this.pane.append(this.storeyEl, this.paneScroll, this.planEl);

    this.renderFoot();
    this.refreshToolbar();
    store.onChange(() => this.refreshToolbar());
    onI18n("languageChanged", () => { this.palette.refresh(); this.renderFoot(); this.refreshToolbar(); });
  }

  /** Persistent disclaimer link. Rebuilt only when the language changes. */
  private renderFoot(): void {
    const warn = el("a", "side-foot-warn") as HTMLAnchorElement;
    warn.href = docHref("disclaimer", language());
    warn.textContent = t("foot.disclaimer");
    warn.title = t("foot.disclaimerTitle");
    warn.target = "_blank";
    warn.rel = "noopener";
    this.foot.replaceChildren(warn);
  }

  refreshToolbar(): void {
    if (this.scrubbing) { this.renderStatus(); return; }
    this.renderRail();
    this.renderPane();
    this.renderStatus();
  }

  private renderRail(): void {
    const rail = this.rail;
    rail.replaceChildren();

    const toolBtn = (name: IconName, tool: ToolName, key: string, label: string): HTMLButtonElement => {
      const b = el("button", "rail-btn") as HTMLButtonElement;
      b.type = "button";
      const active = this.tools.tool === tool;
      b.title = `${label} (${key})`;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", String(active));
      if (active) b.classList.add("is-active");
      b.append(icon(name));
      return b;
    };

    const select = toolBtn("select", "select", "V", t("tool.select"));
    select.onclick = () => this.tools.setTool("select");
    const wall = toolBtn("wall", "wall", "W", t("tool.wall"));
    wall.onclick = () => this.tools.setTool("wall");
    const door = toolBtn("door", "door", "D", t("tool.door"));
    door.onclick = () => this.tools.setTool("door");
    const win = toolBtn("window", "window", "N", t("tool.window"));
    win.onclick = () => this.tools.setTool("window");
    const passage = toolBtn("passage", "passage", "P", t("tool.passage"));
    passage.onclick = () => this.tools.setTool("passage");
    const stair = toolBtn("stair", "stair", "T", t("tool.stair"));
    stair.onclick = () => this.tools.setTool("stair");
    rail.append(select, wall, door, win, passage, stair, el("hr", "rail-sep"));

    const modeBtn = (name: IconName, modeKey: string, on: boolean, label: string, key: string): HTMLButtonElement => {
      const b = el("button", "rail-btn is-mode") as HTMLButtonElement;
      b.type = "button";
      b.dataset.mode = modeKey;
      b.title = `${label} (${key})`;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", String(on));
      if (on) b.classList.add("is-on");
      b.append(icon(name));
      return b;
    };

    const grid = modeBtn("gridSnap", "grid", this.tools.snapGrid, t("tool.gridSnap"), "G");
    grid.onclick = () => this.toggleMode("grid", () => { this.tools.snapGrid = !this.tools.snapGrid; }, true);
    const angle = modeBtn("angleSnap", "angle", this.tools.ortho, t("tool.angleSnap"), "O");
    angle.onclick = () => this.toggleMode("angle", () => { this.tools.ortho = !this.tools.ortho; }, false);
    const dims = modeBtn("dimensions", "dims", this.tools.showDims, t("tool.measurements"), "L");
    dims.onclick = () => this.toggleMode("dims", () => { this.tools.showDims = !this.tools.showDims; }, true);

    rail.append(grid, angle, dims, el("div", "rail-spacer"));

    const undo = el("button", "rail-btn") as HTMLButtonElement;
    undo.type = "button";
    undo.title = t("action.undo");
    undo.setAttribute("aria-label", t("action.undo"));
    undo.disabled = !this.store.canUndo;
    undo.append(icon("undo"));
    undo.onclick = () => this.store.undo();

    const redo = el("button", "rail-btn") as HTMLButtonElement;
    redo.type = "button";
    redo.title = t("action.redo");
    redo.setAttribute("aria-label", t("action.redo"));
    redo.disabled = !this.store.canRedo;
    redo.append(icon("redo"));
    redo.onclick = () => this.store.redo();

    rail.append(undo, redo);
  }

  /**
   * Flips a rail mode toggle, refreshes, then pulses the freshly-rebuilt
   * button once — a plain class add would be thrown away, since renderRail()
   * (triggered synchronously below) replaces every rail button with a new node.
   */
  private toggleMode(modeKey: string, toggle: () => void, redraw: boolean): void {
    toggle();
    // Grid snap and measurements change what's drawn on the canvas immediately
    // (dimension labels, grid-aligned previews); angle snap only affects the
    // next placement. Mirrors the old checkbox rows' behaviour.
    if (redraw) this.store.select(this.store.sel);
    this.refreshToolbar();
    const fresh = this.rail.querySelector<HTMLButtonElement>(`[data-mode="${modeKey}"]`);
    if (!fresh) return;
    fresh.classList.add("is-pulse");
    fresh.addEventListener("animationend", () => fresh.classList.remove("is-pulse"), { once: true });
  }

  private documentMenuEntries(): MenuEntry[] {
    return [
      { kind: "item", icon: "docNew", label: t("action.new"), onPick: () => {
        clearAutosave(); this.store.replace(emptyDoc(), true); this.flash(t("status.newPlan"));
      } },
      { kind: "item", icon: "docDemo", label: t("action.demo"), onPick: () => {
        this.store.replace(seedDoc(), true); this.flash(t("status.demoLoaded"));
      } },
      { kind: "item", icon: "docOpen", label: t("action.open"), onPick: () => importJsonFile(
        doc => { this.store.replace(doc, true); this.flash(t("status.planLoaded")); },
        () => this.flash(t("status.invalidFile")),
      ) },
      { kind: "sep" },
      { kind: "item", icon: "docSave", label: t("action.save"), hint: "JSON", onPick: () => { void exportJson(this.store.doc); } },
      { kind: "item", icon: "docPng", label: t("action.png"), hint: "PNG", onPick: () => { void this.savePng(); } },
      { kind: "item", icon: "docSvg", label: t("action.svg"), hint: "SVG", onPick: () => { void this.saveSvg(); } },
      { kind: "item", icon: "docDxf", label: t("action.dxf"), hint: "DXF", onPick: () => { void this.saveDxf(); } },
      { kind: "item", icon: "docCopy", label: t("action.copy"), onPick: () => {
        void copyJson(this.store.doc).then(ok => this.flash(ok ? t("status.copied") : t("status.copyFailed")));
      } },
      { kind: "item", icon: "docPaste", label: t("action.paste"), onPick: () => this.pasteDialog() },
      { kind: "sep" },
      // Documentation links use the compact disclaimer label in the menu.
      { kind: "links", items: DOC_IDS.map(id => ({
        label: t("foot." + (id === "disclaimer" ? "disclaimerShort" : id)),
        href: docHref(id, language()),
      })) },
      { kind: "sep" },
      { kind: "select", label: t("panel.language"), value: language(),
        options: LANGUAGES.map(l => [l.code, l.label] as [string, string]),
        onPick: value => changeLanguage(value as Lang) },
    ];
  }

  /** Keys spelled out rather than built from the result, so they stay greppable. */
  private async savePng(): Promise<void> {
    const result = await exportPng(this.store.doc, this.store.activeFloor);
    this.flash(t(result === "saved" ? "status.pngSaved"
      : result === "copied" ? "status.pngCopied"
      : result === "empty" ? "status.pngEmpty"
      : "status.pngFailed"));
  }

  /** Vector artwork. Same shape as savePng: one flash, keys spelled out. */
  private async saveSvg(): Promise<void> {
    const result = await exportSvg(this.store.doc, this.store.activeFloor);
    this.flash(t(result === "saved" ? "status.svgSaved"
      : result === "empty" ? "status.svgEmpty"
      : "status.svgFailed"));
  }

  /** CAD export. Same shape as savePng: one flash, keys spelled out. */
  private async saveDxf(): Promise<void> {
    const result = await exportDxf(this.store.doc, this.store.activeFloor);
    this.flash(t(result === "saved" ? "status.dxfSaved"
      : result === "empty" ? "status.dxfEmpty"
      : "status.dxfFailed"));
  }

  /**
   * Storey picker. Floors are listed top-down (highest first) because that is
   * how a stack of storeys reads on paper, while the document stores
   * floors[0] as the lowest. Adding a floor lives here too; rename/duplicate/
   * delete stay in the property pane's Plan section (renderFloors below).
   */
  private buildStoreyRow(): HTMLElement {
    const floors = this.store.doc.floors;
    const row = el("div", "storey");
    row.append(icon("floors", 16));
    const select = el("select", "storey-select") as HTMLSelectElement;
    select.setAttribute("aria-label", t("panel.storey"));
    for (const [i, fl] of floors.map((fl, i) => [i, fl] as const).reverse()) {
      const o = el("option") as HTMLOptionElement;
      o.value = String(i);
      o.textContent = fl.name;
      if (i === this.store.activeFloor) o.selected = true;
      select.append(o);
    }
    select.onchange = () => this.store.setActiveFloor(Number(select.value));
    const addBtn = el("button", "storey-add") as HTMLButtonElement;
    addBtn.type = "button";
    addBtn.title = t("panel.floorAdd");
    addBtn.append(icon("plus", 14));
    addBtn.onclick = () => this.store.addFloor(t("panel.floorNewName", { n: floors.length + 1 }));
    row.append(select, addBtn);
    return row;
  }

  private renderPane(): void {
    const sel = this.store.sel;
    const d = this.store.doc;
    // The stair tool shows its picker where a selection's properties go, so the
    // pane has a third state: nothing selected, but something to configure.
    const stairMode = this.tools.tool === "stair";
    const selSig = (stairMode ? `stair-tool:${this.tools.stairKind}|` : "")
      + (sel ? `${sel.kind}:${sel.id}` : "none");
    // Plan rows and the storey picker read from the document, so they have to
    // rebuild when an undo changes a value under them -- but not on every
    // store change, or placing a symbol would yank focus out of an open field.
    const paneSig = [this.store.activeFloor, d.floors.map(fl => fl.name).join("\u0001"),
      d.gridMm, areaModeOf(d), floorHeight(this.store.floor), this.tools.lastThickness,
      selSig].join("|");

    if (paneSig !== this.lastPaneSig) {
      this.lastPaneSig = paneSig;
      const storey = this.buildStoreyRow();
      this.pane.replaceChild(storey, this.storeyEl);
      this.storeyEl = storey;
      const plan = this.buildPlanSection();
      this.pane.replaceChild(plan, this.planEl);
      this.planEl = plan;
    }

    const swap = selSig !== this.lastSelSig;
    this.lastSelSig = selSig;
    this.paneBody.hidden = !sel && !stairMode;
    if (sel || stairMode) {
      this.paneBody.className = "pane-body" + (swap ? " pane-swap" : "");
      this.renderProps(this.props);
    }
    this.palette.syncActive();
    this.palette.syncInk();
  }

  /**
   * Floor housekeeping rows: rename, duplicate, delete. The picker itself and
   * the "add floor" action live in the `.storey` bar (buildStoreyRow above).
   */
  private renderFloors(
    btnRow: (l: string, f: () => void) => void,
    textRow: (l: string, v: string, f: (s: string) => void) => void,
    noteRow: (text: string) => void,
  ): void {
    const floors = this.store.doc.floors;
    textRow(t("panel.floorRename"), this.store.floor.name, n => this.store.renameFloor(n));
    if (this.store.floorBelow) noteRow(t("panel.floorGhost"));
    btnRow(t("panel.floorDuplicate"), () =>
      this.store.duplicateFloor(t("panel.floorNewName", { n: floors.length + 1 })));
    if (floors.length > 1) btnRow(t("panel.floorDelete"), () => this.store.deleteFloor());
  }

  /**
   * Sash editor. An opening is one hole; the sashes divide it. Editing writes
   * `sashes` even when the opening still carries a legacy windowType, so the
   * two never disagree — sashesOf() prefers `sashes` once it exists.
   */
  private renderSashes(
    o: Opening, wall: Wall,
    mut: (fn: (o2: Opening) => void) => void,
    selRow: (l: string, v: string, opts: Array<[string, string]>, f: (s: string) => void) => void,
    numRow: (l: string, v: number, f: (n: number) => void, step?: number) => void,
    btnRow: (l: string, f: () => void) => void,
    noteRow: (text: string) => void,
  ): void {
    const width = wallLength(this.store.floor, wall) > 0 ? o.width : o.width;
    const sashes = sashesOf(o, width);
    const writeBack = (fn: (list: Sash[]) => void): void => {
      mut(o2 => {
        const list = sashSpecsOf(o2);
        fn(list);
        o2.sashes = list;
      });
    };
    let horizontalHinge = false;
    sashes.forEach((sash, i) => {
      if (sashes.length > 1) noteRow(t("panel.sash", { n: i + 1 }));
      // Lead with the name a builder would use. The parts below stay editable,
      // so an unnamed combination is still reachable — it just reads "custom".
      const kind = windowKindOf(sash);
      const kindOpts: Array<[string, string]> = WINDOW_KINDS.map(k => [k.id, t("panel.win" + k.id[0]!.toUpperCase() + k.id.slice(1))]);
      if (!kind) kindOpts.push(["", t("panel.winCustom")]);
      selRow(t("panel.windowKind"), kind?.id ?? "", kindOpts, v => writeBack(list => {
        const k = WINDOW_KINDS.find(x => x.id === v);
        if (!k) return;
        if (k.expandsTo) {
          // Not one pane: a stolpraam is two leaves, so it replaces the list.
          list.length = 0;
          for (const x of k.expandsTo) list.push({ ...x });
          return;
        }
        list[i]!.action = k.action;
        list[i]!.hinge = k.hinge;
        list[i]!.outward = k.outward ?? false;
      }));
      const act = sash.action;
      if (act === "turn" || act === "turn-tilt" || act === "turn-slide")
        selRow(t("panel.hinge"), sash.hinge ?? "a",
          [["a", t("panel.hingeA")], ["b", t("panel.hingeB")]],
          v => writeBack(list => { list[i]!.hinge = v as HingeEdge; }));
      if (act === "tilt")
        selRow(t("panel.hinge"), sash.hinge ?? "sill",
          [["sill", t("panel.hingeSill")], ["head", t("panel.hingeHead")]],
          v => writeBack(list => { list[i]!.hinge = v as HingeEdge; }));
      if (act !== "fixed" && act !== "slide" && act !== "slide-vertical")
        selRow(t("panel.swing"), sash.outward ? "out" : "in",
          [["in", t("panel.swingIn")], ["out", t("panel.swingOut")]],
          v => writeBack(list => { list[i]!.outward = v === "out"; }));
      if (act === "slide" || act === "turn-slide")
        selRow(t("panel.slidesToward"), sash.slideTo ?? "b",
          [["a", t("panel.hingeA")], ["b", t("panel.hingeB")]],
          v => writeBack(list => { list[i]!.slideTo = v as "a" | "b"; }));
      numRow(t("panel.bars"), sash.bars ?? 0,
        n => writeBack(list => { list[i]!.bars = Math.max(0, Math.round(n)) || undefined; }), 1);
      if (sashes.length > 1)
        numRow(t("panel.sashWidth"), Math.round(sash.width),
          n => writeBack(list => { list[i]!.width = Math.max(50, n); }), 50);
      if (act === "tilt" || act === "pivot" || act === "slide-vertical") horizontalHinge = true;
    });
    if (horizontalHinge) noteRow(t("panel.planNote"));
    btnRow(t("panel.sashAdd"), () => writeBack(list => {
      // New sashes share the opening evenly: drop explicit widths and let
      // sashesOf() divide, rather than guessing a split the user did not ask for.
      list.push({ action: "fixed" });
      for (const x of list) delete x.width;
    }));
    if (sashes.length > 1) btnRow(t("panel.sashRemove"), () => writeBack(list => {
      list.pop();
      for (const x of list) delete x.width;
    }));
  }

  /**
   * Door leaves. A door kind describes the whole opening — "dubbele deur" IS
   * two leaves — so the picker writes the entire list, unlike the window picker
   * which sets one pane at a time.
   */
  private renderLeaves(
    o: Opening,
    mut: (fn: (o2: Opening) => void) => void,
    selRow: (l: string, v: string, opts: Array<[string, string]>, f: (s: string) => void) => void,
    numRow: (l: string, v: number, f: (n: number) => void, step?: number) => void,
    noteRow: (text: string) => void,
  ): void {
    const leaves = sashesOf(o, o.width);
    const kind = doorKindOf(leaves);
    const opts: Array<[string, string]> = DOOR_KINDS.map(k =>
      [k.id, t("panel.dr" + k.id[0]!.toUpperCase() + k.id.slice(1))]);
    if (!kind) opts.push(["", t("panel.drCustom")]);
    selRow(t("panel.doorKind"), kind?.id ?? "", opts, v => mut(o2 => {
      const k = DOOR_KINDS.find(x => x.id === v);
      // Copy the preset: sharing its objects would let one door's edits reach
      // every other door of the same kind.
      if (k) o2.sashes = k.sashes.map(x => ({ ...x }));
    }));

    const writeBack = (fn: (list: Sash[]) => void): void => {
      mut(o2 => {
        const list = sashSpecsOf(o2);
        fn(list);
        o2.sashes = list;
      });
    };
    leaves.forEach((leaf, i) => {
      if (leaves.length > 1) noteRow(t("panel.leaf", { n: i + 1 }));
      if (leaf.action === "turn")
        selRow(t("panel.hinge"), leaf.hinge ?? "a",
          [["a", t("panel.hingeA")], ["b", t("panel.hingeB")]],
          v => writeBack(list => { list[i]!.hinge = v as HingeEdge; }));
      if (leaf.action === "slide")
        selRow(t("panel.slidesToward"), leaf.slideTo ?? "b",
          [["a", t("panel.hingeA")], ["b", t("panel.hingeB")]],
          v => writeBack(list => { list[i]!.slideTo = v as "a" | "b"; }));
      if (leaf.action === "revolve")
        selRow(t("panel.spin"), leaf.spin ?? "ccw",
          [["ccw", t("panel.spinCcw")], ["cw", t("panel.spinCw")]],
          v => writeBack(list => { list[i]!.spin = v as "cw" | "ccw"; }));
      // A revolving drum has no swing side, and a slider has no swing at all.
      if (leaf.action !== "slide" && leaf.action !== "revolve")
        selRow(t("panel.swing"), leaf.outward ? "out" : "in",
          [["in", t("panel.swingIn")], ["out", t("panel.swingOut")]],
          v => writeBack(list => { list[i]!.outward = v === "out"; }));
      numRow(t("panel.bars"), leaf.bars ?? 0,
        n => writeBack(list => { list[i]!.bars = Math.max(0, Math.round(n)) || undefined; }), 1);
      if (leaves.length > 1)
        numRow(t("panel.sashWidth"), Math.round(leaf.width),
          n => writeBack(list => { list[i]!.width = Math.max(50, n); }), 50);
    });
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
    // Split on the drag-handle glyph and rebuild with text nodes plus one
    // span, rather than innerHTML — the hint is translated text, and
    // innerHTML would turn a translation string into an injection path.
    const parts = this.tools.hint.split("◆");
    const nodes: Node[] = [];
    parts.forEach((part, i) => {
      if (part) nodes.push(document.createTextNode(part));
      if (i < parts.length - 1) {
        const grip = el("span", "grip");
        grip.textContent = "◆";
        nodes.push(grip);
      }
    });
    this.status.replaceChildren(...nodes);
  }

  /** Row builders, shared by the property pane and the pinned Plan section. */
  private rowKit(p: HTMLElement) {
    const numRow = (
      label: string, value: number, onCommit: (n: number) => void, step = 10,
      extra: NumRowExtra = {},
    ): void => {
      const row = el("label", "prop-row");
      // What the field is ordinarily set to, where there is such a thing. It
      // belongs on the row rather than in a note: the guidance is wanted while
      // the number is being chosen, not underneath the whole section.
      if (extra.title) row.title = extra.title;
      row.append(Object.assign(el("span"), { textContent: label }));
      const input = el("input") as HTMLInputElement;
      input.type = "number"; input.value = String(Math.round(value)); input.step = String(step);
      input.onchange = () => { const n = parseFloat(input.value); if (isFinite(n)) onCommit(n); };
      scrubbable(input, {
        step,
        snap: extra.snap,
        onStart: () => { this.scrubbing = true; this.store.beginGesture("scrub:" + label); },
        onEnd: () => { this.scrubbing = false; this.store.endGesture(); this.refreshToolbar(); },
        onInput: n => onCommit(n),
      });
      row.append(input);
      p.append(row);
    };
    const selRow = (label: string, value: string, options: Array<[string, string]>, onCommit: (s: string) => void): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const sl = el("select") as HTMLSelectElement;
      for (const [val, lab] of options) {
        const o = el("option") as HTMLOptionElement;
        o.value = val; o.textContent = lab; if (val === value) o.selected = true;
        sl.append(o);
      }
      sl.onchange = () => onCommit(sl.value);
      row.append(sl);
      p.append(row);
    };
    const textRow = (label: string, value: string, onCommit: (s: string) => void): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const input = el("input") as HTMLInputElement;
      input.type = "text"; input.value = value;
      input.onchange = () => { const t2 = input.value.trim(); if (t2) onCommit(t2); };
      row.append(input);
      p.append(row);
    };
    const noteRow = (text: string): void => {
      p.append(Object.assign(el("div", "prop-note"), { textContent: text }));
    };
    /** A note that has to be seen: a figure outside the ordinary. */
    const warnRow = (text: string): void => {
      p.append(Object.assign(el("div", "prop-note is-warn"), { textContent: text }));
    };
    /**
     * Colour picker: the convention's pens as swatches plus a free one. Chips
     * rather than a <select>, because the value IS a colour — naming it in a
     * dropdown puts a word between the user and the thing they are choosing.
     * `null` is the default ink and is stored as no colour at all.
     */
    const colorRow = (label: string, value: string | null, onCommit: (hex: string | null) => void): void => {
      const row = el("div", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const chips = el("div", "ink-row");
      for (const ink of INKS) {
        const b = el("button", "ink") as HTMLButtonElement;
        b.type = "button";
        const name = t("panel.ink" + ink.id[0]!.toUpperCase() + ink.id.slice(1));
        b.title = name;
        b.setAttribute("aria-label", name);
        const on = ink.hex === value;
        b.setAttribute("aria-pressed", String(on));
        if (on) b.classList.add("is-on");
        b.style.background = ink.hex ?? COLORS.symbol;
        b.onclick = () => onCommit(ink.hex);
        chips.append(b);
      }
      // Anything the presets do not cover. `input` fires while the OS picker is
      // being dragged, which is what makes the plan preview live; the caller
      // coalesces those into one undo step.
      const custom = el("input", "ink ink-custom") as HTMLInputElement;
      custom.type = "color";
      custom.value = value ?? COLORS.symbol;
      custom.title = t("panel.inkCustom");
      custom.setAttribute("aria-label", t("panel.inkCustom"));
      if (value !== null && !INKS.some(i => i.hex === value)) custom.classList.add("is-on");
      // Same guard a number scrub needs, for the same reason: every commit
      // notifies the store, and a pane rebuild would swap this input out from
      // under an open picker -- after which its remaining events go nowhere.
      // Blur is the end, not `change`: Chrome fires change per pick while the
      // dialog is still open. main.ts redraws the canvas either way, so the
      // plan still previews live.
      custom.onfocus = () => { this.scrubbing = true; };
      custom.onblur = () => { this.scrubbing = false; this.refreshToolbar(); };
      custom.oninput = () => onCommit(custom.value);
      chips.append(custom);
      row.append(chips);
      p.append(row);
    };
    const btnRow = (label: string, fn: () => void): void => {
      const b = el("button", "tool-btn small wide") as HTMLButtonElement;
      b.textContent = label; b.onclick = fn;
      p.append(b);
    };
    return { numRow, selRow, textRow, noteRow, warnRow, btnRow, colorRow };
  }

  /**
   * Plan settings live in ONE place: a section under the context area, present
   * in every state -- including while the symbol palette is open, which is
   * exactly when the grid and "dikte nieuwe muur" matter. Always pinned to the
   * bottom of the pane and always closed on load, so it is in one place with
   * one behaviour rather than a default that shifts per state. Toggling flips
   * classes on the live nodes rather than re-rendering, so the fold animates.
   */
  private buildPlanSection(): HTMLElement {
    const open = this.planOpen;
    const wrap = el("div", "plan-sec");
    const head = el("button", "plan-head") as HTMLButtonElement;
    head.type = "button";
    head.setAttribute("aria-expanded", String(open));
    const chev = el("span", "chev");
    chev.append(icon("chevron", 14));
    head.append(chev, Object.assign(el("span", "sec-label"), { textContent: t("panel.plan") }));
    const body = el("div", "plan-body" + (open ? " is-open" : ""));
    const inner = el("div", "plan-rows");
    body.append(inner);
    head.onclick = () => {
      const next = !body.classList.contains("is-open");
      this.planOpen = next;
      body.classList.toggle("is-open", next);
      head.setAttribute("aria-expanded", String(next));
    };

    const { numRow, selRow, textRow, noteRow, btnRow } = this.rowKit(inner);
    this.renderFloors(btnRow, textRow, noteRow);
    numRow(t("panel.grid"), this.store.doc.gridMm, n => this.store.mutate(d => { d.gridMm = Math.max(1, n); }), 10);
    // Storey height belongs to the floor, not to each stair on it: a stair
    // connects two storeys, so changing this moves every stair that follows it.
    numRow(t("panel.floorHeight"), floorHeight(this.store.floor), n => {
      const h = Math.max(1000, Math.round(n));
      this.store.mutate(d => { this.store.floorOf(d).height = h; });
      // Keep the armed stair on the storey it will be placed in, or the next
      // one placed would carry the old height as an override of the new one.
      this.tools.followStoreyHeight(h);
    }, 100, { title: t("panel.floorHeightHelp") });
    numRow(t("panel.newWallThickness"), this.tools.lastThickness, n => { this.tools.lastThickness = Math.max(20, n); }, 10);
    selRow(t("panel.areaMode"), areaModeOf(this.store.doc),
      [["net", t("panel.areaNet")], ["centerline", t("panel.areaCenterline")]],
      m => this.store.mutate(d => { d.areaMode = m as AreaMode; }));
    if (areaModeOf(this.store.doc) === "net") noteRow(t("panel.areaNote"));

    wrap.append(head, body);
    return wrap;
  }

  private renderProps(p: HTMLElement): void {
    p.replaceChildren();
    const sel = this.store.sel;
    const f = this.store.floor;
    const { numRow, selRow, noteRow, warnRow, btnRow, colorRow } = this.rowKit(p);

    const secHead = (label: string, opts: { sel?: boolean; later?: boolean } = {}): void => {
      const wrap = el("div", "sec" + (opts.later ? " sec-later" : ""));
      const lbl = el("span", "sec-label" + (opts.sel ? " is-sel" : ""));
      lbl.textContent = label;
      wrap.append(lbl, el("div", "sec-rule"));
      if (opts.sel) {
        const close = el("button", "sec-close") as HTMLButtonElement;
        close.type = "button";
        close.title = t("panel.close");
        close.setAttribute("aria-label", t("panel.close"));
        close.append(icon("close", 14));
        close.onclick = () => this.store.select(null);
        wrap.append(close);
      }
      p.append(wrap);
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
    // Read-only: a derived figure the user cannot type into. Editing stays on the
    // centerline, which is what the document actually stores; showing the clear
    // span as an input would invite typing a number that has no single solution.
    const infoRow = (label: string, text: string, title?: string): void => {
      const row = el("div", "prop-row");
      if (title) row.title = title;
      row.append(
        Object.assign(el("span"), { textContent: label }),
        Object.assign(el("span", "prop-readonly"), { textContent: text }),
      );
      p.append(row);
    };
    const dangerRow = (label: string, fn: () => void): void => {
      const b = el("button", "btn-danger") as HTMLButtonElement;
      b.type = "button";
      b.append(
        icon("trash", 15),
        Object.assign(el("span"), { textContent: label }),
        Object.assign(el("span", "keycap"), { textContent: "Del" }),
      );
      b.onclick = fn;
      p.append(b);
    };

    const stairRows: StairRows = {
      secHead, numRow, selRow, infoRow, noteRow, warnRow, colorRow, btnRow, dangerRow,
    };

    // With the stair tool armed the picker stays put, the way the symbol
    // palette does: placing a stair selects it, so the next kind has to be
    // reachable without deselecting first.
    if (this.tools.tool === "stair") {
      if (sel?.kind === "stair") renderStairProps(this.store, this.tools, stairRows, sel.id);
      renderStairTool(p, this.store, this.tools, stairRows, () => this.refreshToolbar());
      return;
    }

    // Plan-level rows live in the pinned Plan section, not here.
    if (!sel) return;

    if (sel.kind === "stair") {
      renderStairProps(this.store, this.tools, stairRows, sel.id);
      return;
    }

    if (sel.kind === "wall") {
      const w = f.walls.find(x => x.id === sel.id);
      if (!w) return;
      secHead(t("panel.wall"), { sel: true });
      const L = wallLength(f, w);
      numRow(t("panel.length"), L, n => {
        if (n < 50) return;
        this.store.mutate(d => {
          const fl = this.store.floorOf(d);
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
      const clear = this.tools.resolvedWall(sel.id)?.clearLength;
      if (clear !== undefined && Math.abs(clear - L) > 0.5) infoRow(t("panel.clearSpan"), String(Math.round(clear)));
      numRow(t("panel.thickness"), w.thickness, n => {
        this.tools.lastThickness = Math.max(20, n);
        this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (wall) wall.thickness = Math.max(20, n);
        });
      });
      const a = f.nodes.find(x => x.id === w.a)!, b = f.nodes.find(x => x.id === w.b)!;
      numRow(t("panel.sagitta"), sagittaFromBulge(v(a.x, a.y), v(b.x, b.y), w.bulge), n => {
        this.store.mutate(d => {
          const fl = this.store.floorOf(d);
          const wall = fl.walls.find(x => x.id === sel.id);
          if (!wall) return;
          const aa = fl.nodes.find(x => x.id === wall.a)!, bb = fl.nodes.find(x => x.id === wall.b)!;
          wall.bulge = bulgeFromSagitta(v(aa.x, aa.y), v(bb.x, bb.y), n);
        });
      }, 50);
      dangerRow(t("panel.deleteWall"), () => { this.store.mutate(d => deleteWall(this.store.floorOf(d), sel.id)); this.store.select(null); });
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
          const fl = this.store.floorOf(d);
          const w2 = fl.walls.find(x => x.id === wid);
          const o2 = w2?.openings.find(x => x.id === sel.id);
          if (w2 && o2) { fn(o2, fl, w2); clampOpening(fl, w2, o2); }
        });
      };
      secHead(o.kind === "door" ? t("panel.door") : o.kind === "window" ? t("panel.window") : t("panel.passage"), { sel: true });
      numRow(t("panel.width"), o.width, n => mutOpening(o2 => { o2.width = n; }));
      numRow(t("panel.fromCorner"), o.t - o.width / 2, n => mutOpening(o2 => { o2.t = n + o2.width / 2; }));
      if (o.kind === "door") {
        this.renderLeaves(o, mutOpening, selRow, numRow, noteRow);
      }
      if (o.kind === "window") {
        this.renderSashes(o, wall, mutOpening, selRow, numRow, btnRow, noteRow);
      }
      if (o.kind !== "passage") {
        checkRow(t("panel.glazed"), o.glazed ?? false,
          b => mutOpening(o2 => { o2.glazed = b || undefined; }));
        checkRow(t("panel.powered"), o.powered ?? false,
          b => mutOpening(o2 => { o2.powered = b || undefined; }));
        checkRow(t("panel.selfClosing"), o.selfClosing ?? false,
          b => mutOpening(o2 => { o2.selfClosing = b || undefined; }));
        selRow(t("panel.fireRating"), o.fireRating?.kind ?? "",
          [["", t("panel.fireNone")], ["wbd", t("panel.fireWbd")], ["wrd", t("panel.fireWrd")]],
          v => mutOpening(o2 => {
            o2.fireRating = v ? { kind: v as "wbd" | "wrd", minutes: o2.fireRating?.minutes ?? 30 } : undefined;
          }));
        if (o.fireRating)
          numRow(t("panel.fireMinutes"), o.fireRating.minutes,
            n => mutOpening(o2 => {
              if (o2.fireRating) o2.fireRating.minutes = Math.max(0, Math.round(n));
            }), 15);
      }
      dangerRow(t("panel.deleteOpening"), () => this.tools.deleteSelected());
      return;
    }

    if (sel.kind === "symbol") {
      const s = f.symbols.find(x => x.id === sel.id);
      if (!s) return;
      secHead(t("panel.symbol", { type: t("symbol." + s.type) }), { sel: true });
      numRow(t("panel.rotation"), (s.rotation * 180) / Math.PI, n => this.store.mutate(d => {
        const s2 = this.store.floorOf(d).symbols.find(x => x.id === sel.id);
        if (s2) s2.rotation = (n * Math.PI) / 180;
      }), 15);
      // Changing a symbol's colour also arms the pen, the way editing a wall's
      // thickness sets the thickness of the next wall: recolouring one socket is
      // nearly always the first of a run of them.
      colorRow(t("panel.color"), s.color ?? null, hex => {
        this.tools.symbolColor = hex;
        this.store.mutate(d => {
          const s2 = this.store.floorOf(d).symbols.find(x => x.id === sel.id);
          if (!s2) return;
          if (hex) s2.color = hex; else delete s2.color;
        }, "color:" + sel.id);   // one undo step for a drag through the OS picker
      });
      btnRow(t("panel.mirror"), () => this.store.mutate(d => {
        const s2 = this.store.floorOf(d).symbols.find(x => x.id === sel.id);
        if (s2) s2.mirrored = !s2.mirrored;
      }));
      dangerRow(t("panel.deleteOpening"), () => this.tools.deleteSelected());
      return;
    }

    if (sel.kind === "node") {
      const n = f.nodes.find(x => x.id === sel.id);
      if (!n) return;
      secHead(t("panel.corner"), { sel: true });
      numRow(t("panel.x"), n.x, val => this.store.mutate(d => {
        const n2 = this.store.floorOf(d).nodes.find(x => x.id === sel.id);
        if (n2) n2.x = Math.round(val);
      }));
      numRow(t("panel.y"), n.y, val => this.store.mutate(d => {
        const n2 = this.store.floorOf(d).nodes.find(x => x.id === sel.id);
        if (n2) n2.y = Math.round(val);
      }));
      dangerRow(t("panel.deleteWithWalls"), () => this.tools.deleteSelected());
    }
  }
}

/** True when the query matches the symbol's name in ANY language, or its id. */
export function matches(def: SymbolDef, q: string): boolean {
  return allTranslations("symbol." + def.type).some(n => n.toLowerCase().includes(q))
      || def.label.toLowerCase().includes(q)
      || def.type.includes(q);
}

/** Optional extras on a number row: guidance text, and a scrub detent. */
export interface NumRowExtra {
  title?: string;
  snap?: (value: number) => number;
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
