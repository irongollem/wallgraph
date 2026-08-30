// Asserts that what the build emitted actually hangs together: the sitemap
// points at pages that exist, hreflang pairs point back at each other, every
// page carries the tags a crawler needs, and llms.txt does not link into space.
//
// These are the failures that never show up in a browser. A sitemap URL with a
// typo, a one-directional hreflang, an og:image on a path the build stopped
// copying — the page looks perfect and the search engine quietly discards it.
// Run against a build made WITH a SITE_URL; the absolute-URL half of the site
// does not exist without one.
import { readFileSync, existsSync } from "node:fs";

const problems = [];
const fail = (msg) => problems.push(msg);
const read = (p) => readFileSync("dist" + p, "utf8");

const REQUIRED = [
  "/index.html", "/robots.txt", "/sitemap.xml", "/llms.txt",
  "/manifest.webmanifest", "/.well-known/security.txt", "/wallgraph.schema.json",
  "/sw.js", "/disclaimer/index.html", "/en/disclaimer/index.html",
];
for (const f of REQUIRED) if (!existsSync("dist" + f)) fail(`missing ${f}`);
if (problems.length > 0) {
  console.error("dist/ is not a complete site:");
  for (const p of problems) console.error("  " + p);
  console.error("\n(the sitemap and canonical tags only exist when SITE_URL is set at build time)");
  process.exit(1);
}

const robots = read("/robots.txt");
const sitemap = read("/sitemap.xml");
const llms = read("/llms.txt");

// The origin the build stamped everything with; every absolute URL must agree.
const origin = (sitemap.match(/<loc>(https?:\/\/[^/]+)/) ?? [])[1];
if (!origin) fail("sitemap.xml has no absolute <loc> — was SITE_URL set?");
if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) fail("robots.txt does not name the sitemap");

/** dist path for a site-root-relative URL path. */
const fileFor = (p) => "dist" + (p.endsWith("/") ? p + "index.html" : p);

const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
if (locs.length < 5) fail(`sitemap lists only ${locs.length} URLs`);

const pathOf = (url) => {
  if (!url.startsWith(origin + "/")) { fail(`${url} is not on ${origin}`); return null; }
  return url.slice(origin.length);
};

// Every listed URL exists, and every alternate it declares is itself listed.
const listed = new Set(locs);
for (const loc of locs) {
  const path = pathOf(loc);
  if (path === null) continue;
  if (!existsSync(fileFor(path))) { fail(`sitemap lists ${loc}, but ${fileFor(path)} does not exist`); continue; }

  const html = read(path.endsWith("/") ? path + "index.html" : path);
  if (!/<title>[^<]{10,}<\/title>/.test(html)) fail(`${path} has no usable <title>`);
  if (!/<meta name="description" content="[^"]{50,}"/.test(html)) fail(`${path} has no usable description`);
  if (!html.includes(`<link rel="canonical" href="${loc}">`)) fail(`${path} canonical does not point at ${loc}`);
  if (!/<html lang="(nl|en)">/.test(html)) fail(`${path} has no lang attribute`);

  for (const ld of [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]) {
    try {
      const obj = JSON.parse(ld[1]);
      if (!obj["@type"]) fail(`${path} has JSON-LD with no @type`);
    } catch (e) { fail(`${path} has unparseable JSON-LD: ${e.message}`); }
  }

  // hreflang has to be reciprocal, and has to include the page itself, or the
  // pairing is discarded whole.
  const alts = [...html.matchAll(/<link rel="alternate" hreflang="([\w-]+)" href="([^"]+)">/g)];
  const selfDeclared = alts.some(([, code, href]) => href === loc && code !== "x-default");
  if (!selfDeclared) fail(`${path} does not list itself among its hreflang alternates`);
  for (const [, code, href] of alts) {
    if (code === "x-default") continue;
    if (!listed.has(href)) { fail(`${path} declares hreflang ${code} -> ${href}, which the sitemap does not list`); continue; }
    const other = read(pathOf(href).endsWith("/") ? pathOf(href) + "index.html" : pathOf(href));
    if (!other.includes(`href="${loc}">`)) fail(`${path} <-> ${href}: hreflang is not reciprocal`);
  }

  // og:image is absolute and must resolve; a broken one is an empty share card.
  const og = (html.match(/<meta property="og:image" content="([^"]+)">/) ?? [])[1];
  if (!og) fail(`${path} has no og:image`);
  else if (!existsSync(fileFor(pathOf(og) ?? ""))) fail(`${path} og:image ${og} is not emitted`);
}

// Manifest icons have to exist or installing the app fails at the last step.
const manifest = JSON.parse(read("/manifest.webmanifest"));
for (const icon of manifest.icons ?? []) {
  if (!existsSync("dist" + icon.src)) fail(`manifest icon ${icon.src} is not emitted`);
}
if (!manifest.start_url) fail("manifest has no start_url");

// llms.txt is the agent's entry point: a dead link in it is a dead end.
for (const [, href] of llms.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) {
  if (!href.startsWith(origin)) continue;   // github.com and gnu.org are not ours to check
  const path = href.slice(origin.length) || "/";
  if (!existsSync(fileFor(path))) fail(`llms.txt links ${href}, which is not emitted`);
}
if (!llms.startsWith("# ")) fail("llms.txt does not open with an H1, as the convention requires");

// The schema is the contract an agent writes against; it must at least parse
// and describe the document root.
const schema = JSON.parse(read("/wallgraph.schema.json"));
if (schema.$id !== `${origin}/wallgraph.schema.json`) fail("schema $id does not match the site origin");
for (const key of ["version", "unit", "gridMm", "floors"]) {
  if (!schema.properties?.[key]) fail(`schema does not describe "${key}"`);
}

// The service worker is a proxy that outlives the tab, so getting its cache
// name wrong means a stale editor nobody can clear. It must be network-first
// and its cache must be versioned, or a deploy never reaches anyone.
const sw = read("/sw.js");
const pkgVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
if (!sw.includes(`wallgraph-${pkgVersion}-`)) fail("sw.js cache name does not carry the build version");
if (!/await fetch\(req\)/.test(sw)) fail("sw.js is not network-first — a cache-first worker pins a stale editor");
if (!/caches\.delete/.test(sw)) fail("sw.js never deletes an old cache");
if (!read("/index.html").includes('register("/sw.js")')) fail("index.html does not register the worker");

// security.txt must name a channel that still exists. Two, in preference order.
const sec = read("/.well-known/security.txt");
const contacts = [...sec.matchAll(/^Contact: (.+)$/gm)].map(m => m[1]);
if (contacts.length < 2) fail("security.txt offers fewer than two contact channels");
if (!contacts.some(c => c.startsWith("mailto:"))) fail("security.txt has no email contact");
if (!/^Expires: \d{4}-/m.test(sec)) fail("security.txt has no Expires (RFC 9116 requires one)");

// The disclaimer has to be reachable from every page, not only from its own.
for (const loc of locs) {
  const path = pathOf(loc);
  if (path === null || !existsSync(fileFor(path))) continue;
  const html = read(path.endsWith("/") ? path + "index.html" : path);
  const wants = path.startsWith("/en/") ? "/en/disclaimer/" : "/disclaimer/";
  if (!html.includes(`href="${wants}"`)) fail(`${path} does not link to the disclaimer`);
}
// Collapse the hard wrapping first: a phrase that moves across a line break is a
// layout change, not a missing statement.
const llmsFlat = llms.replace(/\s+/g, " ");
if (!llmsFlat.includes("no warranty and no liability")) fail("llms.txt does not state the liability position");
if (!llmsFlat.includes("vouching for it are different acts")) fail("llms.txt does not draw the drawing/vouching line");

if (problems.length > 0) {
  console.error("SEO/agent surface has problems:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`SEO surface OK · ${locs.length} URLs, ${new Set(locs).size} unique, hreflang reciprocal, llms.txt resolves`);
