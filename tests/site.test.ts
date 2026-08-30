// The published site's contract with machines: the JSON Schema an agent writes
// against, and the page metadata a crawler reads.
//
// The schema is the part most able to drift silently. Nothing in the editor
// consults it, so a field added to the document model would keep working
// perfectly while the published description of the format quietly became a lie —
// and the only people to notice would be the ones generating plans from it.
import { planSchema, validate, SASH_ACTIONS } from "../scripts/site/schema";
import { HOME, DOCS, DOC_IDS, LANGS, SITE, allPages, alternatesFor } from "../scripts/site/meta";
import { docPages } from "../scripts/site/pages";
import { robotsTxt, llmsTxt, sitemapXml } from "../scripts/site/files";
import { seedDoc } from "../src/seed";
import { SYMBOL_TYPES } from "../src/render/symbols";
import { WINDOW_KINDS, DOOR_KINDS, type PlanDoc } from "../src/model/doc";
import { resources, changeLanguage } from "../src/i18n";
import { DOC_PATHS, DOC_IDS as LINK_IDS, docHref, SITE_ORIGIN } from "../src/links";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) { fail++; console.error("FAIL " + n + " " + d); } else console.log("ok   " + n); };

const ORIGIN = "https://plattegrond.crocode.nl";
const schema = planSchema(ORIGIN);
const ctx = { siteUrl: ORIGIN, favicon: "", version: "0.0.0-test" };

/* ── schema ── */

ck("validates the demo plan", validate(schema, seedDoc()).length === 0, validate(schema, seedDoc()).join(" | "));

// Every optional field at once. A schema that only ever sees the documents the
// editor happens to write today is not a published format, it is a snapshot.
const full: PlanDoc = {
  version: 1, unit: "mm", gridMm: 50, areaMode: "centerline",
  floors: [{
    id: "f1", name: "Begane grond",
    nodes: [{ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 }],
    walls: [{
      id: "w1", a: "n1", b: "n2", thickness: 300, bulge: 0.25,
      openings: [{
        id: "o1", kind: "door", t: 2000, width: 1800,
        hinge: "a", swingIn: true, windowType: "tilt-turn", slideTo: "b",
        glazed: true, powered: true, selfClosing: true,
        fireRating: { kind: "wbd", minutes: 30 },
        sillHeight: 0, height: 2300,
        sashes: [
          { width: 900, action: "turn", hinge: "a", outward: true, bars: 6 },
          { action: "revolve", spin: "cw", slideTo: "a", hinge: "sill" },
        ],
      }],
    }],
    symbols: [{
      id: "s1", type: SYMBOL_TYPES[0]!, x: 100, y: -200,
      rotation: 1.5707963, mirrored: true, wallId: "w1", color: "#e05d2d",
    }],
  }],
};
ck("validates a document using every field", validate(schema, full).length === 0, validate(schema, full).join(" | "));

const rejects = (name: string, mutate: (d: PlanDoc) => void) => {
  const d = JSON.parse(JSON.stringify(full)) as PlanDoc;
  mutate(d);
  ck(name, validate(schema, d).length > 0);
};
rejects("rejects an unknown property", d => { (d as unknown as Record<string, unknown>).extra = 1; });
rejects("rejects a non-integer coordinate", d => { d.floors[0]!.nodes[0]!.x = 12.5; });
rejects("rejects a missing bulge", d => { delete (d.floors[0]!.walls[0]! as { bulge?: number }).bulge; });
rejects("rejects an unknown symbol type", d => { d.floors[0]!.symbols[0]!.type = "teleporter"; });
rejects("rejects a bad colour", d => { d.floors[0]!.symbols[0]!.color = "red"; });
rejects("rejects an unknown sash action", d => { d.floors[0]!.walls[0]!.openings[0]!.sashes![0]!.action = "wobble" as never; });
rejects("rejects version 2", d => { (d as unknown as Record<string, unknown>).version = 2; });

// The two enums the schema cannot derive from a type: keep them tied to what
// the model actually uses, so adding a motion or a symbol fails here first.
const symbolEnum = (schema.$defs as Record<string, { properties: { type: { enum: string[] } } }>).symbol!.properties.type.enum;
ck("symbol enum matches the registry", symbolEnum.join() === SYMBOL_TYPES.join(), `${symbolEnum.length} vs ${SYMBOL_TYPES.length}`);

const used = new Set([...WINDOW_KINDS.flatMap(k => [k.action, ...(k.expandsTo ?? []).map(s => s.action)]),
                      ...DOOR_KINDS.flatMap(k => k.sashes.map(s => s.action))]);
const uncovered = [...used].filter(a => !(SASH_ACTIONS as readonly string[]).includes(a));
ck("every named kind's action is in the schema", uncovered.length === 0, uncovered.join(", "));

/* ── the names the public pages print ── */

for (const lng of LANGS) {
  changeLanguage(lng);
  const dict = (resources[lng].translation as { panel?: Record<string, string> }).panel ?? {};
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const missingW = WINDOW_KINDS.filter(k => typeof dict["win" + cap(k.id)] !== "string").map(k => k.id);
  const missingD = DOOR_KINDS.filter(k => typeof dict["dr" + cap(k.id)] !== "string").map(k => k.id);
  ck(`every window kind has a ${lng} name`, missingW.length === 0, missingW.join(", "));
  ck(`every door kind has a ${lng} name`, missingD.length === 0, missingD.join(", "));
}

/* ── page metadata ── */

const pages = allPages();
const paths = pages.map(p => p.path);
ck("page paths are unique", new Set(paths).size === paths.length, paths.join(" "));
ck("page paths are absolute and end in a slash", paths.every(p => p.startsWith("/") && p.endsWith("/")), paths.join(" "));
// Titles and descriptions are what a result actually shows; a truncated one is
// a worse advert than a short one.
const longTitles = pages.filter(p => p.title.length > 65).map(p => p.path);
ck("titles fit a result", longTitles.length === 0, longTitles.join(" "));
const badDesc = pages.filter(p => p.description.length < 70 || p.description.length > 165).map(p => `${p.path}:${p.description.length}`);
ck("descriptions are a usable length", badDesc.length === 0, badDesc.join(" "));

for (const page of pages) {
  const alts = alternatesFor(page);
  ck(`${page.path} lists itself as an alternate`, Object.values(alts).includes(page.path), JSON.stringify(alts));
}
ck("the editor has no second URL", alternatesFor(HOME).en === undefined);

// src/links.ts is what the editor's own menu and footer link to. Every path in
// it must be a page the build emits, or the app links into a 404.
const emitted = new Set(paths);
for (const id of LINK_IDS) {
  for (const lang of LANGS) {
    ck(`the app's ${lang} ${id} link is a page we emit`, emitted.has(DOC_PATHS[id][lang]), DOC_PATHS[id][lang]);
  }
}
// Outside a site build — an embedder bundling src/main.ts into their own app —
// there is no same-origin copy of these pages, so the links must be absolute.
ck("an embedder gets absolute doc links", docHref("manual", "nl") === SITE_ORIGIN + "/handleiding/", docHref("manual", "nl"));
ck("an embedder gets an absolute disclaimer link", docHref("disclaimer", "en") === SITE_ORIGIN + "/en/disclaimer/");
for (const id of DOC_IDS) {
  ck(`${id} has a pair`, LANGS.every(l => typeof DOCS[id][l].path === "string"));
}

/* ── generated output ── */

const generated = docPages(ctx);
ck("every docs page is generated", generated.size === DOC_IDS.length * LANGS.length, String(generated.size));
for (const [path, html] of generated) {
  const page = pages.find(p => p.path === path)!;
  ck(`${path} carries its heading`, html.includes(page.heading));
  ck(`${path} has no unresolved translation key`, !/>panel\.\w+</.test(html) && !/>symbol\.[\w-]+</.test(html));
  ck(`${path} declares its language`, html.includes(`<html lang="${path.startsWith("/en/") ? "en" : "nl"}">`));
}
ck("the symbol page draws every symbol",
  (generated.get(DOCS.symbols.nl.path)!.match(/<svg /g) ?? []).length === SYMBOL_TYPES.length);
ck("the openings page draws every kind",
  (generated.get(DOCS.openings.nl.path)!.match(/<svg /g) ?? []).length === WINDOW_KINDS.length + DOOR_KINDS.length);

ck("robots.txt allows everything", /User-agent: \*\nAllow: \//.test(robotsTxt(ctx)));
ck("robots.txt names the sitemap", robotsTxt(ctx).includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
ck("sitemap lists every page", pages.every(p => sitemapXml(ctx).includes(`<loc>${ORIGIN}${p.path}</loc>`)));
ck("llms.txt opens with an H1 and a summary", /^# Wallgraph\n\n> /.test(llmsTxt(ctx)));
ck("llms.txt documents both agent channels",
  llmsTxt(ctx).includes("#plan=") && llmsTxt(ctx).includes("window.wallgraph"));
// A model summarising Wallgraph should be able to relay what it is not. If this
// drops out of llms.txt, every assistant describing the tool loses the caveat.
ck("llms.txt states the liability position", llmsTxt(ctx).includes("no warranty and no liability"));
ck("llms.txt says it is not a NEN 2580 report", llmsTxt(ctx).includes("NEN 2580 measurement report"));
// The commercial channel is the one thing on the site that has to reach a
// person. If it drops out, a paying customer's only route is a public issue.
ck("llms.txt names the commercial contact", llmsTxt(ctx).includes(SITE.email));
for (const lang of LANGS) {
  const page = generated.get(DOCS.disclaimer[lang].path)!;
  ck(`the ${lang} disclaimer offers a way to ask for terms`, page.includes(`mailto:${SITE.email}`));
  ck(`the ${lang} disclaimer refuses liability`, /no liability|geen enkele aansprakelijkheid/.test(page));
  ck(`the ${lang} disclaimer names the licence sections`, /sections 15 and 16|artikelen 15 en 16/.test(page));
}

// Without an origin nothing absolute may be emitted, or a self-hosted build
// advertises someone else's domain as its own.
const nowhere = { siteUrl: "", favicon: "", version: "0" };
ck("no sitemap without an origin", sitemapXml(nowhere) === "");
ck("no Sitemap line without an origin", !robotsTxt(nowhere).includes("Sitemap:"));
ck("no $id without an origin", planSchema("").$id === undefined);

console.log(`${pages.length} pages, ${SYMBOL_TYPES.length} symbols, ${WINDOW_KINDS.length + DOOR_KINDS.length} opening types`);
console.log(fail === 0 ? "ALL SITE TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
