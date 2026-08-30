// Build the self-contained editor and its generated documentation and metadata.
//
// Usage: tsx scripts/build.ts [--watch --serve]
//
// dist/index.html has no external runtime resources and can be opened offline.
import { build, context, type BuildResult, type PluginBuild } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, watch as watchPath } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { HOME, SITE } from "./site/meta";
import { headTags, PAGE_CSS, esc, type SiteCtx } from "./site/html";
import { docPages } from "./site/pages";
import { siteFiles } from "./site/files";
import { planSchema } from "./site/schema";
import { serviceWorker, registration } from "./site/sw";

const watch = process.argv.includes("--watch");
const PORT = Number(process.env.PORT) || 5173;

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

// Omit canonical metadata when the deployment origin is not configured.
const SITE_URL = (process.env.SITE_URL || process.env.URL || "").replace(/\/$/, "");

// The 32 px PNG inlined as a data URI, so index.html stays one file and
// /favicon.ico stops 404ing on the hosted copy. Built by `npm run assets`.
const FAVICON = existsSync("assets/favicon-32.png")
  ? "data:image/png;base64," + readFileSync("assets/favicon-32.png").toString("base64")
  : "";

const ctx: SiteCtx = { siteUrl: SITE_URL, favicon: FAVICON, version: pkg.version };

const opts = {
  entryPoints: ["src/boot.ts"],
  bundle: true,
  format: "iife" as const,
  target: "es2022",
  minify: !watch,
  write: false,
  logLevel: "info" as const,
  // Site builds link to the generated same-origin documentation pages.
  define: {
    __WALLGRAPH_VERSION__: JSON.stringify(pkg.version),
    __WALLGRAPH_SITE__: "true",
  },
};

/** Write into dist/, creating the directory a nested path needs. */
function emitFile(path: string, contents: string | Buffer): void {
  const full = "dist" + path;
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

/** Static editor summary for clients that do not execute JavaScript. */
function noscript(): string {
  return `<noscript><div class="noscript"><div class="wrap">
<h1>${esc(HOME.heading)}</h1>
<p class="lead">${esc(HOME.lead)}</p>
<p><b>De editor heeft JavaScript nodig</b>: hij tekent op een canvas. Zet JavaScript aan om te
tekenen, of lees eerst de documentatie.</p>
<ul>
<li><a href="/handleiding/">Handleiding</a> — muren, deuren, ramen, symbolen, exporteren, sneltoetsen</li>
<li><a href="/symbolen/">Plattegrondsymbolen</a> — alle 77 symbolen, met maten</li>
<li><a href="/kozijnen/">Deur- en raamtypen</a> — 27 NEN-typen en hun plattegrondmarkering</li>
<li><a href="/formaat/">Documentformaat en agent-API</a> — het JSON-model, en hoe een agent de editor aanstuurt</li>
<li><a href="/disclaimer/">Disclaimer</a> — geen garantie, en waar de verantwoordelijkheid voor een tekening ligt</li>
</ul>
<p><small>Vrije software onder <a href="${SITE.license}">AGPL-3.0</a> ·
<a href="${SITE.repo}">broncode</a> · <a href="/llms.txt">llms.txt</a> ·
<a href="/en/manual/" hreflang="en">English</a></small></p>
</div></div></noscript>`;
}

function emit(result: BuildResult): void {
  const js = result.outputFiles?.[0]?.text;
  if (js === undefined) return;  // a failed rebuild in watch mode: keep the last good dist/
  const css = readFileSync("src/style.css", "utf8");

  mkdirSync("dist", { recursive: true });

  // Hosted builds emit addressable icons; the editor favicon remains inline.
  if (SITE_URL) {
    for (const f of [
      "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "og.png",
    ]) {
      if (existsSync(`assets/${f}`)) copyFileSync(`assets/${f}`, `dist/${f}`);
    }
  }

  // Service workers require a hosted origin and register after application code.
  const boot = SITE_URL ? `${js}\n${registration}` : js;

  const html = `<!doctype html>
<html lang="nl"><head>
${headTags(ctx, "nl", HOME)}
<style>${css}${PAGE_CSS}</style></head>
<body><div id="app"></div>${noscript()}<script>${boot}</script></body></html>`;
  emitFile("/index.html", html);

  if (SITE_URL) {
    // Include editor content in the service-worker cache key.
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 12);
    emitFile("/sw.js", serviceWorker(pkg.version, hash));
  }

  for (const [path, page] of docPages(ctx)) emitFile(path + "index.html", page);
  for (const [path, body] of siteFiles(ctx, new Date())) if (body) emitFile(path, body);
  emitFile("/wallgraph.schema.json", JSON.stringify(planSchema(SITE_URL), null, 2) + "\n");

  console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} kB` +
    `  ·  ${docPages(ctx).size} content pages` +
    (SITE_URL ? `  ·  ${SITE_URL}` : `  ·  no SITE_URL: canonical, sitemap and og:image omitted`));
}

if (watch) {
  const ctxb = await context({ ...opts, plugins: [{ name: "emit", setup: (b: PluginBuild) => b.onEnd(emit) }] });
  await ctxb.watch();

  // style.css is read outside esbuild's import graph and requires a separate watcher.
  // Changes under scripts/ require restarting the build process.
  let pending: NodeJS.Timeout | undefined;
  watchPath("src/style.css", () => {
    clearTimeout(pending);
    pending = setTimeout(() => { void ctxb.rebuild().catch(() => {}); }, 40);
  });
  if (process.argv.includes("--serve")) {
    // Serves whatever is in dist/. no-store so a rebuild shows up on plain
    // reload instead of being served from cache.
    const http = await import("node:http");
    const TYPES: Record<string, string> = {
      ".html": "text/html; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon",
      ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
      ".xml": "application/xml", ".webmanifest": "application/manifest+json",
    };
    const server = http.createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0]!;
      // Resolve inside dist/ only; reject any traversal attempt outright.
      let rel = path.replace(/^\/+/, "");
      if (rel.includes("..")) {
        res.writeHead(400, { "content-type": "text/plain" }).end("bad request");
        return;
      }
      // Directory index, so /symbolen/ serves what Netlify would serve.
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      const ext = rel.slice(rel.lastIndexOf("."));
      try {
        const body = readFileSync(`dist/${rel}`);
        res.writeHead(200, {
          "content-type": TYPES[ext] ?? "application/octet-stream",
          "cache-control": "no-store",
        }).end(body);
      } catch {
        const missingApp = rel === "index.html";
        res.writeHead(missingApp ? 503 : 404, { "content-type": "text/plain" })
          .end(missingApp ? "dist/index.html not built yet" : "not found");
      }
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      console.error(err.code === "EADDRINUSE"
        ? `port ${PORT} is already in use — stop the other dev server or set PORT`
        : err);
      process.exit(1);
    });
    server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
  }
} else {
  emit(await build(opts));
}
