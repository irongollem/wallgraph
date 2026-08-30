// Standalone entry: mount the editor into #app, and give whatever is driving
// the page — a person with a link, a script, an agent in a browser — a way in
// that does not involve clicking.
//
// Everything here is specific to the hosted single-page build. `mountWallgraph`
// stays free of it: an app embedding the editor owns its own URL and its own
// globals, and would not thank us for a `window.wallgraph` appearing beside it.
import { mountWallgraph } from "./main";
import { planFromHash, encodePlan, hashWithoutPlan, PLAN_PARAM } from "./io/link";
import { changeLanguage, language, LANGUAGES, type Lang } from "./i18n";
import type { PlanDoc } from "./model/doc";

/** Replaced at build time by esbuild's `define`; undefined under tsx/tests. */
declare const __WALLGRAPH_VERSION__: string | undefined;
const VERSION = typeof __WALLGRAPH_VERSION__ === "string" ? __WALLGRAPH_VERSION__ : "dev";

/**
 * The page's automation surface.
 *
 * Deliberately the same two verbs the mount handle has, plus the things only
 * the hosted page can answer: which version is running, where the document
 * schema lives, and how to turn the current plan back into a link. An agent
 * that can run `page.evaluate` needs nothing else to use Wallgraph end to end.
 */
export interface WallgraphGlobal {
  readonly version: string;
  /** Absolute URL of the JSON Schema the document conforms to. */
  readonly schema: string;
  load(doc: PlanDoc): boolean;
  save(): PlanDoc;
  /** A shareable link to this page carrying the current plan. */
  link(): string;
  /** Read the UI language, or switch it. */
  language(code?: Lang): Lang;
}

declare global {
  interface Window { wallgraph?: WallgraphGlobal }
}

/**
 * `lang` from the fragment, else the query string.
 *
 * The fragment wins because it is the half that travels with a shared plan —
 * `#plan=…&lang=en` is one link, and a `?lang=` bolted on by something else
 * should not override what the sender chose. An unknown code is ignored rather
 * than fallen back on, so a typo leaves the visitor's own stored choice alone.
 */
function langFromUrl(loc: Location): Lang | null {
  const fromHash = new URLSearchParams(loc.hash.replace(/^#/, "")).get("lang");
  const wanted = fromHash ?? new URLSearchParams(loc.search).get("lang");
  return LANGUAGES.some(l => l.code === wanted) ? (wanted as Lang) : null;
}

// Language before mount: the panel builds its labels once, so switching after
// would rebuild the whole sidebar for nothing.
const wanted = langFromUrl(location);
if (wanted) changeLanguage(wanted);

const editor = mountWallgraph(document.getElementById("app")!);

// A plan in the fragment replaces the autosave. Undoably — Ctrl+Z gets the
// visitor's own drawing back, which is the difference between a link that
// shows you something and a link that eats your work.
const linked = planFromHash(location.hash);
if (linked) {
  editor.load(linked);
  // ...and the plan comes out of the URL once it is in the editor, because the
  // replacement would otherwise happen again on every refresh: an hour of
  // drawing gone to a link opened at the start of it. The autosave is what a
  // reload restores from here on. Any other fragment key stays put.
  try {
    history.replaceState(null, "",
      location.pathname + location.search + hashWithoutPlan(location.hash));
  } catch { /* a sandboxed frame may refuse; the plan is loaded either way */ }
}

window.wallgraph = {
  version: VERSION,
  schema: new URL("/wallgraph.schema.json", location.href).href,
  load: doc => editor.load(doc),
  save: () => editor.save(),
  link: () => `${location.origin}${location.pathname}#${PLAN_PARAM}=${encodePlan(editor.save())}`,
  language: code => {
    if (code) changeLanguage(code);
    return language();
  },
};
