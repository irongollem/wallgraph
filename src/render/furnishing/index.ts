// One placed furnishing on the canvas.
//
// The mark itself is per form (./cabinet, ./kitchen, ./sanitary, ./furniture);
// everything around it -- the transform, the selection frame and wash, the
// annotation -- is the same for all of them, which is the point of one document
// object rather than a parallel one per kind.
//
// A wall cabinet and an afzuigkap draw dashed. They hang entirely above the
// plan's section plane, so they are overhead work, and a plattegrond draws
// overhead work dashed -- the same reason a vide is drawn with its diagonals
// rather than as a plain rectangle.
//
// Colours arrive as arguments, as they do for a stair and a vide, so this
// module and draw.ts need not import each other.
import { Furnishing, furnishingOverhead } from "../../model/furnishing";
import { furnishingBox, furnishingLabelAt, FURNISHING_LABEL_SIZE } from "../../core/furnishing";
import { withCtx } from "../symbols/defs";
import { cabinetMark } from "./cabinet";
import { applianceMarkDraw, counterMark } from "./kitchen";
import {
  toiletMark, urinalMark, urinalTroughMark, bidetMark, basinMark, basinTroughMark,
  bathMark, showerMark, showerHeadMark,
} from "./sanitary";
import { bedMark, seatMark, tableMark, tableRoundMark, deskMark, rackMark } from "./furniture";

/** Grab margin around the footprint, mm — the symbols' and stairs' figure. */
const FRAME = 30;

/** Dash pattern for overhead work, in mm. */
const OVERHEAD_DASH = [90, 60];

export interface FurnishingPaint {
  /** One screen pixel in mm, for line widths that must not scale with zoom. */
  px: number;
  ink: string;
  selected?: boolean;
  select?: string;
  wash?: string;
}

const MARKS: Record<Furnishing["form"], (ctx: CanvasRenderingContext2D, f: Furnishing) => void> = {
  cabinet: cabinetMark,
  appliance: applianceMarkDraw,
  counter: counterMark,
  toilet: toiletMark,
  urinal: urinalMark,
  "urinal-trough": urinalTroughMark,
  bidet: bidetMark,
  basin: basinMark,
  "basin-trough": basinTroughMark,
  bath: bathMark,
  shower: showerMark,
  "shower-head": showerHeadMark,
  bed: bedMark,
  seat: seatMark,
  table: tableMark,
  "table-round": tableRoundMark,
  desk: deskMark,
  rack: rackMark,
};

/**
 * Everything the furnishing draws, in its own millimetres. Split out so the
 * export recorder replays exactly what the canvas shows.
 */
export function furnishingMark(ctx: CanvasRenderingContext2D, f: Furnishing): void {
  withCtx(ctx, () => {
    if (furnishingOverhead(f)) ctx.setLineDash(OVERHEAD_DASH);
    MARKS[f.form](ctx, f);
  });
}

export function drawFurnishing(
  ctx: CanvasRenderingContext2D, f: Furnishing, paint: FurnishingPaint,
): void {
  const b = furnishingBox(f);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.rotation);
  if (f.mirrored) ctx.scale(-1, 1);

  if (paint.selected && paint.wash) {
    ctx.fillStyle = paint.wash;
    ctx.fillRect(b.x0 - FRAME, b.y0 - FRAME, f.width + 2 * FRAME, f.depth + 2 * FRAME);
  }

  ctx.strokeStyle = paint.ink;
  ctx.fillStyle = ctx.strokeStyle;
  furnishingMark(ctx, f);

  if (paint.selected && paint.select) {
    ctx.strokeStyle = paint.select;
    ctx.lineWidth = 1.5 * paint.px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(b.x0 - FRAME, b.y0 - FRAME, f.width + 2 * FRAME, f.depth + 2 * FRAME);
    ctx.setLineDash([]);
  }
  ctx.restore();

  if (f.label) drawFurnishingLabel(ctx, f, paint.ink);
}

/** Upright in world space, as the stair and vide annotations are. */
function drawFurnishingLabel(ctx: CanvasRenderingContext2D, f: Furnishing, ink: string): void {
  const at = furnishingLabelAt(f);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${FURNISHING_LABEL_SIZE}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(f.label!, at.x, at.y);
  ctx.restore();
}

/** The placement preview: the same mark, half transparent. */
export function drawFurnishingGhost(
  ctx: CanvasRenderingContext2D, f: Furnishing, ink: string,
): void {
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.rotation);
  if (f.mirrored) ctx.scale(-1, 1);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ctx.strokeStyle;
  furnishingMark(ctx, f);
  ctx.restore();
}
