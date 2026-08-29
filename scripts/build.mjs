// Bundles src/main.ts + src/style.css into a single self-contained dist/index.html.
// Usage: node scripts/build.mjs [--watch --serve]
import { build, context } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

const opts = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: !watch,
  write: false,
  logLevel: "info",
};

function emit(result) {
  const js = result.outputFiles[0].text;
  const css = readFileSync("src/style.css", "utf8");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Floorplan</title>
<style>${css}</style></head>
<body><div id="app"></div><script>${js}</script></body></html>`;
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/index.html", html);
  console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} kB`);
}

if (watch) {
  const ctx = await context({ ...opts, plugins: [{ name: "emit", setup: b => b.onEnd(emit) }] });
  await ctx.watch();
  if (process.argv.includes("--serve")) {
    const { serve } = await import("node:http").then(() => null).catch(() => ({}));
    // Simple static server for dist/
    const http = await import("node:http");
    http.createServer((req, res) => {
      try {
        const body = readFileSync("dist/index.html");
        res.writeHead(200, { "content-type": "text/html" }).end(body);
      } catch { res.writeHead(404).end(); }
    }).listen(5173, () => console.log("http://localhost:5173"));
  }
} else {
  emit(await build(opts));
}
