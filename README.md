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

## Embedding in Astro / Vue (or anything else)

The editor is a plain function: give it an element, it builds itself inside.
No framework runtime, no globals except window key listeners.

```ts
import { mountWallgraph } from "wallgraph/src/main";  // or a relative path
import "wallgraph/src/style.css";                     // Vite/Astro handle CSS imports

mountWallgraph(document.getElementById("editor")!);
```

Astro page (client-side, since it needs the DOM):

```astro
<div id="editor" style="height: 100vh"></div>
<script>
  import { mountWallgraph } from "../lib/wallgraph/src/main";
  import "../lib/wallgraph/src/style.css";
  mountWallgraph(document.getElementById("editor")!);
</script>
```

Vue component:

```vue
<template><div ref="host" class="wallgraph-host" /></template>
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { mountWallgraph } from "@/lib/wallgraph/src/main";
import "@/lib/wallgraph/src/style.css";
const host = ref<HTMLElement>();
onMounted(() => mountWallgraph(host.value!));
</script>
```

Give the host element a real height (the editor fills it). Note `.app` uses
`height: 100%`, and document-wide key shortcuts (V/W/D/…) are window-level —
fine for a dedicated page, something to scope later if it must share a page
with other inputs.

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
