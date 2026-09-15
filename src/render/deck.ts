// One placed deck on the canvas.
//
// The mark is the platform's outline with a line at each joist centre. A deck
// at a height lies above the section plane and is drawn dashed, as a beam is;
// a balklaag at floor level is the floor itself and is drawn solid. The word
// goes inside the top edge, upright.
//
// Colours arrive as arguments, as they do for a vide, so this module and
// draw.ts need not import each other. A dash is a screen concern: the marks
// set none, and the SVG and DXF carry the distinction on their group and layer.
import { Deck } from "../model/deck";
import { deckBox, deckJoistsLocal, deckLabelAt, deckRaised, DECK_LABEL_SIZE } from "../core/deck";
import { BEAM_DASH } from "./structure";
import { withCtx } from "./symbols/defs";

/** Grab margin around the platform, mm — the symbols' and stairs' figure. */
const FRAME = 30;

export interface DeckPaint {
  /** One screen pixel in mm, for line widths that must not scale with zoom. */
  px: number;
  ink: string;
  /** The word drawn when the deck carries no label of its own. */
  fallbackLabel: string;
  selected?: boolean;
  select?: string;
  wash?: string;
}

export function drawDeck(ctx: CanvasRenderingContext2D, d: Deck, paint: DeckPaint): void {
  const b = deckBox(d);
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rotation);

  if (paint.selected && paint.wash) {
    ctx.fillStyle = paint.wash;
    ctx.fillRect(b.x0 - FRAME, b.y0 - FRAME, d.width + 2 * FRAME, d.depth + 2 * FRAME);
  }

  ctx.strokeStyle = paint.ink;
  ctx.fillStyle = ctx.strokeStyle;
  if (deckRaised(d)) ctx.setLineDash([...BEAM_DASH]);
  deckMark(ctx, d);
  ctx.setLineDash([]);

  if (paint.selected && paint.select) {
    ctx.strokeStyle = paint.select;
    ctx.lineWidth = 1.5 * paint.px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(b.x0 - FRAME, b.y0 - FRAME, d.width + 2 * FRAME, d.depth + 2 * FRAME);
    ctx.setLineDash([]);
  }
  ctx.restore();

  drawDeckLabel(ctx, d, paint.ink, paint.fallbackLabel);
}

/** The outline and the joist centrelines, in the deck's own millimetres. */
export function deckMark(ctx: CanvasRenderingContext2D, d: Deck): void {
  const b = deckBox(d);
  withCtx(ctx, () => {
    ctx.beginPath();
    ctx.rect(b.x0, b.y0, d.width, d.depth);
    ctx.stroke();
    ctx.beginPath();
    for (const j of deckJoistsLocal(d)) {
      ctx.moveTo(j.a.x, j.a.y);
      ctx.lineTo(j.b.x, j.b.y);
    }
    ctx.stroke();
  });
}

function drawDeckLabel(ctx: CanvasRenderingContext2D, d: Deck, ink: string, fallback: string): void {
  const text = d.label ?? fallback;
  if (!text) return;
  const at = deckLabelAt(d);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${DECK_LABEL_SIZE}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

/** The placement preview: the same mark, half transparent. */
export function drawDeckGhost(ctx: CanvasRenderingContext2D, d: Deck, ink: string): void {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rotation);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ctx.strokeStyle;
  deckMark(ctx, d);
  ctx.restore();
}
