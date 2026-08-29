// Symbol palette: search box + collapsible category fold-outs of icon tiles.
// Extracted out of panel.ts so the fold-out animation has a stable home: the
// stylesheet animates .pal-body's grid-template-rows (0fr -> 1fr), and this
// module's only job on toggle is to flip classes/aria state on existing
// nodes -- never inline styles, never a DOM rebuild, or the transition dies.
import { Tools } from "../input/tools";
import { SYMBOLS, CATEGORIES, SymbolDef } from "../render/symbols";
import { t, allTranslations } from "../i18n";
import { COLORS, INKS } from "../render/draw";
import { icon } from "./icons";

const FOLD_FALLBACK_MS = 240;

export class Palette {
  readonly el: HTMLElement;
  private searchInput: HTMLInputElement;
  private scroll: HTMLElement;
  private openCats = new Set<string>();
  private searchQ = "";
  private tiles = new Map<string, HTMLButtonElement>();
  private inkRow: HTMLElement;
  /** Every pen swatch with the colour it arms; null is the default ink. */
  private inkChips: Array<{ hex: string | null; el: HTMLElement }> = [];
  private inkCustom!: HTMLInputElement;
  /** The pen the tiles were last drawn in, so they are only rebuilt on a change. */
  private tileInk: string | null = null;
  private readonly idPrefix = "pal-" + Math.random().toString(36).slice(2);

  constructor(private tools: Tools, private onPick: () => void) {
    this.el = el("div", "pal");

    const search = el("div", "pal-search");
    const searchBox = el("div", "pal-search-box");
    this.searchInput = document.createElement("input");
    this.searchInput.type = "search";
    this.searchInput.placeholder = t("symbolSearch", { count: SYMBOLS.length });
    this.searchInput.oninput = () => { this.searchQ = this.searchInput.value; this.renderGrids(); };
    searchBox.append(icon("search", 15), this.searchInput);
    this.inkRow = this.buildInk();
    search.append(searchBox, this.inkRow);

    this.scroll = el("div", "pal-scroll");
    this.el.append(search, this.scroll);
    this.renderGrids();
  }

  refresh(): void {
    // Language change: rebuild labels/titles but keep what the user had open and typed.
    this.searchInput.placeholder = t("symbolSearch", { count: SYMBOLS.length });
    this.searchInput.value = this.searchQ;
    const ink = this.buildInk();
    this.inkRow.replaceWith(ink);
    this.inkRow = ink;
    this.renderGrids();
  }

  syncActive(): void {
    for (const [type, tile] of this.tiles)
      tile.classList.toggle("is-active", this.tools.tool === "symbol" && this.tools.symbolType === type);
  }

  /**
   * Reflect the armed pen. Toggles classes rather than rebuilding: this runs on
   * every store change, and replacing the colour input would slam the OS picker
   * shut mid-drag. The tiles are redrawn only when the pen actually changed.
   */
  syncInk(): void {
    const pen = this.tools.symbolColor;
    for (const chip of this.inkChips) {
      const on = chip.hex === pen;
      chip.el.classList.toggle("is-on", on);
      chip.el.setAttribute("aria-pressed", String(on));
    }
    const free = pen !== null && !INKS.some(i => i.hex === pen);
    this.inkCustom.classList.toggle("is-on", free);
    // It holds the current pen, so the OS picker opens on the colour in use.
    // Never while it has focus: writing .value would fight an open picker.
    if (document.activeElement !== this.inkCustom) this.inkCustom.value = pen ?? COLORS.symbol;
    if (pen !== this.tileInk) this.renderGrids();
  }

  /**
   * The pen strip. It lives with the tiles, not in the pinned Plan section
   * beside "new wall thickness": "draw the new sockets in red" is decided while
   * picking a symbol, and the Plan section is folded shut by default.
   */
  private buildInk(): HTMLElement {
    const row = el("div", "pal-ink");
    row.title = t("panel.newSymbolColor");
    row.append(Object.assign(el("span"), { textContent: t("panel.color") }));
    const pen = this.tools.symbolColor;
    this.inkChips = [];
    for (const ink of INKS) {
      const b = el("button", "ink") as HTMLButtonElement;
      b.type = "button";
      const name = t("panel.ink" + ink.id[0]!.toUpperCase() + ink.id.slice(1));
      b.title = name;
      b.setAttribute("aria-label", name);
      b.setAttribute("aria-pressed", String(ink.hex === pen));
      if (ink.hex === pen) b.classList.add("is-on");
      b.style.background = ink.hex ?? COLORS.symbol;
      b.onclick = () => this.tools.setSymbolColor(ink.hex);
      row.append(b);
      this.inkChips.push({ hex: ink.hex, el: b });
    }
    const custom = el("input", "ink ink-custom") as HTMLInputElement;
    custom.type = "color";
    custom.title = t("panel.inkCustom");
    custom.setAttribute("aria-label", t("panel.inkCustom"));
    custom.value = pen ?? COLORS.symbol;
    if (pen !== null && !INKS.some(i => i.hex === pen)) custom.classList.add("is-on");
    custom.oninput = () => this.tools.setSymbolColor(custom.value);
    row.append(custom);
    this.inkCustom = custom;
    return row;
  }


  private renderGrids(): void {
    this.scroll.innerHTML = "";
    this.tiles.clear();
    this.tileInk = this.tools.symbolColor;
    const q = this.searchQ.trim().toLowerCase();
    if (q) {
      const grid = el("div", "pal-grid");
      for (const def of SYMBOLS.filter(x => matches(x, q))) grid.append(this.tile(def));
      this.scroll.append(grid);
      return;
    }
    for (const [cat] of CATEGORIES) {
      const defs = SYMBOLS.filter(x => x.category === cat);
      if (defs.length === 0) continue;
      this.scroll.append(...this.category(cat, defs));
    }
  }

  private category(cat: string, defs: SymbolDef[]): [HTMLButtonElement, HTMLElement] {
    const open = this.openCats.has(cat);
    const bodyId = `${this.idPrefix}-${cat}`;

    const head = el("button", "pal-cat") as HTMLButtonElement;
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-controls", bodyId);
    const chev = el("span", "chev");
    chev.append(icon("chevron", 14));
    const name = el("span");
    name.textContent = t("category." + cat, {});
    const count = el("span", "count");
    count.textContent = String(defs.length);
    head.append(chev, name, count);

    const body = el("div", "pal-body");
    body.id = bodyId;
    if (open) body.classList.add("is-open");
    const grid = el("div", "pal-grid");
    for (const def of defs) grid.append(this.tile(def));
    body.append(grid);

    // A category near the bottom of the scroll area shouldn't stay hidden
    // under the fold once it opens -- but we can only scroll to it after the
    // height transition finishes (or a reduced-motion setup skips it, hence
    // the timeout fallback). Fresh closures per open give each one its own
    // "already ran" guard, so it fires at most once regardless of which path wins.
    const openWithScroll = (): void => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        body.removeEventListener("transitionend", onEnd);
        clearTimeout(timer);
        head.scrollIntoView({ block: "nearest" });
      };
      const onEnd = (ev: TransitionEvent): void => {
        if (ev.propertyName === "grid-template-rows") finish();
      };
      body.addEventListener("transitionend", onEnd);
      const timer = setTimeout(finish, FOLD_FALLBACK_MS);
    };

    head.onclick = () => {
      const nowOpen = !this.openCats.has(cat);
      if (nowOpen) this.openCats.add(cat); else this.openCats.delete(cat);
      head.setAttribute("aria-expanded", String(nowOpen));
      body.classList.toggle("is-open", nowOpen);
      if (nowOpen) openWithScroll();
    };

    return [head, body];
  }

  private tile(def: SymbolDef): HTMLButtonElement {
    const b = el("button", "sym-tile") as HTMLButtonElement;
    const label = t("symbol." + def.type);
    b.title = label;
    if (this.tools.tool === "symbol" && this.tools.symbolType === def.type) b.classList.add("is-active");

    const cv = document.createElement("canvas");
    cv.width = 104; cv.height = 104;
    const ctx = cv.getContext("2d");
    if (ctx) {
      ctx.scale(2, 2); // crisp on hidpi
      const pad = 6;
      const sc = (52 - 2 * pad) / Math.max(def.width, def.depth);
      if (def.wallMounted) {
        ctx.strokeStyle = "#c8c3b5";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(4, 6); ctx.lineTo(48, 6); ctx.stroke();
        ctx.translate(26, 6);
      } else {
        ctx.translate(26, 26);
      }
      ctx.scale(sc, sc);
      // Tiles in the armed pen: with red armed, the whole palette turns red, so
      // a run of symbols cannot be placed in the wrong colour unnoticed.
      ctx.strokeStyle = this.tileInk ?? COLORS.symbol;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 20;
      def.draw(ctx);
    }

    const span = el("span");
    span.textContent = label;
    b.append(cv, span);
    b.onclick = () => { this.tools.setTool("symbol", def.type); this.onPick(); };
    this.tiles.set(def.type, b);
    return b;
  }
}

function matches(def: SymbolDef, q: string): boolean {
  return allTranslations("symbol." + def.type).some(n => n.toLowerCase().includes(q))
      || def.label.toLowerCase().includes(q)
      || def.type.includes(q);
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
