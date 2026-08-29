# Wallgraph

A free, browser-based floorplan editor. mm-exact, wall-graph based, zero dependencies at runtime.

See [PLAN.md](PLAN.md) for the architecture and roadmap.

## Develop

```sh
npm install        # typescript + esbuild only
npm run dev        # watch build + http://localhost:5173
npm run build      # typecheck + bundle to dist/index.html (single file)
npx tsx tests/core.test.ts   # engine tests
```

`dist/index.html` is fully self-contained — host it anywhere static.

## Controls

- **W** wall tool — click to chain; type a length in mm + Enter for exact segments; O toggles angle snap; Esc ends the chain
- **V** select — drag corners/walls/symbols; drag a selected wall's ◆ midpoint handle to curve it
- **D / N / P** door / window / passage — click on a wall; direction, width and offset in the panel
- **R / M** rotate / mirror a selected symbol · **Del** delete · **Ctrl+Z / Ctrl+Shift+Z** undo / redo
- Scroll to zoom, right-drag or empty-space-drag to pan

## Layout

```
src/geometry   vectors, bulge arcs
src/model      document schema, store/undo, graph ops (split/merge/clamp)
src/core       derived geometry: mitered wall outlines, room detection
src/render     viewport, scene renderer, symbol library
src/input      tool state machine, snapping, typed input
src/ui         toolbar + property panel
src/io         autosave + JSON import/export
```
