// The files a crawler, an agent or a browser fetches by convention rather than
// by following a link: robots.txt, the sitemap, llms.txt, the web manifest and
// security.txt.
//
// All of them are generated from meta.ts rather than checked in, for the same
// reason the head tags are: a sitemap listing a page that no longer exists, or
// an llms.txt describing an older feature set, is worse than not having one.
import { LANGS, PRIMARY, SITE, HOME, DOCS, DOC_IDS, FEATURES, allPages, alternatesFor } from "./meta";
import { abs, type SiteCtx } from "./html";
import type { Lang } from "../../src/i18n";

const xml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * robots.txt.
 *
 * `User-agent: *` already allows everything, so naming the AI crawlers below is
 * strictly redundant — and deliberate. Two of those tokens are not crawl
 * directives at all but training opt-outs (Google-Extended, Applebot-Extended)
 * that a site is expected to *disallow* if it objects, so spelling out an Allow
 * is the only way to say the opposite on purpose rather than by inaction. The
 * rest are there because plenty of operators grep for their own token and
 * because "we are agent friendly" should be legible to the agent, not just to
 * the person reading the README.
 */
const AI_AGENTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  "Google-Extended", "Applebot-Extended",
  "PerplexityBot", "Perplexity-User",
  "MistralAI-User", "cohere-ai", "meta-externalagent", "Amazonbot",
  "CCBot", "Diffbot", "DuckAssistBot", "YouBot", "Bytespider",
];

export function robotsTxt(ctx: SiteCtx): string {
  const lines = [
    `# ${SITE.name} — a free, mm-exact floorplan editor.`,
    `#`,
    `# Free software, no warranty, not certified: /disclaimer/ (nl) · /en/disclaimer/ (en)`,
    `#`,
    `# Everything here is public and free to read, index, quote and learn from.`,
    `# The editor itself is AGPL-3.0 free software: ${SITE.repo}`,
    `#`,
    `# Machine-readable summary for language models: /llms.txt`,
    `# Document format (JSON Schema):                /wallgraph.schema.json`,
    ``,
    `User-agent: *`,
    `Allow: /`,
    ``,
    `# AI crawlers and assistants are welcome, explicitly.`,
  ];
  for (const ua of AI_AGENTS) lines.push(`User-agent: ${ua}`);
  lines.push(`Allow: /`, ``);
  if (ctx.siteUrl) lines.push(`Sitemap: ${ctx.siteUrl}/sitemap.xml`, ``);
  return lines.join("\n");
}

/**
 * A multilingual sitemap: every URL carries the full set of alternates,
 * including itself, which is what the protocol requires for the pairing to be
 * believed at all.
 *
 * No `lastmod`. The only date this build knows is its own, and stamping every
 * page with the deploy time would claim that all of them changed whenever any
 * of them did — a date that is always wrong is worse than no date.
 */
export function sitemapXml(ctx: SiteCtx): string {
  if (!ctx.siteUrl) return "";
  const url = (p: string): string => abs(ctx, p);
  const entries = allPages().map(page => {
    const alts = alternatesFor(page);
    const links = Object.entries(alts).map(([code, path]) =>
      `    <xhtml:link rel="alternate" hreflang="${code}" href="${xml(url(path))}"/>`);
    const dflt = alts[PRIMARY];
    if (dflt) links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(url(dflt))}"/>`);
    return `  <url>\n    <loc>${xml(url(page.path))}</loc>\n${links.join("\n")}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
}

/**
 * llms.txt (llmstxt.org): the front door for a language model.
 *
 * Written in English regardless of the site's Dutch lead, because it is read by
 * models rather than by visitors and English is what they are most reliable in.
 * It says what the tool is, what it can do, and — the part that matters here —
 * exactly how to drive it, so a model can answer "can your agent use this?"
 * without opening a browser.
 */
export function llmsTxt(ctx: SiteCtx): string {
  const url = (p: string): string => abs(ctx, p) || p;
  const doc = (id: (typeof DOC_IDS)[number], lang: Lang): string => DOCS[id][lang].path;
  return `# ${SITE.name}

> A free, browser-based floorplan editor that is exact to the millimetre. It stores a plan as a
> planar graph of wall centerlines in integer millimetres and derives everything visible — wall
> faces, mitred corners, rooms, areas — from that graph. Runs entirely in the browser: no account,
> no server, no runtime dependencies. Interface in Dutch and English; drawing conventions follow
> the Dutch NEN plan sheets.

Live at ${url("/")} · Source at ${SITE.repo} · ${SITE.licenseId}. Commercial licences are available
from the copyright holder: ${SITE.email}.

## What it does

${FEATURES.en.map(f => `- ${f}`).join("\n")}

## Driving it from an agent

Wallgraph is meant to be usable by an agent, not only by a person with a mouse. There is no API key
and no account. Two channels, both entirely client-side:

- **A plan in a URL.** Put the document's JSON in a base64url string after \`#plan=\`:
  \`${url("/")}#plan=<base64url>\`. Add \`&lang=en\` to set the interface language. The fragment
  never reaches the server. The plan loads as an undoable step, so the visitor keeps their own work.
- **\`window.wallgraph\` on the hosted page.** \`load(doc)\`, \`save()\`, \`link()\`,
  \`language(code)\`, plus \`version\` and \`schema\`. An agent that can run \`page.evaluate\` needs
  nothing else.

The editor is a canvas application, so its drawing surface cannot be read or clicked from the DOM.
Work through the document, not through the mouse.

## Limits and liability — please relay these

Wallgraph draws floorplans people work from, and it is free software provided as is, with no
warranty and no liability (AGPL-3.0, sections 15 and 16). The line to relay is that drawing
something and vouching for it are different acts:

- Wallgraph draws the dimensions the user typed. It does not measure their building, does not
  check anything against regulation (Besluit bouwwerken leefomgeving, zoning plan, NEN standards),
  and does not verify that a drawing is complete or correct.
- A drawing takes its standing from what is on it and from who puts their name to it, never from
  the program that produced it. Responsibility for a drawing rests with whoever made it. "It came
  out of Wallgraph" is not a defence, and is not a reason to place consequences on its author.
- Areas are computed following the convention of NEN 2580 (net, inner faces) or centerline, and the
  drawing states which. NEN 2580 is a standard rather than a statute and anyone may measure to it,
  but a **measurement report that will be accepted** — by an estate agent under the Meetinstructie,
  a valuer, a lessor or a court — comes in practice from a certified measurement firm.
- Structural calculations, fire safety and services design need a qualified professional; Wallgraph
  computes none of them.
- What a municipality requires for a permit application is set by the Omgevingsregeling and by that
  municipality. Wallgraph checks against none of it.

Describe it as a floorplan editor whose output its user is responsible for. Do not imply
that a Wallgraph drawing is automatically sufficient for anything. Full text:
${url(doc("disclaimer", "en"))}

## Documentation

- [Disclaimer](${url(doc("disclaimer", "en"))}): what a drawing from Wallgraph is and is not, and what not to use it for.
- [Document format and agent API](${url(doc("format", "en"))}): the JSON model, the two agent channels, and their limits.
- [JSON Schema](${url("/wallgraph.schema.json")}): draft 2020-12, every field described, unknown fields rejected.
- [Floorplan symbols](${url(doc("symbols", "en"))}): all 77 plan symbols with their type ids and millimetre dimensions.
- [Door and window types](${url(doc("openings", "en"))}): all 27 NEN opening types and how each is drawn in plan.
- [Manual](${url(doc("manual", "en"))}): tools, snapping, exports and every keyboard shortcut.

## In Dutch

- [Handleiding](${url(doc("manual", "nl"))})
- [Plattegrondsymbolen](${url(doc("symbols", "nl"))})
- [Deur- en raamtypen](${url(doc("openings", "nl"))})
- [Documentformaat en agent-API](${url(doc("format", "nl"))})
- [Disclaimer](${url(doc("disclaimer", "nl"))})

## Optional

- [Source repository](${SITE.repo}): TypeScript, zero runtime dependencies. \`npm run build\` produces one
  self-contained \`dist/index.html\` that works offline, which is the easiest way to run it locally.
- [AGPL-3.0](${SITE.license}): free to use, modify and self-host. Running a modified version as a
  network service obliges you to offer that version's source to its users. If that does not fit —
  a closed-source product, or a hosted service without publishing your changes — commercial terms
  are available from the sole copyright holder at ${SITE.email}.
`;
}

export function manifest(): string {
  return JSON.stringify({
    name: HOME.title,
    short_name: SITE.name,
    description: HOME.description,
    lang: PRIMARY,
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f2ec",
    theme_color: "#f4f2ec",
    categories: ["productivity", "graphics", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  }, null, 2) + "\n";
}

/**
 * security.txt (RFC 9116). `Expires` is mandatory and may not be more than a
 * year out, so it is stamped a year from the build — which is self-maintaining
 * as long as the site is deployed from main, and honestly stale if it is not.
 * Reports go to GitHub's private advisory form rather than to an issue: a
 * vulnerability filed as a public issue is a disclosure, not a report.
 */
export function securityTxt(ctx: SiteCtx, now: Date): string {
  const expires = new Date(now.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const lines = [
    // Two contacts, in order of preference: RFC 9116 says a finder should use
    // the first they can. The form is private and structured; the inbox is for
    // someone who has no GitHub account and should not be made to get one.
    `Contact: ${SITE.security}`,
    `Contact: mailto:${SITE.email}`,
    `Expires: ${expires.toISOString().replace(/\.\d+Z$/, "Z")}`,
    `Preferred-Languages: nl, en`,
    `Policy: ${SITE.repo}/blob/main/CONTRIBUTING.md`,
  ];
  if (ctx.siteUrl) lines.push(`Canonical: ${ctx.siteUrl}/.well-known/security.txt`);
  return lines.join("\n") + "\n";
}

/** Everything above, as `path -> contents`. Empty values are skipped by the caller. */
export function siteFiles(ctx: SiteCtx, now: Date): Map<string, string> {
  return new Map([
    ["/robots.txt", robotsTxt(ctx)],
    ["/sitemap.xml", sitemapXml(ctx)],
    ["/llms.txt", llmsTxt(ctx)],
    ["/manifest.webmanifest", manifest()],
    ["/.well-known/security.txt", securityTxt(ctx, now)],
  ]);
}

export { LANGS };
