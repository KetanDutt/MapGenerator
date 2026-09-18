# Architecture

The app is a small set of dependency-free vanilla-JS modules plus a
self-contained "Liquid Glass" CSS design system, an inline SVG icon sprite and a
**vendored** (but optional) SweetAlert2 dialog layer. There is **no build step**
and **no network access**: each script attaches its public API to a shared
`globalThis.ParkingGen` namespace, and the HTML pages load them in dependency
order.

```
index.html                          docs.html
   │  css: vendor/sweetalert2,      │  css: style.css, docs.css
   │       css/style.css            │
   │  js:  vendor/… (optional),     │  js:  icons.js, markdown.js,
   │       icons.js, rng.js,        │       docs.js
   │       pathfinding.js, level.js,│
   │       share.js, image.js, app.js
   ▼                                ▼
js/icons.js ────────► ParkingGen.Icons      js/markdown.js ──► ParkingGen.Markdown
js/rng.js ──────────► ParkingGen.RNG        js/docs.js ──────► docs viewer
js/pathfinding.js ──► ParkingGen.Pathfinding  (uses Markdown)
js/level.js ────────► ParkingGen.Level
js/share.js ────────► ParkingGen.Share
js/image.js ────────► ParkingGen.Image
js/app.js ──────────► editor controller
```

Nothing on either page is fetched from the network: the only third-party code is
`vendor/sweetalert2/` (MIT, optional) and the icon artwork inside `js/icons.js`
(Font Awesome Free, CC BY 4.0 — see `vendor/README.md`).

## Modules

### `js/icons.js` — `ParkingGen.Icons`

The icon set as data, not as a font: `ICONS` maps a name to a viewBox and one
or more SVG paths, `markup()` renders the `<svg><symbol>…` sprite and `mount()`
injects it at the top of `<body>` as soon as the script runs (so `<use href>`
references resolve immediately and no request is made — which is what makes
`file://` work). `svg(name)` returns the `<svg class="icon"><use …></svg>`
markup used by dynamically generated UI (theme toggle, toasts, list items).

### `js/rng.js` — `ParkingGen.RNG`

Deterministic pseudo-random numbers without an external library.

- `hashSeed(str)` — xmur3-style string → 32-bit integer (coerces the input
  once, not per iteration).
- `createRNG(seed)` — mulberry32 generator returning
  `{ next, int, bool, pick, shuffle, reseed }`.
  - `next()` → float `[0, 1)`; `int(min, max)` → integer `[min, max)`
  - `shuffle(arr)` — Fisher–Yates, non-mutating
- `randomSeed(length)` — short random seed for new generations, drawn with
  `crypto.getRandomValues` and rejection sampling (so no modulo bias).

Because every consumer draws from a per-generation RNG instance keyed by the
seed, identical inputs always produce identical levels.

### `js/pathfinding.js` — `ParkingGen.Pathfinding`

Breadth-first search on the grid, built around a reusable workspace.

- `createWorkspace(w, h, [reuse])` — typed arrays for the occupancy map, a
  *stamped* visited map (incremented per search instead of clearing the array),
  parent links, a flat queue and BFS depths.
- `shortestPathLength(level, start, end, [ws])` — the fast path (no cell list
  materialised); used by the generator and the live status chip.
- `findShortestPath(level, start, end, [ws])` — returns the cell list for
  drawing/exporting the route.
- `canReach` / `isSolvable` — boolean wrappers.
- `createSolver(w, h)` — a bound solver so the UI and generator share one
  workspace across thousands of searches.

Cars are the only obstacles; start/end are always passable. Movement is
4-directional and neighbours are visited in a fixed order, so routes are
deterministic. Out-of-bounds coordinates return `-1`/`false`/`null` instead of
producing nonsense.

### `js/level.js` — `ParkingGen.Level`

The level data model, generation and validation.

- Constants: `VERSION`, `MIN_SIZE` (4), `MAX_SIZE` (60, with `MAX_SIZE_GEN` /
  `MAX_SIZE_LOAD` kept as aliases), `MAX_FILL` (0.4), `MAX_FILL_DETOUR` (0.6,
  the ceiling the detour builder may fill to), `DETOUR_ATTEMPTS` (4),
  `DIRECTIONS`, `DIFFICULTY_LABELS`, `ROUTE_MODES`.
- `layoutFor`, `defaultDirection`, `differentCell`, `normalizeInt`,
  `sanitizeName` — small pure helpers (all unit-tested).
- `createLevel`, `cloneLevel`, `resizeLevel`, `carIndexAt` — editor plumbing.
  `resizeLevel` crops/pads, reports how many cars no longer fit and keeps
  start/exit inside the grid.
- `createEmptyGrid` / `rebuildGrid` — the **single source of truth** rule: the
  matrix is always derived from `start`, `end` and `cars`, so the three can
  never disagree.
- `generateLevel(w, h, difficulty, seed, guaranteePath, options)`:
  1. Clamp inputs and create a seeded RNG.
  2. Shuffle every cell once; the first two entries become the start and the
     exit (distinct by construction), the rest the car candidates — an
     unbiased, deterministic fill order.
  3. `Direct` route: place up to
     `difficulty/10 × cells × 0.4` cars; with the guarantee on, each candidate
     is tentatively added and rolled back if it makes the level unsolvable.
  4. `Winding` / `Maze`: block the *current* shortest path, one cell at a time,
     until it is at least `detour ×` the Manhattan distance long — undoing any
     block that would seal the route off. Blocking free cells can only lengthen
     the shortest path, so once the detour target is met it cannot regress. If
     the greedy pass stalls in a local optimum (every remaining path cell is an
     articulation point) it is retried with a different blocking order, keeping
     the longest route found. The exit is also chosen with at least one cell of
     separation in these modes, because a one-step route can never be lengthened.
  5. Rebuild the grid and return the level.
- `sanitizeLevel(raw, warnings)` — validate/normalise untrusted JSON. Checks
  types and ranges for dimensions, difficulty, seed, name, layout, start/end
  and each car; repairs or drops bad data while collecting human-readable
  warnings; rebuilds the grid and cross-checks any embedded one. Throws a
  friendly `Error` for fatal problems (not an object, bad dimensions, oversized
  grid, non-array cars).
- `serializeLevel(level, { includeGrid, pretty })` — the export format. The
  `grid` matrix is included by default and omitted on request (≈3× smaller).

### `js/share.js` — `ParkingGen.Share`

Compact, human-inspectable level codes:

```
1~<w>x<h>~<difficulty>~<seed>~<sx>-<sy>~<ex>-<ey>~<r|c>~<name>~<x-y<dir>>_…
```

- Fields are joined with `~`, cars with `_`, coordinates with `-`, directions
  by letter — all unreserved URL characters, so a code can live in a query
  string untouched.
- `~`/`_` are percent-escaped inside free-text fields, and decoding is lenient
  enough to survive a client that hands the query value back decoded.
- `decodeLevel` runs the result through `sanitizeLevel`, so a hostile code can
  never produce an unsafe level; a single broken car entry is skipped with a
  warning rather than failing the whole link.
- `buildShareUrl` / `readCodeFromUrl` handle `?level=…`, `#level=…` and a bare
  `#<code>` fragment.

### `js/image.js` — `ParkingGen.Image`

- `computeLayout(level, options)` — pure geometry (grid size, padding, caption
  heights, scale) so it can be unit-tested without a DOM.
- `renderLevelToCanvas(level, options)` — draws the lot, cars with direction
  arrows, S/E markers, an optional route trace and a stats caption; colours are
  read from the live CSS custom properties so the PNG matches the active theme.
- `canvasToBlob(canvas)` — `toBlob` with a data-URL fallback.

### `js/markdown.js` — `ParkingGen.Markdown`

A ~180-line Markdown renderer (headings with slug anchors, paragraphs, fenced
code, blockquotes, nested lists, GFM tables, inline code/bold/italic/links).
Everything is escaped first and only a whitelist of inline tags is restored, so
rendering repository documentation can never inject markup.

### `js/docs.js` + `docs.html` + `css/docs.css`

The documentation browser: lists every document, renders it with the Markdown
module, builds a table of contents, filters the list, and shares the theme
preference with the editor through `localStorage`. Documents are fetched from
the repository (never duplicated), with an XHR fallback and a clear message when
`file://` blocks `fetch`.

### `js/app.js` — editor controller

A single `init()` (idempotent, and safe whether the script runs before or after
`DOMContentLoaded`) that caches DOM elements, wires events and boots a level.
Internals are grouped into sections:

- **State** — `level` (source of truth), `editMode`, `theme`, `zoom`, `cursor`,
  `showRoute`, `includeGrid`, `steps`, history stacks.
- **Rendering** — `renderGrid()` builds the whole cell DOM with a
  `DocumentFragment` (generate/load/undo/clear); `updateCell(x, y)` repaints a
  single cell for in-place edits. The route overlay is applied by *diffing* the
  previous and next path sets, so nothing is rebuilt while painting.
- **Sync pipeline** — every mutation ends in `scheduleViewSync()`, which
  coalesces work into one `requestAnimationFrame` pass: stats + BFS, the route
  overlay, the (throttled, hidden-aware) JSON preview and session saving. Paint
  strokes therefore stay smooth no matter how fast the pointer moves.
- **History** — snapshots (compact JSON, no grid matrix) pushed before each
  mutation, with gestures grouped so one drag stroke is one undo step.
- **Edit operations** — `addCar`, `removeCar`, `rotateCar`, `setStart`,
  `setEnd`: validate, snapshot, mutate the model, repaint the affected cell(s),
  schedule a sync.
- **Input** — pointer events for click + drag-to-paint on mouse and touch, a
  full keyboard layer (grid cursor, tool shortcuts, undo/redo, zoom, export),
  and a `?` shortcut dialog.
- **I/O** — file picker, whole-window drag & drop, JSON export/copy (with a
  grid-matrix toggle), PNG export, share-link copy, clipboard fallbacks, and a
  repair report for loaded files.

### `css/style.css` + `css/docs.css`

A self-contained **Liquid Glass** design system (no CSS framework). A
centralized token block on `:root` — and its override under
`[data-theme="dark"]` — defines colour, four glass-material strengths, blur
levels, radii, shadows, spacing, motion (durations + easing) and z-index layers;
every component is built from those tokens. The grid uses
`grid-template-columns: repeat(var(--cols), var(--cell-size))`, and car arrows
are pure CSS triangles sized off `var(--cell-size)`, so zoom never distorts
them. Motion is CSS-only (transform/opacity, GPU-friendly) and honours
`prefers-reduced-motion`. See [DESIGN.md](DESIGN.md).

## Data flow

```
 seed/sliders ──► Level.generateLevel ──► level object ──► renderGrid / updateCell
                                                     └──► scheduleViewSync
                                                              ├── refreshStats   (BFS + chips)
                                                              ├── refreshRoute   (overlay diff)
                                                              ├── refreshJson    (throttled)
                                                              └── saveSession    (debounced)

 pointer/keyboard ──► edit helper ──► pushHistory ──► mutate model ──► updateCell ──►  ▲

 file / drag&drop / share link / session ──► sanitizeLevel ──► applyLevel ────────────┘

 export / copy / PNG / share link ──► serializeLevel / renderLevelToCanvas / encodeLevel
```

The invariant maintained everywhere: **`level.cars` + `level.start` +
`level.end` are authoritative; `level.grid` is derived; the DOM is a view.**

## Design decisions & trade-offs

- **Global namespace instead of ES modules** so the pages also work when opened
  directly via `file://` (modules require http(s) in most browsers). The
  `tools/load-modules.js` helper evaluates the same files in Node, which keeps
  everything testable without a bundler or `jsdom`.
- **Zero runtime dependencies, and nothing is fetched at runtime.** Icons are an
  inline SVG sprite, and the only third-party library (SweetAlert2) is vendored
  in `vendor/` with its licence. Deleting `vendor/` degrades dialogs to native
  `alert`/`confirm`/`console` instead of breaking the app — the wiring and UI
  suites cover both paths.
- **One size range (4–60).** Generation, resizing and loading share the same
  limits — a single rule is easier to document and to reason about. The cost is
  ~100 ms of generation for a 60×60 level, hidden behind the loading veil.
- **Path-blocking generation for route shapes.** Blocking the shortest route
  repeatedly is what actually creates a maze, and it reaches `1.6×`/`2.4×`
  detours with roughly the same car count the difficulty asks for — a random
  fill needed 55–60 % of the lot before the shortcuts happened to close, and
  gave up on the detour target entirely.
- **BFS, not DFS** — BFS gives both solvability and the *shortest* route, which
  the stats bar, the overlay and the PNG caption all reuse.
- **Lenient reader, strict writer.** Files, share codes and sessions are
  repaired wherever possible and every repair is reported; exports always carry
  the canonical, documented shape.
- **Coalesced rendering.** Edits mutate the model immediately (so history and
  pathfinding stay exact) while the DOM work is batched per animation frame and
  the JSON preview is throttled and skipped while collapsed.
