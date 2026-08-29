// i18n engine tests: lookup, fallback, interpolation, and — most usefully —
// that the nl and en key sets are identical, so a forgotten translation is a
// test failure rather than a silent English string in a Dutch UI.
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

// every nl key must exist in en and vice versa — a missing one silently falls back
const flat = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) =>
  typeof v === "object" && v !== null ? flat(v, p + k + ".") : [p + k]);
const nl = flat(resources.nl.translation).sort();
const en = flat(resources.en.translation).sort();
ck("nl and en have identical key sets", JSON.stringify(nl) === JSON.stringify(en),
   "only-nl=" + nl.filter(k => !en.includes(k)) + " only-en=" + en.filter(k => !nl.includes(k)));
// Every symbol in the registry must have a name in both languages, and the
// English one must match the registry, or the two drift apart unnoticed.
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

console.log(`${nl.length} keys per language, ${SYMBOLS.length} symbols`);
console.log(fail === 0 ? "ALL I18N TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
