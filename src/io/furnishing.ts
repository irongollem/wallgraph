// The geometry one furnishing contributes to an export, as plain primitives.
//
// The mark is replayed through the same recorder a symbol uses, so SVG, DXF and
// PDF need no per-form code. The annotation is added separately because it is
// drawn upright in world space and so cannot be recorded from inside the
// furnishing's own frame.
import { Prim, recordSymbol } from "./record";
import { Furnishing } from "../model/furnishing";
import { furnishingClearance, furnishingLabelAt, FURNISHING_LABEL_SIZE } from "../core/furnishing";
import { furnishingMark, furnishingClearanceMark } from "../render/furnishing";

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

/**
 * The reserved zone beside the piece, apart from its body: the recorder drops
 * the dash, so the SVG carries it on a group and the DXF on its own layer.
 * Empty for a form with no clearance.
 */
export function furnishingClearancePrims(f: Furnishing): Prim[] {
  if (!furnishingClearance(f)) return [];
  return recordSymbol(
    { draw: ctx => furnishingClearanceMark(ctx, f) },
    f.x, f.y, f.rotation, !!f.mirrored,
  );
}
