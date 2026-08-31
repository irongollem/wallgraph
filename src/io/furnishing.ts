// The geometry one furnishing contributes to an export, as plain primitives.
//
// The mark is replayed through the same recorder a symbol uses, so SVG, DXF and
// PDF need no per-form code. The annotation is added separately because it is
// drawn upright in world space and so cannot be recorded from inside the
// furnishing's own frame.
import { Prim, recordSymbol } from "./record";
import { Furnishing } from "../model/furnishing";
import { furnishingLabelAt, FURNISHING_LABEL_SIZE } from "../core/furnishing";
import { furnishingMark } from "../render/furnishing";

export function furnishingPrims(f: Furnishing): Prim[] {
  const out = recordSymbol(
    { draw: ctx => furnishingMark(ctx, f) },
    f.x, f.y, f.rotation, !!f.mirrored,
  );
  if (f.label) {
    out.push({ kind: "text", at: furnishingLabelAt(f), size: FURNISHING_LABEL_SIZE, text: f.label });
  }
  return out;
}
