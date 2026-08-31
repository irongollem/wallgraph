// One discipline's worth of routes on the canvas.
//
// A route is a thin polyline over the plan rather than a footprint object, so
// it follows the wall/opening convention (a colour change on selection) more
// than the symbol/vide/stair/cabinet one (a dashed frame around a box) --
// there is no box, and a route can run the whole diagonal of a plan, where a
// frame around its bounds would highlight everything between its ends.
import { ResolvedRoute, ResolvedRouteSegment } from "../core/route";
import { RoutePoint, routeKind, routeWater } from "../model/route";
import { Vec } from "../geometry/vec";
import { arcInfo } from "../geometry/arc";
import { dot, circle } from "./symbols/defs";

/** World mm. Matches a symbol's own stroke weight (defs.ts sets lineWidth=20). */
const LINE_WIDTH_MM = 25;
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
  // discipline stay solid, except afvoer, which is always dashed AND heavier
  // -- it is a larger pipe under the floor. The wash above is deliberately
  // left undashed/un-widened -- it is a highlight glow, not part of the run's
  // own line.
  const isAfvoer = resolved.route.discipline === "water" && routeWater(resolved.route) === "afvoer";
  const dashed = isAfvoer || (resolved.route.discipline === "electrical" && routeKind(resolved.route) !== "power");
  ctx.lineWidth = isAfvoer ? LINE_WIDTH_MM + ROUTE_AFVOER_EXTRA_MM : LINE_WIDTH_MM;
  if (dashed) ctx.setLineDash([...(isAfvoer ? ROUTE_AFVOER_DASH : ROUTE_DATA_DASH)]);
  strokePath(ctx, resolved.segments);
  if (dashed) ctx.setLineDash([]);

  for (let i = 0; i < waypoints.length; i++) {
    const p = waypoints[i]!;
    if (points[i]?.anchor) {
      ctx.beginPath();
      circle(ctx, p.x, p.y, CIRCLE_R_MM);
      ctx.stroke();
    } else {
      dot(ctx, p.x, p.y, DOT_R_MM);
    }
  }
  ctx.restore();
}
