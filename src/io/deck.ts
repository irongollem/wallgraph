// The geometry one deck contributes to an export, as plain primitives. The mark
// replays through the recorder; the label is added in world space, upright, as
// a vide's is.
import { Deck } from "../model/deck";
import { deckLabelAt, DECK_LABEL_SIZE } from "../core/deck";
import { deckMark } from "../render/deck";
import { recordSymbol, Prim } from "./record";

export function deckPrims(d: Deck, fallbackLabel: string): Prim[] {
  const out = recordSymbol({ draw: ctx => deckMark(ctx, d) }, d.x, d.y, d.rotation, false);
  const text = d.label ?? fallbackLabel;
  if (text) out.push({ kind: "text", at: deckLabelAt(d), size: DECK_LABEL_SIZE, text });
  return out;
}
