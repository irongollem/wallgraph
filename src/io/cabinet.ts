// The geometry one cabinet contributes to an export, as plain primitives.
//
// The mark replays through the same recorder a symbol, a stair and a vide do;
// the label is added by hand because it is placed upright in world space and so
// cannot be recorded from inside the cabinet's own frame.
//
// The recorder discards dash patterns — a dash is a screen concern, and a CAD
// file carries it on the layer instead. A wall unit therefore exports as solid
// geometry on its own layer; see LAYER in dxf.ts and the dashed group in svg.ts.
import { Cabinet } from "../model/cabinet";
import { cabinetLabelAt, CABINET_LABEL_SIZE } from "../core/cabinet";
import { cabinetMark } from "../render/cabinet";
import { recordSymbol, Prim } from "./record";

export function cabinetPrims(c: Cabinet): Prim[] {
  const out = recordSymbol(
    { draw: ctx => cabinetMark(ctx, c) },
    c.x, c.y, c.rotation, !!c.mirrored,
  );
  if (c.label) out.push({ kind: "text", at: cabinetLabelAt(c), size: CABINET_LABEL_SIZE, text: c.label });
  return out;
}
