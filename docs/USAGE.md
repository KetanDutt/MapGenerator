# Usage guide

This guide walks through everything the Parking Lot Level Generator can do.

## Opening the app

The app is fully static. Any of these work:

- Double-click `index.html` to open it straight from disk.
- Serve the folder with any static web server, e.g.
  `python3 -m http.server 8080`, then visit <http://localhost:8080>.
- Host it on GitHub Pages, Netlify, S3 + CloudFront, etc. — just upload the
  repository contents.

On load you are presented with a pre-generated 10×10 sample level so the
workspace is never empty.

## Generating a level

| Control | Effect |
| --- | --- |
| **Seed** | Any text. Identical seeds reproduce identical levels. Use the shuffle button for a random seed. |
| **Grid width / height** | 4–30 cells each. The layout becomes *columns* when wider than tall, otherwise *rows*. |
| **Difficulty (1–10)** | Controls how many cells are filled with cars (up to 40% of the grid at difficulty 10). |
| **Guarantee solvable path** | When on, cars are only placed where a start→exit route still exists (BFS-verified). |
| **Generate** | Builds the level. Pressing <kbd>Enter</kbd> inside the seed box also generates. |

Difficulty names shown in the stats bar:

`1 Trivial · 2 Very Easy · 3 Easy · 4 Simple · 5 Gentle · 6 Moderate · 7 Tricky · 8 Hard · 9 Very Hard · 10 Extreme`

## Editing a level

Click a tool in the **Edit tools** panel, then interact with the grid. The
active tool is highlighted and a banner at the top of the grid explains what to
do. Press <kbd>Esc</kbd> (or click the tool again / the banner's *Cancel*
button) to stop editing.

| Tool | Interaction |
| --- | --- |
| **Add car** | Click an empty cell, or hold the mouse/touch and **drag** to paint many cars at once. |
| **Remove car** | Click a car, or drag across cars to erase them. |
| **Rotate car** | Click a car to rotate its facing 90° clockwise (`up → right → down → left`). |
| **Set start** | Click any empty cell to move the green **S** marker. |
| **Set exit** | Click any empty cell to move the red **E** marker. |

Cars always face along the parking lane (up/down for rows, left/right for
columns) when first placed; use *Rotate car* for custom facing.

### Solvability

The **Status** chip in the stats bar reads **Solvable** (green) or **Blocked**
(red) and updates live after every edit. Use **Check solvable** in the sidebar
for an explicit report, including the shortest route length in cells. Cars are
impassable obstacles; movement is 4-directional (up/down/left/right).

### Clearing

**Clear all** removes every car and resets start to the top-left and exit to
the bottom-right corner (after a confirmation dialog).

## Zooming

Above the grid: **−** / **+** zoom between 50% and 200%, and **Fit** scales the
grid to fill the available viewport. The grid area scrolls when it overflows,
so large levels remain usable.

## Importing levels

There are two ways to load an existing level file (`.json`):

1. **File picker** — choose *Load level (.json)*.
2. **Drag & drop** — drag a `.json` file anywhere onto the window; a drop zone
   overlay appears while dragging.

Loaded files are validated and normalised before display:

- Out-of-range values (difficulty, positions, directions) are repaired.
- Cars outside the grid, duplicated cars, and cars on top of start/exit are
  dropped.
- Missing pieces (seed, layout, grid) are inferred or rebuilt.

If anything had to be fixed, a dialog lists every repair that was made. Files
that are fundamentally invalid (not JSON, missing dimensions, grids smaller
than 4×4 or larger than 60×60) are rejected with an explanation.

See [LEVEL_FORMAT.md](LEVEL_FORMAT.md) for the exact file schema.

## Exporting levels

- **Export JSON** downloads the level as
  `parking-level-<w>x<h>-d<difficulty>-<seed>.json`. If the level is currently
  *Blocked*, you are asked to confirm before exporting.
- **Copy JSON** puts the pretty-printed JSON on your clipboard (with a
  hidden-textarea fallback for older browsers / non-secure contexts).

The JSON preview panel below the grid shows the live document and updates on
every change; use **Hide/Show JSON** to collapse it.

## Themes

The moon/sun button (top-right) toggles light and dark themes. Your choice is
saved in `localStorage`; on first visit the app follows your OS
`prefers-color-scheme`. Dialogs (SweetAlert2) match the active theme.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Esc</kbd> | Cancel the active edit tool |
| <kbd>Enter</kbd> (in seed field) | Generate |

## Troubleshooting

- **Buttons look unstyled / dialogs are plain browser popups** — a CDN
  (Font Awesome/SweetAlert2) couldn't load. The tool still works;
  check your network/ad-blocker.
- **"Level is blocked" when exporting** — the cars fully separate start from
  exit; remove or rotate a car to reopen a route, or export anyway if you
  intend to fix it later in your game.
- **Two levels share a seed but look different** — seeds are scoped by
  width/height/difficulty and the solvable-path setting too; keep those the
  same for an exact reproduction.
