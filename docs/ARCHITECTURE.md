# Architecture

The app is a small set of dependency-free vanilla-JS modules plus a
self-contained "Liquid Glass" CSS design system and a SweetAlert2 dialog layer.
There is **no build step**: each script attaches its public API to a shared
`window.ParkingGen` namespace, and `index.html` loads them in dependency order.

```
index.html
   │  loads (CDN): font-awesome, sweetalert2
   │  loads (local):
   ▼
js/rng.js ──────────► ParkingGen.RNG         (seeded randomness)
js/pathfinding.js ──► ParkingGen.Pathfinding (BFS / solvability)
js/level.js ────────► ParkingGen.Level       (generate + sanitise)  ◄── uses RNG + Pathfinding
js/app.js ──────────► UI controller                                ◄── uses all of the above
```

## Modules

### `js/rng.js` — `ParkingGen.RNG`

Deterministic pseudo-random numbers without an external library.

- `hashSeed(str)` — xmur3-style string → 32-bit integer.
- `createRNG(seed)` — mulberry32 generator returning `{ next, int, pick, shuffle }`.
  - `next()` → float `[0, 1)`
  - `int(min, max)` → integer `[min, max)`
  - `pick(arr)`, `shuffle(arr)` (Fisher–Yates, non-mutating)
- `randomSeed()` — short random seed string for new generations
  (`crypto.getRandomValues` when available).

Because the whole generator consumes randomness through a per-generation RNG
instance keyed by the seed, the same inputs always produce the same level.

### `js/pathfinding.js` — `ParkingGen.Pathfinding`

Breadth-first search on the grid.

- `buildBlocked(level)` — `Uint8Array` occupancy buffer from the car list.
- `findShortestPath(level, start, end)` — BFS using a flat `Int32Array` queue
  and a parent-index array (no per-node path copies). Returns an array of
  `[x, y]` cells from start to end, or `null`.
- `isSolvable(level)` — boolean wrapper used by the generator and the live
  status badge.

Cars are the only obstacles; start/end are always passable. Movement is
4-directional. BFS guarantees the shortest route, which doubles as the
"minimum manoeuvre count" metric shown by *Check solvable*.

### `js/level.js` — `ParkingGen.Level`

The level data model.

- Constants: `VERSION`, `MIN_SIZE` (4), `MAX_SIZE_GEN` (30),
  `MAX_SIZE_LOAD` (60), `DIRECTIONS`, plus `difficultyLabel(n)`.
- `layoutFor(w, h)` — `'columns'` when `w > h`, else `'rows'`.
- `defaultDirection(layout, x, y)` — lane-appropriate car facing.
- `createEmptyGrid(w, h)` / `rebuildGrid(level)` — construct the `grid` matrix.
  **`rebuildGrid` is the single source of truth**: the matrix is always derived
  from `start`, `end` and `cars`, so the three can never disagree.
- `generateLevel(w, h, difficulty, seed, guaranteePath)`:
  1. Clamp inputs and create a seeded RNG.
  2. Pick random, distinct start/end cells.
  3. Build the list of all other cells and shuffle it (deterministic,
     unbiased fill order).
  4. Place up to `difficulty/10 × cells × 0.4` cars. With `guaranteePath`,
     every candidate car is tentatively added and rolled back if
     `Pathfinding.isSolvable` becomes false.
  5. Rebuild the grid and return the level.
- `sanitizeLevel(raw, warnings)` — validate/normalise untrusted JSON. Checks
  types and ranges for dimensions, difficulty, seed, layout, start/end and
  each car; repairs or drops bad data while collecting human-readable
  warnings; always rebuilds the grid (and cross-checks any embedded grid,
  reporting mismatch counts). Throws `Error` with a friendly message on fatal
  problems (not an object, bad dimensions, oversized, non-array cars).

### `js/app.js` — UI controller

A single `init()` (idempotent) that caches DOM elements, wires events and
renders the initial level. Key internal groups:

- **State**: `level` (source of truth), `editMode`, `theme`, `zoom`,
  `isPainting`.
- **Rendering**: `renderGrid()` builds the whole cell DOM with a
  `DocumentFragment` (used after generate/load/clear/resize); `updateCell(x,y)`
  repaints a single cell via `paintCell` for in-place edits — avoiding the old
  full-DOM rebuild on every click.
- **Sync**: every mutation goes through helpers (`addCar`, `removeCar`,
  `rotateCar`, `setStart`, `setEnd`, `clearAll`) which update the model, the
  affected cell(s), the JSON preview and the stats panel together.
- **Stats**: dimensions, car count, difficulty label, fill %, start/exit,
  layout and a live **Solvable/Blocked** badge (recomputed via BFS).
- **Input**: click plus **drag-to-paint** for add/remove, on both mouse and
  touch (`touch-action: none` on the grid, `passive: false` handlers). Edit
  tools are toggled from the sidebar; <kbd>Esc</kbd> cancels.
- **I/O**: file-picker and full-window drag-and-drop loading (through
  `sanitizeLevel` with a repair report), JSON export download, clipboard copy
  with a `document.execCommand` fallback, and export-time solvability warning.
- **Theme**: light/dark via `data-theme` CSS variables, persisted to
  `localStorage`, falling back to `prefers-color-scheme`; SweetAlert dialogs
  are themed to match, with native `alert`/`confirm` fallbacks if the CDN is
  unavailable.
- **Zoom**: CSS custom property `--cell-size` drives cell dimensions (and the
  CSS-triangle car arrows scale with it); Fit computes the scale from the
  wrapper size.

### `css/style.css`

The UI is a self-contained **Liquid Glass** design system (no CSS framework).
A centralized token block on `:root` — and its override under
`[data-theme="dark"]` — defines colour, the four glass-material strengths,
blur levels, radii, shadows, spacing, motion (durations + easing) and z-index
layers; every component is built from those tokens. The grid uses
`grid-template-columns: repeat(var(--cols), var(--cell-size))`; car arrows are
pure CSS triangles sized off `var(--cell-size)`, so zoom never distorts them.
Motion is CSS-only (transform/opacity, GPU-friendly) and honours
`prefers-reduced-motion`.

## Data flow

```
 seed/sliders ──► Level.generateLevel ──► level object ──► renderGrid / updateCell
                                                     └──► refreshJson (live <pre>)
                                                     └──► updateStats (BFS badge)

 file/drag&drop ──► JSON.parse ──► Level.sanitizeLevel ──► (repairs reported) ──┘

 sidebar tool + pointer ──► edit helper ──► mutate model ──► updateCell + sync
 export/copy ──► JSON.stringify(level)
```

The invariant maintained everywhere: **`level.cars` + `level.start` +
`level.end` are authoritative; `level.grid` is derived; the DOM is a view.**

## Design decisions & trade-offs

- **Global namespace instead of ES modules** so the page also works when opened
  directly via `file://` (modules require http(s) in most browsers).
- **Synchronous generation** (deferred one frame to paint the loading state).
  Max grid is 30×30 = 900 cells; BFS-with-rollback generation completes well
  within a frame for that size, so a web worker would be over-engineering.
- **BFS, not DFS** — the UI option is labelled "Guarantee solvable path"; BFS
  also gives the shortest route for the stats display.
- **Tolerant loader** — hand-written or third-party JSON is repaired rather
  than rejected wherever possible; every repair is surfaced to the user.
