// Where the project's own pages live, from wherever the editor happens to run.
//
// Four cases, and they do not want the same answer:
//
//   the hosted site   -> its own /handleiding/, obviously.
//   `npm run dev`     -> its own copy too. The dev build emits the pages, so
//                        sending localhost to production means you cannot look
//                        at the page you just changed — and, before the first
//                        deploy, means every link 404s.
//   index.html on a   -> no origin to be relative to; the canonical site is the
//   memory stick         only address that resolves.
//   an embedder       -> mounted at some path inside someone else's app, which
//                        has no /handleiding/ of its own.
//
// So: same-origin when this page came from a Wallgraph site build over http,
// and the canonical origin otherwise. `__WALLGRAPH_SITE__` is defined only by
// scripts/build.ts, which is the build that emits the pages — an embedder
// bundling src/main.ts themselves never sets it, and correctly gets absolute
// links out to where the documentation actually lives.
export const SITE_ORIGIN = "https://plattegrond.crocode.nl";

/** Replaced at build time by esbuild's `define`; undefined everywhere else. */
declare const __WALLGRAPH_SITE__: boolean | undefined;

function servesOwnDocs(): boolean {
  if (typeof __WALLGRAPH_SITE__ === "undefined" || !__WALLGRAPH_SITE__) return false;
  // file:// has no origin to resolve a root-relative path against.
  try { return location.protocol.startsWith("http"); } catch { return false; }
}

export type DocId = "manual" | "symbols" | "openings" | "format" | "disclaimer";

/**
 * Site-root-relative paths, per language. Dutch is primary, so the Dutch paths
 * are the bare ones; English lives under /en/. Shared with the site generator
 * (scripts/site/meta.ts imports this), so the app and the sitemap can never
 * disagree about where a page is.
 */
export const DOC_PATHS: Record<DocId, { nl: string; en: string }> = {
  manual:     { nl: "/handleiding/", en: "/en/manual/" },
  symbols:    { nl: "/symbolen/",    en: "/en/symbols/" },
  openings:   { nl: "/kozijnen/",    en: "/en/openings/" },
  format:     { nl: "/formaat/",     en: "/en/format/" },
  disclaimer: { nl: "/disclaimer/",  en: "/en/disclaimer/" },
};

export const DOC_IDS = Object.keys(DOC_PATHS) as DocId[];

/**
 * Where to link for a documentation page: this origin when it serves the pages,
 * the canonical site when it does not.
 */
export const docHref = (id: DocId, lang: "nl" | "en"): string =>
  (servesOwnDocs() ? "" : SITE_ORIGIN) + DOC_PATHS[id][lang];
