// Shared HTML shell for static documentation pages. These pages require no
// client-side JavaScript and expose the editor documentation as HTML.
import { COLORS } from "../../src/render/draw";
import type { Lang } from "../../src/i18n";
import { SITE, HOME, DOCS, DOC_IDS, FEATURES, PRIMARY, alternatesFor, type PageMeta } from "./meta";

export interface SiteCtx {
  /** Absolute origin, or "" when no deployment origin is configured. */
  siteUrl: string;
  /** The 32 px icon as a data URI, shared with the editor page. */
  favicon: string;
  version: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Absolute URL for a root-relative path. Preserve trailing slashes. */
export const abs = (ctx: SiteCtx, path: string): string => (ctx.siteUrl ? ctx.siteUrl + path : "");

const OG_LOCALE: Record<Lang, string> = { nl: "nl_NL", en: "en_GB" };

/** Schema.org application metadata included on every documentation page. */
export function appJsonLd(ctx: SiteCtx, lang: Lang): Record<string, unknown> {
  const url = abs(ctx, "/");
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": url ? url + "#app" : undefined,
    name: SITE.name,
    applicationCategory: "DesignApplication",
    applicationSubCategory: "Floorplan editor",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires JavaScript and HTML canvas",
    softwareVersion: ctx.version,
    description: (lang === "nl" ? HOME.description : DOCS.symbols.en.description),
    inLanguage: ["nl", "en"],
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    license: SITE.license,
    author: { "@type": "Person", name: SITE.author },
    codeRepository: SITE.repo,
    featureList: FEATURES[lang],
    ...(url ? { url, image: abs(ctx, "/og.png") } : {}),
  };
}

function jsonLd(obj: unknown): string {
  // Escape angle brackets to prevent termination of the script element.
  const json = JSON.stringify(obj, (_k, v: unknown) => (v === undefined ? undefined : v))
    .replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * Everything between <head> and </head> except the title-specific bits a caller
 * adds. Shared with the editor page so its head cannot drift from the docs'.
 */
export function headTags(
  ctx: SiteCtx,
  lang: Lang,
  page: PageMeta,
  extra: { jsonLd?: unknown[]; style?: string } = {},
): string {
  const alts = alternatesFor(page);
  const canonical = abs(ctx, page.path);
  const out: string[] = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    `<meta name="theme-color" content="${COLORS.bg}">`,
    `<meta name="color-scheme" content="light">`,
  ];
  if (ctx.favicon) out.push(`<link rel="icon" href="${ctx.favicon}">`);
  if (ctx.siteUrl) {
    out.push(`<link rel="apple-touch-icon" href="/apple-touch-icon.png">`);
    out.push(`<link rel="manifest" href="/manifest.webmanifest">`);
    out.push(`<link rel="canonical" href="${canonical}">`);
    // hreflang has to be reciprocal and has to include the page itself, or the
    // pair is ignored. x-default goes to Dutch: it is the primary language and
    // the editor's own default, so an unmatched visitor lands where the tool does.
    for (const [code, path] of Object.entries(alts)) {
      out.push(`<link rel="alternate" hreflang="${code}" href="${abs(ctx, path)}">`);
    }
    const dflt = alts[PRIMARY];
    if (dflt) out.push(`<link rel="alternate" hreflang="x-default" href="${abs(ctx, dflt)}">`);
  }
  out.push(
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE.name}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
  );
  for (const code of Object.keys(alts) as Lang[]) {
    if (code !== lang) out.push(`<meta property="og:locale:alternate" content="${OG_LOCALE[code]}">`);
  }
  if (canonical) out.push(`<meta property="og:url" content="${canonical}">`);
  // og:image must be absolute — a crawler resolves it without a page context —
  // so like the canonical it exists only when the origin is known.
  const image = abs(ctx, "/og.png");
  if (image) {
    out.push(
      `<meta property="og:image" content="${image}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="Wallgraph — a floorplan with mitered walls, a door swing and an 8000 mm dimension line">`,
    );
  }
  out.push(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`);
  if (extra.style) out.push(`<style>${extra.style}</style>`);
  for (const ld of [appJsonLd(ctx, lang), ...(extra.jsonLd ?? [])]) out.push(jsonLd(ld));
  return out.join("\n");
}

/** Trail for a docs page: home, then this page. Cheap, and it is what puts a
 *  readable path under the result instead of a bare URL. */
export function breadcrumb(ctx: SiteCtx, page: PageMeta): Record<string, unknown> | null {
  if (!ctx.siteUrl || page.path === HOME.path) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE.name, item: abs(ctx, "/") },
      { "@type": "ListItem", position: 2, name: page.heading, item: abs(ctx, page.path) },
    ],
  };
}

export const PAGE_CSS = `
:root{--paper:${COLORS.bg};--ink:#2b2e33;--wall:${COLORS.wallFill};--line:#e2ded2;
--muted:#6b6558;--card:#fff;--accent:${COLORS.select};--code:#f7f5ef}
*{box-sizing:border-box;margin:0}
html{color-scheme:light;-webkit-text-size-adjust:100%}
body{font:16px/1.6 system-ui,sans-serif;color:var(--ink);background:var(--paper);
hyphens:auto;overflow-wrap:break-word}
.wrap{max-width:60rem;margin:0 auto;padding:0 1.25rem}
a{color:var(--accent)}a:hover{text-decoration-thickness:2px}
header.top{border-bottom:1px solid var(--line);background:var(--card)}
header.top .wrap{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;align-items:center;padding-block:.9rem}
.brand{font-weight:650;letter-spacing:-.01em;color:var(--ink);text-decoration:none;font-size:1.05rem}
nav.top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.9rem;margin-inline-start:auto}
nav.top a{color:var(--muted);text-decoration:none}
nav.top a:hover,nav.top a[aria-current]{color:var(--ink);text-decoration:underline}
nav.top a.cta{color:var(--accent);font-weight:600}
main{padding-block:2.5rem 3.5rem}
h1{font-size:clamp(1.7rem,1.2rem + 2vw,2.4rem);line-height:1.15;letter-spacing:-.02em;margin-bottom:.6rem}
h2{font-size:1.25rem;letter-spacing:-.01em;margin:2.5rem 0 .75rem;padding-top:1.25rem;border-top:1px solid var(--line)}
h3{font-size:1rem;margin:1.5rem 0 .4rem}
p{margin:.75rem 0;max-width:44rem}
.lead{font-size:1.1rem;color:var(--muted);max-width:44rem}
ul,ol{margin:.75rem 0;padding-inline-start:1.25rem;max-width:44rem}
li{margin:.3rem 0}
code,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em}
code{background:var(--code);padding:.1em .35em;border-radius:3px}
kbd{background:var(--card);border:1px solid var(--line);border-bottom-width:2px;
border-radius:4px;padding:.05em .4em;font-size:.82em}
pre{background:var(--code);border:1px solid var(--line);border-radius:6px;padding:1rem;
overflow-x:auto;margin:1rem 0;font-size:.85rem;line-height:1.5}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.92rem;display:block;overflow-x:auto}
th,td{text-align:left;padding:.45rem .75rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;white-space:nowrap}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));
margin:1rem 0;padding:0;list-style:none;max-width:none}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.75rem;
display:flex;flex-direction:column;gap:.5rem;margin:0}
.tile figure{margin:0;display:grid;place-items:center;height:5rem}
.tile svg{max-width:100%;max-height:5rem;color:${COLORS.symbol}}
.tile b{font-size:.9rem;font-weight:600;line-height:1.3}
.tile small{color:var(--muted);font-size:.78rem;display:block}
.wide{grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))}
.wide .tile figure{height:9rem}
.wide .tile svg{max-height:9rem;color:${COLORS.wallStroke}}
.note{background:var(--card);border:1px solid var(--line);border-inline-start:3px solid var(--accent);
border-radius:0 6px 6px 0;padding:.85rem 1rem;margin:1.25rem 0;max-width:44rem}
.note p{margin:.35rem 0}
footer.site{border-top:1px solid var(--line);background:var(--card);color:var(--muted);
font-size:.85rem;padding-block:1.5rem;margin-top:3rem}
footer.site .wrap{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem}
footer.site .warn{color:#a0977f}
footer.site .warn::before{content:"\\26A0 ";color:#c9a227}
`.trim();

const NAV: Record<Lang, Array<[string, string]>> = {
  nl: [
    ["/handleiding/", "Handleiding"],
    ["/symbolen/", "Symbolen"],
    ["/kozijnen/", "Kozijnen"],
    ["/formaat/", "Formaat & API"],
  ],
  en: [
    ["/en/manual/", "Manual"],
    ["/en/symbols/", "Symbols"],
    ["/en/openings/", "Openings"],
    ["/en/format/", "Format & API"],
  ],
};

/** The editor, in this language. English is a fragment override rather than a
 *  second URL — see HOME in meta.ts. */
export const editorHref = (lang: Lang): string => (lang === PRIMARY ? "/" : "/#lang=" + lang);

function nav(lang: Lang, current: string): string {
  const items = NAV[lang].map(([href, label]) =>
    `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`);
  items.push(`<a class="cta" href="${editorHref(lang)}">${lang === "nl" ? "Editor openen" : "Open the editor"}</a>`);
  return `<nav class="top" aria-label="${lang === "nl" ? "Hoofdmenu" : "Main"}">${items.join("")}</nav>`;
}

function footer(lang: Lang, page: PageMeta): string {
  const other = alternatesFor(page);
  const twin = lang === "nl" ? other.en : other.nl;
  const swap = twin
    ? `<a href="${twin}" hreflang="${lang === "nl" ? "en" : "nl"}">${lang === "nl" ? "English" : "Nederlands"}</a>`
    : "";
  const lic = lang === "nl"
    ? `Vrije software onder <a href="${SITE.license}">AGPL-3.0</a>`
    : `Free software under <a href="${SITE.license}">AGPL-3.0</a>`;
  // Include the disclaimer in every page footer.
  const warn = `<a class="warn" href="${DOCS.disclaimer[lang].path}">` +
    `${lang === "nl" ? "Geen garantie — lees de disclaimer" : "No warranty — read the disclaimer"}</a>`;
  return `<footer class="site"><div class="wrap"><span>© 2026 ${SITE.author}</span>` +
    `<span>${lic}</span><a href="${SITE.repo}">${lang === "nl" ? "Broncode" : "Source"}</a>` +
    `<a href="/llms.txt">llms.txt</a>${swap}${warn}</div></footer>`;
}

/** A complete docs page. */
export function shell(ctx: SiteCtx, lang: Lang, page: PageMeta, body: string): string {
  const extraLd = breadcrumb(ctx, page);
  const article = ctx.siteUrl
    ? {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: page.title,
        description: page.description,
        inLanguage: lang,
        url: abs(ctx, page.path),
        author: { "@type": "Person", name: SITE.author },
        license: SITE.license,
        isPartOf: { "@id": abs(ctx, "/") + "#app" },
      }
    : null;
  const head = headTags(ctx, lang, page, {
    style: PAGE_CSS,
    jsonLd: [article, extraLd].filter(Boolean),
  });
  return `<!doctype html>
<html lang="${lang}"><head>
${head}
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="${editorHref(lang)}">${SITE.name}</a>${nav(lang, page.path)}</div></header>
<main><div class="wrap">
<h1>${esc(page.heading)}</h1>
<p class="lead">${esc(page.lead)}</p>
${body}
</div></main>
${footer(lang, page)}
</body></html>`;
}

export { esc, DOC_IDS };
