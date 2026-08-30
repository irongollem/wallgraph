// Validate the published schema, generated pages and machine-readable metadata.
import { planSchema, validate, SASH_ACTIONS } from "../scripts/site/schema";
import { HOME, DOCS, DOC_IDS, LANGS, SITE, allPages, alternatesFor } from "../scripts/site/meta";
import { docPages } from "../scripts/site/pages";
import { robotsTxt, llmsTxt, sitemapXml } from "../scripts/site/files";
import { seedDoc } from "../src/seed";
import { SYMBOL_TYPES } from "../src/render/symbols";
import { WINDOW_KINDS, DOOR_KINDS, type Opening, type PlanDoc } from "../src/model/doc";
import { resources, changeLanguage } from "../src/i18n";
import { DOC_PATHS, DOC_IDS as LINK_IDS, docHref, SITE_ORIGIN } from "../src/links";
import { ogSvg } from "../scripts/render-og";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) { fail++; console.error("FAIL " + n + " " + d); } else console.log("ok   " + n); };

const ORIGIN = "https://plattegrond.crocode.nl";
const schema = planSchema(ORIGIN);
const ctx = { siteUrl: ORIGIN, favicon: "", version: "0.0.0-test" };

const socialCard = ogSvg();
ck("social card uses the current symbol count", socialCard.includes(`${SYMBOL_TYPES.length} NEN-symbolen`));
ck("social card uses the current opening count",
  socialCard.includes(`${WINDOW_KINDS.length + DOOR_KINDS.length} deur- en raamtypen`));
ck("social card has no unresolved count", !socialCard.includes("{{"));

/* ── schema ── */

ck("validates the demo plan", validate(schema, seedDoc()).length === 0, validate(schema, seedDoc()).join(" | "));

// Exercise every optional document field in one valid fixture.
const full: PlanDoc = {
  version: 1, unit: "mm", gridMm: 50, areaMode: "centerline",
  floors: [{
    id: "f1", name: "Begane grond",
    nodes: [{ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4000, y: 0 }],
    walls: [{
      id: "w1", a: "n1", b: "n2", thickness: 300, bulge: 0.25,
      openings: [{
        id: "o1", kind: "door", t: 2000, width: 1800,
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
rejects("rejects an opening without sashes", d => {
  delete (d.floors[0]!.walls[0]!.openings[0]! as Partial<Opening>).sashes;
});
rejects("rejects removed opening shorthand", d => {
  (d.floors[0]!.walls[0]!.openings[0]! as Opening & { windowType: string }).windowType = "fixed";
});
rejects("rejects an unknown symbol type", d => { d.floors[0]!.symbols[0]!.type = "teleporter"; });
rejects("rejects a bad colour", d => { d.floors[0]!.symbols[0]!.color = "red"; });
rejects("rejects an unknown sash action", d => { d.floors[0]!.walls[0]!.openings[0]!.sashes[0]!.action = "wobble" as never; });
rejects("rejects version 2", d => { (d as unknown as Record<string, unknown>).version = 2; });

// Keep schema enums aligned with runtime opening and symbol definitions.
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
// Keep titles and descriptions within practical search-result lengths.
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
// Normalize wrapping before checking required facts.
const llms = llmsTxt(ctx).replace(/\s+/g, " ");
ck("llms.txt states the AGPL limitations accurately",
  llms.includes("disclaimer of warranty and a limitation of liability")
  && llms.includes("subject to applicable law"));
ck("llms.txt distinguishes entered data from measurement",
  llms.includes("user-supplied dimensions") && llms.includes("does not measure buildings"));
ck("llms.txt distinguishes area calculation from certification",
  llms.includes("does not issue a certified NEN 2580 measurement report"));
ck("llms.txt assigns verification to the user",
  llms.includes("user is responsible for the drawing, its verification and its use"));
// Commercial terms must have a direct contact channel.
ck("llms.txt names the commercial contact", llmsTxt(ctx).includes(SITE.email));
for (const lang of LANGS) {
  const page = generated.get(DOCS.disclaimer[lang].path)!;
  ck(`the ${lang} disclaimer offers a way to ask for terms`, page.includes(`mailto:${SITE.email}`));
  ck(`the ${lang} disclaimer refuses liability`, /no liability|geen enkele aansprakelijkheid/.test(page));
  ck(`the ${lang} disclaimer names the licence sections`, /sections 15 and 16|artikelen 15 en 16/i.test(page));
  ck(`the ${lang} disclaimer assigns user responsibility`,
    /The user is responsible|De gebruiker is verantwoordelijk/.test(page));
  ck(`the ${lang} disclaimer does not advertise`, !/id="what-it-does"|id="wat-het-doet"/.test(page));
  ck(`the ${lang} disclaimer avoids the model's jargon`, !/graaf van|graph of centerlines/.test(page));
  ck(`the ${lang} disclaimer qualifies NEN 2580 acceptance`,
    /depend on the purpose and the receiving party|hangen af van het doel en de ontvangende partij/.test(page));
  ck(`the ${lang} disclaimer distinguishes app telemetry from hosting data`,
    /hosting provider may process|hostingprovider kan technische/.test(page));
  ck(`the ${lang} disclaimer uses formal third-person language`,
    lang === "en" ? !/\b(you|your|yours)\b/i.test(page) : !/\b(je|jij|jou|jouw)\b/i.test(page));
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
