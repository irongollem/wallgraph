// Translation. Deliberately shaped like i18next so swapping to the real library
// is a drop-in: same nested `resources` object, the same dot-notation keys, the
// same `t(key, vars)` call signature with `{{var}}` interpolation, the same
// `changeLanguage` / `language` / `on("languageChanged")` surface.
//
// To swap later:
//   npm i i18next
//   i18next.init({ resources, lng, fallbackLng: FALLBACK, interpolation: { escapeValue: false } })
//   export const t = i18next.t.bind(i18next)
// and delete the engine below. No call site changes.
//
// It is hand-rolled because a library would be this project's first runtime
// dependency, and runtime dependencies are load-bearing here: each one adds a
// copyright holder to a codebase that is dual-licensed (AGPL + commercial). See
// the licensing constraint in CLAUDE.md. The UI is ~120 strings with no plural
// or gender rules, which is comfortably below what a library earns its place at.

export type Lang = "nl" | "en";

export const LANGUAGES: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: "nl", label: "Nederlands" },
  { code: "en", label: "English" },
];

const FALLBACK: Lang = "en";
const DEFAULT: Lang = "nl";
const STORAGE_KEY = "wallgraph-lang";

/** i18next-shaped resource bundle: resources[lng].translation[...nested keys]. */
export const resources = {
  nl: {
    translation: {
      app: {
        title: "Wallgraph",
        tagline: "plattegronden op de millimeter",
      },
      tool: {
        select: "Selecteren / verplaatsen",
        wall: "Muren tekenen",
        door: "Deur plaatsen",
        window: "Raam plaatsen",
        passage: "Open doorgang",
        angleSnap: "Hoek vastzetten (O)",
        gridSnap: "Uitlijnen op raster (G)",
        measurements: "Maatvoering (L)",
      },
      action: {
        undo: "Ongedaan maken (Ctrl+Z)",
        redo: "Opnieuw (Ctrl+Shift+Z)",
        new: "Nieuw",
        newTitle: "Nieuwe lege plattegrond (Ctrl+Z herstelt de vorige)",
        demo: "Demo",
        demoTitle: "Demoplattegrond laden (Ctrl+Z herstelt je plattegrond)",
        save: "Opslaan",
        saveTitle: "floorplan.json opslaan",
        copy: "Kopiëren",
        copyTitle: "Plattegrond-JSON naar klembord kopiëren",
        open: "Openen",
        openTitle: "Een floorplan.json openen",
        paste: "Plakken",
        pasteTitle: "Plattegrond laden uit geplakte JSON",
        load: "Laden",
        cancel: "Annuleren",
      },
      panel: {
        plan: "Plattegrond",
        wall: "Muur",
        corner: "Hoekpunt",
        door: "Deur",
        window: "Raam",
        passage: "Doorgang",
        symbol: "Symbool: {{type}}",
        grid: "Raster (mm)",
        length: "Lengte (mm)",
        thickness: "Dikte (mm)",
        newWallThickness: "Dikte nieuwe muur",
        sagitta: "Boogdiepte (mm)",
        width: "Breedte (mm)",
        fromCorner: "Vanaf hoek (mm)",
        rotation: "Rotatie (°)",
        x: "X (mm)",
        y: "Y (mm)",
        hinge: "Scharnier",
        hingeA: "beginzijde",
        hingeB: "eindzijde",
        swing: "Draairichting",
        swingIn: "naar binnen",
        swingOut: "naar buiten",
        type: "Type",
        typeFixed: "vast",
        typeCasement: "draaiend",
        typeSliding: "schuivend",
        slidesToward: "Schuift naar",
        deleteWall: "Muur verwijderen (Del)",
        deleteOpening: "Verwijderen (Del)",
        deleteWithWalls: "Verwijderen met muren (Del)",
        mirror: "Spiegelen (M)",
        pasteJson: "Plattegrond-JSON plakken",
        language: "Taal",
      },
      hint: {
        wallStart: "klik om een muurketen te beginnen",
        wallChain: "klik om te plaatsen · typ een lengte in mm · Esc/rechtermuisknop stopt",
        wallTyped: "lengte: {{length}} mm — Enter om te plaatsen",
        select: "klik om te selecteren · sleep punten/muren/symbolen · sleep de ◆ greep om te buigen · Del verwijdert",
        selectWall: "klik de mm-waarde om te bewerken · of typ een lengte + Enter · sleep de ◆ greep om te buigen · Del verwijdert",
        selectWallTyped: "muurlengte: {{length}} mm — Enter om toe te passen",
        door: "klik op een muur om een deur te plaatsen",
        window: "klik op een muur om een raam te plaatsen",
        passage: "klik op een muur om een doorgang te plaatsen",
        symbol: "klik om {{label}} te plaatsen (R draaien, M spiegelen)",
        fromCorner: "{{mm}} mm vanaf hoek",
        gridLegend: "raster {{grid}} · hoofdlijn {{major}}",
        gridLegendStepped: "raster {{grid}} · getekend {{minor}} · hoofdlijn {{major}}",
      },
      status: {
        newPlan: "nieuwe plattegrond — Ctrl+Z herstelt de vorige",
        demoLoaded: "demo geladen — Ctrl+Z herstelt je plattegrond",
        copied: "gekopieerd",
        copyFailed: "kopiëren mislukt",
        loadFailed: "kon plattegrond niet laden",
        planLoaded: "plattegrond geladen",
        planLoadedUndo: "plattegrond geladen — Ctrl+Z herstelt de vorige",
        invalidFile: "geen geldig floorplan JSON-bestand",
        invalidJson: "geen geldige floorplan JSON",
      },
      category: {
        electrical: "Elektra",
        water: "Water",
        sanitary: "Sanitair",
        heating: "Verwarming & klimaat",
        safety: "Veiligheid",
        kitchen: "Keuken",
        furniture: "Meubels",
      },
      symbolSearch: "Zoek {{count}} symbolen…",
    },
  },
  en: {
    translation: {
      app: {
        title: "Wallgraph",
        tagline: "mm-exact floorplans, drawn fast",
      },
      tool: {
        select: "Select / move",
        wall: "Draw walls",
        door: "Place door",
        window: "Place window",
        passage: "Open passage",
        angleSnap: "Angle snap (O)",
        gridSnap: "Snap to grid (G)",
        measurements: "Measurements (L)",
      },
      action: {
        undo: "Undo (Ctrl+Z)",
        redo: "Redo (Ctrl+Shift+Z)",
        new: "New",
        newTitle: "New empty plan (Ctrl+Z restores the old one)",
        demo: "Demo",
        demoTitle: "Load the demo plan (Ctrl+Z restores your plan)",
        save: "Save",
        saveTitle: "Save floorplan.json",
        copy: "Copy",
        copyTitle: "Copy plan JSON to clipboard",
        open: "Open",
        openTitle: "Open a floorplan.json file",
        paste: "Paste",
        pasteTitle: "Load plan from pasted JSON",
        load: "Load",
        cancel: "Cancel",
      },
      panel: {
        plan: "Plan",
        wall: "Wall",
        corner: "Corner",
        door: "Door",
        window: "Window",
        passage: "Passage",
        symbol: "Symbol: {{type}}",
        grid: "Grid (mm)",
        length: "Length (mm)",
        thickness: "Thickness (mm)",
        newWallThickness: "New wall thickness",
        sagitta: "Curve sagitta (mm)",
        width: "Width (mm)",
        fromCorner: "From corner (mm)",
        rotation: "Rotation (°)",
        x: "X (mm)",
        y: "Y (mm)",
        hinge: "Hinge",
        hingeA: "start side",
        hingeB: "end side",
        swing: "Swing",
        swingIn: "inward",
        swingOut: "outward",
        type: "Type",
        typeFixed: "fixed",
        typeCasement: "casement",
        typeSliding: "sliding",
        slidesToward: "Slides toward",
        deleteWall: "Delete wall (Del)",
        deleteOpening: "Delete (Del)",
        deleteWithWalls: "Delete with walls (Del)",
        mirror: "Mirror (M)",
        pasteJson: "Paste floorplan JSON",
        language: "Language",
      },
      hint: {
        wallStart: "click to start a wall chain",
        wallChain: "click to place · type a length in mm · Esc/right-click to end",
        wallTyped: "length: {{length}} mm — Enter to place",
        select: "click to select · drag nodes/walls/symbols · drag a selected wall's ◆ handle to curve it · Del deletes",
        selectWall: "click the mm value to edit it · or just type a length + Enter · drag the ◆ handle to curve · Del deletes",
        selectWallTyped: "wall length: {{length}} mm — Enter to apply",
        door: "click on a wall to place a door",
        window: "click on a wall to place a window",
        passage: "click on a wall to place an open passage",
        symbol: "click to place {{label}} (R rotate, M mirror after placing)",
        fromCorner: "{{mm}} mm from corner",
        gridLegend: "grid {{grid}} · major {{major}}",
        gridLegendStepped: "grid {{grid}} · drawn {{minor}} · major {{major}}",
      },
      status: {
        newPlan: "new plan — Ctrl+Z restores the old one",
        demoLoaded: "demo loaded — Ctrl+Z restores your plan",
        copied: "copied",
        copyFailed: "copy failed",
        loadFailed: "could not load plan",
        planLoaded: "plan loaded",
        planLoadedUndo: "plan loaded — Ctrl+Z restores the previous one",
        invalidFile: "not a valid floorplan JSON file",
        invalidJson: "not a valid floorplan JSON",
      },
      category: {
        electrical: "Electrical",
        water: "Water",
        sanitary: "Sanitary",
        heating: "Heating & climate",
        safety: "Safety",
        kitchen: "Kitchen",
        furniture: "Furniture",
      },
      symbolSearch: "Search {{count}} symbols…",
    },
  },
} as const;

/* ── engine ── the part a real i18n library would replace ───────────────── */

type Listener = (lng: Lang) => void;
const listeners: Listener[] = [];

/**
 * The visitor's stored choice, else Dutch.
 *
 * Deliberately does NOT consult `navigator.language`. A great many Dutch users
 * run their browser and OS in English, so browser detection would serve Dutch
 * visitors an English UI — precisely backwards for a tool published at
 * plattegrond.crocode.nl. Dutch is the default; the toggle is one click and the
 * choice is remembered.
 */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "nl" || saved === "en") return saved;
  } catch { /* storage unavailable (private mode, sandbox) — use the default */ }
  return DEFAULT;
}

let current: Lang = detect();

/** Walk a dot path through a resource object; undefined when absent. */
function lookup(lng: Lang, key: string): string | undefined {
  let node: unknown = resources[lng].translation;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Translate `key`, replacing `{{name}}` placeholders from `vars`.
 * Falls back to FALLBACK, then to the key itself — a missing string shows as
 * its key rather than throwing or rendering blank, which is what i18next does
 * and what makes an untranslated string obvious in the UI instead of invisible.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(current, key) ?? lookup(FALLBACK, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole);
}

export function language(): Lang { return current; }

export function changeLanguage(lng: Lang): void {
  if (lng === current) return;
  current = lng;
  try { localStorage.setItem(STORAGE_KEY, lng); } catch { /* not fatal */ }
  try { document.documentElement.lang = lng; } catch { /* no DOM (tests) */ }
  for (const fn of listeners) fn(lng);
}

/** Only "languageChanged" is emitted; the name matches i18next's event. */
export function on(event: "languageChanged", fn: Listener): void {
  if (event === "languageChanged") listeners.push(fn);
}
