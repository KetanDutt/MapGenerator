# 🅿️ Parking Lot Level Generator

A **100% client-side, zero-build** tool for generating and editing grid-based
parking-lot puzzle levels. It produces deterministic, seed-based levels packed
with cars (obstacles), a start cell and an exit cell — and can guarantee that
every generated level is solvable. Levels are exported as plain JSON that your
game engine can load directly.

![Tech](https://img.shields.io/badge/HTML-Vanilla_JS-blue) ![No build](https://img.shields.io/badge/build-none-success) ![Tests](https://img.shields.io/badge/tests-40%20passing-success)

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Generation** | Deterministic levels from any text seed — same seed ⇒ same level |
| **Solvable guarantee** | Cars are placed around a BFS-verified start→exit route |
| **Difficulty** | 1–10 scale that controls car density, with a named label |
| **Layouts** | Automatic *rows* or *columns* parking layout with lane shading |
| **Editor** | Add / remove / rotate cars, move start & exit — with **drag-to-paint** |
| **Validation** | Live "Solvable / Blocked" badge, plus an explicit solvability check |
| **Import** | Load `.json` files by picker **or drag & drop**, with strict validation |
| **Export** | Download JSON or copy it to the clipboard |
| **Zoom** | Zoom in / out / fit for grids up to 30×30 (generation) or 60×60 (loaded) |
| **UX** | Dark / light theme (remembers your choice + system preference), toasts, prompts |
| **Resilience** | No external randomness dependency; dialogs degrade gracefully offline |

## 🚀 Quick start

No install, no build step. Either open the file directly or serve the folder:

```bash
# Option A — just open it
open index.html          # macOS
xdg-open index.html      # Linux

# Option B — serve locally (recommended; enables nicer module behaviour)
python3 -m http.server 8080
# then browse to http://localhost:8080
```

The app boots with a ready-made sample level so you can explore immediately.

### Generate your first level

1. Type anything into the **Seed** box (or hit the 🎲 shuffle button for a random one).
2. Set **width**, **height** and **difficulty** with the sliders.
3. Keep **"Guarantee solvable path"** checked for levels you ship to players.
4. Click **Generate**. Tweak by hand with the sidebar tools, then **Export JSON**.

> 💡 The same (seed, width, height, difficulty, guarantee) combination always
> reproduces the exact same level — great for sharing level codes.

## 🕹️ Editing tools

Select a tool in the right-hand sidebar (or press **Esc** to cancel):

- **Add car** — click empty cells (or *drag across them*) to place cars.
- **Remove car** — click / drag over cars to delete them.
- **Rotate car** — click a car to turn it 90° clockwise.
- **Set start / Set exit** — click any empty cell.
- **Check solvable** — runs BFS and reports the shortest route length.
- **Clear all** — empties the lot and resets start/exit to opposite corners.

The status badge in the stats bar flips to **Blocked** (red) whenever your
edits sever every start→exit route — exporting a blocked level asks for
confirmation first.

## 📁 Project structure

```
MapGenerator/
├── index.html            # Markup + CDN stylesheets/scripts (Bootstrap, FA, SweetAlert2)
├── css/
│   └── style.css         # Theme variables, grid, cars, sidebar, responsive rules
├── js/
│   ├── rng.js            # Seeded PRNG (mulberry32 + xmur3 hash)
│   ├── pathfinding.js    # Breadth-first search (shortest path / solvability)
│   ├── level.js          # Level generation + validation/sanitisation
│   └── app.js            # UI controller (render, edit, import/export, theme)
├── tools/
│   └── smoke-test.js     # Node.js sanity tests (no dependencies)
├── docs/
│   ├── USAGE.md          # End-to-end usage guide
│   ├── LEVEL_FORMAT.md   # The JSON level schema
│   ├── ARCHITECTURE.md   # Code architecture and data flow
│   └── CONTRIBUTING.md   # How to develop and extend the project
└── README.md
```

Everything application-specific lives in `js/` and is loaded as plain
(non-module) scripts that share a single `ParkingGen` global namespace, so the
app works over `file://` as well as any static host.

## 🧪 Tests

```bash
node tools/smoke-test.js
```

Runs ~40 assertions covering seeded determinism, car-density caps, shortest-path
correctness, solvability detection and malformed-input sanitisation. It exits
non-zero on any failure, so it can be wired straight into CI.

## 📖 Documentation

- [Usage guide](docs/USAGE.md) — detailed walkthrough of every feature
- [Level JSON format](docs/LEVEL_FORMAT.md) — schema for consuming/generating levels
- [Architecture](docs/ARCHITECTURE.md) — how the modules fit together
- [Contributing](docs/CONTRIBUTING.md) — conventions, testing, extension points

## 🛠️ Tech notes

- **No bundler / framework for app code** — vanilla JS in small, documented files.
- Third-party UI libraries (Bootstrap 5, Font Awesome, SweetAlert2) load from
  CDNs but are not required for the core logic; the app degrades gracefully if
  they fail to load (native `alert`/`confirm`/`console` fallbacks).
- Deterministic randomness is self-contained in `js/rng.js` (no external
  seedrandom dependency).

## 📄 License

Released under the [MIT License](LICENSE).
