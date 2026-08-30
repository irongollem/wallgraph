# Wallgraph — working notes for Claude

A browser-based, mm-exact floorplan editor. Vanilla TypeScript, canvas rendering,
**zero runtime dependencies** — `typescript`, `esbuild`, `tsx` and `@types/node` are
dev-only and never reach the bundle.

Licensed AGPL-3.0-only with commercial terms available, which makes the dependency count
and the [CLA](CLA.md) load-bearing rather than cosmetic — see *Licensing constraint* below.

Read [PLAN.md](PLAN.md) for the full architecture rationale and roadmap; this file is the
operational summary — the invariants you must not break and the commands that verify it.

## Commands

```sh
npm install        # 4 dev-only deps; the shipped bundle has zero dependencies
npm run dev        # esbuild watch + static server on http://localhost:5173 (PORT overrides)
npm run check      # typecheck + tests — run this before every commit
npm run build      # typecheck + bundle -> dist/ (index.html ~161 kB, plus the site)
npm run typecheck  # tsc over src/ (browser) and tests/+scripts/ (node) separately
npm test           # 325 checks across six suites, exits non-zero on failure
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

Two tsconfigs on purpose: [tsconfig.json](tsconfig.json) covers `src/` with `"types": []`
so browser code cannot accidentally reach for node globals;
[tsconfig.test.json](tsconfig.test.json) adds `tests/` and `scripts/` with node types —
the build and the site generator are TypeScript and import from `src/`, so they are
typechecked too. `npm run typecheck` runs both — if you only run bare `tsc --noEmit`,
neither tests nor the build are checked.

`strict` is on with `noUncheckedIndexedAccess` (indexing needs `!` or a guard) plus
`noUnusedLocals`/`noUnusedParameters` — prefix a genuinely unused parameter with `_`
rather than adding a `void x;` statement.

## The one idea

**The document is a planar graph of wall centerlines. Everything visible is derived.**

Stored: nodes (junctions), walls (centerline edges with thickness + optional arc bulge),
openings parameterised along a wall, symbol instances.

Never stored: wall faces, mitered corners, room polygons, areas, dimension labels. These
are recomputed by `src/core/` on every document revision. If you find yourself wanting to
cache a derived polygon *into the document*, that is the wrong move — cache it next to the
revision counter instead (see `derived()` in [src/main.ts](src/main.ts)).

This is why doors cut walls for free, why room detection works, and why a future 3D view
extrudes directly from the graph.

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

That is a cost decision rather than an oversight — a shim added now is permanent weight
carried for a user who does not exist. **If you think a case genuinely needs
compatibility, stop and ask before adding it.** Do not infer the answer from the code: it
changes the day the app has real users, and picking that day is the user's call.

## Layout

```text
src/geometry/  vec.ts    2D math, polygon area/centroid, line + segment helpers
               arc.ts    bulge arcs: info, length, point/tangent at t, flatten, sagitta
src/model/     doc.ts    document schema + defaults + id generation
               store.ts  mutable doc, snapshot undo/redo, change notification
               ops.ts    graph maintenance: nodeAt, splitWall, mergeNodes, clampOpening
src/core/      resolve.ts  mitered wall outlines, solid pieces between openings
               rooms.ts    half-edge face walk -> room polygons + areas
src/render/    viewport.ts mm<->px transform, zoom-to-cursor, pan
               grid.ts     drawable grid spacing for a zoom (multiples of gridMm)
               draw.ts     immediate-mode scene render + COLORS palette
               symbols/    77 symbols in 7 category files behind one interface
src/input/     tools.ts  tool state machine, snapping, typed-mm entry, drag handling
src/ui/        panel.ts    header, tool rail, storey row, properties, status, foot
               palette.ts  symbol palette: search, fold-out categories, tile grid
               menu.ts     document menu popover (new/open/save/PNG/paste, docs, language)
               icons.ts    the SVG icon set -- one 20x20 grid, one shape table
src/io/        json.ts   guarded localStorage autosave, export/import/clipboard
               image.ts  PNG export: offscreen re-render, plan bounds, scale bar
               svg.ts    SVG export at true scale; primSvg() is shared with the site
               dxf.ts    DXF export: layers, millimetres, y flipped for CAD
               marks.ts  the geometry one opening contributes, as plain primitives
               record.ts replays a symbol's canvas calls as geometry (no canvas needed)
               link.ts   a whole plan in a URL fragment, base64url
               save.ts   the two file-delivery channels (host capability, blob link)
src/i18n.ts              i18next-shaped nl/en bundle + the ~130-string engine
src/links.ts             where the docs live, resolved per context (see Gotchas)
src/seed.ts              demo apartment shown on first load
scripts/build.ts         esbuild bundle -> dist/index.html, then the site
scripts/site/  meta.ts   one source of truth for what the site says about itself
               html.ts   head tags, JSON-LD, page shell, the site stylesheet
               pages.ts  the five content pages, drawn from the app's own code
               files.ts  robots.txt, sitemap, llms.txt, manifest, security.txt
               schema.ts the published JSON Schema + the validator tests use
               sw.ts     the service worker, network-first on purpose
```

The graphify knowledge graph (`graphify-out/`, gitignored — it embeds local absolute
paths) clusters this into 15 communities. The three tightest couplings worth knowing:
`resolve.ts` ↔ `arc.ts` (miters need arc-aware tangents), `tools.ts` ↔ `ops.ts` (every
edit is a graph operation), and `main.ts` as the only place the store, viewport, renderer
and tools meet.

**God nodes** (most-connected, so the riskiest to change): `v()`, `Tools`, `Vec`,
`dist()`, `resolveFloor()`. `Tools` at 40 edges is the class to be most careful with —
it's a 780-line state machine that owns all canvas pointer and keyboard handling.

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
inner-face — that's a known P1 item, don't "fix" it silently.

Both are verified by [tests/core.test.ts](tests/core.test.ts), including the sign
convention, a T-junction finiteness check, and door-splits-wall-into-2-pieces.

## Adding a symbol

Symbols live in `src/render/symbols/<category>.ts` and are aggregated by
[index.ts](src/render/symbols/index.ts). One entry = one new symbol; nothing else needs
touching. Current count: 77 across electrical (23), safety (15), sanitary (9), water (9),
furniture (8), heating (7), kitchen (6) — Dutch/NEN-style plan conventions.

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

Nothing else needs touching, the published symbol page included: `/symbolen/` replays
`draw()` through `recordSymbol` at build time, so a new symbol appears there, in the SVG
and DXF exports, and in the palette from the one entry. A second, hand-drawn copy of a
symbol anywhere would be wrong within a release — and wrong in the worst way, since a page
that authoritatively shows a mark would be showing a different mark from the editor.

## Gotchas

- **Grid lines are always whole multiples of `doc.gridMm`.** `gridSteps()` in
  [src/render/grid.ts](src/render/grid.ts) steps the spacing up a 1-2-5 ladder until it is at
  least 6 px, so one square on screen is always a whole number of grid cells; the canvas
  legend names both drawn spacings. Don't reintroduce a fixed spacing (it used to be a
  hardcoded 1 m) — that made the canvas silently disagree with the panel's Grid (mm) value.
  `COLORS.grid` and `COLORS.gridMajor` are deliberately far apart in lightness: the sub-grid
  recedes, the metre grid is the one you read distances off. Keep that separation.
- **`GRID_DEFAULT_MM` is 100** ([doc.ts](src/model/doc.ts)) — building measurements are rarely
  finer, and it draws cell-for-cell at ordinary zoom instead of stepping up. Documents saved
  before this keep whatever `gridMm` they stored; the default only applies to new plans.
- **Grid snapping is a toggle** (`Tools.snapGrid`, G). Off still rounds to whole mm, so
  invariant 1 holds either way — quantise through `Tools.gridStep`, not `doc.gridMm`.
- **Wall-placement dimensions go on the cursor's side of the wall.**
  `drawWallOffsets()` in [tools.ts](src/input/tools.ts) draws the two distances to the wall
  ends while a symbol or opening is slid along it. Two conventions that look arbitrary but
  aren't: it uses `cursorSide()`/`wallSnap().side`, because the far side lands outside the
  building and off-canvas when you zoom in on an exterior wall from inside; and labels are
  placed by `visibleMid()`, which clips the segment to the canvas, because zooming in to
  place precisely is exactly when a wall end leaves the screen. Distances are
  centerline-to-node, like `t` and the panel's "from corner".
- **PNG export re-renders through `drawScene`, it does not screenshot the canvas.**
  [src/io/image.ts](src/io/image.ts) fits an offscreen `Viewport` to `planBounds()` and drives
  the same hidpi path the retina canvas uses (`vp.dpr` + a scaled transform), so screen-space
  text scales with the image. `planBounds()` walks the *rotated footprint corners* of each
  symbol — a symmetric box around the anchor pads the frame with empty paper, because a
  wall-mounted footprint only extends one way. Grid and legend are off via `extras.showGrid`.
- **Autosave uses the storage key `floorplan-doc-v1`**, from before the project was named
  Wallgraph. Renaming it drops whatever that key holds — your own browser's plan included —
  which makes it exactly the kind of case *No legacy* says to raise first. Don't migrate it
  and don't rename it on your own judgement; ask.
- **`Store.mutate()` coalesces** same-`coalesceKey` mutations within 900 ms into one undo
  step. Drags rely on this; pass a stable key for continuous gestures and `undefined` for
  discrete edits.
- **`store.replace(doc, undoable)`** — `New`/`Demo`/`Open` pass `true` so Ctrl+Z restores
  the previous plan instead of showing a blocking confirm dialog (unavailable in sandboxed
  hosting anyway).
- **Keyboard shortcuts are window-level** (V/W/D/N/P/O/G/L/R/M/Del). Fine for a dedicated
  page; they will fight other inputs if the editor shares a page. `onKey` bails on
  INPUT/SELECT/TEXTAREA targets, which is the only guard today.
- **Everything is single-floor.** `store.floor` is hardcoded to `doc.floors[0]!` even
  though the schema is a `floors[]` array. Multi-floor is P1.
- **All storage access is in try/catch** — `localStorage` can throw outright in sandboxed
  or privacy-mode contexts, not just return null. `src/io/json.ts` also probes a hosted
  `window.claude` downloads capability before falling back to a blob link, then to
  clipboard.
- **Rendering is immediate-mode and full-redraw**, coalesced through one
  `requestAnimationFrame`. Documents at this scale redraw in well under a frame; don't add
  dirty-rect machinery until profiling says otherwise.
- **`npm run dev` watches `src/style.css` separately.** esbuild only watches `boot.ts`'s
  import graph, and the stylesheet is not in it — the build reads it at emit time. Without
  the extra watcher a CSS-only edit rebuilt nothing and looked exactly like a rule that
  does not work. Editing `scripts/` still needs a restart: those modules are already
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
- **The service worker is network-first, deliberately.** [netlify.toml](netlify.toml) sets
  `Cache-Control: no-cache` on the HTML so no proxy pins an old editor, and a service
  worker is a proxy in the user's browser that outlives the tab. Cache-first would be
  exactly that stale editor and far harder to dislodge. The cache is a fallback for when
  the network fails and nothing else; `check:seo` fails if that inverts.

## Licensing constraint

Wallgraph is **AGPL-3.0-only**, dual-licensed — Jeffrey Ernst is sole copyright holder and
sells commercial exceptions. Three consequences for changes here:

- **Keep the runtime dependency count at zero.** It's not just a size goal any more: every
  vendored or npm runtime dependency adds a copyright holder, which erodes the ability to
  grant commercial licenses. Dev-only deps (`typescript`, `esbuild`, `tsx`, `@types/node`)
  are fine — they don't ship in `dist/index.html`.
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

Sloped or varying-thickness walls, exact wall-to-arc miters, stairs, mobile/touch UX,
dimension chains. These are choices, not oversights — check PLAN.md's phase list before
"fixing" one. (Net room area, i18n and multi-floor were on this list and have since
shipped; PLAN.md's phase list is the current one.)
