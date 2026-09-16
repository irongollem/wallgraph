// The geometry one deck contributes to an export, as plain primitives. The mark
// replays through the recorder; the label is added in world space, upright, as
// a vide's is.
import { Deck } from "../model/deck";
import { deckLabelAt, DECK_LABEL_SIZE } from "../core/deck";
import type { DeckJoistLayout } from "../core/trimmer";
import { deckMark } from "../render/deck";
import { recordSymbol, Prim } from "./record";

/** `layout` (issue #64) draws the shortened joists, header and doubled
 *  trimmer marks on the same joist layer deckMark() itself draws -- the
 *  caller already has it from core/trimmer.ts's deckJoistLayout(), since
 *  io/svg.ts and io/dxf.ts both need the floor for other elements anyway. */
export function deckPrims(d: Deck, fallbackLabel: string, layout?: DeckJoistLayout): Prim[] {
  const out = recordSymbol({ draw: ctx => deckMark(ctx, d, layout) }, d.x, d.y, d.rotation, false);
  const text = d.label ?? fallbackLabel;
  if (text) out.push({ kind: "text", at: deckLabelAt(d), size: DECK_LABEL_SIZE, text });
  return out;
}
