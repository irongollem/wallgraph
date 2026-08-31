// What a plan occupies in world space.
//
// One function, because everything that frames a plan has to agree: the PNG
// crop, the SVG viewBox, and — since zoom-all landed — the canvas view itself.
// A second implementation is how a plan comes to export with its symbols intact
// and open on screen with them cropped off, which is exactly what happened while
// main.ts fitted the view to the node positions alone.
import { Floor, stairsOf, videsOf, furnishingsOf, roomNamesOf, routesOf } from "../model/doc";
import { Resolved } from "./resolve";
import { getSymbol } from "../render/symbols";
import { stairCorners, resolveStair } from "./stair";
import { videCorners } from "./vide";
import { furnishingCorners } from "./furnishing";
import { resolveRoutePoints, resolveRoutes } from "./route";
import { symbolFootprintCorners } from "./placed";
import { arcFlatten } from "../geometry/arc";
import { Vec, v } from "../geometry/vec";

export interface Bounds { min: Vec; max: Vec }

/** Tight world-space bounds of everything drawn. Null when the floor is empty. */
export function planBounds(floor: Floor, resolved: Resolved): Bounds | null {
  const b = new Grower();
  // Resolved outlines, not centerlines: they carry thickness and miters, so a
  // thick exterior wall isn't sliced in half by the crop.
  for (const rw of resolved.walls.values()) for (const p of rw.outline) b.add(p.x, p.y);
  for (const n of floor.nodes) b.add(n.x, n.y);
  for (const s of floor.symbols) {
    const def = getSymbol(s.type);
    if (!def) continue;
    // The four footprint corners, rotated into place. A symmetric box around
    // the anchor would be wrong for wall-mounted symbols: their footprint runs
    // y in [0, depth] on one side only, so a box would pad the frame with
    // empty paper outside the building. Mirroring is a no-op here — the
    // footprint is symmetric in x. See the draw(ctx) contract in defs.ts.
    for (const c of symbolFootprintCorners(def, s)) b.add(c.x, c.y);
  }
  // A stair's footprint depends on its parameters, so the corners come from the
  // same derived box the hit-test and the selection frame use.
  for (const st of stairsOf(floor)) for (const c of stairCorners(resolveStair(floor, st))) b.add(c.x, c.y);
  for (const vd of videsOf(floor)) for (const c of videCorners(vd)) b.add(c.x, c.y);
  for (const fn of furnishingsOf(floor)) for (const c of furnishingCorners(fn)) b.add(c.x, c.y);
  // Resolved, so a run following a moved symbol crops where it is actually
  // drawn, and the corridor fan (core/route.ts) never crops off a lane.
  // Bulged segments are flattened so the arc's bow past the chord is
  // included — the endpoints alone would let a curved route cross the crop.
  for (const rr of resolveRoutes(floor)) for (const s of rr.segments) {
    for (const p of arcFlatten(s.a, s.b, s.bulge, 2)) b.add(p.x, p.y);
  }
  // A one-point route is a cross-floor starter: its riser mark still occupies
  // the plan even before a local segment has been drawn from it.
  for (const route of routesOf(floor)) {
    for (const p of resolveRoutePoints(floor, route)) b.add(p.x, p.y);
  }
  // A room name is a point, and a plan that is nothing but names still has to
  // frame somewhere rather than reporting itself empty.
  for (const rn of roomNamesOf(floor)) b.add(rn.x, rn.y);
  return b.result();
}

/** Bounds of a polygon, for framing one room. */
export function polyBounds(poly: Vec[]): Bounds | null {
  const b = new Grower();
  for (const p of poly) b.add(p.x, p.y);
  return b.result();
}

class Grower {
  private minX = Infinity; private minY = Infinity;
  private maxX = -Infinity; private maxY = -Infinity;
  add(x: number, y: number): void {
    if (this.minX > x) this.minX = x;
    if (this.minY > y) this.minY = y;
    if (this.maxX < x) this.maxX = x;
    if (this.maxY < y) this.maxY = y;
  }
  result(): Bounds | null {
    return isFinite(this.minX)
      ? { min: v(this.minX, this.minY), max: v(this.maxX, this.maxY) }
      : null;
  }
}
