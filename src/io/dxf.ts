// DXF export: the plan as CAD geometry rather than a picture.
//
// DXF is Autodesk's plain-text interchange format and the one thing every CAD
// package reads. The file is a flat stream of (group code, value) line pairs —
// no nesting, no escaping — so writing it needs no dependency.
//
// Two conventions that must be got right or the drawing arrives mirrored and
// mis-scaled:
//   * DXF is Y-UP; the document is y-down (canvas orientation). Every
//     coordinate is negated on the way out, and every angle with it.
//   * $INSUNITS = 4 declares millimetres, so a 4000 mm wall imports as 4 m
//     rather than 4000 of whatever the receiving drawing happened to be in.
//
// Walls go out as real closed polylines and door swings as real ARC entities,
// so they stay editable in CAD. Symbols are replayed through a recording
// context (see recordSymbol) because the library draws them with canvas calls;
// their arcs flatten to polylines, which is exact enough at symbol scale and
// avoids guessing how a mirrored, rotated transform maps onto an ARC.
import { PlanDoc, Floor, areaModeOf, dimModeOf, stairsOf, videsOf, furnishingsOf, routesOf, roomNamesOf, wallGlazed } from "../model/doc";
import { Vec } from "../geometry/vec";
import { resolveFloor } from "../core/resolve";
import { detectRooms, roomSize, sizeLabel, looseRoomNames } from "../core/rooms";
import { getSymbol } from "../render/symbols";
import { recordSymbol, Prim } from "./record";
import { openingMarks, mullionMarks } from "./marks";
import { stairPrims } from "./stair";
import { videPrims } from "./vide";
import { furnishingPrims } from "./furnishing";
import { furnishingClass, furnishingOverhead, type FurnishingClass } from "../model/furnishing";
import { resolveStair } from "../core/stair";
import { resolveRoutes } from "../core/route";
import { riserPrims, routePrims } from "./route";
import { riserMarks } from "../core/continuation";
import { routeKind, routeWater, routeVent, type Discipline } from "../model/route";
import { saveViaHost, downloadBlob } from "./save";
import { t } from "../i18n";
import { routeMapLabel, junctionPen } from "../render/draw";

export type DxfResult = "saved" | "empty" | "failed";

/** Layer names are conventional in CAD; keep them stable and self-describing. */
const LAYER = {
  walls: "WALLS",
  /**
   * Glazed wall bodies and their stijlen. Its own layer rather than a pen on
   * WALLS for the reason CABINETS-OVERHEAD is its own layer: DXF colour is
   * per-layer, not per-entity, so a glazen wand can only be told from masonry
   * by the layer it lands on -- which is also where a CAD reader expects to
   * find the distinction, and where they turn the glazing off.
   */
  glazing: "GLAZING",
  openings: "OPENINGS",
  symbols: "SYMBOLS",
  stairs: "STAIRS",
  vides: "VOIDS",
  rooms: "ROOMS",
  // The fit-out splits by trade, because that is how a reader of the drawing
  // uses it: a plumber turns the sanitair layer on, a kitchen fitter the
  // cabinets. Overhead work splits again -- base and tall units are cut or
  // seen, wall units and an afzuigkap are above the section plane. A dash
  // pattern cannot carry that, since the recorder discards dashes, so the layer
  // does, which is where CAD expects to find it anyway.
  cabinets: "CABINETS",
  cabinetsOverhead: "CABINETS-OVERHEAD",
  appliances: "APPLIANCES",
  appliancesOverhead: "APPLIANCES-OVERHEAD",
  sanitary: "SANITARY",
  furniture: "FURNITURE",
} as const;

/** The layer a furnishing lands on: its trade, and whether it is overhead. */
const FURNISHING_LAYER: Record<FurnishingClass, { solid: string; overhead: string }> = {
  cabinetry: { solid: LAYER.cabinets, overhead: LAYER.cabinetsOverhead },
  appliance: { solid: LAYER.appliances, overhead: LAYER.appliancesOverhead },
  sanitary: { solid: LAYER.sanitary, overhead: LAYER.sanitary },
  furniture: { solid: LAYER.furniture, overhead: LAYER.furniture },
};

/** One layer per discipline, registered only when the floor has routes at
 *  all (see toDxf) -- unlike every other layer above, which is always
 *  declared even when its own kind of object is absent from the plan. */
const ROUTE_LAYER: Record<Discipline, string> = {
  electrical: "ROUTES-ELECTRICAL", water: "ROUTES-WATER", vent: "ROUTES-VENT", gas: "ROUTES-GAS",
};

/**
 * An electrical data run (utp/coax) gets its own layer rather than a dash
 * pattern -- the same reasoning as CABINETS-OVERHEAD above: a dash cannot
 * survive the recorder/prims path, so the distinction has to live in the
 * layer instead, which is where CAD expects to find it anyway. Registered
 * only when the floor actually has a data run (see toDxf), unlike
 * ROUTE_LAYER's three names, which are declared together once the floor has
 * any route at all.
 */
const ROUTE_DATA_LAYER = "ROUTES-ELECTRICAL-DATA";

/**
 * An afvoer run gets its own layer for the same reason ROUTE_DATA_LAYER
 * does: the dash and the wider stroke it draws with on canvas and in SVG
 * (see render/route.ts) cannot survive the recorder/prims path this feeds,
 * so the distinction has to live in the layer instead. Registered only when
 * the floor actually has a drain run (see toDxf); koud and warm both stay on
 * ROUTE_LAYER.water -- warm's own tint (COLORS.routeWaterWarm) is a
 * canvas/SVG stroke override with no DXF equivalent, since DXF colour is
 * per-layer, not per-entity.
 */
const ROUTE_AFVOER_LAYER = "ROUTES-WATER-AFVOER";

/**
 * A vent afvoer (extract) run gets its own layer for the same reason
 * ROUTE_AFVOER_LAYER does: its dash (see render/route.ts) cannot survive the
 * recorder/prims path this feeds, so the distinction has to live in the
 * layer instead. Registered only when the floor actually has an extract run
 * (see toDxf); toevoer stays on ROUTE_LAYER.vent. Named distinctly from
 * ROUTE_AFVOER_LAYER above so the two disciplines' drain/extract layers
 * never collide on a CAD package's layer list.
 */
const ROUTE_VENT_AFVOER_LAYER = "ROUTES-VENT-AFVOER";

/** ACI colour indices — 7 is "by background", i.e. black on white paper. */
const LAYER_COLOR: Record<string, number> = {
  WALLS: 7, GLAZING: 4, OPENINGS: 7, SYMBOLS: 4, STAIRS: 3, VOIDS: 5, ROOMS: 8,
  CABINETS: 6, "CABINETS-OVERHEAD": 6,
  "ROUTES-ELECTRICAL": 1, "ROUTES-WATER": 5, "ROUTES-VENT": 2, "ROUTES-GAS": 2,
  "ROUTES-ELECTRICAL-DATA": 1, "ROUTES-WATER-AFVOER": 5, "ROUTES-VENT-AFVOER": 2,
};

class DxfWriter {
  private out: string[] = [];
  private handleSeq = 0x100;

  /** One group code and its value. DXF is nothing but a stream of these. */
  private pair(code: number, value: string | number): void {
    this.out.push(String(code), String(value));
  }

  /**
   * Every R13+ object needs a unique hex handle, and every entity needs the
   * subclass markers naming the classes it inherits. Omitting either produces a
   * file that looks structurally sound and that no CAD package will open —
   * ezdxf rejects it with "missing AcDbPolyline subclass".
   */
  private handle(): string { return (this.handleSeq++).toString(16).toUpperCase(); }

  private begin(type: string, layer: string, ...subclasses: string[]): void {
    this.pair(0, type);
    this.pair(5, this.handle());
    this.pair(100, "AcDbEntity");
    this.pair(8, layer);
    for (const c of subclasses) this.pair(100, c);
  }

  section(name: string, body: () => void): void {
    this.pair(0, "SECTION");
    this.pair(2, name);
    body();
    this.pair(0, "ENDSEC");
  }

  header(): void {
    this.section("HEADER", () => {
      this.pair(9, "$ACADVER");
      this.pair(1, "AC1015");    // R2000: the oldest version with LWPOLYLINE
      this.pair(9, "$INSUNITS");
      this.pair(70, 4);          // millimetres
      this.pair(9, "$MEASUREMENT");
      this.pair(70, 1);          // metric
    });
  }

  tables(layers: string[]): void {
    this.section("TABLES", () => {
      this.pair(0, "TABLE");
      this.pair(2, "LAYER");
      this.pair(5, this.handle());
      this.pair(100, "AcDbSymbolTable");
      this.pair(70, layers.length);
      for (const name of layers) {
        this.pair(0, "LAYER");
        this.pair(5, this.handle());
        this.pair(100, "AcDbSymbolTableRecord");
        this.pair(100, "AcDbLayerTableRecord");
        this.pair(2, name);
        this.pair(70, 0);
        this.pair(62, LAYER_COLOR[name] ?? 7);
        this.pair(6, "CONTINUOUS");
      }
      this.pair(0, "ENDTAB");
    });
  }

  line(layer: string, a: Vec, b: Vec): void {
    this.begin("LINE", layer, "AcDbLine");
    this.pair(10, num(a.x)); this.pair(20, num(-a.y)); this.pair(30, 0);
    this.pair(11, num(b.x)); this.pair(21, num(-b.y)); this.pair(31, 0);
  }

  /**
   * DXF arcs ALWAYS run counter-clockwise from angle 50 to angle 51 — there is
   * no direction flag. Screen space is y-down, so negating y reverses the sense
   * of every sweep, and which of the two angles is "start" depends on which way
   * the sweep originally went. Emitting them in a fixed order draws the
   * complementary arc: a quarter-circle door swing comes out as three quarters.
   *
   * `sweepDeg` is the signed screen-space sweep, normalised to the short way
   * round by the caller, exactly as the renderer does.
   */
  arc(layer: string, c: Vec, r: number, startDeg: number, sweepDeg: number): void {
    if (!(r > 0) || !isFinite(r)) return;
    const dxfStart = -startDeg;
    const dxfEnd = -(startDeg + sweepDeg);
    // A counter-clockwise screen sweep is clockwise in DXF, so the pair swaps.
    const from = sweepDeg >= 0 ? dxfEnd : dxfStart;
    const to = sweepDeg >= 0 ? dxfStart : dxfEnd;
    // An arc inherits AcDbCircle for its centre and radius, then AcDbArc for
    // the two angles.
    this.begin("ARC", layer, "AcDbCircle");
    this.pair(10, num(c.x)); this.pair(20, num(-c.y)); this.pair(30, 0);
    this.pair(40, num(r));
    this.pair(100, "AcDbArc");
    this.pair(50, num(from));
    this.pair(51, num(to));
  }

  polyline(layer: string, pts: Vec[], closed: boolean): void {
    if (pts.length < 2) return;
    this.begin("LWPOLYLINE", layer, "AcDbPolyline");
    this.pair(90, pts.length);
    this.pair(70, closed ? 1 : 0);
    for (const p of pts) {
      this.pair(10, num(p.x));
      this.pair(20, num(-p.y));
    }
  }

  text(layer: string, at: Vec, height: number, s: string): void {
    this.begin("TEXT", layer, "AcDbText");
    this.pair(10, num(at.x)); this.pair(20, num(-at.y)); this.pair(30, 0);
    this.pair(40, num(height));
    this.pair(1, sanitise(s));
    this.pair(72, 1);            // centred horizontally
    this.pair(11, num(at.x)); this.pair(21, num(-at.y)); this.pair(31, 0);
    // TEXT genuinely repeats its subclass marker before the vertical
    // alignment; it is a quirk of the spec, not a copy-paste slip.
    this.pair(100, "AcDbText");
    this.pair(73, 2);            // middle
  }

  finish(): string {
    this.pair(0, "EOF");
    // CRLF: some older CAD readers are unhappy with bare LF.
    return this.out.join("\r\n") + "\r\n";
  }
}

/** Fixed notation: DXF has no room for exponent form like 1e-7. */
function num(n: number): string {
  if (!isFinite(n)) return "0";
  return n.toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * DXF text is one line; a newline would be read as the next group code. The
 * multiplication sign folds to an x for the same reason room areas are written
 * "m2": the file's code page is not something a receiving CAD package agrees on.
 */
function sanitise(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\u00d7/g, "x");
}

function emitPrims(w: DxfWriter, layer: string, prims: Prim[]): void {
  for (const p of prims) {
    if (p.kind === "line") w.line(layer, p.a, p.b);
    else if (p.kind === "poly") w.polyline(layer, p.pts, p.closed);
    else if (p.kind === "arc") w.arc(layer, p.c, p.r, p.start, p.sweep);
    else w.text(layer, p.at, p.size, p.text);
  }
}

/** The plan of one storey as DXF text. */
export function toDxf(doc: PlanDoc, floorIndex = 0): string | null {
  const floor: Floor | undefined = doc.floors[floorIndex] ?? doc.floors[0];
  if (!floor || (floor.walls.length === 0 && floor.symbols.length === 0
      && stairsOf(floor).length === 0 && videsOf(floor).length === 0
      && furnishingsOf(floor).length === 0 && roomNamesOf(floor).length === 0
      && routesOf(floor).length === 0)) return null;

  const hasRoutes = routesOf(floor).length > 0;
  const hasElectricalData = routesOf(floor).some(r => r.discipline === "electrical" && routeKind(r) !== "power");
  const hasAfvoer = routesOf(floor).some(r => r.discipline === "water" && routeWater(r) === "afvoer");
  const hasVentAfvoer = routesOf(floor).some(r => r.discipline === "vent" && routeVent(r) === "afvoer");
  const resolved = resolveFloor(floor);
  const w = new DxfWriter();
  w.header();
  w.tables([
    ...Object.values(LAYER),
    ...(hasRoutes ? Object.values(ROUTE_LAYER) : []),
    ...(hasElectricalData ? [ROUTE_DATA_LAYER] : []),
    ...(hasAfvoer ? [ROUTE_AFVOER_LAYER] : []),
    ...(hasVentAfvoer ? [ROUTE_VENT_AFVOER_LAYER] : []),
  ]);
  w.section("ENTITIES", () => {
    // Walls: each solid piece as a closed outline, so openings are real gaps
    // rather than something drawn over. A glazed wall's body and its stijlen go
    // to GLAZING instead; a wall's own colour has no DXF equivalent at all,
    // since colour here is a property of the layer rather than of the entity.
    for (const rw of resolved.walls.values()) {
      const layer = wallGlazed(rw.wall) ? LAYER.glazing : LAYER.walls;
      for (const piece of rw.pieces) w.polyline(layer, piece.poly, true);
      emitPrims(w, LAYER.glazing, mullionMarks(rw));
    }
    // A wedge belongs to no one wall, so it follows what its neighbours agree
    // on -- the same rule the canvas and the SVG use (junctionPen in draw.ts).
    for (const j of resolved.junctions)
      w.polyline(junctionPen(j, resolved.walls).glazed ? LAYER.glazing : LAYER.walls, j.poly, true);

    for (const rw of resolved.walls.values()) emitPrims(w, LAYER.openings, openingMarks(rw));

    for (const vd of videsOf(floor)) emitPrims(w, LAYER.vides, videPrims(vd, t("vide.label")));

    if (hasRoutes) {
      for (const rr of resolveRoutes(floor)) {
        const layer = rr.route.discipline === "electrical" && routeKind(rr.route) !== "power"
          ? ROUTE_DATA_LAYER
          : rr.route.discipline === "water" && routeWater(rr.route) === "afvoer"
          ? ROUTE_AFVOER_LAYER
          : rr.route.discipline === "vent" && routeVent(rr.route) === "afvoer"
          ? ROUTE_VENT_AFVOER_LAYER
          : ROUTE_LAYER[rr.route.discipline];
        emitPrims(w, layer, routePrims(rr));
        const longest = [...rr.segments].sort((a, b) =>
          Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))[0];
        if (longest) {
          w.text(layer, { x: (longest.a.x + longest.b.x) / 2, y: (longest.a.y + longest.b.y) / 2 },
            120, routeMapLabel(rr.route));
        }
      }
      for (const mark of riserMarks(doc, floorIndex))
        emitPrims(w, ROUTE_LAYER[mark.discipline], riserPrims(mark));
    }

    for (const st of stairsOf(floor))
      emitPrims(w, LAYER.stairs, stairPrims(resolveStair(floor, st)));

    for (const fn of furnishingsOf(floor)) {
      const layer = FURNISHING_LAYER[furnishingClass(fn.form)];
      emitPrims(w, furnishingOverhead(fn) ? layer.overhead : layer.solid, furnishingPrims(fn));
    }

    // Symbols, replayed through the recorder at their placed transform.
    for (const s of floor.symbols) {
      const def = getSymbol(s.type);
      if (!def) continue;
      emitPrims(w, LAYER.symbols,
        recordSymbol(def, s.x, s.y, s.rotation, s.mirrored === true));
    }

    // Room areas, in the convention the document says it is using.
    const net = areaModeOf(doc) === "net";
    const dim = dimModeOf(doc);
    const rooms = detectRooms(floor);
    for (const r of rooms) {
      const mm2 = net ? r.netAreaMm2 : r.areaMm2;
      // Name over area over clear size, as the canvas and the SVG stack them.
      // y is document space here; the writer flips it for CAD.
      const size = roomSize(r, dim);
      const at = (dy: number): Vec => ({ x: r.centroid.x, y: r.centroid.y + dy });
      if (r.name !== undefined) w.text(LAYER.rooms, at(size ? -300 : -150), 220, r.name);
      w.text(LAYER.rooms, at(r.name === undefined ? (size ? -150 : 0) : (size ? 0 : 150)), 200,
        `${(mm2 / 1e6).toFixed(1)} m2`);
      // DXF text is written as plain ASCII, so the clear size takes an x.
      if (size) w.text(LAYER.rooms, at(r.name === undefined ? 150 : 300), 200, sizeLabel(size, "x"));
    }
    for (const rn of looseRoomNames(floor, rooms)) {
      w.text(LAYER.rooms, { x: rn.x, y: rn.y }, 220, rn.name);
    }
  });
  return w.finish();
}

const FILENAME = "floorplan.dxf";

export async function exportDxf(doc: PlanDoc, floorIndex = 0): Promise<DxfResult> {
  const text = toDxf(doc, floorIndex);
  if (!text) return "empty";
  if (await saveViaHost(FILENAME, () => text)) return "saved";
  if (downloadBlob(FILENAME, new Blob([text], { type: "application/dxf" }))) return "saved";
  return "failed";
}
