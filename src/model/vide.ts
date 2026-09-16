// A vide as the document stores it: an opening in the floor slab, open to the
// storey below.
//
// It is a feature ON a floor rather than a floor of its own. The slab has a
// hole; the plan of that storey draws it. A trapgat is the same object -- the
// opening a flight from below comes up through, drawn on the plan of the floor
// above -- and the well between the flights of a bordestrap is a small one.
//
// Rectangular, because that is what a vide almost always is and because a
// rectangle can be placed, turned and resized with the fields the rest of the
// editor already has. A vide that follows an irregular room needs polygon
// editing, which is a different job.
import type { Id } from "./doc";

export interface Vide {
  id: Id;
  /** Anchor in world mm: the centre of the opening. Integer. */
  x: number;
  y: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  width: number;
  depth: number;
  /** What the opening is called on the drawing. Absent means the plain word. */
  label?: string;
  /** Pen colour "#rrggbb"; absent means the plan's default ink. */
  color?: string;
}

export interface VideSize { width: number; depth: number }

/**
 * A trapgat over an ordinary steektrap: wide enough for a 900 flight with its
 * strings, and long enough that the head of the flight has standing height.
 */
export const VIDE_DEFAULT: VideSize = { width: 1200, depth: 2600 };

/** Read by the resize handle (issue #65) as well as clampVide() below, so the
 *  drag stops at the same bounds the typed fields already clamp to. */
export const VIDE_LIMITS = { size: { min: 200, max: 50000 } } as const;

/** Whole millimetres, and large enough to be an opening rather than a slot. */
export function clampVide(s: VideSize): VideSize {
  return { width: clampInt(s.width), depth: clampInt(s.depth) };
}

function clampInt(n: number): number {
  const L = VIDE_LIMITS.size;
  return Math.max(L.min, Math.min(L.max, Math.round(isFinite(n) ? n : L.min)));
}
