// The geometry every anchored, rotated, box-shaped object shares: where its
// corners land, and whether a point is inside it.
//
// A stair and a vide are both a rectangle placed at an anchor and turned, and
// the transform between world and local millimetres is the same maths for both.
// It lives here once so a hit-test and an export crop cannot drift apart.
import { Vec, v } from "../geometry/vec";

/** Local-space bounds, in the object's own millimetres. */
export interface LocalBox { x0: number; y0: number; x1: number; y1: number }

/** Anything with an anchor, a rotation and an optional mirror. */
export interface Placed { x: number; y: number; rotation: number; mirrored?: boolean }

/** A world point in the object's own frame. */
export function localPoint(p: Placed, world: Vec): Vec {
  const cos = Math.cos(p.rotation), sin = Math.sin(p.rotation);
  const dx = world.x - p.x, dy = world.y - p.y;
  const lx = dx * cos + dy * sin;
  return v(p.mirrored ? -lx : lx, -dx * sin + dy * cos);
}

/** The box's four corners in world millimetres, for framing and cropping. */
export function boxCorners(p: Placed, b: LocalBox): Vec[] {
  const cos = Math.cos(p.rotation), sin = Math.sin(p.rotation);
  const out: Vec[] = [];
  for (const lx of [b.x0, b.x1])
    for (const ly of [b.y0, b.y1])
      out.push(v(p.x + lx * cos - ly * sin, p.y + lx * sin + ly * cos));
  return out;
}

/** True when `world` is inside the box, grown by `margin` mm. */
export function boxHit(p: Placed, b: LocalBox, world: Vec, margin = 0): boolean {
  const l = localPoint(p, world);
  return l.x >= b.x0 - margin && l.x <= b.x1 + margin
      && l.y >= b.y0 - margin && l.y <= b.y1 + margin;
}

/** A local point in world millimetres — where an upright label goes. */
export function worldPoint(p: Placed, local: Vec): Vec {
  const cos = Math.cos(p.rotation), sin = Math.sin(p.rotation);
  const lx = p.mirrored ? -local.x : local.x;
  return v(p.x + lx * cos - local.y * sin, p.y + lx * sin + local.y * cos);
}

/**
 * Where the anchor has to move to for the object to turn to `rotation` about
 * the middle of its box instead of about the anchor itself.
 *
 * A stair and a cabinet are anchored to the edge that meets the wall, so
 * turning one about its anchor swings the whole object across the plan: a
 * quarter turn moves it as well as pointing it elsewhere. Turning about the
 * middle leaves it where it was put. Whole millimetres, per the document's
 * integer rule.
 */
export function turnAbout(p: Placed, b: LocalBox, rotation: number): { x: number; y: number } {
  const mid = v((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  const at = worldPoint(p, mid);
  const after = worldPoint({ x: 0, y: 0, rotation, mirrored: p.mirrored }, mid);
  return { x: Math.round(at.x - after.x), y: Math.round(at.y - after.y) };
}

/** The footprint shape a symbol draw(ctx) contract describes: wall-mounted x
 *  in [-width/2, width/2], y in [0, depth]; free-standing y in
 *  [-depth/2, depth/2] (see defs.ts). */
export interface SymbolFootprintDef { wallMounted: boolean; width: number; depth: number }

/**
 * A placed symbol's four rotated footprint corners in world millimetres.
 * Shared by core/bounds.ts (plan framing), input/marquee.ts (rubber-band
 * selection) and io/ifc.ts (extruded export geometry) so the corner walk
 * cannot drift between the three.
 */
export function symbolFootprintCorners(def: SymbolFootprintDef, p: Placed): Vec[] {
  const y0 = def.wallMounted ? 0 : -def.depth / 2;
  const box: LocalBox = { x0: -def.width / 2, y0, x1: def.width / 2, y1: y0 + def.depth };
  return [
    worldPoint(p, v(box.x0, box.y0)),
    worldPoint(p, v(box.x1, box.y0)),
    worldPoint(p, v(box.x1, box.y1)),
    worldPoint(p, v(box.x0, box.y1)),
  ];
}
