// Validate lookup, fallback, interpolation and translation-key parity.
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

console.log(`${nl.length} keys per language, ${SYMBOLS.length} symbols`);
console.log(fail === 0 ? "ALL I18N TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
