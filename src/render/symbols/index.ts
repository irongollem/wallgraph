// Aggregated symbol registry. Categories render in this order in the palette.
import { SymbolDef, SymbolCategory } from "./defs";
import { SYMBOLS_ELECTRICAL } from "./electrical";
import { SYMBOLS_WATER } from "./water";
import { SYMBOLS_SANITARY } from "./sanitary";
import { SYMBOLS_HEATING } from "./heating";
import { SYMBOLS_VENTILATION } from "./ventilation";
import { SYMBOLS_SAFETY } from "./safety";
import { SYMBOLS_KITCHEN } from "./kitchen";
import { SYMBOLS_FURNITURE } from "./furniture";

export type { SymbolDef, SymbolCategory } from "./defs";

export const CATEGORIES: Array<[SymbolCategory, string]> = [
  ["electrical", "Electrical"], ["water", "Water"], ["sanitary", "Sanitary"],
  ["heating", "Heating & climate"], ["ventilation", "Ventilation"],
  ["safety", "Safety"], ["kitchen", "Kitchen"], ["furniture", "Furniture"],
];

export const SYMBOLS: SymbolDef[] = [
  ...SYMBOLS_ELECTRICAL, ...SYMBOLS_WATER, ...SYMBOLS_SANITARY,
  ...SYMBOLS_HEATING, ...SYMBOLS_VENTILATION, ...SYMBOLS_SAFETY, ...SYMBOLS_KITCHEN,
  ...SYMBOLS_FURNITURE,
];

const byType = new Map(SYMBOLS.map(s => [s.type, s]));
export function getSymbol(type: string): SymbolDef | undefined { return byType.get(type); }
export const SYMBOL_TYPES = SYMBOLS.map(s => s.type);
