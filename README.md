# 🅿️ Parking Lot Level Generator

A **100% client-side, zero-build** tool for generating and editing grid-based
parking-lot puzzle levels. It produces deterministic, seed-based levels packed
with cars (obstacles), a start cell and an exit cell — and can guarantee that
every generated level is solvable. Levels are exported as plain JSON that your
game engine can load directly, as a shareable link, or as a PNG mock-up.

![Tech](https://img.shields.io/badge/HTML-Vanilla_JS-blue) ![No build](https://img.shields.io/badge/build-none-success) ![Deps](https://img.shields.io/badge/runtime%20dependencies-0-success) ![Offline](https://img.shields.io/badge/network-0%20requests-success) ![Tests](https://img.shields.io/badge/tests-101%20assertions-success) ![License](https://img.shields.io/badge/license-MIT-informational)

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Generation** | Deterministic levels from any text seed — same inputs ⇒ same level |
| **Solvable guarantee** | Every car placement is BFS-verified; a car that would seal the exit off is rolled back |
| **Route shapes** | `Direct`, `Winding` (`≥1.6×` detour) and `Maze` (`≥2.4×`) — the shortest route is blocked until it is long enough |
| **Difficulty** | 1–10 scale that controls car density, with a named label |
| **Layouts** | Automatic *rows* or *columns* parking layout with lane shading |
| **Editor** | Add / remove / rotate cars, move start & exit, rebuild size — with **drag-to-paint** |
| **Undo / redo** | 60-step history with gesture grouping (one step per drag stroke) |
| **Route preview** | `Show route` highlights the shortest start→exit path on the grid |
| **Validation** | Live *Solvable / Blocked* badge, route length, explicit solvability check |
| **Import** | Load `.json` files by picker **or drag & drop**, with strict validation and a repair report |
| **Export** | Download JSON, copy it, copy a **share link**, or render a **PNG** |
| **Sharing** | Compact share codes restore the *exact* level — including hand edits |
| **Zoom** | Zoom in / out / fit for grids up to 60×60, with auto re-fit on resize |
| **Keyboard** | Full arrow-key grid navigation plus shortcuts for every common action |
| **UX** | Dark / light theme, toasts, session restore, accessible dialogs, `prefers-reduced-motion` support |
| **Offline-first** | No CDN, no trackers, no network: icons ship as an inline SVG sprite and dialogs as a vendored, optional library — `file://` works out of the box |
| **Accessible** | Keyboard-navigable grid, focus rings, live-region announcements, `prefers-reduced-motion` support |

## 🚀 Quick start

No install, no build step — only a static file server for the nice-to-have
features (share-link loading, docs viewer, clipboard in some browsers):

```bash
# Option A — built-in dev server (Node ≥ 14, no dependencies)
npm run serve            # → http://localhost:8080

# Option B — any static server
python3 -m http.server 8080

# Option C — open the file directly
open index.html          # macOS
xdg-open index.html      # Linux
```

The app boots with a ready-made sample level (or your last session) so the
workspace is never empty.

### Generate your first level

1. Type anything into the **Seed** box (or hit the 🎲 shuffle button for a random one).
2. Set **width**, **height** and **difficulty** with the sliders.
3. Pick a **Route shape** — `Direct` for a clean layout, `Maze` for a puzzle.
4. Keep **"Guarantee solvable path"** checked for levels you ship to players.
5. Click **Generate**. Tweak by hand, press **Show route** to sanity-check the
   puzzle, then **Export JSON** / **Copy link**.

> 💡 The same (seed, width, height, difficulty, route shape, guarantee)
> combination always reproduces the exact same level — great for sharing level
> codes with your team.

## 🕹️ Editing tools

Select a tool in the right-hand sidebar (keys <kbd>1</kbd>–<kbd>5</kbd>, or
<kbd>Esc</kbd> to cancel):

- **Add car** — click empty cells (or *drag across them*) to place cars.
- **Remove car** — click / drag over cars to delete them.
- **Rotate car** — click a car to turn it 90° clockwise (facing only).
- **Set start / Set exit** — click any empty cell.
- **Check solvable** — runs BFS and reports the shortest route length.
- **Resize grid** — crop or pad the current level to a new size.
- **Clear all** — empties the lot and resets start/exit to opposite corners.

Everything is undoable with <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd>. The
status badge in the stats bar flips to **Blocked** (red) whenever your edits
sever every start→exit route, and exporting a blocked level asks for
confirmation first.

## ⌨️ Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd> / <kbd>Shift</kbd>+<kbd>Z</kbd> | Undo / redo |
| <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> | Export JSON |
| <kbd>G</kbd> | Generate a new level |
| <kbd>1</kbd> … <kbd>5</kbd> | Select an edit tool |
| <kbd>Arrow keys</kbd> | Move the grid cursor (<kbd>Shift</kbd> = 5 cells) |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Apply the active tool at the cursor |
| <kbd>Delete</kbd> | Remove the car under the cursor |
| <kbd>R</kbd> | Rotate the car under the cursor |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump to the start / exit cell |
| <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd> | Zoom in / out / fit |
| <kbd>D</kbd> | Toggle dark mode |
| <kbd>Esc</kbd> | Cancel the active tool |
| <kbd>?</kbd> | Show the shortcut list in-app |

## 📁 Project structure

```
MapGenerator/
├── index.html            # Level editor (markup + local stylesheets/scripts)
├── docs.html             # In-app documentation browser
├── css/
│   ├── style.css         # Liquid Glass design system: tokens, materials, components,
│   │                     #   grid, sidebar, responsive rules, reduced-motion fallbacks
│   └── docs.css          # Documentation viewer shell + Markdown typography
├── js/
│   ├── icons.js          # Icon set as an inline SVG sprite (no icon font, no CDN)
│   ├── rng.js            # Seeded PRNG (mulberry32 + xmur3 hash)
│   ├── pathfinding.js    # BFS: shortest path, reachability, reusable workspaces
│   ├── level.js          # Level model: generation, detour building, sanitisation
│   ├── share.js          # Compact URL share codes (encode/decode)
│   ├── image.js          # Canvas renderer for PNG export
│   ├── markdown.js       # Tiny Markdown renderer for the docs viewer
│   ├── app.js            # Editor controller (render, edit, history, import/export)
│   └── docs.js           # Documentation browser controller
├── tools/
│   ├── test.js           # Test suite (101 assertions, no dependencies)
│   ├── dom-stub.js       # Minimal DOM/browser stub the UI suite boots the app in
│   ├── load-modules.js   # Loads the browser modules into Node for testing
│   └── serve.js          # Zero-dependency static dev server
├── vendor/
│   ├── sweetalert2/      # Vendored dialogs + toasts (MIT) — optional, local
│   └── README.md         # Provenance, licences and update instructions
├── docs/
│   ├── USAGE.md          # End-to-end usage guide
│   ├── LEVEL_FORMAT.md   # The JSON level schema
│   ├── ARCHITECTURE.md   # Code architecture and data flow
│   ├── DESIGN.md         # Design system reference (tokens, glass, motion)
│   ├── TESTING.md        # What the suite covers and how to extend it
│   ├── CONTRIBUTING.md   # Conventions, workflow, review checklist
│   └── CHANGELOG.md      # Release history
├── .github/workflows/ci.yml
└── package.json
```

Everything application-specific lives in `js/` and is loaded as plain
(non-module) scripts that share a single `ParkingGen` global namespace, so the
app works over `file://` as well as any static host. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning.

## 🧪 Tests

```bash
npm test                 # or: node tools/test.js
node tools/test.js --filter=share      # run one suite
node tools/test.js --quiet             # failures + summary only
```

The dependency-free suite checks seeded determinism, RNG statistics, BFS
correctness against a reference implementation on 200 random mazes, generation
invariants (including “guaranteed levels are always solvable”), sanitisation of
hostile input, share-code round trips, Markdown rendering/XSS escaping, image
layout maths, performance budgets, and the HTML ⇄ JS ⇄ CSS wiring.

It also **boots the real app** inside a ~300-line DOM stub (`tools/dom-stub.js`)
and drives it end to end: painting cars, drag strokes, undo/redo, the route
overlay, keyboard navigation, generation, drag-and-drop loading, share links,
theme persistence, clipboard and exports. That is the closest thing to a browser
test we can run with zero dependencies. The suite exits non-zero on failure, so
it drops straight into CI.

## 📖 Documentation

- [Usage guide](docs/USAGE.md) — detailed walkthrough of every feature
- [Level JSON format](docs/LEVEL_FORMAT.md) — schema for consuming/generating levels
- [Architecture](docs/ARCHITECTURE.md) — how the modules fit together
- [Design system](docs/DESIGN.md) — the visual language behind the UI
- [Testing](docs/TESTING.md) — suite layout and how to add cases
- [Contributing](docs/CONTRIBUTING.md) — conventions, testing, review checklist
- [Changelog](docs/CHANGELOG.md) — what changed, release by release

Prefer reading them in the browser? `docs.html` renders every document with a
table of contents and a search box (`npm run serve`, then open `/docs.html`).

## 🛠️ Tech notes

- **No bundler / framework for app code** — vanilla JS in small, documented files.
- **No CSS framework** — the UI is a self-contained "Liquid Glass" design system
  (`css/style.css`): centralized design tokens (colour, glass opacity, blur,
  radii, shadows, spacing, motion), four glass material strengths, and
  first-class light/dark themes. Motion is CSS-only (transform/opacity),
  GPU-friendly, and honours `prefers-reduced-motion`.
- **No runtime dependencies, no network.** Icons are an inline SVG sprite
  (`js/icons.js`, Font Awesome Free artwork, CC BY 4.0); dialogs and toasts use
  SweetAlert2 **vendored** in `vendor/` (MIT). Nothing is fetched at runtime, so
  the editor works offline, behind a firewall and straight from `file://`. If
  `vendor/` is deleted the app still runs — dialogs fall back to native
  `alert`/`confirm`/`console`. See [vendor/README.md](vendor/README.md).
- **Deterministic randomness** is self-contained in `js/rng.js` (no external
  seedrandom dependency).
- **Performance**: BFS runs on reusable typed-array workspaces, view updates
  are coalesced into one animation frame, and the JSON preview is throttled and
  skipped entirely while collapsed — so drag-painting stays smooth even on
  60×60 grids.

## 📄 License

Released under the [MIT License](LICENSE).
