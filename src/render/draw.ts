// Full scene render. Immediate mode: redraw everything on change (documents at
// this scale render in well under a frame). Layers: grid, rooms, walls,
// opening decorations, routes, furnishings, symbols, stairs, selection, labels
// (labels in screen space).
import { Floor, SymbolInstance, AreaMode, DimMode, Sash, sashesOf, stairsOf, videsOf, furnishingsOf, fireLabel, Underlay, Wall, Id, wallInfill } from "../model/doc";
import { Resolved, OpeningGeom, Junction, ResolvedWall } from "../core/resolve";
import { Room, roomSize, sizeLabel, looseRoomNames, roomArea } from "../core/rooms";
import { Selection } from "../model/store";
import { Viewport } from "./viewport";
import { Vec, add, sub, scale, perp, v, angleOf, dist, fromAngle } from "../geometry/vec";
import { getSymbol } from "./symbols";
import { drawStair, drawStairGhost } from "./stair";
import { drawVide } from "./vide";
import { drawFurnishing } from "./furnishing";
import { drawRoute, drawRiserMarks } from "./route";
import { resolveRoutes, resolveRoutePoints } from "../core/route";
import type { ResolvedRiserMark } from "../core/continuation";
import {
  routeWater, routeKind, routeVeins, routeDiameter, routeVent, routeDuctDiameter,
  routeHeat, routeHeatDiameter,
  routeFlow, type Route, type Discipline, type RouteWater,
} from "../model/route";
import { ROOM_NAME_PX } from "../model/room";
import { resolveStair } from "../core/stair";
import { t } from "../i18n";
import { gridSteps, GridSteps } from "./grid";
import { LAYER_OF_CATEGORY, layerAlpha, type LayerFlags, type LayerKey } from "./layers";
import { mountMarkOf } from "../core/mount";
import { resolveBoard, BOARD_TYPE } from "../core/board";
import { worldPoint } from "../core/placed";

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
  /**
   * A glazed wall's body. Deliberately neither poché nor paper: a cool wash
   * reads as glass, and it still cuts the room tint underneath, so the band is
   * legible as a wall rather than as a gap where one was never drawn. Light
   * enough that the two faces and the stijlen drawn over it stay the thing seen.
   */
  glassFill: "#dfe8ee",
  /** The faces and posts of a glazed wall: the glazing line, not masonry. */
  glassStroke: "#5b7183",
  /**
   * A sandwich panel's body. Infill like glass and drawn the same way — a light
   * band between two faces rather than poché — but warm rather than cool, so a
   * beplating and a glazen wand are told apart at a glance on the same sheet.
   */
  panelFill: "#e7e1d3",
  /** The facings and posts of a panelled wall. */
  panelStroke: "#8a8065",
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
  /** Verwarming: a violet of its own, distinct from water's green -- CV pipe
   *  is not tapwater pipe, and on a sheet carrying both that has to read. */
  routeHeating: "#7d4fbf",
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
       : d === "heating" ? COLORS.routeHeating
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
  } else if (route.discipline === "heating") {
    head.push(`${routeHeat(route) === "aanvoer" ? "CV-A" : "CV-R"} Ø${routeHeatDiameter(route)}`);
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

/** Linear blend of two "#rrggbb" colours, `k` of the way from `a` to `b`. */
function mix(a: string, b: string, k: number): string {
  const ch = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2]
    .map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k))
    .map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"));
  return "#" + out.join("");
}

/**
 * How one wall's body is painted: the poché and the line around it.
 *
 * Two things vary. A colour is a statement about the work — red is what is to
 * be built — so it takes the FILL and not merely the outline, which is what a
 * verbouwtekening means by drawing a wall in red. A material changes the
 * drawing only for glass, which has no poché at all: there the ink goes on the
 * faces and the body keeps a wash.
 */
export interface WallPen {
  /** The poché, or a glazed wall's wash. */
  fill: string;
  /** The line around the body. */
  stroke: string;
  /**
   * What is drawn OVER the body: this wall's openings and its posts. Separate
   * from `stroke` because an uncoloured wall's decorations are lighter than its
   * outline (COLORS.opening against COLORS.wallStroke) and always have been;
   * only a wall that states a colour pulls both onto one pen.
   */
  mark: string;
  /** True for an infill body (glass or panel), which is drawn as a light band
   *  between two faces rather than as poché. */
  infill: boolean;
}

/** The default masonry pen, and what a junction falls back to. */
const MASONRY_PEN: WallPen = {
  fill: COLORS.wallFill, stroke: COLORS.wallStroke, mark: COLORS.opening, infill: false,
};

/** Outline of a coloured poché: the same pen, darkened, as wallStroke is to wallFill. */
const STROKE_SHADE = 0.37;
/** A coloured glazed body: the ink at a wash, so the faces over it still read. */
const GLASS_WASH = 0.82;

/**
 * The pen one wall draws with. Validated rather than trusted, for the reason
 * symbolInk() documents: canvas ignores an invalid fillStyle instead of
 * throwing, so a bad value out of a pasted document would paint this wall in
 * whatever colour was set last.
 */
export function wallPen(w: Pick<Wall, "color" | "material">): WallPen {
  const ink = w.color && HEX.test(w.color) ? w.color : null;
  // Infill is a light body between two faces, so the ink goes on the faces and
  // the body keeps a wash — a solid pane of colour would be poché, which is the
  // one thing an infill wall is not.
  if (wallInfill(w)) {
    const line = w.material === "glass" ? COLORS.glassStroke : COLORS.panelStroke;
    const body = w.material === "glass" ? COLORS.glassFill : COLORS.panelFill;
    return {
      fill: ink ? mix(ink, COLORS.bg, GLASS_WASH) : body,
      stroke: ink ?? line,
      mark: ink ?? line,
      infill: true,
    };
  }
  return ink
    ? { fill: ink, stroke: mix(ink, "#000000", STROKE_SHADE), mark: ink, infill: false }
    : MASONRY_PEN;
}

/** A selected wall's fill: its own pen pulled toward the selection orange, so a
 *  red wall and a glazed one both still read as themselves while picked. */
export const selectedFill = (pen: WallPen): string => mix(pen.fill, COLORS.select, 0.18);

/**
 * The pen a junction wedge takes. The wedge belongs to no single wall, so it
 * can only draw in what its neighbours agree on; where they disagree — glass
 * meeting masonry, or a new wall meeting an existing one — it draws as ordinary
 * masonry, which is the material that actually runs through such a junction.
 */
export function junctionPen(j: Junction, walls: ReadonlyMap<Id, ResolvedWall>): WallPen {
  const first = walls.get(j.walls[0] ?? "");
  if (!first) return MASONRY_PEN;
  const pen = wallPen(first.wall);
  for (const id of j.walls) {
    const rw = walls.get(id);
    if (!rw) return MASONRY_PEN;
    const other = wallPen(rw.wall);
    if (other.fill !== pen.fill || other.stroke !== pen.stroke) return MASONRY_PEN;
  }
  return pen;
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
   * Selected alongside `sel`, by id and of its kind — the furnishings a
   * shift-click has added to the one the property pane edits. Every one of
   * them carries the selection frame; the drawing must not say that only the
   * last one clicked will move.
   */
  selMore?: readonly string[];
  /** Derived cross-floor marks for the active storey. */
  riserMarks?: readonly ResolvedRiserMark[];
  /**
   * Devices with a declared service nobody has connected, and how far through
   * the pulse they are (0..1). Editor state -- absent everywhere but the live
   * canvas, so no export ever draws it.
   */
  incomplete?: ReadonlyMap<string, readonly Vec[]>;
  pulse?: number;
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
   * Per-layer visibility (Tools.layers). Absent, or a layer missing from it,
   * means visible -- an export that never sets this (PNG included; see
   * io/image.ts) draws every layer regardless of what a live editor's toggles
   * happen to say, since it has no Tools to read them from.
   */
  layers?: LayerFlags;
  /**
   * Layers the armed tool cannot act on, drawn faded rather than hidden so the
   * work still has its context. Absent everywhere but the live canvas.
   */
  dimLayers?: readonly LayerKey[];
  /**
   * Called once when a cached underlay image finishes decoding, so the host
   * can redraw with it visible. Unused, and safe to omit, wherever
   * showUnderlay is never true (every offscreen/export render).
   */
  requestRedraw?: () => void;
  /**
   * The select tool's multi-select mode, when it is live (Tools.selectModeBadge):
   * `n` gathered so far, and the top inset the badge must clear. Draws a badge
   * over the plan, because in that mode a tap adds and removes instead of
   * replacing and nothing else on the canvas says so.
   *
   * Editor state, not drawing: absent on the loupe and on every export, which
   * is what keeps it out of the PNG.
   */
  selectMode?: { n: number; top: number } | null;
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
  mountMarks: boolean,
): void {
  // True for the primary selection AND every member `extras.selMore` carries
  // alongside it -- a shift-click, a touch hold, or a marquee's catch all
  // draw the same frame, not just the one clicked or picked last. One helper
  // so every kind below routes selection highlighting through the same
  // check, the way the fit-out path already did before this generalised it.
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

  // Cladding first, so the structural body draws over the band's inner edge and
  // the two read as one wall rather than as two stacked ones. Filled with the
  // paper colour: a facade is outside the building, and the drawing convention
  // is a white band outlined against the poché rather than a second poché.
  for (const rw of resolved.walls.values()) {
    if (rw.facade.length === 0) continue;
    const pen = wallPen(rw.wall);
    const line = isSel("wall", rw.wall.id) ? COLORS.select : pen.stroke;
    for (const band of rw.facade) {
      ctx.beginPath();
      tracePoly(ctx, band.poly);
      ctx.fillStyle = COLORS.bg;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = px;
      ctx.stroke();
    }
  }

  // Walls.
  for (const rw of resolved.walls.values()) {
    const wallSel = isSel("wall", rw.wall.id);
    const pen = wallPen(rw.wall);
    const line = wallSel ? COLORS.select : pen.stroke;
    for (const piece of rw.pieces) {
      ctx.beginPath();
      tracePoly(ctx, piece.poly);
      ctx.fillStyle = wallSel ? selectedFill(pen) : pen.fill;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = (wallSel ? 2 : 1) * px;
      ctx.stroke();
    }
    // Posts, over the body they divide. Empty where the wall states no frame.
    // A stated profile is a member with a footprint, so it is filled at the size
    // it is built to; without one the post is a hairline, which is the drawing
    // saying the centres are known and the section is not.
    if (rw.posts.length > 0) {
      const postInk = wallSel ? COLORS.select : pen.mark;
      ctx.beginPath();
      for (const m of rw.posts) if (!m.poly) { ctx.moveTo(m.a.x, m.a.y); ctx.lineTo(m.b.x, m.b.y); }
      ctx.strokeStyle = postInk;
      ctx.lineWidth = px;
      ctx.stroke();
      for (const m of rw.posts) {
        if (!m.poly) continue;
        ctx.beginPath();
        tracePoly(ctx, m.poly);
        ctx.fillStyle = postInk;
        ctx.fill();
        ctx.strokeStyle = postInk;
        ctx.lineWidth = px;
        ctx.stroke();
      }
    }
    // An opening states the same work its wall does, so it draws in the wall's
    // pen: a new door in a new wall is red throughout, not red with a black door.
    for (const og of rw.openings) drawOpening(ctx, og, px, isSel("opening", og.opening.id), pen.mark);
  }

  // Junction fill goes on top of the wall pieces: it closes the wedge a T-shaped
  // junction leaves between two slanted end-caps, and covers the seam strokes
  // that bounded it. Fill only — every edge of it is interior to the masonry.
  for (const j of resolved.junctions) {
    ctx.beginPath();
    tracePoly(ctx, j.poly);
    ctx.fillStyle = junctionPen(j, resolved.walls).fill;
    ctx.fill();
  }

  // Routes: a services overlay. Drawn over the masonry, so a duct reads as
  // crossing a wall in plan the way it does on an installation drawing, and
  // under the fit-out and symbols that follow so a socket or tap placed on
  // top of a run stays the thing actually read there.
  const alphaOf = (key: LayerKey): number => layerAlpha(key, extras.layers, extras.dimLayers);
  /** Draw `fn`'s work at the layer's alpha, or not at all when it is hidden. */
  const onLayer = (key: LayerKey, fn: () => void): void => {
    const alpha = alphaOf(key);
    if (alpha === 0) return;
    if (alpha === 1) { fn(); return; }
    ctx.save();
    ctx.globalAlpha = alpha;
    fn();
    ctx.restore();
  };

  const visibleRoutes = resolveRoutes(floor).filter(rr => alphaOf(rr.route.discipline) > 0);
  const linkedByRoute = new Map<string, Set<string>>();
  for (const mark of extras.riserMarks ?? []) for (const member of mark.members) {
    const set = linkedByRoute.get(member.routeId) ?? new Set<string>();
    set.add(member.pointId);
    linkedByRoute.set(member.routeId, set);
  }
  for (let routeIndex = 0; routeIndex < visibleRoutes.length; routeIndex++) {
    const rr = visibleRoutes[routeIndex]!;
    const route = rr.route;
    const ink = routeInk(route.discipline, route.discipline === "water" ? routeWater(route) : undefined);
    onLayer(route.discipline, () => {
      drawRoute(ctx, rr, route.points, resolveRoutePoints(floor, route), {
        ink,
        selected: isSel("route", route.id),
        select: COLORS.select, wash: COLORS.selectWash,
      }, linkedByRoute.get(route.id));
      const longest = [...rr.segments].sort((a, b) => dist(b.a, b.b) - dist(a.a, a.b))[0];
      if (longest) {
        // Stagger labels along parallel lanes so three labels do not form one
        // unclickable stack at the shared midpoint.
        const frac = 0.32 + (routeIndex % 3) * 0.18;
        drawLabel(ctx, vp, add(longest.a, scale(sub(longest.b, longest.a), frac)), routeMapLabel(route), ink);
      }
    });
  }
  const visibleMarks = (extras.riserMarks ?? []).filter(mark => alphaOf(mark.discipline) > 0);
  const selectedRoutes = new Set(sel?.kind === "route" ? [sel.id, ...(extras.selMore ?? [])] : []);
  for (const mark of visibleMarks) {
    onLayer(mark.discipline, () => {
      drawRiserMarks(ctx, [mark], selectedRoutes, m => routeInk(m.discipline));
    });
  }

  // The fit-out, over the masonry and under the symbols. A unit stands against
  // a wall, so the wall draws first and takes the back edge with it; a socket
  // or a tap drawn on a unit has to stay visible over its front.
  onLayer("furnishing", () => {
    for (const fn of furnishingsOf(floor)) {
      drawFurnishing(ctx, fn, {
        px, ink: symbolInk(fn),
        selected: isSel("furnishing", fn.id),
        select: COLORS.select, wash: COLORS.selectWash,
      });
      const gaps = extras.incomplete?.get(fn.id);
      if (gaps) drawIncomplete(ctx, gaps, px, extras.pulse ?? 0);
    }
  });

  // Symbols, each on the layer of its own discipline. The mounting-height
  // figure rides the same layer as the device it belongs to -- switching the
  // electrical layer off takes its heights with it -- and is drawn in world
  // space at the riser mark's size, so the SVG and DXF exports write the same
  // annotation in the same place (core/mount.ts).
  for (const s of floor.symbols) {
    const cat = getSymbol(s.type)?.category;
    const key = cat ? LAYER_OF_CATEGORY[cat] : "furnishing";
    onLayer(key, () => {
      drawSymbol(ctx, s, px, isSel("symbol", s.id));
      if (s.type === BOARD_TYPE) drawBoardGroups(ctx, s, isSel("symbol", s.id));
      const gaps = extras.incomplete?.get(s.id);
      if (gaps) drawIncomplete(ctx, gaps, px, extras.pulse ?? 0);
      const mark = mountMarks ? mountMarkOf(floor, s) : null;
      if (!mark) return;
      ctx.save();
      ctx.fillStyle = isSel("symbol", s.id) ? COLORS.select : symbolInk(s);
      ctx.font = mark.size + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(mark.text, mark.at.x, mark.at.y);
      ctx.restore();
    });
  }

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
    const mm2 = roomArea(r, areaMode);
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
  if (extras.selectMode) drawSelectModeBadge(ctx, canvasW, extras.selectMode);

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

/**
 * The select tool's mode badge: a pill at the top of the canvas naming the
 * mode and the count. Top-centre rather than beside the grid legend, because
 * the legend describes the drawing and this describes what the next tap will
 * do; centred, it is also clear of both layouts' chrome once `top` insets it.
 *
 * Filled in the selection colour, the same colour the gathered objects are
 * outlined in, so the badge and what it counts read as one thing.
 */
function drawSelectModeBadge(
  ctx: CanvasRenderingContext2D, w: number, mode: { n: number; top: number },
): void {
  const text = t("hint.selectModeBadge", { n: mode.n });
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padX = 12, h = 24;
  const boxW = ctx.measureText(text).width + padX * 2;
  const x = Math.round(w / 2 - boxW / 2), y = Math.round(mode.top + 10);
  ctx.fillStyle = COLORS.select;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, h, h / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.bg;
  ctx.fillText(text, x + boxW / 2, y + h / 2 + 0.5);
}

function fmtMm(mm: number): string {
  return mm >= 1000 ? `${+(mm / 1000).toFixed(2)} m` : `${mm} mm`;
}

function drawOpening(
  ctx: CanvasRenderingContext2D, og: OpeningGeom, px: number, isSel: boolean, ink: string,
): void {
  const o = og.opening;
  const color = isSel ? COLORS.select : ink;
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
  // A quarter turn whose SIDE comes from the wall's normal. The side must not
  // come from perp(hinge -> other) -- that reverses with the hinge jamb, which
  // drew a plain double door as an S -- and the tip must not come from the
  // normal either, or a leaf on a bowed wall swings through more or less than
  // 90 degrees. See addSwing() in io/marks.ts, which this must agree with.
  const dir = scale(sub(other, hinge), 1 / w);
  const across = perp(dir);
  const face = outward ? scale(n, -1) : n;
  const swing = across.x * face.x + across.y * face.y >= 0 ? across : scale(across, -1);
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

/**
 * The groepen of a groepenkast: a stub down from the kast's front edge to each
 * groep's connection point, the point itself, and its label.
 *
 * Drawn because a groep is a thing a cable hooks onto — a fan of numbered
 * points is what makes "which groep is this run on" a question the drawing can
 * answer by looking. The kast's own mark is unchanged and stays one fixed
 * picture; this is what it distributes, not part of the mark.
 */
function drawBoardGroups(ctx: CanvasRenderingContext2D, board: SymbolInstance, selected: boolean): void {
  const groups = resolveBoard(board);
  if (groups.length === 0) return;
  const ink = selected ? COLORS.select : symbolInk(board);
  const def = getSymbol(board.type);
  const edge = worldPoint(board, { x: 0, y: def?.depth ?? 0 });
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 20;
  ctx.font = "90px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { group, at } of groups) {
    ctx.beginPath();
    ctx.moveTo(edge.x, edge.y);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(at.x, at.y, 45, 0, Math.PI * 2);
    ctx.fill();
    if (group.name) ctx.fillText(group.name, at.x, at.y + 130);
  }
  ctx.restore();
}

/** How long one pulse takes, ms. Slow enough to read as breathing rather than
 *  as a flash, which on a drawing reads as an error the drawing cannot fix. */
export const PULSE_MS = 1600;
/** Smallest radius of the ring, mm. It breathes out from here. */
const PULSE_PAD_MM = 90;

/**
 * The ring around a device whose declared services are not all connected.
 *
 * A ring rather than a recolour: colour on a plan already MEANS something here
 * (existing work black, new red, removed yellow -- see SymbolInstance.color),
 * so tinting an incomplete socket would say it is to be demolished. The ring
 * sits outside the mark instead, and pulses so it reads as an editor's note
 * rather than as part of the drawing.
 *
 * Drawn at the PORT, not at the device: a bath waiting for its taps is marked
 * at the taps, so the mark says where to draw to rather than only that
 * something is missing somewhere on a fixture two metres long.
 */
function drawIncomplete(
  ctx: CanvasRenderingContext2D, at: readonly Vec[], px: number, phase: number,
): void {
  const breathe = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.45 * breathe;
  ctx.strokeStyle = COLORS.stairWarn;
  ctx.lineWidth = Math.max(20, 2 / px);
  for (const p of at) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, PULSE_PAD_MM + 60 * breathe, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
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
