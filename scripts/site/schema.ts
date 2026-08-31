// Published JSON Schema and the validator used by tests. Runtime enums are
// imported from their source, and document objects reject unknown properties.
import { SYMBOL_TYPES } from "../../src/render/symbols";
import { STAIR_KINDS } from "../../src/model/stair";

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
        enum: ["net", "centerline"],
        description:
          "Which convention reported room areas use. 'net' is inner wall faces (NEN 2580) " +
          "and is the default when absent; 'centerline' is hart-op-hart.",
      },
      dimMode: {
        enum: ["centerline", "clear", "both"],
        description:
          "Which convention the drawn dimensions use. 'centerline' is hart-op-hart and is " +
          "the default when absent; 'clear' measures face to face (dagmaat); 'both' draws " +
          "each as its own chain.",
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
          stairs: {
            type: "array", items: { $ref: "#/$defs/stair" },
            description: "Placed stairs. Absent means the storey has none.",
          },
          vides: {
            type: "array", items: { $ref: "#/$defs/vide" },
            description: "Openings in this floor's slab. Absent means the storey has none.",
          },
          cabinets: {
            type: "array", items: { $ref: "#/$defs/cabinet" },
            description: "Placed cabinetry. Absent means the storey has none.",
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
      cabinet: {
        type: "object",
        description:
          "A cabinet. Like a stair, it stores its dimensions rather than being one fixed " +
          "picture: the same unit is built 400, 600 or 800 wide, and the carcass, the " +
          "front, the hinge mark and the worktop overhang are derived from these numbers " +
          "at render time. Cabinetry rather than kitchen furniture -- the same object is " +
          "a base unit, a wardrobe and an office cupboard. The anchor (x, y) is the " +
          "middle of the wall-touching edge, with +y into the room.",
        required: ["id", "kind", "x", "y", "rotation", "width", "depth", "front"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          kind: {
            enum: ["base", "wall", "tall"],
            description:
              "Height class. It decides how the unit meets the plan's section plane at " +
              "about 1200 mm: base is seen from above and tall is cut, both drawn solid; " +
              "wall is entirely overhead and drawn dashed.",
          },
          x: mm("mm."),
          y: mm("mm, positive down."),
          rotation: { type: "number", description: "Radians, clockwise on screen." },
          mirrored: { type: "boolean", description: "Handedness. Flips the hinge side and a corner unit's diagonal." },
          width: { type: "integer", minimum: 100, maximum: 3000, description: "mm along the wall." },
          depth: { type: "integer", minimum: 100, maximum: 1200, description: "mm into the room." },
          height: {
            type: "integer", minimum: 100, maximum: 3000,
            description:
              "Carcass height in mm, plinth and worktop excluded. Not drawn in plan; " +
              "absent means the height class's usual figure.",
          },
          front: {
            enum: ["door", "double", "drawers", "open", "slide"],
            description: "What closes the front. \"open\" is shelving with no front at all.",
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
          label: { type: "string", description: "What the unit is called on the drawing." },
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
