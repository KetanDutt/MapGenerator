# Level JSON format

Levels are plain JSON files (`.json`). The generator exports this exact shape,
and the loader accepts it — tolerantly repairing or dropping invalid parts.

## Example

```json
{
  "version": 1,
  "width": 10,
  "height": 10,
  "difficulty": 5,
  "seed": "welcome",
  "name": "Rooftop rush",
  "parkingLayout": "rows",
  "start": [0, 0],
  "end": [9, 9],
  "cars": [
    { "x": 2, "y": 2, "direction": "up" },
    { "x": 7, "y": 3, "direction": "up" }
  ],
  "grid": [
    [ { "type": "start" }, { "type": "empty" }, "..."],
    [ { "type": "empty" }, { "type": "car", "direction": "down" }, "..."]
  ]
}
```

## Field reference

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `version` | number | optional | Format version. Currently `1`. Added on export. A higher number loads with a warning. |
| `width` | integer | **yes** | Grid columns, 4–60. |
| `height` | integer | **yes** | Grid rows, 4–60. |
| `difficulty` | integer 1–10 | optional | Clamped into range if out of bounds; defaults to `5`. Drives the target car density (`difficulty / 10 × cells × 0.4`). |
| `seed` | string | optional | The seed used for generation. Any text. Defaults to a random seed when missing. |
| `name` | string | optional | Human-readable level name, max 60 characters. Control characters and repeated whitespace are collapsed on load. |
| `parkingLayout` | `"rows"` \| `"columns"` | optional | `"rows"` when height ≥ width, otherwise `"columns"`. Inferred if missing/invalid. Determines the default facing of newly placed cars. |
| `start` | `[x, y]` | optional | Entry cell. `0 ≤ x < width`, `0 ≤ y < height`. Defaults to `[0, 0]`. |
| `end` | `[x, y]` | optional | Exit cell, same bounds. Defaults to `[width-1, height-1]`. Moved automatically if it equals `start`. |
| `cars` | array of car objects | optional | Each car is an obstacle. Invalid entries are dropped. At most `width × height` entries are considered. |
| `grid` | 2D array of cells | optional | Height × width matrix. **Always rebuilt** from `start`/`end`/`cars` on load; included for convenience/debugging. Mismatches produce a warning, never an error. |

### Car object

```json
{ "x": 3, "y": 5, "direction": "down" }
```

| Property | Values |
| --- | --- |
| `x`, `y` | Integer cell coordinates. Cars outside the grid are ignored. |
| `direction` | One of `"up"`, `"right"`, `"down"`, `"left"`. Missing/unknown values default to the lane-appropriate facing (`rows`: even `y` → `up`, odd `y` → `down`; `columns`: even `x` → `left`, odd `x` → `right`). |

`direction` is **presentation metadata only** — it never influences
pathfinding.

Rules enforced on load:

- No two features may share a cell: duplicate cars, and cars on top of
  `start`/`end`, are dropped with a repair warning.
- `start` and `end` must be different cells; if they collide the end is moved.
- `width`/`height` must be integers in `[4, 60]`; anything else is a fatal
  error (the file is rejected with an explanation).

### Cell object (inside `grid`)

| `type` | Extra field | Meaning |
| --- | --- | --- |
| `"empty"` | — | Drivable pavement / parking spot |
| `"start"` | — | Entry point (green **S**) |
| `"end"` | — | Exit (red **E**) |
| `"car"` | `direction: "up"\|"right"\|"down"\|"left"` | Obstacle (blue car with direction arrow) |

## Coordinate system

- `x` is the column index, increasing left → right.
- `y` is the row index, increasing top → bottom.
- A cell is addressed as `[x, y]`; the `grid` matrix is indexed `grid[y][x]`.

## Solvability semantics

Cars are impassable. A level is *solvable* when a 4-connected (Manhattan) path
exists from `start` to `end` through non-car cells.

- With **Guarantee solvable path** on and route shape `Direct`, cars are placed
  one at a time and any car that would make the level unsolvable is rejected
  (verified with breadth-first search).
- With route shape `Winding` or `Maze`, the generator blocks the shortest route
  until it is at least `1.6×` / `2.4×` the Manhattan distance long, undoing any
  block that would seal the exit off — so the level is solvable by construction
  while still being packed with cars.

Either way, `Pathfinding.isSolvable(level)` — or any BFS over the exported JSON
— agrees with the **Status** chip shown in the app.

## File size

Pretty-printed JSON with the `grid` matrix is roughly 3× larger than the
minimum. If your pipeline rebuilds the matrix (as this loader does), untick
**Include grid matrix** before exporting or copying. A 60×60 level is ~245 KB
with the grid and ~96 KB without.

## Repairs, not surprises

`sanitizeLevel()` never throws away a file it can understand. Every change it
makes is reported to the user in a "level loaded with fixes" dialog, and the
same list is available programmatically:

```js
const warnings = [];
const level = ParkingGen.Level.sanitizeLevel(rawJson, warnings);
console.log(warnings);   // ["Car #4 was outside the grid and was skipped.", …]
```

## Share codes

The app can also flatten a level into a compact, URL-safe code
(`ParkingGen.Share.encodeLevel`) that keeps every hand-placed car:

```
1~<w>x<h>~<difficulty>~<seed>~<sx>-<sy>~<ex>-<ey>~<rows|columns>~<name>~<cars>
```

- `cars` is `x-y<dir>` joined with `_`, where `<dir>` is `u`, `r`, `d` or `l`.
- `~` and `_` inside free-text fields are percent-escaped, so any seed or name
  round-trips exactly.
- Decoding always runs through the same sanitiser, so a hostile or truncated
  code cannot produce an unsafe level.

Share links put the code in the `level` query parameter
(`index.html?level=…`); `#level=…` and a bare `#<code>` fragment are accepted
too.
