// PNG export.
//
// The plan is re-rendered offscreen with the same renderer the canvas uses,
// framed to its own bounds, with no grid and no editor chrome. The whole scene
// is drawn through the hidpi path that already exists (`vp.dpr` + a scaled
// transform), so screen-space text — room areas — scales with the image
// instead of shrinking into a corner of it.
//
// A scale bar goes in the corner because a bare image has no units: whatever
// the viewer's screen or printer does to the pixels, the bar stays true. True
// paper-scale output (1:50 at 300 dpi) and vector formats are still the P1 item.
import { PlanDoc, areaModeOf, dimModeOf } from "../model/doc";
import { resolveFloor } from "../core/resolve";
import { planBounds } from "../core/bounds";
import { detectRooms } from "../core/rooms";
import { Viewport } from "../render/viewport";
import { drawScene, COLORS } from "../render/draw";
import { v } from "../geometry/vec";
import { saveViaHost, downloadBlob } from "./save";

const FILENAME = "floorplan.png";
/** Paper margin around the plan, in mm of world space. */
const MARGIN_MM = 500;
/** Logical (CSS-px) size the plan is fitted into, before the pixel multiplier. */
const LOGICAL_MAX = 1200;
/** Pixel multiplier — 3600 px on the long edge, which prints cleanly at A3. */
const SCALE = 3;

export type PngResult = "saved" | "copied" | "empty" | "failed";

/** Round bar lengths, coarse to fine — a plan can be a housing block or a closet. */
const BAR_STEPS = [10000, 5000, 2000, 1000, 500, 200, 100];

/** Largest round metric bar that stays under a quarter of the image width. */
export function scaleBarMm(pxPerMm: number, logicalW: number): number {
  for (const mm of BAR_STEPS) if (mm * pxPerMm <= logicalW * 0.25) return mm;
  return BAR_STEPS[BAR_STEPS.length - 1]!;
}

function drawScaleBar(ctx: CanvasRenderingContext2D, pxPerMm: number, w: number, h: number): void {
  const mm = scaleBarMm(pxPerMm, w);
  const len = mm * pxPerMm;
  const x = 24, y = h - 24;
  ctx.save();
  ctx.strokeStyle = COLORS.roomLabel;
  ctx.fillStyle = COLORS.roomLabel;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
  ctx.moveTo(x + len, y - 5); ctx.lineTo(x + len, y + 5);
  ctx.stroke();
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(mm >= 1000 ? `${mm / 1000} m` : `${mm} mm`, x, y - 10);
  ctx.restore();
}

/** Render the plan to a PNG canvas. Null when there is nothing to draw. */
function renderPlan(doc: PlanDoc, floorIndex = 0): HTMLCanvasElement | null {
  const floor = doc.floors[floorIndex] ?? doc.floors[0];
  if (!floor) return null;
  const resolved = resolveFloor(floor);
  const bounds = planBounds(floor, resolved);
  if (!bounds) return null;

  const wMm = bounds.max.x - bounds.min.x + 2 * MARGIN_MM;
  const hMm = bounds.max.y - bounds.min.y + 2 * MARGIN_MM;
  const pxPerMm = LOGICAL_MAX / Math.max(wMm, hMm);
  const lw = Math.ceil(wMm * pxPerMm), lh = Math.ceil(hMm * pxPerMm);

  const cv = document.createElement("canvas");
  cv.width = lw * SCALE;
  cv.height = lh * SCALE;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

  const vp = new Viewport();
  vp.pxPerMm = pxPerMm;
  vp.dpr = SCALE;
  vp.origin = v(bounds.min.x - MARGIN_MM, bounds.min.y - MARGIN_MM);

  drawScene(ctx, vp, lw, lh, floor, resolved, detectRooms(floor), null, { showGrid: false }, doc.gridMm, areaModeOf(doc), dimModeOf(doc));
  drawScaleBar(ctx, pxPerMm, lw, lh);
  return cv;
}

/** Renders one storey — the one on screen, not always the ground floor. */
export async function exportPng(doc: PlanDoc, floorIndex = 0): Promise<PngResult> {
  const cv = renderPlan(doc, floorIndex);
  if (!cv) return "empty";

  if (await saveViaHost(FILENAME, () => cv.toDataURL("image/png"))) return "saved";

  const blob = await new Promise<Blob | null>(res => cv.toBlob(b => res(b), "image/png"));
  if (!blob) return "failed";
  if (downloadBlob(FILENAME, blob)) return "saved";

  // Last resort: the image on the clipboard. ClipboardItem is absent in some
  // browsers, in which case the constructor throws and we admit the failure.
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch { return "failed"; }
}
