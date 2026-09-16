// Pure rectangle-resize math for a deck or a vide's drag handles (issue #65).
//
// Nothing here knows about Deck or Vide -- it operates on a box's width and
// depth in the object's own LOCAL frame, the same frame core/placed.ts's
// localPoint()/worldPoint() convert to and from. The caller (input/tools.ts)
// converts the world pointer to local coordinates against the object's pose
// AT THE START of the drag (rotation held constant through it, since a
// resize never turns the object), calls resizeRect(), then turns the
// returned local centre OFFSET back into a world delta with that same
// original pose -- which is what keeps the opposite corner or edge exactly
// fixed in world space through a rotated drag: the fixed side's local
// coordinate never changes, only the dragged side's does.
import type { Vec } from "../geometry/vec";

export type ResizeHandle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w";

/** Every handle's local position on a box symmetric about the origin (an
 *  anchor is always a deck/vide's centre -- see deckBox()/videBox()), plus
 *  whether it is a corner (both axes drag) or an edge midpoint (one axis). */
export const RESIZE_HANDLES: ReadonlyArray<{ id: ResizeHandle; corner: boolean }> = [
  { id: "nw", corner: true }, { id: "ne", corner: true },
  { id: "se", corner: true }, { id: "sw", corner: true },
  { id: "n", corner: false }, { id: "e", corner: false },
  { id: "s", corner: false }, { id: "w", corner: false },
];

/** Which side of the axis this handle drags: -1 the x0/y0 side, +1 the
 *  x1/y1 side, 0 not dragged (an edge handle only drags one axis). */
const X_SIDE: Record<ResizeHandle, -1 | 0 | 1> = { nw: -1, sw: -1, w: -1, ne: 1, se: 1, e: 1, n: 0, s: 0 };
const Y_SIDE: Record<ResizeHandle, -1 | 0 | 1> = { nw: -1, ne: -1, n: -1, sw: 1, se: 1, s: 1, e: 0, w: 0 };

export function handleLocalPoint(h: ResizeHandle, width: number, depth: number): Vec {
  return { x: X_SIDE[h] * width / 2, y: Y_SIDE[h] * depth / 2 };
}

export interface ResizeOpts {
  /** Shortest and longest a side (width or depth) may come to. */
  min: number;
  max: number;
  /** Shift: keep the box's own width:depth ratio at drag start. */
  keepAspect?: boolean;
  /** Alt: resize about the centre -- both opposite sides move together,
   *  neither stays put. */
  aboutCenter?: boolean;
}

export interface ResizeResult {
  width: number;
  depth: number;
  /** The new centre as an offset from the ORIGINAL centre, in the object's
   *  own (pre-drag) local millimetres. worldPoint() at the original pose
   *  turns this into the world delta to add to x/y. */
  dx: number;
  dy: number;
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

/** The scale factor Shift applies to BOTH dimensions: from whichever axis
 *  the handle actually drags, or the one that moved furthest from its start
 *  when both do (a corner). An edge handle only drags one axis, so that one
 *  always wins -- keeping the ratio still changes the other dimension too. */
function pickScale(sx: number, sy: number, affectsX: boolean, affectsY: boolean): number {
  if (!affectsY) return sx;
  if (!affectsX) return sy;
  return Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
}

/** A uniform scale clamped so BOTH w0*s and d0*s land inside [min, max]. */
function clampScale(s: number, w0: number, d0: number, min: number, max: number): number {
  if (w0 <= 0 || d0 <= 0) return 1;
  const lo = Math.max(min / w0, min / d0);
  const hi = Math.min(max / w0, max / d0);
  return clamp(s, lo, hi);
}

/** One axis's [lo, hi] after dragging `side` to `target`, the fixed side
 *  held exactly and the moving one clamped so the size stays in [min, max]
 *  -- past the opposite side stops at the minimum rather than flipping. */
function resizedAxis(lo0: number, hi0: number, side: -1 | 0 | 1, target: number, min: number, max: number): [number, number] {
  if (side < 0) { const size = Math.round(clamp(hi0 - target, min, max)); return [hi0 - size, hi0]; }
  if (side > 0) { const size = Math.round(clamp(target - lo0, min, max)); return [lo0, lo0 + size]; }
  return [lo0, hi0];
}

export function resizeRect(
  box: { width: number; depth: number }, handle: ResizeHandle, localPointer: Vec, opts: ResizeOpts,
): ResizeResult {
  const { min, max } = opts;
  const w0 = box.width, d0 = box.depth;
  const affectsX = X_SIDE[handle] !== 0, affectsY = Y_SIDE[handle] !== 0;

  if (opts.aboutCenter) {
    let width = affectsX ? clamp(Math.abs(localPointer.x) * 2, min, max) : w0;
    let depth = affectsY ? clamp(Math.abs(localPointer.y) * 2, min, max) : d0;
    if (opts.keepAspect) {
      const s = clampScale(pickScale(width / w0, depth / d0, affectsX, affectsY), w0, d0, min, max);
      width = w0 * s; depth = d0 * s;
    }
    return { width: Math.round(width), depth: Math.round(depth), dx: 0, dy: 0 };
  }

  let [x0, x1] = resizedAxis(-w0 / 2, w0 / 2, X_SIDE[handle], localPointer.x, min, max);
  let [y0, y1] = resizedAxis(-d0 / 2, d0 / 2, Y_SIDE[handle], localPointer.y, min, max);

  if (opts.keepAspect) {
    const s = clampScale(pickScale((x1 - x0) / w0, (y1 - y0) / d0, affectsX, affectsY), w0, d0, min, max);
    const width = w0 * s, depth = d0 * s;
    // Re-anchor each axis on whichever side stayed fixed above (x1/y1 for a
    // negative-side drag, x0/y0 for a positive one); an axis this handle
    // never dragged (side 0) grows symmetrically about the centre instead,
    // there being no dragged reference to anchor it on.
    const fixedX1 = x1, fixedX0 = x0, fixedY1 = y1, fixedY0 = y0;
    if (X_SIDE[handle] < 0) { x0 = fixedX1 - width; x1 = fixedX1; }
    else if (X_SIDE[handle] > 0) { x0 = fixedX0; x1 = fixedX0 + width; }
    else { x0 = -width / 2; x1 = width / 2; }
    if (Y_SIDE[handle] < 0) { y0 = fixedY1 - depth; y1 = fixedY1; }
    else if (Y_SIDE[handle] > 0) { y0 = fixedY0; y1 = fixedY0 + depth; }
    else { y0 = -depth / 2; y1 = depth / 2; }
  }

  return {
    width: Math.round(x1 - x0), depth: Math.round(y1 - y0),
    dx: (x0 + x1) / 2, dy: (y0 + y1) / 2,
  };
}
