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
- **Tools** (state machine): Select · Wall · Door · Window · Symbol · Stair · Delete.
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

## Symbol library (`src/render/symbols/`)

77 standard plan symbols, drawn in mm units against a fixed interface
(`{ type, label, category, wallMounted, width, depth, draw(ctx) }`), one file per
category and aggregated by `index.ts`: electrical (23), safety (15), water (9),
sanitary (9), furniture (8), heating (7), kitchen (6). Extending the library = adding
one entry, plus its name in both languages (a test fails otherwise).

The `draw(ctx)` contract is deliberately narrow — 1 unit = 1 mm, the caller owns
colour, no text — so symbols compose with selection highlighting and the PNG
export without knowing about either.

## Stair library (`src/render/stairs/`, `src/model/stair.ts`, `src/core/stair.ts`)

The fifteen stair kinds of the plan-symbol sheet. They are not symbols: a symbol is
one fixed picture, while the same steektrap is 900 mm wide in a house and 1200 in a
bedrijfsunit and its tread count follows the storey height. So a stair is a document
object carrying `width`, `going`, `treads`, an optional `rise` and a `well`, and its
treads, walking line, arrow, winder fan, the tread the section plane cuts and the
optrede it is annotated with are all derived from those numbers at render time —
`stairBox()` in `core/stair.ts` is the footprint the hit-test, the selection frame,
the PNG crop and the SVG viewBox all share.

`draw(ctx, stair)` extends the symbol contract by exactly one argument, which is what
lets `recordSymbol()` replay a stair unchanged: SVG, DXF and PNG needed no per-kind
code. `tests/stairs.test.ts` holds the registry to the `StairKind` union and asserts
that nothing a kind draws falls outside the footprint the rest of the editor trusts.

**A vide is a feature of the floor, not a storey.** `Floor.vides` holds the
openings cut in this slab: outline plus diagonals plus the word, cutting the room
tint and drawn under the walls that bound it (`src/model/vide.ts`,
`src/core/vide.ts`, `src/render/vide.ts`). A trapgat is the same object, seen from
the floor above. Rectangular for now — one that follows an irregular room needs
polygon editing.

**Rise comes from the storey.** `Floor.height` is the verdiepingshoogte; a stair with
no `rise` of its own climbs it, so changing the storey moves every stair that follows
it. Stating `rise` overrides that, which is what a flight up to a mezzanine beside a
vide needs. A hellingbaan never inherits — it bridges a level change, not a storey.
`resolveStair()` settles the question once, at the boundary, and everything downstream
takes a `ResolvedStair`.

**Figures are reported, never enforced.** `STAIR_LIMITS` holds what a woningtrap is
ordinarily built to; `stairIssues()` says where a stair falls outside it, the property
pane states each one in red, and the plan annotation carries an exclamation mark so the
flag survives an export that loses the colour. Kinds that are steep by definition — a
vlizotrap, a spiltrap — are held only to a loose bound that no stair can pass. None of
it is a compliance check: Wallgraph draws what it is given (see the disclaimer).

## Phases

**P0 — done.** Everything above, single floor.

**P1 — done.**

- [x] dimension-line layer — clickable mm pills, `L` toggles all-walls, and both
      distances to the wall ends while placing on a wall
- [x] net room areas — inner-face polygons per wall thickness, and the document
      records *which* convention its numbers mean (see Measurement below)
- [x] PNG export at true scale, with a scale bar
- [x] more symbols — kitchen and furniture landed; 77 in total
- [x] SVG export — vector artwork at true scale, mm-sized with a 1:1 viewBox
- [x] DXF export — walls, swings, symbols and areas on layers, in millimetres
- [x] multi-floor with ghost underlay — `Store.activeFloor` with add/duplicate/
      rename/delete; the storey below draws as a non-selectable underlay
- [x] dimension *chains* — one run per facade, openings and piers in
      sequence with an overall beneath; interior walls keep their own dimension
- [x] stairs — the fifteen kinds of the NEN plan-symbol sheet as a document object
      of their own (`src/model/stair.ts`, `src/core/stair.ts`, `src/render/stairs/`).
      A stair is not a symbol: its width, going and tread count are stored, because
      the same steektrap is built to a different size in every plan, and the treads,
      walking line, arrow and winder fan are derived from those numbers. The drawing
      obeys the symbol library's `draw(ctx)` contract, so SVG, DXF and PNG come out of
      the recorder that already existed

**P2 — not started.**

- [ ] multi-select and bulk edit — rubber band and shift-click. `Store.sel` is a
      single `{ kind, id }` today, so this is two jobs rather than one: a selection
      *set*, and a property pane that can say what a field means for N objects
      (mixed values, and which of them an edit writes). Recolouring twenty already
      placed sockets at once is the case that asks for it — one at a time works,
      but only one at a time.
- [ ] trace-over-image underlay with scale calibration
- [ ] share links (one Postgres table)
- [ ] 3D extrusion view (Three.js — the wall graph extrudes directly)

**P3 — hosting already met, ahead of order.** Live at
[plattegrond.crocode.nl](https://plattegrond.crocode.nl) on static hosting at ≈ €0,
deploying from `main`. Optional accounts only if sharing demands it.

## Measurement conventions

Plans are dimensioned both ways and the gap is not small: a 4×3 m room with 300 mm
walls is 12.00 m² hart-op-hart but 9.99 m² net. So every reported figure names its
basis rather than leaving a reader to guess.

- `PlanDoc.areaMode` is `"net"` (NEN 2580, inner faces) by default, or `"centerline"`.
  The canvas legend states which is in force; the Plan panel switches it.
- A wall shows its centerline length as an editable field and its clear span
  (dagmaat) read-only beside it. Editing stays on the centerline — that is what the
  document stores, and a clear span has no single solution for which end moves.

## Known cuts (deliberate)

Sloped/thick-varying walls, wall-to-arc exact miters (tangent approximation instead),
mobile/touch UX. A stair carries its rise and reports the optrede, the
loopvergelijking and a ramp's gradient, but nothing is enforced — Wallgraph states
the figures and does not check regulations. A stair does not snap to a wall the way
a wall-mounted symbol does, and its rise is per stair rather than a storey height on
the floor, so two stairs between the same two storeys can disagree.

*Closed since P0:* net room area, i18n (Dutch/English, Dutch by default), stairs.

## Beyond the plan

Shipped because publishing demanded it, not because the roadmap asked: AGPL-3.0
with a CLA and automated enforcement, CI, a versioned release workflow, social
preview and icons, and the deployment itself.

**The site around the editor.** `/` is a canvas application, which means that to
every crawler that does not run JavaScript — which is every AI crawler and most
search engines that are not Google — it was a title, a description and an empty
div. So the build now emits, alongside the single-file editor, a small set of
JavaScript-free pages generated from the app's own code: the 77 symbols and the
27 opening types drawn by replaying `recordSymbol` and `openingMarks`, the
manual, and the document format. Plus `robots.txt`, a multilingual sitemap,
`llms.txt`, a web manifest, `security.txt` and structured data. Dutch leads
throughout, matching the editor's own default and the domain; English is a full
alternate. `scripts/check-seo.mjs` asserts in CI that it all still hangs together.

**Responsibility and limitations.** Wallgraph processes entered dimensions but does
not measure buildings or verify accuracy, completeness, regulatory compliance or
suitability for a particular purpose. The user remains responsible for the drawing,
its verification and its use. This information appears on a dedicated bilingual
page, under the status bar, in page footers, in the document menu and in `llms.txt`.
Sections 15 and 16 of the AGPL-3.0 provide the warranty disclaimer and liability
limitation, subject to applicable law.

The page does not state that Wallgraph drawings are categorically unsuitable for
permit applications or that only certified surveyors may measure to NEN 2580.
Document, measurement and certification requirements depend on the intended use,
applicable rules and receiving party. Wallgraph does not verify those requirements.

Commercial licensing is supported through sole copyright ownership, contributor
agreements and zero runtime dependencies. Certification is separate: a measurement
report derives its status from the qualified person responsible for it, not solely
from its calculations. A future permit-document workflow can nevertheless validate
specified content requirements and provide a checklist, title block, standard scales
(1:100 plan and 1:1000 site plan), north arrow and compliant export preset.

**Agent access.** Two client-side channels, no account and no server: a whole
plan carried in the URL fragment (`#plan=<base64url>`), and a `window.wallgraph`
surface on the hosted page with `load`, `save`, `link` and `language`. The
document format is published as JSON Schema and tested against documents produced by
the editor so schema changes are detected by tests.
