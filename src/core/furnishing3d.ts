// Derived 3D geometry for the inrichting: the prisms one placed furnishing
// contributes to the scene mesh, built per form so a bath reads as a tub, a
// kitchen run as carcasses under a blad, and a table as a top on legs.
//
// The plan mark is the reference. Every part below is laid out from the same
// stored width, depth and height the 2D mark is drawn from, and from the same
// fractions (src/render/furnishing/) where the mark states one -- a bath's rim,
// a basin's inset, a sofa's back -- so the body and the mark cannot disagree
// about which way a piece faces or where its bowl sits.
//
// Footprints are built in the furnishing's own frame (the frame furnishingBox()
// uses: a wall-mounted piece runs y from 0 at the wall into the room, a
// free-standing one is centred) and mapped through worldPoint(), so rotation
// and mirroring follow the placed object exactly as the drawing does.
//
// z is mm above the furnishing's own storey floor: 0 for a piece that stands on
// it, OVERHEAD_Z0_MM for one that hangs. Mesh winding is normalized by the
// caller; polygon orientation is not significant here.
import {
  Furnishing, applianceMark, bedPlaces, furnishingBasins, furnishingDrawers,
  furnishingFront, furnishingHeight, furnishingKind, furnishingOverhead, rackBays, showerTray,
  toiletCistern,
} from "../model/furnishing";
import { Vec, v, clipHalfPlane, polygonArea } from "../geometry/vec";
import { worldPoint } from "./placed";
import {
  cabinetFront, cabinetOutline, furnishingBox, FRONT_THICKNESS, WORKTOP_OVERHANG,
} from "./furnishing";

/**
 * What a part is made of. The mesh maps these to colours; nothing here states a
 * finish. Casework is board and timber, worktop the blad over it, appliance the
 * steel of a toestel, sanitary the porcelain of a fixture, soft a mattress or
 * upholstery.
 */
export type FitoutMaterial = "casework" | "worktop" | "appliance" | "sanitary" | "soft";

/** One vertical prism of a furnishing: a footprint over a z-band. */
export interface FurnishingPart {
  poly: Vec[];
  /** Rings cut out of the footprint -- a tub inside its rim, a bowl in a blad. */
  holes?: Vec[][];
  z0: number;
  z1: number;
  material: FitoutMaterial;
}

/**
 * Where overhead fit-out starts, mm above the floor: the ordinary underside of
 * a bovenkast hung over a worktop, and the height an afzuigkap goes to. A
 * furnishing carries no stored mounting height (see model/furnishing.ts), so
 * the one figure is stated here and read by the 3D mesh and the IFC export
 * alike.
 */
export const OVERHEAD_Z0_MM = 1400;

/** Where a furnishing's body starts: on the floor, unless it hangs. */
export const furnishingZ0 = (f: Furnishing): number =>
  furnishingOverhead(f) ? OVERHEAD_Z0_MM : 0;

/** Plinth under a cabinet run: the recess a kitchen's toe kick is set out to. */
const PLINTH_MM = 150;
const PLINTH_SETBACK_MM = 50;
/** Blad over a carcass, and the shadow gap around a front panel. */
const WORKTOP_MM = 40;
const REVEAL_MM = 4;
/** How deep a bowl sits below the surface it is set in. */
const SINK_DEPTH_MM = 200;
const BASIN_DEPTH_MM = 140;
/** Plate stock: a shelf, a tray floor, the bottom of a bowl. */
const PLATE_MM = 25;
/** Square section of a leg, an upright or a shower rail, mm. */
const POST_MM = 60;
/** Footprints under this area (mm²), and z-bands under this height (mm), are
 *  dropped rather than emitted. */
const AREA_EPS = 1;
const H_EPS = 1e-6;
/** Chord step for flattening a bowl's or a round table's arcs, radians. */
const ARC_CHORD = Math.PI / 16;

/** A part before it is placed: the same fields, in the furnishing's own frame. */
type LocalPart = FurnishingPart;

/**
 * The prisms one furnishing contributes to the scene mesh, in world
 * millimetres. Degenerate footprints and empty z-bands are dropped rather than
 * emitted.
 *
 * The z-band a piece occupies is its own: most forms fill [z0, z0 + height],
 * but a cabinet stands on its plinth and carries its blad, so a 720 carcass
 * reaches the 910 worktop height a Dutch kitchen is set out to (see
 * model/furnishing.ts). The IFC export states the nominal box instead; that is
 * the same difference as between a stair's stepped body here and the single
 * flight solid it exports as.
 */
export function furnishingSolids(f: Furnishing): FurnishingPart[] {
  const base = furnishingZ0(f);
  const out: FurnishingPart[] = [];
  for (const p of localParts(f)) {
    if (!(p.z1 - p.z0 > H_EPS)) continue;
    if (p.poly.length < 3 || Math.abs(polygonArea(p.poly)) <= AREA_EPS) continue;
    const holes = (p.holes ?? [])
      .filter(h => h.length >= 3 && Math.abs(polygonArea(h)) > AREA_EPS)
      .map(h => h.map(q => worldPoint(f, q)));
    out.push({
      poly: p.poly.map(q => worldPoint(f, q)),
      ...(holes.length > 0 ? { holes } : {}),
      z0: base + p.z0, z1: base + p.z1, material: p.material,
    });
  }
  return out;
}

function localParts(f: Furnishing): LocalPart[] {
  switch (f.form) {
    case "cabinet": return cabinetParts(f);
    case "appliance": return applianceParts(f);
    case "counter": return counterParts(f);
    case "toilet": return toiletParts(f);
    case "urinal": return urinalParts(f);
    case "urinal-trough": return troughParts(f);
    case "bidet": return bidetParts(f);
    case "basin": return basinParts(f);
    case "basin-trough": return basinTroughParts(f);
    case "bath": return bathParts(f);
    case "shower": return showerParts(f);
    case "shower-head": return showerHeadParts(f);
    case "bed": return bedParts(f);
    case "seat": return seatParts(f);
    case "table": return tableParts(f);
    case "table-round": return tableRoundParts(f);
    case "desk": return deskParts(f);
    case "rack": return rackParts(f);
  }
}

/* ── shapes in the furnishing's own frame ─────────────────────────────────── */

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] =>
  [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];

/** A rectangle pulled in by `d` on every side; empty when nothing is left. */
function shrink(x0: number, y0: number, x1: number, y1: number, d: number): Vec[] {
  if (x1 - x0 <= 2 * d || y1 - y0 <= 2 * d) return [];
  return rect(x0 + d, y0 + d, x1 - d, y1 - d);
}

/** A convex footprint pulled in by `d` on every edge, by clipping against each
 *  edge's inward offset -- a corner unit's pentagon insets like its box. */
function insetPoly(poly: Vec[], d: number): Vec[] {
  const ccw = polygonArea(poly) > 0;
  let out = poly;
  for (let i = 0; i < poly.length && out.length >= 3; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const ex = q.x - p.x, ey = q.y - p.y;
    const l = Math.hypot(ex, ey);
    if (l < H_EPS) continue;
    // Inward is left of travel on a positively wound ring under y-down.
    const nx = (ccw ? -ey : ey) / l, ny = (ccw ? ex : -ex) / l;
    out = clipHalfPlane(out, v(p.x + nx * d, p.y + ny * d), v(nx, ny));
  }
  return out.length >= 3 ? out : [];
}

/** An ellipse as a polygon, flattened at ARC_CHORD. */
function ellipse(cx: number, cy: number, rx: number, ry: number): Vec[] {
  const steps = Math.max(8, Math.ceil((Math.PI * 2) / ARC_CHORD));
  const out: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(v(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
  }
  return out;
}

/** A rectangle with its corners rounded to `r`, as a polygon -- the plan's
 *  rounded() mark, flattened. */
function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): Vec[] {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (rr <= H_EPS) return rect(x0, y0, x1, y1);
  const steps = Math.max(2, Math.ceil(Math.PI / 2 / ARC_CHORD));
  const out: Vec[] = [];
  const corners: Array<[number, number, number]> = [
    [x1 - rr, y1 - rr, 0], [x0 + rr, y1 - rr, Math.PI / 2],
    [x0 + rr, y0 + rr, Math.PI], [x1 - rr, y0 + rr, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      out.push(v(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
    }
  }
  return out;
}

/* ── cabinetry ────────────────────────────────────────────────────────────── */

/**
 * A cabinet: the plinth it stands on, the carcass set back from its front, the
 * front panels with a shadow gap around each, and the blad where the unit
 * carries one. A wall unit hangs and has no plinth; an open unit shows its
 * shelves in the recess the front would otherwise fill.
 */
function cabinetParts(f: Furnishing): LocalPart[] {
  const outline = cabinetOutline(f);
  const h = furnishingHeight(f);
  const hangs = furnishingKind(f) === "wall";
  const plinth = hangs ? 0 : PLINTH_MM;
  const top = plinth + h;
  const out: LocalPart[] = [];

  if (plinth > 0) {
    const foot = insetPoly(outline, PLINTH_SETBACK_MM);
    if (foot.length >= 3) out.push({ poly: foot, z0: 0, z1: plinth, material: "casework" });
  }

  const front = furnishingFront(f);
  const open = front === "open";
  // The carcass stops short of the front so the panels -- or, on an open unit,
  // the shelves -- stand in their own plane; without the setback the two
  // coincide and the faces z-fight.
  const body = setBackFromFront(f, outline, FRONT_THICKNESS);
  out.push({ poly: body.length >= 3 ? body : outline, z0: plinth, z1: top, material: "casework" });

  if (open) {
    // Shelves read the unit as open: a plate at each level, standing in the
    // depth of the front panel the unit does not have.
    const levels = Math.max(1, Math.round(h / 400) - 1);
    for (let i = 1; i <= levels; i++) {
      const z = plinth + (h * i) / (levels + 1);
      out.push({ poly: frontBand(f, 0, 1, 0), z0: z, z1: z + PLATE_MM, material: "casework" });
    }
  } else {
    for (const p of frontPanels(f, plinth, top)) out.push(p);
  }

  if (f.worktop) {
    out.push({
      poly: pushFront(f, outline, WORKTOP_OVERHANG),
      z0: top, z1: top + WORKTOP_MM, material: "worktop",
    });
  }
  return out;
}

/** The unit's open face as a local segment, and the unit normal pointing out
 *  of it. cabinetFront() states the face; the normal is its left under y-down,
 *  which for both a straight and a corner unit points into the room. */
function frontAxis(f: Furnishing): { p: Vec; q: Vec; n: Vec; len: number } {
  const [p, q] = cabinetFront(f);
  const ex = q.x - p.x, ey = q.y - p.y;
  const l = Math.hypot(ex, ey) || 1;
  return { p, q, n: v(-ey / l, ex / l), len: l };
}

/** The footprint with everything within `d` of the front plane cut away. */
function setBackFromFront(f: Furnishing, poly: Vec[], d: number): Vec[] {
  const a = frontAxis(f);
  return clipHalfPlane(poly, v(a.p.x - a.n.x * d, a.p.y - a.n.y * d), v(-a.n.x, -a.n.y));
}

/** The footprint with its front edge pushed out by `d`: the blad's oversail. */
function pushFront(f: Furnishing, poly: Vec[], d: number): Vec[] {
  const a = frontAxis(f);
  const onFront = (q: Vec): boolean =>
    Math.abs((q.x - a.p.x) * a.n.x + (q.y - a.p.y) * a.n.y) <= 1e-6;
  return poly.map(q => (onFront(q) ? v(q.x + a.n.x * d, q.y + a.n.y * d) : q));
}

/**
 * A band across the front, from `t0` to `t1` along the open face and `inset`
 * from either end: where a panel or a shelf stands. The band runs back into the
 * carcass by the front's own thickness.
 */
function frontBand(f: Furnishing, t0: number, t1: number, inset: number): Vec[] {
  const a = frontAxis(f);
  const s0 = t0 + inset / a.len, s1 = t1 - inset / a.len;
  if (!(s1 > s0)) return [];
  const at = (t: number): Vec => v(a.p.x + (a.q.x - a.p.x) * t, a.p.y + (a.q.y - a.p.y) * t);
  const b0 = at(s0), b1 = at(s1);
  const dx = -a.n.x * FRONT_THICKNESS, dy = -a.n.y * FRONT_THICKNESS;
  return [b0, b1, v(b1.x + dx, b1.y + dy), v(b0.x + dx, b0.y + dy)];
}

/** The leaves the front is divided into: one door, a pair, or a bank of
 *  drawers, each set in by a shadow gap. A sliding front reads as its pair of
 *  panels. */
function frontPanels(f: Furnishing, z0: number, z1: number): LocalPart[] {
  const front = furnishingFront(f);
  const out: LocalPart[] = [];
  const panel = (t0: number, t1: number, a: number, b: number): void => {
    const poly = frontBand(f, t0, t1, REVEAL_MM);
    if (poly.length >= 3 && b - a > H_EPS) out.push({ poly, z0: a, z1: b, material: "casework" });
  };
  if (front === "drawers") {
    const n = furnishingDrawers(f);
    const each = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      panel(0, 1, z0 + i * each + REVEAL_MM, z0 + (i + 1) * each - REVEAL_MM);
    }
    return out;
  }
  const leaves = front === "door" ? 1 : 2;
  for (let i = 0; i < leaves; i++) {
    panel(i / leaves, (i + 1) / leaves, z0 + REVEAL_MM, z1 - REVEAL_MM);
  }
  return out;
}

/* ── kitchen ──────────────────────────────────────────────────────────────── */

/**
 * A fixed appliance: the toestel's box. An afzuigkap is the exception -- it
 * hangs, so it is the canopy with its chimney against the wall rather than a
 * block on the floor.
 */
function applianceParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  if (applianceMark(f) !== "hood") {
    return [{ poly: rect(b.x0, b.y0, b.x1, b.y1), z0: 0, z1: h, material: "appliance" }];
  }
  const canopy = Math.min(h * 0.25, 200);
  const flue = rect(-f.width * 0.15, b.y0, f.width * 0.15, b.y0 + f.depth * 0.3);
  return [
    { poly: rect(b.x0, b.y0, b.x1, b.y1), z0: 0, z1: canopy, material: "appliance" },
    { poly: flue, z0: canopy, z1: h, material: "appliance" },
  ];
}

/**
 * The aanrecht: carcass under a blad, with the bowls sunk through both. The
 * bowl footprints are counterMark()'s, so the run's drainer stays on the hand
 * the drawing puts it.
 */
function counterParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const box = rect(b.x0, b.y0, b.x1, b.y1);
  const bowls = counterBowls(f);
  const deck = Math.max(PLINTH_MM, h - WORKTOP_MM);
  const out: LocalPart[] = [
    { poly: insetPoly(box, PLINTH_SETBACK_MM), z0: 0, z1: PLINTH_MM, material: "casework" },
    { poly: box, holes: bowls, z0: PLINTH_MM, z1: deck, material: "casework" },
    { poly: box, holes: bowls, z0: deck, z1: h, material: "worktop" },
  ];
  for (const bowl of bowls) {
    const floor = Math.max(0, deck - SINK_DEPTH_MM);
    out.push({ poly: bowl, z0: floor, z1: floor + PLATE_MM, material: "sanitary" });
  }
  return out;
}

/** The bowls in a worktop run, in local mm -- counterMark()'s own layout. */
function counterBowls(f: Furnishing): Vec[][] {
  const w = f.width, d = f.depth;
  const b = furnishingBox(f);
  const n = furnishingBasins(f);
  const inset = Math.min(d * 0.16, w * 0.1);
  const bowlD = d - 2 * inset;
  const bowlW = Math.min(bowlD * 1.05, (w - inset * (n + 1)) / n);
  const out: Vec[][] = [];
  for (let i = 0; i < n; i++) {
    const x0 = b.x0 + inset + i * (bowlW + inset);
    if (bowlW > 0 && bowlD > 0) out.push(rect(x0, b.y0 + inset, x0 + bowlW, b.y0 + inset + bowlD));
  }
  return out;
}

/* ── sanitair ─────────────────────────────────────────────────────────────── */

/**
 * A toilet: the cistern against the wall and the bowl in front of it, at the
 * depths toiletMark() divides the fixture into. An ingebouwde stortbak is a
 * duct the bowl hangs off; an exposed one is the close-coupled box behind it.
 * Grab rails are the invalidentoilet's clearance made visible.
 */
function toiletParts(f: Furnishing): LocalPart[] {
  const w = f.width, d = f.depth;
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const concealed = toiletCistern(f) === "concealed";
  const band = d * (concealed ? 0.194 : 0.277);
  const bowlW = Math.min(w * 0.9, 400);
  const out: LocalPart[] = [
    {
      poly: rect(b.x0, b.y0, b.x1, b.y0 + band),
      z0: 0, z1: concealed ? 1050 : Math.max(h, 800), material: "sanitary",
    },
    {
      poly: roundedRect(-bowlW / 2, b.y0 + band, bowlW / 2, b.y1, bowlW / 2),
      // A wall-hung pan on a duct floats; a close-coupled one stands.
      z0: concealed ? Math.max(0, h - 350) : 0, z1: h, material: "sanitary",
    },
  ];
  if (f.rails) {
    const x = w / 2 - w * 0.045;
    for (const sx of [-x, x]) {
      out.push({
        poly: rect(sx - POST_MM / 2, b.y0 + d * 0.08, sx + POST_MM / 2, b.y1 - d * 0.067),
        z0: 700, z1: 700 + POST_MM, material: "sanitary",
      });
    }
  }
  return out;
}

/** Wandurinoir: the bowl hung off the wall, flat at the wall and semicircular
 *  into the room -- urinalMark()'s outline. */
function urinalParts(f: Furnishing): LocalPart[] {
  const w = f.width, d = f.depth;
  const h = furnishingHeight(f);
  const flat = d * 0.265;
  const r = Math.min(w / 2, d - flat);
  const poly: Vec[] = [v(-r, 0), v(r, 0), v(r, flat)];
  const steps = Math.max(4, Math.ceil(Math.PI / ARC_CHORD));
  for (let i = 1; i < steps; i++) {
    const a = (i / steps) * Math.PI;
    poly.push(v(Math.cos(a) * r, flat + Math.sin(a) * r));
  }
  poly.push(v(-r, flat));
  return [{ poly, z0: Math.max(0, h - 500), z1: h, material: "sanitary" }];
}

/** Standurinoir: the trough, hollow inside its rim. */
function troughParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const box = rect(b.x0, b.y0, b.x1, b.y1);
  const inner = shrink(b.x0, b.y0, b.x1, b.y1, 80);
  return [
    { poly: box, ...(inner.length ? { holes: [inner] } : {}), z0: 0, z1: h, material: "sanitary" },
    { poly: inner, z0: 0, z1: Math.max(PLATE_MM, h * 0.4), material: "sanitary" },
  ];
}

/** Bidet: the rounded pedestal bidetMark() draws. */
function bidetParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  return [{
    poly: roundedRect(b.x0, b.y0, b.x1, b.y1, f.width * 0.395),
    z0: 0, z1: furnishingHeight(f), material: "sanitary",
  }];
}

/** Wastafel: the top with its bowls sunk into it, hung off the wall. */
function basinParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const n = furnishingBasins(f);
  const each = f.width / n;
  const inset = Math.min(60, each / 6, f.depth / 6);
  const bowls: Vec[][] = [];
  for (let i = 0; i < n; i++) {
    const x0 = b.x0 + i * each;
    const bowl = shrink(x0, b.y0, x0 + each, b.y1, inset);
    if (bowl.length) bowls.push(bowl);
  }
  return basinDeck(rect(b.x0, b.y0, b.x1, b.y1), bowls, h, BASIN_DEPTH_MM);
}

/** Wastafel, meervoudig: one trough over the length of the run. */
function basinTroughParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const bowl = shrink(b.x0, b.y0, b.x1, b.y1, Math.min(80, f.depth / 6));
  return basinDeck(rect(b.x0, b.y0, b.x1, b.y1), bowl.length ? [bowl] : [], h, BASIN_DEPTH_MM + 60);
}

/** The slab a basin's bowls are sunk through, and the floor of each bowl. */
function basinDeck(top: Vec[], bowls: Vec[][], h: number, depth: number): LocalPart[] {
  const deckBottom = Math.max(0, h - depth - PLATE_MM);
  const out: LocalPart[] = [{
    poly: top, ...(bowls.length ? { holes: bowls } : {}),
    z0: Math.max(0, h - PLATE_MM * 2), z1: h, material: "sanitary",
  }];
  for (const bowl of bowls) {
    out.push({ poly: bowl, z0: deckBottom, z1: deckBottom + PLATE_MM, material: "sanitary" });
  }
  return out;
}

/** Bad: the rim, and the tub sunk inside it -- bathMark()'s own rim and inner
 *  radius, so the body is the mark given depth. */
function bathParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const rim = Math.min(80, f.depth * 0.107);
  const inner = roundedRect(
    b.x0 + rim, b.y0 + rim, b.x1 - rim, b.y1 - rim,
    Math.min(150, (f.depth - 2 * rim) / 2),
  );
  const floor = Math.max(0, h - 400);
  return [
    { poly: rect(b.x0, b.y0, b.x1, b.y1), holes: [inner], z0: 0, z1: h, material: "sanitary" },
    { poly: inner, z0: 0, z1: floor + PLATE_MM, material: "sanitary" },
  ];
}

/** Douche: the wet area, and where there is a tray, its rim around a sunk
 *  floor. Without one the fixture is the bare area it drains. */
function showerParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const box = rect(b.x0, b.y0, b.x1, b.y1);
  if (showerTray(f) === "none") {
    return [{ poly: box, z0: 0, z1: Math.max(PLATE_MM, h), material: "sanitary" }];
  }
  const rim = Math.min(60, f.width * 0.067, f.depth * 0.067);
  const inner = shrink(b.x0, b.y0, b.x1, b.y1, rim);
  return [
    { poly: box, ...(inner.length ? { holes: [inner] } : {}), z0: 0, z1: h, material: "sanitary" },
    { poly: inner, z0: 0, z1: Math.max(PLATE_MM, h * 0.4), material: "sanitary" },
  ];
}

/** Douche: the head on its rail, at the height the fixture states. */
function showerHeadParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const r = Math.min(f.width, f.depth) * 0.225;
  const cy = b.y0 + f.depth / 2;
  return [
    {
      poly: rect(-POST_MM / 2, b.y0, POST_MM / 2, b.y0 + POST_MM),
      z0: Math.max(0, h - 1100), z1: h, material: "sanitary",
    },
    {
      poly: rect(-POST_MM / 3, b.y0, POST_MM / 3, cy),
      z0: Math.max(0, h - 60), z1: Math.max(0, h - 20), material: "sanitary",
    },
    { poly: ellipse(0, cy, r, r), z0: Math.max(0, h - 60), z1: h, material: "sanitary" },
  ];
}

/* ── meubels ──────────────────────────────────────────────────────────────── */

/** Bed: the base, the mattress on it and a pillow per place at the head --
 *  bedMark()'s layout, with the head at -y as the mark draws it. */
function bedParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const w = f.width, d = f.depth;
  const h = furnishingHeight(f);
  const mattress = Math.min(160, h * 0.4);
  const pillowH = Math.min(60, mattress / 2);
  const baseTop = Math.max(0, h - mattress);
  const out: LocalPart[] = [
    { poly: shrink(b.x0, b.y0, b.x1, b.y1, 20), z0: 0, z1: baseTop, material: "casework" },
    { poly: rect(b.x0, b.y0, b.x1, b.y1), z0: baseTop, z1: h - pillowH, material: "soft" },
  ];
  const places = bedPlaces(f);
  const gap = w * (places === 2 ? 0.056 : 0.111);
  const pillowW = (w - gap * (places + 1)) / places;
  const pillowD = d * 0.175;
  for (let i = 0; i < places; i++) {
    const x0 = b.x0 + gap + i * (pillowW + gap);
    out.push({
      poly: rect(x0, b.y0 + d * 0.03, x0 + pillowW, b.y0 + d * 0.03 + pillowD),
      z0: h - pillowH, z1: h, material: "soft",
    });
  }
  return out;
}

/** Zitmeubel: the back along the far side, an arm at each end and the seat
 *  between them -- seatMark()'s divisions, given height. */
function seatParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const w = f.width, d = f.depth;
  const h = furnishingHeight(f);
  const backY = b.y0 + d * 0.222;
  const armX = Math.max(0, w / 2 - Math.min(200, w * 0.1));
  return [
    { poly: rect(b.x0, b.y0, b.x1, backY), z0: 0, z1: h, material: "soft" },
    { poly: rect(b.x0, backY, -armX, b.y1), z0: 0, z1: h * 0.7, material: "soft" },
    { poly: rect(armX, backY, b.x1, b.y1), z0: 0, z1: h * 0.7, material: "soft" },
    { poly: rect(-armX, backY, armX, b.y1), z0: 0, z1: h * 0.55, material: "soft" },
  ];
}

/** Tafel: the top on four legs. */
function tableParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const topBottom = Math.max(0, h - WORKTOP_MM);
  const out: LocalPart[] = [
    { poly: rect(b.x0, b.y0, b.x1, b.y1), z0: topBottom, z1: h, material: "casework" },
  ];
  for (const p of legs(b.x0, b.y0, b.x1, b.y1, POST_MM)) {
    out.push({ poly: p, z0: 0, z1: topBottom, material: "casework" });
  }
  return out;
}

/** Ronde tafel: the top on a central column and its foot. */
function tableRoundParts(f: Furnishing): LocalPart[] {
  const h = furnishingHeight(f);
  const rx = f.width / 2, ry = f.depth / 2;
  const topBottom = Math.max(0, h - WORKTOP_MM);
  const unit = Math.min(rx, ry);
  return [
    { poly: ellipse(0, 0, rx, ry), z0: topBottom, z1: h, material: "casework" },
    { poly: ellipse(0, 0, unit * 0.18, unit * 0.18), z0: 0, z1: topBottom, material: "casework" },
    { poly: ellipse(0, 0, unit * 0.5, unit * 0.5), z0: 0, z1: PLATE_MM, material: "casework" },
  ];
}

/** Bureau: the top, the pedestal under it at the hand the piece is mirrored
 *  to, and a leg at the open end. */
function deskParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const w = f.width, d = f.depth;
  const h = furnishingHeight(f);
  const topBottom = Math.max(0, h - WORKTOP_MM);
  const out: LocalPart[] = [
    { poly: rect(b.x0, b.y0, b.x1, b.y1), z0: topBottom, z1: h, material: "casework" },
    {
      poly: rect(w * 0.036, -d * 0.286, w * 0.393, d * 0.286),
      z0: 0, z1: topBottom, material: "casework",
    },
  ];
  for (const y of [b.y0, b.y1 - POST_MM]) {
    out.push({
      poly: rect(b.x0 + POST_MM, y, b.x0 + 2 * POST_MM, y + POST_MM),
      z0: 0, z1: topBottom, material: "casework",
    });
  }
  return out;
}

/** Stellage: an upright at each bay division, front and back, and a shelf at
 *  each level. rackBays() reads the bay count off the width. */
function rackParts(f: Furnishing): LocalPart[] {
  const b = furnishingBox(f);
  const h = furnishingHeight(f);
  const bays = rackBays(f);
  const out: LocalPart[] = [];
  for (let i = 0; i <= bays; i++) {
    const x = b.x0 + (f.width * i) / bays;
    const x0 = Math.min(Math.max(b.x0, x - POST_MM / 2), b.x1 - POST_MM);
    for (const y of [b.y0, b.y1 - POST_MM]) {
      out.push({ poly: rect(x0, y, x0 + POST_MM, y + POST_MM), z0: 0, z1: h, material: "casework" });
    }
  }
  const levels = Math.max(2, Math.round(h / 400));
  for (let i = 1; i <= levels; i++) {
    const z = (h * i) / levels;
    out.push({
      poly: rect(b.x0, b.y0, b.x1, b.y1),
      z0: Math.max(0, z - PLATE_MM), z1: z, material: "casework",
    });
  }
  return out;
}

/** The four corner legs of a box footprint. */
function legs(x0: number, y0: number, x1: number, y1: number, size: number): Vec[][] {
  const inset = size;
  if (x1 - x0 < 2 * (inset + size) || y1 - y0 < 2 * (inset + size)) {
    return [rect(x0, y0, x1, y1)];
  }
  const out: Vec[][] = [];
  for (const x of [x0 + inset, x1 - inset - size]) {
    for (const y of [y0 + inset, y1 - inset - size]) out.push(rect(x, y, x + size, y + size));
  }
  return out;
}

