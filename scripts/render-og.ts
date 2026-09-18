// Render the social card from its SVG source, filling counts from the same
// registries used by the editor and generated documentation.
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SYMBOLS } from "../src/render/symbols";
import { OPENING_TYPE_COUNT } from "../src/model/doc";

export function ogSvg(source = readFileSync("assets/og.svg", "utf8")): string {
  return source
    .replaceAll("{{SYMBOL_COUNT}}", String(SYMBOLS.length))
    .replaceAll("{{OPENING_TYPE_COUNT}}", String(OPENING_TYPE_COUNT));
}

// assets/og.png is a committed raster rendered by hand, so it goes stale the
// moment a symbol is added. Recording the counts it was rendered with is what
// lets tests/site.test.ts fail on that drift rather than the card advertising
// a figure the editor no longer has.
export const OG_STAMP_PATH = "assets/og.counts.json";
export type OgStamp = { symbols: number; openingTypes: number };

export function ogStamp(): OgStamp {
  return { symbols: SYMBOLS.length, openingTypes: OPENING_TYPE_COUNT };
}

export function renderedStamp(): OgStamp {
  return JSON.parse(readFileSync(OG_STAMP_PATH, "utf8")) as OgStamp;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

export function renderOg(): void {
  const work = mkdtempSync(join(tmpdir(), "wallgraph-og-"));
  const svg = join(work, "og.svg");
  const png = join(work, "og.png");
  const optimized = join(work, "og-optimized.png");
  try {
    writeFileSync(svg, ogSvg());
    run("rsvg-convert", ["-w", "1200", "-h", "630", svg, "-o", png]);
    run("magick", [png, "-strip", "-colors", "64", `PNG8:${optimized}`]);
    renameSync(optimized, "assets/og.png");
    writeFileSync(OG_STAMP_PATH, JSON.stringify(ogStamp()) + "\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) renderOg();
