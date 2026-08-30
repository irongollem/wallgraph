// Published JSON Schema and the validator used by tests. Runtime enums are
// imported from their source, and document objects reject unknown properties.
import { SYMBOL_TYPES } from "../../src/render/symbols";

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
      floors: {
        type: "array", minItems: 1, items: { $ref: "#/$defs/floor" },
        description: "Storeys, lowest first. The floor below draws as a tracing underlay.",
      },
    },
    $defs: {
      id: { type: "string", minLength: 1, description: "Unique within the document." },
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
        },
      },
      opening: {
        type: "object",
        description:
          "A hole in one wall, parameterised along it. Openings are never nodes in the " +
          "graph: moving the wall moves its doors, and the hole is carved when drawn.",
        required: ["id", "kind", "t", "width"],
        additionalProperties: false,
        properties: {
          id: { $ref: "#/$defs/id" },
          kind: { enum: ["door", "window", "passage"] },
          t: mm("Centre of the opening, measured from node a along the centerline, mm."),
          width: { type: "integer", minimum: 1, description: "mm across the wall opening." },
          hinge: { enum: ["a", "b"], description: "Which jamb hinges, named by the wall's own a->b direction." },
          swingIn: { type: "boolean", description: "Opens toward the perp(a->b) side." },
          windowType: {
            enum: ["fixed", "casement", "sliding", "tilt-turn"],
            description: "Single-sash shorthand. `sashes` wins when both are present.",
          },
          sashes: {
            type: "array", minItems: 1, items: { $ref: "#/$defs/sash" },
            description: "Panes across the opening in a->b order. One hole, divided by mullions.",
          },
          slideTo: { enum: ["a", "b"] },
          glazed: { type: "boolean", description: "Glazed leaf — drawn as a thin double line." },
          powered: { type: "boolean", description: "Electrically operated." },
          selfClosing: { type: "boolean", description: "Self-closing, as a fire door must be." },
          fireRating: {
            type: "object",
            required: ["kind", "minutes"],
            additionalProperties: false,
            properties: {
              kind: { enum: ["wbd", "wrd"], description: "Branddoorslag or rookdoorgang." },
              minutes: { type: "integer", minimum: 0 },
            },
          },
          sillHeight: mm("mm above floor. Reserved for elevations and 3D."),
          height: mm("mm. Reserved for elevations and 3D."),
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
