// Asserts that dist/index.html loads nothing over the network: open it with the
// wifi off and you get the whole editor. CSS and JS are inlined at build time and
// the favicon is a data: URI, so any external script/stylesheet/icon reference is
// a regression.
//
// Metadata that merely *names* a URL is fine — <link rel="canonical"> and the
// og:* meta tags point at the site's own address without fetching anything. Only
// tags that cause a fetch are checked.
import { readFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");

const LOADING = [
  // <script src="…"> — any external origin, including protocol-relative.
  /<script\b[^>]*\bsrc=["'](?:https?:)?\/\//gi,
  // <link> that actually fetches: stylesheets, preloads, icons.
  /<link\b(?=[^>]*\brel=["'](?:stylesheet|preload|prefetch|modulepreload|icon|apple-touch-icon)["'])[^>]*\bhref=["'](?:https?:)?\/\//gi,
  // Inline CSS pulling a remote font or image.
  /@import\s+(?:url\()?["']?(?:https?:)?\/\//gi,
  /url\(\s*["']?(?:https?:)?\/\//gi,
];

const hits = LOADING.flatMap(re => [...html.matchAll(re)].map(m => m[0]));

if (hits.length > 0) {
  console.error("dist/index.html references external resources:");
  for (const h of new Set(hits)) console.error("  " + h);
  process.exit(1);
}

console.log(`dist/index.html is self-contained (${(html.length / 1024).toFixed(0)} kB)`);
