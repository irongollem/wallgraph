// Validate lookup, fallback, interpolation and translation-key parity.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { t, changeLanguage, language, resources } from "../src/i18n";
import { SYMBOLS } from "../src/render/symbols";
let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) { fail++; console.error("FAIL " + n + " " + d); } else console.log("ok   " + n); };

ck("defaults to nl", language() === "nl", language());
ck("nl lookup", t("panel.wall") === "Muur", t("panel.wall"));
ck("interpolation", t("hint.wallTyped", { length: 2400 }) === "lengte: 2400 mm — Enter om te plaatsen", t("hint.wallTyped", { length: 2400 }));
changeLanguage("en");
ck("switches to en", language() === "en");
ck("en lookup", t("panel.wall") === "Wall", t("panel.wall"));
ck("missing key returns key", t("nope.not.here") === "nope.not.here");
ck("unknown placeholder left intact", t("panel.symbol", {}) === "Symbol: {{type}}", t("panel.symbol", {}));

// Every Dutch key must have an English equivalent and vice versa.
const flat = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) =>
  typeof v === "object" && v !== null ? flat(v, p + k + ".") : [p + k]);
const nl = flat(resources.nl.translation).sort();
const en = flat(resources.en.translation).sort();
ck("nl and en have identical key sets", JSON.stringify(nl) === JSON.stringify(en),
   "only-nl=" + nl.filter(k => !en.includes(k)) + " only-en=" + en.filter(k => !nl.includes(k)));
const foot = resources;
ck("persistent disclaimer uses formal third-person language",
  !/\b(je|jij|jou|jouw)\b/i.test(foot.nl.translation.foot.disclaimer + " " + foot.nl.translation.foot.disclaimerTitle)
  && !/\b(you|your|yours)\b/i.test(foot.en.translation.foot.disclaimer + " " + foot.en.translation.foot.disclaimerTitle));

// Symbol labels must match both translation dictionaries and the registry.
for (const lng of ["nl", "en"] as const) {
  const dict = (resources[lng].translation as any).symbol ?? {};
  const missing = SYMBOLS.filter(sym => typeof dict[sym.type] !== "string").map(sym => sym.type);
  ck(`every symbol has a ${lng} name`, missing.length === 0, missing.join(", "));
}
const enDict = (resources.en.translation as any).symbol ?? {};
const drift = SYMBOLS.filter(sym => enDict[sym.type] !== sym.label)
                     .map(sym => `${sym.type}: "${sym.label}" vs "${enDict[sym.type]}"`);
ck("en symbol names match the registry", drift.length === 0, drift.join(" | "));
const stale = Object.keys(enDict).filter(k => !SYMBOLS.some(sym => sym.type === k));
ck("no translations for removed symbols", stale.length === 0, stale.join(", "));

// Every key a source file names must exist. A key is an ordinary string
// constant, so neither the type checker nor a rendering test notices when a
// rename leaves one behind at a call site or in a key table: the UI prints the
// raw key instead of a word. This scans the sources for key-shaped literals and
// requires each to resolve in both languages.
const KEY_SHAPED = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
/** Literals that are key-shaped only because a namespace shares their first word. */
const NOT_KEYS = new Set(["package.json"]);
const namespaces = new Set(nl.map(k => k.split(".")[0]!));
const nlKeys = new Set(nl), enKeys = new Set(en);
// A prefix the code completes at runtime — `panel.ink` + `New` — names a family
// rather than a key, and still fails once that family is gone.
const completed = (s: string) => nl.some(k => k.startsWith(s) && /[A-Z.]/.test(k[s.length] ?? ""));

const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? sources(full)
       : full.endsWith(".ts") ? [full] : [];
});
// i18n.ts holds the dictionary itself; the keys there are nested identifiers.
const scanned = [...sources("src"), ...sources("scripts")].filter(f => f !== join("src", "i18n.ts"));
const dangling: string[] = [];
for (const file of scanned) {
  // Quoted literals only: comments in this codebase spell code references in
  // backticks, and a template head is a runtime-completed prefix either way.
  for (const m of readFileSync(file, "utf8").matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'/g)) {
    const key = m[1] ?? m[2] ?? "";
    if (!KEY_SHAPED.test(key) || NOT_KEYS.has(key)) continue;
    if (!namespaces.has(key.split(".")[0]!)) continue;
    if (nlKeys.has(key) && enKeys.has(key)) continue;
    if (completed(key)) continue;
    dangling.push(`${file}: ${key}`);
  }
}
ck("every key named in src/ and scripts/ exists", dangling.length === 0, dangling.join(" | "));

console.log(`${nl.length} keys per language, ${SYMBOLS.length} symbols, ${scanned.length} source files scanned`);
console.log(fail === 0 ? "ALL I18N TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
