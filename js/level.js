/**
 * level.js — Level data model: generation, validation and (de)serialisation.
 *
 * A level describes a rectangular parking grid:
 *   - `start` / `end`  : [x, y] entry and exit cells
 *   - `cars`           : array of { x, y, direction } obstacles
 *   - `grid`           : height x width matrix of { type, direction? }
 *   - `parkingLayout`  : 'rows' | 'columns' (determines car facing)
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
    const MAX_SIZE_GEN = 30;   // slider range for generation
    const MAX_SIZE_LOAD = 60;  // hard cap when loading external files
    const DIRECTIONS = ['up', 'right', 'down', 'left'];
    // Maximum fraction of grid cells that may become cars at difficulty 10.
    const MAX_FILL = 0.4;

    const DIFFICULTY_LABELS = [
        'Trivial', 'Very Easy', 'Easy', 'Simple', 'Gentle',
        'Moderate', 'Tricky', 'Hard', 'Very Hard', 'Extreme', 'Insane'
    ];

    function difficultyLabel(d) {
        return DIFFICULTY_LABELS[Math.min(10, Math.max(1, d | 0))] || 'Moderate';
    }

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

    function createEmptyGrid(width, height) {
        const grid = new Array(height);
        for (let y = 0; y < height; y++) {
            grid[y] = new Array(width);
            for (let x = 0; x < width; x++) grid[y][x] = { type: 'empty' };
        }
        return grid;
    }

    /** Rebuild the `grid` matrix from start/end/cars (source of truth). */
    function rebuildGrid(level) {
        const grid = createEmptyGrid(level.width, level.height);
        const [sx, sy] = level.start;
        const [ex, ey] = level.end;
        grid[sy][sx] = { type: 'start' };
        grid[ey][ex] = { type: 'end' };
        for (const car of level.cars) {
            grid[car.y][car.x] = { type: 'car', direction: car.direction };
        }
        return grid;
    }

    /**
     * Generate a deterministic level.
     *
     * @param {number} width  Grid width (clamped to [4, 30]).
     * @param {number} height Grid height (clamped to [4, 30]).
     * @param {number} difficulty 1–10 (controls car density).
     * @param {string} seed Seed string; same seed ⇒ same level.
     * @param {boolean} guaranteePath If true, cars are placed so a
     *   start→end path always exists (BFS-checked).
     * @returns {object} The generated level.
     */
    function generateLevel(width, height, difficulty, seed, guaranteePath) {
        width = clamp(Math.round(width) || MIN_SIZE, MIN_SIZE, MAX_SIZE_GEN);
        height = clamp(Math.round(height) || MIN_SIZE, MIN_SIZE, MAX_SIZE_GEN);
        difficulty = clamp(Math.round(difficulty) || 5, 1, 10);
        seed = String(seed || RNG.randomSeed());

        const rng = RNG.createRNG(seed);
        const layout = layoutFor(width, height);

        const start = [rng.int(0, width), rng.int(0, height)];
        let end = [rng.int(0, width), rng.int(0, height)];
        let guard = 0;
        while (end[0] === start[0] && end[1] === start[1] && guard++ < 500) {
            end = [rng.int(0, width), rng.int(0, height)];
        }

        const level = {
            version: LEVEL_VERSION,
            width,
            height,
            difficulty,
            seed,
            parkingLayout: layout,
            start,
            end,
            cars: [],
            grid: null
        };

        // All candidate parking spots (everything except start & end),
        // shuffled deterministically so fills are even and unbiased.
        const candidates = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if ((x === start[0] && y === start[1]) ||
                    (x === end[0] && y === end[1])) continue;
                candidates.push([x, y]);
            }
        }
        const spots = rng.shuffle(candidates);

        const targetCarCount = Math.floor((difficulty / 10) * width * height * MAX_FILL);

        if (guaranteePath) {
            // Reserve a shortest path, then fill around it. Every placed car
            // is re-verified, so the result is always solvable.
            for (const [x, y] of spots) {
                if (level.cars.length >= targetCarCount) break;
                const direction = defaultDirection(layout, x, y);
                level.cars.push({ x, y, direction });
                if (!Path.isSolvable(level)) {
                    level.cars.pop(); // this car would block the only route
                }
            }
        } else {
            for (let i = 0; i < Math.min(targetCarCount, spots.length); i++) {
                const [x, y] = spots[i];
                level.cars.push({ x, y, direction: defaultDirection(layout, x, y) });
            }
        }

        level.grid = rebuildGrid(level);
        return level;
    }

    /* ------------------------------------------------------------------ */
    /* Validation / sanitisation of externally loaded levels               */
    /* ------------------------------------------------------------------ */

    function toInt(v) {
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

    /**
     * Validate and normalise an untrusted level object (e.g. parsed JSON).
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
        if (width > MAX_SIZE_LOAD || height > MAX_SIZE_LOAD) {
            throw new Error(`Grid is too large (maximum ${MAX_SIZE_LOAD}×${MAX_SIZE_LOAD}).`);
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
            if (end[0] === start[0] && end[1] === start[1]) end[0] = (start[0] + 1) % width;
            warnings.push('Start and end were the same cell; the end was moved.');
        }

        // Cars.
        const cars = [];
        const occupied = new Set();
        occupied.add(start[0] + ',' + start[1]);
        occupied.add(end[0] + ',' + end[1]);

        if (raw.cars !== undefined && !Array.isArray(raw.cars)) {
            throw new Error('"cars" must be an array.');
        }
        const rawCars = Array.isArray(raw.cars) ? raw.cars : [];

        rawCars.forEach((car, i) => {
            if (!car || typeof car !== 'object') {
                warnings.push(`Car #${i + 1} was not an object and was skipped.`);
                return;
            }
            const x = toInt(car.x);
            const y = toInt(car.y);
            if (Number.isNaN(x) || Number.isNaN(y) ||
                x < 0 || x >= width || y < 0 || y >= height) {
                warnings.push(`Car #${i + 1} was outside the grid and was skipped.`);
                return;
            }
            const key = x + ',' + y;
            if (occupied.has(key)) {
                warnings.push(`Car at (${x}, ${y}) overlaps another feature and was skipped.`);
                return;
            }
            let direction = DIRECTIONS.includes(car.direction)
                ? car.direction
                : defaultDirection(layout, x, y);
            if (!DIRECTIONS.includes(car.direction)) {
                warnings.push(`Car at (${x}, ${y}) had an invalid direction; set to "${direction}".`);
            }
            occupied.add(key);
            cars.push({ x, y, direction });
        });

        const level = {
            version: LEVEL_VERSION,
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
        // rebuilt truth and warn on mismatch (we always rebuild).
        if (Array.isArray(raw.grid)) {
            let mismatches = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const cell = raw.grid[y] && raw.grid[y][x];
                    if (!cell || cell.type !== level.grid[y][x].type) mismatches++;
                }
            }
            if (mismatches > 0) {
                warnings.push(`Embedded grid differed from car/start data in ${mismatches} cell(s); it was rebuilt.`);
            }
        }

        return level;
    }

    PG.Level = {
        VERSION: LEVEL_VERSION,
        MIN_SIZE,
        MAX_SIZE_GEN,
        MAX_SIZE_LOAD,
        DIRECTIONS,
        difficultyLabel,
        layoutFor,
        defaultDirection,
        createEmptyGrid,
        rebuildGrid,
        generateLevel,
        sanitizeLevel
    };
})(typeof window !== 'undefined' ? window : globalThis);
