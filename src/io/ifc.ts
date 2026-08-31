// IFC export: the plan as an ISO 10303-21 STEP physical file.
//
// BIM 3 built the spatial spine: project → site → building → storeys. BIM 4
// hung building elements off it: one IFCWALL per resolved wall body, one
// IFCOPENINGELEMENT (IFCRELVOIDSELEMENT'd to its wall) per opening, and an
// IFCDOOR/IFCWINDOW (IFCRELFILLSELEMENT'd to its opening) for door and window
// kinds — a passage stays a bare voided hole. This is BIM 5, which adds one
// IFCSPACE per detected room, IFCRELAGGREGATES'd (not contained — a space is
// a spatial element, not a building element) under its storey, each carrying
// a Qto_SpaceBaseQuantities with the document's own area figure.
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
  PlanDoc, Floor, projectOf, floorElevation, floorHeight, areaModeOf, dimModeOf, DimMode, Sash, sashSpecsOf,
  openingHeight,
} from "../model/doc";
import { ifcGuid } from "../model/guid";
import { floorSolids } from "../core/solids";
import { detectRooms, roomSize, sizeLabel, Room } from "../core/rooms";
import { Vec, add, sub, scale, norm, perp, len, mid } from "../geometry/vec";
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

export const UNSET: IfcArg = { k: "unset" };
export const DERIVED: IfcArg = { k: "derived" };
export const ref = (id: number): IfcArg => ({ k: "ref", id });
export const str = (v: string): IfcArg => ({ k: "str", v });
export const real = (v: number): IfcArg => ({ k: "real", v });
export const int = (v: number): IfcArg => ({ k: "int", v });
export const enumv = (v: string): IfcArg => ({ k: "enum", v });
export const list = (...v: IfcArg[]): IfcArg => ({ k: "list", v });
export const typed = (t: string, ...v: IfcArg[]): IfcArg => ({ k: "typed", t, v });

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

// ── the spine ────────────────────────────────────────────────────────────────

/**
 * The plan as an IFC4 spatial spine: project, site, building, one storey per
 * floor (bottom-up, matching floors[0] = ground), aggregated together.
 *
 * Always succeeds — every document has at least one floor (see emptyDoc()),
 * so there is no "empty" export result the way DXF has for a floor with no
 * geometry.
 */
export function toIfc(doc: PlanDoc): string {
  const seed = doc.guid ?? "";
  const meta = projectOf(doc);
  const nowMs = Date.now();
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

  /** IFCPRODUCTDEFINITIONSHAPE wrapping a 'Body'/'SweptSolid' representation
   *  of the given solids, or $ when there is nothing to show. */
  function bodyShape(solidIds: readonly (number | null)[]): IfcArg {
    const ids = solidIds.filter((id): id is number => id !== null);
    if (ids.length === 0) return UNSET;
    const rep = w.entity("IFCSHAPEREPRESENTATION",
      [ref(context), str("Body"), str("SweptSolid"), list(...ids.map(ref))]);
    const pds = w.entity("IFCPRODUCTDEFINITIONSHAPE", [UNSET, UNSET, list(ref(rep))]);
    return ref(pds);
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
    const fs = floorSolids(doc, i);
    if (!fs) continue; // no walls on this storey at all — nothing to place

    // Identity placement relative to the storey: floorSolids() already
    // returns absolute plan coordinates, so every element on this storey
    // shares one relative placement rather than each carrying its own offset.
    const levelPlacement = w.entity("IFCLOCALPLACEMENT", [ref(storeyPlacements[i]!), ref(worldPlacement)]);
    const contained: number[] = []; // walls + door/window fillers; NOT openings

    for (const ws of fs.walls) {
      const wall = floor.walls.find(x => x.id === ws.wallId)!;
      const bodyIds = ws.body.map(p => extrudedSolid(p.poly, p.z0, p.z1));
      const wallEntity = w.entity("IFCWALL",
        [str(ifcGuid(seed, wall.id)), ref(ownerHistory), str(`Wall ${wall.thickness}`), UNSET, UNSET,
          ref(levelPlacement), bodyShape(bodyIds), UNSET, UNSET]);
      contained.push(wallEntity);

      for (const og of ws.voids) {
        const opening = wall.openings.find(o => o.id === og.openingId)!;
        const name = opening.kind[0]!.toUpperCase() + opening.kind.slice(1);
        const openingEntity = w.entity("IFCOPENINGELEMENT",
          [str(ifcGuid(seed, opening.id)), ref(ownerHistory), str(name), UNSET, UNSET, ref(levelPlacement),
            bodyShape([extrudedSolid(og.poly, og.z0, og.z1)]), UNSET, UNSET]);
        w.entity("IFCRELVOIDSELEMENT",
          [str(ifcGuid(seed, `${opening.id}:void`)), ref(ownerHistory), UNSET, UNSET,
            ref(wallEntity), ref(openingEntity)]);

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
        }
      }
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
    for (const r of detectRooms(floor)) {
      const key = spaceKey(floor, r);
      const spaceEntity = w.entity("IFCSPACE",
        [str(ifcGuid(seed, key)), ref(ownerHistory), spaceName(r, dim), UNSET, UNSET, ref(levelPlacement),
          bodyShape([extrudedSolid(r.netPoly, 0, fh)]), UNSET, enumv("ELEMENT"), enumv("INTERNAL"), UNSET]);
      spaceEntities.push(spaceEntity);

      // NetFloorArea on the document's own declared basis (areaModeOf), not
      // a claim of NEN 2580 conformance — MethodOfMeasurement stays $.
      const areaMm2 = areaModeOf(doc) === "net" ? r.netAreaMm2 : r.areaMm2;
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

  return renderStepFile(w.data, meta.author ?? "", nowMs);
}

const FILENAME = "floorplan.ifc";

export async function exportIfc(doc: PlanDoc): Promise<IfcResult> {
  const text = toIfc(doc);
  if (await saveViaHost(FILENAME, () => text)) return "saved";
  if (downloadBlob(FILENAME, new Blob([text], { type: "application/x-step" }))) return "saved";
  return "failed";
}
