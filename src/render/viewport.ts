// mm <-> px transform with pan/zoom.
import { Vec, v } from "../geometry/vec";

export class Viewport {
  pxPerMm = 0.12;         // ~1:833 to start; zoom range below
  origin: Vec = v(-1000, -1000); // world mm at canvas (0,0)
  dpr = 1;

  toScreen(p: Vec): Vec { return v((p.x - this.origin.x) * this.pxPerMm, (p.y - this.origin.y) * this.pxPerMm); }
  toWorld(s: Vec): Vec { return v(s.x / this.pxPerMm + this.origin.x, s.y / this.pxPerMm + this.origin.y); }

  zoomAt(screen: Vec, factor: number): void {
    const before = this.toWorld(screen);
    this.pxPerMm = Math.max(0.01, Math.min(2, this.pxPerMm * factor));
    const after = this.toWorld(screen);
    this.origin = v(this.origin.x + before.x - after.x, this.origin.y + before.y - after.y);
  }

  panPx(dx: number, dy: number): void {
    this.origin = v(this.origin.x - dx / this.pxPerMm, this.origin.y - dy / this.pxPerMm);
  }
}
