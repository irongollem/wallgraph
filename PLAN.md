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

## Symbol library (`src/render/symbols/`)

77 standard plan symbols, drawn in mm units against a fixed interface
(`{ type, label, category, wallMounted, width, depth, draw(ctx) }`), one file per
category and aggregated by `index.ts`: electrical (23), safety (15), water (9),
sanitary (9), furniture (8), heating (7), kitchen (6). Extending the library = adding
one entry, plus its name in both languages (a test fails otherwise).

The `draw(ctx)` contract is deliberately narrow — 1 unit = 1 mm, the caller owns
colour, no text — so symbols compose with selection highlighting and the PNG
export without knowing about either.

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
stairs, mobile/touch UX.

*Closed since P0:* net room area, i18n (Dutch/English, Dutch by default).

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

**Responsibility, stated plainly.** A tool that draws things people build from has to
say where the line falls, and the first draft put it in the wrong place: it read as
a list of things Wallgraph cannot do, which is both untrue and useless. The line is
not drawing versus being unable to draw, it is drawing versus *vouching for it*.
Wallgraph draws the dimensions you type; the drawing, and the responsibility for
it, is yours, and "it came out of Wallgraph" is not a reason for the consequences
to land on its author. That lives on its own page in both languages, on one muted
line under the status bar, in every page footer, in the document menu, and in
`llms.txt` so an assistant summarising the tool relays the distinction rather than
inventing a caveat. The AGPL's sections 15 and 16 still do the legal work.

Two claims the page deliberately does not make, because neither is true: that a
Wallgraph drawing cannot be used for a permit application — which drawings a
municipality wants is the Omgevingsregeling's business, and producing them is not
a reserved act — and that only a certified surveyor may measure to NEN 2580, which
is a standard rather than a statute. The narrow versions are what belong there: a
meetrapport that will be *accepted* comes from a certified measurer, and Wallgraph
does not check a set against anyone's requirements.

That page describes today, and the ambition behind it is worth being precise about,
because "licenseable" hides two different problems. *Commercial* licensing already
works — sole copyright holder, a CLA, zero runtime dependencies — which is exactly
why the dependency count is treated as load-bearing rather than as a size goal.
*Certification* is the other half and no amount of code buys it: a meetrapport is
valid because a certified meetdeskundige signed it, not because the arithmetic was
right. But the useful target is neither. "This set contains what the Omgevingsregeling
asks for" **is** a checkable property, and a drawing people can lean on is reachable
through a permit-drawing checklist, a title block, standard scales (1:100 plan,
1:1000 situatie), a north arrow and a compliant export preset — none of which needs
anyone certified.

**Agent access.** Two client-side channels, no account and no server: a whole
plan carried in the URL fragment (`#plan=<base64url>`), and a `window.wallgraph`
surface on the hosted page with `load`, `save`, `link` and `language`. The
document format is published as JSON Schema and tested against the documents the
editor actually writes, so the description of the format cannot quietly drift
from the format.
