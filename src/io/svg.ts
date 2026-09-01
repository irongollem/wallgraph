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
//
// The drawing itself is assembled as a scene (io/scene.ts) rather than as
// markup, because io/pdf.ts renders the same scene onto the permit sheet.
// This module is the SVG renderer for it plus the scene the plan makes.
import { PlanDoc, Floor, areaModeOf, dimModeOf, mountMarksOn, stairsOf, videsOf, furnishingsOf, roomNamesOf } from "../model/doc";
import { Vec } from "../geometry/vec";
import { resolveFloor } from "../core/resolve";
import { detectRooms, roomSize, sizeLabel, looseRoomNames } from "../core/rooms";
import { getSymbol } from "../render/symbols";
import { mountMarkOf } from "../core/mount";
import { COLORS, routeInk, routeMapLabel, symbolInk, wallPen, junctionPen, type WallPen } from "../render/draw";
import { ROUTE_DATA_DASH, ROUTE_AFVOER_DASH, ROUTE_AFVOER_EXTRA_MM, ROUTE_VENT_EXTRA_MM, LINE_WIDTH_MM } from "../render/route";
import { stairBox } from "../core/stair";
import { recordSymbol, Prim } from "./record";
import { Group, Item, Look, ROOT, arcSteps, group, onCircle, poly, resolve, text } from "./scene";
import { openingMarks, mullionMarks } from "./marks";
import { stairPrims, stairRegionPrims } from "./stair";
import { videPrims } from "./vide";
import { furnishingPrims } from "./furnishing";
import { furnishingOverhead } from "../model/furnishing";
import { videBox } from "../core/vide";
import { resolveStair } from "../core/stair";
import { resolveRoutes } from "../core/route";
import { riserPrims, routePrims } from "./route";
import { riserMarks, type ResolvedRiserMark } from "../core/continuation";
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

/** Label size in mm: about 12 px at the zoom the editor opens on, and still
 *  legible when the drawing is printed small. */
const LABEL_MM = 220;
const SIZE_LABEL_MM = 200;

const LABEL_FONT = "system-ui, sans-serif";

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/**
 * Two decimals is a hundredth of a millimetre on a coordinate, and 0 at a
 * sheet's scale factor: 1/200 would round to 1/100 and draw the plan at twice
 * its stated scale. A transform's multiplier gets its own precision.
 */
const nk = (v: number): string => Number(v.toFixed(9)).toString();

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
 * which direction. Both fall out of the signed sweep the marks carry. The
 * sweep is cut into half turns first, because a full circle's endpoints
 * coincide and a single A between them draws nothing at all.
 */
function arcPath(c: Vec, r: number, startDeg: number, sweepDeg: number): string {
  const steps = arcSteps(startDeg, sweepDeg, 180);
  const first = onCircle(c, r, startDeg);
  let d = `M${n(first.x)} ${n(first.y)}`;
  for (const s of steps) {
    const to = onCircle(c, r, s.from + s.sweep);
    d += ` A${n(r)} ${n(r)} 0 0 ${s.sweep >= 0 ? 1 : 0} ${n(to.x)} ${n(to.y)}`;
  }
  return d;
}

function primPath(p: Prim): string {
  if (p.kind === "line") return `M${n(p.a.x)} ${n(p.a.y)} L${n(p.b.x)} ${n(p.b.y)}`;
  if (p.kind === "poly") return polyPath(p.pts, p.closed);
  if (p.kind === "arc") return arcPath(p.c, p.r, p.start, p.sweep);
  return "";
}

/** Text takes the pen's colour, falling back to the fill where there is no pen
 *  — a room label carries no stroke, only a fill. */
export function textInk(look: Look): string {
  return look.ink !== "none" ? look.ink : look.fill;
}

/** What `primSvg` draws text with when no look is supplied: colour from
 *  `currentColor`, so a caller sets it once on a wrapping element. */
const STANDALONE: Look = { ...ROOT, ink: "currentColor", anchor: "middle", baseline: "central" };

/**
 * One primitive as SVG. Exported because the site's symbol pages draw the same
 * library the same way — a page listing the symbols has to show what the editor
 * actually draws, and a second, hand-kept copy of that would be wrong within a
 * release.
 */
export function primSvg(p: Prim, look: Look = STANDALONE): string {
  if (p.kind === "text") {
    const rot = look.rotate === 0 ? ""
      : ` transform="rotate(${n(look.rotate)} ${n(p.at.x)} ${n(p.at.y)})"`;
    return `<text x="${n(p.at.x)}" y="${n(p.at.y)}" font-size="${n(p.size)}"` +
      (look.family === "" ? "" : ` font-family="${look.family}"`) +
      (look.bold ? ` font-weight="600"` : "") +
      ` text-anchor="${look.anchor}"` +
      ` dominant-baseline="${look.baseline === "central" ? "central" : "auto"}"` +
      ` fill="${textInk(look)}" stroke="none"${rot}>${esc(p.text)}</text>`;
  }
  return `<path d="${primPath(p)}"/>`;
}

/** A group's own attributes: what it states, not what it inherited. */
function groupAttrs(g: Group): string {
  let a = "";
  if (g.id !== undefined) a += ` id="${g.id}"`;
  const tf = g.transform;
  if (tf) {
    a += tf.kind === "place"
      ? ` transform="translate(${n(tf.tx)} ${n(tf.ty)}) scale(${nk(tf.k)})"`
      : ` transform="rotate(${n(tf.deg)} ${n(tf.cx)} ${n(tf.cy)})"`;
  }
  const s = g.style;
  if (s) {
    if (s.fill !== undefined) a += ` fill="${s.fill}"`;
    if (s.ink !== undefined) a += ` stroke="${s.ink}"`;
    if (s.width !== undefined) a += ` stroke-width="${n(s.width)}"`;
    if (s.dash !== undefined && s.dash.length > 0)
      a += ` stroke-dasharray="${s.dash.map(n).join(" ")}"`;
    if (s.cap !== undefined) a += ` stroke-linecap="${s.cap}"`;
    if (s.join !== undefined) a += ` stroke-linejoin="${s.join}"`;
  }
  return a;
}

/** A scene as SVG markup, one string per element. */
export function sceneSvg(items: readonly Item[], look: Look = ROOT): string[] {
  const parts: string[] = [];
  for (const it of items) {
    if (it.kind === "group") {
      parts.push(`<g${groupAttrs(it)}>`);
      parts.push(...sceneSvg(it.items, resolve(look, it.style)));
      parts.push(`</g>`);
    } else {
      parts.push(primSvg(it, look));
    }
  }
  return parts;
}

/**
 * The drawing itself — every group from the room tint up to the labels, in
 * world millimetres. `toSvg` wraps it in a document at true scale; the permit
 * sheet places it in a scaled group on a paper-sized page and renders it to
 * PDF. One scene, so the three cannot draw a different plan.
 */
export function planScene(doc: PlanDoc, floor: Floor, resolved: ReturnType<typeof resolveFloor>): Group[] {
  const out: Group[] = [];

  // Rooms beneath everything, as the editor draws them.
  const net = areaModeOf(doc) === "net";
  const dim = dimModeOf(doc);
  const rooms = detectRooms(floor);
  if (rooms.length > 0)
    out.push(group(rooms.map(r => poly(r.poly, true)), { fill: COLORS.roomFill }, "rooms"));

  // Vides cut the room tint and are drawn under the walls, as on the canvas.
  const vides = videsOf(floor);
  if (vides.length > 0) {
    const items: Item[] = [];
    for (const vd of vides) {
      items.push(group([poly(boxPoly(videBox(vd), vd), true)], { fill: COLORS.bg, ink: "none" }));
      items.push(group(videPrims(vd, t("vide.label")), { ink: symbolInk(vd) }));
    }
    out.push(group(items, { fill: "none", width: W_SYMBOL, cap: "round" }, "vides"));
  }

  // Walls: filled outlines, so an opening is a real gap in the masonry.
  //
  // Bucketed by pen rather than emitted as one group, because a wall states its
  // material and its status: glazing carries a wash instead of poché, and a wall
  // drawn in the "to be built" pen carries that pen as its fill. One group per
  // distinct pen keeps the common all-default plan to a single group, the way
  // this read before walls could differ.
  interface Bucket { pen: WallPen; pieces: Item[]; wedges: Item[] }
  const buckets = new Map<string, Bucket>();
  const bucketFor = (pen: WallPen): Bucket => {
    const key = `${pen.fill}|${pen.stroke}`;
    let b = buckets.get(key);
    if (!b) { b = { pen, pieces: [], wedges: [] }; buckets.set(key, b); }
    return b;
  };
  const mullions: Item[] = [];
  for (const rw of resolved.walls.values()) {
    const pen = wallPen(rw.wall);
    const b = bucketFor(pen);
    for (const piece of rw.pieces) b.pieces.push(poly(piece.poly, true));
    const stijlen = mullionMarks(rw);
    if (stijlen.length > 0) mullions.push(group(stijlen, { ink: pen.mark }));
  }
  // Junction fill closes the wedge a T-junction leaves; no stroke, its edges are
  // interior to the masonry.
  for (const j of resolved.junctions) bucketFor(junctionPen(j, resolved.walls)).wedges.push(poly(j.poly, true));
  const walls: Item[] = [];
  for (const b of buckets.values()) {
    const items: Item[] = [...b.pieces];
    if (b.wedges.length > 0) items.push(group(b.wedges, { ink: "none" }));
    walls.push(group(items, { fill: b.pen.fill, ink: b.pen.stroke }));
  }
  out.push(group(walls, { fill: COLORS.wallFill, ink: COLORS.wallStroke, width: W_WALL }, "walls"));

  // Stijlen over the glazing they divide, in their own group: they are lines,
  // and the wall groups above carry a fill that would flood an open path.
  if (mullions.length > 0)
    out.push(group(mullions,
      { fill: "none", ink: COLORS.glassStroke, width: W_OPENING, cap: "round" }, "glazing"));

  // Openings take their wall's pen, so a door in a wall marked as new work is
  // drawn as new work too rather than in the default ink.
  const marks: Item[] = [];
  for (const rw of resolved.walls.values()) {
    const m = openingMarks(rw);
    if (m.length === 0) continue;
    const ink = wallPen(rw.wall).mark;
    marks.push(ink === COLORS.opening ? group(m) : group(m, { ink }));
  }
  out.push(group(marks,
    { fill: "none", ink: COLORS.opening, width: W_OPENING, cap: "round" }, "openings"));

  // Cabinetry between the masonry and the symbols, as on the canvas. A wall
  // unit is dashed here rather than in its recorded geometry: the recorder
  // discards dash patterns, so the group carries it (see io/furnishing.ts).
  const furnishings = furnishingsOf(floor);
  if (furnishings.length > 0) {
    const items = furnishings.map(c => group(furnishingPrims(c), {
      ink: symbolInk(c),
      ...(furnishingOverhead(c) ? { dash: [90, 60] } : {}),
    }));
    out.push(group(items,
      { fill: "none", width: W_SYMBOL, cap: "round", join: "round" }, "furnishings"));
  }

  const symbols: Item[] = [];
  for (const s of floor.symbols) {
    const def = getSymbol(s.type);
    if (!def) continue;
    const prims = recordSymbol(def, s.x, s.y, s.rotation, s.mirrored === true);
    // The mounting-height figure, when the plan states heights at all, is part
    // of the drawing rather than an editor overlay -- see mountMarksOn().
    const mark = mountMarksOn(doc) ? mountMarkOf(floor, s) : null;
    if (mark) prims.push({ kind: "text", at: mark.at, size: mark.size, text: mark.text });
    symbols.push(group(prims, { ink: symbolInk(s) }));
  }
  out.push(group(symbols,
    { fill: "none", width: W_SYMBOL, cap: "round", join: "round" }, "symbols"));

  // Stairs last, over the symbols, each behind its own wash — the order the
  // editor draws them in, and for the same reason.
  const stairs: Item[] = [];
  for (const st of stairsOf(floor)) {
    const stair = resolveStair(floor, st);
    const region = stairRegionPrims(stair);
    stairs.push(group(
      region.length > 0 ? region : [poly(boxPoly(stairBox(stair), stair), true)],
      { fill: COLORS.stairWash, ink: "none" }));
    stairs.push(group(stairPrims(stair), { ink: symbolInk(st) }));
  }
  out.push(group(stairs,
    { fill: "none", width: W_SYMBOL, cap: "round", join: "round" }, "stairs"));

  if (rooms.length > 0 || roomNamesOf(floor).length > 0) {
    const items: Item[] = [];
    for (const r of rooms) {
      const mm2 = net ? r.netAreaMm2 : r.areaMm2;
      const area = `${(mm2 / 1e6).toFixed(1)} m²`;
      // Name over area over clear size, the way the canvas stacks them. The
      // 150 mm offsets are the screen-space 8 px at the same 220 mm label size,
      // and a third line spreads the stack to twice that.
      const size = roomSize(r, dim);
      const at = (dy: number): Vec => ({ x: r.centroid.x, y: r.centroid.y + dy });
      if (r.name !== undefined)
        items.push(group([text(at(size ? -300 : -150), LABEL_MM, r.name)], { bold: true }));
      items.push(text(at(r.name === undefined ? (size ? -150 : 0) : (size ? 0 : 150)), LABEL_MM, area));
      if (size)
        items.push(group([text(at(r.name === undefined ? 150 : 300), SIZE_LABEL_MM, sizeLabel(size))],
          { fill: COLORS.dimension }));
    }
    // Names that landed in no detected room still carry onto the sheet.
    for (const rn of looseRoomNames(floor, rooms))
      items.push(group([text({ x: rn.x, y: rn.y }, LABEL_MM, rn.name)], { bold: true }));
    out.push(group(items, {
      fill: COLORS.roomLabel, ink: "none", family: LABEL_FONT,
      anchor: "middle", baseline: "alphabetic",
    }, "labels"));
  }

  return out;
}

/** Route line weight in mm -- same figure render/route.ts draws with. */
const W_ROUTE = LINE_WIDTH_MM;

/**
 * Routes as a scene, one group per discipline (`id="routes-electrical"` etc.),
 * in the discipline's own ink. Kept OUTSIDE planScene deliberately: that
 * function also composes the permit sheet (io/permit.ts), and a bouwkundige
 * permit sheet carries no services -- see the module comment on io/permit.ts.
 * Called only from toSvg below, so the permit path never reaches it.
 */
export function routeScene(floor: Floor, marks: readonly ResolvedRiserMark[] = []): Group[] {
  const out: Group[] = [];
  const resolved = resolveRoutes(floor);
  for (const discipline of DISCIPLINES) {
    const all = resolved.filter(r => r.route.discipline === discipline);
    if (all.length === 0) continue;
    const prims = (rs: typeof all): Prim[] => rs.flatMap(routePrims);
    const items: Item[] = [];
    if (discipline === "electrical") {
      // A data run (utp/coax) is dashed here rather than in its recorded
      // geometry: the recorder discards dash patterns, so the group carries
      // it -- the same reasoning a wall unit's dash is carried by its own
      // group (see the furnishings group in planScene, and io/furnishing.ts).
      // A power run is the plain, undashed sub-group.
      const data = all.filter(r => routeKind(r.route) !== "power");
      items.push(...prims(all.filter(r => routeKind(r.route) === "power")));
      if (data.length > 0) items.push(group(prims(data), { dash: ROUTE_DATA_DASH }));
    } else if (discipline === "water") {
      // koud stays the plain outer group -- solid, the ordinary water ink,
      // matching every other discipline. warm is a colour-override sub-group
      // (its own tint within the water ink family, see render/draw.ts's
      // COLORS.routeWaterWarm); afvoer is a dashed, wider sub-group -- the
      // prims path this feeds cannot carry a dash or a widened stroke, so the
      // group carries them, the same reasoning io/dxf.ts documents for
      // CABINETS-OVERHEAD and the electrical data sub-group above.
      const warm = all.filter(r => routeWater(r.route) === "warm");
      const afvoer = all.filter(r => routeWater(r.route) === "afvoer");
      items.push(...prims(all.filter(r => routeWater(r.route) === "koud")));
      if (warm.length > 0) items.push(group(prims(warm), { ink: routeInk("water", "warm") }));
      if (afvoer.length > 0)
        items.push(group(prims(afvoer),
          { width: W_ROUTE + ROUTE_AFVOER_EXTRA_MM, dash: ROUTE_AFVOER_DASH }));
    } else if (discipline === "vent") {
      // Every vent run draws wider than the other disciplines, toevoer and
      // afvoer alike -- a duct is a spatial object even in plan (see
      // render/route.ts's ROUTE_VENT_EXTRA_MM) -- so the widened stroke wraps
      // both sub-groups rather than only the dashed one. afvoer is
      // additionally dashed on its own sub-group.
      const afvoer = all.filter(r => routeVent(r.route) === "afvoer");
      const inner: Item[] = [...prims(all.filter(r => routeVent(r.route) !== "afvoer"))];
      if (afvoer.length > 0) inner.push(group(prims(afvoer), { dash: ROUTE_AFVOER_DASH }));
      items.push(group(inner, { width: W_ROUTE + ROUTE_VENT_EXTRA_MM }));
    } else {
      items.push(...prims(all));
    }
    items.push(...marks.filter(mark => mark.discipline === discipline).flatMap(riserPrims));
    for (let index = 0; index < all.length; index++) {
      const rr = all[index]!;
      const longest = [...rr.segments].sort((a, b) =>
        Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))[0];
      if (!longest) continue;
      const frac = 0.32 + (index % 3) * 0.18;
      const at = {
        x: longest.a.x + (longest.b.x - longest.a.x) * frac,
        y: longest.a.y + (longest.b.y - longest.a.y) * frac,
      };
      const labelInk = routeInk(rr.route.discipline,
        rr.route.discipline === "water" ? routeWater(rr.route) : undefined);
      items.push(group([text(at, 150, routeMapLabel(rr.route))], {
        fill: labelInk, ink: "none", family: LABEL_FONT, anchor: "middle", baseline: "central",
      }));
    }
    out.push(group(items, {
      fill: "none", ink: routeInk(discipline), width: W_ROUTE, cap: "round",
    }, `routes-${discipline}`));
  }
  return out;
}

/** Routes as SVG markup. */
export function routeSvgParts(floor: Floor): string[] {
  return sceneSvg(routeScene(floor));
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
  parts.push(...sceneSvg([
    ...planScene(doc, floor, resolved), ...routeScene(floor, riserMarks(doc, floorIndex)),
  ]));
  parts.push(`</svg>`);
  return parts.join("\n") + "\n";
}

const FILENAME = "floorplan.svg";

export async function exportSvg(doc: PlanDoc, floorIndex = 0): Promise<SvgResult> {
  const body = toSvg(doc, floorIndex);
  if (!body) return "empty";
  if (await saveViaHost(FILENAME, () => body)) return "saved";
  if (downloadBlob(FILENAME, new Blob([body], { type: "image/svg+xml" }))) return "saved";
  return "failed";
}
