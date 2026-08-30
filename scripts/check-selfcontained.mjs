// Asserts that dist/index.html loads nothing over the network: open it with the
// wifi off and you get the whole editor. CSS and JS are inlined at build time and
// the favicon is a data: URI, so any external script/stylesheet/icon reference is
// a regression.
//
// Metadata that merely *names* a URL is fine — <link rel="canonical"> and the
// og:* meta tags point at the site's own address without fetching anything. Only
// tags that cause a fetch are checked.
//
// Every emitted page is checked, not just the editor: the content pages are
// served under the same `default-src 'self'` policy, so a stray Google Font on
// one of them would not degrade, it would silently render in the fallback face.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function htmlFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? htmlFiles(full) : full.endsWith(".html") ? [full] : [];
  });
}

const pages = htmlFiles("dist");
if (pages.length === 0) {
  console.error("dist/ holds no HTML — run the build first");
  process.exit(1);
}

const LOADING = [
  // <script src="…"> — any external origin, including protocol-relative.
  /<script\b[^>]*\bsrc=["'](?:https?:)?\/\//gi,
  // <link> that actually fetches: stylesheets, preloads, icons.
  /<link\b(?=[^>]*\brel=["'](?:stylesheet|preload|prefetch|modulepreload|icon|apple-touch-icon)["'])[^>]*\bhref=["'](?:https?:)?\/\//gi,
  // Inline CSS pulling a remote font or image.
  /@import\s+(?:url\()?["']?(?:https?:)?\/\//gi,
  /url\(\s*["']?(?:https?:)?\/\//gi,
];

let failed = false;
for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const hits = LOADING.flatMap(re => [...html.matchAll(re)].map(m => m[0]));
  if (hits.length > 0) {
    failed = true;
    console.error(`${file} references external resources:`);
    for (const h of new Set(hits)) console.error("  " + h);
  }
}
if (failed) process.exit(1);

const bytes = statSync("dist/index.html").size;
console.log(`${pages.length} page(s) self-contained · dist/index.html ${(bytes / 1024).toFixed(0)} kB`);
