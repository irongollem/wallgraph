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
import { deckBox, deckJoistsLocal, deckLabelAt, deckRaised, deckSpanMm, DECK_LABEL_SIZE } from "../core/deck";
import type { DeckJoistLayout, JoistSegment } from "../core/trimmer";
import { BEAM_DASH } from "./structure";
import { withCtx } from "./symbols/defs";

/** Two parallel lines this far apart, mm, read the doubled trimmer the
 *  materials takeoff counts -- a single thicker stroke would read as one
 *  wider member, not two ordinary joists side by side. */
const TRIMMER_GAP_MM = 40;

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
  /** This deck's own trimmed joist layout (issue #64, core/trimmer.ts's
   *  deckJoistLayout()) -- the caller (render/draw.ts) already has the
   *  floor to derive it from, so drawDeck() takes it rather than a Floor.
   *  Undefined draws every joist full length, the pre-#64 behaviour (a
   *  ghost preview, which has no floor to check for holes). */
  layout?: DeckJoistLayout;
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
  deckMark(ctx, d, paint.layout);
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

/** A layout segment clipped to the deck's own clear platform along the span
 *  axis -- deckJoistLayout()'s full/cut/trimmer segments are extended by the
 *  bearing at a true deck edge (the physical timber length), but the 2D mark
 *  draws only the platform itself, the same convention an ordinary joist's
 *  own deckJoistsLocal() already draws to. */
function clipToBox(seg: JoistSegment, axisIsX: boolean, spanHalf: number): JoistSegment {
  const clip = (n: number): number => Math.max(-spanHalf, Math.min(spanHalf, n));
  return axisIsX
    ? { a: { x: clip(seg.a.x), y: seg.a.y }, b: { x: clip(seg.b.x), y: seg.b.y } }
    : { a: { x: seg.a.x, y: clip(seg.a.y) }, b: { x: seg.b.x, y: clip(seg.b.y) } };
}

/** The outline, and either the plain joist centrelines (no `layout`, or a
 *  deck the layout says has no holes) or -- where a hole cuts the deck
 *  (issue #64) -- the shortened joists either side, the header across the
 *  hole and the doubled trimmers, ALL read off core/trimmer.ts's
 *  deckJoistLayout() rather than re-derived here, so the drawing can never
 *  show a joist running through a hole the materials takeoff (core/
 *  materials.ts's deckTakeoffOf()) already cut. In the deck's own
 *  millimetres. */
export function deckMark(ctx: CanvasRenderingContext2D, d: Deck, layout?: DeckJoistLayout): void {
  const b = deckBox(d);
  const axisIsX = d.joistAxis === "x";
  const spanHalf = deckSpanMm(d) / 2;
  withCtx(ctx, () => {
    ctx.beginPath();
    ctx.rect(b.x0, b.y0, d.width, d.depth);
    ctx.stroke();
    ctx.beginPath();

    if (!layout) {
      for (const j of deckJoistsLocal(d)) { ctx.moveTo(j.a.x, j.a.y); ctx.lineTo(j.b.x, j.b.y); }
    } else {
      for (const j of [...layout.full, ...layout.cut]) {
        const c = clipToBox(j, axisIsX, spanHalf);
        ctx.moveTo(c.a.x, c.a.y); ctx.lineTo(c.b.x, c.b.y);
      }
      for (const h of layout.headers) { ctx.moveTo(h.a.x, h.a.y); ctx.lineTo(h.b.x, h.b.y); }
      for (const tr of layout.trimmers) {
        const c = clipToBox(tr, axisIsX, spanHalf);
        // Two parallel lines, a purely legible gap (TRIMMER_GAP_MM) either
        // side of the trimmer's own centreline -- a real doubled trimmer has
        // no gap at all (two members side by side, touching); a 3D/IFC
        // consumer places them that way instead (core/deck.ts's
        // deckSolids()).
        const dx = axisIsX ? 0 : TRIMMER_GAP_MM / 2;
        const dy = axisIsX ? TRIMMER_GAP_MM / 2 : 0;
        ctx.moveTo(c.a.x - dx, c.a.y - dy); ctx.lineTo(c.b.x - dx, c.b.y - dy);
        ctx.moveTo(c.a.x + dx, c.a.y + dy); ctx.lineTo(c.b.x + dx, c.b.y + dy);
      }
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
