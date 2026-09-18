# Changelog

All notable changes to the Parking Lot Level Generator. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/) and the project uses
semantic versioning.

## [2.0.0] — Unreleased

A production-hardening pass: bug fixes, a faster and more capable generator,
new editor features, an accessibility layer, documentation and CI. It closes
with a **full interface pass** — one glass design system across both pages, an
in-app notification layer, and a layout built for phones rather than shrunk down
to them. No behaviour, API, route, data or user flow changed, and the suite grew
from 101 to 118 assertions (the one existing assertion that read
`css/style.css` now reads all three stylesheets, since a rule may live in any of
them).

### ⚠️ Behaviour changes

- **Generated levels differ from 1.x for the same seed.** Start/exit are drawn
  from one global shuffle (guaranteeing two distinct cells), the route modes
  build their detour by blocking paths, and 2.0 fixes the difficulty off-by-one
  — so the RNG stream and the fill order changed. Seeds stay fully deterministic
  *within* 2.0, and the suite verifies that over hundreds of seeds.
- **Route shapes now honour both the difficulty slider and their detour
  target.** Previously `Winding`/`Maze` ignored difficulty entirely, packed the
  lot to the 60 % ceiling (54–57 % in practice) and still landed short of their
  documented `1.6×`/`2.4×` detours. They now place about as many cars as the
  difficulty asks for, reliably reach the requested detour, and let extra cars
  lengthen the route further.
- **One grid range (4–60).** Generation previously stopped at 30×30 while
  loading accepted 60×60; both now use the same limits, which also makes
  *Resize* coherent. `MAX_SIZE_GEN`/`MAX_SIZE_LOAD` remain as aliases.
- **JSON export can omit the derived `grid` matrix** (checkbox in the JSON
  panel). The default is unchanged (included).
- Route shapes require **Guarantee solvable path**; the selector is disabled
  without it.

### Fixed

- `Level.difficultyLabel()` was off by one: difficulty 1 showed “Very Easy” and
  “Trivial” was unreachable. The ladder is now `1 Trivial … 10 Extreme`.
- `difficulty: 0` silently became the default 5 instead of clamping to 1;
  width/height/difficulty now share one `normalizeInt` rule.
- The export button's “blocked” style used a Bootstrap class
  (`btn-outline-warning`) that only worked through an accidental compound
  selector; it is now a real `.btn--danger-state` modifier.
- `fitZoom()` hard-coded the 30 px cell size and 4 px gap, so “Fit” drifted
  whenever the design tokens changed; it now reads `--cell-size`/`--cell-gap`
  and accounts for the missing trailing gap.
- Starting a drag and releasing the pointer outside the grid could leave the
  editor in “painting” state; pointer-up is now also bound on `window`.
- Releasing the pointer mid-stroke left the drag gesture open, occasionally
  merging two strokes into one undo step.
- `hashSeed()` re-coerced its input on every loop iteration.
- `randomSeed()` used `% 36` on 32-bit words, biasing the first characters; it
  now uses rejection sampling.
- Loading a level could write to `state.level` before a level existed (name
  field), and `App.init()` never ran when the script was evaluated after
  `DOMContentLoaded`.
- `sanitizeLevel()` cross-checked the embedded grid against a row that might
  not be an array, and iterated an unbounded car list.
- The file reader accepted anything with a `.json` name and rejected valid
  levels without one; it now sniffs content and refuses unrelated/binary types
  and files over 8 MB.
- **Check solvable** re-measured the route but left the status chip and route
  stat showing their previous values; the result now flows through the same
  stat pipeline as every other update.
- A `grid` matrix whose car *facings* disagreed with the `cars` list was
  silently normalised with no warning; the repair is now reported (contents and
  facings are checked separately).
- Removed the vestigial `data-bs-theme` attribute and the ignored `theme:`
  option passed to SweetAlert2 — leftovers from a Bootstrap-era prototype that
  made theming look handled when it was not.
- Docs/README claimed difficulty 1 was “Trivial” (it wasn't) and documented two
  different grid ranges.

### Added

- **Route shapes** — `Direct`, `Winding` (`≥1.6×` the straight-line distance)
  and `Maze` (`≥2.4×`). The detour is built by blocking the current shortest
  path and re-measuring, undoing any block that would seal the exit off, with
  greedy restarts when a blocking order paints itself into a corner.
- **Route overlay** — `Show route` highlights the shortest start→exit path and
  the **Route** chip reports its length in steps.
- **Undo / redo** — 60 steps, drag strokes grouped, `Ctrl/Cmd+Z`,
  `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`, plus toolbar buttons.
- **Share links** — `js/share.js` encodes the exact level (hand edits included)
  into a compact URL-safe code; `Copy link` puts it on the clipboard and
  `?level=…` links load straight into the editor.
- **PNG export** — `js/image.js` renders the lot to a captioned canvas image
  (themed, 2× scale, route only when visible).
- **Grid resize** — crop or pad a level, reporting dropped cars.
- **Level names** — optional `name` field, used by filenames and captions.
- **Session restore** — the last level, route toggle and export preference come
  back on the next visit (with a toast, and `localStorage` failures ignored).
- **Keyboard accessibility** — the grid is focusable, arrow keys move a cursor,
  <kbd>Enter</kbd>/<kbd>Space</kbd> applies the active tool, <kbd>Delete</kbd>
  removes and <kbd>R</kbd> rotates the car under the cursor, <kbd>Home</kbd>/
  <kbd>End</kbd> jump to start/exit, and a live region announces state changes.
- **Shortcut dialog** (<kbd>?</kbd>) and a tool shortcut map (<kbd>1</kbd>–<kbd>5</kbd>).
- **In-app documentation browser** (`docs.html`, `js/markdown.js`,
  `js/docs.js`, `css/docs.css`) with table of contents, filter and theme
  matching.
- **Offline by default** — icons became an inline SVG sprite (`js/icons.js`)
  instead of a webfont, and SweetAlert2 is vendored in `vendor/` (MIT) instead
  of loaded from a CDN. The editor now makes **zero network requests**, works
  from `file://`, behind a firewall and on an air-gapped machine, and no
  third-party script can change under it. `vendor/README.md` documents
  provenance, licences and how to refresh the files.
- **Tooling** — `tools/serve.js` (zero-dependency dev server, correct MIME
  types, traversal guard), `tools/dom-stub.js` (DOM stub for the UI suite),
  `tools/load-modules.js`, `.editorconfig`, `package.json` scripts and a GitHub
  Actions CI matrix.
- **Documentation** — rewritten README/USAGE/LEVEL_FORMAT/ARCHITECTURE/
  CONTRIBUTING plus new DESIGN.md, TESTING.md and this changelog, and an
  in-app browser (`docs.html`) that renders every document with a table of
  contents and a filter box.
- **One design system across both pages** — `css/style.css` (tokens,
  materials, shared primitives) plus `css/editor.css` and `css/docs.css` for the
  two surfaces. Every colour, radius, blur, shadow, duration, easing and z-index
  is a token; nothing is hard-coded per component.
- **Four glass materials** (navigation/dialogs, panels, floating surfaces, and a
  quieter tier for the board) with per-tier blur, saturation, inner highlight
  and ambient shadow, plus opaque fallbacks for
  `prefers-reduced-transparency: reduce` and browsers without
  `backdrop-filter`.
- **In-app toast layer** — notifications render into `#toastHost` as floating
  glass cards (stacked, deduped, auto-dismissing, hover-pauses the countdown,
  dismissible, announced through the toast host). SweetAlert2 keeps the modals,
  where focus trapping matters.
- **Determinate generation progress** — the veil shows a progress bar fed by the
  generator's `onProgress` callback instead of an indeterminate spinner.
- **Compact mobile rail** — a bottom navigation bar (small screens only) that
  hides while scrolling down, returns on scroll up, and highlights the section
  in view with a single sliding indicator.
- **Actionable empty state** — the empty-lot hint now offers a button that
  selects the add-car tool and puts the cursor on the board.
- **Live stat nudges** — stat values animate only when the underlying value
  actually changes.
- **Documentation skeleton** — the docs viewer shows a block-shaped loading
  placeholder that matches the article it is about to render.
- **Contrast-checked tint ink** — `--*-ink` tokens for text on tinted surfaces,
  so success/warning/danger chips clear WCAG AA on their own tint in both
  themes, not just on the page.
- **A design-system suite** — token references are resolved (a typo in a token
  name now fails the build instead of silently styling nothing), every custom
  property JS writes must be read by a rule, the dark theme may only override
  tokens the light theme declares, text and tinted-chip ink are checked against
  WCAG AA on their real surfaces in both themes, and the motion durations must
  stay inside their documented bands.
- **Two more guards** — every class used in markup must have a stylesheet rule
  (design-system audit), and UI tests may not be asynchronous (the shared DOM
  stub makes deferred assertions meaningless).

### Changed

- `js/pathfinding.js` now uses reusable typed-array workspaces with a stamp
  map instead of allocating per search, adds `shortestPathLength()`,
  `canReach()` and `createSolver()`, and validates coordinates instead of
  guessing.
- `js/app.js` coalesces all view work into one animation frame, throttles the
  JSON preview and skips it entirely while collapsed — drag-painting a 60×60
  grid no longer rebuilds a 200 KB string per cell.
- Toasts deduplicate identical messages within 1.2 s, so painting over the same
  cell cannot stack alerts.
- Copy actions share one clipboard ladder (async clipboard → hidden textarea →
  prefilled dialog) instead of two implementations.
- Snapshot tests were replaced by a 118-assertion suite (`tools/test.js`) that
  fuzzes BFS against a reference implementation, checks generation invariants
  over hundreds of seeds, verifies share-code round trips, Markdown rendering
  and XSS escaping, image geometry, performance budgets and HTML ⇄ JS ⇄ CSS
  wiring — and **boots the real controller** in a dependency-free DOM stub to
  exercise painting, undo/redo, the route overlay, keyboard navigation, file
  loading, share links and exports. `tools/smoke-test.js` was folded into it.
- **Typography** — a system stack with a real scale, restrained weights and
  tighter tracking on headings; metadata is muted rather than dim.
- **Layout** — floating glass header that gains a wash and shadow once content
  scrolls under it (`#appHeader.scrolled`), a two-column editor that collapses to
  a single column with a wide tool grid, and a documentation rail that becomes a
  horizontally scrollable pill strip on small screens.
- **Motion** — one vocabulary: micro 140 ms, standard 220 ms, structural 320 ms,
  entrances 460 ms; interactive motion springs, structural motion eases.
  Transform/opacity only, no animation loops, no animated blur.
- **Buttons, fields, sliders, switches** — `--fill`-painted range tracks, an
  animated switch knob, hover lift with press-scale, disabled = reduced opacity
  *and* saturation, and a visible accessible focus ring everywhere.
- **Dialogs and the drop overlay** — one floating-glass material, blurred
  backdrop, fade + rise + scale entrance and a shorter exit.
- **The board** — the deepest surface in the editor; it scrolls instead of
  clipping if a level cannot be fitted, pans with one finger when no tool is
  armed, and keeps its own state treatment (`is-empty`, `is-generating`).
- **Accessibility** — `--text-3`, success, warning and danger were re-tuned to
  clear 4.5:1 on both the page wash and the brightest glass; the toast host is
  the single polite live region for notifications.
- **Performance** — the background field is static (no animated blur) and the
  document skeleton is a static placeholder, so the only looping animations in
  the app are the loading spinner and the drop target's hint; the
  scroll handler coalesces the header wash, the rail and the section spy into
  one animation frame, and the toast layer is plain DOM instead of a library
  render.
- **Documentation** — `docs/DESIGN.md` rewritten as the design-system reference
  (layers, tokens, materials, components, motion bands, accessibility), and
  `docs/ARCHITECTURE.md`, `docs/TESTING.md` and `README.md` updated for the
  three-stylesheet split, the toast layer, the skeleton, the mobile rail and the
  new assertion count.

### Removed

- `tools/smoke-test.js` (superseded by `tools/test.js`).
- `tools/sri-hashes.js` (obsolete once the CDN links were removed).
- Dead CSS for the accidental `btn-outline-warning` compound selector.
- The `.lane-alt` cell variant, `.icon-slot`/`.icon--lg`, `.mat-inset` and the
  `md-inline-code` hook — all unused once the design system was consolidated.

## [1.0.0] — Initial release

- Deterministic seed-based generation with an optional solvable-path guarantee.
- Editor with add/remove/rotate cars, start/exit placement and drag-to-paint.
- Validation, import (picker + drag & drop), JSON export/copy, zoom, themes.
- Liquid Glass design system, dark/light themes, CDN icon/dialog layer.
- 40-assertion Node smoke test suite.
