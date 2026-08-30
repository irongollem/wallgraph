// The geometry one vide contributes to an export, as plain primitives.
//
// The mark replays through the same recorder a symbol and a stair do; the label
// is added by hand because it is placed upright in world space and so cannot be
// recorded from inside the vide's own frame.
import { Vide } from "../model/vide";
import { videLabelAt, VIDE_LABEL_SIZE } from "../core/vide";
import { videMark } from "../render/vide";
import { recordSymbol, Prim } from "./record";

export function videPrims(vd: Vide, fallbackLabel: string): Prim[] {
  const out = recordSymbol({ draw: ctx => videMark(ctx, vd) }, vd.x, vd.y, vd.rotation, false);
  const text = vd.label ?? fallbackLabel;
  if (text) out.push({ kind: "text", at: videLabelAt(vd), size: VIDE_LABEL_SIZE, text });
  return out;
}
