// IFC export: the plan as an ISO 10303-21 STEP physical file.
//
// BIM 3 built the spatial spine: project → site → building → storeys. BIM 4
// hung building elements off it: one IFCWALL per resolved wall body, one
// IFCOPENINGELEMENT (IFCRELVOIDSELEMENT'd to its wall) per opening, and an
// IFCDOOR/IFCWINDOW (IFCRELFILLSELEMENT'd to its opening) for door and window
// kinds — a passage stays a bare voided hole. This is BIM 5, which adds one
// IFCSPACE per detected room, IFCRELAGGREGATES'd (not contained — a space is
// a spatial element, not a building element) under its storey, each carrying
// a Qto_SpaceBaseQuantities with the document's own area figure. This is
// BIM 6, which adds the floor plate itself: one IFCSLAB per storey whose
// outer boundary closes, IFCRELCONTAINEDINSPATIALSTRUCTURE'd alongside the
// walls, and one IFCOPENINGELEMENT (IFCRELVOIDSELEMENT'd to the slab) per
// vide — its stored placement is resolved by the same `videHole()` helper the
// slab solids use. This is BIM 7, which reaches
// the remaining document objects: one IFCSTAIR (aggregating one
// IFCSTAIRFLIGHT, which carries the run's numbers) per stair, one
// one element per furnishing classed by its trade, and one per symbol, its IFC
// class taken from the symbol registry's category. All three get simple box
// geometry — extruded footprints, not modelled construction — because the
// point of this export is where things are and what they are, not how they
// are built; see the per-kind comments below for exactly what is left out.
// This is BIM 8, which adds a storey's own roof planes (model/roof.ts): one
// IFCROOF aggregating one IFCSLAB (PredefinedType ROOF) per plane, each
// slab a vertical prism over the plane's own outline clipped down to its
// underside and back up from below it by a tilted IfcPolygonalBoundedHalfSpace
// -- see the per-plane comment below for why that construction is used
// instead of a single extrusion in the plane's own tilted placement.
//
// Geometry comes from core/solids.floorSolids() for walls/openings, and from
// core/rooms.detectRooms() directly for spaces — floorSolids() already calls
// detectRooms() internally to build its own SpaceSolid list, but that list
// keeps only poly/z0/z1/name and drops areaMm2/netAreaMm2/centroid, which the
// quantities and the per-room GlobalId key below both need. Re-deriving
// SpaceSolid's few extra fields here from the Room, or reaching into
// floorSolids.ts to widen SpaceSolid, would either duplicate the geometry
// logic or touch a module this export otherwise treats as read-only; calling
// detectRooms() a second time keeps one function as the source of room
// geometry and areas, at the cost of walking the wall graph twice per
// export — cheap next to writing the STEP text itself. Either way this
// module only turns polygons and prisms into IFCEXTRUDEDAREASOLID and does
// not re-derive any of the geometry itself. Every element's ObjectPlacement
// is IDENTITY relative to its storey, because both floorSolids() and
// detectRooms() already return absolute plan coordinates — the profile
// points carry the position directly rather than through a translated
// placement, the same way IFCBUILDING reuses `worldPlacement` as an identity
// offset from the site below.
//
// Two conventions carried over from dxf.ts, for the same reasons:
//   * The document is y-down; IFC (and every viewer) is right-handed Z-up, so
//     every plan-space y is negated on the way into an IFC coordinate —
//     TrueNorth and every profile point alike.
//   * Every stored length is already millimetres, so IFCSIUNIT states MILLI
//     rather than scaling coordinates — a 4000 mm wall must read as 4000, the
//     way it does in DXF's $INSUNITS.
//
// GlobalIds are derived, not random: ifcGuid(doc.guid, id) in model/guid.ts,
// so re-exporting the same document keeps every element's identity and two
// documents' ids cannot collide. A relationship (void, fill, containment)
// gets its own GlobalId derived from the element it hangs off, suffixed so it
// cannot collide with that element's own id.
import {
  PlanDoc, Floor, Wall, projectOf, floorElevation, floorHeight, areaModeOf, dimModeOf, DimMode, Sash, sashSpecsOf,
  openingHeight, videsOf, stairsOf, structureOf, furnishingsOf, routesOf, SymbolInstance, fireLabel, WallMaterial,
  wallPostMm, wallFacadeMm, wallLiningMm, liningSideOf, facadeSideOf, decksOf,
} from "../model/doc";
import { deckSolids } from "../core/deck";
import { structureSolid, spanLength } from "../core/structure";
import {
  Discipline, Route, routeDiameter, routeDuctDiameter, routeHeat, routeHeatDiameter,
  routeInstallation, routeKind, routeVeins, routeVent, routeWater,
} from "../model/route";
import { resolveRoutePoints, routePlaneHeight } from "../core/route";
import { arcFlatten } from "../geometry/arc";
import { ifcGuid } from "../model/guid";
import { wallLength } from "../model/ops";
import { wallTopAt, wallTopRange, wallAreaUnder } from "../model/profile";
import { floorSolids, videHole } from "../core/solids";
import { detectRooms, roomSize, sizeLabel, Room, roomArea } from "../core/rooms";
import { resolveStair, stairBox } from "../core/stair";
import { StairKind, stairParams } from "../model/stair";
import { furnishingHeight, furnishingClass, type FurnishingClass } from "../model/furnishing";
import { furnishingBox } from "../core/furnishing";
import { furnishingZ0 } from "../core/furnishing3d";
import { getSymbol, SymbolDef, SymbolCategory } from "../render/symbols";
import { Placed, LocalBox, worldPoint, symbolFootprintCorners } from "../core/placed";
import { wallRcOf, openingUOf, uFromRc } from "../model/energy";
import { roofPlanesOf, roofThicknessOf } from "../model/roof";
import { eaveLineOf, planeUndersideAt } from "../core/roof";
import { Vec, v, add, sub, scale, norm, perp, len, mid, dot, pointInPolygon } from "../geometry/vec";
import { saveViaHost, downloadBlob } from "./save";

export type IfcResult = "saved" | "failed";

// ── STEP argument model ─────────────────────────────────────────────────────

/**
 * One argument to an entity instance. Covers everything the spine needs:
 * unset ($), derived (*), entity references (#12), the primitive value kinds,
 * enumeration literals (.ELEMENT.) and nested lists — plus a typed wrapper
 * (IFCLABEL('x')) for the rare case a bare value is not enough.
 */
export type IfcArg =
  | { k: "unset" }
  | { k: "derived" }
  | { k: "ref"; id: number }
  | { k: "str"; v: string }
  | { k: "real"; v: number }
  | { k: "int"; v: number }
  | { k: "enum"; v: string }
  | { k: "list"; v: IfcArg[] }
  | { k: "typed"; t: string; v: IfcArg[] };

const UNSET: IfcArg = { k: "unset" };
const DERIVED: IfcArg = { k: "derived" };
const ref = (id: number): IfcArg => ({ k: "ref", id });
const str = (v: string): IfcArg => ({ k: "str", v });
const real = (v: number): IfcArg => ({ k: "real", v });
const int = (v: number): IfcArg => ({ k: "int", v });
const enumv = (v: string): IfcArg => ({ k: "enum", v });
const list = (...v: IfcArg[]): IfcArg => ({ k: "list", v });
const typed = (t: string, ...v: IfcArg[]): IfcArg => ({ k: "typed", t, v });

/**
 * ISO 10303-21 string encoding: `'` doubles, `\` doubles, and any code point
 * above 126 goes out as `\X2\<hex UTF-16 units>\X0\` — one escape block per
 * character, which is simpler than run-merging and equally valid. Dutch
 * project and room names (é, ë, …) have to round-trip through this.
 */
function escapeStepString(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "'") { out += "''"; continue; }
    if (ch === "\\") { out += "\\\\"; continue; }
    if (ch.codePointAt(0)! > 126) {
      let units = "";
      for (let i = 0; i < ch.length; i++) units += ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
      out += `\\X2\\${units}\\X0\\`;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Fixed or exponential notation, always with a decimal point — a bare `2800`
 * is an IFC INTEGER, which is a schema error wherever a REAL is expected.
 */
function formatReal(n: number): string {
  if (!isFinite(n)) return "0.";
  if (n === 0) return "0.";
  const s = n.toString();
  const eIdx = s.search(/e/i);
  if (eIdx === -1) return s.includes(".") ? s : `${s}.`;
  let mantissa = s.slice(0, eIdx);
  const exp = s.slice(eIdx + 1).replace("+", "");
  if (!mantissa.includes(".")) mantissa += ".";
  return `${mantissa}E${exp}`;
}

function serialize(a: IfcArg): string {
  switch (a.k) {
    case "unset": return "$";
    case "derived": return "*";
    case "ref": return `#${a.id}`;
    case "str": return `'${escapeStepString(a.v)}'`;
    case "real": return formatReal(a.v);
    case "int": return String(Math.trunc(a.v));
    case "enum": return `.${a.v}.`;
    case "list": return `(${a.v.map(serialize).join(",")})`;
    case "typed": return `${a.t}(${a.v.map(serialize).join(",")})`;
  }
}

/** Appends `#id=TYPE(args);` lines to the DATA section. */
class IfcWriter {
  private lines: string[] = [];
  private nextId = 1;

  entity(type: string, args: IfcArg[]): number {
    const id = this.nextId++;
    this.lines.push(`#${id}=${type}(${args.map(serialize).join(",")});`);
    return id;
  }

  get data(): readonly string[] { return this.lines; }
}

/** Wraps the DATA lines in the header/footer boilerplate every reader expects. */
function renderStepFile(data: readonly string[], author: string, nowMs: number): string {
  const iso = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "");
  const lines = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME('floorplan.ifc','${iso}',('${escapeStepString(author)}'),(''),'Wallgraph','Wallgraph','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    ...data,
    "ENDSEC;",
    "END-ISO-10303-21;",
  ];
  return lines.join("\n") + "\n";
}

// ── door / window operation classification ──────────────────────────────────
//
// IFC4's IfcDoorTypeOperationEnum and IfcWindowTypePartitioningEnum name
// specific leaf arrangements. The document's sash list is finer-grained (see
// SashAction in model/doc.ts), so several sash combinations have no matching
// IFC name; NOTDEFINED is correct for those, not the nearest-looking literal.

/**
 * A door's IfcDoorTypeOperationEnum literal (without the surrounding dots)
 * from its sash list. Mirrors DOOR_KINDS in model/doc.ts: one turn sash is a
 * single swing, two a double door, and so on for slide/fold/revolve/
 * double-acting — but read off the actual sashes rather than matched against
 * the named presets, so a hand-tuned combination still classifies correctly.
 */
function doorOperationType(sashes: Sash[]): string {
  if (sashes.length === 1) {
    const s = sashes[0]!;
    switch (s.action) {
      case "turn":
        return s.hinge === "a" ? "SINGLE_SWING_LEFT" : s.hinge === "b" ? "SINGLE_SWING_RIGHT" : "NOTDEFINED";
      case "slide":
        return s.slideTo === "a" ? "SLIDING_TO_LEFT" : "SLIDING_TO_RIGHT";
      case "fold":
        return "FOLDING_TO_LEFT";
      case "revolve":
        return "REVOLVING";
      case "double-acting":
        return s.hinge === "a" ? "DOUBLE_SWING_LEFT" : s.hinge === "b" ? "DOUBLE_SWING_RIGHT" : "NOTDEFINED";
      default:
        return "NOTDEFINED"; // pivot, tilt, overhead, fixed alone, …
    }
  }
  if (sashes.length === 2) {
    const [s0, s1] = sashes as [Sash, Sash];
    if (s0.action === "turn" && s1.action === "turn") return "DOUBLE_DOOR_SINGLE_SWING";
    if (s0.action === "slide" && s1.action === "slide") return "DOUBLE_DOOR_SLIDING";
    if (s0.action === "double-acting" && s1.action === "double-acting") return "DOUBLE_DOOR_DOUBLE_SWING";
    return "NOTDEFINED"; // e.g. a pui: one fixed light beside one operable sash
  }
  return "NOTDEFINED"; // three+ sashes, or none (an empty passage never reaches here)
}

/** A window's IfcWindowTypePartitioningEnum literal from its pane count alone
 *  — the enum names panel counts, not what each pane does. */
function windowPartitioningType(sashCount: number): string {
  switch (sashCount) {
    case 1: return "SINGLE_PANEL";
    case 2: return "DOUBLE_PANEL_VERTICAL";
    case 3: return "TRIPLE_PANEL_VERTICAL";
    default: return "NOTDEFINED";
  }
}

// ── stair predefined type ───────────────────────────────────────────────────

/**
 * IfcStairTypeEnum literal for a document StairKind, only where IFC4 names
 * the shape exactly. STRAIGHT_RUN_STAIR covers a plain flight and its
 * variations that read the same in plan (stacked over each other, raking
 * treads, wheeling gutters down the sides) — none of those turn. QUARTER_ and
 * HALF_TURN_STAIR match a single quarter of winders and a landing between two
 * flights respectively. SPIRAL_STAIR is IFC's own definition of a stair
 * wound around a newel, which is exactly spiltrap-recht/-rond; wenteltrap
 * winds with no newel to speak of (see model/stair.ts), so it reads as
 * CURVED_RUN_STAIR instead. Every other kind — a quarter at each end (whose
 * two turns can even oppose each other), an escalator, a loft ladder,
 * climbing irons, a ramp — has no honest single-word match among these five,
 * so it states .NOTDEFINED. rather than borrowing a name that overstates
 * what the plan shows.
 */
function stairPredefinedType(kind: StairKind): string {
  switch (kind) {
    case "steektrap":
    case "steektrap-boven-elkaar":
    case "steektrap-scheluw":
    case "rijstroken":
      return "STRAIGHT_RUN_STAIR";
    case "bovenkwart":
    case "onderkwart":
      return "QUARTER_TURN_STAIR";
    case "bordestrap":
      return "HALF_TURN_STAIR";
    case "spiltrap-recht":
    case "spiltrap-rond":
      return "SPIRAL_STAIR";
    case "wenteltrap":
      return "CURVED_RUN_STAIR";
    default:
      return "NOTDEFINED"; // onder-bovenkwart, roltrap, vlizotrap, klimijzers, hellingbaan
  }
}

// ── symbol IFC class ─────────────────────────────────────────────────────────
//
// A symbol's IFC class follows its registry category, with per-type
// overrides where the category default is visibly wrong for one symbol — a
// wall light is not an electrical outlet, a switch is not an alarm.

/** Whether the mapped class carries PredefinedType as its ninth (and last)
 *  constructor argument. Every class below does except IFCFLOWTERMINAL,
 *  which IFC4 declares with no PredefinedType attribute at all — not even one
 *  a caller could leave unset. */
interface SymbolIfcClass { entity: string; hasPredefinedType: boolean }

const cls = (entity: string, hasPredefinedType = true): SymbolIfcClass => ({ entity, hasPredefinedType });

/**
 * One class per registry category — the fallback when no type-id override
 * below applies. Every SymbolCategory (see render/symbols/defs.ts) must have
 * an entry; ifc.test.ts checks that directly against SYMBOLS so a new
 * category cannot silently export as IFCBUILDINGELEMENTPROXY.
 *
 * `ventilation` is the one category the brief for this export left
 * unstated: its own items — exhaust/supply points, the MV unit, the WTW
 * recovery unit — are air terminals in IFC4's HVAC vocabulary, so
 * IFCAIRTERMINAL is the default for the same reason IFCSPACEHEATER is
 * heating's.
 */
const CATEGORY_DEFAULTS: Record<SymbolCategory, SymbolIfcClass> = {
  electrical: cls("IFCOUTLET"),
  water: cls("IFCFLOWTERMINAL", false),
  heating: cls("IFCSPACEHEATER"),
  ventilation: cls("IFCAIRTERMINAL"),
  safety: cls("IFCALARM"),
};

/**
 * One IFC class per furnishing trade. Cabinetry and loose furniture are
 * IFCFURNITURE; a fixture is the sanitary terminal IFC already has a name for;
 * a fornuis or a koelkast is an appliance. See furnishingClass().
 */
const FURNISHING_CLASSES: Record<FurnishingClass, SymbolIfcClass> = {
  cabinetry: cls("IFCFURNITURE"),
  furniture: cls("IFCFURNITURE"),
  sanitary: cls("IFCSANITARYTERMINAL"),
  appliance: cls("IFCELECTRICAPPLIANCE"),
};

/**
 * Overrides keyed by the exact type id, so a future symbol with a similar
 * name never picks one up by accident. Lights and switches read wrong as
 * electrical's IFCOUTLET default; smoke and CO detectors read wrong as
 * safety's IFCALARM default — an alarm sounds, a sensor detects.
 */
const TYPE_OVERRIDES: Record<string, SymbolIfcClass> = {
  "light-point": cls("IFCLIGHTFIXTURE"),
  "light-wall": cls("IFCLIGHTFIXTURE"),
  "light-fluor": cls("IFCLIGHTFIXTURE"),
  "light-spot": cls("IFCLIGHTFIXTURE"),
  "light-emergency": cls("IFCLIGHTFIXTURE"),
  "switch-single": cls("IFCSWITCHINGDEVICE"),
  "switch-double": cls("IFCSWITCHINGDEVICE"),
  "switch-series": cls("IFCSWITCHINGDEVICE"),
  "switch-two-way": cls("IFCSWITCHINGDEVICE"),
  "switch-cross": cls("IFCSWITCHINGDEVICE"),
  "switch-pull": cls("IFCSWITCHINGDEVICE"),
  "smoke-detector": cls("IFCSENSOR"),
  "co-detector": cls("IFCSENSOR"),
};

/** Unreachable while CATEGORY_DEFAULTS covers every SymbolCategory — kept as
 *  the honest fallback for a category the registry adds later without this
 *  file being updated in step. */
const PROXY_CLASS = cls("IFCBUILDINGELEMENTPROXY");

function symbolIfcClass(def: SymbolDef): SymbolIfcClass {
  return TYPE_OVERRIDES[def.type] ?? CATEGORY_DEFAULTS[def.category] ?? PROXY_CLASS;
}

// ── box-shaped footprints ───────────────────────────────────────────────────

/**
 * A LocalBox's four corners walked as a simple rectangle (x0,y0 -> x1,y0 ->
 * x1,y1 -> x0,y1), mapped into world mm through worldPoint(). NOT
 * boxCorners() from core/placed.ts: that function pairs corners for a
 * bounding-box scan ((x0,y0),(x0,y1),(x1,y0),(x1,y1)), which self-intersects
 * if walked as a polygon boundary. Shared by every box-shaped document
 * object this export gives simple geometry to — a stair, a furnishing, a
 * symbol's footprint.
 */
function boxQuad(p: Placed, b: LocalBox): Vec[] {
  return [
    worldPoint(p, v(b.x0, b.y0)),
    worldPoint(p, v(b.x1, b.y0)),
    worldPoint(p, v(b.x1, b.y1)),
    worldPoint(p, v(b.x0, b.y1)),
  ];
}

/**
 * A symbol instance's footprint quad, per the draw(ctx) contract in
 * render/symbols/defs.ts. Mirroring a symbol reflects that box about its own
 * axis, so the corner set is unchanged; symbolFootprintCorners() still takes
 * `mirrored` (via worldPoint) so a rotated *and* mirrored instance keeps a
 * well-formed rectangle either way. Shared with core/bounds.ts and
 * input/marquee.ts via core/placed.ts.
 */
function symbolFootprint(def: SymbolDef, s: SymbolInstance): Vec[] {
  return symbolFootprintCorners(def, s);
}

// ── wall side classification ────────────────────────────────────────────────

/** How far past a wall's own half-thickness a side probe reaches, mm — enough
 *  to clear the centerline itself and land unambiguously on one side. */
const EXTERNAL_PROBE_EPS_MM = 5;

/**
 * Whether a wall borders the outside of the building: true unless BOTH of its
 * sides fall inside a detected room. Probes a point half-thickness plus a
 * small epsilon off the wall's own centerline midpoint, on each side, against
 * the rooms' CENTERLINE polygons (`Room.poly`, not `netPoly` — a room's poly
 * shares its boundary edges with the wall centerlines that bound it). This is
 * the same test core/dimensions.ts's `insideAnyRoom` runs to tell a facade
 * from an interior wall for a dimension chain, mirrored here per wall rather
 * than per chain, using the chord (not the arc tangent) at the midpoint —
 * the same tangent-line approximation resolve.ts already accepts at a miter.
 *
 * Undefined when the floor has no detected rooms at all: nothing here is a
 * fact yet, so IsExternal is omitted rather than guessed at.
 */
function wallIsExternal(floor: Floor, wall: Wall, roomPolys: readonly Vec[][]): boolean | undefined {
  if (roomPolys.length === 0) return undefined;
  const na = floor.nodes.find(n => n.id === wall.a), nb = floor.nodes.find(n => n.id === wall.b);
  if (!na || !nb) return undefined;
  const A = v(na.x, na.y), B = v(nb.x, nb.y);
  if (len(sub(B, A)) < 1e-6) return undefined;
  const dir = norm(sub(B, A));
  const n = perp(dir);
  const midPt = mid(A, B);
  const probe = wall.thickness / 2 + EXTERNAL_PROBE_EPS_MM;
  const inside = (p: Vec): boolean => roomPolys.some(poly => pointInPolygon(p, poly));
  const sideA = inside(add(midPt, scale(n, probe)));
  const sideB = inside(add(midPt, scale(n, -probe)));
  return !(sideA && sideB);
}

// ── the spine ────────────────────────────────────────────────────────────────

/**
 * A wall material under the name IFC uses for it. "Wood" rather than "timber"
 * because that is the word in IFC's own material vocabulary, and a reader
 * matching on the name has to find what it expects.
 *
 * A glazed wall stays an IFCWALL rather than becoming an IFCCURTAINWALL. A
 * curtain wall in IFC is an assembly of mullions and panels, which the document
 * does not model -- it stores one plane with a spacing (see Wall.mullionMm), and
 * exporting that as an assembly would state a build-up nobody drew. The material
 * is the honest statement, and it keeps voids, fillers and containment uniform
 * across every wall.
 */
const IFC_MATERIAL_NAME: Record<WallMaterial, string> = {
  masonry: "Masonry", concrete: "Concrete", timber: "Wood", steel: "Steel", glass: "Glass",
  sandwich: "SandwichPanel", aerated: "AeratedConcrete", calciumsilicate: "CalciumSilicate",
};

/** Board lining material name. The document does not distinguish board products
 *  (gypsum, cement board, ...), so every lining layer is named this one thing. */
const LINING_MATERIAL_NAME = "Gypsum board";

/* ── services ───────────────────────────────────────────────────────────────
 * A route's IFC4 occurrence class, nominal cross-section and system identity.
 * All three are decisions about how a 2D run is stated in a model that expects
 * 3D products, and they are kept together so the reasoning reads as one.
 */

/** IFC4 occurrence class per discipline. Gas runs in pipe, like water. */
const ROUTE_IFC_ENTITY: Record<Discipline, string> = {
  electrical: "IFCCABLECARRIERSEGMENT",
  water: "IFCPIPESEGMENT",
  heating: "IFCPIPESEGMENT",
  gas: "IFCPIPESEGMENT",
  vent: "IFCDUCTSEGMENT",
};

/**
 * Nominal cross-section of a run, mm -- the side of the square box its legs
 * are extruded as.
 *
 * A pipe and a duct state their own diameter, so that is what is used. A cable
 * run states none: the document knows a conductor count and a cable spec, not
 * an outside dimension, and CABLE_CARRIER_MM is a placeholder for a
 * cable-carrier's size rather than a measurement. It exists so the segment has
 * a body at all; nothing should read a load or a fill ratio off it.
 */
const CABLE_CARRIER_MM = 50;

function routeIfcSize(route: Route): number {
  switch (route.discipline) {
    case "vent": return routeDuctDiameter(route);
    case "water": return routeDiameter(route);
    case "heating": return routeHeatDiameter(route);
    case "gas": return route.diameter ?? 15;
    case "electrical": return CABLE_CARRIER_MM;
  }
}

/** Chord tolerance a bowed route leg is flattened at, mm. */
const ROUTE_FLATTEN_MM = 5;

/** The rectangle one straight leg extrudes from, or null for a zero-length leg. */
function legQuad(a: Vec, b: Vec, size: number): Vec[] | null {
  const along = sub(b, a);
  const length = Math.hypot(along.x, along.y);
  if (length < 1) return null;
  const half = scale(perp(scale(along, 1 / length)), size / 2);
  return [add(a, half), add(b, half), sub(b, half), sub(a, half)];
}

/**
 * Which distribution system a run belongs to. A groep is what an electrician
 * selects by, so an electrical run with one is grouped by it; everything else
 * groups by the service it carries, which is the finest distinction the
 * document actually makes.
 */
function routeSystemKey(route: Route): { id: string; name: string; predefined: string } {
  switch (route.discipline) {
    case "electrical": {
      const group = route.group?.trim();
      return group
        ? { id: `electrical:${group}`, name: `Groep ${group}`, predefined: "ELECTRICAL" }
        : { id: "electrical", name: "Elektra", predefined: "ELECTRICAL" };
    }
    case "water": {
      const kind = routeWater(route);
      const predefined = kind === "afvoer" ? "DRAINAGE"
        : kind === "warm" ? "DOMESTICHOTWATER" : "DOMESTICCOLDWATER";
      return { id: `water:${kind}`, name: `Water ${kind}`, predefined };
    }
    case "heating": {
      const kind = routeHeat(route);
      return { id: `heating:${kind}`, name: `CV ${kind}`, predefined: "HEATING" };
    }
    case "vent": {
      const kind = routeVent(route);
      return { id: `vent:${kind}`, name: `Ventilatie ${kind}`, predefined: "VENTILATION" };
    }
    case "gas":
      return { id: "gas", name: "Gas", predefined: "GAS" };
  }
}

/** The service metadata a run states, as IFC properties. Absent stays absent:
 *  a run that named no groep says nothing about one. */
function routeProps(route: Route): Array<{ name: string; value: string | number; kind: "label" | "count" | "length" | "real" }> {
  const out: Array<{ name: string; value: string | number; kind: "label" | "count" | "length" | "real" }> = [];
  const label = (name: string, value: string | undefined): void => {
    if (value && value.trim()) out.push({ name, value: value.trim(), kind: "label" });
  };
  label("Tag", route.tag);
  label("Name", route.name);
  label("Installation", routeInstallation(route));
  if (route.discipline === "electrical") {
    label("Board", route.board);
    label("Group", route.group);
    out.push({ name: "Kind", value: routeKind(route), kind: "label" });
    if (routeKind(route) === "power") out.push({ name: "Conductors", value: routeVeins(route), kind: "count" });
    else label("CableSpec", route.spec);
  } else if (route.discipline === "water") {
    out.push({ name: "Kind", value: routeWater(route), kind: "label" });
    out.push({ name: "NominalDiameter", value: routeDiameter(route), kind: "length" });
  } else if (route.discipline === "heating") {
    out.push({ name: "Kind", value: routeHeat(route), kind: "label" });
    out.push({ name: "NominalDiameter", value: routeHeatDiameter(route), kind: "length" });
  } else if (route.discipline === "vent") {
    out.push({ name: "Kind", value: routeVent(route), kind: "label" });
    out.push({ name: "NominalDiameter", value: routeDuctDiameter(route), kind: "length" });
    // Only when someone stated one -- see routeFlow() in model/route.ts.
    if (route.flow !== undefined) out.push({ name: "DesignFlowRate", value: route.flow, kind: "real" });
  } else {
    out.push({ name: "NominalDiameter", value: route.diameter ?? 15, kind: "length" });
  }
  return out;
}

/**
 * The plan as an IFC4 spatial spine: project, site, building, one storey per
 * floor (bottom-up, matching floors[0] = ground), aggregated together.
 *
 * Always succeeds — every document has at least one floor (see emptyDoc()),
 * so there is no "empty" export result the way DXF has for a floor with no
 * geometry.
 *
 * `nowMs` is the file's creation time, reaching both the FILE_NAME header and
 * IFCOWNERHISTORY. A parameter rather than an internal Date.now() so a caller
 * comparing two exports can hold the clock still — everything else about the
 * output is deterministic per document.
 */
export function toIfc(doc: PlanDoc, nowMs = Date.now()): string {
  const seed = doc.guid ?? "";
  const meta = projectOf(doc);
  const w = new IfcWriter();

  // World origin, shared by every placement below until an element states
  // its own offset from it.
  const originPt = w.entity("IFCCARTESIANPOINT", [list(real(0), real(0), real(0))]);
  const zAxis = w.entity("IFCDIRECTION", [list(real(0), real(0), real(1))]);
  const xAxis = w.entity("IFCDIRECTION", [list(real(1), real(0), real(0))]);
  const worldPlacement = w.entity("IFCAXIS2PLACEMENT3D", [ref(originPt), ref(zAxis), ref(xAxis)]);

  // TrueNorth only when the plan states one: an unstated orientation gets no
  // guessed arrow on the sheet (see PlanDoc.northDeg), and none here either.
  // The document measures clockwise from screen-up in a y-down space; IFC is
  // y-up, so the direction is built directly in IFC's axes rather than by
  // flipping a screen-space vector.
  let trueNorth: IfcArg = UNSET;
  if (doc.northDeg !== undefined) {
    const rad = (doc.northDeg * Math.PI) / 180;
    const northDir = w.entity("IFCDIRECTION", [list(real(Math.sin(rad)), real(Math.cos(rad)))]);
    trueNorth = ref(northDir);
  }

  const context = w.entity("IFCGEOMETRICREPRESENTATIONCONTEXT",
    [UNSET, str("Model"), int(3), real(1e-5), ref(worldPlacement), trueNorth]);

  const lengthUnit = w.entity("IFCSIUNIT", [DERIVED, enumv("LENGTHUNIT"), enumv("MILLI"), enumv("METRE")]);
  const areaUnit = w.entity("IFCSIUNIT", [DERIVED, enumv("AREAUNIT"), UNSET, enumv("SQUARE_METRE")]);
  const volumeUnit = w.entity("IFCSIUNIT", [DERIVED, enumv("VOLUMEUNIT"), UNSET, enumv("CUBIC_METRE")]);
  const angleUnit = w.entity("IFCSIUNIT", [DERIVED, enumv("PLANEANGLEUNIT"), UNSET, enumv("RADIAN")]);
  const units = w.entity("IFCUNITASSIGNMENT",
    [list(ref(lengthUnit), ref(areaUnit), ref(volumeUnit), ref(angleUnit))]);

  const person = w.entity("IFCPERSON",
    [UNSET, meta.author ? str(meta.author) : UNSET, UNSET, UNSET, UNSET, UNSET, UNSET, UNSET]);
  const organization = w.entity("IFCORGANIZATION", [UNSET, str("Wallgraph"), UNSET, UNSET, UNSET]);
  const personAndOrg = w.entity("IFCPERSONANDORGANIZATION", [ref(person), ref(organization), UNSET]);
  const application = w.entity("IFCAPPLICATION",
    [ref(organization), str("1"), str("Wallgraph"), str("wallgraph")]);
  // State (IfcStateEnum) is left unset; ChangeAction (IfcChangeActionEnum)
  // is where .ADDED. belongs — the only enumeration of the two that has it.
  const ownerHistory = w.entity("IFCOWNERHISTORY",
    [ref(personAndOrg), ref(application), UNSET, enumv("ADDED"), UNSET, UNSET, UNSET,
      int(Math.floor(nowMs / 1000))]);

  const project = w.entity("IFCPROJECT",
    [str(ifcGuid(seed, "project")), ref(ownerHistory), str(meta.name ?? "Wallgraph plan"),
      UNSET, UNSET, UNSET, UNSET, list(ref(context)), ref(units)]);

  const sitePlacement = w.entity("IFCLOCALPLACEMENT", [UNSET, ref(worldPlacement)]);
  const site = w.entity("IFCSITE",
    [str(ifcGuid(seed, "site")), ref(ownerHistory), UNSET, UNSET, UNSET, ref(sitePlacement), UNSET, UNSET,
      enumv("ELEMENT"), UNSET, UNSET, UNSET, UNSET, UNSET]);

  const buildingPlacement = w.entity("IFCLOCALPLACEMENT", [ref(sitePlacement), ref(worldPlacement)]);
  let buildingAddress: IfcArg = UNSET;
  if (meta.address) {
    const addr = w.entity("IFCPOSTALADDRESS",
      [UNSET, UNSET, UNSET, UNSET, list(str(meta.address)), UNSET, UNSET, UNSET, UNSET, UNSET]);
    buildingAddress = ref(addr);
  }
  const building = w.entity("IFCBUILDING",
    [str(ifcGuid(seed, "building")), ref(ownerHistory), meta.name ? str(meta.name) : UNSET, UNSET, UNSET,
      ref(buildingPlacement), UNSET, UNSET, enumv("ELEMENT"), UNSET, UNSET, buildingAddress]);

  const storeyPlacements: number[] = [];
  const storeys = doc.floors.map((floor, i) => {
    const elevation = floorElevation(doc, i);
    const pt = w.entity("IFCCARTESIANPOINT", [list(real(0), real(0), real(elevation))]);
    const placement3d = w.entity("IFCAXIS2PLACEMENT3D", [ref(pt), UNSET, UNSET]);
    const storeyPlacement = w.entity("IFCLOCALPLACEMENT", [ref(buildingPlacement), ref(placement3d)]);
    storeyPlacements.push(storeyPlacement);
    return w.entity("IFCBUILDINGSTOREY",
      [str(ifcGuid(seed, floor.id)), ref(ownerHistory), str(floor.name), UNSET, UNSET, ref(storeyPlacement),
        UNSET, UNSET, enumv("ELEMENT"), real(elevation)]);
  });

  w.entity("IFCRELAGGREGATES",
    [str(ifcGuid(seed, "rel-project-site")), ref(ownerHistory), UNSET, UNSET, ref(project), list(ref(site))]);
  w.entity("IFCRELAGGREGATES",
    [str(ifcGuid(seed, "rel-site-building")), ref(ownerHistory), UNSET, UNSET, ref(site), list(ref(building))]);
  w.entity("IFCRELAGGREGATES",
    [str(ifcGuid(seed, "rel-building-storeys")), ref(ownerHistory), UNSET, UNSET, ref(building),
      list(...storeys.map(ref))]);

  // ── building elements: walls, openings, doors and windows ────────────────

  /** 50 mm — deep enough to read as a leaf in a viewer, not a claim about a
   *  real door or window's actual thickness (out of scope for this export). */
  const FILLER_DEPTH_MM = 50;

  /** Nominal box height for a symbol's placeholder extrusion, mm. States
   *  where a symbol sits, not a manufacturer's actual product height. */
  const SYMBOL_NOMINAL_HEIGHT_MM = 500;

  /**
   * One IFCEXTRUDEDAREASOLID from a plan-space polygon (mm, y-down, as
   * floorSolids() returns it) extruded from z0 to z1: an
   * IfcArbitraryClosedProfileDef of the polygon — y negated for IFC's y-up
   * axes, closed by repeating the first point — swept along +Z. Null for a
   * degenerate polygon or a non-positive depth (a collapsed footprint, or a
   * void clamped to zero height), so the caller can fall back to no
   * representation rather than emit a broken profile.
   */
  function extrudedSolid(poly: Vec[], z0: number, z1: number): number | null {
    if (poly.length < 3) return null;
    const depth = z1 - z0;
    if (!(depth > 0)) return null;
    const pointIds = poly.map(p => w.entity("IFCCARTESIANPOINT", [list(real(p.x), real(-p.y))]));
    pointIds.push(pointIds[0]!); // closed
    const polyline = w.entity("IFCPOLYLINE", [list(...pointIds.map(ref))]);
    const profile = w.entity("IFCARBITRARYCLOSEDPROFILEDEF", [enumv("AREA"), UNSET, ref(polyline)]);
    const posPt = w.entity("IFCCARTESIANPOINT", [list(real(0), real(0), real(z0))]);
    const position = w.entity("IFCAXIS2PLACEMENT3D", [ref(posPt), UNSET, UNSET]);
    return w.entity("IFCEXTRUDEDAREASOLID", [ref(profile), ref(position), ref(zAxis), real(depth)]);
  }

  /** IFCPRODUCTDEFINITIONSHAPE wrapping a 'Body'/`repType` representation of
   *  the given solids, or $ when there is nothing to show. `repType` is
   *  'SweptSolid' unless the caller passes 'Clipping' for a wall whose body
   *  includes an IfcBooleanClippingResult (slopedPieceSolid() below). */
  function bodyShape(solidIds: readonly (number | null)[], repType: "SweptSolid" | "Clipping" = "SweptSolid"): IfcArg {
    const ids = solidIds.filter((id): id is number => id !== null);
    if (ids.length === 0) return UNSET;
    const rep = w.entity("IFCSHAPEREPRESENTATION",
      [ref(context), str("Body"), str(repType), list(...ids.map(ref))]);
    const pds = w.entity("IFCPRODUCTDEFINITIONSHAPE", [UNSET, UNSET, list(ref(rep))]);
    return ref(pds);
  }

  /**
   * One profiled wall piece's body: the flat extrusion to its own segment's
   * high end, cut down to this piece's own
   * segment of the profile by one IFCPOLYGONALBOUNDEDHALFSPACE inside an
   * IFCBOOLEANCLIPPINGRESULT. Never an unbounded IFCHALFSPACESOLID: an
   * unbounded plane cuts the WHOLE wall, which only reads right for a peaked,
   * convex profile -- a valley would lose material outside the segment it
   * belongs to. `poly` is already one piece of floorSolids()'s per-breakpoint
   * split (core/solids.ts's wallBodyPrisms()), so it spans exactly one
   * profile segment and needs at most one clip.
   *
   * The wall's local direction is taken as its chord (A to B), the same
   * tangent-line approximation resolve.ts already accepts at an arc's own
   * ends, since a half-space plane cannot itself follow a curve. Returns the
   * flat extrusion unclipped when this segment is already flat at `maxH`.
   *
   * `zBase` is the extrusion's own floor, 0 for the wall's body pieces. An
   * opening's band above its head (`OpeningVoid.above`, core/solids.ts) reuses
   * this same clip against the wall's own top line, starting from the head
   * height instead of the slab -- the tilted plane depends only on the wall's
   * profile, never on where the extrusion begins.
   */
  function slopedPieceSolid(
    floor: Floor, wall: Wall, poly: Vec[], maxH: number, A: Vec, B: Vec, L: number, zBase = 0,
  ): number | null {
    if (L <= 0) return extrudedSolid(poly, zBase, maxH);

    // The segment's span along the wall: project every vertex onto the chord.
    const dir = norm(sub(B, A));
    let s0 = Infinity, s1 = -Infinity;
    for (const p of poly) {
      const t = dot(sub(p, A), dir);
      if (t < s0) s0 = t;
      if (t > s1) s1 = t;
    }
    // A mitered end reaches past [0, L]; the heights are read at the clamped
    // span and the boundary below covers the whole footprint.
    const r0 = s0, r1 = s1;
    s0 = Math.max(0, Math.min(L, s0));
    s1 = Math.max(0, Math.min(L, s1));
    const h0 = wallTopAt(floor, wall, s0), h1 = wallTopAt(floor, wall, s1);
    // Extruded to this segment's own high end, not the wall's maximum. The
    // bounded half-space's boundary is swept along the tilted plane normal, so
    // material standing above the high end of the segment would project past
    // the boundary and survive the clip.
    const top = Math.max(h0, h1);
    const base = extrudedSolid(poly, zBase, top);
    if (base === null || s1 - s0 <= 0.5) return base;
    if (Math.abs(h1 - h0) <= 0.5) return base; // a flat segment needs no clip

    // Two 3D points on the segment's own top line, in IFC's y-up axes.
    const p0w = add(A, scale(dir, s0)), p1w = add(A, scale(dir, s1));
    const P0: [number, number, number] = [p0w.x, -p0w.y, h0];
    const P1: [number, number, number] = [p1w.x, -p1w.y, h1];
    const D: [number, number, number] = [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]];
    // A horizontal unit vector across the wall's thickness, IFC axes.
    const ww = perp(v(dir.x, -dir.y));
    const W: [number, number, number] = [ww.x, ww.y, 0];
    const cross3 = (a: readonly [number, number, number], b: readonly [number, number, number]):
      [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const normal = cross3(D, W);
    const nLen = Math.hypot(...normal) || 1;
    const dLen = Math.hypot(...D) || 1;
    const axis3 = normal.map(x => x / nLen) as [number, number, number];
    const ref3 = D.map(x => x / dLen) as [number, number, number];

    const locPt = w.entity("IFCCARTESIANPOINT", [list(real(P0[0]), real(P0[1]), real(P0[2]))]);
    const axisDir = w.entity("IFCDIRECTION", [list(real(axis3[0]), real(axis3[1]), real(axis3[2]))]);
    const refDir = w.entity("IFCDIRECTION", [list(real(ref3[0]), real(ref3[1]), real(ref3[2]))]);
    const placement = w.entity("IFCAXIS2PLACEMENT3D", [ref(locPt), ref(axisDir), ref(refDir)]);
    const plane = w.entity("IFCPLANE", [ref(placement)]);

    // The boundary, in the plane's own local XY: exactly the segment's span
    // along local X (0 to |D|), generously wide across local Y (thickness).
    const wpad = Math.max(1000, wall.thickness * 4);
    // Local X runs along the sloped top line, so a horizontal overshoot scales by dLen / (s1 - s0).
    const k = dLen / (s1 - s0);
    const x0 = (r0 - s0) * k, x1 = dLen + (r1 - s1) * k;
    const corners: Array<[number, number]> = [[x0, -wpad], [x1, -wpad], [x1, wpad], [x0, wpad], [x0, -wpad]];
    const boundaryPts = corners.map(([x, y]) => w.entity("IFCCARTESIANPOINT", [list(real(x), real(y))]));
    const boundary = w.entity("IFCPOLYLINE", [list(...boundaryPts.map(ref))]);

    // AgreementFlag false: the halfspace solid is the region the Axis (plane
    // normal) points TOWARD -- above the sloped line, which is exactly the
    // material DIFFERENCE removes below.
    const halfSpace = w.entity("IFCPOLYGONALBOUNDEDHALFSPACE", [ref(plane), enumv("F"), ref(placement), ref(boundary)]);
    return w.entity("IFCBOOLEANCLIPPINGRESULT", [enumv("DIFFERENCE"), ref(base), ref(halfSpace)]);
  }

  /**
   * A DIFFERENCE clip of `baseId` against the half-space on one side of a
   * tilted plane through `origin` (IFC axes), built the same way
   * slopedPieceSolid() builds its own IfcPlane/IfcPolygonalBoundedHalfSpace:
   * `tiltedDir` is the plane's own RefDirection (local X), `flatDir` a unit
   * vector perpendicular to it in the SAME plane (so Axis x RefDirection
   * comes out equal to `flatDir`, the same relationship slopedPieceSolid
   * relies on), and Axis = tiltedDir x flatDir.
   *
   * Used for a roof plane instead of an extrusion in the plane's own tilted
   * Position (which reads back wrong through web-ifc's tessellator for a
   * closed 2D profile -- this boundary-clip shape is the one this file
   * already has verified working, via slopedPieceSolid() and
   * tests/ifcclip.test.ts, for a genuinely tilted cut): a plain vertical
   * prism over the plane's own outline is clipped down to the underside from
   * above and back up to it from below, at a fixed vertical offset apart
   * (the bottom and top planes share the same tilt, only their origin
   * differs) -- see the roof-slab loop below.
   *
   * `keepBelow` true removes material ABOVE the plane (AgreementFlag "F",
   * the halfspace being the +Axis side); false removes material BELOW it
   * (AgreementFlag "T"). The boundary is a rectangle in the plane's own
   * local XY, [loX, hiX] x [loY, hiY], generous enough to cover the whole
   * outline with margin to spare.
   */
  function clipByTiltedPlane(
    baseId: number, origin: readonly [number, number, number],
    tiltedDir: readonly [number, number, number], flatDir: readonly [number, number, number],
    loX: number, hiX: number, loY: number, hiY: number, keepBelow: boolean,
  ): number {
    const cross3 = (a: readonly [number, number, number], b: readonly [number, number, number]):
      [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const normal = cross3(tiltedDir, flatDir);
    const locPt = w.entity("IFCCARTESIANPOINT", [list(real(origin[0]), real(origin[1]), real(origin[2]))]);
    const axisDir = w.entity("IFCDIRECTION", [list(real(normal[0]), real(normal[1]), real(normal[2]))]);
    const refDir = w.entity("IFCDIRECTION", [list(real(tiltedDir[0]), real(tiltedDir[1]), real(tiltedDir[2]))]);
    const placement = w.entity("IFCAXIS2PLACEMENT3D", [ref(locPt), ref(axisDir), ref(refDir)]);
    const plane = w.entity("IFCPLANE", [ref(placement)]);
    const corners: Array<[number, number]> = [[loX, loY], [hiX, loY], [hiX, hiY], [loX, hiY], [loX, loY]];
    const boundaryPts = corners.map(([x, y]) => w.entity("IFCCARTESIANPOINT", [list(real(x), real(y))]));
    const boundary = w.entity("IFCPOLYLINE", [list(...boundaryPts.map(ref))]);
    const halfSpace = w.entity("IFCPOLYGONALBOUNDEDHALFSPACE",
      [ref(plane), enumv(keepBelow ? "F" : "T"), ref(placement), ref(boundary)]);
    return w.entity("IFCBOOLEANCLIPPINGRESULT", [enumv("DIFFERENCE"), ref(baseId), ref(halfSpace)]);
  }

  /**
   * The distribution systems the file will declare, filled in as the storeys
   * are written and emitted once at the end: a service network is a property
   * of the BUILDING, not of the storey a leg of it happens to cross, so a
   * groep that runs up two floors is one system with segments on both.
   */
  const systems = new Map<string, { name: string; predefined: string; segments: number[] }>();

  // ── property sets and quantities ──────────────────────────────────────────
  //
  // Every Pset_*Common/Qto_* attachment below funnels through these two: an
  // IFCPROPERTYSET or IFCELEMENTQUANTITY plus the IFCRELDEFINESBYPROPERTIES
  // that hangs it off its element — the same pairing BIM 5 already used for
  // Qto_SpaceBaseQuantities, left as its own call site further down: its
  // GlobalId suffixing (qset ':qset', rel ':qto') runs the other way round
  // from these helpers' (set ':pset'/':qto', rel '<key>:rel'), so routing it
  // through here would not stay byte-identical for the same input.

  /** One typed IFCPROPERTYSINGLEVALUE(name, $, nominal value, $) entity id. */
  function propValue(name: string, nominal: IfcArg): number {
    return w.entity("IFCPROPERTYSINGLEVALUE", [str(name), UNSET, nominal, UNSET]);
  }

  const boolValue = (b: boolean): IfcArg => typed("IFCBOOLEAN", enumv(b ? "T" : "F"));
  const labelValue = (s: string): IfcArg => typed("IFCLABEL", str(s));
  /** Rounded to 3 decimals -- ample precision for a figure derived from a
   *  two-decimal Rc/U input, and legible in the file. */
  const transmittanceValue = (u: number): IfcArg =>
    typed("IFCTHERMALTRANSMITTANCEMEASURE", real(Math.round(u * 1000) / 1000));

  /**
   * Attaches one IFCPROPERTYSET to `elementId` via IFCRELDEFINESBYPROPERTIES,
   * when there is at least one property to state — never an empty pset. The
   * pset's own GlobalId is ifcGuid(seed, guidKey); the rel's is the same key
   * suffixed ':rel' so it cannot collide with the pset's own id.
   */
  function attachPropertySet(
    element: number | readonly number[], guidKey: string, psetName: string, props: IfcArg[],
  ): void {
    if (props.length === 0) return;
    // Several elements may share one pset -- every leg of one service run
    // states the same groep and diameter, and one set related to all of them
    // says that once instead of once per leg.
    const elements = typeof element === "number" ? [element] : element;
    if (elements.length === 0) return;
    const pset = w.entity("IFCPROPERTYSET",
      [str(ifcGuid(seed, guidKey)), ref(ownerHistory), str(psetName), UNSET, list(...props)]);
    w.entity("IFCRELDEFINESBYPROPERTIES",
      [str(ifcGuid(seed, `${guidKey}:rel`)), ref(ownerHistory), UNSET, UNSET,
        list(...elements.map(ref)), ref(pset)]);
  }

  /**
   * One IFCMATERIAL per name for the whole file. IfcMaterial is not a rooted
   * entity -- it carries no GlobalId of its own -- so sharing one between every
   * wall built of it is the canonical form rather than a saving.
   */
  const materials = new Map<string, number>();
  const materialEntity = (name: string): number => {
    const found = materials.get(name);
    if (found !== undefined) return found;
    const id = w.entity("IFCMATERIAL", [str(name), UNSET, UNSET]);
    materials.set(name, id);
    return id;
  };

  /** Attaches one IFCELEMENTQUANTITY to `elementId`, the same GlobalId and
   *  rel pairing as attachPropertySet() above but for quantities. */
  function attachQuantitySet(elementId: number, guidKey: string, qtoName: string, quantities: IfcArg[]): void {
    const qset = w.entity("IFCELEMENTQUANTITY",
      [str(ifcGuid(seed, guidKey)), ref(ownerHistory), str(qtoName), UNSET, UNSET, list(...quantities)]);
    w.entity("IFCRELDEFINESBYPROPERTIES",
      [str(ifcGuid(seed, `${guidKey}:rel`)), ref(ownerHistory), UNSET, UNSET, list(ref(elementId)), ref(qset)]);
  }

  /**
   * A void quad shrunk to FILLER_DEPTH_MM about its own centerline — the door
   * or window leaf's placeholder geometry. `voidPoly` is built the way
   * core/solids.ts builds it: [start+n0*half, end+n1*half, end-n1*half,
   * start-n0*half], so poly[0]/poly[3] straddle the opening's start-jamb
   * centerline point and poly[1]/poly[2] straddle its end-jamb point. Moving
   * each corner to FILLER_DEPTH_MM/2 from its own midpoint, on the side it
   * started on, keeps the panel centered on the wall regardless of thickness
   * or the jamb normals differing slightly across a bulged wall.
   */
  function fillerQuad(voidPoly: Vec[]): Vec[] {
    const m0 = mid(voidPoly[0]!, voidPoly[3]!);
    const m1 = mid(voidPoly[1]!, voidPoly[2]!);
    const half = FILLER_DEPTH_MM / 2;
    // Only reached if a jamb pair coincides (zero-thickness wall): fall back
    // to a normal built from the opening's own direction.
    const fallback = perp(norm(sub(m1, m0)));
    const sideAt = (corner: Vec, m: Vec): Vec => {
      const d = sub(corner, m);
      const l = len(d);
      return l > 1e-6 ? scale(d, 1 / l) : fallback;
    };
    const s0 = sideAt(voidPoly[0]!, m0), s1 = sideAt(voidPoly[1]!, m1);
    return [add(m0, scale(s0, half)), add(m1, scale(s1, half)),
      sub(m1, scale(s1, half)), sub(m0, scale(s0, half))];
  }

  /**
   * A stable identity for a derived room: rooms carry no id of their own (see
   * core/rooms.ts), so the export keys each IfcSpace off the room's own
   * footprint, the same way the room panel keys its rows (roomKey() in
   * core/rooms.ts) — the net-polygon centroid, rounded to whole mm. Moving a
   * wall re-keys the space on the next export; that is the honest outcome
   * for a derived object, the same trade-off roomNames.ts already accepts
   * for name attachment, not a limitation specific to this exporter.
   */
  function spaceKey(floor: Floor, r: Room): string {
    return `space:${floor.id}:${Math.round(r.centroid.x)}x${Math.round(r.centroid.y)}`;
  }

  /**
   * The Name an IfcSpace carries when the room itself has none: the same
   * clear-size label the drawing prints under an unnamed room's area (see
   * roomSize()/sizeLabel() in core/rooms.ts, used identically in io/svg.ts
   * and io/dxf.ts). $ only when there is truly nothing to say — an L-shaped
   * unnamed room has no rectangular size, and roomSize() never answers at
   * all when dimMode is "centerline".
   */
  function spaceName(r: Room, dim: DimMode): IfcArg {
    if (r.name !== undefined) return str(r.name);
    const size = roomSize(r, dim);
    return size ? str(sizeLabel(size)) : UNSET;
  }

  for (let i = 0; i < doc.floors.length; i++) {
    const floor = doc.floors[i]!;
    // floorSolids() returns null when this storey has no walls at all (see
    // core/solids.ts) — but a wall-less storey can still hold stairs,
    // furnishings, symbols and detected rooms (a storey with only freestanding
    // furniture, say), so only the wall/slab geometry below is gated on `fs`;
    // everything else in the loop runs regardless.
    const fs = floorSolids(doc, i);
    const wallSolids = fs?.walls ?? [];
    const slab = fs?.slab ?? null;

    // Computed once per floor and reused below: the wall-side probe (Pset
    // IsExternal) and the space loop further down both need the same room
    // set, and detectRooms() is pure, so a second call would just repeat it.
    const rooms = detectRooms(floor);
    const roomPolys = rooms.map(r => r.poly);

    // Identity placement relative to the storey: floorSolids() already
    // returns absolute plan coordinates, so every element on this storey
    // shares one relative placement rather than each carrying its own offset.
    const levelPlacement = w.entity("IFCLOCALPLACEMENT", [ref(storeyPlacements[i]!), ref(worldPlacement)]);
    const contained: number[] = []; // walls + door/window fillers; NOT openings
    // Walls of this storey by their stated material, for the associations
    // emitted once the loop has built every wall entity.
    // Keyed on material AND cladding, because those are two different
    // statements in IFC: a bare material is an IFCMATERIAL, a clad wall is an
    // IFCMATERIALLAYERSET. Walls agreeing on both share one relation.
    const byBuild = new Map<string,
      {
        material?: WallMaterial; thickness: number; facadeMm?: number;
        /** Which physical side facadeMm is on -- decides whether it lists
         *  first (left skin) or last (right skin) in the layer set below. */
        facadeSide?: "left" | "right";
        /** Lining on the left/right face, mm -- 0 where that face states none. */
        liningLeftMm: number; liningRightMm: number;
        elements: number[];
      }>();

    for (const ws of wallSolids) {
      const wall = floor.walls.find(x => x.id === ws.wallId)!;
      const lengthMm = wallLength(floor, wall);
      const hasProfile = (wall.profile?.length ?? 0) > 0;
      // A sloped wall's own top -- wallTopRange().max -- is a single flat
      // extrusion height for the whole wall; slopedPieceSolid() clips each
      // piece down to its own segment of the profile. A flat wall's bodyIds
      // are byte-identical to before: plain extrusions to each piece's own z1.
      const maxH = wallTopRange(floor, wall, lengthMm).max;
      let bodyIds: (number | null)[];
      if (hasProfile) {
        const na = floor.nodes.find(n => n.id === wall.a), nb = floor.nodes.find(n => n.id === wall.b);
        const A = na ? v(na.x, na.y) : v(0, 0), B = nb ? v(nb.x, nb.y) : v(0, 0);
        bodyIds = ws.body.map(p => slopedPieceSolid(floor, wall, p.poly, maxH, A, B, lengthMm));
        // ws.body's pieces (ResolvedWall.pieces) run BETWEEN openings -- see
        // wallBodyPrisms() in core/solids.ts -- so the band below a sill and
        // the band above a head (issue #59) are missing material, not a
        // second solid: every opening's void cuts a full-height hole out of a
        // body that carries nothing over its own span. The band below is
        // always flat (0 to z0 <= the wall's top everywhere across the
        // opening's own width, by construction of OpeningVoid.z0/z1 in
        // core/solids.ts); the band above follows the profile through the
        // same clip a body piece gets, one solid per `above` piece, starting
        // at the head height instead of the slab.
        for (const og of ws.voids) {
          bodyIds.push(extrudedSolid(og.poly, 0, og.z0));
          for (const p of og.above ?? []) {
            bodyIds.push(slopedPieceSolid(floor, wall, p.poly, maxH, A, B, lengthMm, og.z1));
          }
        }
      } else {
        bodyIds = ws.body.map(p => extrudedSolid(p.poly, p.z0, p.z1));
        // Same bands, flat wall: the above-band simply runs to the wall's one
        // height (maxH here equals wallHeight(), see wallBodyPrisms()).
        for (const og of ws.voids) {
          bodyIds.push(extrudedSolid(og.poly, 0, og.z0));
          bodyIds.push(extrudedSolid(og.poly, og.z1, maxH));
        }
      }
      // A wall carrying posts is IFC4's ELEMENTEDWALL: a wall assembled from
      // components. That is the honest predefined type for a curtain-walled or
      // portal-framed wall, and it states the fact without inventing the
      // assembly itself — the components are not modelled (see IFC_MATERIAL_NAME).
      const wallEntity = w.entity("IFCWALL",
        [str(ifcGuid(seed, wall.id)), ref(ownerHistory), str(`Wall ${wall.thickness}`), UNSET, UNSET,
          ref(levelPlacement), bodyShape(bodyIds, hasProfile ? "Clipping" : "SweptSolid"), UNSET,
          wallPostMm(wall) !== undefined ? enumv("ELEMENTEDWALL") : UNSET]);
      contained.push(wallEntity);

      // ── Pset_WallCommon ──────────────────────────────────────────────────
      const external = wallIsExternal(floor, wall, roomPolys);
      const wallProps: IfcArg[] = [];
      if (external !== undefined) wallProps.push(ref(propValue("IsExternal", boolValue(external))));
      if (wall.loadBearing !== undefined) wallProps.push(ref(propValue("LoadBearing", boolValue(wall.loadBearing))));
      if (wall.fireRating !== undefined) wallProps.push(ref(propValue("FireRating", labelValue(fireLabel(wall.fireRating)))));
      const wallRc = wallRcOf(doc, wall);
      if (wallRc !== null) {
        wallProps.push(ref(propValue("ThermalTransmittance", transmittanceValue(uFromRc(wallRc, "wall")))));
      }
      attachPropertySet(wallEntity, `${wall.id}:pset`, "Pset_WallCommon", wallProps);

      // ── Wallgraph_Construction ───────────────────────────────────────────
      // Authored construction facts only, read straight off the document --
      // never wallPostMm()/wallPostWidthMm(), which clamp and default for the
      // drawing. A field the wall does not state is simply absent here, the
      // same reading Pset_WallCommon gives every optional property above.
      const constructionProps: IfcArg[] = [];
      if (wall.postMm !== undefined && wall.postMm > 0) {
        constructionProps.push(ref(propValue("PostCentres", typed("IFCPOSITIVELENGTHMEASURE", real(wall.postMm)))));
      }
      if (wall.postWidthMm !== undefined) {
        constructionProps.push(ref(propValue("PostWidth", typed("IFCPOSITIVELENGTHMEASURE", real(wall.postWidthMm)))));
      }
      if (wall.noggingRows !== undefined) {
        constructionProps.push(ref(propValue("NoggingRows", typed("IFCCOUNTMEASURE", int(wall.noggingRows)))));
      }
      if (wall.blockMm) {
        constructionProps.push(ref(propValue("BlockLength", typed("IFCPOSITIVELENGTHMEASURE", real(wall.blockMm.length)))));
        constructionProps.push(ref(propValue("BlockHeight", typed("IFCPOSITIVELENGTHMEASURE", real(wall.blockMm.height)))));
      }
      if (wall.panelMm !== undefined) {
        constructionProps.push(ref(propValue("PanelWidth", typed("IFCPOSITIVELENGTHMEASURE", real(wall.panelMm)))));
      }
      if (wall.insulated !== undefined) {
        constructionProps.push(ref(propValue("Insulated", boolValue(wall.insulated))));
      }
      attachPropertySet(wallEntity, `${wall.id}:construction`, "Wallgraph_Construction", constructionProps);

      // ── material ─────────────────────────────────────────────────────────
      // Absent means not stated, so nothing is associated rather than a guess
      // at masonry -- the same reading Pset_WallCommon gives loadBearing above.
      const facadeMm = wallFacadeMm(wall);
      const facadeSide = facadeMm !== undefined ? facadeSideOf(wall) : undefined;
      const liningMm = wallLiningMm(wall);
      const liningLeftMm = liningMm > 0 && liningSideOf(wall, "left") ? liningMm : 0;
      const liningRightMm = liningMm > 0 && liningSideOf(wall, "right") ? liningMm : 0;
      if (wall.material !== undefined || facadeMm !== undefined || liningLeftMm > 0 || liningRightMm > 0) {
        // Thickness is part of the key whenever the wall carries a layer set
        // (cladding or lining): it is a layer of the build-up there, and
        // irrelevant to a bare material association, which would otherwise
        // split into one relation per thickness. facadeSide is part of it
        // too -- two walls agreeing on everything else but clad on opposite
        // sides are two different physical layer orders, not one relation.
        const key = facadeMm === undefined && liningLeftMm === 0 && liningRightMm === 0
          ? `${wall.material}|`
          : `${wall.material ?? ""}|${wall.thickness}|${facadeMm ?? ""}|${facadeSide ?? ""}|${liningLeftMm}|${liningRightMm}`;
        const bucket = byBuild.get(key)
          ?? { material: wall.material, thickness: wall.thickness, facadeMm, facadeSide, liningLeftMm, liningRightMm, elements: [] };
        bucket.elements.push(wallEntity);
        byBuild.set(key, bucket);
      }

      // ── Qto_WallBaseQuantities ───────────────────────────────────────────
      // Gross: opening voids are NOT subtracted from the volume, matching the
      // "gross" name honestly rather than reporting a net figure under it.
      // Height is the wall's own top -- wallTopRange().max, its flat
      // wallHeight() where it states no profile -- and GrossVolume reads the
      // area under that top (wallAreaUnder(), model/profile.ts) rather than
      // length x height, which would overstate a sloped wall's material.
      // Bit-identical on a flat wall, whose area under the top is its length
      // times its flat height exactly.
      const heightMm = maxH;
      const grossVolumeM3 = (wallAreaUnder(floor, wall, lengthMm, 0, lengthMm) * wall.thickness) / 1e9;
      attachQuantitySet(wallEntity, `${wall.id}:qto`, "Qto_WallBaseQuantities", [
        ref(w.entity("IFCQUANTITYLENGTH", [str("Length"), UNSET, UNSET, real(lengthMm), UNSET])),
        ref(w.entity("IFCQUANTITYLENGTH", [str("Width"), UNSET, UNSET, real(wall.thickness), UNSET])),
        ref(w.entity("IFCQUANTITYLENGTH", [str("Height"), UNSET, UNSET, real(heightMm), UNSET])),
        ref(w.entity("IFCQUANTITYVOLUME", [str("GrossVolume"), UNSET, UNSET, real(grossVolumeM3), UNSET])),
      ]);

      for (const og of ws.voids) {
        const opening = wall.openings.find(o => o.id === og.openingId)!;
        const name = opening.kind[0]!.toUpperCase() + opening.kind.slice(1);
        const openingEntity = w.entity("IFCOPENINGELEMENT",
          [str(ifcGuid(seed, opening.id)), ref(ownerHistory), str(name), UNSET, UNSET, ref(levelPlacement),
            bodyShape([extrudedSolid(og.poly, og.z0, og.z1)]), UNSET, UNSET]);
        w.entity("IFCRELVOIDSELEMENT",
          [str(ifcGuid(seed, `${opening.id}:void`)), ref(ownerHistory), UNSET, UNSET,
            ref(wallEntity), ref(openingEntity)]);

        // ── Wallgraph_Construction (opening) ────────────────────────────────
        // On the void itself, not the door/window filler: a passage carries a
        // lintel too, and only IFCOPENINGELEMENT exists for every kind. Raw
        // opening.bearingMm/.lintel only -- never openingBearing()'s
        // OPENING_BEARING_DEFAULT_MM fallback, which is a drawing convention,
        // not an authored fact.
        const openingConstructionProps: IfcArg[] = [];
        if (opening.bearingMm !== undefined) {
          openingConstructionProps.push(
            ref(propValue("Bearing", typed("IFCPOSITIVELENGTHMEASURE", real(opening.bearingMm)))));
        }
        if (opening.lintel) {
          openingConstructionProps.push(
            ref(propValue("LintelWidth", typed("IFCPOSITIVELENGTHMEASURE", real(opening.lintel.w)))));
          openingConstructionProps.push(
            ref(propValue("LintelDepth", typed("IFCPOSITIVELENGTHMEASURE", real(opening.lintel.d)))));
        }
        attachPropertySet(openingEntity, `${opening.id}:construction`, "Wallgraph_Construction", openingConstructionProps);

        if (opening.kind === "door" || opening.kind === "window") {
          const fillerShape = bodyShape([extrudedSolid(fillerQuad(og.poly), og.z0, og.z1)]);
          const overallHeight = real(openingHeight(opening));
          const overallWidth = real(opening.width);
          const sashes = sashSpecsOf(opening);
          const fillEntity = opening.kind === "door"
            ? w.entity("IFCDOOR",
                [str(ifcGuid(seed, `${opening.id}:fill`)), ref(ownerHistory), str("Door"), UNSET, UNSET,
                  ref(levelPlacement), fillerShape, UNSET, overallHeight, overallWidth, UNSET,
                  enumv(doorOperationType(sashes)), UNSET])
            : w.entity("IFCWINDOW",
                [str(ifcGuid(seed, `${opening.id}:fill`)), ref(ownerHistory), str("Window"), UNSET, UNSET,
                  ref(levelPlacement), fillerShape, UNSET, overallHeight, overallWidth, UNSET,
                  enumv(windowPartitioningType(sashes.length)), UNSET]);
          w.entity("IFCRELFILLSELEMENT",
            [str(ifcGuid(seed, `${opening.id}:fills`)), ref(ownerHistory), UNSET, UNSET,
              ref(openingEntity), ref(fillEntity)]);
          contained.push(fillEntity);

          // ── Pset_DoorCommon / Pset_WindowCommon ───────────────────────────
          const fillProps: IfcArg[] = [];
          if (opening.fireRating !== undefined) {
            fillProps.push(ref(propValue("FireRating", labelValue(fireLabel(opening.fireRating)))));
          }
          // No stated-false in the model (Opening.selfClosing is a flag, not
          // tri-state), so only `true` is ever written.
          if (opening.selfClosing === true) fillProps.push(ref(propValue("SelfClosing", boolValue(true))));
          if (external !== undefined) fillProps.push(ref(propValue("IsExternal", boolValue(external))));
          const openingU = openingUOf(doc, wall, opening);
          if (openingU !== null) {
            fillProps.push(ref(propValue("ThermalTransmittance", transmittanceValue(openingU))));
          }
          const fillPsetName = opening.kind === "door" ? "Pset_DoorCommon" : "Pset_WindowCommon";
          attachPropertySet(fillEntity, `${opening.id}:fillpset`, fillPsetName, fillProps);
        }
      }
    }

    // ── structure: IFCCOLUMN / IFCBEAM / IFCRAILING ─────────────────────────
    //
    // Each as one extrusion of its plan section over its own vertical range
    // (core/structure.ts structureSolid): a column from the floor to its
    // stated height, a beam between its underside and top, a railing to its
    // guarding height with the posts inside the slab. A stated material joins
    // the storey's bare-material associations below; a beam's profile name is
    // the element's Name, since the document stores the designation and not a
    // catalogue section.
    for (const el of structureOf(floor)) {
      const solid = structureSolid(floor, el);
      const shape = bodyShape([extrudedSolid(solid.poly, solid.z0, solid.z1)]);
      let entity: number;
      if (el.kind === "column") {
        entity = w.entity("IFCCOLUMN",
          [str(ifcGuid(seed, el.id)), ref(ownerHistory), str(el.label ?? "Column"), UNSET, UNSET,
            ref(levelPlacement), shape, UNSET, enumv("COLUMN")]);
        attachPropertySet(entity, `${el.id}:pset`, "Pset_ColumnCommon",
          [ref(propValue("LoadBearing", boolValue(true)))]);
        attachQuantitySet(entity, `${el.id}:qto`, "Qto_ColumnBaseQuantities", [
          ref(w.entity("IFCQUANTITYLENGTH", [str("Length"), UNSET, UNSET, real(solid.z1 - solid.z0), UNSET])),
        ]);
      } else if (el.kind === "beam") {
        entity = w.entity("IFCBEAM",
          [str(ifcGuid(seed, el.id)), ref(ownerHistory), str(el.label ?? "Beam"), UNSET, UNSET,
            ref(levelPlacement), shape, UNSET, enumv("BEAM")]);
        attachPropertySet(entity, `${el.id}:pset`, "Pset_BeamCommon",
          [ref(propValue("LoadBearing", boolValue(true))), ref(propValue("Span", typed("IFCPOSITIVELENGTHMEASURE", real(spanLength(el)))))]);
        attachQuantitySet(entity, `${el.id}:qto`, "Qto_BeamBaseQuantities", [
          ref(w.entity("IFCQUANTITYLENGTH", [str("Length"), UNSET, UNSET, real(spanLength(el)), UNSET])),
        ]);
      } else {
        entity = w.entity("IFCRAILING",
          [str(ifcGuid(seed, el.id)), ref(ownerHistory), str(el.label ?? "Railing"), UNSET, UNSET,
            ref(levelPlacement), shape, UNSET, enumv("GUARDRAIL")]);
        attachPropertySet(entity, `${el.id}:pset`, "Pset_RailingCommon",
          [ref(propValue("Height", typed("IFCPOSITIVELENGTHMEASURE", real(el.height))))]);
      }
      contained.push(entity);
      if (el.material !== undefined) {
        const key = `${el.material}|`;
        const bucket = byBuild.get(key)
          ?? { material: el.material, thickness: 0, liningLeftMm: 0, liningRightMm: 0, elements: [] };
        bucket.elements.push(entity);
        byBuild.set(key, bucket);
      }
    }

    // ── materials ───────────────────────────────────────────────────────────
    //
    // IFC associates a material with a SET of elements, so this is one relation
    // per material per storey rather than one per wall -- the latter would write
    // the same statement once for every wall. The GlobalId is keyed on the
    // storey and the material name, both stable, so a re-export keeps it.
    for (const [key, build] of byBuild) {
      // A clad or lined wall is a build-up, and IFC says so with a layer set:
      // the structure and its skins as ordered layers, physically across the
      // wall. The facade layer names no material because the document stores
      // only its thickness -- IfcMaterialLayer.Material is optional in IFC4
      // precisely for this; a lining layer names LINING_MATERIAL_NAME because
      // the document states what it is, just not which product. A bare wall
      // keeps the plain IFCMATERIAL association it had.
      const hasLining = build.liningLeftMm > 0 || build.liningRightMm > 0;
      const structureLayer = (): number => w.entity("IFCMATERIALLAYER", [
        build.material !== undefined ? ref(materialEntity(IFC_MATERIAL_NAME[build.material])) : UNSET,
        real(build.thickness), UNSET, str("Structure"), UNSET, UNSET, UNSET]);
      const facadeLayer = (): number => w.entity("IFCMATERIALLAYER", [
        UNSET, real(build.facadeMm!), UNSET, str("Facade"), UNSET, UNSET, UNSET]);
      const liningLayer = (mm: number): number => w.entity("IFCMATERIALLAYER", [
        ref(materialEntity(LINING_MATERIAL_NAME)), real(mm), UNSET, str("Lining"), UNSET, UNSET, UNSET]);
      const relating = build.facadeMm === undefined && !hasLining
        ? materialEntity(IFC_MATERIAL_NAME[build.material!])
        : (() => {
            // Ordered physically -- left skin, structure, right skin -- so a
            // clad wall lists its facade on the side it is actually drawn on
            // rather than always after the structure. Facade and lining never
            // share a face (liningSideOf excludes the facade side), so
            // build.facadeSide alone decides the facade's slot; a lining on
            // the OTHER face, where one is stated, takes the remaining slot.
            let left: number | undefined, right: number | undefined;
            if (build.facadeMm !== undefined && build.facadeSide === "right") {
              right = facadeLayer();
              if (build.liningLeftMm > 0) left = liningLayer(build.liningLeftMm);
            } else if (build.facadeMm !== undefined) {
              left = facadeLayer();
              if (build.liningRightMm > 0) right = liningLayer(build.liningRightMm);
            } else {
              if (build.liningLeftMm > 0) left = liningLayer(build.liningLeftMm);
              if (build.liningRightMm > 0) right = liningLayer(build.liningRightMm);
            }
            const layers = [left, structureLayer(), right]
              .filter((id): id is number => id !== undefined).map(ref);
            return w.entity("IFCMATERIALLAYERSET", [list(...layers), str("Wall"), UNSET]);
          })();
      w.entity("IFCRELASSOCIATESMATERIAL",
        [str(ifcGuid(seed, `${floor.id}:material:${key}`)), ref(ownerHistory), UNSET, UNSET,
          list(...build.elements.map(e => ref(e))), ref(relating)]);
    }

    // ── slab and vide voids ─────────────────────────────────────────────────
    //
    // `slab` is null exactly when there is no `fs` at all, or the wall graph
    // has no closed outer boundary (see outerBoundary() in core/rooms.ts) —
    // an open chain or an empty floor. Nothing is emitted for that storey's
    // plate in that case; the walls (and their own openings) above are
    // unaffected.
    if (slab) {
      const slabEntity = w.entity("IFCSLAB",
        [str(ifcGuid(seed, `${floor.id}:slab`)), ref(ownerHistory), str("Slab"), UNSET, UNSET,
          ref(levelPlacement), bodyShape([extrudedSolid(slab.outline, slab.z0, slab.z1)]), UNSET,
          enumv("FLOOR")]);
      contained.push(slabEntity);

      // Only authored vides carry stored ids to key an opening's GlobalId on.
      // floorSolids() may merge a partially overlapping derived stairwell into
      // its display hole, so export the vide's exact authored footprint here.
      const vides = videsOf(floor);
      vides.forEach(vide => {
        const hole = videHole(vide);
        const openingEntity = w.entity("IFCOPENINGELEMENT",
          [str(ifcGuid(seed, vide.id)), ref(ownerHistory), str("Vide"), UNSET, UNSET, ref(levelPlacement),
            bodyShape([extrudedSolid(hole, slab.z0, slab.z1)]), UNSET, UNSET]);
        w.entity("IFCRELVOIDSELEMENT",
          [str(ifcGuid(seed, `${vide.id}:void`)), ref(ownerHistory), UNSET, UNSET,
            ref(slabEntity), ref(openingEntity)]);
      });
    }

    // ── decks: one IFCSLAB (decking) plus one IFCMEMBER per joist ───────────
    //
    // core/deck.ts's deckSolids() already draws no decking prism for a deck
    // at floor level -- its platform coincides with the storey's own slab
    // above, the same reason the 3D view skips it -- so only a raised deck
    // (topMm > 0) with a stated decking thickness gets its own IFCSLAB here;
    // its joists are still exported either way, whenever a section is
    // stated. Loads are Wallgraph_Loads, the deck's own authored loadG/loadQ
    // converted from the document's N/m^2 to IFC's more usual kN/m^2 --
    // never a derived figure, so absent stays absent rather than reading as
    // zero load.
    for (const d of decksOf(floor)) {
      const solids = deckSolids(d);
      const deckingSolid = solids.find(s => s.part === "decking");
      const joistSolids = solids.filter(s => s.part === "joist");

      let slabEntity: number | undefined;
      if (deckingSolid) {
        const solidId = extrudedSolid(deckingSolid.poly, deckingSolid.z0, deckingSolid.z1);
        if (solidId !== null) {
          slabEntity = w.entity("IFCSLAB",
            [str(ifcGuid(seed, `${d.id}:slab`)), ref(ownerHistory), str(d.label ?? "Deck"), UNSET, UNSET,
              ref(levelPlacement), bodyShape([solidId]), UNSET, enumv("FLOOR")]);
          attachPropertySet(slabEntity, `${d.id}:pset`, "Pset_SlabCommon",
            [ref(propValue("LoadBearing", boolValue(true)))]);
        }
      }

      const joistEntities: number[] = [];
      for (let i = 0; i < joistSolids.length; i++) {
        const js = joistSolids[i]!;
        const solidId = extrudedSolid(js.poly, js.z0, js.z1);
        if (solidId === null) continue;
        joistEntities.push(w.entity("IFCMEMBER",
          [str(ifcGuid(seed, `${d.id}:joist:${i}`)), ref(ownerHistory), str("Joist"), UNSET, UNSET,
            ref(levelPlacement), bodyShape([solidId]), UNSET, enumv("NOTDEFINED")]));
      }

      if (slabEntity !== undefined) {
        contained.push(slabEntity);
        if (joistEntities.length > 0) {
          w.entity("IFCRELAGGREGATES",
            [str(ifcGuid(seed, `${d.id}:parts`)), ref(ownerHistory), UNSET, UNSET,
              ref(slabEntity), list(...joistEntities.map(ref))]);
        }
      } else {
        contained.push(...joistEntities);
      }

      const loadProps: IfcArg[] = [];
      if (d.loadG !== undefined) loadProps.push(ref(propValue("PermanentLoad", typed("IFCREAL", real(d.loadG / 1000)))));
      if (d.loadQ !== undefined) loadProps.push(ref(propValue("VariableLoad", typed("IFCREAL", real(d.loadQ / 1000)))));
      const loadTarget = slabEntity !== undefined ? slabEntity : joistEntities;
      attachPropertySet(loadTarget, `${d.id}:loads`, "Wallgraph_Loads", loadProps);
    }

    // ── roof: one IFCROOF aggregating one IFCSLAB (ROOF) per plane ──────────
    //
    // A vertical prism (extrudedSolid(), identity placement, plain and
    // already proven reliable) over the plane's own outline, from the floor
    // up to comfortably above its highest point, clipped down to the
    // underside by clipByTiltedPlane() and back up from below it the same
    // way -- the exact two-plane sandwich a constant-thickness slab is, the
    // bottom and top planes sharing one tilt and differing only in their
    // origin's height (see core/solids.ts's roofSlabSolids(), which states
    // the same "top = bottom + thicknessMm / cos(pitch), vertically" slab).
    // A single IfcExtrudedAreaSolid built directly in the plane's own tilted
    // Position was tried first and reads back wrong through web-ifc's own
    // tessellator for a closed 2D profile; this boundary-clip construction
    // is the one already verified working, by slopedPieceSolid() above and
    // tests/ifcclip.test.ts. Only the IfcRoof itself joins `contained`, the
    // way an IfcStair (not its flight) does -- the aggregation already
    // places the slabs.
    const roofPlanes = roofPlanesOf(floor);
    if (roofPlanes.length > 0) {
      const roofSlabs: number[] = [];
      for (const plane of roofPlanes) {
        if (plane.outline.length < 3) continue;
        const eave = eaveLineOf(plane);
        const pitchRad = (plane.pitchDeg * Math.PI) / 180;
        const cosPitch = Math.cos(pitchRad);
        const thickness = roofThicknessOf(plane);
        const vertical = cosPitch > 1e-6 ? thickness / cosPitch : thickness;

        const outlineWorld = plane.outline.map(p => v(p.x, p.y));
        const bottomHs = outlineWorld.map(p => planeUndersideAt(plane, p));
        const topHs = bottomHs.map(h => h + vertical);
        const maxTop = Math.max(...topHs);
        const baseId = extrudedSolid(outlineWorld, 0, maxTop + 10);
        if (baseId === null) continue;

        // IFC's y-up axes: negate every plan-space y, as extrudedSolid() does.
        const dirIfc: [number, number, number] = [eave.dir.x, -eave.dir.y, 0];
        const inwardIfc: [number, number, number] = [eave.inward.x, -eave.inward.y, 0];
        const tiltedDir: [number, number, number] =
          [inwardIfc[0] * cosPitch, inwardIfc[1] * cosPitch, Math.sin(pitchRad)];
        const eaveVals = outlineWorld.map(p => dot(sub(p, eave.a), eave.dir));
        const intoVals = outlineWorld.map(p => dot(sub(p, eave.a), eave.inward));
        const PAD = 1000;
        const eaveLo = Math.min(...eaveVals) - PAD, eaveHi = Math.max(...eaveVals) + PAD;
        const slopeLo = Math.min(0, ...intoVals) / cosPitch - PAD, slopeHi = Math.max(...intoVals) / cosPitch + PAD;

        const bottomOrigin: [number, number, number] = [eave.a.x, -eave.a.y, plane.eaveMm];
        const topOrigin: [number, number, number] = [eave.a.x, -eave.a.y, plane.eaveMm + vertical];
        let solidId = clipByTiltedPlane(baseId, topOrigin, tiltedDir, dirIfc, slopeLo, slopeHi, eaveLo, eaveHi, true);
        solidId = clipByTiltedPlane(solidId, bottomOrigin, tiltedDir, dirIfc, slopeLo, slopeHi, eaveLo, eaveHi, false);
        const shape = bodyShape([solidId], "Clipping");

        const slabEntity = w.entity("IFCSLAB",
          [str(ifcGuid(seed, `${plane.id}:slab`)), ref(ownerHistory), str("Roof"), UNSET, UNSET,
            ref(levelPlacement), shape, UNSET, enumv("ROOF")]);
        roofSlabs.push(slabEntity);
      }
      if (roofSlabs.length > 0) {
        const roofEntity = w.entity("IFCROOF",
          [str(ifcGuid(seed, `${floor.id}:roof`)), ref(ownerHistory), str("Roof"), UNSET, UNSET,
            ref(levelPlacement), UNSET, UNSET, enumv("NOTDEFINED")]);
        w.entity("IFCRELAGGREGATES",
          [str(ifcGuid(seed, `${floor.id}:roof:parts`)), ref(ownerHistory), UNSET, UNSET,
            ref(roofEntity), list(...roofSlabs.map(ref))]);
        contained.push(roofEntity);
      }
    }

    // ── stairs: one IFCSTAIR aggregating one IFCSTAIRFLIGHT ─────────────────
    //
    // The stair carries identity, kind and containment; the flight carries
    // the run's numbers and its geometry, which is why the flight — not the
    // stair — is what floorSolids-style extrusion below is built for. Simple
    // box geometry only: the footprint stairBox() already derives for the
    // hit-test and the DXF export, extruded from the floor to the resolved
    // rise. No treads, stringers or a landing are modelled.
    for (const st of stairsOf(floor)) {
      const resolved = resolveStair(floor, st);
      const params = stairParams(resolved);
      const risers = params.treads + 1;
      const riserHeight = params.rise / risers;

      const stairEntity = w.entity("IFCSTAIR",
        [str(ifcGuid(seed, resolved.id)), ref(ownerHistory), str(resolved.kind), UNSET, UNSET,
          ref(levelPlacement), UNSET, UNSET, enumv(stairPredefinedType(resolved.kind))]);
      contained.push(stairEntity);

      const flightShape = bodyShape([extrudedSolid(boxQuad(resolved, stairBox(resolved)), 0, resolved.rise)]);
      const flightEntity = w.entity("IFCSTAIRFLIGHT",
        [str(ifcGuid(seed, `${resolved.id}:flight`)), ref(ownerHistory), UNSET, UNSET, UNSET,
          ref(levelPlacement), flightShape, UNSET, int(risers), int(params.treads), real(riserHeight),
          real(params.going), UNSET]);

      w.entity("IFCRELAGGREGATES",
        [str(ifcGuid(seed, `${resolved.id}:parts`)), ref(ownerHistory), UNSET, UNSET,
          ref(stairEntity), list(ref(flightEntity))]);
    }

    // ── furnishings: one element each, class from the trade ─────────────────
    //
    // Box geometry over the piece's own vertical range: most stand on the
    // floor, a piece that hangs starts at core/furnishing3d.ts's
    // OVERHEAD_Z0_MM, the one figure the 3D view places it at too. No carcass,
    // front, worktop, hinge or bowl is modelled — this states where the piece
    // is and how tall it stands, the way core/furnishing.ts's own
    // furnishingBox() does for the plan drawing.
    for (const fn of furnishingsOf(floor)) {
      const z0 = furnishingZ0(fn);
      const shape = bodyShape([extrudedSolid(boxQuad(fn, furnishingBox(fn)), z0, z0 + furnishingHeight(fn))]);
      const ifcClass = FURNISHING_CLASSES[furnishingClass(fn.form)];
      const args: IfcArg[] = [str(ifcGuid(seed, fn.id)), ref(ownerHistory), str(fn.label ?? fn.form),
        UNSET, UNSET, ref(levelPlacement), shape, UNSET];
      if (ifcClass.hasPredefinedType) args.push(enumv("NOTDEFINED"));
      contained.push(w.entity(ifcClass.entity, args));
    }

    // ── symbols: one element per instance, class from the registry category ─
    //
    // Box geometry only, extruded a nominal SYMBOL_NOMINAL_HEIGHT_MM: this
    // states a symbol's placement and its IFC class, not a manufacturer's
    // product model. A type this document draws but that has since dropped
    // out of the registry (getSymbol() returns undefined) is skipped rather
    // than guessed at, the same way the DXF exporter and the palette treat it.
    for (const s of floor.symbols) {
      const def = getSymbol(s.type);
      if (!def) continue;
      const ifcClass = symbolIfcClass(def);
      const shape = bodyShape([extrudedSolid(symbolFootprint(def, s), 0, SYMBOL_NOMINAL_HEIGHT_MM)]);
      const args: IfcArg[] = [str(ifcGuid(seed, s.id)), ref(ownerHistory), str(s.type), UNSET, UNSET,
        ref(levelPlacement), shape, UNSET];
      if (ifcClass.hasPredefinedType) args.push(enumv("NOTDEFINED"));
      const symbolEntity = w.entity(ifcClass.entity, args);
      contained.push(symbolEntity);
    }

    // ── services: one MEP segment per straight leg of every route ──────────
    //
    // The plan-space run, extruded to a nominal cross-section at the plane the
    // route states it is installed in (routePlaneHeight). Deliberately NOT the
    // fanned resolution the canvas draws: the corridor lanes in core/route.ts
    // are a legibility device for a 2D sheet, and offsetting a duct sideways
    // by 60 mm so it reads clearly beside another one would be a false claim
    // about where it is. Anchored points still resolve, so a run ends at the
    // socket it follows.
    //
    // Known cuts, carried from the issue: no fittings, no risers (a vertical
    // continuation is a document-level link, not an element), and the
    // cross-section is nominal rather than a product's. The one semantic worth
    // having is the grouping below -- an IFCDISTRIBUTIONSYSTEM per groep or
    // per service kind, so a receiving model can select a circuit.
    for (const route of routesOf(floor)) {
      const points = resolveRoutePoints(floor, route);
      const byId = new Map(route.points.map((p, index) => [p.id, points[index]!]));
      const size = routeIfcSize(route);
      const plane = routePlaneHeight(floor, route);
      const z0 = Math.max(0, plane - size / 2);
      const ifcEntity = ROUTE_IFC_ENTITY[route.discipline];
      const name = route.tag ?? route.name ?? route.discipline;
      const legs: number[] = [];
      for (const segment of route.segments) {
        const a = byId.get(segment.a), b = byId.get(segment.b);
        if (!a || !b) continue;
        // A bowed leg becomes the straight legs it flattens to -- one IFC
        // segment each, which is what "one segment per polyline leg" means for
        // a run that curves.
        const pts = (segment.bulge ?? 0) === 0 ? [a, b] : arcFlatten(a, b, segment.bulge!, ROUTE_FLATTEN_MM);
        for (let k = 0; k + 1 < pts.length; k++) {
          const quad = legQuad(pts[k]!, pts[k + 1]!, size);
          if (!quad) continue;
          const shape = bodyShape([extrudedSolid(quad, z0, z0 + size)]);
          const key = pts.length === 2 ? segment.id : `${segment.id}:${k}`;
          legs.push(w.entity(ifcEntity, [
            str(ifcGuid(seed, key)), ref(ownerHistory), str(name), UNSET, UNSET,
            ref(levelPlacement), shape, UNSET, enumv("NOTDEFINED"),
          ]));
        }
      }
      if (legs.length === 0) continue;
      contained.push(...legs);
      // One pset for the whole run rather than one per leg: every leg states
      // the same groep, diameter and design flow.
      attachPropertySet(legs, `${route.id}:pset`, "Pset_WallgraphService",
        routeProps(route).map(prop => ref(propValue(prop.name,
          prop.kind === "label" ? labelValue(String(prop.value))
          : prop.kind === "count" ? typed("IFCCOUNTMEASURE", int(Number(prop.value)))
          : prop.kind === "length" ? typed("IFCPOSITIVELENGTHMEASURE", real(Number(prop.value)))
          : typed("IFCREAL", real(Number(prop.value)))))));
      const systemKey = routeSystemKey(route);
      const system = systems.get(systemKey.id)
        ?? { name: systemKey.name, predefined: systemKey.predefined, segments: [] };
      system.segments.push(...legs);
      systems.set(systemKey.id, system);
    }

    if (contained.length > 0) {
      w.entity("IFCRELCONTAINEDINSPATIALSTRUCTURE",
        [str(ifcGuid(seed, `${floor.id}:contains`)), ref(ownerHistory), UNSET, UNSET,
          list(...contained.map(ref)), ref(storeys[i]!)]);
    }

    // ── spaces: one IFCSPACE per detected room, aggregated (not contained) ──

    const dim = dimModeOf(doc);
    const fh = floorHeight(floor);
    const spaceEntities: number[] = [];
    for (const r of rooms) {
      const key = spaceKey(floor, r);
      const spaceEntity = w.entity("IFCSPACE",
        [str(ifcGuid(seed, key)), ref(ownerHistory), spaceName(r, dim), UNSET, UNSET, ref(levelPlacement),
          bodyShape([extrudedSolid(r.netPoly, 0, fh)]), UNSET, enumv("ELEMENT"), enumv("INTERNAL"), UNSET]);
      spaceEntities.push(spaceEntity);

      // NetFloorArea on the document's own declared basis (areaModeOf), not
      // a claim of NEN 2580 conformance — MethodOfMeasurement stays $.
      const areaMm2 = roomArea(r, areaModeOf(doc));
      const areaQty = w.entity("IFCQUANTITYAREA", [str("NetFloorArea"), UNSET, UNSET, real(areaMm2 / 1e6), UNSET]);
      const heightQty = w.entity("IFCQUANTITYLENGTH", [str("Height"), UNSET, UNSET, real(fh), UNSET]);
      const qset = w.entity("IFCELEMENTQUANTITY",
        [str(ifcGuid(seed, `${key}:qset`)), ref(ownerHistory), str("Qto_SpaceBaseQuantities"), UNSET, UNSET,
          list(ref(areaQty), ref(heightQty))]);
      w.entity("IFCRELDEFINESBYPROPERTIES",
        [str(ifcGuid(seed, `${key}:qto`)), ref(ownerHistory), UNSET, UNSET, list(ref(spaceEntity)), ref(qset)]);
    }

    if (spaceEntities.length > 0) {
      w.entity("IFCRELAGGREGATES",
        [str(ifcGuid(seed, `${floor.id}:spaces`)), ref(ownerHistory), UNSET, UNSET, ref(storeys[i]!),
          list(...spaceEntities.map(ref))]);
    }
  }

  // ── distribution systems ──────────────────────────────────────────────────
  //
  // Emitted after every storey, since a system spans them: an IFCRELASSIGNS-
  // TOGROUP naming its segments and an IFCRELSERVICESBUILDINGS tying it to the
  // building it serves. This is the one piece of system topology the export
  // carries -- there is no upstream/downstream ordering, no ports and no
  // connectivity, because the document holds none.
  for (const [key, system] of [...systems.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const entity = w.entity("IFCDISTRIBUTIONSYSTEM", [
      str(ifcGuid(seed, `system:${key}`)), ref(ownerHistory), str(system.name), UNSET, UNSET,
      UNSET, enumv(system.predefined),
    ]);
    w.entity("IFCRELASSIGNSTOGROUP", [
      str(ifcGuid(seed, `system:${key}:members`)), ref(ownerHistory), UNSET, UNSET,
      list(...system.segments.map(ref)), UNSET, ref(entity),
    ]);
    w.entity("IFCRELSERVICESBUILDINGS", [
      str(ifcGuid(seed, `system:${key}:serves`)), ref(ownerHistory), UNSET, UNSET,
      ref(entity), list(ref(building)),
    ]);
  }

  return renderStepFile(w.data, meta.author ?? "", nowMs);
}

const FILENAME = "floorplan.ifc";

export async function exportIfc(doc: PlanDoc): Promise<IfcResult> {
  const text = toIfc(doc);
  if (await saveViaHost(FILENAME, () => text)) return "saved";
  if (downloadBlob(FILENAME, new Blob([text], { type: "application/x-step" }))) return "saved";
  return "failed";
}
