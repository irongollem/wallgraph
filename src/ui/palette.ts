// Symbol palette: search box + collapsible category fold-outs of icon tiles.
// Extracted out of panel.ts so the fold-out animation has a stable home: the
// stylesheet animates .pal-body's grid-template-rows (0fr -> 1fr), and this
// module's only job on toggle is to flip classes/aria state on existing
// nodes -- never inline styles, never a DOM rebuild, or the transition dies.
import { Tools } from "../input/tools";
import { SYMBOLS, CATEGORIES, SymbolDef } from "../render/symbols";
import { t, allTranslations } from "../i18n";
import { icon } from "./icons";

const FOLD_FALLBACK_MS = 240;

export class Palette {
  readonly el: HTMLElement;
  private searchInput: HTMLInputElement;
  private scroll: HTMLElement;
  private openCats = new Set<string>();
  private searchQ = "";
  private tiles = new Map<string, HTMLButtonElement>();
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
    search.append(searchBox);

    this.scroll = el("div", "pal-scroll");
    this.el.append(search, this.scroll);
    this.renderGrids();
  }

  refresh(): void {
    // Language change: rebuild labels/titles but keep what the user had open and typed.
    this.searchInput.placeholder = t("symbolSearch", { count: SYMBOLS.length });
    this.searchInput.value = this.searchQ;
    this.renderGrids();
  }

  syncActive(): void {
    for (const [type, tile] of this.tiles)
      tile.classList.toggle("is-active", this.tools.tool === "symbol" && this.tools.symbolType === type);
  }


  private renderGrids(): void {
    this.scroll.innerHTML = "";
    this.tiles.clear();
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
      ctx.strokeStyle = "#4a5568";
      ctx.fillStyle = "#4a5568";
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
