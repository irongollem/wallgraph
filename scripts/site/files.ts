// Convention-based site files. Shared metadata is imported from meta.ts to keep
// these files consistent with the generated HTML pages.
import { LANGS, PRIMARY, SITE, HOME, DOCS, DOC_IDS, FEATURES, allPages, alternatesFor } from "./meta";
import { abs, type SiteCtx } from "./html";
import type { Lang } from "../../src/i18n";
import { SYMBOLS } from "../../src/render/symbols";
import { OPENING_TYPE_COUNT } from "../../src/model/doc";

const xml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Known AI user-agent names listed in addition to the default allow rule. */
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
    `# Public pages may be crawled and indexed.`,
    `# The editor itself is AGPL-3.0 free software: ${SITE.repo}`,
    `#`,
    `# Machine-readable summary for language models: /llms.txt`,
    `# Document format (JSON Schema):                /wallgraph.schema.json`,
    ``,
    `User-agent: *`,
    `Allow: /`,
    ``,
    `# Rules for named AI crawlers and assistants.`,
  ];
  for (const ua of AI_AGENTS) lines.push(`User-agent: ${ua}`);
  lines.push(`Allow: /`, ``);
  if (ctx.siteUrl) lines.push(`Sitemap: ${ctx.siteUrl}/sitemap.xml`, ``);
  return lines.join("\n");
}

/** Multilingual sitemap with reciprocal alternates. Build time is not emitted as `lastmod`. */
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

/** English machine-readable product summary following the llms.txt convention. */
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

## Agent access

Wallgraph provides two client-side automation channels. Neither requires an account or API key:

- **A plan in a URL.** Put the document's JSON in a base64url string after \`#plan=\`:
  \`${url("/")}#plan=<base64url>\`. Add \`&lang=en\` to set the interface language. The fragment
  never reaches the server. Loading the plan creates an undoable document step.
- **\`window.wallgraph\` on the hosted page.** \`load(doc)\`, \`save()\`, \`link()\`,
  \`language(code)\`, plus \`version\` and \`schema\`. These methods can be called through
  \`page.evaluate\`.

The editor is a canvas application. Its drawing surface is not exposed as interactive DOM elements;
automation must use the document channels described above.

## Limitations and responsibility

- Sections 15 and 16 of the AGPL-3.0 contain a disclaimer of warranty and a limitation of liability,
  subject to applicable law.
- Wallgraph calculates from user-supplied dimensions. It does not measure buildings or verify
  accuracy, completeness, regulatory compliance or suitability for a particular purpose.
- Area calculations are derived from the drawing. Wallgraph does not issue a certified NEN 2580
  measurement report.
- Wallgraph does not perform structural, fire-safety or services-design assessments. Work requiring
  professional verification must be reviewed by an appropriately qualified person.
- The user is responsible for the drawing, its verification and its use.

Full disclaimer:
${url(doc("disclaimer", "en"))}

## Documentation

- [Disclaimer](${url(doc("disclaimer", "en"))}): warranty, liability, verification and data handling.
- [Document format and agent API](${url(doc("format", "en"))}): the JSON model, the two agent channels, and their limits.
- [JSON Schema](${url("/wallgraph.schema.json")}): draft 2020-12, every field described, unknown fields rejected.
- [Floorplan symbols](${url(doc("symbols", "en"))}): all ${SYMBOLS.length} plan symbols with their type ids and millimetre dimensions.
- [Door and window types](${url(doc("openings", "en"))}): all ${OPENING_TYPE_COUNT} NEN opening types and how each is drawn in plan.
- [Manual](${url(doc("manual", "en"))}): tools, snapping, exports and every keyboard shortcut.

## In Dutch

- [Handleiding](${url(doc("manual", "nl"))})
- [Plattegrondsymbolen](${url(doc("symbols", "nl"))})
- [Deur- en raamtypen](${url(doc("openings", "nl"))})
- [Documentformaat en agent-API](${url(doc("format", "nl"))})
- [Disclaimer](${url(doc("disclaimer", "nl"))})

## Optional

- [Source repository](${SITE.repo}): TypeScript, zero runtime dependencies. \`npm run build\` produces a
  self-contained \`dist/index.html\` that works offline.
- [AGPL-3.0](${SITE.license}): permits use, modification and self-hosting subject to its terms. Running
  a modified version as a network service requires an offer of the corresponding source to its users.
  Commercial terms for uses that do not fit the AGPL are available from the copyright holder at
  ${SITE.email}.
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
 * RFC 9116 security contact data. The required expiry is one year after build
 * time. The preferred contact is GitHub's private advisory form.
 */
export function securityTxt(ctx: SiteCtx, now: Date): string {
  const expires = new Date(now.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const lines = [
    // Contacts are ordered by preference; email remains available without GitHub.
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
