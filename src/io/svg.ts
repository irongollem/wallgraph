// SVG export: the plan as vector artwork, at true scale.
//
// Where DXF carries geometry for CAD, this carries the drawing for a document —
// it embeds in Notion, renders on GitHub, drops into a report, and prints crisp
// at any size. So unlike the DXF it looks like the editor does: walls filled,
// rooms tinted, the same palette.
//
// True scale is the point of the header. `width`/`height` are given in
// millimetres and the viewBox matches them one-to-one, so printing at 100% puts
// a 4000 mm wall on paper at 4 m. SVG's y axis runs down exactly as the
// document's does, so — unlike DXF — nothing is flipped.
import { PlanDoc, Floor, areaModeOf, dimModeOf, stairsOf, videsOf, cabinetsOf, roomNamesOf } from "../model/doc";
import { Vec } from "../geometry/vec";
import { resolveFloor } from "../core/resolve";
import { detectRooms, roomSize, sizeLabel, looseRoomNames } from "../core/rooms";
import { getSymbol } from "../render/symbols";
import { COLORS, routeInk, symbolInk } from "../render/draw";
import { ROUTE_DATA_DASH, ROUTE_AFVOER_DASH, ROUTE_AFVOER_EXTRA_MM, ROUTE_VENT_EXTRA_MM, LINE_WIDTH_MM } from "../render/route";
import { stairBox } from "../core/stair";
import { recordSymbol, Prim } from "./record";
import { openingMarks } from "./marks";
import { stairPrims, stairRegionPrims } from "./stair";
import { videPrims } from "./vide";
import { cabinetPrims } from "./cabinet";
import { cabinetOverhead } from "../model/cabinet";
import { videBox } from "../core/vide";
import { resolveStair } from "../core/stair";
import { resolveRoutes } from "../core/route";
import { routePrims } from "./route";
import { DISCIPLINES, routeKind, routeWater, routeVent } from "../model/route";
import { planBounds } from "../core/bounds";
import { saveViaHost, downloadBlob } from "./save";
import { t } from "../i18n";

export type SvgResult = "saved" | "empty" | "failed";

/** Breathing room around the plan, mm — matches the PNG export. */
const MARGIN_MM = 500;

/** Line weights in mm, so they hold their proportion at any print size. */
const W_WALL = 12;
const W_OPENING = 12;
const W_SYMBOL = 16;

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** &, < and > would otherwise end the attribute or open a tag. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A stair's footprint as a world-space quad — the wash where a kind has no
 *  region of its own. */
function boxPoly(b: { x0: number; y0: number; x1: number; y1: number },
                 s: { x: number; y: number; rotation: number }): Vec[] {
  const cos = Math.cos(s.rotation), sin = Math.sin(s.rotation);
  const at = (lx: number, ly: number): Vec =>
    ({ x: s.x + lx * cos - ly * sin, y: s.y + lx * sin + ly * cos });
  return [at(b.x0, b.y0), at(b.x1, b.y0), at(b.x1, b.y1), at(b.x0, b.y1)];
}

function polyPath(pts: Vec[], closed: boolean): string {
  if (pts.length === 0) return "";
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join(" ");
  return closed ? d + " Z" : d;
}

/**
 * An arc as an SVG path. SVG's A command takes an endpoint plus flags rather
 * than angles: large-arc says whether to take the long way, and sweep says
 * which direction. Both fall out of the signed sweep the marks carry.
 */
function arcPath(c: Vec, r: number, startDeg: number, sweepDeg: number): string {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const from: Vec = { x: c.x + Math.cos(rad(startDeg)) * r, y: c.y + Math.sin(rad(startDeg)) * r };
  const to: Vec = {
    x: c.x + Math.cos(rad(startDeg + sweepDeg)) * r,
    y: c.y + Math.sin(rad(startDeg + sweepDeg)) * r,
  };
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0;
  const sweep = sweepDeg >= 0 ? 1 : 0;
  return `M${n(from.x)} ${n(from.y)} A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(to.x)} ${n(to.y)}`;
}

function primPath(p: Prim): string {
  if (p.kind === "line") return `M${n(p.a.x)} ${n(p.a.y)} L${n(p.b.x)} ${n(p.b.y)}`;
  if (p.kind === "poly") return polyPath(p.pts, p.closed);
  if (p.kind === "arc") return arcPath(p.c, p.r, p.start, p.sweep);
  return "";
}

/**
 * One primitive as SVG. Exported because the site's symbol pages draw the same
 * library the same way — a page listing the symbols has to show what the editor
 * actually draws, and a second, hand-kept copy of that would be wrong within a
 * release. Colour comes from `currentColor`, so a caller sets it once on a
 * wrapping element.
 */
export function primSvg(p: Prim): string {
  if (p.kind === "text") {
    return `<text x="${n(p.at.x)}" y="${n(p.at.y)}" font-size="${n(p.size)}"` +
      ` text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none">${esc(p.text)}</text>`;
  }
  return `<path d="${primPath(p)}"/>`;
}

/**
 * The drawing itself — every group from the room tint up to the labels, in
 * world millimetres, without the enclosing <svg> element. `toSvg` wraps it in
 * a document at true scale; the permit sheet embeds it in a scaled group on a
 * paper-sized page. One emitter, so the two cannot draw a different plan.
 */
export function planSvgParts(doc: PlanDoc, floor: Floor, resolved: ReturnType<typeof resolveFloor>): string[] {
  const parts: string[] = [];

  // Rooms beneath everything, as the editor draws them.
  const net = areaModeOf(doc) === "net";
  const dim = dimModeOf(doc);
  const rooms = detectRooms(floor);
  if (rooms.length > 0) {
    parts.push(`<g id="rooms" fill="${COLORS.roomFill}">`);
    for (const r of rooms) parts.push(`<path d="${polyPath(r.poly, true)}"/>`);
    parts.push(`</g>`);
  }

  // Vides cut the room tint and are drawn under the walls, as on the canvas.
  if (videsOf(floor).length > 0) {
    parts.push(`<g id="vides" fill="none" stroke-width="${W_SYMBOL}" stroke-linecap="round">`);
    for (const vd of videsOf(floor)) {
      const ink = symbolInk(vd);
      parts.push(`<path d="${polyPath(boxPoly(videBox(vd), vd), true)}" fill="${COLORS.bg}" stroke="none"/>`);
      parts.push(`<g color="${ink}" stroke="${ink}">`);
      for (const p of videPrims(vd, t("vide.label"))) parts.push(primSvg(p));
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  }

  // Walls: filled outlines, so an opening is a real gap in the masonry.
  parts.push(`<g id="walls" fill="${COLORS.wallFill}" stroke="${COLORS.wallStroke}" stroke-width="${W_WALL}">`);
  for (const rw of resolved.walls.values())
    for (const piece of rw.pieces) parts.push(`<path d="${polyPath(piece.poly, true)}"/>`);
  // Junction fill closes the wedge a T-junction leaves; no stroke, its edges are
  // interior to the masonry.
  for (const j of resolved.junctions) parts.push(`<path d="${polyPath(j.poly, true)}" stroke="none"/>`);
  parts.push(`</g>`);

  parts.push(`<g id="openings" color="${COLORS.opening}" fill="none" stroke="${COLORS.opening}" stroke-width="${W_OPENING}" stroke-linecap="round">`);
  for (const rw of resolved.walls.values())
    for (const p of openingMarks(rw)) parts.push(primSvg(p));
  parts.push(`</g>`);

  // Cabinetry between the masonry and the symbols, as on the canvas. A wall
  // unit is dashed here rather than in its recorded geometry: the recorder
  // discards dash patterns, so the group carries it (see io/cabinet.ts).
  if (cabinetsOf(floor).length > 0) {
    parts.push(`<g id="cabinets" fill="none" stroke-width="${W_SYMBOL}" stroke-linecap="round" stroke-linejoin="round">`);
    for (const c of cabinetsOf(floor)) {
      const ink = symbolInk(c);
      const dash = cabinetOverhead(c) ? ` stroke-dasharray="90 60"` : "";
      parts.push(`<g color="${ink}" stroke="${ink}"${dash}>`);
      for (const p of cabinetPrims(c)) parts.push(primSvg(p));
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  }

  parts.push(`<g id="symbols" fill="none" stroke-width="${W_SYMBOL}" stroke-linecap="round" stroke-linejoin="round">`);
  for (const s of floor.symbols) {
    const def = getSymbol(s.type);
    if (!def) continue;
    const ink = symbolInk(s);
    parts.push(`<g color="${ink}" stroke="${ink}">`);
    for (const p of recordSymbol(def, s.x, s.y, s.rotation, s.mirrored === true)) parts.push(primSvg(p));
    parts.push(`</g>`);
  }
  parts.push(`</g>`);

  // Stairs last, over the symbols, each behind its own wash — the order the
  // editor draws them in, and for the same reason.
  parts.push(`<g id="stairs" fill="none" stroke-width="${W_SYMBOL}" stroke-linecap="round" stroke-linejoin="round">`);
  for (const st of stairsOf(floor)) {
    const stair = resolveStair(floor, st);
    const ink = symbolInk(st);
    const region = stairRegionPrims(stair);
    parts.push(`<g fill="${COLORS.stairWash}" stroke="none">`);
    if (region.length > 0) for (const p of region) parts.push(primSvg(p));
    else {
      const b = stairBox(stair);
      parts.push(`<path d="${polyPath(boxPoly(b, stair), true)}"/>`);
    }
    parts.push(`</g>`);
    parts.push(`<g color="${ink}" stroke="${ink}">`);
    for (const p of stairPrims(stair)) parts.push(primSvg(p));
    parts.push(`</g>`);
  }
  parts.push(`</g>`);

  if (rooms.length > 0 || roomNamesOf(floor).length > 0) {
    // Label size in mm: 220 is about 12 px at the zoom the editor opens on, and
    // stays legible when the drawing is printed small.
    parts.push(`<g id="labels" fill="${COLORS.roomLabel}" font-family="system-ui, sans-serif" font-size="220" text-anchor="middle">`);
    for (const r of rooms) {
      const mm2 = net ? r.netAreaMm2 : r.areaMm2;
      const area = `${esc((mm2 / 1e6).toFixed(1))} m²`;
      // Name over area over clear size, the way the canvas stacks them. The
      // 150 mm offsets are the screen-space 8 px at the same 220 mm label size,
      // and a third line spreads the stack to twice that.
      const size = roomSize(r, dim);
      const x = n(r.centroid.x);
      const y = (dy: number): string => n(r.centroid.y + dy);
      if (r.name !== undefined)
        parts.push(`<text x="${x}" y="${y(size ? -300 : -150)}" font-weight="600">${esc(r.name)}</text>`);
      parts.push(`<text x="${x}" y="${y(r.name === undefined ? (size ? -150 : 0) : (size ? 0 : 150))}">${area}</text>`);
      if (size)
        parts.push(`<text x="${x}" y="${y(r.name === undefined ? 150 : 300)}" fill="${COLORS.dimension}" font-size="200">${esc(sizeLabel(size))}</text>`);
    }
    // Names that landed in no detected room still carry onto the sheet.
    for (const rn of looseRoomNames(floor, rooms)) {
      parts.push(`<text x="${n(rn.x)}" y="${n(rn.y)}" font-weight="600">${esc(rn.name)}</text>`);
    }
    parts.push(`</g>`);
  }

  return parts;
}

/** Route line weight in mm -- same figure render/route.ts draws with. */
const W_ROUTE = LINE_WIDTH_MM;

/**
 * Routes as SVG, one group per discipline (`id="routes-electrical"` etc.), in
 * the discipline's own ink. Kept OUTSIDE planSvgParts deliberately: that
 * function also composes the permit sheet (io/permit.ts), and a bouwkundige
 * permit sheet carries no services -- see the module comment on io/permit.ts.
 * Called only from toSvg below, so the permit path never reaches it.
 */
export function routeSvgParts(floor: Floor): string[] {
  const parts: string[] = [];
  const resolved = resolveRoutes(floor);
  for (const discipline of DISCIPLINES) {
    const group = resolved.filter(r => r.route.discipline === discipline);
    if (group.length === 0) continue;
    const ink = routeInk(discipline);
    parts.push(`<g id="routes-${discipline}" fill="none" stroke="${ink}" stroke-width="${W_ROUTE}" stroke-linecap="round">`);
    if (discipline === "electrical") {
      // A data run (utp/coax) is dashed here rather than in its recorded
      // geometry: the recorder discards dash patterns, so the group carries
      // it -- the same reasoning a wall cabinet's dash is carried by its own
      // SVG group (see the cabinets group in planSvgParts, and io/cabinet.ts).
      // A power run is the plain, undashed sub-group, matching every other
      // discipline's markup.
      const power = group.filter(r => routeKind(r.route) === "power");
      const data = group.filter(r => routeKind(r.route) !== "power");
      for (const rr of power) for (const p of routePrims(rr)) parts.push(primSvg(p));
      if (data.length > 0) {
        parts.push(`<g stroke-dasharray="${ROUTE_DATA_DASH.join(" ")}">`);
        for (const rr of data) for (const p of routePrims(rr)) parts.push(primSvg(p));
        parts.push(`</g>`);
      }
    } else if (discipline === "water") {
      // koud stays the plain outer group -- solid, the ordinary water ink,
      // matching every other discipline's markup. warm is a colour-override
      // sub-group (its own tint within the water ink family, see
      // render/draw.ts's COLORS.routeWaterWarm); afvoer is a dashed, wider
      // sub-group -- the recorder/prims path this feeds cannot carry a dash
      // or a widened stroke, so the SVG group carries them, the same
      // reasoning io/dxf.ts documents for CABINETS-OVERHEAD and this
      // function's own electrical data sub-group above.
      const koud = group.filter(r => routeWater(r.route) === "koud");
      const warm = group.filter(r => routeWater(r.route) === "warm");
      const afvoer = group.filter(r => routeWater(r.route) === "afvoer");
      for (const rr of koud) for (const p of routePrims(rr)) parts.push(primSvg(p));
      if (warm.length > 0) {
        parts.push(`<g stroke="${routeInk("water", "warm")}">`);
        for (const rr of warm) for (const p of routePrims(rr)) parts.push(primSvg(p));
        parts.push(`</g>`);
      }
      if (afvoer.length > 0) {
        parts.push(`<g stroke-width="${W_ROUTE + ROUTE_AFVOER_EXTRA_MM}" stroke-dasharray="${ROUTE_AFVOER_DASH.join(" ")}">`);
        for (const rr of afvoer) for (const p of routePrims(rr)) parts.push(primSvg(p));
        parts.push(`</g>`);
      }
    } else if (discipline === "vent") {
      // Every vent run draws wider than the other disciplines, toevoer and
      // afvoer alike -- a duct is a spatial object even in plan (see
      // render/route.ts's ROUTE_VENT_EXTRA_MM) -- so the widened stroke
      // wraps both sub-groups here rather than only the dashed one. afvoer
      // is additionally dashed on its own sub-group, the same
      // recorder-drops-dashes reasoning as the water afvoer split above.
      const toevoer = group.filter(r => routeVent(r.route) !== "afvoer");
      const afvoer = group.filter(r => routeVent(r.route) === "afvoer");
      parts.push(`<g stroke-width="${W_ROUTE + ROUTE_VENT_EXTRA_MM}">`);
      for (const rr of toevoer) for (const p of routePrims(rr)) parts.push(primSvg(p));
      if (afvoer.length > 0) {
        parts.push(`<g stroke-dasharray="${ROUTE_AFVOER_DASH.join(" ")}">`);
        for (const rr of afvoer) for (const p of routePrims(rr)) parts.push(primSvg(p));
        parts.push(`</g>`);
      }
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  }
  return parts;
}

/** The plan of one storey as an SVG document. */
export function toSvg(doc: PlanDoc, floorIndex = 0): string | null {
  const floor: Floor | undefined = doc.floors[floorIndex] ?? doc.floors[0];
  if (!floor) return null;
  const resolved = resolveFloor(floor);
  const bounds = planBounds(floor, resolved);
  if (!bounds) return null;

  const minX = bounds.min.x - MARGIN_MM;
  const minY = bounds.min.y - MARGIN_MM;
  const w = bounds.max.x - bounds.min.x + 2 * MARGIN_MM;
  const h = bounds.max.y - bounds.min.y + 2 * MARGIN_MM;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"` +
    ` width="${n(w)}mm" height="${n(h)}mm"` +
    ` viewBox="${n(minX)} ${n(minY)} ${n(w)} ${n(h)}">`,
  );
  parts.push(`<rect x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}" fill="${COLORS.bg}"/>`);
  parts.push(...planSvgParts(doc, floor, resolved));
  parts.push(...routeSvgParts(floor));
  parts.push(`</svg>`);
  return parts.join("\n") + "\n";
}

const FILENAME = "floorplan.svg";

export async function exportSvg(doc: PlanDoc, floorIndex = 0): Promise<SvgResult> {
  const text = toSvg(doc, floorIndex);
  if (!text) return "empty";
  if (await saveViaHost(FILENAME, () => text)) return "saved";
  if (downloadBlob(FILENAME, new Blob([text], { type: "image/svg+xml" }))) return "saved";
  return "failed";
}
