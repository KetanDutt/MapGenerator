# Usage guide

This guide walks through everything the Parking Lot Level Generator can do.

## Opening the app

The app is fully static. Any of these work:

- `npm run serve` (zero-dependency Node dev server) then visit
  <http://localhost:8080> — recommended, it enables share-link loading,
  clipboard access and the `docs.html` viewer.
- `python3 -m http.server 8080` — any static server does the job.
- Double-click `index.html` to open it straight from disk. Everything except
  `fetch`-based features (share-link URL loading, docs viewer) works here.
- Host it on GitHub Pages, Netlify, S3 + CloudFront, etc. — just upload the
  repository contents.

On first load you get a pre-generated 10×10 sample level. On later visits the
app restores your last session from `localStorage` and tells you so.

## Generating a level

| Control | Effect |
| --- | --- |
| **Level name** | Optional label stored in the JSON (`name`), used for export filenames and the PNG caption. |
| **Seed** | Any text. Identical inputs reproduce identical levels. Use the shuffle button for a random seed. |
| **Grid width / height** | 4–60 cells each. The layout becomes *columns* when wider than tall, otherwise *rows*. |
| **Difficulty (1–10)** | Controls how many cells are filled with cars (up to 40% of the grid at difficulty 10). |
| **Route shape** | `Direct` (density-driven fill), `Winding` (forced detour, ~1.6× the direct distance) or `Maze` (long, twisty route, ~2.4×). |
| **Guarantee solvable path** | When on, a start→exit route is guaranteed. Route shapes need this switch — the selector is disabled without it. |
| **Generate** | Builds the level. <kbd>Enter</kbd> in the seed box or <kbd>G</kbd> anywhere also works. |

Difficulty names shown in the stats bar:

`1 Trivial · 2 Very Easy · 3 Easy · 4 Simple · 5 Gentle · 6 Moderate · 7 Tricky · 8 Hard · 9 Very Hard · 10 Extreme`

### How the two generation styles differ

- **Direct** places cars one at a time and rolls a car back if it would seal
  off the route (BFS-verified). Density drives everything, so the shortest
  route is whatever survives — often close to the straight-line distance.
- **Winding / Maze** build the level the other way round: the generator blocks
  the *shortest* route and re-measures, over and over, until the way out is at
  least **1.6×** (Winding) or **2.4×** (Maze) the straight-line distance. Any
  block that would seal the exit off is undone immediately, so the level always
  stays solvable, and once the target is reached the remaining cars are placed
  around the route — which can only make it longer. Expect maze-like dead ends
  and a much longer drive.

If a detour target is geometrically impossible (tiny grids, start and exit
already adjacent), the generator gets as close as it can and the stats bar
shows the route length that was actually achieved.

## Editing a level

Click a tool in the **Edit tools** panel (or press <kbd>1</kbd>–<kbd>5</kbd>),
then interact with the grid. The active tool is highlighted and a banner above
the grid explains what to do. Press <kbd>Esc</kbd> (or click the tool again,
or the banner's *Cancel* button) to stop editing.

| Tool | Interaction |
| --- | --- |
| **Add car** | Click an empty cell, or hold the mouse/touch and **drag** to paint many cars at once. |
| **Remove car** | Click a car, or drag across cars to erase them. |
| **Rotate car** | Click a car to rotate its facing 90° clockwise (`up → right → down → left`). Facing is cosmetic metadata — it never affects pathfinding. |
| **Set start** | Click any empty cell to move the green **S** marker. |
| **Set exit** | Click any empty cell to move the red **E** marker. |

Clicking a cell with **no tool selected** just moves the keyboard cursor there,
so you can inspect cells without editing anything.

Cars always face along the parking lane (up/down for rows, left/right for
columns) when first placed; use *Rotate car* for custom facing.

### Undo, redo and clearing

- <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd> undoes, <kbd>Shift</kbd> added
  redoes (<kbd>Ctrl</kbd>+<kbd>Y</kbd> works too). The toolbar buttons show the
  same actions.
- A whole drag stroke counts as **one** undo step.
- History keeps the last 60 steps and is reset whenever you generate, load or
  resize a level (those become the new baseline).
- **Clear all** removes every car and resets start to the top-left and exit to
  the bottom-right (after a confirmation dialog — and it is undoable).

### Resizing an existing level

**Resize grid** opens a small dialog with width/height inputs (4–60). Cars that
no longer fit are dropped (the number is reported), start/exit are pulled back
inside the grid, and the change is a single undo step.

### Solvability

The **Status** chip in the stats bar reads **Solvable** (green) or **Blocked**
(red) and updates live after every edit; the **Route** chip shows the shortest
route length in steps or `Blocked`. Use **Check solvable** in the sidebar for an
explicit report and **Show route** in the toolbar to highlight the shortest path
on the grid.

Cars are impassable obstacles; movement is 4-directional (up/down/left/right).

## Zooming

Above the grid: **−** / **+** zoom between 50% and 200% (<kbd>+</kbd> /
<kbd>−</kbd>), and **Fit** scales the grid to fill the available viewport
(<kbd>0</kbd>). After *Fit*, resizing the window re-fits automatically until you
zoom manually. The grid area scrolls when it overflows, so large levels remain
usable.

## Importing levels

There are two ways to load an existing level file (`.json`):

1. **File picker** — choose *Load level (.json)*.
2. **Drag & drop** — drag a `.json` file anywhere onto the window; a drop zone
   overlay appears while dragging.

Loaded files are validated and normalised before display:

- Out-of-range values (difficulty, positions, directions) are repaired.
- Cars outside the grid, duplicated cars, and cars on top of start/exit are
  dropped.
- Missing pieces (seed, name, layout, grid) are inferred or rebuilt.
- Files larger than 8 MB are rejected outright.

If anything had to be fixed, a dialog lists every repair that was made. Files
that are fundamentally invalid (not JSON, missing dimensions, grids smaller
than 4×4 or larger than 60×60) are rejected with an explanation.

See [LEVEL_FORMAT.md](LEVEL_FORMAT.md) for the exact file schema.

## Sharing a level

**Copy link** builds a URL that reopens *this exact level*, including every
hand-placed car:

```
https://your-host/index.html?level=1~12x9~7~my-seed~3-4~10-7~c~Garage~4-3u_2-2l_…
```

Open the link (or paste it into the address bar of a freshly loaded page) and
the level appears immediately. The link is plain text — no server, database or
upload involved — so it is safe to paste into a ticket or a chat. Very large
levels produce long links; the app warns you when a link passes ~2000
characters.

## Exporting levels

- **Export JSON** downloads the level as
  `parking-level-<w>x<h>-d<difficulty>-<seed>.json` (or
  `<level-name>-<w>x<h>.json` when the level has a name). If the level is
  currently *Blocked*, you are asked to confirm first.
  <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd> does the same.
- **Copy JSON** puts the pretty-printed JSON on your clipboard.
- **Export PNG** renders the level to an image (2× scale, themed to match the
  current appearance, with a caption showing size, difficulty, fill and route
  length). The route is drawn only while *Show route* is active, so exported
  images don't spoil the puzzle.

The JSON preview panel below the grid shows the live document and updates as
you edit; use **Hide/Show JSON** to collapse it (the panel costs nothing while
collapsed). The **Include grid matrix** checkbox controls whether exported and
copied JSON carries the derived `grid` matrix: leave it on for the documented
self-contained format, or turn it off for files roughly a third of the size.

## Themes

The moon/sun button (top-right, or <kbd>D</kbd>) toggles light and dark themes.
Your choice is saved in `localStorage`; on first visit the app follows your OS
`prefers-color-scheme`. Dialogs (vendored SweetAlert2) match the active theme.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo |
| <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> | Export JSON |
| <kbd>G</kbd> | Generate |
| <kbd>1</kbd>–<kbd>5</kbd> | Select an edit tool |
| <kbd>Tab</kbd> into the grid, then <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> | Move the cursor (with <kbd>Shift</kbd>: five cells at a time) |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Apply the active tool at the cursor |
| <kbd>Delete</kbd> | Remove the car under the cursor |
| <kbd>R</kbd> | Rotate the car under the cursor |
| <kbd>Home</kbd> / <kbd>End</kbd> | Move the cursor to the start / exit |
| <kbd>+</kbd> / <kbd>−</kbd> | Zoom in / out |
| <kbd>0</kbd> | Fit to view |
| <kbd>D</kbd> | Toggle dark mode |
| <kbd>Esc</kbd> | Cancel the active tool |
| <kbd>?</kbd> | Shortcut list |

Shortcuts are ignored while you are typing in an input, so the seed box and the
level name field behave normally.

## Accessibility notes

- The grid is a keyboard-reachable `role="grid"`; the cursor cell is announced
  together with its content (“car at 4, 7 facing up”).
- Status changes (solvable/blocked, level loaded, undo) are announced through a
  polite live region.
- Tool buttons expose `aria-pressed`, the route toggle exposes `aria-pressed`,
  and dialogs keep focus inside themselves.
- Motion is reduced automatically when your OS asks for it
  (`prefers-reduced-motion`).

## Troubleshooting

- **Dialogs look like plain browser popups** — `vendor/sweetalert2/` is missing
  or was blocked. The tool still works; restore the file (or keep the native
  fallbacks) and reload.
- **"Level is blocked" when exporting** — the cars fully separate start from
  exit; remove or rotate a car to reopen a route, or export anyway if you
  intend to fix it later in your game.
- **Two levels share a seed but look different** — seeds are scoped by
  width/height/difficulty, route shape and the solvable-path setting too; keep
  those the same for an exact reproduction. (Generation was also reworked in
  v2.0 — levels from 1.x seeds will differ; see the
  [changelog](CHANGELOG.md).)
- **A share link says it could not be read** — the link was truncated by the
  app or chat client that carried it. Ask for the JSON file instead.
- **The docs page is empty** — `docs.html` fetches Markdown files, which
  browsers block on `file://`. Serve the folder over HTTP
  (`npm run serve`) or open the `.md` files directly.
