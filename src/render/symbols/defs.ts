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
//     owns color). Small filled position dots (radius <= 15mm) via ctx.fill()
//     are the one exception. No text (ctx.fillText is forbidden).
//   - Set ctx.lineWidth = 20 and wrap in ctx.save()/ctx.restore().
export type SymbolCategory =
  | "electrical" | "water" | "sanitary" | "heating" | "safety" | "kitchen" | "furniture";

export interface SymbolDef {
  type: string;          // unique kebab-case id
  label: string;         // short English palette label
  category: SymbolCategory;
  wallMounted: boolean;
  width: number;         // mm along the wall (or footprint width)
  depth: number;         // mm away from the wall (or footprint depth)
  draw(ctx: CanvasRenderingContext2D): void;
}

export function withCtx(ctx: CanvasRenderingContext2D, fn: () => void): void {
  ctx.save();
  ctx.lineWidth = 20;
  ctx.beginPath();
  fn();
  ctx.restore();
}
