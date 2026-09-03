// Columns, beams and railings on the canvas.
//
// Three elements, three relations to the section plane, three line
// treatments: a column is cut and takes poché; a beam runs above the plane and
// is dashed; a railing stands below it and is drawn in outline. The label is
// written upright beside the element, as a vide's is.
//
// Colours arrive as arguments, as they do for a stair, so this module and
// draw.ts need not import each other.
import { Structural, Column, Beam, Railing } from "../model/structure";
import {
  columnBox, columnProfile, spanPlaced, spanBox, railingPosts, structureBox, structurePlaced,
  structureLabelAt, STRUCTURE_LABEL_SIZE,
} from "../core/structure";
import { localPoint } from "../core/placed";
import { withCtx } from "./symbols/defs";

/** Grab margin around the element, mm — the symbols' and stairs' figure. */
const FRAME = 30;

/** A beam's dash, mm on and off: the overhead convention the fit-out uses. */
export const BEAM_DASH: readonly number[] = [120, 80];

/** A baluster tick's reach beyond the handrail, each side, mm. */
const POST_TICK = 20;

export interface StructurePaint {
  /** One screen pixel in mm, for line widths that must not scale with zoom. */
  px: number;
  /** The line: a span's outline, a column's edge, the label. */
  ink: string;
  /** A cut column's poché. */
  fill: string;
  selected?: boolean;
  select?: string;
  wash?: string;
}

export function drawStructure(ctx: CanvasRenderingContext2D, el: Structural, paint: StructurePaint): void {
  const p = structurePlaced(el), b = structureBox(el);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);

  if (paint.selected && paint.wash) {
    ctx.fillStyle = paint.wash;
    ctx.fillRect(b.x0 - FRAME, b.y0 - FRAME, b.x1 - b.x0 + 2 * FRAME, b.y1 - b.y0 + 2 * FRAME);
  }

  ctx.strokeStyle = paint.ink;
  ctx.fillStyle = paint.fill;
  if (el.kind === "column") columnMark(ctx, el);
  else if (el.kind === "beam") {
    ctx.setLineDash([...BEAM_DASH]);
    beamMark(ctx, el);
    ctx.setLineDash([]);
  } else railingMark(ctx, el);

  if (paint.selected && paint.select) {
    ctx.strokeStyle = paint.select;
    ctx.lineWidth = 1.5 * paint.px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(b.x0 - FRAME, b.y0 - FRAME, b.x1 - b.x0 + 2 * FRAME, b.y1 - b.y0 + 2 * FRAME);
    ctx.setLineDash([]);
  }
  ctx.restore();

  drawStructureLabel(ctx, el, paint.selected && paint.select ? paint.select : paint.ink);
}

/**
 * The cut section, in the column's own millimetres: filled with whatever
 * fillStyle the caller set, outlined in the stroke. A round column is a true
 * circle here; the recorder flattens it for the exports.
 */
export function columnMark(ctx: CanvasRenderingContext2D, c: Column): void {
  withCtx(ctx, () => {
    ctx.beginPath();
    if (c.shape === "round") {
      ctx.arc(0, 0, c.width / 2, 0, Math.PI * 2);
    } else {
      const pts = columnProfile(c.shape, c.width, c.depth);
      pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  });
}

/** The beam's outline in the span's frame (see spanPlaced): the run along x. */
export function beamMark(ctx: CanvasRenderingContext2D, b: Beam): void {
  const box = spanBox(b);
  withCtx(ctx, () => {
    ctx.beginPath();
    ctx.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.stroke();
  });
}

/** The handrail as two lines and a tick across it at each post. */
export function railingMark(ctx: CanvasRenderingContext2D, r: Railing): void {
  const box = spanBox(r);
  const p = spanPlaced(r);
  withCtx(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(box.x0, box.y0); ctx.lineTo(box.x1, box.y0);
    ctx.moveTo(box.x0, box.y1); ctx.lineTo(box.x1, box.y1);
    for (const post of railingPosts(r)) {
      const l = localPoint(p, post);
      ctx.moveTo(l.x, box.y0 - POST_TICK); ctx.lineTo(l.x, box.y1 + POST_TICK);
    }
    ctx.stroke();
  });
}

/** Upright in world space, as the vide and stair annotations are. */
function drawStructureLabel(ctx: CanvasRenderingContext2D, el: Structural, ink: string): void {
  if (!el.label) return;
  const at = structureLabelAt(el);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${STRUCTURE_LABEL_SIZE}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(el.label, at.x, at.y);
  ctx.restore();
}

/** The placement preview: the same mark, half transparent. */
export function drawStructureGhost(ctx: CanvasRenderingContext2D, el: Structural, ink: string, fill: string): void {
  const p = structurePlaced(el);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = fill;
  if (el.kind === "column") columnMark(ctx, el);
  else if (el.kind === "beam") { ctx.setLineDash([...BEAM_DASH]); beamMark(ctx, el); }
  else railingMark(ctx, el);
  ctx.restore();
}

/** The column's box, for a ghost's own frame. */
export { columnBox };
