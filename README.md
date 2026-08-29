# Wallgraph

[![CI](https://github.com/irongollem/wallgraph/actions/workflows/ci.yml/badge.svg)](https://github.com/irongollem/wallgraph/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](package.json)
[![Live](https://img.shields.io/badge/live-plattegrond.crocode.nl-e05d2d.svg)](https://plattegrond.crocode.nl)

A free, browser-based floorplan editor. mm-exact, wall-graph based, zero dependencies at runtime.

**→ Try it: [plattegrond.crocode.nl](https://plattegrond.crocode.nl)** — no account, nothing to install.

`npm run build` puts the whole editor in a single `dist/index.html` you can open offline or
host anywhere static; releases attach that same file as a download.

See [PLAN.md](PLAN.md) for the architecture and roadmap, and
[CONTRIBUTING.md](CONTRIBUTING.md) if you want to send a patch.

## Develop

```sh
npm install        # dev-only deps; the shipped bundle has zero dependencies
npm run dev        # watch build + http://localhost:5173  (PORT=3000 to change port)
npm run check      # typecheck + engine tests
npm run build      # typecheck + bundle to dist/index.html (single file)
```

`dist/index.html` is fully self-contained — host it anywhere static.

## Controls

- **W** wall tool — click to chain; type a length in mm + Enter for exact segments; O toggles angle snap, G toggles grid snap; Esc ends the chain
- **V** select — drag corners/walls/symbols; drag a selected wall's ◆ midpoint handle to curve it
- **D / N / P** door / window / passage — click on a wall; direction, width and offset in the panel
- **R / M** rotate / mirror a selected symbol · **Del** delete · **Ctrl+Z / Ctrl+Shift+Z** undo / redo
- Hover a placed symbol to see what it is; click to select and edit it
- Sliding a socket, door or window along a wall shows live dimensions to both wall ends,
  so "150 mm from the corner" is something you slide to rather than calculate
- **PNG** exports the plan as an image — framed to the plan, no grid, with a scale bar
- Scroll to zoom, right-drag or empty-space-drag to pan — the legend bottom-left names the
  document grid and, when the zoom is too far out to draw every cell, the spacing actually drawn

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

```text
src/geometry   vectors, bulge arcs
src/model      document schema, store/undo, graph ops (split/merge/clamp)
src/core       derived geometry: mitered wall outlines, room detection
src/render     viewport, scene renderer, symbol library
src/input      tool state machine, snapping, typed input
src/ui         toolbar + property panel
src/io         autosave + JSON import/export
```

## License

Copyright © 2026 Jeffrey Ernst.

Wallgraph is licensed under the [GNU AGPL v3](LICENSE). You may use, modify and
self-host it freely; if you run a modified version as a network service, the AGPL
requires you to offer that version's source to its users. Embedding Wallgraph in
another application (the Astro/Vue examples above included) puts that application
under the AGPL too.

**Commercial licensing is available.** If the AGPL doesn't fit — you want to embed
Wallgraph in a closed-source product or offer it as a hosted service without
publishing your changes — open an issue to start the conversation. As sole copyright
holder I can grant separate commercial terms.

## Contributing

Pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Because Wallgraph
is dual-licensed, contributors sign a one-time [CLA](CLA.md) before their first merge.
You keep the copyright to your work; the CLA grants a non-exclusive right to license
it, which is what keeps the commercial option open.
