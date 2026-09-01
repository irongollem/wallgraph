// How high a placed device sits above its storey's finished floor, and what
// that height costs a run that reaches it.
//
// Derived, never stored twice. An instance may state its own height
// (SymbolInstance.height); otherwise the type's convention is read from the
// registry (SymbolDef.mountHeight), and a ceiling device resolves against the
// storey height rather than a fixed figure -- lower the storey and the light
// point comes down with it. A type with no convention and no stated height has
// no height at all: the takeoff leaves it out and says how many it left out,
// rather than assuming a number nobody chose.
import { Floor, floorHeight, SymbolInstance } from "../model/doc";
import { getSymbol } from "../render/symbols";
import { worldPoint } from "./placed";
import type { Vec } from "../geometry/vec";

/**
 * The device's mounting height, mm above this storey's finished floor, or
 * undefined when neither the instance nor its type states one.
 */
export function symbolMountHeight(floor: Floor, s: SymbolInstance): number | undefined {
  if (s.height !== undefined) return s.height;
  return defaultMountHeight(floor, s.type);
}

/** The type's own conventional height on this storey, resolved. */
export function defaultMountHeight(floor: Floor, type: string): number | undefined {
  const mount = getSymbol(type)?.mountHeight;
  if (mount === undefined) return undefined;
  return mount === "ceiling" ? floorHeight(floor) : mount;
}

/** True when the instance carries a height of its own rather than the type's. */
export function hasOwnMountHeight(s: SymbolInstance): boolean {
  return s.height !== undefined;
}

/**
 * Whole mm within the storey it stands on -- a device cannot be mounted below
 * the floor or above the ceiling of the room it is drawn in. The upper bound
 * follows the storey rather than being a constant, so a 3600 mm storey can
 * carry a light at 3600.
 */
export function clampMountHeight(floor: Floor, n: number): number {
  return Math.max(0, Math.min(floorHeight(floor), Math.round(isFinite(n) ? n : 0)));
}

/**
 * The mounting-height annotation for one device: what it says and where it is
 * written, world mm.
 *
 * Written in MILLIMETRES, not the centimetres a Dutch installatietekening
 * conventionally uses. Every other figure this editor puts on a plan -- a
 * dimension line, a wall thickness, a stair going -- is in mm, and one field
 * in a second unit is a misreading waiting to happen; the "+" carries the
 * "above finished floor" the cm convention leaves implicit.
 *
 * Placed beside the mark rather than on it, in the symbol's own frame, so it
 * turns and mirrors with the device and never lands on the wall the device is
 * mounted to. World-space text at the same size the riser marks use, so the
 * canvas, the SVG and the DXF all write it identically.
 */
export interface MountMark { at: Vec; text: string; size: number }

/** How far past the footprint's edge the figure is written, mm. */
const MARK_GAP = 140;
/** Cap height, mm. Matches the riser tag (render/route.ts). */
export const MOUNT_MARK_SIZE = 90;

export function mountMarkOf(floor: Floor, s: SymbolInstance): MountMark | null {
  const def = getSymbol(s.type);
  if (!def) return null;
  const height = symbolMountHeight(floor, s);
  if (height === undefined) return null;
  const local = { x: def.width / 2 + MARK_GAP, y: def.wallMounted ? def.depth / 2 : 0 };
  return { at: worldPoint(s, local), text: "+" + height, size: MOUNT_MARK_SIZE };
}
