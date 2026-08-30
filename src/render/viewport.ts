// mm <-> px transform with pan/zoom.
import { Vec, v } from "../geometry/vec";

/**
 * Zoom limits, in screen pixels per millimetre. The lower bound frames a plan
 * about a kilometre across; the upper puts two pixels on a millimetre, which is
 * past any scale a plan is drawn at. Both are named because fitting a box has
 * to clamp to the same range panning and wheeling do — a fit that set a zoom
 * the wheel could not return to would strand the view.
 */
export const MIN_PX_PER_MM = 0.01;
export const MAX_PX_PER_MM = 2;

/** Paper margin left around a fitted box, in world millimetres. */
export const FIT_MARGIN_MM = 500;

export class Viewport {
  pxPerMm = 0.12;         // ~1:833 to start; zoom range above
  origin: Vec = v(-1000, -1000); // world mm at canvas (0,0)
  dpr = 1;

  toScreen(p: Vec): Vec { return v((p.x - this.origin.x) * this.pxPerMm, (p.y - this.origin.y) * this.pxPerMm); }
  toWorld(s: Vec): Vec { return v(s.x / this.pxPerMm + this.origin.x, s.y / this.pxPerMm + this.origin.y); }

  zoomAt(screen: Vec, factor: number): void {
    const before = this.toWorld(screen);
    this.pxPerMm = clampZoom(this.pxPerMm * factor);
    const after = this.toWorld(screen);
    this.origin = v(this.origin.x + before.x - after.x, this.origin.y + before.y - after.y);
  }

  panPx(dx: number, dy: number): void {
    this.origin = v(this.origin.x - dx / this.pxPerMm, this.origin.y - dy / this.pxPerMm);
  }

  /**
   * Frame a world-space box in a canvas `w` x `h` CSS pixels, centred, with
   * `margin` mm of paper around it.
   *
   * This is the one place a view is fitted. Zoom-all, zoom-to-selection, the
   * zoom window and every zone in the zoom pane all land here, so a plan and a
   * single room are framed by identical arithmetic and the exports that fit
   * their own offscreen viewport behave the same as the canvas.
   */
  fitBox(w: number, h: number, min: Vec, max: Vec, margin = FIT_MARGIN_MM): void {
    // A degenerate box is a real case — one node, or a zero-width drag — and
    // must not divide by zero or zoom to infinity.
    const bw = Math.max(1, max.x - min.x + 2 * margin);
    const bh = Math.max(1, max.y - min.y + 2 * margin);
    this.pxPerMm = clampZoom(Math.min(Math.max(1, w) / bw, Math.max(1, h) / bh));
    const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2;
    this.origin = v(cx - w / (2 * this.pxPerMm), cy - h / (2 * this.pxPerMm));
  }
}

export function clampZoom(pxPerMm: number): number {
  return Math.max(MIN_PX_PER_MM, Math.min(MAX_PX_PER_MM, pxPerMm));
}
