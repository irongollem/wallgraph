// i18n engine tests: lookup, fallback, interpolation, and — most usefully —
// that the nl and en key sets are identical, so a forgotten translation is a
// test failure rather than a silent English string in a Dutch UI.
import { t, changeLanguage, language, resources } from "../src/i18n";
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
console.log(`${nl.length} keys per language`);
console.log(fail === 0 ? "ALL I18N TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
