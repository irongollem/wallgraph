# Floorplan Editor — Development Plan

A free, browser-based floorplan editor. mm-exact, fast to draw in, no accounts required.

## Guiding decisions

1. **The document is a planar graph, not a pile of shapes.** Nodes (junctions) and
   walls (centerline edges with thickness). Everything visible — wall faces, mitered
   corners, rooms, areas, dimension labels — is *derived* from this graph, never stored.
   This is the decision that makes doors-cutting-walls, room detection, and a future
   3D view fall out naturally.
2. **Integer millimetres everywhere.** All stored lengths/coordinates are integer mm.
   No floating-point drift in the document; floats appear only in derived/render math.
   Display converts to m/cm as appropriate.
3. **Curves are first-class but cheap.** A wall carries an optional `bulge` (DXF-style,
   `tan(θ/4)`), turning its centerline into a circular arc. One number, survives node
   moves, degrades to straight at 0. Analytic math where easy (rendering offsets,
   tangents); polyline flattening (≤2 mm chord error) where hard (room detection, areas,
   hit-testing).
4. **Vanilla TypeScript, canvas-owned rendering.** No framework for the canvas; the
   surrounding chrome (toolbar, property panel) is plain DOM. No heavy deps — the
   entire editor is our own code, which is the point of the foundation.
5. **Client-side first.** Document lives in memory; autosaves to browser storage
   (guarded — storage can be unavailable); explicit JSON export/import. A backend
   (share links) is a later, optional, single-table addition.

## Data model (`src/model/doc.ts`)

```ts
PlanDoc      { version, unit: "mm", floors: Floor[] }
Floor        { id, name, nodes: Node[], walls: Wall[], symbols: SymbolInstance[] }
Node         { id, x, y }                          // integer mm
Wall         { id, a: NodeId, b: NodeId,
               thickness: number,                  // mm, per-wall (default 100 interior / 300 exterior)
               bulge: number,                      // 0 = straight; sign = side
               openings: Opening[] }
Opening      { id, kind: "door" | "window" | "passage",
               t: number,                          // centre distance from node a along centerline, mm
               width: number,                      // mm
               hinge?: "a" | "b",                  // door: hinge side
               swingIn?: boolean,                  // door: opens toward left of a→b
               windowType?: "fixed" | "casement" | "sliding",
               slideTo?: "a" | "b",                // sliding window/door: direction
               sillHeight?, height? }              // reserved for elevations/3D
SymbolInstance { id, type, x, y, rotation, mirrored?, wallId? }  // wallId when wall-snapped
```

Openings belong to a wall and are parameterised along it — they *cut* the wall by
construction. Moving a wall moves its doors. `t` is clamped so jambs stay on the wall.

## Derived geometry (`src/core/`)

- **`resolve.ts` — wall outlines & miters.** Per node: collect incident wall-ends,
  each with outgoing tangent (arc-aware) and half-thickness; sort by angle; the corner
  between angular neighbours is the intersection of their facing offset lines
  (tangent-line approximation at arc endpoints — exact enough locally). Degree-1 ends
  get square caps. Each wall then renders as: corner → offset side (line or offset
  arc) → corner → cap → back. Handles differing thicknesses at one junction.
- **`rooms.ts` — room detection.** Flatten all centerlines to polylines; build
  half-edges; walk faces by smallest-CCW-turn; discard the outer face; shoelace for
  area, centroid for the label. Reported area is centerline-bounded for the prototype;
  net (inner-face) area is a listed follow-up.
- **Openings** don't enter the graph — they're carved at render time (floor-coloured
  gap + jambs + swing arc / sliding arrows / casement lines).

## Editor (`src/input/`, `src/ui/`, `src/render/`)

- **Viewport**: mm→px affine transform, wheel zoom-to-cursor, drag/space pan, DPR-aware.
- **Tools** (state machine): Select · Wall · Door · Window · Symbol · Delete.
  - *Wall tool*: click to chain segments; live length/angle readout; **typed input** —
    typing digits while drawing shows a mm box, `Enter` commits the segment at exactly
    that length in the current (snapped) direction. This is the feature that makes it
    mm-exact in practice, not just in storage.
  - *Snapping*: grid (default 100 mm, configurable, toggleable), node snap, wall-line snap
    (auto-splits a wall when you T into it), ortho/45° angle snap (toggle).
  - *Curves*: draw straight, then in Select drag the wall's midpoint handle to bow it
    (writes `bulge`); exact sagitta (mm) editable in the panel.
  - *Openings*: pick door/window, slide along a wall (snapped, mm offset shown), click
    to place; afterwards flip hinge/swing/slide direction in the panel or with keys.
  - *Symbols*: palette of standard plan symbols (below); wall-mounted ones snap flush
    to the nearest wall face and orient automatically; `R` rotates, `M` mirrors.
- **Property panel** (selection-driven): wall thickness & exact length (editing length
  moves the far node along the wall direction), opening width/offset/direction fields,
  symbol rotation, room label.
- **Undo/redo**: snapshot stack of the (small) document with input coalescing.
  Clean migration path to command objects if documents ever get huge.
- **Persistence**: autosave to browser storage in try/catch; Export/Import JSON.
  (In the hosted-artifact build, file downloads are sandboxed away, so it also offers
  copy-to-clipboard / paste-JSON.)

## Symbol library (`src/render/symbols.ts`)

Standard plan symbols, drawn in mm units against a fixed interface
(`{ type, label, category, wallMounted, width, depth, draw(ctx) }`):
electrical — single/double socket, switch, ceiling light point; sanitary — toilet,
sink, bath, shower; heating — radiator. Extending the library = adding one entry.

## Phases

- **P0 (this prototype)**: everything above, single floor.
- **P1**: dimension-line layer + wall chains, net room areas, PNG/SVG export at true
  scale, DXF export, multi-floor with ghost underlay, more symbols (kitchen, furniture).
- **P2**: trace-over-image underlay with scale calibration, share links (one Postgres
  table), 3D extrusion view (Three.js — the wall graph extrudes directly).
- **P3**: polish for a public free service — static hosting (≈ €0), optional accounts
  only if sharing demands it.

## Known cuts in P0 (deliberate)

Sloped/thick-varying walls, wall-to-arc exact miters (tangent approximation instead),
net room area, stairs, mobile/touch UX, i18n.
