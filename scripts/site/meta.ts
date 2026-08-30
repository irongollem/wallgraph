// One source of truth for everything the site says about itself.
//
// The head tags, the JSON-LD, the sitemap, llms.txt and the content pages all
// read from here, because the alternative — a title in build.ts, a description
// in the sitemap generator, a summary in llms.txt — drifts within one release
// and then quietly tells a crawler three different things.
//
// Dutch is primary throughout. The editor defaults to Dutch (see i18n.ts on why
// it ignores navigator.language) and the site lives at plattegrond.crocode.nl,
// so serving `lang="en"` was describing a page that does not exist. English is
// a full alternate, not an afterthought: every content page has a twin.
import type { Lang } from "../../src/i18n";
import { DOC_PATHS, DOC_IDS as PATH_IDS, type DocId } from "../../src/links";

export const LANGS: Lang[] = ["nl", "en"];
export const PRIMARY: Lang = "nl";

export const SITE = {
  name: "Wallgraph",
  repo: "https://github.com/irongollem/wallgraph",
  license: "https://www.gnu.org/licenses/agpl-3.0.html",
  licenseId: "AGPL-3.0-only",
  author: "Jeffrey Ernst",
  /**
   * Commercial licensing, corporate CLAs, and anything else that needs a person
   * rather than a pull request.
   *
   * A role address rather than a personal one: it outlives whoever happens to
   * read it, it is what a company's legal department expects to write to when
   * they are asking about a licence exception, and it keeps a personal address
   * off a set of pages built to be crawled. It will be scraped — every published
   * address is — which is a spam filter's problem and not a reason to hide the
   * one channel a paying customer needs.
   */
  email: "info@crocode.nl",
  /**
   * Security reports go to GitHub's private advisory form first: it is private
   * by construction, structured, and can issue a CVE, none of which an inbox
   * does. The email is the fallback for anyone without a GitHub account.
   */
  security: "https://github.com/irongollem/wallgraph/security/advisories/new",
} as const;

export interface PageMeta {
  /** Site-root-relative, always with a trailing slash so the sitemap and the
   *  emitted directory index agree — /symbolen and /symbolen/ are two URLs to a
   *  crawler and only one of them is what Netlify serves. */
  path: string;
  title: string;
  description: string;
  heading: string;
  lead: string;
}

/** The editor itself. Dutch only: `/` is the app, and the app switches language
 *  in the browser, so an `/en/` copy would be 140 kB of duplicate content for a
 *  page whose text is not in the HTML anyway. English pages link to `/#lang=en`,
 *  which the boot entry reads — a fragment, so never a second indexed URL. */
export const HOME: PageMeta = {
  path: "/",
  title: "Wallgraph — gratis plattegrond tekenen, op de millimeter",
  description:
    "Teken plattegronden in je browser, exact op de millimeter. Typ echte maten, " +
    "plaats 77 NEN-symbolen en 27 deur- en raamtypen. Gratis, zonder account.",
  heading: "Wallgraph — plattegronden op de millimeter",
  lead:
    "Een gratis plattegrond-editor die in je browser draait. Muren zijn een graaf " +
    "van hartlijnen in hele millimeters; alles wat je ziet — muurvlakken, verstekken, " +
    "ruimtes, oppervlaktes — wordt daaruit afgeleid.",
};

// The paths come from src/links.ts because the editor links to these pages too,
// and a sitemap that disagrees with the app's own footer is the kind of drift
// nobody notices until a link 404s.
export type { DocId };
export const DOC_IDS: DocId[] = PATH_IDS;

export const DOCS: Record<DocId, Record<Lang, PageMeta>> = {
  symbols: {
    nl: {
      path: DOC_PATHS.symbols.nl,
      title: "Plattegrondsymbolen — alle 77 NEN-symbolen",
      description:
        "Alle 77 plattegrondsymbolen die Wallgraph tekent: elektra, water, sanitair, " +
        "verwarming, brandveiligheid, keuken en meubels — met maten in millimeters.",
      heading: "Plattegrondsymbolen",
      lead:
        "Elk symbool hieronder is getekend door dezelfde code als in de editor, dus " +
        "wat je hier ziet is precies wat er op je plattegrond komt. Maten in millimeters: " +
        "breedte langs de muur, diepte de ruimte in.",
    },
    en: {
      path: DOC_PATHS.symbols.en,
      title: "Floorplan symbols — all 77 NEN plan symbols",
      description:
        "Every one of the 77 plan symbols Wallgraph draws: electrical, water, sanitary, " +
        "heating, fire safety, kitchen and furniture — with millimetre dimensions.",
      heading: "Floorplan symbols",
      lead:
        "Each symbol below is drawn by the same code the editor uses, so what you see " +
        "here is exactly what lands on the plan. Dimensions are millimetres: width along " +
        "the wall, depth into the room.",
    },
  },
  openings: {
    nl: {
      path: DOC_PATHS.openings.nl,
      title: "Deur- en raamtypen — 27 kozijntypen in plattegrond",
      description:
        "Draairaam, valraam, uitzetraam, stolpraam, schuifpui, taatsdeur, tourniquet: " +
        "hoe elk deur- en raamtype volgens de NEN-bladen in plattegrond wordt getekend.",
      heading: "Deur- en raamtypen",
      lead:
        "De NEN-bladen kennen meer namen dan er bewegingen zijn — een valraam en een " +
        "uitzetraam kiepen allebei, ze verschillen in welke dorpel scharniert en welke " +
        "kant hij opgaat. Wallgraph kent de namen en schrijft de onderdelen.",
    },
    en: {
      path: DOC_PATHS.openings.en,
      title: "Door and window types — 27 NEN opening types",
      description:
        "Turn, tilt, project, pivot, revolve, slide and fold: how each door and window " +
        "type is drawn in plan, following the Dutch NEN window and door sheets.",
      heading: "Door and window types",
      lead:
        "The NEN sheets name more products than there are distinct motions — a valraam " +
        "and an uitzetraam both tilt, differing in which rail hinges and which way it " +
        "opens. Wallgraph knows the names and writes the parts.",
    },
  },
  manual: {
    nl: {
      path: DOC_PATHS.manual.nl,
      title: "Handleiding — plattegrond tekenen met Wallgraph",
      description:
        "Muren op maat tekenen, deuren en ramen plaatsen, symbolen slepen en exporteren " +
        "naar PNG, SVG of DXF. Alle sneltoetsen en werkwijzen op één pagina.",
      heading: "Handleiding",
      lead:
        "Wallgraph is gemaakt om snel in te tekenen: klik een muurketen, typ de lengte " +
        "in millimeters, druk op Enter. Hieronder staat alles wat er verder in zit.",
    },
    en: {
      path: DOC_PATHS.manual.en,
      title: "Manual — drawing floorplans with Wallgraph",
      description:
        "Draw walls to exact lengths, place doors and windows, drop symbols, and export " +
        "to PNG, SVG or DXF. Every shortcut and workflow on one page.",
      heading: "Manual",
      lead:
        "Wallgraph is built to draw in quickly: click a chain of walls, type the length " +
        "in millimetres, press Enter. Everything else it does is below.",
    },
  },
  format: {
    nl: {
      path: DOC_PATHS.format.nl,
      title: "Documentformaat en agent-API — Wallgraph",
      description:
        "Het JSON-formaat van een Wallgraph-plattegrond, met JSON Schema, en hoe een " +
        "AI-agent de editor aanstuurt via een plan-link of window.wallgraph.",
      heading: "Documentformaat en agent-API",
      lead:
        "Een Wallgraph-plattegrond is één JSON-bestand zonder afgeleide meetkunde erin. " +
        "Dat maakt hem klein, leesbaar en prima te schrijven door een programma of een agent.",
    },
    en: {
      path: DOC_PATHS.format.en,
      title: "Document format and agent API — Wallgraph",
      description:
        "The JSON format of a Wallgraph plan, with a JSON Schema, and how an AI agent " +
        "drives the editor through a plan link or window.wallgraph.",
      heading: "Document format and agent API",
      lead:
        "A Wallgraph plan is a single JSON file with no derived geometry stored in it. " +
        "That keeps it small, readable, and entirely writable by a program or an agent.",
    },
  },
  disclaimer: {
    nl: {
      path: DOC_PATHS.disclaimer.nl,
      title: "Disclaimer — geen garantie, geen certificering",
      description:
        "Wallgraph is gratis software zonder garantie en zonder certificering. Wat een " +
        "tekening uit Wallgraph wel en niet is, en waarvoor je hem niet moet gebruiken.",
      heading: "Disclaimer",
      lead:
        "Wallgraph is gratis, vrije software die door één persoon is gemaakt. Hij is niet " +
        "gecertificeerd, en een tekening die eruit komt is geen bouwkundig document. Hieronder " +
        "staat precies wat dat betekent.",
    },
    en: {
      path: DOC_PATHS.disclaimer.en,
      title: "Disclaimer — no warranty, no certification",
      description:
        "Wallgraph is free software with no warranty and no certification. What a drawing " +
        "from Wallgraph is and is not, and what you should not use it for.",
      heading: "Disclaimer",
      lead:
        "Wallgraph is free software written by one person. It is not certified, and a drawing " +
        "that comes out of it is not a building document. What that means, precisely, is below.",
    },
  },
};

/** Every emitted HTML page, primary language first. */
export function allPages(): PageMeta[] {
  return [HOME, ...DOC_IDS.flatMap(id => LANGS.map(l => DOCS[id][l]))];
}

/** The nl/en pair a docs page belongs to, for reciprocal hreflang. */
export function alternatesFor(page: PageMeta): Partial<Record<Lang, string>> {
  if (page.path === HOME.path) return { nl: HOME.path };
  const id = DOC_IDS.find(d => LANGS.some(l => DOCS[d][l].path === page.path));
  if (!id) return {};
  return Object.fromEntries(LANGS.map(l => [l, DOCS[id][l].path]));
}

/**
 * What the product does, in one line each. Feeds the JSON-LD `featureList` and
 * llms.txt — the two places a machine looks to decide whether this tool is the
 * one it wants, without rendering a canvas app to find out.
 */
export const FEATURES: Record<Lang, string[]> = {
  nl: [
    "Muren tekenen met getypte lengtes in hele millimeters",
    "Deuren, ramen en doorgangen die de muur automatisch doorsnijden",
    "27 NEN deur- en raamtypen met draai-, kiep-, schuif- en tuimelrichting",
    "77 plattegrondsymbolen: elektra, water, sanitair, verwarming, brandveiligheid, keuken, meubels",
    "Automatische ruimtedetectie met netto-oppervlakte volgens NEN 2580",
    "Meerdere verdiepingen met de laag eronder als onderlegger",
    "Exporteren naar PNG, SVG en DXF op ware schaal",
    "Werkt offline, slaat lokaal op, geen account nodig",
  ],
  en: [
    "Draw walls by typing exact lengths in whole millimetres",
    "Doors, windows and passages that cut the wall automatically",
    "27 NEN door and window types with turn, tilt, slide and tumble direction",
    "77 plan symbols: electrical, water, sanitary, heating, fire safety, kitchen, furniture",
    "Automatic room detection with net floor area per NEN 2580",
    "Multiple storeys with the one below as a tracing underlay",
    "Export to PNG, SVG and DXF at true scale",
    "Works offline, saves locally, no account required",
  ],
};
