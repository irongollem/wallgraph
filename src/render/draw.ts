// Full scene render. Immediate mode: redraw everything on change (documents at
// this scale render in well under a frame). Layers: grid, rooms, walls,
// opening decorations, routes, cabinets, symbols, stairs, selection, labels
// (labels in screen space).
import { Floor, SymbolInstance, AreaMode, DimMode, Sash, sashesOf, stairsOf, videsOf, cabinetsOf, fireLabel, Underlay } from "../model/doc";
import { Resolved, OpeningGeom } from "../core/resolve";
import { Room, roomSize, sizeLabel, looseRoomNames } from "../core/rooms";
import { Selection } from "../model/store";
import { Viewport } from "./viewport";
import { Vec, add, sub, scale, perp, v, angleOf, dist, fromAngle } from "../geometry/vec";
import { getSymbol } from "./symbols";
import { drawStair, drawStairGhost } from "./stair";
import { drawVide } from "./vide";
import { drawCabinet } from "./cabinet";
import { drawRoute } from "./route";
import { resolveRoutes, resolveRoutePoints } from "../core/route";
import {
  routeWater, routeKind, routeVeins, routeDiameter, routeVent, routeDuctDiameter,
  routeFlow, type Route, type Discipline, type RouteWater,
} from "../model/route";
import { ROOM_NAME_PX } from "../model/room";
import { resolveStair } from "../core/stair";
import { t } from "../i18n";
import { gridSteps, GridSteps } from "./grid";

export const COLORS = {
  bg: "#f4f2ec",
  grid: "#eae7dd",       // sub-grid: recedes, just enough to gauge a distance
  gridMajor: "#c3bfae",  // metre grid: a clearly heavier line, not a shade of the same
  roomFill: "#faf9f5",
  roomLabel: "#8a8577",
  ghost: "#9aa0a8",   // storey below, drawn under the active one
  hud: "#a7a293",
  wallFill: "#3d4148",
  wallStroke: "#26292e",
  opening: "#3d4148",
  symbol: "#4a5568",
  select: "#e05d2d",
  /** COLORS.select at low alpha: the selection wash behind a picked symbol. */
  selectWash: "rgba(224,93,45,0.13)",
  snap: "#2d7de0",
  dimension: "#2d7de0",
  /**
   * Backing behind a stair. A flight covers a lot of paper and its treads read
   * as a grille over whatever it crosses, so what is underneath is pushed back
   * rather than hidden -- it stays legible through the wash. The paper colour
   * rather than white: the wash should look like less drawing, not like a
   * brighter patch of a different sheet.
   */
  stairWash: "rgba(244,242,236,0.4)",
  /**
   * A figure outside what a stair is ordinarily built to. Distinct from the
   * INKS red, which is a pen the drawer chose and means new work; the annotation
   * also carries an exclamation mark, so the flag survives a stair already drawn
   * in red and survives an export that loses the colour.
   */
  stairWarn: "#b3261e",
  /**
   * Default ink per discipline, chosen to sit clearly apart from each other,
   * from the selection orange, and from the snap/dimension blue -- print-safe
   * saturated hues rather than a scheme tied to any drawing standard. Which
   * colour means what is a follow-up issue; this is only "tell three layers
   * apart at a glance". A route carries no colour of its own (see
   * model/route.ts), unlike a symbol or a stair, so there is no per-instance
   * override to read through.
   */
  routeElectrical: "#7d4dae",
  routeWater: "#2166ac",
  /**
   * Warm water's own tint within the water ink family -- a warmer, redder
   * hue of the same water green rather than an unrelated colour, so "this is
   * still water" reads at a glance and only the temperature differs. Koud
   * and afvoer stay on COLORS.routeWater; only warm overrides.
   */
  routeWaterWarm: "#c33f3f",
  routeVent: "#9c7a1f",
  routeGas: "#b8860b",
};

/**
 * The ink for one discipline's routes. `water` is read only when `d` is
 * "water" -- warm gets its own tint (COLORS.routeWaterWarm); koud and afvoer
 * both draw in the ordinary water ink, afvoer distinguished by dash and
 * weight instead (see render/route.ts).
 */
export function routeInk(d: Discipline, water?: RouteWater): string {
  if (d === "water" && water === "warm") return COLORS.routeWaterWarm;
  return d === "electrical" ? COLORS.routeElectrical
       : d === "water" ? COLORS.routeWater
       : d === "vent" ? COLORS.routeVent
       : COLORS.routeGas;
}

/** Compact identifier carried on the plan. Full descriptive names stay in
 * the property pane; this is intentionally schedule-like to limit clutter. */
export function routeMapLabel(route: Route): string {
  const head = route.tag ? [route.tag] : route.name ? [route.name] : [];
  if (route.discipline === "electrical") {
    if (route.board || route.group) head.push([route.board, route.group].filter(Boolean).join("/"));
    if (routeKind(route) === "power") head.push(`${routeVeins(route)}c`);
    else head.push(`${routeKind(route).toUpperCase()}${route.spec ? ` ${route.spec}` : ""}`);
  } else if (route.discipline === "water") {
    const kind = routeWater(route) === "koud" ? "KW" : routeWater(route) === "warm" ? "WW" : "AF";
    head.push(`${kind} Ø${routeDiameter(route)}`);
  } else if (route.discipline === "vent") {
    head.push(`${routeVent(route) === "toevoer" ? "TV" : "AV"} Ø${routeDuctDiameter(route)}`);
    const flow = routeFlow(route);
    if (flow !== undefined) head.push(`${flow} m³/h`);
  } else {
    head.push(`GAS Ø${route.diameter ?? 15}`);
  }
  return head.filter(Boolean).join(" · ");
}

/**
 * The pens a plan is annotated with, offered as presets by the colour picker.
 *
 * A verbouwtekening states the status of the work in colour rather than in
 * words: what is there in black, what is to be built in red, what is to be
 * removed in yellow. That is drawing-office convention (it is what a bouwaanvraag
 * set is read with), not a NEN symbol rule, so these are a starting point and
 * any colour is allowed — the picker's free swatch is not an escape hatch.
 *
 * `hex: null` is the default ink, stored as no colour at all: a plan nobody has
 * recoloured keeps clean JSON, and COLORS.symbol stays changeable afterwards.
 * Yellow is drawn as amber because true yellow on the paper-coloured background
 * is a line you cannot see.
 */
export const INKS: ReadonlyArray<{ id: string; hex: string | null }> = [
  { id: "default", hex: null },
  { id: "new",     hex: "#d0342c" },
  { id: "remove",  hex: "#c58a10" },
  { id: "service", hex: "#2d7de0" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The colour one symbol draws in. Validated rather than trusted: a document can
 * arrive by paste or by hand-editing, and assigning an invalid string to
 * `strokeStyle` is silently ignored by canvas — one bad value would repaint the
 * symbol in whatever colour happened to be set last.
 */
export function symbolInk(s: { color?: string }): string {
  return s.color && HEX.test(s.color) ? s.color : COLORS.symbol;
}

/**
 * The storey below, drawn faintly beneath the active one: its resolved walls,
 * to line storeys up, and the floor itself for the flight that climbs out of
 * it. Never hit-tested or selectable, so a ghost can't be edited by accident,
 * and it carries no room names — those name the rooms below.
 *
 * Not to be confused with `Underlay` (model/doc.ts): that is the per-floor
 * trace-over image a visitor loads and draws over, an authored document
 * field. This is wholly derived — the floor below, resolved the same way the
 * active one is — and exists only for this one render call.
 */
export interface GhostFloor {
  floor: Floor;
  resolved: Resolved;
}

export interface DrawExtras {
  hoverSnap?: Vec | null;
  ghost?: GhostFloor | null;
  /**
   * Selected alongside `sel`, by id and of its kind — the cabinets a
   * shift-click has added to the one the property pane edits. Every one of
   * them carries the selection frame; the drawing must not say that only the
   * last one clicked will move.
   */
  selMore?: readonly string[];
  /** False for exports: no grid, and no legend describing one. */
  showGrid?: boolean;
  /**
   * True to draw the floor's trace-over image (Tools.showUnderlay, the
   * editor's own visibility toggle). Absent/false excludes it -- the default
   * is OFF rather than mirroring showGrid's "on unless told otherwise",
   * because every export (PNG here; SVG/DXF/IFC/permit never read
   * Floor.underlay at all) must exclude the underlay unconditionally, and an
   * export that forgot to pass a `false` would otherwise leak it. io/image.ts's
   * PNG path simply never sets this.
   */
  showUnderlay?: boolean;
  /**
   * Per-discipline visibility (Tools.showRoutes). Absent, or a discipline
   * missing from it, means visible -- an export that never sets this (PNG
   * included; see io/image.ts) draws every route regardless of what a live
   * editor's toggles happen to say, since it has no Tools to read them from.
   */
  showRoutes?: Record<Discipline, boolean>;
  /**
   * Called once when a cached underlay image finishes decoding, so the host
   * can redraw with it visible. Unused, and safe to omit, wherever
   * showUnderlay is never true (every offscreen/export render).
   */
  requestRedraw?: () => void;
  preview?: ((ctx: CanvasRenderingContext2D, vp: Viewport) => void) | null;
}

/**
 * One decoded HTMLImageElement per underlay dataUrl, so a data URL of a few
 * hundred KB is decoded once rather than on every frame. Keyed by the dataUrl
 * itself rather than by floor id, so a changed dataUrl (a reloaded image)
 * naturally gets a fresh entry instead of needing an explicit invalidation
 * step; the old entry is simply never looked up again. Unbounded, but a
 * session touches at most a handful of underlay images.
 */
const underlayImageCache = new Map<string, HTMLImageElement>();

function getUnderlayImage(dataUrl: string, requestRedraw?: () => void): HTMLImageElement {
  let img = underlayImageCache.get(dataUrl);
  if (!img) {
    img = new Image();
    img.onload = () => requestRedraw?.();
    img.src = dataUrl;
    underlayImageCache.set(dataUrl, img);
  }
  return img;
}

/**
 * The trace-over image, in world space: `u.x`/`u.y` is its top-left corner
 * and `u.mmPerPixel` sizes it, both mm. Drawn with its own save/scale/
 * translate rather than inside drawScene's world-space block, because it has
 * to land BEFORE the grid (see the call site) while the world-space block
 * opens after it.
 */
function drawUnderlayImage(ctx: CanvasRenderingContext2D, vp: Viewport, u: Underlay, requestRedraw?: () => void): void {
  const img = getUnderlayImage(u.dataUrl, requestRedraw);
  if (!img.complete || img.naturalWidth === 0) return; // still decoding; onload above redraws once it lands
  const w = img.naturalWidth * u.mmPerPixel, h = img.naturalHeight * u.mmPerPixel;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, u.opacity));
  ctx.scale(vp.pxPerMm, vp.pxPerMm);
  ctx.translate(-vp.origin.x, -vp.origin.y);
  ctx.drawImage(img, u.x, u.y, w, h);
  ctx.restore();
}

export function drawScene(
  ctx: CanvasRenderingContext2D, vp: Viewport, canvasW: number, canvasH: number,
  floor: Floor, resolved: Resolved, rooms: Room[], sel: Selection | null,
  extras: DrawExtras, gridMm: number, areaMode: AreaMode, dimMode: DimMode,
): void {
  // True for the primary selection AND every member `extras.selMore` carries
  // alongside it -- a shift-click, a touch hold, or a marquee's catch all
  // draw the same frame, not just the one clicked or picked last. One helper
  // so every kind below routes selection highlighting through the same
  // check, the way the cabinet path already did before this generalised it.
  const isSel = (kind: Selection["kind"], id: string): boolean =>
    sel?.kind === kind && (sel.id === id || extras.selMore?.includes(id) === true);

  ctx.save();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Tracing aid, drawn UNDER the grid but OVER the paper: under the grid so
  // the grid stays visible for tracing (drawing it under the paper would hide
  // it entirely; drawing it over the grid would bury the grid under a scan),
  // and under the whole drawing below. See DrawExtras.showUnderlay.
  if (extras.showUnderlay && floor.underlay) {
    drawUnderlayImage(ctx, vp, floor.underlay, extras.requestRedraw);
  }

  const steps = extras.showGrid === false ? null : drawGrid(ctx, vp, canvasW, canvasH, gridMm);

  // World-space transform.
  ctx.save();
  ctx.scale(vp.pxPerMm, vp.pxPerMm);
  ctx.translate(-vp.origin.x, -vp.origin.y);
  const px = 1 / vp.pxPerMm; // 1 screen px in mm

  // Rooms.
  for (const r of rooms) {
    ctx.beginPath();
    tracePoly(ctx, r.poly);
    ctx.fillStyle = COLORS.roomFill;
    ctx.fill();
  }

  // Vides sit at floor level: the slab has a hole, so the room tint is cut and
  // the mark goes under the walls that bound the opening.
  for (const vd of videsOf(floor)) {
    drawVide(ctx, vd, {
      px, ink: symbolInk(vd), fallbackLabel: t("vide.label"), cut: COLORS.bg,
      selected: isSel("vide", vd.id),
      select: COLORS.select, wash: COLORS.selectWash,
    });
  }

  // Ghost underlay first, so the active storey draws over it.
  if (extras.ghost) {
    const under = extras.ghost;
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (const rw of under.resolved.walls.values()) {
      for (const piece of rw.pieces) {
        ctx.beginPath();
        tracePoly(ctx, piece.poly);
        ctx.fillStyle = COLORS.ghost;
        ctx.fill();
      }
    }
    // The flight from the storey below arrives on this one, so where it lands
    // and what this floor has to leave open for it are facts about this plan.
    // A stair climbs to the floor above by definition, so every one of them
    // belongs in the underlay. drawStairGhost sets its own transparency inside
    // its save, which leaves the wall wash above untouched.
    for (const st of stairsOf(under.floor)) {
      drawStairGhost(ctx, resolveStair(under.floor, st), COLORS.ghost);
    }
    ctx.restore();
  }

  // Walls.
  for (const rw of resolved.walls.values()) {
    const wallSel = isSel("wall", rw.wall.id);
    for (const piece of rw.pieces) {
      ctx.beginPath();
      tracePoly(ctx, piece.poly);
      ctx.fillStyle = wallSel ? "#5a4638" : COLORS.wallFill;
      ctx.fill();
      ctx.strokeStyle = wallSel ? COLORS.select : COLORS.wallStroke;
      ctx.lineWidth = (wallSel ? 2 : 1) * px;
      ctx.stroke();
    }
    for (const og of rw.openings) drawOpening(ctx, og, px, isSel("opening", og.opening.id));
  }

  // Junction fill goes on top of the wall pieces: it closes the wedge a T-shaped
  // junction leaves between two slanted end-caps, and covers the seam strokes
  // that bounded it. Fill only — every edge of it is interior to the masonry.
  for (const j of resolved.junctions) {
    ctx.beginPath();
    tracePoly(ctx, j.poly);
    ctx.fillStyle = COLORS.wallFill;
    ctx.fill();
  }

  // Routes: a services overlay. Drawn over the masonry, so a duct reads as
  // crossing a wall in plan the way it does on an installation drawing, and
  // under the cabinets and symbols that follow so a socket or tap placed on
  // top of a run stays the thing actually read there.
  const visibleRoutes = resolveRoutes(floor).filter(rr => extras.showRoutes?.[rr.route.discipline] !== false);
  for (let routeIndex = 0; routeIndex < visibleRoutes.length; routeIndex++) {
    const rr = visibleRoutes[routeIndex]!;
    const route = rr.route;
    const ink = routeInk(route.discipline, route.discipline === "water" ? routeWater(route) : undefined);
    drawRoute(ctx, rr, route.points, resolveRoutePoints(floor, route), {
      ink,
      selected: isSel("route", route.id),
      select: COLORS.select, wash: COLORS.selectWash,
    });
    const longest = [...rr.segments].sort((a, b) => dist(b.a, b.b) - dist(a.a, a.b))[0];
    if (longest) {
      // Stagger labels along parallel lanes so three labels do not form one
      // unclickable stack at the shared midpoint.
      const frac = 0.32 + (routeIndex % 3) * 0.18;
      drawLabel(ctx, vp, add(longest.a, scale(sub(longest.b, longest.a), frac)), routeMapLabel(route), ink);
    }
  }

  // Cabinetry, over the masonry and under the symbols. A unit stands against a
  // wall, so the wall draws first and takes the back edge with it; a socket or
  // a tap drawn on a unit has to stay visible over its front.
  for (const c of cabinetsOf(floor)) {
    drawCabinet(ctx, c, {
      px, ink: symbolInk(c),
      selected: isSel("cabinet", c.id),
      select: COLORS.select, wash: COLORS.selectWash,
    });
  }

  // Symbols.
  for (const s of floor.symbols) drawSymbol(ctx, s, px, isSel("symbol", s.id));

  // Stairs last, over the symbols. Their own wash goes down first, so whatever
  // a flight crosses -- walls, a room tint, a symbol beneath it -- recedes
  // instead of tangling with the treads.
  for (const st of stairsOf(floor)) {
    drawStair(ctx, resolveStair(floor, st), {
      px, ink: symbolInk(st),
      selected: isSel("stair", st.id),
      select: COLORS.select, wash: COLORS.selectWash,
      backing: COLORS.stairWash, warn: COLORS.stairWarn,
    });
  }

  // Tool preview (world space).
  extras.preview?.(ctx, vp);

  ctx.restore(); // back to screen space

  // Room labels (constant px size): the name over the area, where one has been
  // written. Screen-space, so a plan stays readable at any zoom.
  ctx.textAlign = "center";
  for (const r of rooms) {
    const c = vp.toScreen(r.centroid);
    // Which number this is, is stated in the legend — a bare "12.0 m²" that
    // silently means centerline is the whole problem this addresses.
    const mm2 = areaMode === "net" ? r.netAreaMm2 : r.areaMm2;
    const area = (mm2 / 1e6).toFixed(1) + " m²";
    // The clear size, where the room has one to state. Skipped once the room is
    // narrower on screen than the figures themselves, which would smear them
    // over the walls rather than shrink them.
    const size = roomSize(r, dimMode);
    const fits = size !== undefined && size.w * vp.pxPerMm > 76;
    const lift = fits ? 8 : 0;
    ctx.fillStyle = COLORS.roomLabel;
    if (r.name === undefined) {
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(area, c.x, c.y - lift);
    } else {
      ctx.font = `600 ${ROOM_NAME_PX}px system-ui, sans-serif`;
      ctx.fillText(r.name, c.x, c.y - 8 - lift);
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(area, c.x, c.y + 8 - lift);
    }
    if (size && fits) {
      ctx.fillStyle = COLORS.dimension;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(sizeLabel(size), c.x, c.y + (r.name === undefined ? 8 : 24) - lift);
    }
  }
  ctx.fillStyle = COLORS.roomLabel;
  // A name whose point falls in no detected room still draws where it was
  // written: an open-plan space, or a room whose walls are not yet closed.
  for (const rn of looseRoomNames(floor, rooms)) {
    const at = vp.toScreen({ x: rn.x, y: rn.y });
    ctx.font = `600 ${ROOM_NAME_PX}px system-ui, sans-serif`;
    ctx.fillText(rn.name, at.x, at.y);
  }

  // Snap marker.
  if (extras.hoverSnap) {
    const s = vp.toScreen(extras.hoverSnap);
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (steps) drawGridLegend(ctx, canvasH, gridMm, steps, areaMode, dimMode);

  // Selected node handle & wall handles drawn by tools layer via preview.
  ctx.restore();
}

function tracePoly(ctx: CanvasRenderingContext2D, poly: Vec[]): void {
  if (poly.length === 0) return;
  ctx.moveTo(poly[0]!.x, poly[0]!.y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y);
  ctx.closePath();
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number, gridMm: number): GridSteps {
  // Both spacings are whole multiples of gridMm (see grid.ts), so a square on
  // screen is always a whole number of grid cells.
  const steps = gridSteps(gridMm, vp.pxPerMm);
  const tl = vp.toWorld(v(0, 0)), br = vp.toWorld(v(w, h));
  const drawLines = (stepMm: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / stepMm) * stepMm; x <= br.x; x += stepMm) {
      const sx = (x - vp.origin.x) * vp.pxPerMm;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(tl.y / stepMm) * stepMm; y <= br.y; y += stepMm) {
      const sy = (y - vp.origin.y) * vp.pxPerMm;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();
  };
  drawLines(steps.minor, COLORS.grid);
  drawLines(steps.major, COLORS.gridMajor);
  return steps;
}

/** Bottom-left legend naming the document grid and, when the zoom forced a
 * coarser spacing, what the lines on screen actually measure. */
function drawGridLegend(
  ctx: CanvasRenderingContext2D, h: number, gridMm: number, steps: GridSteps,
  areaMode: AreaMode, dimMode: DimMode,
): void {
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.hud;
  const grid = steps.stepped
    ? t("hint.gridLegendStepped", { grid: fmtMm(gridMm), minor: fmtMm(steps.minor), major: fmtMm(steps.major) })
    : t("hint.gridLegend", { grid: fmtMm(gridMm), major: fmtMm(steps.major) });
  // Always name both conventions: an unlabelled figure is the ambiguity, and a
  // dimension read as hart-op-hart when it is a dagmaat is off by half a wall.
  const text = grid + " · " +
    t(areaMode === "net" ? "hint.areaLegendNet" : "hint.areaLegendCenterline") + " · " +
    t(`hint.dimLegend${dimMode[0]!.toUpperCase()}${dimMode.slice(1)}`);
  ctx.fillText(text, 10, h - 10);
}

function fmtMm(mm: number): string {
  return mm >= 1000 ? `${+(mm / 1000).toFixed(2)} m` : `${mm} mm`;
}

function drawOpening(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, isSel: boolean): void {
  const o = og.opening;
  const color = isSel ? COLORS.select : COLORS.opening;
  ctx.strokeStyle = color;
  ctx.lineWidth = (isSel ? 2 : 1.2) * px;

  const h = og.half;
  // Jamb lines across the wall.
  for (const [p, n] of [[og.p0, og.n0], [og.p1, og.n1]] as const) {
    ctx.beginPath();
    ctx.moveTo(p.x - n.x * h, p.y - n.y * h);
    ctx.lineTo(p.x + n.x * h, p.y + n.y * h);
    ctx.stroke();
  }

  if (o.kind === "door") drawDoor(ctx, og, px, color);
  else if (o.kind === "window") drawWindow(ctx, og, px, color);
  else drawPassage(ctx, og, px, color);

  // Opening annotations stay compact and on the room side: E = powered,
  // Z = self-closing (zelfsluitend), followed by any fire-resistance rating.
  const labels: string[] = [];
  if (o.powered) labels.push("E");
  if (o.selfClosing) labels.push("Z");
  if (o.fireRating) labels.push(fireLabel(o.fireRating));
  if (labels.length > 0) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = "120px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    labels.forEach((label, i) => {
      const at = add(og.center, scale(og.n0, h + 120 + i * 140));
      ctx.fillText(label, at.x, at.y);
    });
    ctx.restore();
  }
}

function drawDoor(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, color: string): void {
  const o = og.opening;
  const w = dist(og.p0, og.p1);
  if (w <= 1) return;
  const along = scale(sub(og.p1, og.p0), 1 / w);
  ctx.strokeStyle = color;
  const sashes = sashesOf(o, w);
  let cursor = 0;
  for (const leaf of sashes) {
    const a = add(og.p0, scale(along, cursor));
    const b = add(og.p0, scale(along, cursor + leaf.width));
    cursor += leaf.width;
    drawDoorLeaf(ctx, leaf, a, b, along, og.n0, og.half, px, o.glazed);
    drawBars(ctx, leaf, a, b, og.n0, og.half, px);
  }
}

/**
 * One door leaf. Drawn heavier than a window sash and with the swing arc dashed,
 * which is the usual weight difference between a door and a window on a plan.
 */
function drawDoorLeaf(
  ctx: CanvasRenderingContext2D, leaf: Sash & { width: number },
  a: Vec, b: Vec, along: Vec, n: Vec, h: number, px: number, glazedLeaf?: boolean,
): void {
  const w = leaf.width;
  if (w <= 1) return;
  const outward = leaf.outward === true;

  if (leaf.action === "slide") {
    drawSlideArrow(ctx, a, b, along, n, h, px, leaf.slideTo ?? "b");
    return;
  }
  if (leaf.action === "fold") {
    drawFold(ctx, leaf, a, along, n, px, outward);
    return;
  }
  if (leaf.action === "revolve") {
    // Tourniquet. The drum spans the opening, so its radius is half the width.
    // Two arcs form the enclosure along the wall; the quadrants facing each side
    // of the wall stay open, which is where people walk through. Four leaves sit
    // at 45 degrees so none of them blocks an opening in the drawn position.
    const mid = add(a, scale(sub(b, a), 0.5));
    const rad = w * 0.5;
    const base = angleOf(along);
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([]);
    const QUARTER = Math.PI / 2;
    const SPAN = QUARTER * 1.1;            // enclosure wall, a little over 90 degrees
    for (const centre of [base, base + Math.PI]) {
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, rad, centre - SPAN / 2, centre + SPAN / 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1.4 * px;
    for (let i = 0; i < 4; i++) {
      const ang = base + QUARTER / 2 + i * QUARTER;
      line(ctx, mid, add(mid, fromAngle(ang, rad)));
    }
    // Rotation arrow: a short arc inside the drum with a head on its leading end.
    const cw = (leaf.spin ?? "ccw") === "cw";
    const r2 = rad * 0.45;
    const from = base + QUARTER / 2;
    const sweep = cw ? QUARTER * 1.2 : -QUARTER * 1.2;
    ctx.lineWidth = 1 * px;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, r2, from, from + sweep, !cw);
    ctx.stroke();
    const tipAng = from + sweep;
    const tip = add(mid, fromAngle(tipAng, r2));
    // Tangent at the tip, pointing the way it turns.
    const tangent = fromAngle(tipAng + (cw ? QUARTER : -QUARTER), 1);
    const head = Math.min(rad * 0.22, 220);
    const backTip = add(tip, scale(tangent, -head));
    line(ctx, tip, add(backTip, scale(perp(tangent), head * 0.45)));
    line(ctx, tip, add(backTip, scale(perp(tangent), -head * 0.45)));
    return;
  }
  if (leaf.action === "double-acting") {
    // Doordraaiend: no fixed side, so both swings are drawn — the tapered leaf
    // on the sheets is the same leaf shown at both extremes.
    const hingeAtA = (leaf.hinge ?? "a") !== "b";
    const hinge = hingeAtA ? a : b;
    const other = hingeAtA ? b : a;
    const dir = scale(sub(other, hinge), 1 / w);
    const a0 = angleOf(sub(other, hinge));
    for (const sign of [1, -1]) {
      const tip = add(hinge, scale(scale(perp(dir), sign), w));
      ctx.lineWidth = 1.4 * px;
      ctx.setLineDash([]);
      line(ctx, hinge, tip);
      const a1 = angleOf(sub(tip, hinge));
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      ctx.lineWidth = 1 * px;
      ctx.setLineDash([40, 40]);
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, w, a0, a0 + d, d < 0);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    return;
  }
  if (leaf.action === "overhead") {
    // Kanteldeur tilts up out of the plan entirely; in plan it is a panel
    // filling the opening, marked with the axis it tilts about.
    const face = outward ? scale(n, -1) : n;
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([]);
    const off = scale(face, h * 0.45);
    line(ctx, add(a, off), add(b, off));
    line(ctx, a, add(a, off));
    line(ctx, b, add(b, off));
    ctx.setLineDash([30, 30]);
    line(ctx, add(a, scale(face, h * 0.9)), add(b, scale(face, h * 0.9)));
    ctx.setLineDash([]);
    return;
  }
  if (leaf.action === "pivot") {
    // Taatsdeur: turns about its own centre, so the leaf is drawn across the
    // opening through the pivot rather than hinged at a jamb.
    const mid = add(a, scale(sub(b, a), 0.5));
    const face = outward ? scale(n, -1) : n;
    ctx.lineWidth = 1.4 * px;
    ctx.setLineDash([]);
    line(ctx, add(mid, scale(face, w * 0.5)), add(mid, scale(face, -w * 0.5)));
    ctx.setLineDash([40, 40]);
    ctx.lineWidth = 1 * px;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, w * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  // Hinged leaf: fully open at 90 degrees, plus its quarter swing arc.
  const glazed = glazedLeaf === true;
  const hingeAtA = (leaf.hinge ?? "a") !== "b";
  const hinge = hingeAtA ? a : b;
  const other = hingeAtA ? b : a;
  const dir = scale(sub(other, hinge), 1 / w);
  const swing = outward ? scale(perp(dir), -1) : perp(dir);
  const tip = add(hinge, scale(swing, w));
  ctx.setLineDash([]);
  if (glazed) {
    // Two thin lines with a gap: a glazed leaf, not a solid panel.
    const across = scale(perp(scale(sub(tip, hinge), 1 / w)), Math.min(w * 0.04, 40));
    ctx.lineWidth = 0.9 * px;
    line(ctx, add(hinge, across), add(tip, across));
    line(ctx, sub(hinge, across), sub(tip, across));
  } else {
    ctx.lineWidth = 1.4 * px;
    line(ctx, hinge, tip);
  }
  const a0 = angleOf(sub(other, hinge));
  const a1 = angleOf(sub(tip, hinge));
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (detailFor(w, px).arcs) {
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([40, 40]);
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, w, a0, a0 + d, d < 0);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Concertina leaves, shared by vouwwand windows and folding doors. */
function drawFold(
  ctx: CanvasRenderingContext2D, sash: Sash & { width: number },
  a: Vec, along: Vec, n: Vec, px: number, outward: boolean,
): void {
  const w = sash.width;
  const face = outward ? scale(n, -1) : n;
  const leaves = Math.max(2, Math.round(w / 700));
  const step = w / leaves;
  const depth = Math.min(step * 0.8, 500);
  ctx.lineWidth = 1.2 * px;
  ctx.setLineDash(outward ? [] : [30, 30]);
  for (let i = 0; i < leaves; i++) {
    const p0 = add(a, scale(along, i * step));
    const p1 = add(a, scale(along, (i + 1) * step));
    const peak = add(add(p0, scale(along, step * 0.5)),
                     scale(face, i % 2 === 0 ? depth : depth * 0.25));
    line(ctx, p0, peak);
    line(ctx, peak, p1);
  }
  ctx.setLineDash([]);
}

function drawWindow(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, color: string): void {
  const o = og.opening;
  const h = og.half;
  const w = dist(og.p0, og.p1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * px;
  // Frame: a line along each wall face, spanning the whole opening.
  for (const off of [-h, h]) {
    ctx.beginPath();
    ctx.moveTo(og.p0.x + og.n0.x * off, og.p0.y + og.n0.y * off);
    ctx.lineTo(og.p1.x + og.n1.x * off, og.p1.y + og.n1.y * off);
    ctx.stroke();
  }
  // Glass line down the middle of the whole opening.
  ctx.lineWidth = 0.8 * px;
  line(ctx, og.p0, og.p1);

  const along = w > 0 ? scale(sub(og.p1, og.p0), 1 / w) : og.tan0;
  const sashes = sashesOf(o, w);
  let cursor = 0;
  for (let i = 0; i < sashes.length; i++) {
    const sash = sashes[i]!;
    const a = add(og.p0, scale(along, cursor));
    const b = add(og.p0, scale(along, cursor + sash.width));
    cursor += sash.width;
    // Mullion between panes — a combination window is one hole subdivided, so
    // the divider is a frame member, not a wall return.
    if (i > 0) {
      ctx.lineWidth = 1.2 * px;
      ctx.setLineDash([]);
      line(ctx, add(a, scale(og.n0, -h)), add(a, scale(og.n0, h)));
    }
    drawSash(ctx, sash, a, b, along, og.n0, h, px);
    drawBars(ctx, sash, a, b, og.n0, h, px);
  }
}

/**
 * How much of an opening symbol is worth drawing at the current zoom.
 *
 * The sheets show a door three ways — at 1:100 a plain gap, at 1:50 leaf and
 * arc, at 1:20 the frame too. A zoomable editor has no single scale, so the
 * same idea is expressed against how large the leaf actually lands on screen:
 * below about a centimetre of screen a swing arc is an illegible squiggle that
 * only adds noise, and glazing bars closer than a few pixels merge into a
 * smudge. `px` is millimetres per screen pixel, so w / px is the leaf's size in
 * pixels.
 */
function detailFor(widthMm: number, px: number): { arcs: boolean; fine: boolean } {
  const screenPx = widthMm / px;
  return { arcs: screenPx >= 14, fine: screenPx >= 40 };
}

/**
 * Roedeverdeling. Glazing bars lie in the plane of the glass, so a plan sees
 * them edge-on: they read as short ticks across the glass line, not as the grid
 * an elevation shows.
 */
function drawBars(
  ctx: CanvasRenderingContext2D, sash: Sash & { width: number },
  a: Vec, b: Vec, n: Vec, h: number, px: number,
): void {
  const panes = sash.bars ?? 0;
  if (panes < 2 || !detailFor(sash.width, px).fine) return;
  ctx.lineWidth = 0.8 * px;
  ctx.setLineDash([]);
  for (let i = 1; i < panes; i++) {
    const p = add(a, scale(sub(b, a), i / panes));
    line(ctx, add(p, scale(n, -h * 0.4)), add(p, scale(n, h * 0.4)));
  }
}

/** One pane's opening symbol, drawn between jamb points a and b along the wall. */
function drawSash(
  ctx: CanvasRenderingContext2D, sash: Sash & { width: number },
  a: Vec, b: Vec, along: Vec, n: Vec, h: number, px: number,
): void {
  const w = sash.width;
  if (w <= 1 || sash.action === "fixed") return;
  if (!detailFor(w, px).arcs) return;   // too small on screen to read
  const outward = sash.outward === true;
  // Legend on the NEN sheets: solid = naar buiten, dashed = naar binnen.
  const dash: number[] = outward ? [] : [30, 30];
  const face = outward ? scale(n, -1) : n;

  if (sash.action === "slide" || sash.action === "turn-slide") {
    drawSlideArrow(ctx, a, b, along, n, h, px, sash.slideTo ?? "b");
  }
  if (sash.action === "turn" || sash.action === "turn-tilt" || sash.action === "turn-slide") {
    // A side-hung sash swings like a door: leaf perpendicular to the wall at the
    // hinge jamb, plus its quarter arc.
    const hingeAtA = (sash.hinge ?? "a") !== "b";
    const hinge = hingeAtA ? a : b;
    const other = hingeAtA ? b : a;
    const swing = outward ? scale(perp(scale(sub(other, hinge), 1 / w)), -1)
                          : perp(scale(sub(other, hinge), 1 / w));
    const tip = add(hinge, scale(swing, w));
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash(dash);
    line(ctx, hinge, tip);
    const a0 = angleOf(sub(other, hinge));
    const a1 = angleOf(sub(tip, hinge));
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, w, a0, a0 + d, d < 0);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (sash.action === "tilt" || sash.action === "turn-tilt" || sash.action === "tumble"
      || sash.action === "project" || sash.action === "parallel") {
    // A horizontal hinge does not exist in plan — these are section symbols on
    // the sheets. A small chevron at mid-span marks that the pane opens at all,
    // so a valraam is not silently identical to a vast raam. Not NEN; an aid.
    const mid = add(a, scale(sub(b, a), 0.5));
    const depth = Math.min(w * 0.28, 300);
    const apex = add(mid, scale(face, depth * 0.35));
    const arm = scale(along, depth * 0.5);
    ctx.lineWidth = 1 * px;
    ctx.setLineDash(dash);
    line(ctx, add(add(mid, arm), scale(face, depth)), apex);
    line(ctx, add(sub(mid, arm), scale(face, depth)), apex);
    ctx.setLineDash([]);
  }
  if (sash.action === "pivot") {
    // Taatsraam: vertical axis, so it DOES turn in plan. Leaf drawn across the
    // opening through its centre, with the swept circle dashed.
    const mid = add(a, scale(sub(b, a), 0.5));
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([]);
    line(ctx, add(mid, scale(face, w * 0.45)), add(mid, scale(face, -w * 0.45)));
    ctx.setLineDash([30, 30]);
    ctx.lineWidth = 0.8 * px;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, w * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (sash.action === "slide-vertical") {
    // Vertical slide is invisible in plan too; mark it with a short bar so it
    // reads as "moves" rather than "fixed".
    const mid = add(a, scale(sub(b, a), 0.5));
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([]);
    line(ctx, add(mid, scale(n, -h * 0.5)), add(mid, scale(n, h * 0.5)));
  }
  if (sash.action === "fold") drawFold(ctx, sash, a, along, n, px, outward);
}

/** Sliding-panel marks: two offset panels and an arrow on the moving one. */
function drawSlideArrow(
  ctx: CanvasRenderingContext2D, a: Vec, b: Vec, along: Vec, n: Vec,
  h: number, px: number, slideTo: "a" | "b",
): void {
  const w = dist(a, b);
  const off = h * 0.35;
  const toB = slideTo === "b";
  ctx.lineWidth = 1 * px;
  ctx.setLineDash([]);
  line(ctx, add(a, scale(n, -off)), add(add(a, scale(along, w * 0.6)), scale(n, -off)));
  line(ctx, add(add(a, scale(along, w * 0.4)), scale(n, off)), add(add(a, scale(along, w)), scale(n, off)));
  const base = add(add(a, scale(along, toB ? w * 0.55 : w * 0.85)), scale(n, off * 2.2));
  const dir = toB ? along : scale(along, -1);
  const tip = add(base, scale(dir, w * 0.3));
  line(ctx, base, tip);
  const back = scale(dir, -Math.min(60, w * 0.12));
  line(ctx, tip, add(add(tip, back), scale(perp(dir), Math.min(40, w * 0.08))));
  line(ctx, tip, add(add(tip, back), scale(perp(dir), -Math.min(40, w * 0.08))));
}

function drawPassage(ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, color: string): void {
  const h = og.half;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8 * px;
  ctx.setLineDash([50, 50]);
  for (const off of [-h, h]) {
    ctx.beginPath();
    ctx.moveTo(og.p0.x + og.n0.x * off, og.p0.y + og.n0.y * off);
    ctx.lineTo(og.p1.x + og.n1.x * off, og.p1.y + og.n1.y * off);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function line(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawSymbol(ctx: CanvasRenderingContext2D, s: SymbolInstance, px: number, selected: boolean): void {
  const def = getSymbol(s.type);
  if (!def) return;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rotation);
  if (s.mirrored) ctx.scale(-1, 1);
  // Selection marks the FRAME, never the symbol itself. Walls and openings do
  // repaint on selection, but they carry no colour of their own; a symbol does,
  // and it is usually being picked right now -- painting it orange would mean
  // the only way to see the colour you chose is to deselect the thing you are
  // choosing it for. So: a wash behind, marching ants around, ink untouched.
  const bx = -def.width / 2 - 30, by = (def.wallMounted ? 0 : -def.depth / 2) - 30;
  const bw = def.width + 60, bh = def.depth + 60;
  if (selected) {
    ctx.fillStyle = COLORS.selectWash;
    ctx.fillRect(bx, by, bw, bh);
  }
  // fill follows stroke: a symbol's filled parts -- a position dot, a standard's
  // code character -- are part of the drawing and take its colour.
  ctx.strokeStyle = symbolInk(s);
  ctx.fillStyle = ctx.strokeStyle;
  def.draw(ctx);
  if (selected) {
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([30, 30]);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Label helper for tools: draw text at world point in screen space. */
export function drawLabel(ctx: CanvasRenderingContext2D, vp: Viewport, world: Vec, text: string, color = COLORS.dimension): void {
  const s = vp.toScreen(world);
  ctx.save();
  ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  ctx.font = "12px system-ui, sans-serif";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(s.x - w / 2 - 4, s.y - 18, w + 8, 16);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, s.x, s.y - 6);
  ctx.restore();
}
