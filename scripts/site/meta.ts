// Shared metadata for HTML pages and convention-based site files.
// Dutch is primary; each documentation page has an English alternate.
import type { Lang } from "../../src/i18n";
import { DOC_PATHS, DOC_IDS as PATH_IDS, type DocId } from "../../src/links";
import { SYMBOLS } from "../../src/render/symbols";
import { OPENING_TYPE_COUNT } from "../../src/model/doc";

/** Counted from the registry so the copy cannot drift from the library. */
const N = SYMBOLS.length;
const O = OPENING_TYPE_COUNT;

export const LANGS: Lang[] = ["nl", "en"];
export const PRIMARY: Lang = "nl";

export const SITE = {
  name: "Wallgraph",
  repo: "https://github.com/irongollem/wallgraph",
  license: "https://www.gnu.org/licenses/agpl-3.0.html",
  licenseId: "AGPL-3.0-only",
  author: "Jeffrey Ernst",
  /** Role address for licensing and contributor agreements. */
  email: "info@crocode.nl",
  /** Preferred private channel for security reports. */
  security: "https://github.com/irongollem/wallgraph/security/advisories/new",
} as const;

export interface PageMeta {
  /** Site-root-relative path with a trailing slash. */
  path: string;
  title: string;
  description: string;
  heading: string;
  lead: string;
}

/** Editor metadata. The app changes language client-side, so only `/` is indexed. */
export const HOME: PageMeta = {
  path: "/",
  title: "Wallgraph — gratis plattegrond tekenen, op de millimeter",
  description:
    `Browsergebaseerde plattegrond-editor met maten in hele millimeters, ${N} NEN-symbolen ` +
    `en ${O} deur- en raamtypen. Gratis en zonder account.`,
  heading: "Wallgraph — plattegronden op de millimeter",
  lead:
    "Een gratis plattegrond-editor in de browser. Maten worden in hele millimeters " +
    "opgeslagen; muurvlakken, hoekverstekken, ruimtes en oppervlaktes worden daaruit " +
    "berekend.",
};

// Shared paths keep editor links and generated documentation links consistent.
export type { DocId };
export const DOC_IDS: DocId[] = PATH_IDS;

export const DOCS: Record<DocId, Record<Lang, PageMeta>> = {
  symbols: {
    nl: {
      path: DOC_PATHS.symbols.nl,
      title: `Plattegrondsymbolen — alle ${N} NEN-symbolen`,
      description:
        `Alle ${N} plattegrondsymbolen die Wallgraph tekent: elektra, water, sanitair, ` +
        "verwarming, ventilatie, brandveiligheid, keuken en meubels — met maten in millimeters.",
      heading: "Plattegrondsymbolen",
      lead:
        "Alle symbolen uit de bibliotheek, getekend zoals de editor ze tekent. Maten in " +
        "millimeters: breedte langs de muur, diepte de ruimte in.",
    },
    en: {
      path: DOC_PATHS.symbols.en,
      title: `Floorplan symbols — all ${N} NEN plan symbols`,
      description:
        `All ${N} plan symbols Wallgraph draws: electrical, water, sanitary, ` +
        "heating, ventilation, fire safety, kitchen and furniture — with millimetre dimensions.",
      heading: "Floorplan symbols",
      lead:
        "Every symbol in the library, drawn as the editor draws it. Dimensions in " +
        "millimetres: width along the wall, depth into the room.",
    },
  },
  openings: {
    nl: {
      path: DOC_PATHS.openings.nl,
      title: `Deur- en raamtypen — ${O} kozijntypen in plattegrond`,
      description:
        "Draairaam, valraam, uitzetraam, stolpraam, schuifpui, taatsdeur, tourniquet: " +
        "hoe elk deur- en raamtype volgens de NEN-bladen in plattegrond wordt getekend.",
      heading: "Deur- en raamtypen",
      lead:
        "De NEN-bladen onderscheiden meer namen dan bewegingen: een valraam en een " +
        "uitzetraam kiepen allebei en verschillen in de scharnierende dorpel en de " +
        "draairichting. Hieronder elk type met zijn plattegrondmarkering.",
    },
    en: {
      path: DOC_PATHS.openings.en,
      title: `Door and window types — ${O} NEN opening types`,
      description:
        "Turn, tilt, project, pivot, revolve, slide and fold: how each door and window " +
        "type is drawn in plan, following the Dutch NEN window and door sheets.",
      heading: "Door and window types",
      lead:
        "The NEN sheets distinguish more names than motions: a valraam and an uitzetraam " +
        "both tilt, differing in which rail hinges and which way it opens. Each type is " +
        "shown below with its plan mark.",
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
        "Werkwijze en sneltoetsen voor muren, openingen, symbolen, maatlijnen en export.",
    },
    en: {
      path: DOC_PATHS.manual.en,
      title: "Manual — drawing floorplans with Wallgraph",
      description:
        "Draw walls to exact lengths, place doors and windows, drop symbols, and export " +
        "to PNG, SVG or DXF. Every shortcut and workflow on one page.",
      heading: "Manual",
      lead:
        "The workflow and the keyboard shortcuts. Walls are drawn by clicking a chain, " +
        "typing the length in millimetres and pressing Enter.",
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
        "Een Wallgraph-plattegrond is één JSON-bestand waarin geen afgeleide meetkunde " +
        "is opgeslagen. Hieronder het model, het JSON Schema, en de twee manieren waarop " +
        "een programma de editor aanstuurt.",
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
        "Below: the model, the JSON Schema, and the two ways a program drives the editor.",
    },
  },
  disclaimer: {
    nl: {
      path: DOC_PATHS.disclaimer.nl,
      title: "Disclaimer — verantwoordelijkheid voor tekeningen",
      description:
        "Garantie, aansprakelijkheid, verantwoordelijkheid voor tekeningen, professionele " +
        "controle en gegevensverwerking bij het gebruik van Wallgraph.",
      heading: "Disclaimer",
      lead:
        "Wallgraph verwerkt ingevoerde maten tot een plattegrond. De gebruiker blijft " +
        "verantwoordelijk voor de invoer, controle, volledigheid en geschiktheid van de tekening.",
    },
    en: {
      path: DOC_PATHS.disclaimer.en,
      title: "Disclaimer — responsibility for drawings",
      description:
        "Warranty, liability, responsibility for drawings, professional verification and " +
        "data handling when using Wallgraph.",
      heading: "Disclaimer",
      lead:
        "Wallgraph converts entered dimensions into a floorplan. The user remains responsible " +
        "for the input, verification, completeness and suitability of the drawing.",
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
    "Rechthoek, cirkel en veelhoek in twee klikken; gedeelde muren worden samengevoegd",
    "Deuren, ramen en doorgangen die de muur automatisch doorsnijden",
    `${O} NEN deur- en raamtypen met draai-, kiep-, schuif- en tuimelrichting`,
    `${N} plattegrondsymbolen: elektra, water, sanitair, verwarming, ventilatie, brandveiligheid, keuken, meubels`,
    "15 traptypen met eigen maatvoering: steektrap, bordestrap, kwartslag, spiltrap, wenteltrap",
    "Automatische ruimtedetectie met netto-oppervlakte volgens NEN 2580",
    "Meerdere verdiepingen met de laag eronder als onderlegger",
    "Exporteren naar PNG, SVG en DXF op ware schaal",
    "Werkt offline, slaat lokaal op, geen account nodig",
  ],
  en: [
    "Draw walls by typing exact lengths in whole millimetres",
    "Rectangle, circle and polygon in two clicks, with shared walls merged",
    "Doors, windows and passages that cut the wall automatically",
    `${O} NEN door and window types with turn, tilt, slide and tumble direction`,
    `${N} plan symbols: electrical, water, sanitary, heating, ventilation, fire safety, kitchen, furniture`,
    "15 stair types, each sized for its own plan: straight, landing, quarter-turn, spiral, helical",
    "Automatic room detection with net floor area per NEN 2580",
    "Multiple storeys with the one below as a tracing underlay",
    "Export to PNG, SVG and DXF at true scale",
    "Works offline, saves locally, no account required",
  ],
};
