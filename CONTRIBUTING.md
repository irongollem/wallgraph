# Contributing to Wallgraph

Contributions are welcome. Please read the CLA section first — it is the one step that
cannot be skipped.

## The CLA, and why it exists

Wallgraph is **dual-licensed**: published under the GNU AGPL v3, and offered under separate
commercial terms to parties for whom the AGPL is unsuitable. Only the copyright holder can
grant a commercial licence. If contributed code were owned by its authors alone, every
future commercial licence would need permission from every past contributor — in practice
that ends dual-licensing permanently, because one unreachable contributor is enough.

So before your first pull request can be merged, please sign the
[Individual Contributor License Agreement](CLA.md). You **keep the copyright** to your
work and may use it however you like; you grant the maintainer a non-exclusive right to
license it, including under commercial terms.

### Signing

One time, covering all your future contributions:

1. Open a pull request adding yourself to [`.github/cla-signatures.json`](.github/cla-signatures.json):

   ```json
   { "username": "your-github-username", "name": "Your Full Name", "date": "2026-01-31" }
   ```

2. Title it `CLA: sign for @your-github-username` and include this in the description:

   > I have read the Wallgraph Individual Contributor License Agreement and I hereby agree
   > to its terms for all of my present and future Contributions to the Project.

3. Once it is merged, the automated CLA check passes on all your pull requests.

**Contributing for an employer?** In most jurisdictions your employer owns code you write
in the course of employment, so your personal signature may not grant rights you hold. Have
them execute the [Corporate CLA](CLA-CORPORATE.md) as well.

**Third-party code.** Don't paste in code from elsewhere unless you flag it explicitly with
its source and licence. Anything the maintainer cannot relicense commercially — GPL, AGPL
and most copyleft code included — can't be merged, however good it is.

## Before you open a pull request

```sh
npm install
npm run check     # typecheck (src + tests) and the engine tests — must pass
npm run build     # must produce a self-contained dist/index.html
```

CI runs exactly these, so a green local `npm run check` usually means a green PR.

## House rules

[CLAUDE.md](CLAUDE.md) is the short version of the architecture and its invariants — worth
five minutes before a first change. The ones that bite hardest:

- **Integer millimetres in the document.** Floats belong in derived/render math only.
- **Everything visible is derived.** Wall faces, corners, rooms and areas are recomputed
  from the wall graph; never store them in the document.
- **All mutations go through `store.mutate()`**, which drives both undo and the
  derived-geometry cache invalidation.
- **Keep runtime dependencies at zero.** The shipped `dist/index.html` has none, and every
  added dependency is another copyright holder in the licensing chain. Dev-only tooling is
  fine.
- `strict` is on with `noUnusedLocals`/`noUnusedParameters`. Prefix a deliberately unused
  parameter with `_` rather than adding a `void x;` statement.

Match the surrounding code — comment density, naming and idiom included. Small, focused
pull requests get reviewed fastest.

## Reporting bugs

Include the plan JSON if you can (**Copy** in the toolbar puts it on your clipboard), plus
your browser and what you expected instead. Geometry bugs are much easier to fix from a
document that reproduces them.

## Commercial licensing

If the AGPL doesn't fit your use — embedding Wallgraph in a closed-source product, or
running it as a hosted service without publishing your changes — open an issue to start
the conversation.

<!-- CLA workflow smoke test — this branch is not for merge. -->
