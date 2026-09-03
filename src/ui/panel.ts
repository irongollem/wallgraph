// Rail, storey/palette/property pane, and status bar. Plain DOM.
import { Store, type Selection } from "../model/store";
import { roomKey, orphanedRoomNames, type Room } from "../core/rooms";
import { isMixed } from "../core/mixed";
import { defaultMountHeight, clampMountHeight } from "../core/mount";
import { Tools, ToolName } from "../input/tools";
import { clampOpening, wallLength, deleteWall, deleteRoomNames, splitWall } from "../model/ops";
import type { SymbolDef } from "../render/symbols";
import { sagittaFromBulge, bulgeFromSagitta } from "../geometry/arc";
import { v, norm, sub, add, scale } from "../geometry/vec";
import { exportJson, copyJson, importJsonFile, parseDoc, clearAutosave } from "../io/json";
import { pickUnderlayImage, prepareUnderlayImage, initialUnderlay, imageFromClipboard } from "../io/underlay";
import { exportPng } from "../io/image";
import { exportDxf } from "../io/dxf";
import { exportIfc } from "../io/ifc";
import { exportSvg } from "../io/svg";
import { exportPermit, PermitFormat } from "../io/permit";
import { permitChecklist, PermitCheck } from "../core/permit";
import { seedDoc } from "../seed";
import {
  emptyDoc, areaModeOf, dimModeOf, mountMarksOn, floorHeight, storeyCeiling, CEILING_DEFAULT_MM,
  wallHeight, openingSill, openingHeight, projectOf,
  sashesOf, sashSpecsOf, windowKindOf, WINDOW_KINDS,
  doorKindOf, DOOR_KINDS, widthsFor, DOOR_WIDTHS_DOUBLE, FIRE_KINDS, FIRE_MINUTES,
  FIRE_MINUTES_DEFAULT, routesOf, furnishingsOf, WALL_MATERIALS, POST_DEFAULT_MM, POST_WIDTH_DEFAULT,
  FACADE_DEFAULT_MM, facadeSideOf,
  type AreaMode, type DimMode, type Sash, type HingeEdge, type Opening, type Wall, type Floor, type FireKind,
  type ProjectMeta, type Id, type WallMaterial, type PlanDoc,
} from "../model/doc";
import type { Discipline } from "../model/route";
import { t, language, changeLanguage, allTranslations, LANGUAGES, on as onI18n, type Lang } from "../i18n";
import { COLORS, INKS } from "../render/draw";
import { icon, type IconName } from "./icons";
import { docHref, DOC_IDS } from "../links";
import { openMenu, type MenuEntry } from "./menu";
import { Palette } from "./palette";
import { categoriesIn, getSymbol, type SymbolCategory } from "../render/symbols";
import { LAYER_KEYS, LAYER_OF_CATEGORY, type LayerKey } from "../render/layers";
import { renderStairTool, renderStairProps, renderStairBulk, type PaneRows } from "./stairs";
import { routeTakesSymbol } from "../core/attach";
import { incompleteDevices } from "../core/port";
import { renderFurnishingTool, renderFurnishingProps } from "./furnishing";
import { renderZoomTool, type RoomEdit } from "./zoom";
import { renderOpeningTool } from "./openings";
import { renderWallTool, renderWallSurface } from "./walls";
import { floorSurface } from "../core/surface";
import {
  planWallJoin, applyWallJoin, isJoinPlan,
  applyNodeDissolve, isDissolvePlan, planWallMerge, planNodeRemoval, removeNode,
} from "../core/join";
import { removeRoutePoint } from "../core/routegraph";
import { renderVideProps, renderVideBulk } from "./vide";
import { renderStructureTool, renderStructureProps, renderStructureBulk } from "./structure";
import {
  renderRouteTool, renderRouteProps, renderRouteBulk, deviceConnectionRows, boardRows,
} from "./route";
import { BOARD_TYPE } from "../core/board";
import { servicesPaneActive, fitoutPaneActive } from "./panes";
import { scrubbable } from "./scrub";
import { watchLayout, isTouchPrimary, type LayoutMode } from "./layout";
import { Sheet } from "./sheet";
import { buildKeypad } from "./keypad";

/**
 * selRow's mixed marker: an option value no real field ever uses, so it can
 * never collide with a legitimate "" value (loadBearing's unknown, a fire
 * rating's none) the way a plain "" sentinel would.
 */
const MIXED_SENTINEL = "__mixed__";

/**
 * The layers this storey has something on, in LAYER_KEYS order. A toggle for
 * an empty layer states nothing and hides nothing.
 */
function layersPresent(floor: Floor): LayerKey[] {
  const on = new Set<LayerKey>();
  for (const r of routesOf(floor)) on.add(r.discipline);
  for (const sym of floor.symbols) {
    const cat = getSymbol(sym.type)?.category;
    if (cat) on.add(LAYER_OF_CATEGORY[cat]);
  }
  if (furnishingsOf(floor).length > 0) on.add("furnishing");
  return LAYER_KEYS.filter(k => on.has(k));
}

/** Which pane's palette a symbol type belongs to, or null for an unknown id. */
/**
 * The symbol category a run of each discipline terminates at, so arming a
 * discipline opens the terminals that go with it. Gas has no marks of its own;
 * a gas run ends at a toestel, which the heating group carries.
 */
const DISCIPLINE_CATEGORY: Record<Discipline, SymbolCategory> = {
  electrical: "electrical",
  water: "water",
  heating: "heating",
  vent: "ventilation",
  gas: "heating",
};

export class Panel {
  private rail: HTMLElement;
  private pane: HTMLElement;
  private status: HTMLElement;
  private foot: HTMLElement;
  /** One palette per authoring section; see ui/palette.ts. Both stay mounted —
   *  removing one even for a frame drops focus out of its search box — and the
   *  armed tool decides which is shown. */
  private servicePalette: Palette;
  private fitoutPalette: Palette;
  /**
   * The rail's three groups, as their own containers so the compact shell can
   * send them to three different places: tools to the bottom bar, modes to a
   * floating row, undo/redo to the top bar. In the wide shell they are
   * `display: contents`, so the rail's flex children stay the buttons
   * themselves and the sidebar looks exactly as it did.
   */
  private toolsEl: HTMLElement;
  private modesEl: HTMLElement;
  private historyEl: HTMLElement;
  private head: HTMLElement;
  private docBtn: HTMLButtonElement;
  private root: HTMLElement;
  private mode: LayoutMode;
  /** Built on the first compact mount and kept, so its detent survives a mode flip. */
  private sheet: Sheet | null = null;
  private keypadEl: HTMLElement | null = null;
  private chainBar: HTMLElement | null = null;
  /** What the bar over the sheet currently says; "" when there is no bar. */
  private chainBarSig = "";
  /** The compact layout's pinned "Done (n)" pill while the select tool's
   *  long-press mode is live -- same precedent as chainBar above. */
  private modeBar: HTMLElement | null = null;
  private modeBarSig = "";
  private actionsEl: HTMLElement | null = null;
  /** Told when the shell changes, so the host can re-frame the plan. */
  onLayoutChange: (() => void) | null = null;
  /** Persistent pane children. The palette is never detached: removing it even
   *  for one frame drops focus out of its search box. */
  private paneScroll: HTMLElement;
  private paneBody: HTMLElement;
  private props: HTMLElement;
  private storeyEl: HTMLElement;
  private planEl: HTMLElement;
  private underlayEl: HTMLElement;
  private permitEl: HTMLElement;
  /** Everything the pane's structure depends on; a change rebuilds it. */
  private lastPaneSig = "";
  /** Selection alone — drives the fade, so a grid tweak does not flash. */
  private lastSelSig = "";
  private planOpen = false;
  private underlayOpen = false;
  private permitOpen = false;
  /** The storey-management pane is open in the context area (renderFloorsPane).
   *  Pane state like roomEditKey: it has to survive the rebuilds it causes. */
  private floorsOpen = false;
  /** The permit checklist's container; repopulated in place while open. */
  private permitChecksEl: HTMLElement | null = null;
  /** permitChecklist() cache, keyed on store.revision -- it runs resolveFloor,
   *  planBounds, dimensionChains and detectRooms itself (see core/permit.ts),
   *  so recomputing it on every store notification would repeat that work per
   *  mutation during a drag while the permit section happens to be open. Same
   *  pattern as derived() in main.ts. */
  private permitCacheRev = -1;
  private permitCacheItems: PermitCheck[] = [];
  /** Which room's name field is open in the zoom pane; see RoomEdit. */
  private roomEditKey: string | null = null;
  /** True mid drag-scrub: the pane must not rebuild and yank the input out
   *  from under the pointer. main.ts redraws the canvas independently, so
   *  the drawing still tracks the drag. */
  private scrubbing = false;

  constructor(root: HTMLElement, private store: Store, private tools: Tools) {
    this.root = root;
    this.head = el("div", "side-head");
    const h1 = Object.assign(el("h1"), { textContent: t("app.title") });
    const docBtn = el("button", "rail-btn") as HTMLButtonElement;
    docBtn.type = "button";
    docBtn.title = t("action.documentTitle");
    docBtn.setAttribute("aria-label", t("action.document"));
    docBtn.append(icon("dots"));
    docBtn.onclick = () => openMenu(docBtn, this.documentMenuEntries());
    this.head.append(h1, docBtn);
    this.docBtn = docBtn;

    this.rail = el("div", "rail");
    this.toolsEl = el("div", "rail-group");
    this.modesEl = el("div", "rail-group");
    this.historyEl = el("div", "rail-group");
    this.pane = el("div", "pane");

    this.status = el("div", "status");
    this.foot = el("div", "side-foot");

    this.servicePalette = new Palette(tools, categoriesIn("services"), () => this.refreshToolbar());
    this.fitoutPalette = new Palette(tools, categoriesIn("fitout"), () => this.refreshToolbar());

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
    this.paneScroll.append(this.paneBody, this.servicePalette.el, this.fitoutPalette.el);
    this.planEl = this.buildPlanSection();
    this.underlayEl = this.buildUnderlaySection();
    this.permitEl = this.buildPermitSection();

    this.mode = watchLayout(next => {
      if (next === this.mode) return;
      this.mode = next;
      this.mountShell();
      this.refreshToolbar();
      // The canvas is a flex sibling in one shell and full-bleed under a lid in
      // the other, so what was framed for one is framed wrong for the other.
      this.onLayoutChange?.();
    });
    this.mountShell();

    this.renderFoot();
    this.refreshToolbar();
    store.onChange(() => this.refreshToolbar());
    onI18n("languageChanged", () => {
      this.servicePalette.refresh();
      this.fitoutPalette.refresh();
      this.renderFoot();
      this.refreshToolbar();
    });
    // Paste-an-image is the underlay section's second import path, alongside
    // the file picker. Scoped to while that section is open, and skipped over
    // a text field, so an ordinary Ctrl+V into the permit's project-name field
    // (or anywhere else) is never hijacked into loading an underlay.
    window.addEventListener("paste", e => {
      if (!this.underlayOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const file = imageFromClipboard(e);
      if (file) { e.preventDefault(); void this.loadUnderlayFile(file); }
    });
  }

  /**
   * Put the parts where this layout wants them.
   *
   * Both shells use the same elements, so switching is a re-parent rather than
   * a rebuild: the palette keeps its open categories and its search text, and
   * the sheet keeps the detent the user left it at.
   */
  private mountShell(): void {
    const compact = this.mode === "compact";
    const touch = compact || isTouchPrimary();
    this.root.classList.toggle("is-compact", compact);
    // Separate from the layout: a tablet is wide but still driven by fingers,
    // and a narrow desktop window is compact but still has a mouse.
    this.root.classList.toggle("is-touch", touch);
    this.tools.touchUi = touch;

    if (!compact) {
      // The compact shell moves the document button into its top bar, and a
      // move is not undone by re-parenting the header it came from: without
      // this, a window dragged narrow and back leaves the sidebar with a
      // wordmark and no way into the menu until the page is reloaded.
      this.head.append(this.docBtn);
      this.rail.replaceChildren(this.toolsEl, el("hr", "rail-sep"), this.modesEl,
        el("div", "rail-spacer"), this.historyEl);
      const sideBody = el("div", "side-body");
      sideBody.append(this.rail, this.pane);
      this.pane.replaceChildren(this.storeyEl, this.paneScroll, this.planEl, this.underlayEl, this.permitEl);
      this.root.replaceChildren(this.head, sideBody, this.status, this.foot);
      return;
    }

    // Compact: the chrome sits over a full-bleed canvas. The top bar carries
    // the storey and the history, the modes float, and everything that was in
    // the pane goes into the sheet above a labelled tool bar.
    const sheet = this.sheet ?? (this.sheet = new Sheet(t("panel.sheetHandle")));
    const top = el("div", "wg-top");
    top.append(this.docBtn, this.storeyEl, this.historyEl);
    const modes = el("div", "wg-modes");
    modes.append(this.modesEl);
    const toolbar = el("div", "wg-toolbar");
    toolbar.append(this.toolsEl);
    // The hint rides in the pinned foot rather than over the canvas: the sheet
    // changes height with its detent, so nothing floating above it has a
    // position CSS can know.
    sheet.foot.replaceChildren(this.status, toolbar);
    // All three are re-added by renderTyping, which runs at the end of every refresh.
    this.keypadEl = null;
    this.chainBar = null;
    this.chainBarSig = "";
    this.modeBar = null;
    this.modeBarSig = "";
    sheet.body.replaceChildren(this.paneScroll, this.planEl, this.underlayEl, this.permitEl, this.foot);
    this.root.replaceChildren(top, modes, sheet.el);
  }

  /**
   * How much of the canvas the chrome covers, in CSS px.
   *
   * Zero in the wide layout, where the sidebar is a flex sibling of the canvas
   * rather than a lid on it. In the compact layout the canvas is full-bleed and
   * the chrome floats, so anything framing the plan has to know what is hidden
   * or it will centre the drawing under the sheet.
   *
   * The two compact arrangements are told apart by the one thing that actually
   * distinguishes them: a bottom sheet spans the full width, a side panel does
   * not.
   */
  canvasInsets(): { top: number; right: number; bottom: number; left: number } {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    if (this.mode !== "compact" || !this.sheet) return zero;
    const host = this.root.getBoundingClientRect();
    const sheet = this.sheet.el.getBoundingClientRect();
    if (host.width === 0 || sheet.width === 0) return zero;
    if (sheet.width >= host.width - 1) {
      const top = this.root.querySelector(".wg-top")?.getBoundingClientRect();
      return { ...zero, top: top ? top.height : 0, bottom: sheet.height };
    }
    const bar = this.root.querySelector(".wg-toolbar")?.getBoundingClientRect();
    return { ...zero, left: bar ? bar.width : 0, right: sheet.width };
  }

  /**
   * The zoom pane's room list writes names, so it needs somewhere to keep which
   * row is open across the rebuild that opening one causes. That is here rather
   * than in Tools: it is pane state, and it has to survive a rebuild the pane
   * itself asks for.
   */
  private get roomEdit(): RoomEdit {
    return {
      key: this.roomEditKey,
      open: key => {
        this.roomEditKey = key;
        // The field can sit below the fold of a sheet that is only peeking.
        if (key !== null) this.sheet?.atLeast("half");
        this.refreshToolbar();
      },
      clear: () => { this.roomEditKey = null; },
    };
  }

  /**
   * A room's label on the canvas was clicked. The room list is the naming
   * surface, so this arms the tool that shows it and opens that room's field —
   * the plan and the panel are two views of the same room.
   */
  editRoom(room: Room): void {
    this.roomEditKey = roomKey(room);
    this.sheet?.atLeast("half");
    // setTool refreshes the pane, which is what renders the open field.
    this.tools.setTool("zoom");
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
    /**
     * Every button carries its short name as well as its icon. Without a mouse
     * there is no `title` to hover, so the compact shells show the caption
     * under the icon; the sidebar hides it in CSS on every pointer, its row
     * button having no room beside a 52 px icon. The key badge is the mirror
     * of that: it states the shortcut where there is a keyboard to press it,
     * and CSS hides it wherever the caption appears or the pointer is coarse.
     */
    const caption = (b: HTMLElement, short: string): void => {
      b.append(Object.assign(el("em", "rail-name"), { textContent: short }));
    };

    const toolBtn = (name: IconName, tool: ToolName, key: string, label: string, short: string): HTMLButtonElement => {
      const b = el("button", "rail-btn") as HTMLButtonElement;
      b.type = "button";
      const active = this.tools.tool === tool;
      b.title = `${label} (${key})`;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", String(active));
      if (active) b.classList.add("is-active");
      // The 3D view has no tools to arm: the plan is not the thing on screen.
      // Disabled rather than hidden, so the rail keeps its shape.
      b.disabled = this.tools.view3d;
      b.append(icon(name), keyTag(key, "rail-key"));
      caption(b, short);
      b.onclick = () => this.tools.setTool(tool);
      return b;
    };

    this.toolsEl.replaceChildren(
      toolBtn("select", "select", "V", t("tool.select"), t("tool.shortSelect")),
      toolBtn("wall", "wall", "W", t("tool.wall"), t("tool.shortWall")),
      toolBtn("door", "door", "D", t("tool.door"), t("tool.shortDoor")),
      toolBtn("window", "window", "N", t("tool.window"), t("tool.shortWindow")),
      toolBtn("passage", "passage", "P", t("tool.passage"), t("tool.shortPassage")),
      toolBtn("stair", "stair", "T", t("tool.stair"), t("tool.shortStair")),
      toolBtn("structure", "structure", "H", t("tool.structure"), t("tool.shortStructure")),
      toolBtn("cabinet", "furnishing", "C", t("tool.furnishing"), t("tool.shortFurnishing")),
      toolBtn("route", "route", "U", t("tool.route"), t("tool.shortRoute")),
      toolBtn("zoom", "zoom", "Z", t("tool.zoom"), t("tool.shortZoom")),
    );
    // Symbols have no rail button of their own: every mark is placed from the
    // pane of the section it belongs to — services from Installaties, safety
    // from Inrichten — so those two buttons already reach all of them.
    if (this.mode === "compact") {
      // Ten tools do not fit across a phone, so the bar scrolls and keeps the
      // armed one in view — otherwise arming a tool by keyboard, or by rotating
      // the device, would leave it off screen.
      this.toolsEl.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    const modeBtn = (name: IconName, modeKey: string, on: boolean, label: string, key: string, short: string): HTMLButtonElement => {
      const b = el("button", "rail-btn is-mode") as HTMLButtonElement;
      b.type = "button";
      b.dataset.mode = modeKey;
      b.title = `${label} (${key})`;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", String(on));
      if (on) b.classList.add("is-on");
      b.append(icon(name), keyTag(key, "rail-key"));
      caption(b, short);
      return b;
    };

    const grid = modeBtn("gridSnap", "grid", this.tools.snapGrid, t("tool.gridSnap"), "G", t("tool.shortGridSnap"));
    grid.onclick = () => this.toggleMode("grid", () => { this.tools.snapGrid = !this.tools.snapGrid; }, true);
    const angle = modeBtn("angleSnap", "angle", this.tools.ortho, t("tool.angleSnap"), "O", t("tool.shortAngleSnap"));
    angle.onclick = () => this.toggleMode("angle", () => { this.tools.ortho = !this.tools.ortho; }, false);
    const dims = modeBtn("dimensions", "dims", this.tools.showDims, t("tool.measurements"), "L", t("tool.shortMeasurements"));
    dims.onclick = () => this.toggleMode("dims", () => { this.tools.showDims = !this.tools.showDims; }, true);
    // The drawing toggles govern gestures the 3D view does not take.
    grid.disabled = angle.disabled = dims.disabled = this.tools.view3d;
    // The 3D view rides with the mode toggles rather than the tools: it arms
    // nothing and places nothing, it changes what the canvas shows.
    const three = modeBtn("view3d", "view3d", this.tools.view3d, t("tool.view3d"), "3", t("tool.short3d"));
    three.onclick = () => this.toggleMode("view3d", () => { this.tools.setView3d(!this.tools.view3d); }, false);
    this.modesEl.replaceChildren(grid, angle, dims, three);

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

    this.historyEl.replaceChildren(undo, redo);
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
    const fresh = this.modesEl.querySelector<HTMLButtonElement>(`[data-mode="${modeKey}"]`);
    if (!fresh) return;
    fresh.classList.add("is-pulse");
    fresh.addEventListener("animationend", () => fresh.classList.remove("is-pulse"), { once: true });
  }

  private documentMenuEntries(): MenuEntry[] {
    return [
      { kind: "item", icon: "docNew", label: t("action.new"), onPick: () => {
        clearAutosave(); this.replaceDocument(emptyDoc()); this.flash(t("status.newPlan"));
      } },
      { kind: "item", icon: "docDemo", label: t("action.demo"), onPick: () => {
        this.replaceDocument(seedDoc()); this.flash(t("status.demoLoaded"));
      } },
      { kind: "item", icon: "docOpen", label: t("action.open"), onPick: () => importJsonFile(
        doc => { this.replaceDocument(doc); this.flash(t("status.planLoaded")); },
        () => this.flash(t("status.invalidFile")),
      ) },
      { kind: "sep" },
      { kind: "item", icon: "docSave", label: t("action.save"), hint: "JSON", onPick: () => { void exportJson(this.store.doc); } },
      { kind: "item", icon: "docPng", label: t("action.png"), hint: "PNG", onPick: () => { void this.savePng(); } },
      { kind: "item", icon: "docSvg", label: t("action.svg"), hint: "SVG", onPick: () => { void this.saveSvg(); } },
      { kind: "item", icon: "docDxf", label: t("action.dxf"), hint: "DXF", onPick: () => { void this.saveDxf(); } },
      { kind: "item", icon: "docDxf", label: t("action.ifc"), hint: "IFC", onPick: () => { void this.saveIfc(); } },
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

  /** Replace the plan and reframe whichever canvas is currently visible. */
  private replaceDocument(doc: PlanDoc): void {
    this.store.replace(doc, true);
    if (this.tools.view3d) this.tools.onView3dFit?.();
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

  /**
   * The permit sheet. Same shape as savePng: one flash, keys spelled out. PDF
   * is what a submission takes and what holds the stated scale on its own; SVG
   * is for a sheet that goes on into a report or an illustrator.
   */
  private async savePermit(format: PermitFormat): Promise<void> {
    const result = await exportPermit(this.store.doc, this.store.activeFloor, format);
    const suffix = format === "pdf" ? "Pdf" : "Svg";
    this.flash(t(result === "saved" ? `status.permitSaved${suffix}`
      : result === "empty" ? "status.permitEmpty"
      : "status.permitFailed"));
  }

  /** CAD export. Same shape as savePng: one flash, keys spelled out. */
  private async saveDxf(): Promise<void> {
    const result = await exportDxf(this.store.doc, this.store.activeFloor);
    this.flash(t(result === "saved" ? "status.dxfSaved"
      : result === "empty" ? "status.dxfEmpty"
      : "status.dxfFailed"));
  }

  /** BIM spatial structure export. Whole document, not one storey — every
   *  floor becomes an IFCBUILDINGSTOREY, so there is no floorIndex to pass. */
  private async saveIfc(): Promise<void> {
    const result = await exportIfc(this.store.doc);
    this.flash(t(result === "saved" ? "status.ifcSaved" : "status.ifcFailed"));
  }

  /**
   * Storey picker. Floors are listed top-down (highest first) because that is
   * how a stack of storeys reads on paper, while the document stores
   * floors[0] as the lowest. Adding a floor lives here too; rename/duplicate/
   * delete/reorder live in the management pane the leading button unfolds
   * (renderFloorsPane below).
   */
  private buildStoreyRow(): HTMLElement {
    const floors = this.store.doc.floors;
    const row = el("div", "storey");
    const manage = el("button", "storey-manage") as HTMLButtonElement;
    manage.type = "button";
    manage.title = t("panel.floorManage");
    manage.setAttribute("aria-label", t("panel.floorManage"));
    manage.setAttribute("aria-expanded", String(this.floorsOpen));
    if (this.floorsOpen) manage.classList.add("is-active");
    manage.append(icon("floors", 16));
    manage.onclick = () => this.toggleFloorsPane();
    row.append(manage);
    const select = el("select", "storey-select") as HTMLSelectElement;
    select.setAttribute("aria-label", t("panel.storey"));
    for (const [i, fl] of floors.map((fl, i) => [i, fl] as const).reverse()) {
      const o = el("option") as HTMLOptionElement;
      o.value = String(i);
      o.textContent = fl.name;
      if (i === this.store.activeFloor) o.selected = true;
      select.append(o);
    }
    // A selection on another storey means nothing here (Store.setActiveFloor
    // already clears it) -- the select tool's long-press mode has to follow,
    // or a stale "Klaar" pill would sit over a pane with nothing left to
    // land in.
    select.onchange = () => { this.store.setActiveFloor(Number(select.value)); this.tools.exitSelectMode(); };
    const addBtn = el("button", "storey-add") as HTMLButtonElement;
    addBtn.type = "button";
    addBtn.title = t("panel.floorAdd");
    addBtn.append(icon("plus", 14));
    addBtn.onclick = () => {
      this.store.addFloor(t("panel.floorNewName", { n: floors.length + 1 }));
      this.tools.exitSelectMode();
    };
    row.append(select, addBtn);
    return row;
  }

  private renderPane(): void {
    const sel = this.store.sel;
    const d = this.store.doc;
    // The stair tool shows its picker where a selection's properties go, so the
    // pane has a third state: nothing selected, but something to configure.
    const stairMode = this.tools.tool === "stair";
    const structureMode = this.tools.tool === "structure";
    // A section stays open while its own marks are being placed: arming a
    // socket from the Installaties pane must not throw away the run's
    // properties, and the same for a blusser and the fit-out picker.
    const servicesMode = servicesPaneActive(this.tools.tool, this.tools.symbolType);
    const fitoutMode = fitoutPaneActive(this.tools.tool, this.tools.symbolType);
    const routeMode = servicesMode;
    const paneTool = fitoutMode
      || this.tools.tool === "zoom" || this.tools.tool === "door"
      || this.tools.tool === "window" || this.tools.tool === "passage"
      || this.tools.tool === "wall";
    // The storey pane yields to anything else that claims the context area: a
    // selection or an armed tool pane means the user moved on.
    if (this.floorsOpen && (sel || stairMode || structureMode || servicesMode || paneTool)) this.floorsOpen = false;
    const floorsMode = this.floorsOpen;
    const selSig = (floorsMode ? "floors|" : "")
      + (stairMode ? `stair-tool:${this.tools.stairKind}|` : "")
      + (structureMode ? `structure-tool:${this.tools.structureKind}|` : "")
      + (routeMode ? `route-tool:${this.tools.routeDiscipline}|` : "")
      + (paneTool ? "pane-tool:" + this.tools.tool + "|" : "")
      + (this.tools.tool === "symbol" ? "symbol:" + this.tools.symbolType + "|" : "")
      + (this.tools.tool === "wall"
        ? `wall:${this.tools.wallShape}:${this.tools.polygonSides}:${this.tools.squareLock}:${this.tools.canCloseChain}|`
        : "")
      // selMore (count + ids) so the pane rebuilds when the group changes --
      // a shift-click, a marquee catch, or a mode toggle -- not only when the
      // primary selection itself changes. selectMode rides along too, since
      // entering/leaving it changes what the header offers (the Done button).
      + (sel ? `${sel.kind}:${sel.id}:${this.store.selMore.length}:${this.store.selMore.join(",")}` : "none")
      + (this.tools.selectMode ? "|mode" : "");
    // Plan rows and the storey picker read from the document, so they have to
    // rebuild when an undo changes a value under them -- but not on every
    // store change, or placing a symbol would yank focus out of an open field.
    const paneSig = [this.store.activeFloor, d.floors.map(fl => `${fl.id}\u0000${fl.name}`).join("\u0001"),
      d.gridMm, areaModeOf(d), floorHeight(this.store.floor),
      this.store.floor.ceilingMm ?? "", d.groundMm ?? "", this.tools.lastThickness,
      JSON.stringify(d.project ?? null), d.northDeg ?? "",
      this.store.floor.underlay ? "u1" : "u0", this.tools.calibrating ? "c1" : "c0",
      // The Plan section's per-discipline toggles only show once the floor
      // has routes, so a route being added or removed has to rebuild it too.
      routesOf(this.store.floor).length,
      selSig].join("|");

    if (paneSig !== this.lastPaneSig) {
      this.lastPaneSig = paneSig;
      // replaceWith rather than a parent's replaceChild: the storey row sits in
      // the pane in the wide layout and in the top bar in the compact one, and
      // the plan section moves with the sheet.
      const storey = this.buildStoreyRow();
      this.storeyEl.replaceWith(storey);
      this.storeyEl = storey;
      const plan = this.buildPlanSection();
      this.planEl.replaceWith(plan);
      this.planEl = plan;
      const underlay = this.buildUnderlaySection();
      this.underlayEl.replaceWith(underlay);
      this.underlayEl = underlay;
      const permit = this.buildPermitSection();
      this.permitEl.replaceWith(permit);
      this.permitEl = permit;
    }
    // The checklist reads derived geometry (rooms, chains), which changes on
    // edits the pane signature does not see — so it refreshes in place.
    this.syncPermitChecks();

    const swap = selSig !== this.lastSelSig;
    this.lastSelSig = selSig;
    this.paneBody.hidden = !sel && !stairMode && !structureMode && !routeMode && !paneTool && !floorsMode;
    if (sel || stairMode || structureMode || routeMode || paneTool || floorsMode) {
      this.paneBody.className = "pane-body" + (swap ? " pane-swap" : "");
      this.renderProps(this.props);
    }
    for (const pal of [this.servicePalette, this.fitoutPalette]) {
      pal.syncActive();
      pal.syncInk();
    }
    // A palette shows only where its own marks can be placed, so the pane
    // carries one drawing at a time rather than the whole library.
    this.servicePalette.el.hidden = !servicesMode;
    this.fitoutPalette.el.hidden = !fitoutMode;
    if (this.tools.tool === "route") {
      this.servicePalette.openCategory(DISCIPLINE_CATEGORY[this.tools.routeDiscipline]);
    }
    if (this.mode === "compact") { this.pinDangerRow(); this.renderTyping(); }
  }

  /**
   * The delete button leaves the scrolling property list and pins above the
   * tool bar. A window with sashes runs past a dozen rows, which on a phone put
   * Verwijderen a scroll away from the thing it deletes — and directly under a
   * thumb that was reaching for the tool bar.
   */
  private pinDangerRow(): void {
    const sheet = this.sheet;
    if (!sheet) return;
    const slot = this.actionsEl ?? (this.actionsEl = el("div", "wg-actions"));
    const btn = this.props.querySelector<HTMLElement>(".btn-danger");
    if (!btn) { slot.remove(); return; }
    slot.replaceChildren(btn);
    if (slot.parentElement !== sheet.foot) sheet.foot.prepend(slot);
  }

  /**
   * The millimetre keypad and the chain's Klaar button, which exist only in the
   * compact layout: both stand in for keys a phone does not have. The keypad
   * goes above the property list so it is the first thing in reach, and the
   * sheet is raised far enough to show it.
   */
  private renderTyping(): void {
    const sheet = this.sheet;
    if (!sheet) return;

    // The bar over the sheet while a wall is being drawn: a way to close the
    // ring, and a way to stop -- both keys on a keyboard, neither of them on a
    // phone. It is rebuilt rather than patched, since which buttons belong on it
    // changes as the chain grows.
    const barSig = this.tools.shaping ? "shape"
      : this.tools.chaining ? (this.tools.canCloseChain ? "chain-close" : "chain")
      : "";
    if (barSig !== this.chainBarSig) {
      this.chainBarSig = barSig;
      this.chainBar?.remove();
      this.chainBar = null;
      if (barSig) {
        const bar = el("div", "wg-chain");
        const label = el("span", "sec-label");
        label.textContent = t(this.tools.tool === "route" ? "panel.route" : "panel.wall");
        bar.append(label, el("div", "sec-rule"));
        if (this.tools.canCloseChain) {
          const close = el("button", "wg-done") as HTMLButtonElement;
          close.type = "button";
          close.textContent = t("panel.chainClose");
          close.title = t("panel.chainCloseTitle");
          close.onclick = () => this.tools.closeChain();
          bar.append(close);
        }
        const done = el("button", "wg-done") as HTMLButtonElement;
        done.type = "button";
        done.textContent = this.tools.shaping ? t("panel.shapeCancel") : t("panel.chainDone");
        done.title = this.tools.shaping ? t("panel.shapeCancelTitle") : t("panel.chainDoneTitle");
        done.onclick = () => this.tools.endChain();
        bar.append(done);
        sheet.body.prepend(bar);
        this.chainBar = bar;
      }
    }

    // The compact layout's "Done (n)" pill: the wide layout gets its Done
    // button beside the selection count header instead (see secHead's `mode`
    // option), but that header can scroll out of view under a peeking sheet
    // -- so it is pinned here too, same precedent as chainBar above.
    //
    // From the FIRST object, not the second: a hold on an object with nothing
    // selected enters the mode at n=1, and gating on a group left that state
    // with no affordance at all -- the mode was on, taps toggled instead of
    // replacing, and the only thing that said so was the hint line.
    const n = this.store.selMore.length + 1;
    const modeSig = this.tools.selectMode && this.store.sel ? String(n) : "";
    if (modeSig !== this.modeBarSig) {
      this.modeBarSig = modeSig;
      this.modeBar?.remove();
      this.modeBar = null;
      if (modeSig) {
        const bar = el("div", "wg-chain");
        const label = el("span", "sec-label");
        label.textContent = String(n);
        bar.append(label, el("div", "sec-rule"));
        const done = el("button", "wg-done") as HTMLButtonElement;
        done.type = "button";
        done.textContent = t("panel.selectModeDone", { n });
        done.onclick = () => this.tools.exitSelectMode();
        bar.append(done);
        sheet.body.prepend(bar);
        this.modeBar = bar;
      }
    }

    if (this.tools.typingLength && !this.keypadEl) {
      const wrap = el("div", "wg-keypad");
      const read = el("div", "wg-typed");
      read.append(
        Object.assign(el("span"), { textContent: t("panel.length") }),
        Object.assign(el("b", "wg-typed-value"), { textContent: this.tools.lengthBuffer || "0" }),
      );
      wrap.append(read, buildKeypad(this.tools, () => this.refreshToolbar()));
      if (this.chainBar) this.chainBar.after(wrap); else sheet.body.prepend(wrap);
      this.keypadEl = wrap;
      sheet.atLeast("half");
    } else if (!this.tools.typingLength && this.keypadEl) {
      this.keypadEl.remove();
      this.keypadEl = null;
    } else if (this.keypadEl) {
      const value = this.keypadEl.querySelector(".wg-typed-value");
      if (value) value.textContent = this.tools.lengthBuffer || "0";
    }
  }

  /** Open or close the storey-management pane in the context area. Opening
   *  clears whatever held the pane — it shows one context at a time — and has
   *  to clear it BEFORE raising the flag: select() and setTool() each refresh
   *  the pane, and renderPane closes an open storey pane the moment a
   *  selection or an armed tool pane still claims the context area. */
  private toggleFloorsPane(): void {
    if (!this.floorsOpen) {
      this.store.select(null);
      this.tools.exitSelectMode();
      this.tools.setTool("select");
      this.floorsOpen = true;
      this.sheet?.atLeast("half");
    } else this.floorsOpen = false;
    this.refreshToolbar();
  }

  /**
   * Storey management: one row per floor, top-down like the picker, each with
   * a drag grip (reorder; a plain click shows that storey), an editable name,
   * duplicate and delete. The picker's + button and the add row here do the
   * same thing.
   */
  private renderFloorsPane(p: HTMLElement): void {
    const floors = this.store.doc.floors;
    const head = el("div", "sec");
    head.append(Object.assign(el("span", "sec-label"), { textContent: t("panel.floors") }), el("div", "sec-rule"));
    const close = el("button", "sec-close") as HTMLButtonElement;
    close.type = "button";
    close.title = t("panel.close");
    close.setAttribute("aria-label", t("panel.close"));
    close.append(icon("close", 14));
    close.onclick = () => { this.floorsOpen = false; this.refreshToolbar(); };
    head.append(close);
    p.append(head);

    const list = el("div", "floor-list");
    for (const [i, fl] of floors.map((fl, i) => [i, fl] as const).reverse()) {
      list.append(this.buildFloorRow(i, fl, floors.length));
    }
    p.append(list);

    const { btnRow, noteRow } = this.rowKit(p);
    btnRow(t("panel.floorAdd"), () => {
      this.store.addFloor(t("panel.floorNewName", { n: floors.length + 1 }));
    });
    if (this.store.floorBelow) noteRow(t("panel.floorGhost"));
    noteRow(t("panel.floorListNote"));
  }

  private buildFloorRow(i: number, fl: Floor, count: number): HTMLElement {
    const row = el("div", "floor-row");
    if (i === this.store.activeFloor) row.classList.add("is-active");
    row.dataset.index = String(i);

    const grip = el("button", "floor-grip") as HTMLButtonElement;
    grip.type = "button";
    grip.title = t("panel.floorDrag");
    grip.setAttribute("aria-label", t("panel.floorDrag"));
    grip.append(icon("grip", 14));
    this.wireFloorDrag(grip, row);

    // Committing on change (blur/Enter), like every textRow: a per-keystroke
    // mutation would rebuild the pane and pull focus out of the field.
    const name = el("input", "floor-name") as HTMLInputElement;
    name.type = "text";
    name.value = fl.name;
    name.setAttribute("aria-label", t("panel.floorRename"));
    name.onchange = () => {
      const n = name.value.trim();
      if (n) this.store.renameFloor(n, i); else name.value = fl.name;
    };
    name.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } };

    const smallBtn = (cls: string, iconName: IconName, label: string, fn: () => void): HTMLButtonElement => {
      const b = el("button", cls) as HTMLButtonElement;
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.append(icon(iconName, 14));
      b.onclick = fn;
      return b;
    };
    const dup = smallBtn("floor-act", "docCopy", t("panel.floorDuplicate"), () => {
      this.store.duplicateFloor(t("panel.floorNewName", { n: count + 1 }), i);
    });
    const del = smallBtn("floor-act floor-del", "trash", t("panel.floorDelete"), () => {
      this.store.deleteFloor(i);
    });
    // Disabled rather than hidden, so the last row keeps its shape.
    del.disabled = count <= 1;

    row.append(grip, name, dup, del);
    return row;
  }

  /**
   * Reorder by dragging the grip. Pointer events rather than HTML drag-and-
   * drop, which never fires on touch. The dragged row is re-slotted live among
   * its siblings while the pointer moves; the document is only touched once,
   * on release — one mutation, one undo step. A press that never travels past
   * the slop is a click, and shows that storey.
   */
  private wireFloorDrag(grip: HTMLElement, row: HTMLElement): void {
    grip.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this.store.setActiveFloor(Number(row.dataset.index));
    });
    grip.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const list = row.parentElement;
      if (!list) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      let dragging = false;

      const move = (ev: PointerEvent): void => {
        if (!dragging && Math.abs(ev.clientY - startY) < 4) return;
        dragging = true;
        row.classList.add("is-dragging");
        // Place directly at the pointer's target slot. Pointer events may jump
        // across several rows, especially on touch or a loaded main thread.
        const siblings = (Array.from(list.children) as HTMLElement[]).filter(sib => sib !== row);
        const before = siblings.find(sib => {
          const r = sib.getBoundingClientRect();
          return ev.clientY < r.top + r.height / 2;
        });
        if (before) list.insertBefore(row, before); else list.append(row);
      };
      const finish = (commit: boolean): void => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", cancel);
        row.classList.remove("is-dragging");
        const from = Number(row.dataset.index);
        if (!dragging) { if (commit) this.store.setActiveFloor(from); return; }
        // The list reads top-down: DOM position 0 is the highest storey.
        const pos = Array.from(list.children).indexOf(row);
        const to = list.children.length - 1 - pos;
        if (commit && to !== from) this.store.moveFloor(from, to);
        // A cancelled or unmoved drag leaves the DOM shuffled; the rebuild
        // puts the rows back in the stack's order.
        else this.refreshToolbar();
      };
      const up = (): void => finish(true);
      const cancel = (): void => finish(false);
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", cancel);
    });
  }

  /** Sash editor. An opening is one hole; the sashes divide it. */
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
  /**
   * Properties of the selected opening.
   *
   * Width leads with the standard dagmaten beside the typed field, and a door's
   * fire rating sits next to the self-closing flag it implies rather than three
   * unrelated checkboxes away — a brandwerende deur is one decision, not four.
   */
  private renderOpeningProps(sel: Selection, rows: PaneRows): void {
    const f = this.store.floor;
    let wall = sel.wallId ? f.walls.find(x => x.id === sel.wallId) : undefined;
    if (!wall) wall = f.walls.find(x => x.openings.some(o => o.id === sel.id));
    const o = wall?.openings.find(x => x.id === sel.id);
    if (!wall || !o) return;
    const wid = wall.id;
    const mutOpening = (fn: (o2: Opening, fl2: Floor, w2: Wall) => void): void => {
      this.store.mutate(d => {
        const fl = this.store.floorOf(d);
        const w2 = fl.walls.find(x => x.id === wid);
        const o2 = w2?.openings.find(x => x.id === sel.id);
        if (w2 && o2) { fn(o2, fl, w2); clampOpening(fl, w2, o2); }
      });
    };
    const setWidth = (n: number): void => mutOpening(o2 => { o2.width = Math.max(50, Math.round(n)); });

    rows.secHead(o.kind === "door" ? t("panel.door")
      : o.kind === "window" ? t("panel.window") : t("panel.passage"), { sel: true });
    rows.numRow(t("panel.width"), o.width, setWidth);
    rows.chipRow(t("panel.width"), widthsFor(o.kind), o.width, setWidth);
    if (o.kind === "door") {
      rows.chipRow(t("panel.widthDouble"), DOOR_WIDTHS_DOUBLE, o.width, setWidth);
    }
    rows.numRow(t("panel.fromCorner"), o.t - o.width / 2,
      n => mutOpening(o2 => { o2.t = n + o2.width / 2; }));

    // Vertical placement. Only a window has a sill worth stating; a door or
    // passage reaches the floor.
    if (o.kind === "window") {
      rows.numRow(t("panel.sillHeight"), openingSill(o),
        n => mutOpening(o2 => { o2.sillHeight = Math.max(0, Math.round(n)); }), 50);
    }
    rows.numRow(t("panel.openingHeight"), openingHeight(o),
      n => mutOpening(o2 => { o2.height = Math.max(100, Math.round(n)); }), 50);

    if (o.kind === "door") this.renderLeaves(o, mutOpening, rows.selRow, rows.numRow, rows.noteRow);
    if (o.kind === "window") {
      this.renderSashes(o, wall, mutOpening, rows.selRow, rows.numRow, rows.btnRow, rows.noteRow);
    }

    if (o.kind !== "passage") {
      rows.checkRow(t("panel.glazed"), o.glazed ?? false,
        b => mutOpening(o2 => { o2.glazed = b || undefined; }));
      rows.checkRow(t("panel.powered"), o.powered ?? false,
        b => mutOpening(o2 => { o2.powered = b || undefined; }));
      rows.selRow(t("panel.fireRating"), o.fireRating?.kind ?? "",
        [["", t("panel.fireNone")],
          ...FIRE_KINDS.map(k => [k, t("panel.fire_" + k)] as [string, string])],
        value => mutOpening(o2 => {
          o2.fireRating = value
            ? { kind: value as FireKind, minutes: o2.fireRating?.minutes ?? FIRE_MINUTES_DEFAULT }
            : undefined;
          // A fire door is self-closing by definition; clearing the rating
          // leaves the flag alone, since a door can close itself for other
          // reasons.
          if (value) o2.selfClosing = true;
        }));
      if (o.fireRating) {
        rows.noteRow(t("panel.fireHelp"));
        rows.chipRow(t("panel.fireMinutes"), FIRE_MINUTES, o.fireRating.minutes,
          n => mutOpening(o2 => { if (o2.fireRating) o2.fireRating.minutes = n; }));
        rows.numRow(t("panel.fireMinutes"), o.fireRating.minutes,
          n => mutOpening(o2 => {
            if (o2.fireRating) o2.fireRating.minutes = Math.max(0, Math.round(n));
          }), 15);
      }
      rows.checkRow(t("panel.selfClosing"), o.selfClosing ?? false,
        b => mutOpening(o2 => { o2.selfClosing = b || undefined; }));
    }
    rows.dangerRow(t("panel.deleteOpening"), () => this.tools.deleteSelected());
  }

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
      this.replaceDocument(doc);
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
      input.type = "number"; input.step = String(step);
      // Mixed: a bulk pane's field where the selected objects disagree. Left
      // blank with a placeholder rather than showing one member's value as if
      // it applied to all -- typing (or scrubbing) still commits to every
      // member, same as an ordinary field.
      if (extra.mixed) input.placeholder = "—"; else input.value = String(Math.round(value));
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
    const selRow = (
      label: string, value: string, options: Array<[string, string]>, onCommit: (s: string) => void,
      opts: { mixed?: boolean } = {},
    ): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const sl = el("select") as HTMLSelectElement;
      // Mixed: a leading "—" option that commits nothing, selected until the
      // visitor actually picks one of the real options -- picking the mixed
      // marker back is not offered, since there is no value it would mean.
      if (opts.mixed) {
        const o = el("option") as HTMLOptionElement;
        o.value = MIXED_SENTINEL; o.textContent = "—"; o.selected = true;
        sl.append(o);
      }
      for (const [val, lab] of options) {
        const o = el("option") as HTMLOptionElement;
        o.value = val; o.textContent = lab; if (!opts.mixed && val === value) o.selected = true;
        sl.append(o);
      }
      sl.onchange = () => { if (sl.value !== MIXED_SENTINEL) onCommit(sl.value); };
      row.append(sl);
      p.append(row);
    };
    // `allowEmpty` is for fields where clearing means "unset" (the title-block
    // fields); elsewhere an emptied field keeps its old value, since a floor
    // with no name at all has nothing to show in the storey picker.
    const textRow = (
      label: string, value: string, onCommit: (s: string) => void,
      opts: { allowEmpty?: boolean; mixed?: boolean } = {},
    ): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const input = el("input") as HTMLInputElement;
      input.type = "text";
      if (opts.mixed) { input.value = ""; input.placeholder = "—"; } else input.value = value;
      input.onchange = () => { const t2 = input.value.trim(); if (t2 || opts.allowEmpty) onCommit(t2); };
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
    const colorRow = (
      label: string, value: string | null, onCommit: (hex: string | null) => void,
      opts: { mixed?: boolean } = {},
    ): void => {
      const row = el("div", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const chips = el("div", "ink-row");
      for (const ink of INKS) {
        const b = el("button", "ink") as HTMLButtonElement;
        b.type = "button";
        const name = t("panel.ink" + ink.id[0]!.toUpperCase() + ink.id.slice(1));
        b.title = name;
        b.setAttribute("aria-label", name);
        // Mixed: no swatch reads as "the" current colour, since there isn't
        // one -- picking any of them still commits it to every member.
        const on = !opts.mixed && ink.hex === value;
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
      if (!opts.mixed && value !== null && !INKS.some(i => i.hex === value)) custom.classList.add("is-on");
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
    /** `key` is shown beside the label and `title` explains the button; neither
     *  is part of the label, which has to read the same without a keyboard. */
    const btnRow = (label: string, fn: () => void, title?: string, key?: string): void => {
      const b = el("button", "tool-btn small wide") as HTMLButtonElement;
      b.onclick = fn;
      if (title) b.title = title;
      if (key) {
        b.classList.add("has-key");
        b.append(Object.assign(el("span"), { textContent: label }), keyTag(key));
      } else b.textContent = label;
      p.append(b);
    };
    /**
     * The standard sizes for a field, as chips over the number row it belongs
     * to. Chips rather than a <select> because the point is that the ordinary
     * value is one click away and visibly one of a short set — a dropdown hides
     * both facts, and a bare number field states no opinion at all.
     */
    const chipRow = <T extends string | number>(
      label: string, values: readonly T[], value: T, onCommit: (v: T) => void,
    ): void => {
      const row = el("div", "chip-row");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", label);
      for (const v of values) {
        const b = el("button", "chip") as HTMLButtonElement;
        b.type = "button";
        b.textContent = String(v);
        // A number chip matches on the rounded value, the way a scrubbed
        // field settles; a string chip (recent groep labels) matches exactly.
        const on = typeof v === "number" ? v === Math.round(value as number) : v === value;
        b.setAttribute("aria-pressed", String(on));
        if (on) b.classList.add("is-on");
        b.onclick = () => onCommit(v);
        row.append(b);
      }
      p.append(row);
    };
    const checkRow = (
      label: string, value: boolean, onCommit: (b: boolean) => void,
      opts: { mixed?: boolean } = {},
    ): void => {
      const row = el("label", "prop-row");
      row.append(Object.assign(el("span"), { textContent: label }));
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox"; cb.checked = value;
      // Mixed: the DOM indeterminate state (a dash rather than a tick/blank),
      // cleared the moment the visitor actually clicks it -- native checkbox
      // behaviour, so nothing here has to reset it by hand.
      if (opts.mixed) cb.indeterminate = true;
      cb.onchange = () => onCommit(cb.checked);
      row.append(cb);
      p.append(row);
    };

    return { numRow, selRow, textRow, noteRow, warnRow, btnRow, colorRow, chipRow, checkRow };
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

    const { numRow, selRow, noteRow, checkRow } = this.rowKit(inner);
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
    // A suspended ceiling under this storey's slab. Set/unset rather than a
    // bare number, like a wall's own height: absent means there is none, not a
    // ceiling at zero. It is a finish and nothing else -- no stair climbs to
    // it, no space is measured by it; it decides only what height a wall FACE
    // is finished to (core/surface.ts). A room finished lower than the rest
    // states its own in the room list.
    checkRow(t("panel.ceilingOn"), this.store.floor.ceilingMm !== undefined, on =>
      this.store.mutate(d => {
        const fl = this.store.floorOf(d);
        // Imported plans may carry a schema-valid storey below the editor's
        // 1000 mm input floor. Never turn one of those into an invalid document
        // by writing a zero or negative default ceiling.
        if (on) fl.ceilingMm = Math.max(1, Math.min(CEILING_DEFAULT_MM, floorHeight(fl) - 100));
        else delete fl.ceilingMm;
      }));
    if (this.store.floor.ceilingMm !== undefined) {
      numRow(t("panel.ceiling"), this.store.floor.ceilingMm, n => this.store.mutate(d => {
        this.store.floorOf(d).ceilingMm = Math.max(100, Math.round(n));
      }), 50, { title: t("panel.ceilingHelp") });
      if (storeyCeiling(this.store.floor) === undefined) noteRow(t("panel.ceilingAboveStorey"));
      else noteRow(t("panel.ceilingHelp"));
    }
    // Ground floor's elevation above project zero (Peil). Plan-wide, not
    // per-floor, so it sits beside the storey height rather than in the
    // storey-management pane.
    numRow(t("panel.groundMm"), this.store.doc.groundMm ?? 0,
      n => this.store.mutate(d => { d.groundMm = Math.round(n); }), 100,
      { title: t("panel.groundMmHelp") });
    numRow(t("panel.newWallThickness"), this.tools.lastThickness, n => { this.tools.lastThickness = Math.max(20, n); }, 10);
    // Editor state like the grid snap rather than part of the document: it
    // decides whether a cabinet or a wall-mounted symbol takes the nearest wall
    // face while it is placed or dragged. Off leaves it wherever it is put.
    checkRow(t("panel.snapWall"), this.tools.snapWall, (on: boolean) => { this.tools.snapWall = on; });
    selRow(t("panel.areaMode"), areaModeOf(this.store.doc),
      [["net", t("panel.areaNet")], ["centerline", t("panel.areaCenterline")],
        ["bvo", t("panel.areaBvo")]],
      m => this.store.mutate(d => { d.areaMode = m as AreaMode; }));
    if (areaModeOf(this.store.doc) === "net") noteRow(t("panel.areaNote"));
    // Which convention the dimension lines use, separately from the areas: the
    // structure is set out hart-op-hart and interior work from the dagmaat, and
    // a sheet can carry both. Only "L" decides whether they are drawn at all.
    selRow(t("panel.dimMode"), dimModeOf(this.store.doc),
      [["centerline", t("panel.dimCenterline")], ["clear", t("panel.dimClear")],
       ["both", t("panel.dimBoth")]],
      m => this.store.mutate(d => { d.dimMode = m as DimMode; }));
    if (dimModeOf(this.store.doc) !== "centerline") noteRow(t("panel.dimNote"));
    // Whether the plan writes each device's mounting height beside it. Stored
    // on the document rather than held as editor state, so the SVG, DXF and
    // PNG carry the same annotation the screen does -- see mountMarksOn().
    checkRow(t("panel.showHeights"), mountMarksOn(this.store.doc), on =>
      this.store.mutate(d => { if (on) d.mountMarks = true; else delete d.mountMarks; }));
    // Editor state rather than a document convention: a pulse is something to
    // notice while working and means nothing on paper, so it never reaches an
    // export. See Tools.requireComplete.
    checkRow(t("panel.requireComplete"), this.tools.requireComplete,
      on => this.tools.setRequireComplete(on));
    if (this.tools.requireComplete) {
      const gaps = incompleteDevices(this.store.floor);
      noteRow(gaps.size > 0
        ? t("panel.requireCompleteOpen", { n: gaps.size })
        : t("panel.requireCompleteDone"));
    }

    // Per-layer visibility, and only for the layers this storey actually
    // carries: an empty floor showing seven toggles for drawings it does not
    // have would be furniture nobody can use yet. The armed tool already fades
    // what it cannot touch (Tools.dimLayers); these switch a layer off outright,
    // which is what a sheet per trade needs.
    const present = layersPresent(this.store.floor);
    if (present.length > 0) {
      noteRow(t("panel.layers"));
      for (const key of present) {
        checkRow(t("panel.layer" + key[0]!.toUpperCase() + key.slice(1)), this.tools.layers[key], on => {
          this.tools.layers[key] = on;
          this.tools.refresh();
        });
      }
    }

    wrap.append(head, body);
    return wrap;
  }

  /**
   * The trace-over image: load it, calibrate its scale, and control how it
   * shows while drawing. Its own section under Plan, with the same fold
   * behaviour -- present in both layouts, rebuilt (not patched) on the plan
   * pane's signature the way buildPlanSection/buildPermitSection are. Only
   * the load/paste affordances show until an underlay actually exists.
   */
  private buildUnderlaySection(): HTMLElement {
    const open = this.underlayOpen;
    const wrap = el("div", "plan-sec");
    const head = el("button", "plan-head") as HTMLButtonElement;
    head.type = "button";
    head.setAttribute("aria-expanded", String(open));
    const chev = el("span", "chev");
    chev.append(icon("chevron", 14));
    head.append(chev, Object.assign(el("span", "sec-label"), { textContent: t("panel.underlay") }));
    const body = el("div", "plan-body" + (open ? " is-open" : ""));
    const inner = el("div", "plan-rows");
    body.append(inner);
    head.onclick = () => {
      const next = !body.classList.contains("is-open");
      this.underlayOpen = next;
      body.classList.toggle("is-open", next);
      head.setAttribute("aria-expanded", String(next));
    };

    const { numRow, btnRow, noteRow, checkRow } = this.rowKit(inner);
    const underlay = this.store.floor.underlay;

    btnRow(t("panel.underlayLoad"), () => pickUnderlayImage(file => { void this.loadUnderlayFile(file); }));
    noteRow(t("panel.underlayPasteHint"));

    if (underlay) {
      if (this.tools.calibrating) {
        btnRow(t("panel.underlayCalibrateCancel"), () => this.tools.cancelCalibration());
        noteRow(t("panel.underlayCalibrateNote"));
      } else {
        btnRow(t("panel.underlayCalibrate"), () => this.tools.startCalibration());
      }
      numRow(t("panel.underlayOpacity"), Math.round(underlay.opacity * 100), n =>
        this.store.mutate(d => {
          const u = this.store.floorOf(d).underlay;
          if (u) u.opacity = Math.max(0, Math.min(100, Math.round(n))) / 100;
        }), 5);
      checkRow(t("panel.underlayShow"), this.tools.showUnderlay, on => {
        this.tools.showUnderlay = on;
        this.tools.refresh();
      });
      btnRow(t("panel.underlayRemove"), () => {
        this.tools.cancelCalibration();
        this.store.mutate(d => { delete this.store.floorOf(d).underlay; });
      });
    }

    wrap.append(head, body);
    return wrap;
  }

  /** Downscale, place and store a freshly picked or pasted underlay image. */
  private async loadUnderlayFile(file: File): Promise<void> {
    const prepared = await prepareUnderlayImage(file);
    if (!prepared) { this.flash(t("status.underlayFailed")); return; }
    const center = this.tools.viewportCenterWorld();
    const underlay = initialUnderlay(prepared.dataUrl, prepared.width, prepared.height, center);
    this.store.mutate(d => { this.store.floorOf(d).underlay = underlay; });
    this.refreshToolbar();
  }

  /**
   * The permit sheet: title-block fields, the north direction, a content
   * checklist and the export. Its own section under Plan, with the same fold
   * behaviour, because it is plan-wide state rather than a selection's.
   */
  private buildPermitSection(): HTMLElement {
    const open = this.permitOpen;
    const wrap = el("div", "plan-sec");
    const head = el("button", "plan-head") as HTMLButtonElement;
    head.type = "button";
    head.setAttribute("aria-expanded", String(open));
    const chev = el("span", "chev");
    chev.append(icon("chevron", 14));
    head.append(chev, Object.assign(el("span", "sec-label"), { textContent: t("panel.permit") }));
    const body = el("div", "plan-body" + (open ? " is-open" : ""));
    const inner = el("div", "plan-rows");
    body.append(inner);
    head.onclick = () => {
      const next = !body.classList.contains("is-open");
      this.permitOpen = next;
      body.classList.toggle("is-open", next);
      head.setAttribute("aria-expanded", String(next));
      this.syncPermitChecks();
    };

    const { numRow, textRow, noteRow, btnRow, checkRow } = this.rowKit(inner);
    const meta = projectOf(this.store.doc);
    const setMeta = (key: keyof ProjectMeta) => (value: string): void =>
      this.store.mutate(d => {
        const p = d.project ?? (d.project = {});
        if (value === "") delete p[key]; else p[key] = value;
        if (Object.keys(p).length === 0) delete d.project;
      });
    textRow(t("panel.permitProject"), meta.name ?? "", setMeta("name"), { allowEmpty: true });
    textRow(t("panel.permitAddress"), meta.address ?? "", setMeta("address"), { allowEmpty: true });
    textRow(t("panel.permitAuthor"), meta.author ?? "", setMeta("author"), { allowEmpty: true });
    textRow(t("panel.permitNumber"), meta.number ?? "", setMeta("number"), { allowEmpty: true });
    textRow(t("panel.permitDate"), meta.date ?? "", setMeta("date"), { allowEmpty: true });
    noteRow(t("panel.permitDateHelp"));
    // Set/unset rather than a bare number: an absent direction draws no arrow,
    // because a guessed north would be a false statement on the sheet.
    checkRow(t("panel.permitNorth"), this.store.doc.northDeg !== undefined, on =>
      this.store.mutate(d => { if (on) d.northDeg = d.northDeg ?? 0; else delete d.northDeg; }));
    if (this.store.doc.northDeg !== undefined) {
      numRow(t("panel.permitNorthDeg"), this.store.doc.northDeg, deg =>
        this.store.mutate(d => { d.northDeg = ((Math.round(deg) % 360) + 360) % 360; }), 5);
    }
    this.permitChecksEl = el("div");
    inner.append(this.permitChecksEl);
    noteRow(t("panel.permitNote"));
    btnRow(t("panel.permitExport"), () => { void this.savePermit("pdf"); });
    btnRow(t("panel.permitExportSvg"), () => { void this.savePermit("svg"); });

    wrap.append(head, body);
    this.syncPermitChecks();
    return wrap;
  }

  /**
   * The checklist reads derived geometry, so it cannot wait for the pane
   * signature; it refreshes in place, and only while the section is open.
   */
  private syncPermitChecks(): void {
    const box = this.permitChecksEl;
    if (!box || !this.permitOpen) return;
    if (this.store.revision !== this.permitCacheRev) {
      this.permitCacheRev = this.store.revision;
      this.permitCacheItems = permitChecklist(this.store.doc, this.store.activeFloor);
    }
    const items = this.permitCacheItems;
    const sig = items.map(i => `${i.id}:${i.ok}`).join("|");
    if (sig === box.dataset.sig) return;
    box.dataset.sig = sig;
    box.replaceChildren();
    for (const it of items) {
      const row = el("div", "prop-note" + (it.ok ? "" : " is-warn"));
      row.textContent = `${it.ok ? "✓" : "○"} ${t("check." + it.id)}`;
      box.append(row);
    }
  }

  /**
   * Properties of every selected wall at once: thickness, own-height,
   * load-bearing and fire rating -- the fields a bulk edit is actually
   * reached for ("make this whole run 200mm", "mark it load-bearing").
   * Length and the bow handle stay single-wall only; there is no group
   * reading of "the length" of several different walls.
   */
  private renderWallBulk(rows: PaneRows, group: readonly Id[]): void {
    const f = this.store.floor;
    const walls = f.walls.filter(w => group.includes(w.id));
    const first = walls[0];
    if (!first) return;
    rows.secHead(t("panel.selectionHeader", { n: walls.length, label: t("panel.wall") }), { sel: true, mode: true });
    const mutAll = (fn: (w: Wall) => void): void => {
      this.store.mutate(d => {
        for (const w of this.store.floorOf(d).walls) if (group.includes(w.id)) fn(w);
      });
    };
    const thickMixed = isMixed(walls, w => w.thickness);
    rows.numRow(t("panel.thickness"), first.thickness, n => {
      this.tools.lastThickness = Math.max(20, n);
      mutAll(w => { w.thickness = Math.max(20, n); });
    }, 10, { mixed: thickMixed });

    const ownHeightMixed = isMixed(walls, w => w.height !== undefined);
    rows.checkRow(t("panel.wallOwnHeight"), first.height !== undefined, on => mutAll(w => {
      if (on) w.height = floorHeight(f); else delete w.height;
    }), { mixed: ownHeightMixed });
    if (!ownHeightMixed && first.height !== undefined) {
      const heightMixed = isMixed(walls, w => wallHeight(f, w));
      rows.numRow(t("panel.wallHeight"), wallHeight(f, first), n => mutAll(w => {
        w.height = Math.max(100, Math.round(n));
      }), 50, { mixed: heightMixed });
    }
    const lbMixed = isMixed(walls, w => w.loadBearing);
    rows.selRow(t("panel.loadBearing"), first.loadBearing === undefined ? "" : first.loadBearing ? "yes" : "no",
      [["", t("panel.loadBearingUnknown")], ["yes", t("panel.loadBearingYes")], ["no", t("panel.loadBearingNo")]],
      v => mutAll(w => { w.loadBearing = v === "" ? undefined : v === "yes"; }), { mixed: lbMixed });
    const fkMixed = isMixed(walls, w => w.fireRating?.kind ?? "");
    rows.selRow(t("panel.fireRating"), first.fireRating?.kind ?? "",
      [["", t("panel.fireNone")], ...FIRE_KINDS.map(k => [k, t("panel.fire_" + k)] as [string, string])],
      value => mutAll(w => {
        w.fireRating = value
          ? { kind: value as FireKind, minutes: w.fireRating?.minutes ?? FIRE_MINUTES_DEFAULT }
          : undefined;
      }), { mixed: fkMixed });
    if (walls.some(w => w.fireRating)) {
      rows.noteRow(t("panel.fireHelp"));
      const withRating = walls.find(w => w.fireRating)!;
      rows.chipRow(t("panel.fireMinutes"), FIRE_MINUTES, withRating.fireRating!.minutes,
        n => mutAll(w => { if (w.fireRating) w.fireRating.minutes = n; }));
    }
    const matMixed = isMixed(walls, w => w.material ?? "");
    rows.selRow(t("panel.material"), first.material ?? "",
      [["", t("panel.materialUnknown")],
        ...WALL_MATERIALS.map(m => [m, t("panel.material_" + m)] as [string, string])],
      value => mutAll(w => {
        if (value) w.material = value as WallMaterial; else delete w.material;
      }), { mixed: matMixed });
    const postsMixed = isMixed(walls, w => w.postMm !== undefined);
    rows.checkRow(t("panel.postsOn"), first.postMm !== undefined, on => mutAll(w => {
      if (on) w.postMm = POST_DEFAULT_MM;
      else { delete w.postMm; delete w.postWidthMm; }
    }), { mixed: postsMixed });
    if (!postsMixed && first.postMm !== undefined) {
      rows.numRow(t("panel.posts"), first.postMm, n => mutAll(w => {
        w.postMm = Math.max(100, Math.round(n));
      }), 100, { mixed: isMixed(walls, w => w.postMm) });
      const widthMixed = isMixed(walls, w => w.postWidthMm !== undefined);
      rows.checkRow(t("panel.postWidthOn"), first.postWidthMm !== undefined, on => mutAll(w => {
        if (on) w.postWidthMm = POST_WIDTH_DEFAULT; else delete w.postWidthMm;
      }), { mixed: widthMixed });
      if (!widthMixed && first.postWidthMm !== undefined) {
        rows.numRow(t("panel.postWidth"), first.postWidthMm, n => mutAll(w => {
          w.postWidthMm = Math.max(10, Math.round(n));
        }), 10, { mixed: isMixed(walls, w => w.postWidthMm) });
      }
      rows.noteRow(t("panel.postsHelp"));
    }
    const facadeMixed = isMixed(walls, w => w.facadeMm !== undefined);
    rows.checkRow(t("panel.facadeOn"), first.facadeMm !== undefined, on => mutAll(w => {
      if (on) w.facadeMm = FACADE_DEFAULT_MM;
      else { delete w.facadeMm; delete w.facadeSide; }
    }), { mixed: facadeMixed });
    if (!facadeMixed && first.facadeMm !== undefined) {
      rows.numRow(t("panel.facade"), first.facadeMm, n => mutAll(w => {
        w.facadeMm = Math.max(10, Math.round(n));
      }), 10, { mixed: isMixed(walls, w => w.facadeMm) });
      rows.selRow(t("panel.facadeSide"), facadeSideOf(first),
        [["left", t("panel.facadeLeft")], ["right", t("panel.facadeRight")]],
        v => mutAll(w => { w.facadeSide = v === "right" ? "right" : "left"; }),
        { mixed: isMixed(walls, w => facadeSideOf(w)) });
      rows.noteRow(t("panel.facadeHelp"));
    }
    const colorMixed = isMixed(walls, w => w.color ?? "");
    rows.colorRow(t("panel.color"), first.color ?? null, hex => {
      this.tools.wallColor = hex;
      this.store.mutate(d => {
        for (const w of this.store.floorOf(d).walls) {
          if (!group.includes(w.id)) continue;
          if (hex) w.color = hex; else delete w.color;
        }
      }, "wallcolor:" + group.join(","));
    }, { mixed: colorMixed });
    this.renderWallJoin(rows, group);
    rows.dangerRow(t("panel.deleteWall"), () => this.tools.deleteSelected());
  }

  /**
   * What two selected walls can be made into, the way the route pane offers to
   * merge two runs. Two cases, and which one applies is decided by the drawing
   * rather than by the reader: walls that already meet are MERGED into one, and
   * walls that stop short of each other are JOINED at a corner.
   *
   * Merging is offered here and not only on the node between them, because two
   * collinear sections are two things on the screen -- selecting both and
   * looking for "merge" is where the drawer arrives, and finding a note saying
   * they already share a node is a dead end rather than an answer.
   *
   * Where neither can be done the pane SAYS which condition failed rather than
   * hiding the button: "the walls do not reach each other" is something the
   * drawing can be corrected for, a missing button is not.
   */
  private renderWallJoin(rows: PaneRows, group: readonly Id[]): void {
    const reason = (prefix: string, key: string): void =>
      rows.noteRow(t(prefix + key[0]!.toUpperCase() + key.slice(1)));

    const merge = planWallMerge(this.store.floor, group);
    if (merge) {
      if (!isDissolvePlan(merge)) { reason("panel.nodeDissolve", merge.reason); return; }
      rows.btnRow(t("panel.wallMerge"), () => {
        this.store.mutate(d => { applyNodeDissolve(this.store.floorOf(d), merge); });
        this.store.select({ kind: "wall", id: merge.keepId });
      }, t("panel.wallMergeTitle"));
      return;
    }

    const plan = planWallJoin(this.store.floor, group);
    if (!plan) return;
    if (!isJoinPlan(plan)) { reason("panel.wallJoin", plan.reason); return; }
    // Parallel walls have no crossing to extend to, so their ends are welded at
    // the midpoint instead -- a different edit, and named as one.
    const weld = plan.parallel;
    rows.btnRow(t(weld ? "panel.wallJoinWeld" : "panel.wallJoin"), () => {
      this.store.mutate(d => { applyWallJoin(this.store.floorOf(d), plan); });
      this.store.select(null);
    }, t(weld ? "panel.wallJoinWeldTitle" : "panel.wallJoinTitle"));
  }

  /**
   * Properties of every selected opening at once: width, fire rating and
   * self-closing. The primary opening's kind (door/window/passage) picks the
   * width chip ladder shown -- a group is same-kind ("opening") but can in
   * principle mix door/window/passage, the same simplification renderRouteBulk
   * (route.ts) documents for discipline.
   */
  private renderOpeningBulk(rows: PaneRows, group: readonly Id[]): void {
    const f = this.store.floor;
    const hits: Opening[] = [];
    for (const w of f.walls) for (const o of w.openings) if (group.includes(o.id)) hits.push(o);
    const primary = hits[0];
    if (!primary) return;
    rows.secHead(t("panel.selectionHeader", {
      n: hits.length,
      label: primary.kind === "door" ? t("panel.door") : primary.kind === "window" ? t("panel.window") : t("panel.passage"),
    }), { sel: true, mode: true });

    const mutAll = (fn: (o2: Opening) => void): void => {
      this.store.mutate(d => {
        const fl = this.store.floorOf(d);
        for (const w of fl.walls) for (const o2 of w.openings) {
          if (group.includes(o2.id)) { fn(o2); clampOpening(fl, w, o2); }
        }
      });
    };
    const setWidth = (n: number): void => mutAll(o2 => { o2.width = Math.max(50, Math.round(n)); });
    const widthMixed = isMixed(hits, o => o.width);
    rows.numRow(t("panel.width"), primary.width, setWidth, 10, { mixed: widthMixed });
    rows.chipRow(t("panel.width"), widthsFor(primary.kind), primary.width, setWidth);

    const fkMixed = isMixed(hits, o => o.fireRating?.kind ?? "");
    rows.selRow(t("panel.fireRating"), primary.fireRating?.kind ?? "",
      [["", t("panel.fireNone")], ...FIRE_KINDS.map(k => [k, t("panel.fire_" + k)] as [string, string])],
      value => mutAll(o2 => {
        o2.fireRating = value
          ? { kind: value as FireKind, minutes: o2.fireRating?.minutes ?? FIRE_MINUTES_DEFAULT }
          : undefined;
        if (value) o2.selfClosing = true;
      }), { mixed: fkMixed });
    if (hits.some(o => o.fireRating)) {
      rows.noteRow(t("panel.fireHelp"));
      const withRating = hits.find(o => o.fireRating)!;
      rows.chipRow(t("panel.fireMinutes"), FIRE_MINUTES, withRating.fireRating!.minutes,
        n => mutAll(o2 => { if (o2.fireRating) o2.fireRating.minutes = n; }));
    }
    const scMixed = isMixed(hits, o => o.selfClosing ?? false);
    rows.checkRow(t("panel.selfClosing"), primary.selfClosing ?? false,
      b => mutAll(o2 => { o2.selfClosing = b || undefined; }), { mixed: scMixed });
    rows.dangerRow(t("panel.deleteOpening"), () => this.tools.deleteSelected());
  }

  /** Properties of every selected symbol at once: colour, the one field a
   *  bulk edit is reached for ("recolour twenty sockets red"). */
  private renderSymbolBulk(rows: PaneRows, group: readonly Id[]): void {
    const f = this.store.floor;
    const syms = f.symbols.filter(s => group.includes(s.id));
    const first = syms[0];
    if (!first) return;
    rows.secHead(t("panel.selectionHeader", { n: syms.length, label: t("panel.symbolPlain") }), { sel: true, mode: true });
    const mixed = isMixed(syms, s => s.color ?? "");
    rows.colorRow(t("panel.color"), first.color ?? null, hex => {
      this.tools.symbolColor = hex;
      this.store.mutate(d => {
        for (const s of this.store.floorOf(d).symbols) if (group.includes(s.id)) { if (hex) s.color = hex; else delete s.color; }
      }, "color:" + group.join(","));
    }, { mixed });
    // Mounting height across the group. Types may differ, so the "own height"
    // toggle writes each symbol's OWN conventional figure rather than one
    // number for the lot; the number row appears only once every member
    // carries a stated height, and then edits them together.
    const ownMixed = isMixed(syms, s => s.height !== undefined);
    rows.checkRow(t("panel.symbolOwnHeight"), first.height !== undefined, on => this.store.mutate(d => {
      for (const s of this.store.floorOf(d).symbols) {
        if (!group.includes(s.id)) continue;
        if (on) s.height = clampMountHeight(f, defaultMountHeight(f, s.type) ?? 0); else delete s.height;
      }
    }), { mixed: ownMixed });
    if (!ownMixed && first.height !== undefined) {
      rows.numRow(t("panel.symbolHeight"), first.height, n => this.store.mutate(d => {
        for (const s of this.store.floorOf(d).symbols) {
          if (group.includes(s.id)) s.height = clampMountHeight(f, n);
        }
      }), 50, { mixed: isMixed(syms, s => s.height ?? -1) });
    }
    rows.dangerRow(t("panel.deleteOpening"), () => this.tools.deleteSelected());
  }

  private renderProps(p: HTMLElement): void {
    p.replaceChildren();
    const sel = this.store.sel;
    const f = this.store.floor;
    const { numRow, selRow, textRow, noteRow, warnRow, btnRow, colorRow, chipRow, checkRow } = this.rowKit(p);

    const secHead = (label: string, opts: { sel?: boolean; later?: boolean; mode?: boolean } = {}): void => {
      const wrap = el("div", "sec" + (opts.later ? " sec-later" : ""));
      const lbl = el("span", "sec-label" + (opts.sel ? " is-sel" : ""));
      lbl.textContent = label;
      wrap.append(lbl, el("div", "sec-rule"));
      // The "Done" affordance, beside the close button in the wide layout;
      // the compact layout's pinned pill (renderTyping()) is the same
      // affordance for when this header is scrolled out of view under the
      // sheet. Only the bulk panes pass `mode`, so this header exists from
      // the second object on -- at one the canvas badge
      // (Tools.selectModeBadge) is what says the mode is live, and Escape or
      // the close button leaves it.
      if (opts.mode && this.tools.selectMode && this.mode !== "compact") {
        const done = el("button", "sec-done") as HTMLButtonElement;
        done.type = "button";
        const n = this.store.selMore.length + 1;
        done.textContent = t("panel.selectModeDone", { n });
        done.onclick = () => this.tools.exitSelectMode();
        wrap.append(done);
      }
      if (opts.sel) {
        const close = el("button", "sec-close") as HTMLButtonElement;
        close.type = "button";
        close.title = t("panel.close");
        close.setAttribute("aria-label", t("panel.close"));
        close.append(icon("close", 14));
        close.onclick = () => { this.store.select(null); this.tools.exitSelectMode(); };
        wrap.append(close);
      }
      p.append(wrap);
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

    const rows: PaneRows = {
      secHead, numRow, selRow, textRow, infoRow, noteRow, warnRow, colorRow, btnRow,
      dangerRow, checkRow, chipRow,
    };

    // The storey-management pane, opened from the button beside the picker.
    // First in the chain: opening it cleared the selection, and renderPane
    // closes it the moment anything else claims the context area.
    if (this.floorsOpen) { this.renderFloorsPane(p); return; }

    // The fit-out tool keeps its picker and its fields in the property area,
    // the way the stair tool does: placing a piece selects it, so the next one
    // has to be reachable without deselecting first. The safety palette below
    // is part of the same section, so arming a mark from it keeps the picker.
    if (fitoutPaneActive(this.tools.tool, this.tools.symbolType)) {
      if (sel?.kind === "furnishing") renderFurnishingProps(this.store, this.tools, rows, sel.id);
      renderFurnishingTool(p, this.store, this.tools, rows, () => this.refreshToolbar());
      return;
    }
    if (sel?.kind === "furnishing") {
      renderFurnishingProps(this.store, this.tools, rows, sel.id);
      return;
    }
    if (this.tools.tool === "zoom") {
      renderZoomTool(p, this.store, this.tools, rows, this.tools.rooms(), this.roomEdit);
      return;
    }
    // The wall tool states what the next wall is drawn with. With a wall
    // selected the same rows follow its properties, below.
    if (this.tools.tool === "wall" && sel?.kind !== "wall") {
      renderWallTool(p, this.store, this.tools, rows, () => this.refreshToolbar());
      return;
    }
    // The opening tools state what the next opening is placed with, above the
    // properties of whichever one was just placed.
    if (this.tools.tool === "door" || this.tools.tool === "window" || this.tools.tool === "passage") {
      if (sel?.kind === "opening") {
        const group = this.store.selectedOf("opening");
        if (group.length > 1) this.renderOpeningBulk(rows, group); else this.renderOpeningProps(sel, rows);
      }
      renderOpeningTool(this.store, this.tools, rows, this.tools.tool);
      return;
    }

    // The structure tool, like the stair tool, keeps its picker and fields in
    // the property area. It places columns, beams and railings as well as the
    // vide, so a selection of either kind shows above the picker.
    const structureSel = (): boolean => {
      if (sel?.kind === "structure") {
        const group = this.store.selectedOf("structure");
        if (group.length > 1) renderStructureBulk(this.store, this.tools, rows, group);
        else renderStructureProps(this.store, this.tools, rows, sel.id);
        return true;
      }
      if (sel?.kind === "vide") {
        const group = this.store.selectedOf("vide");
        if (group.length > 1) renderVideBulk(this.store, this.tools, rows, group);
        else renderVideProps(this.store, this.tools, rows, sel.id);
        return true;
      }
      return false;
    };
    if (this.tools.tool === "structure") {
      structureSel();
      renderStructureTool(p, this.store, this.tools, rows, () => this.refreshToolbar());
      return;
    }
    if (structureSel()) return;

    // The route tool, like the stair and vide tools, keeps its fields in the
    // property area, and so does the services palette that sits with it. The
    // same predicate the toolbar uses to decide which palette to show — see
    // ui/panes.ts for what went wrong when these two answered separately.
    if (servicesPaneActive(this.tools.tool, this.tools.symbolType)) {
      if (sel?.kind === "route") {
        const group = this.store.selectedOf("route");
        if (group.length > 1) renderRouteBulk(this.store, this.tools, rows, group);
        else renderRouteProps(this.store, this.tools, rows, sel.id);
      }
      renderRouteTool(this.store, this.tools, rows);
      return;
    }
    if (sel?.kind === "route") {
      const group = this.store.selectedOf("route");
      if (group.length > 1) renderRouteBulk(this.store, this.tools, rows, group);
      else renderRouteProps(this.store, this.tools, rows, sel.id);
      return;
    }
    // A picked waypoint shows its own run's pane -- the point is a part of the
    // run, not a separate object with properties of its own -- headed by the
    // one action that belongs to the point: taking it out.
    if (sel?.kind === "routePoint" && sel.routeId) {
      const routeId = sel.routeId;
      btnRow(t("panel.routeEndpointRemove"), () => {
        this.store.mutate(d => {
          removeRoutePoint(d, this.store.activeFloor, routeId, sel.id);
        });
        this.store.select(routesOf(this.store.floor).some(r => r.id === routeId)
          ? { kind: "route", id: routeId } : null);
      }, t("panel.routePointRemoveTitle"), "Del");
      renderRouteProps(this.store, this.tools, rows, routeId);
      return;
    }

    // With the stair tool armed the picker stays put, the way the symbol
    // palette does: placing a stair selects it, so the next kind has to be
    // reachable without deselecting first.
    if (this.tools.tool === "stair") {
      if (sel?.kind === "stair") {
        const group = this.store.selectedOf("stair");
        if (group.length > 1) renderStairBulk(this.store, this.tools, rows, group);
        else renderStairProps(this.store, this.tools, rows, sel.id);
      }
      renderStairTool(p, this.store, this.tools, rows, () => this.refreshToolbar());
      return;
    }

    // Plan-level rows live in the pinned Plan section, not here.
    if (!sel) return;

    if (sel.kind === "stair") {
      const group = this.store.selectedOf("stair");
      if (group.length > 1) renderStairBulk(this.store, this.tools, rows, group);
      else renderStairProps(this.store, this.tools, rows, sel.id);
      return;
    }

    if (sel.kind === "wall") {
      const group = this.store.selectedOf("wall");
      if (group.length > 1) { this.renderWallBulk(rows, group); return; }
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
      // Set/unset rather than a bare number: absent means "follows the
      // storey", not a stated height that happens to match it.
      checkRow(t("panel.wallOwnHeight"), w.height !== undefined, on => this.store.mutate(d => {
        const fl = this.store.floorOf(d);
        const wall = fl.walls.find(x => x.id === sel.id);
        if (!wall) return;
        if (on) wall.height = floorHeight(fl); else delete wall.height;
      }));
      if (w.height !== undefined) {
        numRow(t("panel.wallHeight"), wallHeight(f, w), n => this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (wall) wall.height = Math.max(100, Math.round(n));
        }), 50);
      }
      // Face area, straight after the two dimensions it is the product of.
      // Through the storey's takeoff rather than a wall-sized one of its own:
      // a face is finished to the ceiling of the room it looks into, and only
      // the storey's rooms say which room that is.
      const surface = floorSurface(f, this.tools.resolvedFloor(), this.tools.rooms())
        .walls.find(x => x.wallId === sel.id);
      if (surface) renderWallSurface(rows, surface);
      // Tri-state: "" is not stated, not the same fact as "no" for IFC.
      selRow(t("panel.loadBearing"), w.loadBearing === undefined ? "" : w.loadBearing ? "yes" : "no",
        [["", t("panel.loadBearingUnknown")], ["yes", t("panel.loadBearingYes")], ["no", t("panel.loadBearingNo")]],
        v => this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (!wall) return;
          wall.loadBearing = v === "" ? undefined : v === "yes";
        }));
      selRow(t("panel.fireRating"), w.fireRating?.kind ?? "",
        [["", t("panel.fireNone")],
          ...FIRE_KINDS.map(k => [k, t("panel.fire_" + k)] as [string, string])],
        value => this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (!wall) return;
          wall.fireRating = value
            ? { kind: value as FireKind, minutes: wall.fireRating?.minutes ?? FIRE_MINUTES_DEFAULT }
            : undefined;
        }));
      if (w.fireRating) {
        noteRow(t("panel.fireHelp"));
        chipRow(t("panel.fireMinutes"), FIRE_MINUTES, w.fireRating.minutes,
          n => this.store.mutate(d => {
            const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
            if (wall?.fireRating) wall.fireRating.minutes = n;
          }));
        numRow(t("panel.fireMinutes"), w.fireRating.minutes,
          n => this.store.mutate(d => {
            const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
            if (wall?.fireRating) wall.fireRating.minutes = Math.max(0, Math.round(n));
          }), 15);
      }
      // Tri-state like loadBearing above: "" is not stated, which draws as
      // masonry without claiming the wall is masonry.
      selRow(t("panel.material"), w.material ?? "",
        [["", t("panel.materialUnknown")],
          ...WALL_MATERIALS.map(m => [m, t("panel.material_" + m)] as [string, string])],
        value => this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (!wall) return;
          if (value) wall.material = value as WallMaterial; else delete wall.material;
        }));
      // Set/unset, like the wall's own height: absent means no frame at all,
      // which is a frameless pane or plain masonry, not a spacing of zero.
      checkRow(t("panel.postsOn"), w.postMm !== undefined, on => this.store.mutate(d => {
        const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
        if (!wall) return;
        if (on) wall.postMm = POST_DEFAULT_MM;
        // The profile is a fact about a member; with no members it states nothing.
        else { delete wall.postMm; delete wall.postWidthMm; }
      }));
      if (w.postMm !== undefined) {
        numRow(t("panel.posts"), w.postMm, n => this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (wall) wall.postMm = Math.max(100, Math.round(n));
        }), 100);
        // Absent is a real answer here — centres known, section not yet chosen —
        // so the width is its own set/unset rather than a number defaulted to 0.
        checkRow(t("panel.postWidthOn"), w.postWidthMm !== undefined, on => this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (!wall) return;
          if (on) wall.postWidthMm = POST_WIDTH_DEFAULT; else delete wall.postWidthMm;
        }));
        if (w.postWidthMm !== undefined) {
          numRow(t("panel.postWidth"), w.postWidthMm, n => this.store.mutate(d => {
            const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
            if (wall) wall.postWidthMm = Math.max(10, Math.round(n));
          }), 10);
        }
        noteRow(t("panel.postsHelp"));
      }
      // Cladding. Set/unset, because a wall with no facade is an internal or
      // party wall rather than one clad to zero.
      checkRow(t("panel.facadeOn"), w.facadeMm !== undefined, on => this.store.mutate(d => {
        const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
        if (!wall) return;
        if (on) wall.facadeMm = FACADE_DEFAULT_MM;
        else { delete wall.facadeMm; delete wall.facadeSide; }
      }));
      if (w.facadeMm !== undefined) {
        numRow(t("panel.facade"), w.facadeMm, n => this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (wall) wall.facadeMm = Math.max(10, Math.round(n));
        }), 10);
        selRow(t("panel.facadeSide"), facadeSideOf(w),
          [["left", t("panel.facadeLeft")], ["right", t("panel.facadeRight")]],
          v => this.store.mutate(d => {
            const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
            if (wall) wall.facadeSide = v === "right" ? "right" : "left";
          }));
        noteRow(t("panel.facadeHelp"));
      }
      // Recolouring one wall arms the pen, the way editing its thickness sets
      // the thickness of the next one: a wall marked as new work is nearly
      // always the first of a run of them.
      colorRow(t("panel.color"), w.color ?? null, hex => {
        this.tools.wallColor = hex;
        this.store.mutate(d => {
          const wall = this.store.floorOf(d).walls.find(x => x.id === sel.id);
          if (!wall) return;
          if (hex) wall.color = hex; else delete wall.color;
        }, "wallcolor:" + sel.id);  // one undo step for a drag through the OS picker
      });
      noteRow(t("panel.wallColorHelp"));
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
      // Split at the midpoint and select what it made: the node pane already
      // takes an exact x and y, so "add a node then place it" is two steps
      // rather than a second way of typing a position.
      btnRow(t("panel.wallAddNode"), () => {
        let made: Id | null = null;
        this.store.mutate(d => {
          const fl = this.store.floorOf(d);
          const wall = fl.walls.find(x => x.id === sel.id);
          if (!wall) return;
          made = splitWall(fl, wall, wallLength(fl, wall) / 2)?.id ?? null;
        });
        if (made) this.store.select({ kind: "node", id: made });
      }, t("panel.wallAddNodeTitle"));
      dangerRow(t("panel.deleteWall"), () => {
        const before = this.tools.rooms();
        this.store.mutate(d => {
          const f = this.store.floorOf(d);
          deleteWall(f, sel.id);
          deleteRoomNames(f, orphanedRoomNames(f, before));
        });
        this.store.select(null);
      });
      if (this.tools.tool === "wall") renderWallTool(p, this.store, this.tools, rows, () => this.refreshToolbar());
      return;
    }

    if (sel.kind === "opening") {
      const group = this.store.selectedOf("opening");
      if (group.length > 1) this.renderOpeningBulk(rows, group);
      else this.renderOpeningProps(sel, rows);
      return;
    }

    if (sel.kind === "symbol") {
      const group = this.store.selectedOf("symbol");
      if (group.length > 1) { this.renderSymbolBulk(rows, group); return; }
      const s = f.symbols.find(x => x.id === sel.id);
      if (!s) return;
      secHead(t("panel.symbol", { type: t("symbol." + s.type) }), { sel: true });
      numRow(t("panel.rotation"), (s.rotation * 180) / Math.PI, n => this.store.mutate(d => {
        const s2 = this.store.floorOf(d).symbols.find(x => x.id === sel.id);
        if (s2) s2.rotation = (n * Math.PI) / 180;
      }), 15);
      // Mounting height above this storey's floor. The type's own convention
      // shows until someone states otherwise, so a wandcontactdoos reads 300
      // and a light point follows the storey height without anyone typing a
      // figure (core/mount.ts). The check is the override, the same shape a
      // wall's own height uses -- and it is offered even for a type with no
      // convention, which is exactly where a stated height says the most.
      const conventional = defaultMountHeight(f, s.type);
      checkRow(t("panel.symbolOwnHeight"), s.height !== undefined, on => this.store.mutate(d => {
        const s2 = this.store.floorOf(d).symbols.find(x => x.id === sel.id);
        if (!s2) return;
        if (on) s2.height = clampMountHeight(f, conventional ?? 0); else delete s2.height;
      }));
      if (s.height !== undefined) {
        numRow(t("panel.symbolHeight"), s.height, n => this.store.mutate(d => {
          const s2 = this.store.floorOf(d).symbols.find(x => x.id === sel.id);
          if (s2) s2.height = clampMountHeight(f, n);
        }), 50);
      } else {
        infoRow(t("panel.symbolHeight"), conventional === undefined
          ? t("panel.symbolHeightNone")
          : t("panel.symbolHeightStandard", { mm: conventional }));
      }
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
      }), t("panel.mirrorTitle"), "M");
      // What this device is wired, plumbed or ducted to, and what it is
      // standing on but not yet joined to -- see deviceConnectionRows().
      deviceConnectionRows(rows, this.store, s, key => routeTakesSymbol(key, s.type));
      // A groepenkast additionally declares what it distributes.
      if (s.type === BOARD_TYPE) boardRows(rows, this.store, s);
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
      // Removing a node is the inverse of adding one, and does exactly what Del
      // does -- one behaviour, whether it is reached by key or by button.
      const removal = planNodeRemoval(f, sel.id);
      if (removal === "junction") {
        noteRow(t("panel.nodeRemoveJunction"));
      } else {
        btnRow(t("panel.nodeDissolve"), () => {
          this.store.mutate(d => { removeNode(this.store.floorOf(d), sel.id); });
          this.store.select(null);
        }, t(removal === "dissolved" ? "panel.nodeDissolveTitle" : "panel.nodeRemoveCutTitle"), "Del");
      }
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
  /** Bulk pane only: the selected objects disagree on this field. */
  mixed?: boolean;
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
/**
 * The key that fires a control, beside it. Hidden by CSS wherever there is no
 * keyboard, and `aria-hidden` so the control's accessible name stays its label.
 */
function keyTag(key: string, cls = "btn-key"): HTMLElement {
  const k = el("kbd", cls);
  k.textContent = key;
  k.setAttribute("aria-hidden", "true");
  return k;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
