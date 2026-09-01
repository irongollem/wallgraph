// One discipline's worth of routes on the canvas.
//
// A route is a thin polyline over the plan rather than a footprint object, so
// it follows the wall/opening convention (a colour change on selection) more
// than the symbol/vide/stair/furnishing one (a dashed frame around a box) --
// there is no box, and a route can run the whole diagonal of a plan, where a
// frame around its bounds would highlight everything between its ends.
import { ResolvedRoute, ResolvedRouteSegment } from "../core/route";
import { RoutePoint, Route, routeKind, routeWater, routeVent, routeBoreMm } from "../model/route";
import { Vec } from "../geometry/vec";
import type { ResolvedRiserMark } from "../core/continuation";
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
 * wall cabinet's overhead dash (render/furnishing's OVERHEAD_DASH), so the
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

/**
 * The width one run's own line draws at, mm. The line states the KIND of run --
 * a drain reads heavier than a supply leg, a duct heavier again -- which is a
 * separate signal from how big the thing actually is; see routeBandMm below
 * for that. One function so the canvas, the SVG and the draft preview cannot
 * drift apart.
 */
export function routeLineWidthMm(r: Route): number {
  if (r.discipline === "vent") return LINE_WIDTH_MM + ROUTE_VENT_EXTRA_MM;
  if (r.discipline === "water" && routeWater(r) === "afvoer") {
    return LINE_WIDTH_MM + ROUTE_AFVOER_EXTRA_MM;
  }
  return LINE_WIDTH_MM;
}

/**
 * The footprint band, mm: the run drawn at the size it is actually built to,
 * under its own line.
 *
 * A 200 duct occupies 200 mm of a ceiling or a shaft, and a drawing that shows
 * it as a line the same weight as a 15 mm supply pipe cannot answer whether it
 * fits. Only returned when the bore EXCEEDS the line already drawn for that
 * run: below that the band would be narrower than the line covering it and
 * would state nothing, which is why a 15-28 mm pipe keeps the plain line it
 * always had and a duct or a soil stack gains a footprint.
 */
export function routeBandMm(r: Route): number | undefined {
  const bore = routeBoreMm(r);
  if (bore === undefined) return undefined;
  return bore >= ROUTE_BAND_MIN_MM && bore > routeLineWidthMm(r) ? bore : undefined;
}

/**
 * The smallest bore drawn as a footprint, mm.
 *
 * Below this a run is something threaded through the construction rather than
 * something room has to be found for -- a 15-28 mm supply or CV leg goes where
 * it is told. It also keeps the band from appearing three millimetres wider
 * than the line covering it, which would read as a printing fault rather than
 * as a size. From 50 up the run is a duct or a soil stack: a hole gets made for
 * it, and the drawing has to be able to answer whether it fits.
 */
export const ROUTE_BAND_MIN_MM = 50;

/**
 * The band's ink: the run's own colour at low alpha, as an 8-digit hex so the
 * one string serves the canvas and the SVG alike. Translucent rather than a
 * flat tint because runs cross each other and cross the plan beneath them --
 * a footprint has to show what it passes over, or it reads as a wall.
 */
export function routeBandInk(ink: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(ink) ? ink + "2e" : ink;
}

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
  paint: RoutePaint, linkedPoints: ReadonlySet<string> = new Set(),
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const band = routeBandMm(resolved.route);
  if (paint.selected && paint.wash) {
    ctx.strokeStyle = paint.wash;
    // Clear of the footprint, or a wide duct's own band would swallow the halo
    // and a selected duct would look no different from an unselected one.
    ctx.lineWidth = (band ?? LINE_WIDTH_MM) + 90;
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
  // The footprint first, undashed and under everything: it says how much room
  // the run needs, while the line over it keeps saying what kind of run it is.
  if (band !== undefined) {
    ctx.strokeStyle = routeBandInk(ink);
    ctx.lineWidth = band;
    strokePath(ctx, resolved.segments);
    ctx.strokeStyle = ink;
  }
  ctx.lineWidth = routeLineWidthMm(resolved.route);
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
    if (linkedPoints.has(point.id)) continue;
    if (n >= 3) {
      dot(ctx, p.x, p.y, DOT_R_MM + 12);
    } else if (n === 2 && point.anchor) {
      // A tap on a trunk: the run passes through, and this is where it reaches
      // the device. Without a mark, the commonest wiring pattern there is --
      // a socket fed from a run that carries on past it -- would be drawn as
      // an unremarkable bend.
      dot(ctx, p.x, p.y, DOT_R_MM);
    } else if (n <= 1 && point.anchor) {
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
    } else if (n === 1 && point.terminal === "external") {
      // Leaves the modelled storeys: an open arrowhead pointing the way out,
      // the same reading the riser marks give a service crossing a slab, minus
      // the circle -- there is no floor at the other end to name.
      const segment = resolved.segments.find(s => s.pointA === point.id || s.pointB === point.id);
      if (segment) {
        const other = segment.pointA === point.id ? segment.b : segment.a;
        const d = VecNorm({ x: p.x - other.x, y: p.y - other.y });
        const back = 70, spread = 42;
        ctx.beginPath();
        ctx.moveTo(p.x - d.x * back - d.y * spread, p.y - d.y * back + d.x * spread);
        ctx.lineTo(p.x, p.y);
        ctx.lineTo(p.x - d.x * back + d.y * spread, p.y - d.y * back - d.x * spread);
        ctx.stroke();
      }
    } else if (n === 1 && point.terminal === "source") {
      const r = 52;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.stroke();
    } else if (n <= 1) {
      // An unclassified loose end remains visibly INCOMPLETE until it is
      // anchored to a device or marked as a source/cap -- crossed through, not
      // the plain open circle an anchored end draws. The two used to be the
      // same mark, which meant a plan could not show the difference between a
      // socket that is wired and one that merely has a wire drawn up to it.
      const arm = CIRCLE_R_MM * 0.62;
      ctx.beginPath();
      circle(ctx, p.x, p.y, CIRCLE_R_MM);
      ctx.moveTo(p.x - arm, p.y - arm); ctx.lineTo(p.x + arm, p.y + arm);
      ctx.moveTo(p.x + arm, p.y - arm); ctx.lineTo(p.x - arm, p.y + arm);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Coincident vertical services remain distinct graph members but share one
 * plan mark with a count, so the mark stays readable and pickable. */
export function drawRiserMarks(
  ctx: CanvasRenderingContext2D, marks: readonly ResolvedRiserMark[], selectedIds: ReadonlySet<string>,
  inkFor: (mark: ResolvedRiserMark) => string,
): void {
  ctx.save();
  ctx.lineWidth = LINE_WIDTH_MM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "90px system-ui, sans-serif";
  for (const mark of marks) {
    const selected = mark.members.some(member => selectedIds.has(member.routeId));
    const ink = selected ? "#2d7de0" : inkFor(mark);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    const r = 78, arrow = 38;
    ctx.beginPath(); circle(ctx, mark.at.x, mark.at.y, r); ctx.stroke();
    const head = (sign: -1 | 1): void => {
      const y = mark.at.y + sign * 48;
      ctx.beginPath();
      ctx.moveTo(mark.at.x, y + sign * arrow);
      ctx.lineTo(mark.at.x - arrow, y - sign * 8);
      ctx.lineTo(mark.at.x + arrow, y - sign * 8);
      ctx.closePath(); ctx.fill();
    };
    if (mark.direction !== "down") head(-1);
    if (mark.direction !== "up") head(1);
    if (mark.members.length > 1) {
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); circle(ctx, mark.at.x, mark.at.y, 34); ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillText(String(mark.members.length), mark.at.x, mark.at.y + 4);
      ctx.restore();
    }
    if (mark.tag) ctx.fillText(mark.tag, mark.at.x, mark.at.y + r + 75);
  }
  ctx.restore();
}

function VecNorm(p: Vec): Vec {
  const length = Math.hypot(p.x, p.y);
  return length > 0 ? { x: p.x / length, y: p.y / length } : { x: 1, y: 0 };
}
