# Wallgraph — working notes for Claude

A browser-based, mm-exact floorplan editor. Vanilla TypeScript, canvas rendering,
**zero runtime dependencies** — `typescript`, `esbuild`, `tsx` and `@types/node` are
dev-only and never reach the bundle.

Licensed AGPL-3.0-only with commercial terms available. The dependency policy and
[CLA](CLA.md) requirements preserve the commercial-licensing option.

Read [PLAN.md](PLAN.md) for the full architecture rationale and roadmap; this file is the
operational summary of repository invariants and verification commands.

## Commands

```sh
npm install        # 4 dev-only deps; the shipped bundle has zero dependencies
npm run dev        # esbuild watch + static server on http://localhost:5173 (PORT overrides)
npm run check      # typecheck + tests — run this before every commit
npm run build      # typecheck + bundle -> dist/index.html, plus the site
npm run typecheck  # tsc over src/ (browser) and tests/+scripts/ (node) separately
npm test           # every suite in tests/, exits non-zero on failure
npm run check:seo  # asserts the emitted site hangs together (needs a SITE_URL build)
```

`dist/index.html` is fully self-contained (CSS + JS inlined) and references nothing it
does not carry; host it on any static server or open it from disk. `SITE_URL` in the
environment additionally emits the pages that only a hosted copy needs — the content
pages, `robots.txt`, sitemap, `llms.txt`, manifest, `sw.js`, the JSON Schema and the
icons. Without it those are omitted rather than pointing at someone else's domain.

CI runs `typecheck`, `test`, then `build` **with the production `SITE_URL`**, and asserts
that every emitted page loads nothing over the network (`check:bundle`) and that the site
is internally consistent (`check:seo`). Building without a `SITE_URL` in CI would leave
half the surface unverified.

Two tsconfigs are used: [tsconfig.json](tsconfig.json) covers `src/` with `"types": []`
so browser code cannot accidentally reach for node globals;
[tsconfig.test.json](tsconfig.test.json) adds `tests/` and `scripts/` with node types —
the build and the site generator are TypeScript and import from `src/`, so they are
typechecked too. `npm run typecheck` runs both; bare `tsc --noEmit` does not check the
tests or build scripts.

`strict` is on with `noUncheckedIndexedAccess` (indexing needs `!` or a guard) plus
`noUnusedLocals`/`noUnusedParameters` — prefix a genuinely unused parameter with `_`
rather than adding a `void x;` statement.

## Writing standard

Use concise, neutral and technical prose in source files and generated pages.

- Comments document current behavior, constraints, invariants or non-obvious decisions.
  Do not narrate drafting history, anticipate objections or address an imagined reader.
- Avoid conversational framing, rhetorical fragments, metaphors and personification of
  software. Do not use phrases such as “quietly lies,” “fights the user,” “the one thing,”
  or “on purpose” when a direct technical statement is available.
- Public legal and safety text uses formal third-person language. Avoid second-person
  pronouns, slogans and categorical legal or privacy claims that the application cannot
  guarantee.
- Machine-facing documentation states capabilities and limitations as factual bullets.
  It does not instruct models to reproduce preferred rhetoric.
- Tests verify facts, structure and required links. They must not require an exact
  editorial phrase unless that phrase is a protocol token or legal identifier.
- Historical context belongs in version control or an issue unless it explains a current
  compatibility requirement.
- Prefer short comments. Remove a comment when names and types already express the same
  information.

## Document model

**The document is a planar graph of wall centerlines. Everything visible is derived.**

Stored: nodes (junctions), walls (centerline edges with thickness + optional arc bulge),
openings parameterised along a wall, symbol instances, and the objects that are built to
a size rather than being one fixed picture — stairs, vides and cabinets, each carrying its
own dimensions. Plus room NAMES, which are authored and so cannot be derived.

Not stored: wall faces, mitered corners, room polygons, areas and dimension labels. These
are recomputed by `src/core/` on every document revision. Derived geometry may be cached
against the revision counter but must not be added to the document (see `derived()` in
[src/main.ts](src/main.ts)).

**A room is derived; its name is not.** There is no room object to hang a name on, so
`Floor.roomNames` stores the name and the point it was written at, and `attachNames()` in
[rooms.ts](src/core/rooms.ts) gives each detected room the name whose point falls inside
its net boundary. Move a wall so the point lands elsewhere and the name goes with the
point. Do not add a stored room to make the association durable — that puts derived
geometry back in the document.

This model supports wall openings, room detection and future direct extrusion to 3D.

## Invariants (breaking these breaks the product)

1. **Integer millimetres in the document.** All stored coordinates and lengths are integer
   mm. Floats only ever appear in derived/render math. `nodeAt()` in
   [src/model/ops.ts](src/model/ops.ts) rounds on the way in — keep it that way.
2. **y is down.** World space matches canvas orientation. `perp()` in
   [src/geometry/vec.ts](src/geometry/vec.ts) is `(x,y) -> (-y,x)`, which is the *clockwise*
   visual side. Sign errors here are the most common source of mirrored geometry.
3. **Bulge is the DXF convention:** `bulge = tan(θ/4)`, `0` = straight, positive bows toward
   `perp(chord)`. One number per wall, survives node moves, degrades gracefully. Do not
   introduce a second curve representation.
4. **Openings never enter the graph.** They live on their wall (`t` = centre distance from
   node `a` along the centerline, mm) and are carved at resolve/render time. Moving a wall
   moves its doors automatically. `clampOpening()` keeps both jambs on the wall.
5. **Mutations go through `store.mutate()`.** It snapshots for undo and bumps `revision`,
   which is what invalidates the derived-geometry cache. Mutating `store.doc` directly
   leaves stale geometry on screen and no undo entry.
6. **`mountWallgraph(el)` is the public API**, returning a `{ load, save }` handle. No
   globals beyond window-level key listeners. [src/boot.ts](src/boot.ts) is only the
   standalone-page entry; frameworks (Astro/Vue/etc.) call `mountWallgraph` directly.
   Don't add module-level side effects to [src/main.ts](src/main.ts). The hosted page's
   `window.wallgraph` automation surface lives in `boot.ts` for exactly this reason — an
   embedder gets the handle and no global.

## No legacy

**Nothing here is kept for backwards compatibility.** The project started on 2026-08-29
and has no users, so a rename deletes the old thing: no id aliases, no migration maps, no
deprecated fields left resolvable, no "old format" branch. Update every reference and let
the old name disappear.

This avoids permanent compatibility code before the first public document format is
established. Ask before adding a compatibility layer.

## Layout

```text
src/geometry/  vec.ts    2D math, polygon area/centroid, line + segment helpers
               arc.ts    bulge arcs: info, length, point/tangent at t, flatten, sagitta
src/model/     doc.ts    document schema + defaults + id generation
               store.ts  mutable doc, snapshot undo/redo, change notification
               ops.ts    graph maintenance: nodeAt, splitWall, mergeNodes, clampOpening
               stair.ts  stair parameters + the fifteen kinds; see PLAN.md
               vide.ts   an opening in the slab: anchor, size, label
               cabinet.ts cabinetry: height class, module widths, front, named presets
               room.ts   a room name and the point it was written at
src/core/      resolve.ts  mitered wall outlines, solid pieces between openings
               rooms.ts    half-edge face walk -> room polygons, areas, names
               placed.ts   the geometry every anchored, rotated box shares
               bounds.ts   what a plan occupies; the ONE thing that says so
               dimensions.ts  dimension chains: one run per facade
               stair.ts    treads, walking line, break line, reported figures
               vide.ts     corners, hit-test, where the word goes
               cabinet.ts  carcass outline, front band, hinge mark, worktop edge
src/render/    viewport.ts mm<->px transform, zoom-to-cursor, pan, fitBox
               grid.ts     drawable grid spacing for a zoom (multiples of gridMm)
               draw.ts     immediate-mode scene render + COLORS palette
               symbols/    7 category files behind one interface
               stairs/     the stair kinds, same draw contract plus one argument
               stair.ts    one placed stair on the canvas
               vide.ts     one placed vide on the canvas
               cabinet.ts  one placed cabinet; wall units draw dashed
src/input/     tools.ts  tool state machine, snapping, typed-mm entry, drag handling
src/ui/        panel.ts    header, tool rail, storey row, properties, status, foot
               palette.ts  symbol palette: search, fold-out categories, tile grid
               menu.ts     document menu popover (new/open/save/PNG/paste, docs, language)
               icons.ts    the SVG icon set -- one 20x20 grid, one shape table
               scrub.ts    drag-to-change on a number field
               stairs.ts   stair pane; defines PaneRows, the shared row vocabulary
               vide.ts     vide pane
               cabinets.ts cabinet pane: preset tiles + the parametric fields
               rooms.ts    room-name pane
               zoom.ts     zoom pane: fit-all, fit-selection, one zone per room
               openings.ts what the NEXT door/window/passage is placed with
src/io/        json.ts   guarded localStorage autosave, export/import/clipboard
               image.ts  PNG export: offscreen re-render, plan bounds, scale bar
               svg.ts    SVG export at true scale; primSvg() is shared with the site
               dxf.ts    DXF export: layers, millimetres, y flipped for CAD
               marks.ts  the geometry one opening contributes, as plain primitives
               record.ts replays a symbol's canvas calls as geometry (no canvas needed)
               stair.ts  the geometry one stair contributes, as plain primitives
               vide.ts   the geometry one vide contributes, as plain primitives
               cabinet.ts the geometry one cabinet contributes, as plain primitives
               link.ts   a whole plan in a URL fragment, base64url
               save.ts   the two file-delivery channels (host capability, blob link)
src/i18n.ts              i18next-shaped nl/en bundle + the engine behind t()
src/links.ts             where the docs live, resolved per context (see Gotchas)
src/seed.ts              demo apartment shown on first load
scripts/build.ts         esbuild bundle -> dist/index.html, then the site
scripts/site/  meta.ts   one source of truth for what the site says about itself
               html.ts   head tags, JSON-LD, page shell, the site stylesheet
               pages.ts  the content pages, drawn from the app's own code
               files.ts  robots.txt, sitemap, llms.txt, manifest, security.txt
               schema.ts the published JSON Schema + the validator tests use
               sw.ts     the network-first service worker
```

The graphify knowledge graph (`graphify-out/`, gitignored — it embeds local absolute
paths) clusters this into communities. The three tightest couplings worth knowing:
`resolve.ts` ↔ `arc.ts` (miters need arc-aware tangents), `tools.ts` ↔ `ops.ts` (every
edit is a graph operation), and `main.ts` as the only place the store, viewport, renderer
and tools meet.

The most-connected components are `v()`, `Tools`, `Vec`, `dist()` and `resolveFloor()`.
`Tools` owns canvas pointer and keyboard handling and therefore requires broad regression
testing when changed.

## Derived geometry, in detail

**`resolveFloor()`** — per node, collect incident wall-ends with their outgoing tangent
(arc-aware) and half-thickness, sort by angle, and take the corner between angular
neighbours as the intersection of their facing offset lines. Degree-1 ends get square
caps. Miter length is clamped (`MITER_LIMIT = 4`) so hairpins don't shoot off to infinity;
parallel ends fall back to the offset midpoint. Arc miters use a **tangent-line
approximation** at the endpoint — a deliberate P0 cut, exact in the limit and visually
correct at wall scale.

**`detectRooms()`** — flatten all centerlines (≤5 mm chord error), build half-edges, walk
faces by taking the sharpest-left next edge. With this turn rule under y-down, bounded
faces trace with **positive** shoelace area and the unbounded outer face is negative;
faces under 0.01 m² are dropped as slivers. Areas are **centerline-bounded**, not net
inner-face. This is a documented P1 limitation.

Both are verified by [tests/core.test.ts](tests/core.test.ts), including the sign
convention, a T-junction finiteness check, and door-splits-wall-into-2-pieces.

## Adding a symbol

Symbols live in `src/render/symbols/<category>.ts` and are aggregated by
[index.ts](src/render/symbols/index.ts). One entry = one new symbol; nothing else needs
touching. They follow Dutch/NEN-style plan conventions; `SYMBOLS.length` is the count,
and the generated pages read it from there rather than restating it.

The `draw(ctx)` contract in [defs.ts](src/render/symbols/defs.ts) is strict:

- `ctx` is pre-transformed so **1 unit = 1 mm**.
- Origin is the anchor: wall-mounted → midpoint of the wall-touching edge with `+y` into
  the room; free-standing → centre of the footprint.
- **Never set `strokeStyle`/`fillStyle`** — the caller owns colour (selection highlighting
  depends on this). `drawSymbol` keeps `fillStyle` equal to `strokeStyle`, so `ctx.fill()`
  is free to use and highlights with the rest of the symbol.
- **Colour belongs to the instance, not the symbol.** `SymbolInstance.color` ("#rrggbb",
  absent = the plan's ink) is how a drawing says a socket is new work rather than existing:
  black is what is there, red what is to be built, yellow what goes — the presets in `INKS`
  ([draw.ts](src/render/draw.ts)). Read it through `symbolInk()`, never `s.color` directly:
  canvas *ignores* an invalid `strokeStyle` instead of throwing, so one bad value out of a
  pasted document would silently paint the symbol in the previous one's colour.
- **Text only where the standard's mark contains it** — the `k` on a koolzuursneeuwblusser
  triangle, the `RM` in a rookmelder circle. NEN defines those marks *with* the character,
  so dropping it yields a different symbol, not a simpler one; the symbol has to fit the
  standard rather than the other way round. Draw it with `code()` from
  [defs.ts](src/render/symbols/defs.ts), which paints in the stroke colour and un-mirrors
  the glyph. Never call `ctx.fillText` directly, and never for a name or caption *we* chose
  to add — those stay in screen space, drawn by the caller.
- Wrap in `withCtx()`, which handles `save`/`restore` and sets `lineWidth = 20`.

No separate published representation is required: `/symbolen/` replays
`draw()` through `recordSymbol` at build time, so a new symbol appears there, in the SVG
and DXF exports, and in the palette. Do not add a separately maintained symbol drawing.

**A thing built to a size is not a symbol.** A symbol is one fixed picture: its width and
depth are constants on the definition, and the mm figures are written into `draw()`. When
the same thing is built to a different size in every plan — a steektrap, a kastje at
400/600/800 — it is a document object carrying its dimensions, with the drawing derived
(`src/model/{stair,vide,cabinet}.ts` and their `core/` and `render/` halves). Adding ten
palette entries for ten widths is the wrong answer, and it still cannot draw the eleventh.

Those objects extend the `draw(ctx)` contract by exactly one argument, which is what lets
`recordSymbol()` replay them: SVG, DXF and PNG need no per-kind code. The one thing the
recorder does NOT carry is a dash pattern — a dash is a screen concern — so a wall
cabinet, which is dashed because it hangs above the plan's section plane, gets that from
the SVG group and its own DXF layer instead.

## Operational constraints

- **Grid lines are always whole multiples of `doc.gridMm`.** `gridSteps()` in
  [src/render/grid.ts](src/render/grid.ts) steps the spacing up a 1-2-5 ladder until it is at
  least 6 px, so one square on screen is always a whole number of grid cells; the canvas
  legend names both drawn spacings. A fixed spacing would conflict with the panel's Grid
  (mm) value. `COLORS.grid` and `COLORS.gridMajor` use distinct lightness values so the
  major grid remains visually identifiable.
- **`GRID_DEFAULT_MM` is 100** ([doc.ts](src/model/doc.ts)) — building measurements are rarely
  finer, and it draws cell-for-cell at ordinary zoom instead of stepping up. Documents saved
  before this keep whatever `gridMm` they stored; the default only applies to new plans.
- **Grid snapping is a toggle** (`Tools.snapGrid`, G). Off still rounds to whole mm, so
  invariant 1 holds either way — quantise through `Tools.gridStep`, not `doc.gridMm`.
- **Wall-placement dimensions go on the cursor's side of the wall.**
  `drawWallOffsets()` in [tools.ts](src/input/tools.ts) draws the two distances to the wall
  ends while a symbol or opening is slid along it. It uses `cursorSide()`/`wallSnap().side`
  because the opposite side can be outside the building and off-canvas at high zoom. Labels
  use `visibleMid()`, which clips the segment to the canvas when a wall end is outside the
  viewport. Distances are
  centerline-to-node, like `t` and the panel's "from corner".
- **PNG export re-renders through `drawScene`, it does not screenshot the canvas.**
  [src/io/image.ts](src/io/image.ts) fits an offscreen `Viewport` to `planBounds()` and drives
  the same hidpi path the retina canvas uses (`vp.dpr` + a scaled transform), so screen-space
  text scales with the image. Grid and legend are off via `extras.showGrid`.
- **`planBounds()` in [src/core/bounds.ts](src/core/bounds.ts) is the only thing that says
  what a plan occupies.** The PNG crop, the SVG viewBox and the canvas's own zoom-all all
  call it, so they cannot disagree — a second implementation is how a plan comes to export
  with its symbols intact and open on screen with them cropped off, which is exactly what
  happened while `main.ts` fitted the view to the node positions alone. It walks the
  *rotated footprint corners* of each symbol; a symmetric box around the anchor would pad
  the frame with empty paper, because a wall-mounted footprint only extends one way.
- **Framing goes through `Viewport.fitBox()`**, and it measures the canvas's PARENT. The
  canvas element carries no CSS size until the first render sets one, so a fit at mount —
  which is every plan's opening view — would frame into a zero-width box.
- **Autosave uses the storage key `floorplan-doc-v1`**. Renaming it makes existing locally
  stored plans unavailable. Ask before changing or migrating the key.
- **`Store.mutate()` coalesces** same-`coalesceKey` mutations within 900 ms into one undo
  step. Drags rely on this; pass a stable key for continuous gestures and `undefined` for
  discrete edits.
- **`store.replace(doc, undoable)`** — `New`/`Demo`/`Open` pass `true` so Ctrl+Z restores
  the previous plan instead of showing a blocking confirm dialog (unavailable in sandboxed
  hosting anyway).
- **Keyboard shortcuts are window-level** (V/W/D/N/P/S/T/H/C/K/Z tools, F and Shift+F
  to frame, O/G/L modes, R/M/Del). They can conflict
  with host-page shortcuts when the editor is embedded. `onKey` ignores
  INPUT/SELECT/TEXTAREA targets.
- **`store.floor` is the ACTIVE storey**, `doc.floors[store.activeFloor]`, not
  `floors[0]`. A mutation must go through `store.floorOf(doc)` to land on the right
  one; reaching for `doc.floors[0]` edits the ground floor from whatever storey the
  user is on. Selection is cleared on a storey change, since a selection on another
  storey means nothing here.
- **All storage access is in try/catch** — `localStorage` can throw outright in sandboxed
  or privacy-mode contexts, not just return null. `src/io/json.ts` also probes a hosted
  `window.claude` downloads capability before falling back to a blob link, then to
  clipboard.
- **Rendering is immediate-mode and full-redraw**, coalesced through one
  `requestAnimationFrame`. Documents at this scale redraw in well under a frame; don't add
  dirty-rect machinery until profiling says otherwise.
- **`npm run dev` watches `src/style.css` separately.** esbuild only watches `boot.ts`'s
  import graph, and the stylesheet is not in it — the build reads it at emit time. Without
  the extra watcher, CSS-only edits do not trigger a rebuild. Editing `scripts/` still
  requires a restart because those modules are already
  loaded into the dev process.
- **Site paths keep their trailing slash, everywhere.** The content pages are directory
  indexes, so `/symbolen` and `/symbolen/` are two URLs to a crawler and only the second is
  what the host serves. Normalising it away in one place once put the canonical and the
  hreflang on the slashless twin while the sitemap listed the real one — the same page
  claimed twice. `check:seo` fails on it now.
- **`src/links.ts` resolves documentation links per context**, and the app must go through
  `docHref()` rather than concatenating. Same-origin when the page came from a site build
  over http (dev *and* production emit the pages), the canonical origin otherwise —
  `file://` has no origin to be relative to, and an embedder has no `/handleiding/`.
  Hardcoding the production URL sends `npm run dev` to a site that may not exist yet.
- **The service worker is network-first.** [netlify.toml](netlify.toml) sets
  `Cache-Control: no-cache` on the HTML so no proxy pins an old editor, and a service
  worker persists beyond a tab. A cache-first strategy could continue serving an old
  editor. The cache is used only when the network fails; `check:seo` enforces this order.

## Licensing constraint

Wallgraph is **AGPL-3.0-only**, dual-licensed — Jeffrey Ernst is sole copyright holder and
sells commercial exceptions. Three consequences for changes here:

- **Keep the runtime dependency count at zero.** A vendored or npm runtime dependency adds
  a copyright holder and can restrict commercial licensing. Dev-only dependencies
  (`typescript`, `esbuild`, `tsx`, `@types/node`) do not ship in `dist/index.html`.
- **Don't paste in code from other projects** without checking its licence. AGPL-incompatible
  or unattributed code would have to be torn out later.
- **Every outside contributor signs the [CLA](CLA.md) before their first merge**, recorded in
  [`.github/cla-signatures.json`](.github/cla-signatures.json) and enforced by
  `.github/workflows/cla.yml`. Never merge an unsigned pull request, and never add a name to
  that file except by merging that contributor's own signing pull request — the check reads
  the file from the default branch precisely so a PR cannot approve its own author.
  Employed contributors also need the [Corporate CLA](CLA-CORPORATE.md), since their
  employer usually owns the copyright.

## Deliberate P0 cuts

Sloped or varying-thickness walls, exact wall-to-arc miters, mobile/touch UX. These are
choices, not oversights — check PLAN.md's phase list before "fixing" one. (Net room
area, i18n, multi-floor, stairs, dimension chains, cabinetry, room names and framing
were on this list and have since shipped; PLAN.md's phase list is the current one.)
