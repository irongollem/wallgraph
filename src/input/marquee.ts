// Rubber-band selection: pure geometry, no DOM/Tools coupling, so it is
// unit-testable on a bare Floor. Tools.ts converts the dragged screen rect to
// world mm and hands it here; the result feeds store.selectMany().
import { Floor, Id, stairsOf, videsOf, cabinetsOf, routesOf } from "../model/doc";
import type { SelKind } from "../model/store";
import { Vec, v } from "../geometry/vec";
import { getSymbol } from "../render/symbols";
import { resolveFloor } from "../core/resolve";
import { stairCorners, resolveStair } from "../core/stair";
import { videCorners } from "../core/vide";
import { cabinetCorners } from "../core/cabinet";
import { resolveRoutePoints } from "../core/route";

export interface MarqueeRect { min: Vec; max: Vec }

/**
 * Dominant-kind tie-break order, highest priority first: the kind with the
 * most objects caught by the rect wins outright, and only a tie between
 * counts falls back to this order. Node is not in MULTI_SELECT_KINDS at all
 * -- a marquee never picks nodes, same as a shift-click never does.
 */
const KIND_PRIORITY: readonly SelKind[] =
  ["symbol", "cabinet", "stair", "vide", "route", "opening", "wall"];

function inRect(r: MarqueeRect, p: Vec): boolean {
  return p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;
}

/** Every point of a footprint has to fall inside the rect -- a corner or an
 *  endpoint poking out means the object is only partly caught. */
function allIn(r: MarqueeRect, pts: readonly Vec[]): boolean {
  return pts.length > 0 && pts.every(p => inRect(r, p));
}

/** The rotated footprint corners of a placed symbol -- the same shape
 *  planBounds() (core/bounds.ts) walks, duplicated rather than shared because
 *  that helper returns a growing box, not a point list. */
function symbolFootprint(s: { x: number; y: number; rotation: number; type: string }): Vec[] {
  const def = getSymbol(s.type);
  if (!def) return [];
  const y0 = def.wallMounted ? 0 : -def.depth / 2;
  const cos = Math.cos(s.rotation), sin = Math.sin(s.rotation);
  const pts: Vec[] = [];
  for (const lx of [-def.width / 2, def.width / 2])
    for (const ly of [y0, y0 + def.depth])
      pts.push(v(s.x + lx * cos - ly * sin, s.y + lx * sin + ly * cos));
  return pts;
}

/** Every object of every multi-select-eligible kind fully inside `rect`. */
function candidatesByKind(floor: Floor, rect: MarqueeRect): Map<SelKind, Id[]> {
  const out = new Map<SelKind, Id[]>();
  const add = (kind: SelKind, id: Id): void => {
    const list = out.get(kind);
    if (list) list.push(id); else out.set(kind, [id]);
  };

  for (const s of floor.symbols) if (allIn(rect, symbolFootprint(s))) add("symbol", s.id);
  for (const cb of cabinetsOf(floor)) if (allIn(rect, cabinetCorners(cb))) add("cabinet", cb.id);
  for (const st of stairsOf(floor)) if (allIn(rect, stairCorners(resolveStair(floor, st)))) add("stair", st.id);
  for (const vd of videsOf(floor)) if (allIn(rect, videCorners(vd))) add("vide", vd.id);
  for (const rt of routesOf(floor)) if (allIn(rect, resolveRoutePoints(floor, rt))) add("route", rt.id);

  // Walls and openings share resolveFloor()'s work: a wall's both endpoints,
  // an opening's two jambs (the centerline points resolveFloor already
  // carries for carving the wall around it).
  const resolved = resolveFloor(floor);
  for (const rw of resolved.walls.values()) {
    for (const og of rw.openings) if (allIn(rect, [og.p0, og.p1])) add("opening", og.opening.id);
    if (allIn(rect, [rw.a, rw.b])) add("wall", rw.wall.id);
  }
  return out;
}

/**
 * Everything of the DOMINANT kind fully inside `rect`: the kind with the most
 * matches wins; a tie resolves by KIND_PRIORITY. Null when the rect catches
 * nothing selectable.
 */
export function marqueePick(floor: Floor, rect: MarqueeRect): { kind: SelKind; ids: Id[] } | null {
  const byKind = candidatesByKind(floor, rect);
  let best: SelKind | null = null;
  for (const kind of KIND_PRIORITY) {
    const ids = byKind.get(kind);
    if (!ids || ids.length === 0) continue;
    if (best === null || ids.length > byKind.get(best)!.length) best = kind;
  }
  if (best === null) return null;
  return { kind: best, ids: byKind.get(best)! };
}
