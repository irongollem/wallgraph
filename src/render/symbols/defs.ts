// Symbol interface. Every symbol is a top-view line drawing on canvas.
//
// Drawing contract for draw(ctx):
//   - ctx is already transformed: 1 unit = 1 mm.
//   - Origin (0,0) is the ANCHOR:
//       wall-mounted:  midpoint of the wall-touching edge; +y points INTO the room.
//       free-standing: centre of the footprint.
//   - Footprint: wall-mounted x in [-width/2, width/2], y in [0, depth];
//                free-standing x in [-width/2, width/2], y in [-depth/2, depth/2].
//   - Line drawings: use ctx.stroke(); never set strokeStyle/fillStyle (caller
//     owns color, and selection highlighting rides on it). Fills via ctx.fill()
//     inherit the caller's fillStyle, which drawSymbol keeps equal to the
//     stroke colour.
//   - Text is allowed ONLY where the standard's own symbol contains it: the "k"
//     on a koolzuursneeuwblusser triangle, the "RM" in a rookmelder circle. NEN
//     defines those marks with the character in them, so a symbol without it is
//     a different symbol, not a simplified one. Draw it with code() below --
//     never ctx.fillText directly, and never for a name or a caption we chose
//     to add. Those are still the caller's job, in screen space (see drawLabel).
//   - Set ctx.lineWidth = 20 and wrap in ctx.save()/ctx.restore().
export type SymbolCategory =
  | "electrical" | "water" | "heating" | "ventilation" | "safety";

/**
 * The height a device of this type is ordinarily mounted at, mm above the
 * finished floor, or "ceiling" for one fixed to the soffit -- a light point
 * sits at the storey height, whatever that storey's height happens to be.
 *
 * A CONVENTION, not a rule the drawing enforces: it is what the panel offers
 * and what the takeoff assumes when nobody typed a figure, and any instance
 * may state its own (SymbolInstance.height). It is set only where a single
 * ordinary height genuinely exists -- 300 for a wandcontactdoos, 1050 for a
 * schakelaar, the ceiling for a light point. A device whose height follows the
 * fixture it serves rather than a convention (a tappunt, a radiator, a
 * cv-ketel) carries none, and reads as unstated until someone says otherwise.
 */
export type MountHeight = number | "ceiling";

export interface SymbolDef {
  type: string;          // unique kebab-case id
  label: string;         // short English palette label
  category: SymbolCategory;
  wallMounted: boolean;
  width: number;         // mm along the wall (or footprint width)
  depth: number;         // mm away from the wall (or footprint depth)
  /** Ordinary mounting height for this type; absent means no convention. */
  mountHeight?: MountHeight;
  draw(ctx: CanvasRenderingContext2D): void;
}

export function withCtx(ctx: CanvasRenderingContext2D, fn: () => void): void {
  ctx.save();
  ctx.lineWidth = 20;
  ctx.beginPath();
  fn();
  ctx.restore();
}

/**
 * A character that is part of the standard's symbol: the "k" on a
 * koolzuursneeuwblusser triangle, the "RM" in a rookmelder circle. Positioned
 * at (x, y) in the symbol's own mm space, sized in mm.
 *
 * Orientation is the part that is not like the rest of draw(). The glyph is
 * placed by the instance transform but not turned by it, so it stays upright
 * and readable however the symbol is rotated or mirrored. That is not a licence
 * we took: a rotated "p" is a "d" and a mirrored one is a "q", so letting the
 * character ride the transform would quietly draw a different symbol -- turning
 * a poederblusser into nothing that is on the sheet. Plan annotation is upright
 * for exactly this reason.
 *
 * It also paints in the current strokeStyle, so the character highlights along
 * with the rest of the symbol on selection.
 */
export function code(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  // Where (x, y) lands, and how big a mm is, under the instance transform --
  // then redraw the axes square so only position and scale survive.
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  ctx.setTransform(scale, 0, 0, scale, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  ctx.font = size + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Length of the connection stub on an appliance outline. */
export const STUB = 70;

/**
 * "Toestel": the appliance outline as the standard draws it -- the footprint
 * box plus a stub on the edge facing the supply, which is what distinguishes
 * an installation symbol from a plain furniture outline. Wall-mounted
 * appliances put the stub on the wall edge, pointing into the wall.
 */
export function applianceBox(ctx: CanvasRenderingContext2D, w: number, d: number): void {
  ctx.rect(-w / 2, 0, w, d);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -STUB);
}

/** Filled dot, the mark burners and drains are drawn with. */
export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
}

/** Open circle. Kept off any preceding subpath. */
export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** The asterisk that marks refrigeration: three lines crossing at the centre. */
export function asterisk(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
}

/** A horizontal wave of `humps` half-periods, centred on (x, y). */
export function wave(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, humps: number, amp: number,
): void {
  const seg = w / humps;
  ctx.moveTo(x - w / 2, y);
  for (let i = 0; i < humps; i++) {
    const x1 = x - w / 2 + (i + 1) * seg;
    ctx.quadraticCurveTo(x1 - seg / 2, y + (i % 2 ? amp : -amp), x1, y);
  }
}

/**
 * Open V arrowhead with its tip at (x, y), barbs opening back along dirDeg
 * (degrees, y-down). Air-direction marks are the reason this is shared: the
 * supply and extract points differ only in which way the barbs face.
 */
export function arrowHead(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, dirDeg: number, len = 60, spread = 30,
): void {
  for (const off of [spread, -spread]) {
    const a = ((dirDeg + 180 + off) * Math.PI) / 180;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
}

/** Rectangle with both ends on one axis rounded to a half-circle. */
export function rounded(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
