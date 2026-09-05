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
| `version` | number | optional | Format version. Currently `1`. Added on export. |
| `width` | integer | **yes** | Grid columns. Generation: 4–30. Loading: 4–60. |
| `height` | integer | **yes** | Grid rows. Same ranges as `width`. |
| `difficulty` | integer 1–10 | optional | Clamped into range if out of bounds; defaults to `5`. Drives target car density (`difficulty / 10 × cells × 0.4`). |
| `seed` | string | optional | The seed used for generation. Any text. Defaults to a random seed when missing. |
| `parkingLayout` | `"rows"` \| `"columns"` | optional | `"rows"` when height ≥ width, otherwise `"columns"`. Inferred if missing/invalid. Determines the default facing of newly placed cars. |
| `start` | `[x, y]` | optional | Entry cell. `0 ≤ x < width`, `0 ≤ y < height`. Defaults to `[0, 0]`. |
| `end` | `[x, y]` | optional | Exit cell, same bounds. Defaults to `[width-1, height-1]`. Moved automatically if it equals `start`. |
| `cars` | array of car objects | optional | Each car is an obstacle. See below. Invalid entries are dropped. |
| `grid` | 2D array of cells | optional | Height × width matrix. **Always rebuilt** from `start`/`end`/`cars` on load; included for convenience/debugging. Mismatches produce a warning, never an error. |

### Car object

```json
{ "x": 3, "y": 5, "direction": "down" }
```

| Property | Values |
| --- | --- |
| `x`, `y` | Integer cell coordinates. Cars outside the grid are ignored. |
| `direction` | One of `"up"`, `"right"`, `"down"`, `"left"`. Missing/unknown values default to the lane-appropriate facing (`rows`: even `y` → `up`, odd `y` → `down`; `columns`: even `x` → `left`, odd `x` → `right`). |

Rules enforced on load:

- No two features may share a cell: duplicate cars, and cars on top of
  `start`/`end`, are dropped with a repair warning.
- `start` and `end` must be different cells; if they collide the end is moved.

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
exists from `start` to `end` through non-car cells. The generator's
"Guarantee solvable path" option places cars one at a time and rejects any car
that would make the level unsolvable (verified with breadth-first search), so
every generated level with that option on has a valid route.
