/**
 * level.js — Level data model: generation, validation and (de)serialisation.
 *
 * A level describes a rectangular parking grid:
 *   - `start` / `end`  : [x, y] entry and exit cells
 *   - `cars`           : array of { x, y, direction } obstacles
 *   - `grid`           : height × width matrix of { type, direction? }
 *   - `parkingLayout`  : 'rows' | 'columns' (determines car facing)
 *
 * Invariant: `start`, `end` and `cars` are the source of truth; `grid` is
 * always derived through `rebuildGrid()`. Nothing else may mutate it.
 *
 * Exposed as `ParkingGen.Level`.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});
    const RNG = PG.RNG;
    const Path = PG.Pathfinding;

    const LEVEL_VERSION = 1;
    const MIN_SIZE = 4;
    /**
     * Single supported grid range (4–60) used for generation, resizing and
     * loading. Generation at 60×60 with the solvable guarantee takes ~100 ms,
     * which the UI covers with its loading veil, so one limit is simpler than
     * two — `MAX_SIZE_GEN`/`MAX_SIZE_LOAD` are kept as aliases for callers
     * that still reference the old names.
     */
    const MAX_SIZE = 60;
    const MAX_SIZE_GEN = MAX_SIZE;
    const MAX_SIZE_LOAD = MAX_SIZE;
    const DIRECTIONS = ['up', 'right', 'down', 'left'];
    /** Maximum fraction of grid cells that may become cars at difficulty 10. */
    const MAX_FILL = 0.4;
    /**
     * Fill ceiling for the winding/maze route modes, which keep placing cars
     * past the density target until the route is long enough.
     */
    const MAX_FILL_DETOUR = 0.6;   // ceiling for the winding/maze detour builder
    const DETOUR_ATTEMPTS = 4;      // greedy restarts when a detour stalls
    /** Longest accepted level name (guards the UI and the import path). */
    const MAX_NAME_LENGTH = 60;

    /**
     * Difficulty labels, indexed by `difficulty - 1` (1 → "Trivial",
     * 10 → "Extreme").
     */
    const DIFFICULTY_LABELS = [
        'Trivial', 'Very Easy', 'Easy', 'Simple', 'Gentle',
        'Moderate', 'Tricky', 'Hard', 'Very Hard', 'Extreme'
    ];

    /**
     * Route-shape modes. `detour` is the minimum multiple of the Manhattan
     * distance the shortest route should reach (1 = no requirement, i.e. the
     * classic density-driven "direct" fill).
     */
    const ROUTE_MODES = {
        direct: { label: 'Direct', detour: 1, blurb: 'Shortest route possible — easiest to read.' },
        winding: { label: 'Winding', detour: 1.6, blurb: 'Blocks the direct route to force a detour.' },
        maze: { label: 'Maze', detour: 2.4, blurb: 'Long, twisty route packed with cars.' }
    };

    /**
     * Human-readable label for a difficulty value (1–10).
     * @param {number} d
     * @returns {string}
     */
    function difficultyLabel(d) {
        const n = clamp(Math.round(Number(d)) || 1, 1, 10);
        return DIFFICULTY_LABELS[n - 1];
    }

    /**
     * Parking layout implied by the grid's aspect ratio.
     * @param {number} width @param {number} height
     * @returns {'rows'|'columns'}
     */
    function layoutFor(width, height) {
        return width > height ? 'columns' : 'rows';
    }

    /** Default facing for a cell, derived from the parking layout. */
    function defaultDirection(layout, x, y) {
        if (layout === 'rows') return y % 2 === 0 ? 'up' : 'down';
        return x % 2 === 0 ? 'left' : 'right';
    }

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    /**
     * Round `value` into [min, max]; fall back to `fallback` when the value is
     * missing or meaningless. Unlike `Math.round(v) || fallback`, an explicit
     * `0` is treated as a real number and clamped (0 → `min`), which keeps
     * slider and CLI input predictable.
     */
    function normalizeInt(value, min, max, fallback) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
            return fallback;
        }
        const n = Math.round(Number(value));
        return Number.isFinite(n) ? clamp(n, min, max) : fallback;
    }

    /** Normalise a level name: single line, trimmed, length-capped. */
    function sanitizeName(raw) {
        return String(raw === undefined || raw === null ? '' : raw)
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_NAME_LENGTH);
    }

    /**
     * Create an empty `height × width` matrix of `empty` cells.
     * @param {number} width @param {number} height
     * @returns {Array<Array<object>>}
     */
    function createEmptyGrid(width, height) {
        const grid = new Array(height);
        for (let y = 0; y < height; y++) {
            const row = new Array(width);
            for (let x = 0; x < width; x++) row[x] = { type: 'empty' };
            grid[y] = row;
        }
        return grid;
    }

    /** Rebuild the `grid` matrix from start/end/cars (source of truth). */
    function rebuildGrid(level) {
        const grid = createEmptyGrid(level.width, level.height);
        const sx = level.start[0], sy = level.start[1];
        const ex = level.end[0], ey = level.end[1];
        grid[sy][sx] = { type: 'start' };
        grid[ey][ex] = { type: 'end' };
        for (const car of level.cars) {
            if (car.x < 0 || car.x >= level.width || car.y < 0 || car.y >= level.height) continue;
            grid[car.y][car.x] = { type: 'car', direction: car.direction };
        }
        return grid;
    }

    /** Find the index of the car at (x, y), or -1. */
    function carIndexAt(level, x, y) {
        for (let i = 0; i < level.cars.length; i++) {
            if (level.cars[i].x === x && level.cars[i].y === y) return i;
        }
        return -1;
    }

    /** Shallow-clone a level (the grid matrix is rebuilt, never shared). */
    function cloneLevel(level) {
        const copy = {
            version: LEVEL_VERSION,
            name: level.name || '',
            width: level.width,
            height: level.height,
            difficulty: level.difficulty,
            seed: level.seed,
            parkingLayout: level.parkingLayout,
            start: [level.start[0], level.start[1]],
            end: [level.end[0], level.end[1]],
            cars: level.cars.map((c) => ({ x: c.x, y: c.y, direction: c.direction })),
            grid: null
        };
        copy.grid = rebuildGrid(copy);
        return copy;
    }

    /** Pick a cell that differs from `from` inside a width×height grid. */
    function differentCell(from, width, height) {
        // Prefer the opposite corner; fall back to a deterministic neighbour.
        const opposite = [width - 1 - from[0], height - 1 - from[1]];
        if (opposite[0] !== from[0] || opposite[1] !== from[1]) return opposite;
        if (width > 1) return [(from[0] + 1) % width, from[1]];
        return [from[0], (from[1] + 1) % height];
    }

    /**
     * Create a car-free level (used by the editor and by tests).
     * @param {number} width @param {number} height
     * @param {object} [opts] { difficulty, seed, parkingLayout, name }
     * @returns {object}
     */
    function createLevel(width, height, opts) {
        const o = opts || {};
        const w = normalizeInt(width, MIN_SIZE, MAX_SIZE, MIN_SIZE);
        const h = normalizeInt(height, MIN_SIZE, MAX_SIZE, MIN_SIZE);
        const level = {
            version: LEVEL_VERSION,
            name: sanitizeName(o.name),
            width: w,
            height: h,
            difficulty: normalizeInt(o.difficulty, 1, 10, 5),
            seed: String(o.seed === undefined || o.seed === null ? RNG.randomSeed() : o.seed),
            parkingLayout: o.parkingLayout === 'columns' || o.parkingLayout === 'rows'
                ? o.parkingLayout
                : layoutFor(w, h),
            start: [0, 0],
            end: [w - 1, h - 1],
            cars: [],
            grid: null
        };
        level.grid = rebuildGrid(level);
        return level;
    }

    /**
     * Crop/pad a level to a new size, keeping every car that still fits and
     * moving start/end back inside the grid when they fall outside.
     *
     * @param {object} level
     * @param {number} width New width (4–60).
     * @param {number} height New height (4–60).
     * @returns {{level: object, dropped: number}} The resized level plus the
     *   number of cars that no longer fit.
     */
    function resizeLevel(level, width, height) {
        const w = normalizeInt(width, MIN_SIZE, MAX_SIZE, level.width);
        const h = normalizeInt(height, MIN_SIZE, MAX_SIZE, level.height);
        if (w === level.width && h === level.height) return { level, dropped: 0 };

        const kept = [];
        let dropped = 0;
        for (const car of level.cars) {
            if (car.x < w && car.y < h) kept.push(car);
            else dropped++;
        }

        const next = {
            version: LEVEL_VERSION,
            name: level.name || '',
            width: w,
            height: h,
            difficulty: level.difficulty,
            seed: level.seed,
            parkingLayout: level.parkingLayout,
            start: [Math.min(level.start[0], w - 1), Math.min(level.start[1], h - 1)],
            end: [Math.min(level.end[0], w - 1), Math.min(level.end[1], h - 1)],
            cars: kept,
            grid: null
        };
        if (next.start[0] === next.end[0] && next.start[1] === next.end[1]) {
            next.end = differentCell(next.start, w, h);
        }
        next.grid = rebuildGrid(next);
        return { level: next, dropped };
    }

    /* ------------------------------------------------------------------ */
    /* Generation                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Generate a deterministic level.
     *
     * @param {number} width  Grid width (clamped to [4, 60]).
     * @param {number} height Grid height (clamped to [4, 60]).
     * @param {number} difficulty 1–10 (controls car density; the route modes
     *   may place a few extra cars when a long route needs the obstacles).
     * @param {string} seed Seed string; same inputs ⇒ same level.
     * @param {boolean} guaranteePath If true, no car may seal the route off:
     *   every placement is BFS-checked and rolled back if it would (the
     *   `winding`/`maze` modes additionally block the shortest path until the
     *   route is at least `detour ×` the Manhattan distance long).
     * @param {object} [options] { route: 'direct'|'winding'|'maze',
     *   name: string, onProgress: function(fraction) }
     * @returns {object} The generated level.
     */
    function generateLevel(width, height, difficulty, seed, guaranteePath, options) {
        const o = options || {};
        width = normalizeInt(width, MIN_SIZE, MAX_SIZE, MIN_SIZE);
        height = normalizeInt(height, MIN_SIZE, MAX_SIZE, MIN_SIZE);
        difficulty = normalizeInt(difficulty, 1, 10, 5);
        seed = String(seed === undefined || seed === null || seed === '' ? RNG.randomSeed() : seed);

        // Route shapes need the solvable guarantee to be meaningful.
        const routeMode = guaranteePath && ROUTE_MODES[o.route] ? o.route : 'direct';
        const detour = ROUTE_MODES[routeMode].detour;

        const rng = RNG.createRNG(seed);
        const layout = layoutFor(width, height);

        // Every cell is shuffled once: the first entry becomes the start, the
        // second the exit (so they are always distinct) and the rest form the
        // deterministic, unbiased car candidate list.
        const cells = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) cells.push([x, y]);
        }
        const spots = rng.shuffle(cells);

        const start = [spots[0][0], spots[0][1]];
        // The exit is normally the next shuffled cell. Route modes skip any cell
        // that sits right next to the start, because a one-step route is the one
        // request a generator can never lengthen (cars may not sit on either).
        let endIndex = 1;
        if (routeMode !== 'direct') {
            for (let i = 1; i < spots.length; i++) {
                const reach = Math.abs(spots[i][0] - start[0]) + Math.abs(spots[i][1] - start[1]);
                if (reach >= 2) { endIndex = i; break; }
            }
        }

        const level = {
            version: LEVEL_VERSION,
            name: sanitizeName(o.name),
            width,
            height,
            difficulty,
            seed,
            parkingLayout: layout,
            start,
            end: [spots[endIndex][0], spots[endIndex][1]],
            cars: [],
            grid: null
        };

        const cellCount = width * height;
        const targetCarCount = Math.floor((difficulty / 10) * cellCount * MAX_FILL);
        const manhattan = Math.abs(level.end[0] - level.start[0]) +
            Math.abs(level.end[1] - level.start[1]);
        // Minimum route length the user asked for (0 = no requirement).
        const minSteps = routeMode === 'direct' ? 0 : Math.round(manhattan * detour);
        const solver = Path.createSolver(width, height);
        const progress = typeof o.onProgress === 'function' ? o.onProgress : null;
        const totalCandidates = Math.max(1, spots.length - 2);
        let steps = manhattan;      // distance on an empty lot, as a starting lower bound

        // Occupancy bookkeeping. `cars` tracks *cars only*: the start and exit
        // cells are impassable to cars but open to the route, and conflating the
        // two would make a cell beside the start look like a dead end.
        const cars = new Set();
        const isEnd = (x, y) => (x === level.start[0] && y === level.start[1]) ||
            (x === level.end[0] && y === level.end[1]);
        const isFree = (x, y) => !cars.has(x + ',' + y) && !isEnd(x, y);

        const occupy = (x, y) => {
            cars.add(x + ',' + y);
            level.cars.push({ x, y, direction: defaultDirection(layout, x, y) });
        };
        const release = () => {
            const car = level.cars.pop();
            if (car) cars.delete(car.x + ',' + car.y);
            return car;
        };
        /** Replace the car list *and* the occupancy index together. */
        const setCars = (list) => {
            level.cars.length = 0;
            level.cars.push.apply(level.cars, list);
            cars.clear();
            level.cars.forEach((car) => cars.add(car.x + ',' + car.y));
        };

        steps = Path.shortestPathLength(level, level.start, level.end, solver.workspace);

        // Phase A — Winding / maze: build the detour by blocking the *current*
        // shortest route, one cell at a time, until it is at least `minSteps`
        // long. Any block that would seal the route off is undone immediately, so
        // the level stays solvable throughout. This reaches the requested detour
        // with a fraction of the cars a random fill would need (and it is why the
        // difficulty slider still controls density in these modes).
        if (routeMode !== 'direct') {
            // A long route needs obstacles, so the detour builder may pack a
            // little more than the difficulty target — but never past
            // MAX_FILL_DETOUR.
            const fillCeiling = Math.max(targetCarCount, Math.floor(cellCount * MAX_FILL_DETOUR));
            const baseCars = level.cars.slice();     // cars placed before phase A (none today)

            /** One greedy pass: block path cells until the route is long enough. */
            const attemptDetour = () => {
                setCars(baseCars);

                let current = Path.shortestPathLength(
                    level, level.start, level.end, solver.workspace);
                let guard = cellCount;      // belt-and-braces: never loop forever
                while (current >= 0 && current < minSteps &&
                    level.cars.length < fillCeiling && guard-- > 0) {
                    const path = Path.findShortestPath(
                        level, level.start, level.end, solver.workspace);
                    if (!path || path.length < 3) break;    // nothing between the ends

                    // Walk the interior in a deterministic but varying order, so
                    // the maze does not always grow from the same corner.
                    const interior = path.slice(1, path.length - 1);
                    const offset = rng.int(0, interior.length);
                    let placed = false;
                    for (let k = 0; k < interior.length; k++) {
                        const spot = interior[(offset + k) % interior.length];
                        if (!isFree(spot[0], spot[1])) continue;
                        occupy(spot[0], spot[1]);
                        const measure = Path.shortestPathLength(
                            level, level.start, level.end, solver.workspace);
                        if (measure < 0) {                 // this car would seal the route
                            release();
                            continue;
                        }
                        placed = true;
                        current = measure;
                        break;
                    }
                    if (!placed) break;   // no single cell can be blocked any more
                }
                return current;
            };

            // The greedy pass can stall in a local optimum (every remaining path
            // cell is an articulation point). Different blocking orders reach
            // different optima, so retry a few times and keep the best route —
            // each attempt is a couple of milliseconds even at 60×60.
            let best = attemptDetour();
            let bestCars = level.cars.slice();
            for (let attempt = 1; attempt < DETOUR_ATTEMPTS && best >= 0 && best < minSteps; attempt++) {
                const scored = attemptDetour();
                if (scored > best) {
                    best = scored;
                    bestCars = level.cars.slice();
                }
            }
            setCars(bestCars);
            steps = best;
            if (progress) {
                progress(Math.min(0.9, Math.max(0, (steps - manhattan)) /
                    Math.max(1, minSteps - manhattan) * 0.9));
            }
        }

        // Phase B — density fill. In direct mode this is the whole generator; in
        // the route modes it packs cars into whatever the detour left free. With
        // the guarantee on, a car that would seal the route off is rolled back.
        for (let i = 1; i < spots.length; i++) {
            if (level.cars.length >= targetCarCount) break;
            const x = spots[i][0];
            const y = spots[i][1];
            if (!isFree(x, y)) continue;
            occupy(x, y);
            if (guaranteePath) {
                const length = Path.shortestPathLength(
                    level, level.start, level.end, solver.workspace);
                if (length < 0) release();   // this car would seal the route off
                else steps = length;
            }
            if (progress && (i & 31) === 0) progress(0.9 + 0.1 * (i / totalCandidates));
        }

        // Defensive: whatever happened above, never hand back a blocked level
        // when the caller asked for a solvable one.
        if (guaranteePath) {
            steps = Path.shortestPathLength(level, level.start, level.end, solver.workspace);
            while (steps < 0 && level.cars.length > 0) {
                release();
                steps = Path.shortestPathLength(
                    level, level.start, level.end, solver.workspace);
            }
        }
        if (progress) progress(1);

        level.grid = rebuildGrid(level);
        return level;
    }

    /* ------------------------------------------------------------------ */
    /* Validation / sanitisation of externally loaded levels               */
    /* ------------------------------------------------------------------ */

    function toInt(v) {
        if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
        const n = Number(v);
        return Number.isFinite(n) ? Math.round(n) : NaN;
    }

    function toPoint(v) {
        if (!Array.isArray(v) || v.length < 2) return null;
        const x = toInt(v[0]);
        const y = toInt(v[1]);
        if (Number.isNaN(x) || Number.isNaN(y)) return null;
        return [x, y];
    }

    /** Compile a plain-text summary of the repairs applied by `sanitizeLevel`. */
    function formatWarnings(warnings) {
        if (!warnings || !warnings.length) return '';
        return warnings.join('\n');
    }

    /**
     * Validate and normalise an untrusted level object (e.g. parsed JSON).
     *
     * Never trusts the input: dimensions are re-derived, every coordinate is
     * range-checked, duplicate/overlapping cars are dropped and the `grid`
     * matrix is always rebuilt from `start`/`end`/`cars`.
     *
     * @param {object} raw Parsed JSON object.
     * @param {string[]} [warnings] Optional array that receives non-fatal
     *   fixes applied while sanitising.
     * @returns {object} A safe, fully-rebuilt level.
     * @throws {Error} with a user-friendly message on fatal problems.
     */
    function sanitizeLevel(raw, warnings) {
        warnings = warnings || [];

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('File does not contain a level object.');
        }

        const width = toInt(raw.width);
        const height = toInt(raw.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            throw new Error('Missing or invalid "width"/"height" values.');
        }
        if (width < MIN_SIZE || height < MIN_SIZE) {
            throw new Error(`Grid is too small (minimum ${MIN_SIZE}×${MIN_SIZE}).`);
        }
        if (width > MAX_SIZE || height > MAX_SIZE) {
            throw new Error(`Grid is too large (maximum ${MAX_SIZE}×${MAX_SIZE}).`);
        }

        const version = toInt(raw.version);
        if (Number.isFinite(version) && version > LEVEL_VERSION) {
            warnings.push(`File uses level format v${version}; this tool understands ` +
                `v${LEVEL_VERSION} and loaded what it could.`);
        }

        let difficulty = toInt(raw.difficulty);
        if (!Number.isFinite(difficulty)) {
            warnings.push('Difficulty was missing; defaulted to 5.');
            difficulty = 5;
        } else if (difficulty < 1 || difficulty > 10) {
            const fixed = clamp(difficulty, 1, 10);
            warnings.push(`Difficulty ${difficulty} was out of range; set to ${fixed}.`);
            difficulty = fixed;
        }

        const seed = (raw.seed !== undefined && raw.seed !== null) ? String(raw.seed) : RNG.randomSeed();

        const name = sanitizeName(raw.name);
        if (raw.name !== undefined && raw.name !== null && String(raw.name) !== name) {
            warnings.push('Level name was trimmed to a single safe line.');
        }

        let layout = raw.parkingLayout === 'columns' ? 'columns'
            : raw.parkingLayout === 'rows' ? 'rows' : null;
        if (!layout) {
            layout = layoutFor(width, height);
            warnings.push(`Parking layout was missing; inferred as "${layout}".`);
        }

        let start = toPoint(raw.start);
        if (!start || start[0] < 0 || start[0] >= width || start[1] < 0 || start[1] >= height) {
            warnings.push('Start position was invalid; moved to (0, 0).');
            start = [0, 0];
        }

        let end = toPoint(raw.end);
        if (!end || end[0] < 0 || end[0] >= width || end[1] < 0 || end[1] >= height) {
            warnings.push('End position was invalid; moved to the opposite corner.');
            end = [width - 1, height - 1];
        }
        if (end[0] === start[0] && end[1] === start[1]) {
            end = start[0] === width - 1 && start[1] === height - 1
                ? [0, 0] : [width - 1, height - 1];
            if (end[0] === start[0] && end[1] === start[1]) end = differentCell(start, width, height);
            warnings.push('Start and end were the same cell; the end was moved.');
        }

        if (raw.cars !== undefined && !Array.isArray(raw.cars)) {
            throw new Error('"cars" must be an array.');
        }
        const rawCars = Array.isArray(raw.cars) ? raw.cars : [];
        const carCap = width * height;
        if (rawCars.length > carCap) {
            warnings.push(`File listed ${rawCars.length} cars for a ${width}×${height} grid; ` +
                `only the first ${carCap} were considered.`);
        }

        const cars = [];
        const occupied = new Set();
        occupied.add(start[0] + ',' + start[1]);
        occupied.add(end[0] + ',' + end[1]);

        const limit = Math.min(rawCars.length, carCap);
        for (let i = 0; i < limit; i++) {
            const car = rawCars[i];
            if (!car || typeof car !== 'object' || Array.isArray(car)) {
                warnings.push(`Car #${i + 1} was not an object and was skipped.`);
                continue;
            }
            const x = toInt(car.x);
            const y = toInt(car.y);
            if (Number.isNaN(x) || Number.isNaN(y) ||
                x < 0 || x >= width || y < 0 || y >= height) {
                warnings.push(`Car #${i + 1} was outside the grid and was skipped.`);
                continue;
            }
            const key = x + ',' + y;
            if (occupied.has(key)) {
                warnings.push(`Car at (${x}, ${y}) overlaps another feature and was skipped.`);
                continue;
            }
            const direction = DIRECTIONS.indexOf(car.direction) !== -1
                ? car.direction
                : defaultDirection(layout, x, y);
            if (DIRECTIONS.indexOf(car.direction) === -1) {
                warnings.push(`Car at (${x}, ${y}) had an invalid direction; set to "${direction}".`);
            }
            occupied.add(key);
            cars.push({ x, y, direction });
        }

        const level = {
            version: LEVEL_VERSION,
            name,
            width,
            height,
            difficulty,
            seed,
            parkingLayout: layout,
            start,
            end,
            cars,
            grid: null
        };

        level.grid = rebuildGrid(level);

        // If the file also carried a grid matrix, cross-check it against the
        // rebuilt truth and warn on mismatch (the rebuild always wins).
        if (Array.isArray(raw.grid)) {
            let mismatches = 0;
            let facings = 0;
            for (let y = 0; y < height; y++) {
                const row = Array.isArray(raw.grid[y]) ? raw.grid[y] : null;
                for (let x = 0; x < width; x++) {
                    const cell = row && row[x];
                    const truth = level.grid[y][x];
                    if (!cell || cell.type !== truth.type) {
                        mismatches++;
                    } else if (truth.type === 'car' && cell.direction !== truth.direction) {
                        // Same contents, different facing: cosmetic, but worth
                        // telling the author about since it silently normalises.
                        facings++;
                    }
                }
            }
            if (mismatches > 0) {
                warnings.push(`Embedded grid differed from car/start data in ${mismatches} ` +
                    'cell(s); it was rebuilt.');
            }
            if (facings > 0) {
                warnings.push(`Embedded grid had ${facings} car(s) facing a different way ` +
                    'than the car list; the car list won.');
            }
        }

        return level;
    }

    /**
     * Serialise a level. `includeGrid` is on by default (the documented file
     * format); turning it off yields a much smaller file whose consumers
     * rebuild the grid from `cars`/`start`/`end` — exactly what the loader
     * does.
     *
     * @param {object} level
     * @param {object} [options] { includeGrid: boolean, pretty: boolean }
     * @returns {string} JSON text.
     */
    function serializeLevel(level, options) {
        const o = options || {};
        const includeGrid = o.includeGrid !== false;
        const pretty = o.pretty !== false;
        const out = {
            version: LEVEL_VERSION,
            width: level.width,
            height: level.height,
            difficulty: level.difficulty,
            seed: level.seed,
            parkingLayout: level.parkingLayout,
            start: [level.start[0], level.start[1]],
            end: [level.end[0], level.end[1]],
            cars: level.cars.map((c) => ({ x: c.x, y: c.y, direction: c.direction }))
        };
        if (level.name) out.name = level.name;
        if (includeGrid) out.grid = level.grid;
        return JSON.stringify(out, null, pretty ? 2 : 0);
    }

    PG.Level = {
        VERSION: LEVEL_VERSION,
        MIN_SIZE,
        MAX_SIZE,
        MAX_SIZE_GEN,
        MAX_SIZE_LOAD,
        MAX_FILL,
        MAX_FILL_DETOUR,
        MAX_NAME_LENGTH,
        DIRECTIONS,
        DIFFICULTY_LABELS,
        ROUTE_MODES,
        difficultyLabel,
        layoutFor,
        defaultDirection,
        sanitizeName,
        createEmptyGrid,
        rebuildGrid,
        carIndexAt,
        cloneLevel,
        createLevel,
        resizeLevel,
        differentCell,
        normalizeInt,
        generateLevel,
        sanitizeLevel,
        serializeLevel,
        formatWarnings
    };
})(typeof window !== 'undefined' ? window : globalThis);
