// What the canvas can be told to hold back.
//
// A plattegrond carries several drawings at once — the fabric, the fit-out and
// a services network per discipline — and only one of them is being worked on
// at a time. A layer is the unit that can be switched off, and the unit the
// active tool fades: drawing walls with every socket, duct and radiator at full
// ink is reading four drawings to edit one.
//
// The fabric — walls, openings, stairs, vides, rooms — has no key here. It is
// what every other layer is placed against, so it is always drawn at full ink.
import type { Discipline } from "../model/route";
import type { SymbolCategory } from "./symbols";

export type LayerKey = Discipline | "heating" | "safety" | "furnishing";

export const LAYER_KEYS: readonly LayerKey[] = [
  "electrical", "water", "heating", "vent", "gas", "safety", "furnishing",
];

/** Which layer a symbol's category belongs to. Routes key on their discipline. */
export const LAYER_OF_CATEGORY: Record<SymbolCategory, LayerKey> = {
  electrical: "electrical",
  water: "water",
  heating: "heating",
  ventilation: "vent",
  safety: "safety",
};

export type LayerFlags = Record<LayerKey, boolean>;

export const allLayersOn = (): LayerFlags => ({
  electrical: true, water: true, heating: true, vent: true, gas: true,
  safety: true, furnishing: true,
});

/** How faint a layer the current tool cannot touch is drawn. */
export const DIM_ALPHA = 0.22;

/**
 * The alpha a layer draws at: hidden, faded because the armed tool cannot act
 * on it, or full. An export passes neither argument and gets full ink for
 * everything — a drawing that is handed on carries no editor state.
 */
export function layerAlpha(
  key: LayerKey, layers?: LayerFlags, dim?: readonly LayerKey[],
): number {
  if (layers?.[key] === false) return 0;
  return dim?.includes(key) ? DIM_ALPHA : 1;
}
