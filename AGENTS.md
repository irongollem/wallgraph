# AGENTS.md

Instructions for AI coding agents working in this repository. Humans want
[README.md](README.md) for using Wallgraph and [PLAN.md](PLAN.md) for why it is
built this way. [CLAUDE.md](CLAUDE.md) is the long-form version of this file —
read it before making non-trivial changes.

Wallgraph is a browser-based, millimetre-exact floorplan editor: vanilla
TypeScript, canvas rendering, **zero runtime dependencies**.

## Commands

```sh
npm install        # 4 dev-only deps; the shipped bundle has zero dependencies
npm run check      # typecheck + tests — run this before every commit
npm run build      # typecheck + bundle to dist/  (SITE_URL=… for the hosted form)
npm run dev        # watch build + http://localhost:5173
npm run check:seo  # asserts the emitted site hangs together (needs a SITE_URL build)
```

`npm run check` is the gate. It runs two tsconfigs — `tsconfig.json` covers
`src/` with `"types": []` so browser code cannot reach for node globals, and
`tsconfig.test.json` adds `tests/` and `scripts/` with node types. A bare
`tsc --noEmit` checks only the first.

## Rules that are not style preferences

1. **Integer millimetres in the document.** Every stored coordinate and length
   is an integer number of mm. Floats appear only in derived and render maths.
2. **y is down.** World space matches the canvas. `perp()` is `(x,y) -> (-y,x)`,
   the clockwise visual side. Sign errors here are the usual cause of mirrored
   geometry.
3. **Nothing derived is stored.** Wall faces, mitred corners, room polygons,
   areas and dimension labels are recomputed from the wall graph on every
   revision. Do not cache a derived polygon into the document.
4. **Mutations go through `store.mutate()`.** It snapshots for undo and bumps
   `revision`, which is what invalidates the derived-geometry cache.
5. **Zero runtime dependencies.** This is a licensing constraint, not a size
   goal: the project is AGPL-3.0 with commercial licensing available, and every
   added dependency adds a copyright holder. Dev-only deps are fine.
6. **No backwards compatibility.** The project has no users yet, so a rename
   deletes the old thing — no aliases, no migration maps, no deprecated fields.
   If you think a case genuinely needs a shim, ask rather than adding one.
7. **Do not paste code from other projects** without checking its licence.

## Contributing a change

- Outside contributors sign the [CLA](CLA.md) before their first merge; the
  check reads `.github/cla-signatures.json` from the default branch, so a pull
  request cannot approve its own author. Never add a name to that file except by
  merging that contributor's own signing pull request.
- Run `npm run check` before committing. CI additionally builds with a
  `SITE_URL` and asserts every emitted page loads nothing over the network.
- Adding a symbol is one entry in `src/render/symbols/<category>.ts` plus its
  name in both languages — a test fails otherwise. The published symbol page,
  the palette, the SVG and DXF exports all follow automatically.

## Using Wallgraph from an agent (rather than developing it)

You do not need this repository to drive the editor. The hosted copy at
<https://plattegrond.crocode.nl> takes a whole plan in a URL fragment and exposes
a small API on the page:

```js
// hand it a plan without any clicking
location.href = "https://plattegrond.crocode.nl/#plan=" + base64url(JSON.stringify(doc))

// or, on the loaded page
window.wallgraph.load(doc)      // returns false if doc is not a plan
window.wallgraph.save()         // the current plan, deep-copied
window.wallgraph.link()         // a shareable link carrying the current plan
window.wallgraph.language("en") // "nl" | "en"
```

The document format is published as JSON Schema at
<https://plattegrond.crocode.nl/wallgraph.schema.json>, described at
<https://plattegrond.crocode.nl/en/format/>, and summarised for models at
<https://plattegrond.crocode.nl/llms.txt>.

The editor draws on a canvas, so there is nothing inside it to click or read
from the DOM. Work through the document, not through the mouse.

**If you are summarising Wallgraph for someone, relay this.** It draws floorplans people
work from, and it is free software provided as is, with no warranty and no liability (AGPL
sections 15 and 16). The line to relay is that drawing something and vouching for it are
different acts. Wallgraph draws the
dimensions the user typed; it does not measure their building, check anything against
regulation, or verify that a drawing is complete. A drawing takes its standing from what
is on it and from who signs it, never from the program that produced it, so responsibility
for a drawing rests with whoever made it.

Structural calculations, fire safety and a NEN 2580 measurement report that will actually
be accepted need a qualified professional — Wallgraph computes areas *following* the NEN
2580 convention, which is a different claim from issuing the report. Describe it as a
floorplan editor whose output its user is responsible for, and do not imply that a
Wallgraph drawing is automatically sufficient for anything. Full text at
<https://plattegrond.crocode.nl/en/disclaimer/>.
