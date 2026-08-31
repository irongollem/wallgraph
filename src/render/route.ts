// One discipline's worth of routes on the canvas.
//
// A route is a thin polyline over the plan rather than a footprint object, so
// it follows the wall/opening convention (a colour change on selection) more
// than the symbol/vide/stair/cabinet one (a dashed frame around a box) --
// there is no box, and a route can run the whole diagonal of a plan, where a
// frame around its bounds would highlight everything between its ends.
import { ResolvedRoute, ResolvedRouteSegment } from "../core/route";
import { RoutePoint, routeKind, routeWater, routeVent } from "../model/route";
import { Vec } from "../geometry/vec";
import { arcInfo } from "../geometry/arc";
import { dot, circle } from "./symbols/defs";

/** World mm. Matches a symbol's own stroke weight (defs.ts sets lineWidth=20).
 *  Exported so io/svg.ts and input/tools.ts draw the same base width rather
 *  than each restating the figure (see ROUTE_AFVOER_EXTRA_MM and
 *  ROUTE_VENT_EXTRA_MM just below for the same reasoning). */
export const LINE_WIDTH_MM = 25;
const DOT_R_MM = 40;
const CIRCLE_R_MM = 45;

/**
 * Dash pattern for an electrical data run (utp/coax), mm -- same figures as a
 * wall cabinet's overhead dash (render/cabinet.ts's OVERHEAD_DASH), so the
 * convention reads the same wherever it appears. A power run stays solid.
 */
export const ROUTE_DATA_DASH: readonly [number, number] = [90, 60];

/** Dash pattern for an afvoer run -- longer than the data dash so a wider,
 *  heavier line still reads as dashed rather than as a row of dots. */
export const ROUTE_AFVOER_DASH: readonly [number, number] = [140, 80];

/** How much wider than LINE_WIDTH_MM an afvoer run draws -- a drain pipe is
 *  physically larger than a supply pipe, so its line carries that. Exported
 *  so the SVG export can widen its own afvoer sub-group by the same figure
 *  (see io/svg.ts). */
export const ROUTE_AFVOER_EXTRA_MM = 15;

/**
 * How much wider than LINE_WIDTH_MM every vent run draws, toevoer and afvoer
 * alike -- a duct is a spatial object even in plan, unlike a cable or a pipe,
 * so its line reads as one from the start rather than only once it happens to
 * be dashed. Exported so the SVG export widens its own vent group by the same
 * figure (see io/svg.ts); DXF carries no line-width concept for a LINE
 * entity, so this has no DXF counterpart.
 */
export const ROUTE_VENT_EXTRA_MM = 20;

export interface RoutePaint {
  ink: string;
  selected?: boolean;
  select?: string;
  /** Wide translucent stroke drawn along the same path first, as a halo --
   *  not a bounding wash, which for a route spanning the whole plan would
   *  highlight everything between its ends rather than the route itself. */
  wash?: string;
}

function strokePath(ctx: CanvasRenderingContext2D, segments: ResolvedRouteSegment[]): void {
  ctx.beginPath();
  for (const s of segments) {
    if (s.bulge === 0) {
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      continue;
    }
    const info = arcInfo(s.a, s.b, s.bulge);
    if (!info) { ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); continue; }
    ctx.moveTo(s.a.x, s.a.y);
    ctx.arc(info.center.x, info.center.y, info.radius, info.a0, info.a1, info.ccw);
  }
  ctx.stroke();
}

/**
 * One route: the resolved line (segments already carry the corridor-fan
 * offset, see core/route.ts) plus a mark at every waypoint -- a filled dot
 * where the point stands free, an open circle where it follows a symbol.
 * Waypoints are drawn at their TRUE resolved position, not the fanned line,
 * so a vertex always sits exactly where dragging it will pick it up; inside a
 * bundled corridor it can therefore sit a lane's width off the line it caps.
 */
export function drawRoute(
  ctx: CanvasRenderingContext2D, resolved: ResolvedRoute, points: RoutePoint[], waypoints: Vec[],
  paint: RoutePaint,
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (paint.selected && paint.wash) {
    ctx.strokeStyle = paint.wash;
    ctx.lineWidth = LINE_WIDTH_MM + 90;
    strokePath(ctx, resolved.segments);
  }
  const ink = paint.selected && paint.select ? paint.select : paint.ink;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  // A data run (utp/coax) draws dashed; a power run and every non-electrical
  // discipline stay solid, except afvoer (water's drain, vent's extract),
  // which is always dashed. A vent run also draws wider than the rest,
  // toevoer and afvoer alike -- a duct is a spatial object even in plan (see
  // ROUTE_VENT_EXTRA_MM); water's afvoer widens only on its own, being a
  // physically larger pipe than the supply legs. The wash above is
  // deliberately left undashed/un-widened -- it is a highlight glow, not
  // part of the run's own line.
  const isVent = resolved.route.discipline === "vent";
  const isWaterAfvoer = resolved.route.discipline === "water" && routeWater(resolved.route) === "afvoer";
  const isVentAfvoer = isVent && routeVent(resolved.route) === "afvoer";
  const dashed = isWaterAfvoer || isVentAfvoer
    || (resolved.route.discipline === "electrical" && routeKind(resolved.route) !== "power");
  ctx.lineWidth = isWaterAfvoer ? LINE_WIDTH_MM + ROUTE_AFVOER_EXTRA_MM
    : isVent ? LINE_WIDTH_MM + ROUTE_VENT_EXTRA_MM
    : LINE_WIDTH_MM;
  if (dashed) ctx.setLineDash([...(isWaterAfvoer || isVentAfvoer ? ROUTE_AFVOER_DASH : ROUTE_DATA_DASH)]);
  strokePath(ctx, resolved.segments);
  if (dashed) ctx.setLineDash([]);

  const degree = new Map<string, number>();
  for (const s of resolved.route.segments) {
    degree.set(s.a, (degree.get(s.a) ?? 0) + 1);
    degree.set(s.b, (degree.get(s.b) ?? 0) + 1);
  }
  for (let i = 0; i < waypoints.length; i++) {
    const p = waypoints[i]!;
    const point = points[i]!;
    const n = degree.get(point.id) ?? 0;
    if (n >= 3) {
      dot(ctx, p.x, p.y, DOT_R_MM + 12);
    } else if (n === 1 && point.anchor) {
      ctx.beginPath();
      circle(ctx, p.x, p.y, CIRCLE_R_MM);
      ctx.stroke();
    } else if (n === 1 && point.terminal === "capped") {
      const segment = resolved.segments.find(s => s.pointA === point.id || s.pointB === point.id);
      if (segment) {
        const other = segment.pointA === point.id ? segment.b : segment.a;
        const d = VecNorm({ x: p.x - other.x, y: p.y - other.y });
        const q = { x: -d.y * 55, y: d.x * 55 };
        ctx.beginPath(); ctx.moveTo(p.x - q.x, p.y - q.y); ctx.lineTo(p.x + q.x, p.y + q.y); ctx.stroke();
      }
    } else if (n === 1 && point.terminal === "source") {
      const r = 52;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.stroke();
    } else if (n === 1) {
      // An unclassified loose endpoint remains visibly incomplete until it is
      // anchored to a device or marked as a source/cap.
      ctx.beginPath(); circle(ctx, p.x, p.y, CIRCLE_R_MM); ctx.stroke();
    }
  }
  ctx.restore();
}

function VecNorm(p: Vec): Vec {
  const length = Math.hypot(p.x, p.y);
  return length > 0 ? { x: p.x / length, y: p.y / length } : { x: 1, y: 0 };
}
