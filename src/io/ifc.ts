// IFC export: the plan's spatial spine as an ISO 10303-21 STEP physical file.
//
// This is BIM 3 of the roadmap: project → site → building → storeys, with no
// building elements yet (walls etc. follow in later issues). The writer is
// structured so an element only has to add its own IFCLOCALPLACEMENT (relative
// to its storey's) and an IFCRELCONTAINEDINSPATIALSTRUCTURE entry — the spine
// itself does not change shape when that lands.
//
// Two conventions carried over from dxf.ts, for the same reasons:
//   * The document is y-down; IFC (and every viewer) is right-handed Z-up, so
//     the one place this matters here is TrueNorth, which is turned into an
//     IFCDIRECTION in IFC's own axes rather than the document's.
//   * Every stored length is already millimetres, so IFCSIUNIT states MILLI
//     rather than scaling coordinates — a 4000 mm wall must read as 4000, the
//     way it does in DXF's $INSUNITS.
//
// GlobalIds are derived, not random: ifcGuid(doc.guid, id) in model/guid.ts,
// so re-exporting the same document keeps every element's identity and two
// documents' ids cannot collide.
import { PlanDoc, projectOf, floorElevation } from "../model/doc";
import { ifcGuid } from "../model/guid";
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

  const storeys = doc.floors.map((floor, i) => {
    const elevation = floorElevation(doc, i);
    const pt = w.entity("IFCCARTESIANPOINT", [list(real(0), real(0), real(elevation))]);
    const placement3d = w.entity("IFCAXIS2PLACEMENT3D", [ref(pt), UNSET, UNSET]);
    const storeyPlacement = w.entity("IFCLOCALPLACEMENT", [ref(buildingPlacement), ref(placement3d)]);
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

  return renderStepFile(w.data, meta.author ?? "", nowMs);
}

const FILENAME = "floorplan.ifc";

export async function exportIfc(doc: PlanDoc): Promise<IfcResult> {
  const text = toIfc(doc);
  if (await saveViaHost(FILENAME, () => text)) return "saved";
  if (downloadBlob(FILENAME, new Blob([text], { type: "application/x-step" }))) return "saved";
  return "failed";
}
