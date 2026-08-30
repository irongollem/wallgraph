// Derived vide geometry. Nothing here is stored: the opening's corners, what it
// covers and where its label sits all follow from the anchor, the rotation and
// the two dimensions.
import { Vide } from "../model/vide";
import { Vec, v } from "../geometry/vec";
import { boxCorners, boxHit, worldPoint, type LocalBox } from "./placed";

/** Local bounds. The anchor is the centre, so the box is symmetric both ways. */
export function videBox(vd: Vide): LocalBox {
  return { x0: -vd.width / 2, y0: -vd.depth / 2, x1: vd.width / 2, y1: vd.depth / 2 };
}

export function videCorners(vd: Vide): Vec[] { return boxCorners(vd, videBox(vd)); }

export function videHit(vd: Vide, p: Vec, margin = 0): boolean {
  return boxHit(vd, videBox(vd), p, margin);
}

/** Height of the word on the drawing, mm. */
export const VIDE_LABEL_SIZE = 200;

/**
 * Where the word goes: inside the top edge rather than at the centre, which is
 * where the diagonals cross. Placed here and drawn upright by the caller, so a
 * turned vide does not carry turned text.
 */
export function videLabelAt(vd: Vide): Vec {
  const inset = Math.min(VIDE_LABEL_SIZE, vd.depth / 3);
  return worldPoint({ ...vd, mirrored: false }, v(0, -vd.depth / 2 + inset));
}
