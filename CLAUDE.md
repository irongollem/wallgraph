# Wallgraph — working notes for Claude

A browser-based, mm-exact floorplan editor. Vanilla TypeScript, canvas rendering,
**zero runtime dependencies**. `esbuild` + `typescript` are the only devDeps.

Read [PLAN.md](PLAN.md) for the full architecture rationale and roadmap; this file is the
operational summary — the invariants you must not break and the commands that verify it.

## Commands

```sh
npm install                  # typescript + esbuild only
npm run dev                  # esbuild watch + static server on http://localhost:5173
npm run build                # tsc --noEmit && bundle -> dist/index.html (single file, ~69 kB)
npm run typecheck            # tsc --noEmit
npx tsx tests/core.test.ts   # engine tests — 19 checks, exits non-zero on failure
```

`tsx` is intentionally *not* a devDependency — `npx` fetches it on demand, keeping the
dependency list at two packages. `dist/index.html` is fully self-contained (CSS + JS
inlined); host it on any static server.

Always run **both** `npx tsx tests/core.test.ts` and `npm run build` before committing —
the tests cover the geometry engine, and `tsc` is `strict` with
`noUncheckedIndexedAccess`, so indexing always needs `!` or a guard.

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
6. **`mountWallgraph(el)` is the public API.** No globals beyond window-level key
   listeners. [src/boot.ts](src/boot.ts) is only the standalone-page entry; frameworks
   (Astro/Vue/etc.) call `mountWallgraph` directly. Don't add module-level side effects to
   [src/main.ts](src/main.ts).

## Layout

```
src/geometry/  vec.ts    2D math, polygon area/centroid, line + segment helpers
               arc.ts    bulge arcs: info, length, point/tangent at t, flatten, sagitta
src/model/     doc.ts    document schema + defaults + id generation
               store.ts  mutable doc, snapshot undo/redo, change notification
               ops.ts    graph maintenance: nodeAt, splitWall, mergeNodes, clampOpening
src/core/      resolve.ts  mitered wall outlines, solid pieces between openings
               rooms.ts    half-edge face walk -> room polygons + areas
src/render/    viewport.ts mm<->px transform, zoom-to-cursor, pan
               draw.ts     immediate-mode scene render + COLORS palette
               symbols/    74 symbols in 7 category files behind one interface
src/input/     tools.ts  tool state machine, snapping, typed-mm entry, drag handling
src/ui/        panel.ts  toolbar, symbol palette, selection-driven property panel
src/io/        json.ts   guarded localStorage autosave, export/import/clipboard
src/seed.ts              demo apartment shown on first load
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
touching. Current count: 74 across electrical (23), safety (12), sanitary (9), water (9),
furniture (8), heating (7), kitchen (6) — Dutch/NEN-style plan conventions.

The `draw(ctx)` contract in [defs.ts](src/render/symbols/defs.ts) is strict:

- `ctx` is pre-transformed so **1 unit = 1 mm**.
- Origin is the anchor: wall-mounted → midpoint of the wall-touching edge with `+y` into
  the room; free-standing → centre of the footprint.
- **Never set `strokeStyle`/`fillStyle`** — the caller owns colour (selection highlighting
  depends on this). Small filled position dots (radius ≤ 15 mm) via `ctx.fill()` are the
  only exception.
- **No text.** `ctx.fillText` is forbidden; labels are drawn in screen space by the caller.
- Wrap in `withCtx()`, which handles `save`/`restore` and sets `lineWidth = 20`.

## Gotchas

- **`package.json` is still named `floorplan`** and autosave uses the key
  `floorplan-doc-v1`. Renaming the storage key silently discards every user's saved plan —
  if you rename it, migrate.
- **`Store.mutate()` coalesces** same-`coalesceKey` mutations within 900 ms into one undo
  step. Drags rely on this; pass a stable key for continuous gestures and `undefined` for
  discrete edits.
- **`store.replace(doc, undoable)`** — `New`/`Demo`/`Open` pass `true` so Ctrl+Z restores
  the previous plan instead of showing a blocking confirm dialog (unavailable in sandboxed
  hosting anyway).
- **Keyboard shortcuts are window-level** (V/W/D/N/P/O/L/R/M/Del). Fine for a dedicated
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

## Deliberate P0 cuts

Sloped or varying-thickness walls, exact wall-to-arc miters, net (inner-face) room area,
stairs, mobile/touch UX, i18n, multi-floor. These are choices, not oversights — check
PLAN.md's phase list before "fixing" one.
