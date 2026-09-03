// Structure as recorded primitives, for the SVG and DXF exports. The canvas
// marks are replayed through the recorder at the element's placement, so the
// exports cannot drift from the screen.
import { Structural } from "../model/structure";
import { columnMark, beamMark, railingMark } from "../render/structure";
import { structurePlaced, structureLabelAt, STRUCTURE_LABEL_SIZE } from "../core/structure";
import { recordSymbol, type Prim } from "./record";

/** The element's outline in world millimetres, plus its label where stated. */
export function structurePrims(el: Structural): Prim[] {
  const p = structurePlaced(el);
  const draw = (ctx: CanvasRenderingContext2D): void => {
    if (el.kind === "column") columnMark(ctx, el);
    else if (el.kind === "beam") beamMark(ctx, el);
    else railingMark(ctx, el);
  };
  const prims = recordSymbol({ draw }, p.x, p.y, p.rotation, false);
  if (el.label) prims.push({ kind: "text", at: structureLabelAt(el), size: STRUCTURE_LABEL_SIZE, text: el.label });
  return prims;
}
