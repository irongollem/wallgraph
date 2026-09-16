// SVG export of one wall's elevation ("aanzicht"), replayed from the same
// drawing the dialog's own canvas uses (render/frame.ts) through the symbol
// recorder (io/record.ts) -- the same path a stair or a vide exports
// through -- so the downloaded file cannot disagree with what the dialog
// shows.
import type { WallElevation } from "../core/frame";
import { drawElevation } from "../render/frame";
import { recordSymbol } from "./record";
import { primSvg } from "./svg";
import { saveViaHost, downloadBlob } from "./save";

/** Paper margin around the elevation, mm. */
const MARGIN_MM = 200;
/** Line weight, mm -- matches the plan's own opening/post outline weight
 *  (see W_OPENING in io/svg.ts), which is the closest existing figure to a
 *  frame member's outline. */
const W_FRAME = 12;

/** The elevation as a standalone SVG document string, at true scale. */
export function frameSvg(e: WallElevation): string {
  const prims = recordSymbol({ draw: ctx => drawElevation(ctx, e) }, 0, 0, 0, false);
  const minX = -MARGIN_MM, minY = -MARGIN_MM;
  const w = e.lengthMm + 2 * MARGIN_MM, h = e.heightMm + 2 * MARGIN_MM;
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"` +
    ` width="${w}mm" height="${h}mm" viewBox="${minX} ${minY} ${w} ${h}">` +
    `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#fff"/>` +
    `<g fill="none" stroke="currentColor" stroke-width="${W_FRAME}"` +
    ` stroke-linecap="round" stroke-linejoin="round" color="#26292e">` +
    prims.map(p => primSvg(p)).join("") + `</g></svg>\n`;
}

export type FrameSvgResult = "saved" | "failed";

/** `wallLabel` names the file, e.g. the wall's length in mm. */
export async function exportFrameSvg(e: WallElevation, wallLabel: string): Promise<FrameSvgResult> {
  const body = frameSvg(e);
  const filename = `frame-${wallLabel}.svg`;
  if (await saveViaHost(filename, () => body)) return "saved";
  if (downloadBlob(filename, new Blob([body], { type: "image/svg+xml" }))) return "saved";
  return "failed";
}
