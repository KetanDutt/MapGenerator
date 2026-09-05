# Contributing

Thanks for your interest in improving the Parking Lot Level Generator! This is
a small, dependency-light project — contributions are easy to make.

## Development setup

You only need Node.js (for the test script) and any static file server:

```bash
git clone https://github.com/KetanDutt/MapGenerator.git
cd MapGenerator

# Run the app
python3 -m http.server 8080        # → http://localhost:8080

# Run the tests (no npm install needed)
node tools/smoke-test.js
```

The exit code of `tools/smoke-test.js` is non-zero on failure, so it can be used
in CI directly.

## Project conventions

- **No build step and no framework for app code.** Keep the vanilla-JS,
  per-module `ParkingGen.*` namespace pattern (`js/rng.js`, `js/pathfinding.js`,
  `js/level.js`, `js/app.js`). Modules must work both in the browser and when
  `eval`ed in the Node test harness — i.e. attach to
  `globalThis`/`window`, never reference DOM at module top level (only inside
  functions/`init`).
- **The level model is authoritative**: `level.cars`, `level.start` and
  `level.end` are the source of truth; `level.grid` is always derived via
  `Level.rebuildGrid`. The DOM is a view. Preserve this invariant when adding
  features.
- Keep all theme colours and sizes in CSS variables in `css/style.css`.
- Match the existing code style: `'use strict'`, `const`/`let`, JSDoc comments
  on public functions, small focused functions.

## Before opening a PR

1. Run `node tools/smoke-test.js` — all assertions must pass.
2. Add tests for new generation/validation behaviour in
   `tools/smoke-test.js`.
3. Exercise the UI manually: generate with/without the solvable guarantee,
   edit (add/remove/rotate/drag), load a broken JSON file, export, toggle the
   theme, and check mobile/narrow widths.
4. Update docs where relevant (`README.md`, `docs/USAGE.md`,
   `docs/LEVEL_FORMAT.md`).

## Suggested extension points

- **New obstacle/terrain types** — extend the cell `type` union in
  `level.js` (`createEmptyGrid`/`rebuildGrid`), `sanitizeLevel`, the BFS
  blocking rules in `pathfinding.js`, and `paintCell`/`app.js`.
- **Path visualisation** — `Pathfinding.findShortestPath` already returns the
  cell list; highlight it on the grid with a temporary CSS class.
- **Level metadata** — author name, par target, time limit: add optional fields
  to the generated level and whitelist them in `sanitizeLevel`.
- **Undo/redo** — snapshot the level object (JSON round-trip) on each edit and
  restore on Ctrl/Cmd+Z.
- **Alternative generators** — maze-based lots, themed patterns; plug in beside
  `Level.generateLevel` and expose a selector.

## Filing issues

Please include: browser/OS, steps to reproduce, the seed/settings (or the JSON
file) involved, and a screenshot or console error if available.

## License

By contributing you agree that your contributions are licensed under the
project's [MIT License](../LICENSE).
