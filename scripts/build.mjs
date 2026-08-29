// Bundles src/main.ts + src/style.css into a single self-contained dist/index.html.
// Usage: node scripts/build.mjs [--watch --serve]
import { build, context } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const PORT = Number(process.env.PORT) || 5173;

const opts = {
  entryPoints: ["src/boot.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: !watch,
  write: false,
  logLevel: "info",
};

// Page metadata. SITE_URL is set by the host (Netlify exposes URL); without it the
// canonical and og:url tags are omitted rather than pointing somewhere wrong — a
// self-hosted copy should not advertise someone else's domain as canonical.
const TITLE = "Wallgraph — free mm-exact floorplan editor";
const DESCRIPTION =
  "Draw floorplans in the browser, exact to the millimetre. Type real lengths, " +
  "place doors, windows and 74 standard plan symbols. Free, no account needed.";
const SITE_URL = process.env.SITE_URL || process.env.URL || "";

// Inline SVG favicon: keeps the build a single file and avoids a 404 for
// /favicon.ico. A wall corner in the app's own ink colour.
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="6" fill="#f4f2ec"/>' +
    '<path d="M7 25V10h4v11h14v4z" fill="#3d4148"/>' +
    '<circle cx="9" cy="12" r="2.4" fill="#e05d2d"/>' +
    "</svg>",
  );

function emit(result) {
  const js = result.outputFiles[0].text;
  const css = readFileSync("src/style.css", "utf8");
  // og:image must be an absolute URL — crawlers do not resolve relative paths or
  // data: URIs — so it only exists when we know the site's own origin. og.png is
  // the one file besides index.html that the hosted copy serves; index.html on
  // its own is still fully self-contained and works offline.
  mkdirSync("dist", { recursive: true });
  let ogImage = "";
  if (SITE_URL && existsSync("assets/og.png")) {
    copyFileSync("assets/og.png", "dist/og.png");
    ogImage =
      `<meta property="og:image" content="${SITE_URL}/og.png">\n` +
      `<meta property="og:image:width" content="1200">\n` +
      `<meta property="og:image:height" content="630">\n` +
      `<meta property="og:image:alt" content="Wallgraph — a floorplan with mitered walls, a door swing and an 8000 mm dimension line">\n`;
  }
  const canonical = SITE_URL
    ? `<link rel="canonical" href="${SITE_URL}">\n<meta property="og:url" content="${SITE_URL}">\n`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="theme-color" content="#f4f2ec">
<link rel="icon" href="${FAVICON}">
${canonical}<meta property="og:type" content="website">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:site_name" content="Wallgraph">
${ogImage}<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<style>${css}</style></head>
<body><div id="app"></div><script>${js}</script></body></html>`;
  writeFileSync("dist/index.html", html);
  console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} kB`);
}

if (watch) {
  const ctx = await context({ ...opts, plugins: [{ name: "emit", setup: b => b.onEnd(emit) }] });
  await ctx.watch();
  if (process.argv.includes("--serve")) {
    // Single-file app: the only real route is the bundle itself. no-store so a
    // rebuild shows up on plain reload instead of being served from cache.
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/" && path !== "/index.html") {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      try {
        const body = readFileSync("dist/index.html");
        res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(body);
      } catch {
        res.writeHead(503, { "content-type": "text/plain" }).end("dist/index.html not built yet");
      }
    });
    server.on("error", err => {
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
