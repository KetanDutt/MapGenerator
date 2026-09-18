# Testing

The project ships a **dependency-free** test suite — no Jest, no jsdom, no
`npm install`. It runs the same browser modules the page uses by evaluating
them inside Node (`tools/load-modules.js`), then exercises them directly.

```bash
npm test                          # everything
node tools/test.js --filter=share # one suite (substring match on the name)
node tools/test.js --quiet        # failures + summary only
```

Exit code is non-zero when any assertion fails, so CI can call it directly
(see `.github/workflows/ci.yml`, which runs it on Node 18, 20 and 22).

## What is covered

| Suite | Highlights |
| --- | --- |
| **RNG** | Determinism, `[0, 1)` bounds, integer range coverage, unbiased `bool`, non-mutating shuffle, hash range, unique random seeds |
| **Pathfinding** | 200 random mazes compared against an independent reference BFS, route continuity/obstacle checks, `start === end`, sealed exits, out-of-bounds rejection, workspace reuse across searches and grid sizes |
| **Generation** | Determinism over 1 000 seeds, structural invariants on 120 random configurations (distinct start/exit, no overlaps, grid matrix matches the model), density caps per difficulty, lane facing rules, difficulty labels, route-mode detours, clamping |
| **Sanitisation** | Repair reporting, grid cross-checking, missing grid rebuild, fatal-error messages, booleans/blanks rejected as numbers, car-list caps, future format versions, name normalisation |
| **Serialisation** | Documented export shape, compact (`includeGrid: false`) output, byte-identical re-export, clone isolation |
| **Resize** | Padding/shrinking, dropped-car accounting, clamping, no-op fast path |
| **Share codes** | Exact round trips (including unicode names/seeds), URL embedding via `URLSearchParams`, hash/query parsing, malformed input, lenient per-car recovery, size budgets |
| **Markdown** | Heading slugs, inline formatting, tables/nested lists/quotes/fences, XSS escaping, and every real document in `docs/` renders balanced |
| **Image layout** | Canvas geometry maths, option clamping, graceful degradation without a DOM |
| **Performance** | 60×60 generation budget, average search time, heap growth over 400 searches (guards against per-search allocations), large-file sanitisation budget |
| **Wiring** | Every id `app.js` caches exists in `index.html`, every `els.*` reference is cached, no unused ids, local assets exist, no remote (`http(s)`) asset references, every `<use href="#i-…">` resolves to an icon sprite symbol, CSS classes toggled from JS are defined, stylesheet/script order, and the sibling order the CSS state selectors rely on |
| **UI** | The real `app.js` booted in `tools/dom-stub.js`: initial render, icon mount, painting, drag strokes as one undo step, undo/redo, route overlay geometry, keyboard cursor + tools, Escape, form generation, drag-and-drop loading, blocked levels, theme persistence, clipboard, share-link boot, exports, JSON panel, session saving |

The **wiring** suite deserves a note: it is the cheapest possible integration
test for a zero-build project. It parses `index.html`, `js/app.js` and
`css/style.css` and fails on typos that would otherwise only show up as a blank
page in a browser — and it fails if anyone reintroduces a CDN link or an icon
that does not exist.

The **UI** suite is the other half: `tools/dom-stub.js` is a ~300-line
implementation of the DOM surface the controller uses (element tree, attributes,
`classList`, bubbling events, computed style, canvas, `localStorage`, and a
controllable clock). It lets the suite type into the seed box, click a tool,
paint a stroke, press Enter on the grid, drop a JSON file and read the resulting
DOM — with deterministic timing and no browser, jsdom or network. Because the
clock is fake, timer-driven behaviour (the generation deferral, the JSON
throttle, the session debounce, toast deduplication) is tested exactly instead of
by sleeping.

## Writing a test

```js
suite('My feature');

test('does the thing', () => {
    const level = Level.createLevel(10, 10, { seed: 'x' });
    assertEqual(Level.carIndexAt(level, 0, 0), -1, 'no car at the origin');
});

// Promise-returning tests are awaited before the summary is printed.
test('async things too', () => Promise.resolve().then(() => assert(true)));
```

Available helpers: `suite`, `test`, `assert`, `assertEqual`, `assertClose`,
`assertDeepEqual`, `assertThrows`, `fail`. Anything you add to
`tools/load-modules.js`'s `MODULE_FILES` list becomes importable as
`ParkingGen.<Module>`.

Guidelines:

- Prefer **property-style** assertions (`invariants hold for 200 random
  inputs`) over single golden values — they catch far more and survive
  refactors.
- When you fix a bug, add an assertion that would have failed before.
- Keep budgets loose enough to pass on slow CI runners (the current ones have
  >5× headroom).
- If you touch the level format or generator, run the suite twice and confirm
  determinism assertions still pass.

## Manual checklist

Some things are only worth checking by hand — please do these before a release:

1. Generate at 4×4, 30×30 and 60×60, with and without the solvable guarantee,
   in each route shape.
2. Drag-paint a long stroke across a 60×60 grid: it should stay smooth, produce
   exactly one undo step, and update the JSON preview within ~150 ms of the
   last cell.
3. Load a hand-edited JSON file with several broken cars; confirm the repair
   dialog lists each fix and the level renders.
4. Copy a share link, open it in a new tab, and confirm the level matches
   car-for-car.
5. Export a PNG in light and dark mode; check the caption and that the route
   only appears while *Show route* is on.
6. Tab into the grid and drive it with the arrow keys, <kbd>Enter</kbd>,
   <kbd>Delete</kbd> and <kbd>R</kbd>; confirm the live announcements.
7. Toggle dark mode, reload, and confirm the preference and your last level are
   restored.
8. Resize a level up and down; check the dropped-car count and undo.
9. Narrow the window to ~360 px and confirm the layout stays usable.
