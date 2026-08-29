// Bundles src/main.ts + src/style.css into a single self-contained dist/index.html.
// Usage: node scripts/build.mjs [--watch --serve]
import { build, context } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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
