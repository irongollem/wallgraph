# Wallgraph — repository guidance

A browser-based, mm-exact floorplan editor. Vanilla TypeScript, canvas rendering and
**zero runtime dependencies**. Development dependencies never reach the bundle; treat
`package.json` as the source of truth for them.

Licensed AGPL-3.0-only with commercial terms available. The dependency policy and
[CLA](CLA.md) requirements preserve the commercial-licensing option.

The roadmap lives in the repository's [GitHub issues](https://github.com/irongollem/wallgraph/issues)
(label `roadmap`; the BIM/IFC work additionally carries `bim`, tracked from its parent
issue). This file is the architecture reference: repository invariants and verification
commands.

## Commands

```sh
npm install        # install development dependencies; the shipped bundle has none
npm run dev        # esbuild watch + static server on http://localhost:5173 (PORT overrides)
npm run check      # typecheck + tests — run this before every commit
npm run build      # typecheck + bundle -> dist/index.html, plus the site
npm run typecheck  # tsc over src/ (browser) and tests/+scripts/ (node) separately
npm test           # every tests/**/*.test.ts, discovered by glob, in parallel
npm run check:seo  # asserts the emitted site hangs together (needs a SITE_URL build)
```

`dist/index.html` is fully self-contained (CSS + JS inlined) and references nothing it
does not carry; host it on any static server or open it from disk. `SITE_URL` in the
environment additionally emits the pages that only a hosted copy needs — the content
pages, `robots.txt`, sitemap, `llms.txt`, manifest, `sw.js`, the JSON Schema and the
icons. Without it those are omitted rather than pointing at someone else's domain.

CI runs the checks and a build **with the production `SITE_URL`**. It verifies that every
emitted page loads nothing over the network (`check:bundle`) and that the site is
internally consistent (`check:seo`). Consult the workflow for its current job sequence.

The browser config, [tsconfig.json](tsconfig.json), covers `src/` with `"types": []`
so browser code cannot accidentally reach for node globals;
[tsconfig.test.json](tsconfig.test.json) adds `tests/` and `scripts/` with node types —
the build and the site generator are TypeScript and import from `src/`, so they are
typechecked too. `npm run typecheck` runs both; bare `tsc --noEmit` does not check the
tests or build scripts.

**A test file is discovered, never registered.** `npm test` globs
`tests/**/*.test.ts` through node's own runner, so adding a suite means adding the file
and nothing else — the list of test files that used to sit in `package.json` was a merge
conflict on every branch that added one. Each file runs as its own process, in parallel,
and a non-zero exit is a failure; the files print their own `ok`/`FAIL` lines and the
runner counts them. Because a glob matching nothing would exit 0 with "pass 0",
`scripts/check-tests.mjs` runs as npm's `pretest` and refuses a suite that has lost its
files.

`strict` is on with `noUncheckedIndexedAccess` (indexing needs `!` or a guard) plus
`noUnusedLocals`/`noUnusedParameters` — prefix a genuinely unused parameter with `_`
rather than adding a `void x;` statement.

## Graphify

`graphify-out/` is a generated, gitignored index, not documentation or a source of truth.
After substantial code changes, refresh its structural graph with `graphify update .`.
When Markdown or other semantic inputs change, use `/graphify . --update`; the CLI-only
update does not perform that semantic pass. If Graphify reports that the community set
changed, run `graphify label .` to refresh its names. Do not copy generated counts,
communities, file inventories or hub rankings into this file.

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
own dimensions. Plus room NAMES, which are authored and so cannot be derived, and the
service networks: a `Route` per discipline as its own point/segment graph, and a
document-level `RouteContinuation` naming the endpoints one service joins across storeys.

Not stored: wall faces, mitered corners, room polygons, areas and dimension labels, and
everything a service network implies rather than states — where an anchored waypoint
currently sits, how long a run is, the plane it is installed in, the drop from that plane
to a device, and the riser marks. These are recomputed by `src/core/` on every document
revision. Derived geometry may be cached against the revision counter but must not be
added to the document (see `derived()` in [src/main.ts](src/main.ts)).

**A room is derived; its name is not.** There is no room object to hang a name on, so
`Floor.roomNames` stores the name and the point it was written at, and `attachNames()` in
[rooms.ts](src/core/rooms.ts) gives each detected room the name whose point falls inside
its net boundary. Move a wall so the point lands elsewhere and the name goes with the
point. Do not add a stored room to make the association durable — that puts derived
geometry back in the document.

**A connection is stored; where it lands is not.** A route waypoint may follow a symbol
or a piece of fit-out (`RoutePoint.anchor`) or a wall (`wallId`/`wallT`), and
`resolveRoutePoints()` in [route.ts](src/core/route.ts) reads the CURRENT position at
derive time — nothing writes the point's x/y when the device moves. The stored x/y is the
fallback for an anchor that no longer resolves, which is why deleting a device has to
write its last position into every point following it, in the same mutation
(`unanchorRoutePoints()`).

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
6. **A device's PORTS decide what may connect to it.** `SymbolDef.ports` and
   `furnishingPorts()` say which services a thing takes and where; `routeTakesSymbol()` /
   `routeTakesFurnishing()` answer only by asking them. This replaced a table keyed on the
   symbol's category, which was wrong in both directions — a gas-point sits in the water
   category, so no gas run could reach it, and no electrical run could reach a cv-ketel.
   Do not reintroduce a category rule: a device that declares what it takes cannot be
   right about it in one place and wrong in another.
7. **A device's anchor is not its connection.** Where a run reaches a thing comes from
   `connectionPoint()` / `anchorPoint()` in [port.ts](src/core/port.ts) — never from
   `device.x`/`device.y`. They coincide for a wandcontactdoos, which is why the anchor
   served as both for so long; they are most of a fixture apart for a bad or a douche.
   Port positions are FRACTIONS of the footprint, so they survive a piece being resized.
8. **`mountWallgraph(el)` is the public API**, returning a `{ load, save }` handle. No
   globals beyond window-level key listeners. [src/boot.ts](src/boot.ts) is only the
   standalone-page entry; frameworks (Astro/Vue/etc.) call `mountWallgraph` directly.
   Don't add module-level side effects to [src/main.ts](src/main.ts). The hosted page's
   `window.wallgraph` automation surface lives in `boot.ts` for exactly this reason — an
   embedder gets the handle and no global.

## No legacy

**Nothing here is kept for backwards compatibility.** A rename deletes the old thing: no
id aliases, migration maps, deprecated fields or "old format" branches. Update every
reference and let the old name disappear.

This avoids permanent compatibility code before the first public document format is
established. Ask before adding a compatibility layer.

## Derived geometry, in detail

**`resolveFloor()`** — per node, collect incident wall-ends with their outgoing tangent
(arc-aware) and half-thickness, sort by angle, and take the corner between angular
neighbours as the intersection of their facing offset lines. Degree-1 ends get square
caps. Miter length is clamped (`MITER_LIMIT`) so hairpins don't shoot off to infinity;
parallel ends fall back to the offset midpoint. Arc miters use a **tangent-line
approximation** at the endpoint — a known limitation, exact in the limit and visually
correct at wall scale.

**`detectRooms()`** — flatten all centerlines at the shared chord tolerance, build half-edges, walk
faces by taking the sharpest-left next edge. With this turn rule under y-down, bounded
faces trace with **positive** shoelace area and the unbounded outer face is negative;
faces below the sliver threshold are dropped. It derives both the centerline boundary and
the net inner-face boundary; `PlanDoc.areaMode` selects which area is reported.

Both are verified by [tests/core.test.ts](tests/core.test.ts), including the sign
convention, junction finiteness and opening segmentation.

**`floorSurface()`** — the face area of a storey's walls, per wall, per room and summed, for the
trades ordered by the square metre (stucwerk, verf, behang). It measures the MITERED face length
from `resolveFloor()` rather than the centerline, on both faces; an opening is deducted at its
stated size from each face and clamped to it. `innerMm2` leaves out the face a wall states cladding
on, that face being outside by definition; a wall with no cladding keeps both, since the document
does not then say which side is outside. Reported, never enforced — nothing here decides what is
finished. Verified by [tests/surface.test.ts](tests/surface.test.ts).

**A reveal is one surface through the wall, so the two sides get half each.** `revealsMm2` is the
dagkanten — two jambs and a head at the wall's THICKNESS, never a sill (under a door that is the
floor, under a window a vensterbank). It stays out of `netMm2` and is added in `finishMm2`, because
a stucadoor prices it separately and a plan that wants the wall alone still has it. The half-and-half
split is not an approximation to apologise for: on an exterior window the inner half genuinely is
plasterwork and the outer half genuinely is facade detail, and the split puts each where it belongs.
A head above a suspended ceiling does not count, and the jambs stop at the ceiling.

**A wall's two faces stand in two different rooms, so the HEIGHT is per face.** `detectRooms()`
records which side of each wall a room is on (`Room.boundingFaces`), read off the direction the
half-edge walk traverses it in: a bounded face lies on the `perp(direction)` side of its edges under
y-down, which is the wall's `left` face when the edge runs a→b. That mapping is what makes a
suspended ceiling work — a face is finished to the ceiling of the room it looks into, so the wall
between a badkamer at 2300 and a slaapkamer at storey height is two different areas. Get the
direction backwards and every room reports its neighbours' outer faces, which
[tests/surface.test.ts](tests/surface.test.ts) checks by asserting a room always looks into the
SHORTER of its walls' two faces.

**A ceiling is a finish, not structure.** `Floor.ceilingMm` and `RoomName.ceilingMm` change nothing
a stair climbs, nothing IFC calls a space, and no area — only `floorSurface()`. A figure at or above
the storey height finishes nothing extra and reads as absent (`storeyCeiling()`), rather than as a
ceiling inside the slab. The per-room one rides on the name for the reason `RoomName.use` does:
there is no stored room to hang it on, so an unnamed room falls back to the storey's.

**`resolveRoutes()`** — waypoints resolved through their anchors, then straight legs that
share a corridor with another run fanned into parallel lanes. The fan is drawn legibility
ONLY: it is applied per segment, and anything that makes a geometric claim about where a
run is — the IFC export, a length, a hit test against the true vertex — reads
`resolveRoutePoints()` instead. Arcs are excluded from bundling.

**`routePlaneHeight()`** — the plane a run is installed in. An authored `Route.height`
always wins; absent, the installation supplies it, and "in / boven plafond" means the
storey height rather than zero. `routeDrops()` measures the vertical run from that plane
to each anchored device's mounting height (`core/mount.ts`), which is real cable the plan
does not draw — so it is reported beside `routeLength()`, never folded into it.

**`riserMembers()` / `riserMarks()`** — the vertical marks one storey shows, grouped where
several continuations coincide. `continuationIssues()` reports what the cross-floor
topology says about itself that does not add up (a dangling port, a link that never leaves
one storey, disagreeing disciplines or service data). It reports; it never enforces, and
never repairs.

## Adding a symbol

Symbols live in `src/render/symbols/<category>.ts` and are aggregated by
[index.ts](src/render/symbols/index.ts). Add the symbol definition and its name in both
languages; tests enforce the registry and translations. They follow Dutch/NEN-style plan
conventions. Generated pages and tests read the registry rather than restating its size.

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
- Wrap in `withCtx()`, which handles `save`/`restore` and sets the stroke weight.
- **`mountHeight` is a convention, not a rule** — the ordinary height a device of this type
  is mounted at, or `"ceiling"` for one fixed to the soffit, which resolves against the
  storey rather than a constant. Set it only where a single ordinary height genuinely
  exists; a device whose height follows the fixture it serves carries none, and reads as
  unstated rather than as zero. An instance overrides it (`SymbolInstance.height`).

No separate published representation is required: `/symbolen/` replays
`draw()` through `recordSymbol` at build time, so a new symbol appears there, in the SVG
and DXF exports, and in the palette. Do not add a separately maintained symbol drawing.

**A thing built to a size is not a symbol.** A symbol is one fixed picture: its width and
depth are constants on the definition, and the mm figures are written into `draw()`. When
the same thing is built to a different size in every plan — a stair or cabinet — it is a
document object carrying its dimensions, with the drawing derived
(`src/model/{stair,vide,cabinet}.ts` and their `core/` and `render/` halves). Do not add
separate palette entries for every possible size.

Those objects extend the `draw(ctx)` contract by exactly one argument, which is what lets
`recordSymbol()` replay them: SVG, DXF and PNG need no per-kind code. The one thing the
recorder does NOT carry is a dash pattern — a dash is a screen concern — so a wall
cabinet, which is dashed because it hangs above the plan's section plane, gets that from
the SVG group and its own DXF layer instead.

## Operational constraints

- **Grid lines are always whole multiples of `doc.gridMm`.** `gridSteps()` in
  [src/render/grid.ts](src/render/grid.ts) steps the spacing up a 1-2-5 ladder until it is
  legible, so one square on screen is always a whole number of grid cells; the canvas
  legend names both drawn spacings. A fixed spacing would conflict with the panel's Grid
  (mm) value. `COLORS.grid` and `COLORS.gridMajor` use distinct lightness values so the
  major grid remains visually identifiable.
- **`GRID_DEFAULT_MM`** ([doc.ts](src/model/doc.ts)) is chosen so building measurements are
  rarely finer than one cell, and so the grid draws cell-for-cell at ordinary zoom instead
  of stepping up. It applies only to new plans.
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
- **`Store.mutate()` coalesces** same-`coalesceKey` mutations within a short window into one undo
  step. Drags rely on this; pass a stable key for continuous gestures and `undefined` for
  discrete edits.
- **`store.replace(doc, undoable)`** — `New`/`Demo`/`Open` pass `true` so Ctrl+Z restores
  the previous plan instead of showing a blocking confirm dialog (unavailable in sandboxed
  hosting anyway).
- **Keyboard shortcuts are window-level.** The current bindings live in `Tools.onKey()`
  and button titles. They can conflict with host-page shortcuts when the editor is
  embedded. `onKey` ignores
  INPUT/SELECT/TEXTAREA targets.
- **There are TWO layouts, and a change has to hold in both.** `layoutFor()` in
  [src/ui/layout.ts](src/ui/layout.ts) is the only breakpoint, and it decides `compact`
  against `wide` on both width and height. `Panel.mountShell()`
  re-parents the *same* elements between them rather than building a second set.
  Consequences for anything new:
  - **A new tool needs `tool.short<Name>` and `hint.touch<Name>`.** There is no `title`
    to hover without a mouse, and the desktop hints name clicks and keys. `tests/mobile.test.ts`
    fails if either is missing, or if a touch hint mentions a key or a mouse button.
  - **A shortcut belongs in a button's `title`, never in its label.** A phone has no
    key to press, and the label has to read the same either way.
  - **Anything that frames a view goes through `Tools.applyFit()`**, which insets by
    `viewInsets` — in the compact layout the chrome floats over a full-bleed canvas, so a
    fit that used the whole canvas would centre the plan behind the sheet.
  - **One finger is the tool, two navigate.** Placement acts on pointer*up*, so half a
    pinch never leaves an object behind; a tool that must act on contact (select, zoom)
    is listed explicitly in `onDown`.
  - Check a change at 390×844 and 844×390, not only at desktop width.
- **Verwarming is its own discipline, not a kind of water.** CV pipe is not tapwater
  pipe: it is sized on a different basis, ordered separately, and an installatietekening
  carries verwarming and sanitair as separate systems even where one installateur lays
  both. Aanvoer and retour are two legs because a radiator is reached by both — a plan
  drawing only the flow is short by half the pipe. `LayerKey` already carried a `heating`
  key for the symbols that no run could be drawn on; this is what it was missing.
- **`ServicePort.required` is a claim about the FIXTURE, not about the drawing's stage.**
  A douche needs warm water whether or not the water layer has been started, which is why
  the completeness check is a toggle rather than something the plan always says. Declare
  `required` only where a device demonstrably cannot work without it AND the model has
  that service; a rookmelder may be wired or on a battery, and the drawing cannot tell.
  `alt` is for the genuine either/or — a kookplaat is fed by gas OR by power.
- **Authored data may ride on a placed object where its MARK is one fixed picture.** A
  groepenkast's plan mark does not change with the number of groepen, so its name and its
  groepen are fields on the `SymbolInstance` (`model/board.ts`), guarded by type the way
  `Furnishing.cistern` is guarded by form. That is the other side of "a thing built to a
  size is not a symbol": what varies here is what the thing distributes, not its size.
- **What a run may end at is stated once**, in [attach.ts](src/core/attach.ts). The route
  tool asks it while drawing, and a device asks it while being placed or dropped — a
  socket landing on a loose end takes that end over, in the same mutation. Two copies of
  the rule would let the two gestures disagree, and the state they would disagree into is
  the bad one: an unanchored endpoint under a socket LOOKS wired, does not follow the
  socket when it moves, and still reports itself as loose. A wall-mounted device sits on
  the wall FACE while a concealed run hugs the centerline, so matching allows for half a
  wall and matches on a shared `wallId` regardless of the plan distance.
- **Every route-graph edit goes through [routegraph.ts](src/core/routegraph.ts)**, because
  a continuation names a point by (floorId, routeId, pointId): removing a point or folding
  one run into another has to drop or re-point the ports that named it. A port left naming
  something that is gone is skipped in silence, so the riser mark disappears from both
  storeys with nothing to say why.
- **Auto-routing proposes; it never owns.** [autoroute.ts](src/core/autoroute.ts) searches
  the wall graph and hands back plain waypoints the caller writes into an ordinary Route.
  Nothing records that a run was proposed, and nothing re-derives it afterwards — a
  proposed run is dragged, extended and deleted like any other.
- **A drawing convention belongs on the document, not on `Tools`.** `areaMode`, `dimMode`
  and `mountMarks` are read by the canvas AND by every export, so a sheet cannot show one
  thing on screen and another on paper. Editor state (`snapGrid`, `showUnderlay`, the
  layer toggles) is the opposite case and stays out of the document.
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
sells commercial exceptions. Consequences for changes here:

- **Keep the runtime dependency count at zero.** A vendored or npm runtime dependency adds
  a copyright holder and can restrict commercial licensing. Development dependencies do
  not ship in `dist/index.html`.
- **Don't paste in code from other projects** without checking its licence. AGPL-incompatible
  or unattributed code would have to be torn out later.
- **Every outside contributor signs the [CLA](CLA.md) before their first merge**, recorded in
  [`.github/cla-signatures.json`](.github/cla-signatures.json) and enforced by
  `.github/workflows/cla.yml`. Never merge an unsigned pull request, and never add a name to
  that file except by merging that contributor's own signing pull request — the check reads
  the file from the default branch precisely so a PR cannot approve its own author.
  Employed contributors also need the [Corporate CLA](CLA-CORPORATE.md), since their
  employer usually owns the copyright.

## Known limitations

Deliberate cuts, not oversights — check the [roadmap issues](https://github.com/irongollem/wallgraph/issues)
before changing one:

- Sloped or varying-thickness walls; a wall is one thickness, not a material build-up.
- Exact wall-to-arc miters (tangent-line approximation instead).
- Stair figures are reported, never enforced; a stair does not snap to a wall the way a
  wall-mounted symbol does.
- A corner cabinet is a rectangle with the room-facing corner cut, not an L-shaped
  carcass; cabinets carry no schedule and nothing checks unit overlap (a wall unit over
  a base unit is the normal case).
- A room takes one name; a second name in the same room stays unattached rather than
  merging.
- A mounting height is a convention where one exists and unstated where it does not; the
  takeoff reports what it excluded rather than assuming a figure. Nothing checks a height
  against the storey's own geometry, or against what NEN 1010 would accept.
- Auto-routing is shortest-along-walls with a stand-off. It knows nothing about vides,
  corridors or anything else it should prefer or avoid, and it will not route between two
  pieces of fabric that do not touch.
- The IFC export states route legs as MEP segments at a nominal cross-section, grouped
  into a distribution system per groep. No fittings, no risers as elements, no port
  connectivity — the document holds none of it — and a cable run's section is a
  placeholder, not a measurement.
- The permit sheet is bouwkundig and carries no services at all.
- Wall surface counts the two faces of a wall plus the reveals through it. A reveal is measured over
  the structural thickness only — cladding makes it deeper, but that is facade work — and a floor
  build-up is not modelled. A ceiling is one height per room, not a plenum with its own geometry.
