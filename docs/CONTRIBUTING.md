# Contributing

Thanks for your interest in improving the Parking Lot Level Generator! This is
a small, dependency-free project — contributions are easy to make and review.

## Development setup

You only need Node.js (for the tooling) and a browser:

```bash
git clone https://github.com/KetanDutt/MapGenerator.git
cd MapGenerator

# Run the app (zero-dependency dev server with correct MIME types)
npm run serve                # → http://localhost:8080

# Run the tests (no npm install needed — there are no dependencies)
npm test
```

`tools/test.js` exits non-zero on failure, so it can be wired into CI as-is
(see `.github/workflows/ci.yml`). `node tools/test.js --filter=<suite>` runs a
subset while you iterate; see [TESTING.md](TESTING.md) for the suite layout and
the manual release checklist.

## Project conventions

- **No build step and no framework for app code.** Keep the vanilla-JS,
  per-module `ParkingGen.*` namespace pattern (`js/rng.js`, `js/pathfinding.js`,
  `js/level.js`, `js/share.js`, `js/image.js`, `js/markdown.js`, `js/app.js`).
  Modules must work in the browser **and** when evaluated inside Node by
  `tools/load-modules.js` — attach to `globalThis`/`window` and never touch the
  DOM at module top level (only inside functions).
- **No new runtime dependencies, and no network calls.** The app must keep
  working offline and over `file://`. Icons go in the `js/icons.js` sprite
  (`<svg class="icon"><use href="#i-name"></use></svg>`); anything vendored goes
  in `vendor/` with its licence, provenance and a fallback path.
- **The level model is authoritative**: `level.cars`, `level.start` and
  `level.end` are the source of truth; `level.grid` is always derived via
  `Level.rebuildGrid`. The DOM is a view. Preserve this invariant when adding
  features.
- **Untrusted input goes through `Level.sanitizeLevel`** (files, share codes,
  restored sessions) and every repair must be surfaced to the user.
- **Performance**: search with the reusable workspaces from
  `Pathfinding.createWorkspace`/`createSolver`, and route DOM/JSON updates
  through `scheduleViewSync()` — never do heavy work inside a pointer handler.
- Keep all theme colours and sizes in CSS variables in `css/style.css`, and add
  a rule for any class JS toggles (the test suite enforces this).
- Match the existing code style: `'use strict'`, `const`/`let`, JSDoc comments
  on public functions, small focused functions, comments that explain *why*.

## Before opening a PR

1. Run `npm test` — all assertions must pass (the UI suite boots the real app
   in a DOM stub, so wiring mistakes fail here rather than in your browser).
2. Add assertions for new generation/validation/serialisation behaviour in
   `tools/test.js` and mention the suite in your PR description.
3. Exercise the UI manually (the checklist in
   [TESTING.md](TESTING.md#manual-checklist) covers generate/edit/load/export,
   dark mode, keyboard navigation and narrow screens).
4. Update documentation where relevant: `README.md`, `docs/USAGE.md`,
   `docs/LEVEL_FORMAT.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md` and add a
   `docs/CHANGELOG.md` entry under “Unreleased”.
5. Keep the diff focused — one topic per pull request.

## Extension points

- **New obstacle or terrain types** — extend the cell `type` union in
  `level.js` (`createEmptyGrid`/`rebuildGrid`), `sanitizeLevel`, the blocking
  rules in `pathfinding.js`, and `paintCell` in `app.js`. Remember the
  matching cell styles and the JSON schema documentation.
- **New generation styles** — add a mode to `Level.ROUTE_MODES` plus its
  strategy inside `generateLevel`. The density pass (place, measure, roll back
  anything that seals the route) is the template to copy.
- **Alternative path metrics** — `Pathfinding` exposes both the cell list and
  the raw step count; anything else (weighted costs, corner penalties) fits
  best as a new function next to `shortestPathLength`.
- **Editor features** — the pattern is: mutate through an edit helper (so the
  history snapshot, `carSet` index and cell repaint all happen), then let
  `scheduleViewSync()` update the panels. New tools need a button, an entry in
  `MODE_TEXT`/`MODE_BUTTONS`, and a case in `applyEdit`.
- **Renderer targets** — `js/image.js` is deliberately split into pure geometry
  (`computeLayout`) and canvas drawing; an SVG or Tiled exporter can reuse the
  first and swap the second.
- **UI surfaces** — the design tokens in `css/style.css` cover colour, glass,
  motion and geometry; see [DESIGN.md](DESIGN.md) before inventing new values.

## Commit and review notes

- Prefer descriptive commit subjects (`Fix off-by-one in difficulty labels`)
  over `fix stuff`.
- In the PR description, include the seed/settings you tested with (or a share
  link) — they make level-generation changes reproducible.
- Screenshots are welcome for UI changes; a PNG export from the app is a handy
  before/after artefact.

## Filing issues

Please include: browser/OS, steps to reproduce, the seed/settings (or the JSON
file / share link) involved, and a screenshot or console error if available.

## License

By contributing you agree that your contributions are licensed under the
project's [MIT License](../LICENSE).
