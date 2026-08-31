// Aggregated symbol registry. Categories render in this order in the palette.
//
// Every symbol here is one fixed picture: a socket is a socket at any scale.
// Anything built to a size instead -- cabinetry, appliances, sanitary fixtures,
// furniture -- is a document object carrying its dimensions, see
// model/furnishing.ts.
import { SymbolDef, SymbolCategory } from "./defs";
import { SYMBOLS_ELECTRICAL } from "./electrical";
import { SYMBOLS_WATER } from "./water";
import { SYMBOLS_HEATING } from "./heating";
import { SYMBOLS_VENTILATION } from "./ventilation";
import { SYMBOLS_SAFETY } from "./safety";

export type { SymbolDef, SymbolCategory } from "./defs";

export const CATEGORIES: Array<[SymbolCategory, string]> = [
  ["electrical", "Electrical"], ["water", "Water"],
  ["heating", "Heating & climate"], ["ventilation", "Ventilation"],
  ["safety", "Safety"],
];

/**
 * Which authoring section a category is placed from. The services sections are
 * the terminals of the networks the route tool draws, so they live with it;
 * safety equipment is part of fitting a building out, so it lives with the
 * furnishings. Nothing is listed twice -- a mark has one home.
 */
export type SymbolSection = "services" | "fitout";

export const SECTION_OF: Record<SymbolCategory, SymbolSection> = {
  electrical: "services",
  water: "services",
  heating: "services",
  ventilation: "services",
  safety: "fitout",
};

export const categoriesIn = (section: SymbolSection): SymbolCategory[] =>
  CATEGORIES.map(([c]) => c).filter(c => SECTION_OF[c] === section);

export const SYMBOLS: SymbolDef[] = [
  ...SYMBOLS_ELECTRICAL, ...SYMBOLS_WATER,
  ...SYMBOLS_HEATING, ...SYMBOLS_VENTILATION, ...SYMBOLS_SAFETY,
];

const byType = new Map(SYMBOLS.map(s => [s.type, s]));
export function getSymbol(type: string): SymbolDef | undefined { return byType.get(type); }
export const SYMBOL_TYPES = SYMBOLS.map(s => s.type);
