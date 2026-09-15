// Published JSON Schema and the validator used by tests. Runtime enums are
// imported from their source, and document objects reject unknown properties.
import { SYMBOL_TYPES } from "../../src/render/symbols";
import { STAIR_KINDS, STAIR_USES } from "../../src/model/stair";
import { STAIR_FIGURES } from "../../src/core/stair";
import { COLUMN_SHAPES, STRUCTURE_LIMITS } from "../../src/model/structure";
import { WALL_MATERIALS } from "../../src/model/doc";
import {
  DISCIPLINES, ROUTE_KINDS, ROUTE_WATERS, ROUTE_HEATS, ROUTE_VENTS, ROUTE_INSTALLATIONS,
} from "../../src/model/route";

export type JsonSchema = Record<string, unknown>;

/** Sash actions, cross-checked against named window and door kinds by tests. */
export const SASH_ACTIONS = [
  "fixed", "turn", "tilt", "turn-tilt", "pivot", "tumble", "project", "parallel",
  "double-acting", "overhead", "slide", "slide-vertical", "turn-slide", "fold", "revolve",
] as const;

const mm = (description: string): JsonSchema => ({ type: "integer", description });

export function planSchema(siteUrl: string): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...(siteUrl ? { $id: `${siteUrl}/wallgraph.schema.json` } : {}),
    title: "Wallgraph plan document",
    description:
      "A floorplan as a planar graph of wall centerlines. Every stored coordinate and " +
      "length is an integer number of millimetres, and y points down, matching the " +
      "canvas. Nothing derived is stored: wall faces, mitred corners, room polygons and " +
      "areas are all recomputed from this graph when the plan is drawn.",
    type: "object",
    required: ["version", "unit", "gridMm", "floors"],
    additionalProperties: false,
    properties: {
      version: { const: 1, description: "Document format version. Only 1 exists." },
      unit: { const: "mm", description: "Stored unit. Always millimetres." },
      gridMm: { type: "integer", minimum: 1, description: "Grid spacing in mm. 100 by default." },
      areaMode: {
        enum: ["net", "centerline", "bvo"],
        description:
          "Which convention reported room areas use. 'net' is inner wall faces (NEN 2580) " +
          "and is the default when absent; 'centerline' is hart-op-hart; 'bvo' is the gross " +
          "area, measured to the outer face of the facade where a bounding wall has one and " +
          "to the centreline where it does not, which is what NEN 2580 says about a party " +
          "wall. On a plan whose walls carry no facadeMm, 'bvo' equals 'centerline'.",
      },
      dimMode: {
        enum: ["centerline", "clear", "both"],
        description:
          "Which convention the drawn dimensions use. 'centerline' is hart-op-hart and is " +
          "the default when absent; 'clear' measures face to face (dagmaat); 'both' draws " +
          "each as its own chain.",
      },
      mountMarks: {
        type: "boolean",
        description:
          "Write each device's mounting height beside it, in mm above the finished " +
          "floor. Absent means off: a plattegrond is not an installatietekening until " +
          "the drawing says so. The figure itself is derived -- a symbol's own height " +
          "if it states one, otherwise the conventional height for its type.",
      },
      project: {
        type: "object",
        additionalProperties: false,
        description:
          "Title-block data for the permit sheet export. All fields are authored and " +
          "optional; absent fields render as empty cells.",
        properties: {
          name: { type: "string", description: "Project name as the title block states it." },
          address: { type: "string", description: "Site address." },
          number: { type: "string", description: "Drawing number (tekeningnummer)." },
          author: { type: "string", description: "Who drew it (getekend)." },
          date: { type: "string", description: "Date as written on the sheet. Absent means the export date." },
        },
      },
      northDeg: {
        type: "integer", minimum: 0, maximum: 359,
        description:
          "Where north points: degrees clockwise from screen-up. Absent means the " +
          "direction has not been stated and no north arrow is drawn.",
      },
      guid: {
        type: "string", pattern: "^[0-9a-f]{32}$",
        description:
          "Per-document seed for IFC GlobalIds: combined with each element's own id, " +
          "it keeps identities stable across re-exports and keeps two documents from " +
          "colliding. Absent on documents written before this existed.",
      },
      groundMm: {
        type: "integer",
        description:
          "Elevation of the ground floor (floors[0]) above project zero (Peil), mm. " +
          "May be negative. Absent means 0.",
      },
      energy: {
        type: "object",
        additionalProperties: false,
        description:
          "Document-level thermal defaults for the BENG geometry takeoff, applied to an " +
          "envelope wall (one stating a facade) and its openings where the wall or opening " +
          "states no figure of its own. Absent means no default is stated. All fields are " +
          "indicative and reported, never enforced.",
        properties: {
          wallRc: {
            type: "number", exclusiveMinimum: 0,
            description: "Default thermal resistance Rc for an envelope wall stating none of its own, m²K/W.",
          },
          roofRc: {
            type: "number", exclusiveMinimum: 0,
            description: "Default Rc for the roof (the top storey's plate; no roof object exists), m²K/W.",
          },
          floorRc: {
            type: "number", exclusiveMinimum: 0,
            description: "Default Rc for the ground floor plate, m²K/W.",
          },
          windowU: {
            type: "number", exclusiveMinimum: 0,
            description: "Default thermal transmittance U for windows and glazed doors in an envelope wall, W/m²K.",
          },
          doorU: {
            type: "number", exclusiveMinimum: 0,
            description: "Default U for other doors and passages in an envelope wall, W/m²K.",
          },
        },
      },
      materials: {
        type: "object",
        additionalProperties: false,
        description:
          "Document-level assumptions for the wall material takeoff: stock lengths, saw " +
          "kerf, waste allowance and lining sheet size. Absent means the trade defaults " +
          "apply. All fields are indicative and reported, never enforced.",
        properties: {
          stockMm: {
            type: "array", items: { type: "integer", exclusiveMinimum: 0 },
            description:
              "Stock lengths timber is bought in, mm. Cleaned to positive integers, " +
              "deduplicated and sorted before use; the default list applies when absent " +
              "or empty after cleaning.",
          },
          kerfMm: {
            type: "number", minimum: 0,
            description: "Saw kerf charged per cut when nesting pieces into stock lengths, mm.",
          },
          wastePct: {
            type: "number", minimum: 0,
            description: "Waste allowance applied to sheet and block quantities, percent.",
          },
          sheetMm: {
            type: "object", additionalProperties: false,
            required: ["width", "height"],
            description: "Board sheet the lining is cut from, mm.",
            properties: {
              width: { type: "integer", exclusiveMinimum: 0 },
              height: { type: "integer", exclusiveMinimum: 0 },
            },
          },
        },
      },
      continuations: {
        type: "array", items: { $ref: "#/$defs/routeContinuation" },
        description:
          "Vertical service links between route endpoints on different storeys. " +
          "Absent means the plan has no cross-floor service continuity.",
      },
      floors: {
        type: "array", minItems: 1, items: { $ref: "#/$defs/floor" },
        description: "Storeys, lowest first. The floor below draws as a tracing underlay.",
      },
    },
    $defs: {
      id: { type: "string", minLength: 1, description: "Unique within the document." },
      fireRating: {
        type: "object",
        required: ["kind", "minutes"],
        additionalProperties: false,
        description: "A Dutch fire-resistance rating.",
        properties: {
          kind: {
            enum: ["wbdbo", "wbd", "wrd"],
            description:
              "wbdbo: weerstand tegen branddoorslag en brandoverslag, the Bouwbesluit " +
              "figure for a door in a compartment wall. wbd: branddoorslag alone. " +
              "wrd: weerstand tegen rookdoorgang.",
          },
          minutes: { type: "integer", minimum: 0 },
        },
      },
      floor: {
        type: "object",
        required: ["id", "name", "nodes", "walls", "symbols"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          name: { type: "string" },
          nodes: { type: "array", items: { $ref: "#/$defs/node" } },
          walls: { type: "array", items: { $ref: "#/$defs/wall" } },
          symbols: { type: "array", items: { $ref: "#/$defs/symbol" } },
          height: {
            type: "integer", minimum: 1,
            description:
              "Storey height in mm, floor to floor. Stairs on this floor climb it unless " +
              "they state a rise of their own. Absent means 2800.",
          },
          ceilingMm: {
            type: "integer", minimum: 1,
            description:
              "Finished ceiling height in mm above this storey's floor, where a suspended " +
              "ceiling has been dropped under the slab. A finish and nothing else: it " +
              "changes no stair, no space and no area, only the wall FACE area reported " +
              "by core/surface.ts. A figure at or above the storey height states nothing " +
              "and is ignored. Absent means none, so a face is finished floor to floor.",
          },
          stairs: {
            type: "array", items: { $ref: "#/$defs/stair" },
            description: "Placed stairs. Absent means the storey has none.",
          },
          vides: {
            type: "array", items: { $ref: "#/$defs/vide" },
            description: "Openings in this floor's slab. Absent means the storey has none.",
          },
          decks: {
            type: "array", items: { $ref: "#/$defs/deck" },
            description: "Timber floors placed on this storey. Absent means the storey has none.",
          },
          structure: {
            type: "array", items: { $ref: "#/$defs/structural" },
            description:
              "Load-bearing and guarding elements that are not walls: columns, beams and " +
              "railings, each a placed object with its own figures. None enters the wall " +
              "graph. Absent means the storey has none.",
          },
          furnishings: {
            type: "array", items: { $ref: "#/$defs/furnishing" },
            description:
              "What the storey is fitted out with: cabinetry, appliances, sanitary " +
              "fixtures and furniture. Absent means the storey has none.",
          },
          routes: {
            type: "array", items: { $ref: "#/$defs/route" },
            description:
              "Manually drawn service runs -- electrical, water, ventilation -- as " +
              "switchable layers over the plan. Absent means the storey has none.",
          },
          roomNames: {
            type: "array", items: { $ref: "#/$defs/roomName" },
            description:
              "What the rooms are called. Rooms themselves are derived from the wall " +
              "graph, so only the name and the point it was written at are stored.",
          },
          underlay: {
            $ref: "#/$defs/underlay",
            description:
              "A trace-over image for this floor. Absent means none loaded. Stripped " +
              "from every floor before a document is encoded into a share-link URL " +
              "fragment (see io/link.ts's encodePlan) -- a share link carries the " +
              "drawing, not the scan. JSON export/import keeps it verbatim.",
          },
          roofPlanes: {
            type: "array", items: { $ref: "#/$defs/roofPlane" },
            description:
              "This storey's roof, as authored planes -- a flat roof is one plane with " +
              "no pitch. Authored, not derived from the walls or their own top profiles. " +
              "Absent means the storey states none.",
          },
        },
      },
      node: {
        type: "object",
        description: "A junction. Walls meet here; corners are derived from the meeting.",
        required: ["id", "x", "y"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          x: mm("mm, positive to the right."),
          y: mm("mm, positive DOWN — world space matches the canvas."),
        },
      },
      wall: {
        type: "object",
        description: "A centerline edge between two nodes, with a thickness.",
        required: ["id", "a", "b", "thickness", "bulge", "openings"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          a: { $ref: "#/$defs/id", description: "Start node id." },
          b: { $ref: "#/$defs/id", description: "End node id." },
          thickness: { type: "integer", minimum: 1, description: "mm. 100 interior, 300 exterior by default." },
          bulge: {
            type: "number",
            description:
              "DXF bulge, tan(theta/4): 0 is straight, positive bows toward perp(a->b), " +
              "which under y-down is the clockwise visual side. Required — omitting it " +
              "does not mean straight, it means the arc maths sees NaN.",
          },
          openings: { type: "array", items: { $ref: "#/$defs/opening" } },
          height: {
            type: "integer", minimum: 1,
            description: "mm, floor to floor. Absent means the storey height.",
          },
          loadBearing: {
            type: "boolean",
            description:
              "Authored and tri-state: absent means not stated, distinct from false.",
          },
          fireRating: { $ref: "#/$defs/fireRating", description: "A fire compartment wall's rating." },
          material: {
            enum: [...WALL_MATERIALS],
            description:
              "What the body is built of; a single material, not a build-up. Absent means " +
              "not stated, distinct from \"masonry\". \"glass\" and \"sandwich\" are infill and " +
              "change the drawing: the body is drawn as a light band between its two faces " +
              "rather than as poche. The rest draw as poche and carry the name to IFC.",
          },
          postMm: {
            type: "integer", minimum: 1,
            description:
              "Post (stijl) centres, mm — the frame the body is carried on, whether those " +
              "members are the mullions of a curtain wall, the columns of a steel portal " +
              "frame or the studs of a timber wall. How this spacing is set out is " +
              "postLayout. Absent means no frame is drawn.",
          },
          postLayout: {
            enum: ["even", "grid"],
            description:
              "How posts are set out along postMm. \"even\": each run of body between " +
              "openings is divided into equal bays no wider than postMm, so a door pushes " +
              "the posts of its own run aside instead of one landing in the doorway -- right " +
              "for a glass wall or a column run. \"grid\": fixed centres of postMm from " +
              "postFrom, carried across openings and stacked bands alike, with a shorter " +
              "last gap -- what a timber or steel stud frame is actually set out at. Absent " +
              "means \"grid\" on a timber or steel wall and \"even\" otherwise.",
          },
          postFrom: {
            enum: ["a", "b"],
            description:
              "The end a \"grid\" postLayout is set out from. Absent means \"a\". Ignored by " +
              "\"even\".",
          },
          postOffsetMm: {
            type: "integer", minimum: 0,
            description:
              "Phase of a \"grid\" postLayout, mm: the grid stands at postOffsetMm + " +
              "k*postMm from postFrom's own end. Absent means 0 -- the plain postMm, " +
              "2*postMm, ... grid a plan is drawn with. A non-zero value only ever arises " +
              "from splitting or merging a grid wall, to keep the far half's studs at the " +
              "same physical positions the whole wall's did.",
          },
          postWidthMm: {
            type: "integer", minimum: 1,
            description:
              "A post's own width along the wall, mm; its depth is the wall thickness. " +
              "Absent means the centres are stated and the section is not, and the post is " +
              "drawn as a line. Ignored without postMm, and never drawn wider than its bay.",
          },
          facadeMm: {
            type: "integer", minimum: 1,
            description:
              "Cladding outside the structural body, mm. `thickness` stays the STRUCTURE: a " +
              "sandwich wall built 100 + 100 is thickness 100 with facadeMm 100. A skin, not " +
              "a build-up — it lies wholly outside the structural faces, so it changes neither " +
              "the wall graph, room detection nor the net area. It does set the gross area, " +
              "which is measured to its outer face (see areaMode \"bvo\"). Absent means none.",
          },
          facadeSide: {
            enum: ["left", "right"],
            description:
              "Which side of the wall's own a->b direction the facade is on; \"left\" is " +
              "+perp(tangent), the clockwise visual side. Absent means \"left\". Stored rather " +
              "than derived from which side the rooms are on, because that probe flips as soon " +
              "as a wall is redrawn.",
          },
          color: {
            type: "string", pattern: "^#[0-9a-fA-F]{6}$",
            description:
              "Pen colour; absent means the plan's default masonry ink. States the status of " +
              "the work the way a verbouwtekening does, and takes the fill, not just the outline.",
          },
          rc: {
            type: "number", exclusiveMinimum: 0,
            description:
              "Thermal resistance Rc of the whole construction, m²K/W. Absent means not " +
              "stated; the document's energy.wallRc default then applies, but only to a wall " +
              "that states a facade.",
          },
          lining: {
            type: "object",
            description:
              "Board lining on the wall's interior faces, outside the structural faces like " +
              "facadeMm. Absent means unlined; a face carrying the facade is never lined.",
            required: ["boardMm", "layers"],
            additionalProperties: false,
            properties: {
              boardMm: { type: "integer", minimum: 6, maximum: 30, description: "One board's thickness, mm." },
              layers: { type: "integer", minimum: 1, maximum: 3, description: "Layers of board." },
            },
          },
          blockMm: {
            type: "object",
            description:
              "Block format of a block-built body (cellenbeton, kalkzandsteen); its depth is " +
              "the wall's thickness. Only meaningful on a block material.",
            required: ["length", "height"],
            additionalProperties: false,
            properties: {
              length: { type: "integer", minimum: 100, maximum: 1000, description: "mm." },
              height: { type: "integer", minimum: 50, maximum: 600, description: "mm." },
            },
          },
          noggingRows: {
            type: "integer", minimum: 0, maximum: 5,
            description: "Rows of noggings (klossen) between the posts of a framed wall. Only meaningful with postMm.",
          },
          insulated: { type: "boolean", description: "The cavity of a framed wall is filled with insulation. Takeoff only." },
          panelMm: {
            type: "integer", minimum: 300, maximum: 3000,
            description: "Panel width along the wall for a sandwich body, mm. Absent means not stated.",
          },
          profile: {
            type: "array", items: { $ref: "#/$defs/profilePoint" },
            description:
              "Top of the wall along its length, for a wall under a pitched roof: a gable " +
              "end peaks under the ridge, a wall under a lean-to rises from eave to top. " +
              "Linear between points; the wall's own height anchors the ends where no point " +
              "states one there, so a single point at the ridge is enough for a gable. " +
              "Absent or empty means flat at the wall's own height. The plan is a section at " +
              "a fixed height, so this never changes it.",
          },
          frameBreaksMm: {
            type: "array", items: { type: "integer" },
            description:
              "A framed wall built as more than one stacked frame: heights above this " +
              "storey's floor, mm, ascending, where the frame breaks -- a loft wall standing " +
              "on the frame below it, say. Absent or empty means one frame, floor to top. " +
              "Every band below the last has its own flat top at its break height; only the " +
              "last band follows `profile`. A break is a double plate. Only meaningful with " +
              "postMm.",
          },
        },
      },
      opening: {
        type: "object",
        description:
          "A hole in one wall, parameterised along it. Openings are never nodes in the " +
          "graph: moving the wall moves its doors, and the hole is carved when drawn.",
        required: ["id", "kind", "t", "width", "sashes"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          kind: { enum: ["door", "window", "passage"] },
          t: mm("Centre of the opening, measured from node a along the centerline, mm."),
          width: { type: "integer", minimum: 1, description: "mm across the wall opening." },
          sashes: {
            type: "array", items: { $ref: "#/$defs/sash" },
            description: "Panes across the opening in a->b order. Empty for a passage.",
          },
          glazed: { type: "boolean", description: "Glazed leaf — drawn as a thin double line." },
          powered: { type: "boolean", description: "Electrically operated." },
          selfClosing: { type: "boolean", description: "Self-closing, as a fire door must be." },
          fireRating: { $ref: "#/$defs/fireRating", description: "A double door has one rating, not two." },
          sillHeight: mm(
            "mm above the floor. Only meaningful for a window; absent means 900 " +
            "(borstwering) for a window, 0 for a door or passage.",
          ),
          height: mm(
            "mm. Absent means the kind's default: 2315 for a door or passage " +
            "(binnendeurkozijn dagmaat), 1415 for a window.",
          ),
          uValue: {
            type: "number", exclusiveMinimum: 0,
            description:
              "Thermal transmittance U of the whole element (frame and leaf), W/m²K. " +
              "Absent means not stated; the document's energy.windowU or energy.doorU default " +
              "then applies, but only within a wall that states a facade.",
          },
        },
      },
      profilePoint: {
        type: "object",
        description: "One stated height along a wall's top, positioned like an opening.",
        required: ["t", "height"],
        additionalProperties: false,
        properties: {
          t: mm("Distance from node a along the centerline, mm."),
          height: mm("mm above this storey's floor."),
        },
      },
      sash: {
        type: "object",
        description: "One movable (or fixed) pane within an opening.",
        required: ["action"],
        additionalProperties: false,
        properties: {
          width: { type: "integer", minimum: 0, description: "mm. Omit to share what is left equally." },
          action: { enum: [...SASH_ACTIONS] },
          hinge: {
            enum: ["a", "b", "head", "sill"],
            description: "'a'/'b' are the jambs; 'head'/'sill' are horizontal and invisible in plan.",
          },
          outward: { type: "boolean", description: "true = naar buiten draaiend, drawn solid; absent = inward, dashed." },
          slideTo: { enum: ["a", "b"] },
          spin: { enum: ["cw", "ccw"], description: "Revolving doors only." },
          bars: { type: "integer", minimum: 0, description: "Roedeverdeling: panes per sash. 0 or absent = undivided." },
        },
      },
      vide: {
        type: "object",
        description:
          "A vide: an opening in the floor slab, open to the storey below. It is a feature " +
          "of this floor rather than a storey of its own -- the slab has a hole, and the " +
          "plan of this storey is where it is drawn. A trapgat is the same object. The " +
          "anchor (x, y) is the centre of the opening.",
        required: ["id", "x", "y", "rotation", "width", "depth"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          x: mm("mm."),
          y: mm("mm, positive down."),
          rotation: { type: "number", description: "Radians, clockwise on screen." },
          width: { type: "integer", minimum: 200, description: "mm." },
          depth: { type: "integer", minimum: 200, description: "mm." },
          label: { type: "string", description: "What the opening is called on the drawing. Absent means the plain word." },
          color: {
            type: "string", pattern: "^#[0-9a-fA-F]{6}$",
            description: "Pen colour; absent means the plan's default ink.",
          },
        },
      },
      deck: {
        type: "object",
        description:
          "A timber floor: a balklaag between its supports, or a loft (vliering, entresol) at " +
          "a height inside the storey. The anchor (x, y) is the centre of the platform; the " +
          "box is the clear span between the supports, and each joist bears `bearingMm` " +
          "beyond it at both ends. Joists are set out from both edges in equal bays no wider " +
          "than `joistMm`. Loads are reported, never checked.",
        required: ["id", "x", "y", "rotation", "width", "depth", "joistAxis", "joistMm"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          x: mm("mm."),
          y: mm("mm, positive down."),
          rotation: { type: "number", description: "Radians, clockwise on screen." },
          width: { type: "integer", minimum: 300, maximum: 20000, description: "mm." },
          depth: { type: "integer", minimum: 300, maximum: 20000, description: "mm." },
          joistAxis: {
            enum: ["x", "y"],
            description: "Joists run along local x (span = width) or local y (span = depth).",
          },
          joistMm: { type: "integer", minimum: 200, maximum: 1200, description: "Joist centres, mm." },
          joist: {
            type: "object", additionalProperties: false, required: ["w", "d"],
            description: "Joist section, mm. Absent means not stated; the takeoff reports it incomplete.",
            properties: {
              w: { type: "integer", minimum: 30, maximum: 400 },
              d: { type: "integer", minimum: 30, maximum: 400 },
            },
          },
          bearingMm: {
            type: "integer", minimum: 50, maximum: 300,
            description: "Bearing at each joist end, mm. Absent means 100.",
          },
          deckingMm: {
            type: "integer", exclusiveMinimum: 0, maximum: 50,
            description: "Decking sheet thickness, mm. Absent means no decking counted.",
          },
          topMm: {
            type: "integer", minimum: 0,
            description:
              "Top of the deck above this storey's floor, mm. Absent means the storey's own " +
              "floor: an ordinary balklaag. A loft states one.",
          },
          loadG: {
            type: "integer", minimum: 0,
            description: "Permanent load, N/m². Absent means not stated.",
          },
          loadQ: {
            type: "integer", minimum: 0,
            description: "Variable load, N/m². Absent means not stated.",
          },
          label: { type: "string", description: "What the deck is called on the drawing. Absent means the plain word." },
          color: {
            type: "string", pattern: "^#[0-9a-fA-F]{6}$",
            description: "Pen colour; absent means the plan's default ink.",
          },
        },
      },
      roofPlane: {
        type: "object",
        description:
          "One roof plane: its own outline in plan, the height of its low edge (the " +
          "eave) and its pitch. A flat roof is one plane with pitchDeg 0. The underside " +
          "at a point is eaveMm plus the distance from the (infinite) eave line, measured " +
          "into the outline, times tan(pitchDeg); where two planes' outlines overlap the " +
          "LOWEST underside applies, which is what lets a ridge or a hip come out right " +
          "without the planes having to meet exactly.",
        required: ["id", "outline", "eaveEdge", "eaveMm", "pitchDeg"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          outline: {
            type: "array", minItems: 3, items: { $ref: "#/$defs/point" },
            description: "Plan outline of this plane, integer mm, counter-clockwise under y-down like a room boundary.",
          },
          eaveEdge: {
            type: "integer", minimum: 0,
            description:
              "Index into `outline` of the eave edge -- the plane's low edge, running " +
              "from outline[eaveEdge] to the next point (wrapping).",
          },
          eaveMm: { type: "integer", minimum: 100, maximum: 20000, description: "Height of the eave above this storey's floor, mm." },
          pitchDeg: { type: "number", minimum: 0, maximum: 75, description: "Degrees, 0 (flat) to 75. Rises away from the eave edge, into the outline." },
          thicknessMm: {
            type: "integer", exclusiveMinimum: 0, maximum: 2000,
            description: "Structural roof build-up thickness, mm, measured square to the plane. Absent means not stated; 200 is the reported placeholder.",
          },
        },
      },
      structural: {
        description:
          "One structural element, told apart by `kind`. The section plane separates the " +
          "three on the drawing: a column is cut by it and hatched, a beam runs above it " +
          "and is dashed, a railing stands below it and is outlined.",
        oneOf: [{ $ref: "#/$defs/column" }, { $ref: "#/$defs/beam" }, { $ref: "#/$defs/railing" }],
      },
      column: {
        type: "object",
        description:
          "A column: a section standing on this storey's floor. The anchor (x, y) is the " +
          "centre of the section. `width` runs along the column's local x and `depth` along " +
          "local y; for an H-section that is the flange breadth and the profile height, the " +
          "way a steel table lists b and h. A round column reads `width` as its diameter.",
        required: ["id", "kind", "x", "y", "rotation", "shape", "width", "depth"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          kind: { const: "column" },
          x: mm("mm."),
          y: mm("mm, positive down."),
          rotation: { type: "number", description: "Radians, clockwise on screen." },
          shape: { enum: [...COLUMN_SHAPES] },
          width: { type: "integer", minimum: STRUCTURE_LIMITS.section.min, maximum: STRUCTURE_LIMITS.section.max, description: "mm." },
          depth: { type: "integer", minimum: STRUCTURE_LIMITS.section.min, maximum: STRUCTURE_LIMITS.section.max, description: "mm." },
          height: {
            type: "integer", minimum: STRUCTURE_LIMITS.height.min, maximum: STRUCTURE_LIMITS.height.max,
            description:
              "Where the column stops, mm above this storey's floor. Absent means the storey " +
              "height: the column carries the floor above. A column under a vide's edge " +
              "beam states its own. At or below 1200 it is not cut by the section plane " +
              "and is drawn in outline.",
          },
          label: { type: "string", description: "Designation written on the drawing. Absent means none." },
          color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Pen colour; absent means the plan's default ink." },
          material: { enum: [...WALL_MATERIALS], description: "Absent means not stated." },
        },
      },
      beam: {
        type: "object",
        description:
          "A beam between two free points. The endpoints are coordinates of its own rather " +
          "than graph nodes: a beam spans between whatever supports it, and moving a wall " +
          "does not move a beam resting on it. Drawn dashed: it runs above the section plane.",
        required: ["id", "kind", "a", "b", "width", "depth"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          kind: { const: "beam" },
          a: { $ref: "#/$defs/point" },
          b: { $ref: "#/$defs/point" },
          width: { type: "integer", minimum: STRUCTURE_LIMITS.section.min, maximum: STRUCTURE_LIMITS.section.max, description: "Breadth in plan, mm: a steel section's flange width." },
          depth: { type: "integer", minimum: STRUCTURE_LIMITS.beamDepth.min, maximum: STRUCTURE_LIMITS.beamDepth.max, description: "Section height, mm, vertical." },
          bottomMm: {
            type: "integer", minimum: 0, maximum: STRUCTURE_LIMITS.height.max,
            description:
              "Underside above this storey's floor, mm. Absent means the beam carries the " +
              "floor above: its top is at the storey height.",
          },
          label: { type: "string", description: "Designation written on the drawing, e.g. \"HEA 200\". Absent means none." },
          color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Pen colour; absent means the plan's default ink." },
          material: { enum: [...WALL_MATERIALS], description: "Absent means not stated." },
        },
      },
      railing: {
        type: "object",
        description:
          "A railing along a free edge: a vide, a landing, a stair. Drawn in outline: it " +
          "stands below the section plane.",
        required: ["id", "kind", "a", "b", "width", "height", "postMm"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          kind: { const: "railing" },
          a: { $ref: "#/$defs/point" },
          b: { $ref: "#/$defs/point" },
          width: { type: "integer", minimum: STRUCTURE_LIMITS.railWidth.min, maximum: STRUCTURE_LIMITS.railWidth.max, description: "Breadth in plan, mm: the handrail." },
          height: { type: "integer", minimum: STRUCTURE_LIMITS.railHeight.min, maximum: STRUCTURE_LIMITS.railHeight.max, description: "Height above the floor, mm." },
          postMm: { type: "integer", minimum: 0, maximum: STRUCTURE_LIMITS.post.max, description: "Post centres along the run, mm. 0 means no posts drawn." },
          label: { type: "string", description: "Designation written on the drawing. Absent means none." },
          color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Pen colour; absent means the plan's default ink." },
          material: { enum: [...WALL_MATERIALS], description: "Absent means not stated." },
        },
      },
      point: {
        type: "object",
        description: "A world point in integer mm, y positive down.",
        required: ["x", "y"],
        additionalProperties: false,
        properties: { x: mm("mm."), y: mm("mm, positive down.") },
      },
      route: {
        type: "object",
        description:
          "An authored building-service network -- electrical, water, ventilation or " +
          "gas -- as a switchable layer over the plan. Explicit point and segment ids " +
          "form a graph, so shared trunks are stored once and may branch. Segments use " +
          "the same DXF bulge convention as a wall's centerline.",
        required: ["id", "discipline", "points", "segments"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          discipline: { enum: [...DISCIPLINES] },
          points: {
            type: "array", minItems: 1, items: { $ref: "#/$defs/routePoint" },
            description:
              "The network nodes. A single point is a cross-floor starter awaiting a local segment.",
          },
          segments: {
            type: "array", items: { $ref: "#/$defs/routeSegment" },
            description: "Explicit graph edges. Shared trunks occur once and branch at point ids.",
          },
          tag: { type: "string", description: "Short identifier printed on the plan." },
          name: { type: "string", description: "Descriptive route/network name." },
          board: { type: "string", description: "Electrical distribution board identifier." },
          installation: { enum: [...ROUTE_INSTALLATIONS] },
          height: { type: "integer", minimum: 0, description: "Height above finished floor, mm." },
          kind: {
            enum: [...ROUTE_KINDS],
            description:
              "Electrical-only: what the run carries. Meaningful only when discipline " +
              "is \"electrical\"; a water or vent route ignores it. Absent means " +
              "\"power\", the ordinary case.",
          },
          veins: {
            type: "integer", minimum: 2, maximum: 8,
            description:
              "Aantal aders. Meaningful for power runs only (kind is \"power\" or " +
              "absent) -- a data run's pairs follow from `spec` instead. Absent means " +
              "3, the ordinary geschakelde/wandcontactdoos run.",
          },
          group: {
            type: "string",
            description:
              "Groep, as the meterkast labels it (\"1\", \"2\", \"K1\"). Meaningful for " +
              "power runs; a data run does not belong to a groep.",
          },
          spec: {
            type: "string",
            description: "Data-cable spec (\"Cat6\"). Meaningful for kind \"utp\" or \"coax\".",
          },
          water: {
            enum: [...ROUTE_WATERS],
            description:
              "Water-only: koud/warm/afvoer. Meaningful only when discipline is " +
              "\"water\"; an electrical or vent route ignores it. Absent means " +
              "\"koud\", the ordinary supply run.",
          },
          diameter: {
            type: "integer", minimum: 8, maximum: 200,
            description:
              "Water, heating or gas nominal pipe diameter, mm. Water defaults per " +
              "kind -- 15 for koud/warm, 50 for afvoer; heating defaults to 16; gas to 15.",
          },
          heat: {
            enum: [...ROUTE_HEATS],
            description:
              "Heating-only: which leg of the CV circuit. Meaningful only when " +
              "discipline is \"heating\". Absent means \"aanvoer\", the flow leg.",
          },
          vent: {
            enum: [...ROUTE_VENTS],
            description:
              "Vent-only: toevoer/afvoer. Meaningful only when discipline is \"vent\"; " +
              "an electrical or water route ignores it. Absent means \"toevoer\" " +
              "(supply air).",
          },
          ductDiameter: {
            type: "integer", minimum: 63, maximum: 400,
            description:
              "Vent-only: nominal duct diameter, mm. Meaningful only when discipline " +
              "is \"vent\". Absent means 125.",
          },
          flow: {
            type: "integer", minimum: 1,
            description:
              "Vent-only: design flow for this run, m3/h. Meaningful only when " +
              "discipline is \"vent\". Absent means not stated -- there is no default, " +
              "unlike every other optional field on a route.",
          },
        },
      },
      routePoint: {
        type: "object",
        description:
          "One network node. x/y are the fallback position. A symbol anchor or wall " +
          "attachment resolves dynamically, so connected services follow moved devices " +
          "and walls.",
        required: ["id", "x", "y"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          x: mm("mm."),
          y: mm("mm, positive down."),
          anchor: { $ref: "#/$defs/id", description: "A symbol instance id this point follows." },
          wallId: { $ref: "#/$defs/id", description: "Wall followed by this point." },
          wallT: mm("Distance from wall node a, mm."),
          wallSide: { enum: [-1, 1], description: "Wall face for surface-mounted work." },
          terminal: {
            enum: ["source", "capped", "external"],
            description:
              "Explicit state of a free endpoint. \"external\" is a riser leaving the " +
              "modelled storeys -- through the roof, into a crawl space, out to the " +
              "street -- stated rather than linked to a floor that is not in the document.",
          },
        },
      },
      routeSegment: {
        type: "object",
        required: ["id", "a", "b"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          a: { $ref: "#/$defs/id" },
          b: { $ref: "#/$defs/id" },
          bulge: { type: "number", description: "DXF bulge from point a toward point b." },
        },
      },
      routeContinuation: {
        type: "object",
        required: ["id", "ports"],
        additionalProperties: false,
        description: "One service continuing vertically through two or more storeys.",
        properties: {
          id: { $ref: "#/$defs/id" },
          tag: { type: "string", description: "Optional shaft/riser identifier." },
          ports: {
            type: "array", minItems: 2, items: { $ref: "#/$defs/routePort" },
            description: "Floor-local route endpoints belonging to this vertical continuation.",
          },
        },
      },
      routePort: {
        type: "object",
        required: ["floorId", "routeId", "pointId"],
        additionalProperties: false,
        properties: {
          floorId: { $ref: "#/$defs/id" },
          routeId: { $ref: "#/$defs/id" },
          pointId: { $ref: "#/$defs/id" },
        },
      },
      furnishing: {
        type: "object",
        description:
          "One thing the plan is fitted out with. Like a stair, it stores its dimensions " +
          "rather than being one fixed picture: the same unit is built 400, 600 or 800 " +
          "wide, a bath is 1700 or 1800 long, and the carcass, the front, the bowl and " +
          "the worktop overhang are derived from these numbers at render time. `form` " +
          "says which mark is drawn and which of the optional fields below are read; the " +
          "rest are ignored. The anchor (x, y) is the middle of the wall-touching edge " +
          "with +y into the room for a wall-mounted form, and the middle of the footprint " +
          "for a free-standing one.",
        required: ["id", "form", "x", "y", "rotation", "width", "depth"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          form: {
            enum: [
              "cabinet", "appliance", "counter",
              "toilet", "urinal", "urinal-trough", "bidet",
              "basin", "basin-trough", "bath", "shower", "shower-head",
              "bed", "seat", "table", "table-round", "desk", "rack",
            ],
            description:
              "What the piece is, and so which mark is drawn. Everything from \"cabinet\" " +
              "through \"shower-head\" stands against a wall; the rest stand free.",
          },
          x: mm("mm."),
          y: mm("mm, positive down."),
          rotation: { type: "number", description: "Radians, clockwise on screen." },
          mirrored: {
            type: "boolean",
            description:
              "Handedness. Flips a cabinet's hinge side, a corner unit's diagonal and a " +
              "worktop's drainer.",
          },
          width: { type: "integer", minimum: 100, maximum: 6000, description: "mm along the wall." },
          depth: { type: "integer", minimum: 100, maximum: 3000, description: "mm into the room." },
          height: {
            type: "integer", minimum: 50, maximum: 6000,
            description:
              "Height in mm, plinth and worktop excluded for a cabinet. Not drawn in " +
              "plan; absent means the form's usual figure. The ceiling is a warehouse " +
              "rack rather than a kitchen unit.",
          },
          kind: {
            enum: ["base", "wall", "tall"],
            description:
              "Cabinet height class. It decides how the unit meets the plan's section " +
              "plane at about 1200 mm: base is seen from above and tall is cut, both " +
              "drawn solid; wall is entirely overhead and drawn dashed. Read only when " +
              "form is \"cabinet\"; absent means base.",
          },
          front: {
            enum: ["door", "double", "drawers", "open", "slide"],
            description:
              "What closes a cabinet front. \"open\" is shelving with no front at all. " +
              "Read only when form is \"cabinet\"; absent means door.",
          },
          hinge: {
            enum: ["left", "right"],
            description:
              "Which side a single door is hung, as seen from the room facing the unit. " +
              "Absent means left.",
          },
          drawers: {
            type: "integer", minimum: 1, maximum: 8,
            description: "How many drawers the front is divided into. Read only when front is \"drawers\".",
          },
          corner: { type: "boolean", description: "Diagonal-front corner unit." },
          worktop: { type: "boolean", description: "Blad over the carcass, drawn as an overhang along the front." },
          mark: {
            enum: ["none", "cooktop", "oven", "microwave", "fridge", "freezer", "hood"],
            description:
              "Which toestel the appliance outline names. Read only when form is " +
              "\"appliance\"; absent means the generic fixed appliance. \"hood\" hangs above " +
              "the section plane and is drawn dashed.",
          },
          cistern: {
            enum: ["exposed", "concealed"],
            description: "Where a toilet's cistern sits. Read only when form is \"toilet\"; absent means exposed.",
          },
          rails: {
            type: "boolean",
            description: "Grab rails either side, the accessible toilet. Read only when form is \"toilet\".",
          },
          basins: {
            type: "integer", minimum: 1, maximum: 2,
            description: "How many bowls the run carries. Read only when form is \"basin\" or \"counter\".",
          },
          tray: {
            enum: ["none", "tray", "linear"],
            description:
              "What a shower stands in: the bare wet area, a tray, or a tray drained by " +
              "a goot. Read only when form is \"shower\"; absent means none.",
          },
          label: { type: "string", description: "What the piece is called on the drawing." },
          color: {
            type: "string", pattern: "^#[0-9a-fA-F]{6}$",
            description: "Pen colour; absent means the plan's default ink.",
          },
        },
      },
      underlay: {
        type: "object",
        description:
          "A raster image traced over while drawing this floor. mmPerPixel is a " +
          "ratio, not a length -- kept as a number rather than an integer, unlike " +
          "every stored coordinate elsewhere in this document.",
        required: ["dataUrl", "x", "y", "mmPerPixel", "opacity"],
        additionalProperties: false,
        properties: {
          dataUrl: {
            type: "string", pattern: "^data:image/",
            description: "The image, downscaled and re-encoded on import.",
          },
          x: mm("mm. Top-left corner of the image in world space."),
          y: mm("mm, positive down. Top-left corner of the image in world space."),
          mmPerPixel: {
            type: "number", exclusiveMinimum: 0,
            description: "World mm per image pixel.",
          },
          opacity: { type: "number", minimum: 0, maximum: 1, description: "0 (invisible) to 1 (opaque)." },
        },
      },
      roomName: {
        type: "object",
        description:
          "A room name: the word, and the point it was written at. Which room it names " +
          "is derived -- the room whose inner boundary contains the point takes it -- " +
          "because rooms are found by walking the wall graph and are not stored.",
        required: ["id", "x", "y", "name"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          x: mm("mm."),
          y: mm("mm, positive down."),
          name: { type: "string", minLength: 1 },
          use: {
            enum: ["verblijf", "verkeer", "sanitair", "techniek"],
            description:
              "What the room is used for. Rides on the name because it is the only " +
              "authored per-room anchor the document has. Absent means not stated, and " +
              "only \"verblijf\" (verblijfsruimte) carries the indicative workstation, " +
              "daylight-ratio and ventilation figures in core/fitout.ts.",
          },
          ceilingMm: {
            type: "integer", minimum: 1,
            description:
              "Finished ceiling height in mm above the floor, where this room has a " +
              "suspended ceiling of its own. Rides on the name for the reason \"use\" " +
              "does. Absent means not stated, and the storey's own ceiling answers " +
              "instead; a figure at or above the storey height states nothing and is " +
              "ignored. Like the storey's, it changes only the wall face area.",
          },
        },
      },
      stair: {
        type: "object",
        description:
          "A placed stair. Unlike a symbol it carries its own size: the same kind is " +
          "drawn 900 mm wide in a house and 1200 in a unit, and its tread count follows " +
          "the storey height. Everything drawn — treads, the walking line, the arrow, " +
          "the winder fan — is derived from these numbers. The anchor (x, y) is the " +
          "middle of the footprint's bottom edge and +y is the direction of ascent.",
        required: ["id", "kind", "x", "y", "rotation", "width", "going", "treads"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          kind: { enum: [...STAIR_KINDS], description: "One of the plan-symbol sheet's stair types." },
          x: mm("mm."),
          y: mm("mm, positive down."),
          rotation: { type: "number", description: "Radians, clockwise on screen." },
          mirrored: { type: "boolean", description: "Handedness: which way the stair's first turn goes." },
          counterTurn: {
            type: "boolean",
            description:
              "The second quarter turns against the first, so a stair with a quarter at " +
              "each end doglegs instead of coming back beside itself. Only onder-bovenkwart " +
              "turns twice; every other kind reads mirrored alone.",
          },
          width: { type: "integer", minimum: 200, description: "mm across the flight; for a spiral, newel to rim." },
          going: { type: "integer", minimum: 50, description: "mm per tread along the walking line (aantrede)." },
          treads: { type: "integer", minimum: 1, description: "Treads drawn." },
          rise: {
            type: "integer", minimum: 50,
            description:
              "mm climbed. Absent means the storey height of the floor the stair stands on, " +
              "which is the usual case; stating it overrides that, as a flight up to a " +
              "mezzanine beside a vide does. A hellingbaan never inherits. A flight of n " +
              "treads has n+1 risers, so the riser height and the walking rule follow from " +
              "this, as does the tread the section plane cuts.",
          },
          well: {
            type: "integer", minimum: 0,
            description:
              "The gap the kind opens: between the flights of a bordestrap, around the " +
              "newel of a spiltrap. Absent means the kind's own default, which is 0 for " +
              "kinds that open none.",
          },
          use: {
            enum: [...STAIR_USES],
            description:
              "The gebruiksfunctie the stair serves, which decides the ordinary figures it is " +
              `read against: a woonfunctie an optrede of at most ${STAIR_FIGURES.woonfunctie.riserMax} ` +
              `and an aantrede of at least ${STAIR_FIGURES.woonfunctie.goingMin} mm, any other use ` +
              `${STAIR_FIGURES.overig.riserMax} and ${STAIR_FIGURES.overig.goingMin}. Absent means not ` +
              "stated; the stair is then read against the widest margin of every set. Reported, " +
              "never enforced.",
          },
          color: {
            type: "string", pattern: "^#[0-9a-fA-F]{6}$",
            description: "Pen colour; absent means the plan's default ink.",
          },
        },
      },
      symbol: {
        type: "object",
        description: "A placed plan symbol. The anchor is (x, y); rotation is radians.",
        required: ["id", "type", "x", "y", "rotation"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          type: { enum: [...SYMBOL_TYPES], description: "One of the library's symbol ids." },
          x: mm("mm."),
          y: mm("mm, positive down."),
          rotation: { type: "number", description: "Radians, clockwise on screen." },
          mirrored: { type: "boolean" },
          wallId: { $ref: "#/$defs/id", description: "Set when the symbol is snapped to a wall." },
          color: {
            type: "string", pattern: "^#[0-9a-fA-F]{6}$",
            description:
              "Pen colour. Absent means the plan's default ink. Not decoration: a " +
              "verbouwtekening states existing work in black, new in red, removed in yellow.",
          },
          height: {
            type: "integer", minimum: 0,
            description:
              "Mounting height above this storey's finished floor, mm. Absent means the " +
              "conventional height for the symbol's type -- 300 for a wandcontactdoos, " +
              "1050 for a schakelaar, the storey height for a light point -- and a type " +
              "with no convention reads as not stated rather than as zero.",
          },
          board: { $ref: "#/$defs/board" },
        },
      },
      board: {
        type: "object",
        description:
          "What a groepenkast is called and the groepen it distributes. Only read for " +
          "symbol type \"dist-board\". Each groep is a connection point a run anchors " +
          "to, so a run's groep is the kast's own label rather than typed text.",
        required: ["groups"],
        additionalProperties: false,
        properties: {
          name: { type: "string", maxLength: 16, description: "What the drawing calls this kast." },
          groups: {
            type: "array", items: { $ref: "#/$defs/boardGroup" },
            description: "In the order the kast lists them; the order the plan fans them in.",
          },
        },
      },
      boardGroup: {
        type: "object",
        required: ["id", "name"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          name: { type: "string", maxLength: 16, description: "What the kast labels it: \"1\", \"K1\"." },
          label: { type: "string", description: "What it feeds. Absent means nobody said." },
        },
      },
    },
  };
}

/* ── validator ───────────────────────────────────────────────────────────────
 * Just the keywords the schema above uses. A real validator is a dependency,
 * and a dependency here would be the project's first — see the licensing
 * constraint. This exists so tests can prove the published schema accepts the
 * documents the editor actually writes; it is not offered to anyone else.
 */

type Ctx = { root: JsonSchema };

function resolve(ref: string, ctx: Ctx): JsonSchema {
  let node: unknown = ctx.root;
  for (const part of ref.replace(/^#\//, "").split("/")) {
    node = (node as Record<string, unknown>)[part];
  }
  return node as JsonSchema;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function check(schema: JsonSchema, value: unknown, path: string, ctx: Ctx, out: string[]): void {
  if (typeof schema.$ref === "string") {
    const merged = { ...resolve(schema.$ref, ctx) };
    // A $ref beside a description is how the schema annotates a reused type;
    // the annotation carries no constraint, so the target's rules are all of it.
    check(merged, value, path, ctx, out);
    return;
  }
  const bad = (msg: string): void => { out.push(`${path || "$"}: ${msg}`); };

  if ("const" in schema && value !== schema.const) bad(`expected ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.oneOf)) {
    const fits = (schema.oneOf as JsonSchema[]).filter(alt => {
      const errs: string[] = [];
      check(alt, value, path, ctx, errs);
      return errs.length === 0;
    }).length;
    if (fits !== 1) bad(`matches ${fits} of the oneOf alternatives`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    bad(`${JSON.stringify(value)} is not one of the allowed values`);
    return;
  }
  if (typeof schema.type === "string") {
    const actual = typeOf(value);
    const ok = schema.type === actual || (schema.type === "number" && actual === "integer");
    if (!ok) { bad(`expected ${schema.type}, got ${actual}`); return; }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) bad(`must be >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) bad(`must be <= ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      bad(`must be > ${schema.exclusiveMinimum}`);
    }
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) bad("is empty");
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      bad(`does not match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      bad(`needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items) value.forEach((v, i) => check(schema.items as JsonSchema, v, `${path}[${i}]`, ctx, out));
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) bad(`missing required property "${key}"`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) if (!(key in props)) bad(`unknown property "${key}"`);
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj && obj[key] !== undefined) check(sub, obj[key], `${path}.${key}`, ctx, out);
    }
  }
}

/** Every way `value` fails `schema`. Empty means it validates. */
export function validate(schema: JsonSchema, value: unknown): string[] {
  const out: string[] = [];
  check(schema, value, "", { root: schema }, out);
  return out;
}
