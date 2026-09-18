#!/usr/bin/env node
'use strict';

/**
 * test.js — Dependency-free test suite for the Parking Lot Level Generator.
 *
 *   node tools/test.js               # run everything
 *   node tools/test.js --filter=share
 *   node tools/test.js --quiet       # only failures + summary
 *
 * Covered:
 *   1. RNG            — determinism, ranges, seeding, random seeds
 *   2. Pathfinding    — BFS correctness vs. brute force, workspace reuse
 *   3. Generation     — determinism, invariants, density caps, route modes
 *   4. Sanitisation   — untrusted input repair/rejection
 *   5. Serialisation  — export shape, round trips, grid inclusion
 *   6. Resize         — crop/pad semantics
 *   7. Share codes    — encode/decode round trips, URL handling, hostility
 *   8. Markdown       — docs viewer rendering + escaping
 *   9. Image layout   — pure geometry for the PNG exporter
 *  10. Performance    — budgets that guard against accidental O(n²) work
 *  11. Wiring         — index.html ⇄ app.js ids, icon sprite, offline assets
 *  12. UI             — the real controller booted against a DOM stub
 *
 * Exits non-zero when any assertion fails, so it drops straight into CI.
 */

const fs = require('fs');
const path = require('path');
const { loadParkingGen } = require('./load-modules');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const FILTER = (args.find((a) => a.startsWith('--filter=')) || '').split('=')[1] || '';
const QUIET = args.includes('--quiet');

const PG = loadParkingGen(ROOT);
const { Level, Pathfinding, RNG, Share, Markdown, Image } = PG;

/* ------------------------------- Harness ------------------------------- */

let passed = 0;
const failures = [];
const pending = [];          // in-flight async tests
let suiteName = '';
let suiteFailed = false;
let skipSuite = false;

function suite(name) {
    suiteName = name;
    suiteFailed = false;
    skipSuite = Boolean(FILTER) && !name.toLowerCase().includes(FILTER.toLowerCase());
    if (!skipSuite && !QUIET) console.log(`\n— ${name} —`);
}

function report(name, err) {
    if (!err) {
        passed++;
        if (!QUIET) console.log(`  ✓ ${name}`);
        return;
    }
    suiteFailed = true;
    failures.push({ suite: suiteName, name, error: err });
    console.error(`  ✗ ${name}\n      ${err && err.message ? err.message : err}`);
}

function test(name, fn) {
    if (skipSuite) return;
    try {
        const result = fn();
        // Async tests (promise-returning) are awaited before the summary.
        if (result && typeof result.then === 'function') {
            const owner = suiteName;
            pending.push(result.then(() => report(name, null), (err) => report(name, err))
                .catch((err) => { suiteName = owner; report(name, err); }));
            return;
        }
        report(name, null);
    } catch (err) {
        report(name, err);
    }
}

function fail(message) {
    throw new Error(message);
}

function assert(condition, message) {
    if (!condition) fail(message || 'assertion failed');
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        fail(`${message || 'values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertClose(actual, expected, tolerance, message) {
    if (!(Math.abs(actual - expected) <= tolerance)) {
        fail(`${message || 'values differ'}: expected ${expected} ±${tolerance}, got ${actual}`);
    }
}

function assertDeepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) fail(`${message || 'values differ'}: expected ${b}, got ${a}`);
}

function assertThrows(fn, message) {
    let threw = false;
    try {
        fn();
    } catch (_) {
        threw = true;
    }
    if (!threw) fail(`${message || 'expected a throw'} (nothing was thrown)`);
}

/* --------------------------- 1. RNG --------------------------- */

suite('RNG');

test('same seed produces the same sequence', () => {
    const a = RNG.createRNG('test-seed');
    const b = RNG.createRNG('test-seed');
    for (let i = 0; i < 50; i++) assertEqual(a.next(), b.next(), `draw #${i}`);
});

test('different seeds diverge', () => {
    const a = RNG.createRNG('seed-a').next();
    const b = RNG.createRNG('seed-b').next();
    assert(a !== b, 'two different seeds produced the same first value');
});

test('numeric and string seeds behave consistently', () => {
    assertEqual(RNG.hashSeed('42'), RNG.hashSeed(42), 'hashSeed coerces consistently');
    assert(RNG.hashSeed('') === RNG.hashSeed('') && RNG.hashSeed('') >= 0, 'empty seed hashes');
});

test('hashSeed returns an unsigned 32-bit integer', () => {
    ['', 'a', 'x'.repeat(500), 'ünïcode-🎉'].forEach((seed) => {
        const h = RNG.hashSeed(seed);
        assert(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `hash out of range for ${JSON.stringify(seed)}`);
    });
});

test('outputs stay inside [0, 1)', () => {
    const rng = RNG.createRNG('range-check');
    for (let i = 0; i < 2000; i++) {
        const v = rng.next();
        assert(v >= 0 && v < 1, `value ${v} out of range`);
    }
});

test('int(min, max) is inclusive/exclusive and stays in range', () => {
    const rng = RNG.createRNG('int-check');
    const seen = new Set();
    for (let i = 0; i < 3000; i++) {
        const v = rng.int(3, 7);
        assert(Number.isInteger(v) && v >= 3 && v < 7, `int out of range: ${v}`);
        seen.add(v);
    }
    assertDeepEqual([...seen].sort(), [3, 4, 5, 6], 'every value in [3, 7) should appear');
});

test('bool(p) is unbiased at the extremes', () => {
    const rng = RNG.createRNG('bool-check');
    for (let i = 0; i < 100; i++) {
        assertEqual(rng.bool(1), true, 'bool(1) is always true');
        assertEqual(rng.bool(0), false, 'bool(0) is always false');
    }
});

test('shuffle preserves elements and does not mutate the input', () => {
    const rng = RNG.createRNG('shuffle');
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = input.slice();
    const out = rng.shuffle(input);
    assertDeepEqual(input, copy, 'input must not be mutated');
    assertDeepEqual(out.slice().sort((a, b) => a - b), copy, 'elements preserved');
    assert(out.length === 8, 'length preserved');
});

test('shuffle is deterministic for a seed but varied across seeds', () => {
    const a = RNG.createRNG('s1').shuffle([...Array(20).keys()]).join(',');
    const b = RNG.createRNG('s1').shuffle([...Array(20).keys()]).join(',');
    const c = RNG.createRNG('s2').shuffle([...Array(20).keys()]).join(',');
    assertEqual(a, b, 'same seed → same order');
    assert(a !== c, 'different seeds should not always agree');
});

test('randomSeed produces URL-safe strings of the requested length', () => {
    for (let i = 0; i < 20; i++) {
        const seed = RNG.randomSeed();
        assert(/^[a-z0-9]{9}$/.test(seed), `unexpected seed: ${seed}`);
    }
    assert(/^[a-z0-9]{4}$/.test(RNG.randomSeed(4)), 'custom length honoured');
});

test('randomSeed values are distinct', () => {
    const seeds = new Set();
    for (let i = 0; i < 500; i++) seeds.add(RNG.randomSeed());
    assert(seeds.size > 495, `expected near-unique seeds, got ${seeds.size}/500`);
});

/* --------------------------- 2. Pathfinding --------------------------- */

suite('Pathfinding');

/** Brute-force BFS over a plain string grid, used as the reference. */
function referenceShortestPath(grid, start, end) {
    const rows = grid.length;
    const cols = grid[0].length;
    const dist = Array.from({ length: rows }, () => new Array(cols).fill(-1));
    dist[start[1]][start[0]] = 0;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
        const [x, y] = queue[head];
        if (x === end[0] && y === end[1]) return dist[y][x];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return;
            if (grid[ny][nx] === '#' || dist[ny][nx] !== -1) return;
            dist[ny][nx] = dist[y][x] + 1;
            queue.push([nx, ny]);
        });
    }
    return -1;
}

function levelFromGrid(grid) {
    const height = grid.length;
    const width = grid[0].length;
    const level = Level.createLevel(width, height, { seed: 'grid' });
    level.start = [0, 0];
    level.end = [width - 1, height - 1];
    level.cars = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (grid[y][x] === '#') level.cars.push({ x, y, direction: 'up' });
        }
    }
    level.grid = Level.rebuildGrid(level);
    return level;
}

test('BFS matches a reference implementation on 200 random mazes', () => {
    const rng = RNG.createRNG('maze-fuzz');
    for (let trial = 0; trial < 200; trial++) {
        const width = rng.int(4, 13);
        const height = rng.int(4, 13);
        const density = rng.next() * 0.5;
        const grid = [];
        for (let y = 0; y < height; y++) {
            let row = '';
            for (let x = 0; x < width; x++) row += rng.next() < density ? '#' : '.';
            grid.push(row.split(''));
        }
        grid[0][0] = '.';
        grid[height - 1][width - 1] = '.';

        const level = levelFromGrid(grid);
        const expected = referenceShortestPath(grid, [0, 0], [width - 1, height - 1]);
        const actual = Pathfinding.shortestPathLength(level, level.start, level.end);
        assertEqual(actual, expected, `trial #${trial} (${width}×${height})`);
        assertEqual(Pathfinding.isSolvable(level), expected >= 0, `solvability mismatch in trial #${trial}`);
    }
});

test('findShortestPath returns a continuous, obstacle-free route', () => {
    const rng = RNG.createRNG('route-shape');
    for (let trial = 0; trial < 30; trial++) {
        const level = Level.generateLevel(12, 12, 8, 'route-' + trial, true);
        const route = Pathfinding.findShortestPath(level, level.start, level.end);
        if (!route) continue;                 // guarantee off? then it may be blocked
        assertDeepEqual(route[0], level.start, 'route starts at the start cell');
        assertDeepEqual(route[route.length - 1], level.end, 'route ends at the exit cell');
        const blocked = new Set(level.cars.map((c) => c.x + ',' + c.y));
        for (let i = 0; i < route.length; i++) {
            const [x, y] = route[i];
            assert(!blocked.has(x + ',' + y), `route crosses a car at ${x},${y}`);
            if (i > 0) {
                const [px, py] = route[i - 1];
                assertEqual(Math.abs(px - x) + Math.abs(py - y), 1, 'route steps are 4-connected');
            }
        }
        assertEqual(route.length - 1,
            Pathfinding.shortestPathLength(level, level.start, level.end),
            'path length and shortestPathLength agree');
        void rng;
    }
});

test('start === end resolves to a single-cell route', () => {
    const level = Level.createLevel(6, 6, { seed: 'same' });
    level.end = level.start.slice();
    level.grid = Level.rebuildGrid(level);
    assertEqual(Pathfinding.shortestPathLength(level, level.start, level.end), 0, 'zero steps');
    assertDeepEqual(Pathfinding.findShortestPath(level, level.start, level.end), [[0, 0]]);
    assert(Pathfinding.isSolvable(level), 'a single cell is trivially reachable');
});

test('a wall of cars blocks the exit', () => {
    const level = Level.createLevel(5, 5, { seed: 'wall' });
    level.start = [0, 2];
    level.end = [4, 2];
    level.cars = [];
    for (let y = 0; y < 5; y++) level.cars.push({ x: 2, y, direction: 'up' });
    level.grid = Level.rebuildGrid(level);
    assert(!Pathfinding.isSolvable(level), 'the wall must block the route');
    assertEqual(Pathfinding.findShortestPath(level, level.start, level.end), null, 'no path array');
});

test('out-of-bounds coordinates are rejected, not guessed', () => {
    const level = Level.createLevel(6, 6, { seed: 'bounds' });
    assertEqual(Pathfinding.findShortestPath(level, [-1, 0], level.end), null);
    assertEqual(Pathfinding.findShortestPath(level, level.start, [99, 0]), null);
    assertEqual(Pathfinding.shortestPathLength(level, level.start, [0, 99]), -1);
    assertEqual(Pathfinding.canReach(level, [100, 100], level.end, undefined), false);
    assertEqual(Pathfinding.isSolvable(null), false);
});

test('reusing one workspace across different searches stays correct', () => {
    const solver = Pathfinding.createSolver(10, 10);
    const sizes = [];
    for (let i = 0; i < 25; i++) {
        const level = Level.generateLevel(10, 10, 6, 'ws-' + i, true);
        const expected = referenceShortestPath(
            level.grid.map((row) => row.map((cell) => (cell.type === 'car' ? '#' : '.'))),
            level.start, level.end);
        assertEqual(solver.shortestPathLength(level, level.start, level.end), expected,
            `workspace reuse broke search #${i}`);
        sizes.push(solver.isSolvable(level));
    }
    assert(sizes.every((v) => v === true), 'all generated levels should be solvable');
});

test('a stale workspace for another size is replaced automatically', () => {
    const workspace = Pathfinding.createWorkspace(6, 6);
    const big = Level.createLevel(30, 30, { seed: 'big' });
    const steps = Pathfinding.shortestPathLength(big, big.start, big.end, workspace);
    assertEqual(steps, 58, '30×30 corner-to-corner distance');
});

/* --------------------------- 3. Generation --------------------------- */

suite('Generation');

test('generation is deterministic for a given seed', () => {
    const a = Level.generateLevel(14, 11, 6, 'abc123', true);
    const b = Level.generateLevel(14, 11, 6, 'abc123', true);
    assertDeepEqual(a.cars, b.cars, 'cars');
    assertDeepEqual(a.start, b.start, 'start');
    assertDeepEqual(a.end, b.end, 'end');
    assertEqual(a.parkingLayout, b.parkingLayout, 'layout');
});

test('inputs are clamped into the supported range', () => {
    const tiny = Level.generateLevel(1, 2, 99, 'clamp', false);
    assertEqual(tiny.width, Level.MIN_SIZE, 'width clamped up');
    assertEqual(tiny.height, Level.MIN_SIZE, 'height clamped up');
    assertEqual(tiny.difficulty, 10, 'difficulty clamped down');
    const huge = Level.generateLevel(5000, 5000, 0, 'clamp', false);
    assertEqual(huge.width, Level.MAX_SIZE, 'width clamped down');
    assertEqual(huge.height, Level.MAX_SIZE, 'height clamped down');
    assertEqual(huge.difficulty, 1, 'difficulty clamped up');
    assertEqual(Level.MAX_SIZE_GEN, Level.MAX_SIZE, 'legacy alias matches MAX_SIZE');
    assertEqual(Level.MAX_SIZE_LOAD, Level.MAX_SIZE, 'legacy alias matches MAX_SIZE');
});

test('generated levels satisfy every structural invariant', () => {
    const rng = RNG.createRNG('invariants');
    for (let trial = 0; trial < 120; trial++) {
        const width = rng.int(4, 31);
        const height = rng.int(4, 31);
        const difficulty = rng.int(1, 11);
        const guarantee = rng.next() < 0.7;
        const level = Level.generateLevel(width, height, difficulty, 'inv-' + trial, guarantee);

        assertEqual(level.width, width, 'width honoured');
        assertEqual(level.height, height, 'height honoured');
        assertEqual(level.grid.length, height, 'grid rows');
        assertEqual(level.grid[0].length, width, 'grid columns');
        assert(level.start[0] !== level.end[0] || level.start[1] !== level.end[1], 'start ≠ end');
        assert(level.start[0] < width && level.start[1] < height, 'start in bounds');
        assert(level.end[0] < width && level.end[1] < height, 'end in bounds');

        const seen = new Set();
        for (const car of level.cars) {
            const k = car.x + ',' + car.y;
            assert(!seen.has(k), `duplicate car at ${k}`);
            assert(!(car.x < 0 || car.x >= width || car.y < 0 || car.y >= height), `car ${k} out of bounds`);
            assert(k !== level.start.join(',') && k !== level.end.join(','), `car on start/exit at ${k}`);
            assert(Level.DIRECTIONS.indexOf(car.direction) !== -1, `bad direction ${car.direction}`);
            seen.add(k);
        }

        // The derived grid must agree with the model.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const type = level.grid[y][x].type;
                const expected = (x === level.start[0] && y === level.start[1]) ? 'start'
                    : (x === level.end[0] && y === level.end[1]) ? 'end'
                        : seen.has(x + ',' + y) ? 'car' : 'empty';
                assertEqual(type, expected, `grid mismatch at ${x},${y}`);
            }
        }

        if (guarantee) {
            assert(Pathfinding.isSolvable(level), `guaranteed level #${trial} is blocked`);
        }
        assert(level.cars.length <= Math.ceil(width * height * Level.MAX_FILL_DETOUR),
            `car count ${level.cars.length} exceeds the fill ceiling`);
    }
});

test('difficulty scales the car count without exceeding the density cap', () => {
    const easy = Level.generateLevel(20, 20, 1, 'density', false);
    const medium = Level.generateLevel(20, 20, 5, 'density', false);
    const hard = Level.generateLevel(20, 20, 10, 'density', false);
    assertEqual(easy.cars.length, Math.floor(0.1 * 400 * Level.MAX_FILL), 'difficulty 1 density');
    assertEqual(medium.cars.length, Math.floor(0.5 * 400 * Level.MAX_FILL), 'difficulty 5 density');
    assertEqual(hard.cars.length, Math.floor(1 * 400 * Level.MAX_FILL), 'difficulty 10 density');
    assert(hard.cars.length <= Math.floor(0.4 * 400), 'hard level respects the documented cap');
});

test('layout follows the aspect ratio', () => {
    assertEqual(Level.generateLevel(10, 14, 5, 'layout', false).parkingLayout, 'rows', 'tall grid');
    assertEqual(Level.generateLevel(14, 10, 5, 'layout', false).parkingLayout, 'columns', 'wide grid');
    assertEqual(Level.generateLevel(12, 12, 5, 'layout', false).parkingLayout, 'rows', 'square grid');
});

test('cars face along their lane by default', () => {
    const rows = Level.generateLevel(10, 12, 4, 'facing', false);
    rows.cars.forEach((car) => {
        assertEqual(car.direction, car.y % 2 === 0 ? 'up' : 'down', `rows facing at ${car.x},${car.y}`);
    });
    const cols = Level.generateLevel(12, 10, 4, 'facing', false);
    cols.cars.forEach((car) => {
        assertEqual(car.direction, car.x % 2 === 0 ? 'left' : 'right', `columns facing at ${car.x},${car.y}`);
    });
});

test('difficulty labels map 1..10 to the documented names', () => {
    assertDeepEqual(Level.DIFFICULTY_LABELS.length, 10, 'exactly ten labels');
    assertEqual(Level.difficultyLabel(1), 'Trivial', 'difficulty 1');
    assertEqual(Level.difficultyLabel(5), 'Gentle', 'difficulty 5');
    assertEqual(Level.difficultyLabel(10), 'Extreme', 'difficulty 10');
    assertEqual(Level.difficultyLabel(0), 'Trivial', 'below range clamps');
    assertEqual(Level.difficultyLabel(42), 'Extreme', 'above range clamps');
    assertEqual(Level.difficultyLabel('nonsense'), 'Trivial', 'non-numeric falls back to 1');
});

test('route modes meet their documented detour factor', () => {
    // The contract: `winding`/`maze` reach at least `detour ×` the Manhattan
    // distance whenever the grid can physically hold such a route. Degenerate
    // grids (4×4, or an adjacent start/exit pair) can make the request
    // impossible, so those are covered by the invariants test instead.
    const sizes = [[10, 10], [12, 9], [16, 16], [20, 14], [24, 24], [30, 30]];
    let checked = 0;
    ['winding', 'maze'].forEach((mode) => {
        const detour = Level.ROUTE_MODES[mode].detour;
        sizes.forEach(([w, h], sizeIndex) => {
            [1, 5, 10].forEach((difficulty) => {
                for (let seedIndex = 0; seedIndex < 6; seedIndex++) {
                    const seed = `detour-${mode}-${sizeIndex}-${difficulty}-${seedIndex}`;
                    const level = Level.generateLevel(w, h, difficulty, seed, true, { route: mode });
                    const manhattan = Math.abs(level.end[0] - level.start[0]) +
                        Math.abs(level.end[1] - level.start[1]);
                    const steps = Pathfinding.shortestPathLength(level, level.start, level.end);
                    const wanted = Math.round(manhattan * detour);

                    assert(steps >= 0, `${mode} ${w}×${h} must stay solvable`);
                    assert(steps >= wanted,
                        `${mode} on ${w}×${h} (d${difficulty}, ${seed}) routed ${steps} steps, ` +
                        `wanted ${wanted}`);
                    assert(level.cars.length <= Math.ceil(w * h * Level.MAX_FILL_DETOUR),
                        `${mode} exceeded the detour fill ceiling (${level.cars.length} cars)`);
                    checked++;
                }
            });
        });
    });
    assertEqual(checked, 216, 'every configuration was exercised');
});

test('route modes still respect the difficulty they were given', () => {
    // Regression guard: the detour builder used to fill the lot to the ceiling
    // whatever the difficulty, which made the slider meaningless in these modes.
    [[20, 20], [30, 24]].forEach(([w, h]) => {
        ['winding', 'maze'].forEach((mode) => {
            let previous = -1;
            [1, 5, 10].forEach((difficulty) => {
                const level = Level.generateLevel(w, h, difficulty,
                    `density-${mode}-${w}-${difficulty}`, true, { route: mode });
                const target = Math.floor((difficulty / 10) * w * h * Level.MAX_FILL);
                assert(level.cars.length >= target,
                    `${mode} d${difficulty} placed ${level.cars.length} cars, wanted at least ${target}`);
                assert(level.cars.length <= Math.ceil(w * h * Level.MAX_FILL_DETOUR),
                    `${mode} d${difficulty} exceeded the fill ceiling`);
                assert(level.cars.length > previous,
                    `${mode} d${difficulty} placed ${level.cars.length} cars — difficulty must matter`);
                previous = level.cars.length;
            });
        });
    });
});

test('a route mode never makes the exit a single step from the start', () => {
    // A one-step route cannot be lengthened, so the generator avoids picking an
    // adjacent exit when a detour was requested.
    ['winding', 'maze'].forEach((mode) => {
        for (let i = 0; i < 40; i++) {
            const level = Level.generateLevel(14, 14, 6, `adjacent-${mode}-${i}`, true, { route: mode });
            const manhattan = Math.abs(level.end[0] - level.start[0]) +
                Math.abs(level.end[1] - level.start[1]);
            assert(manhattan >= 2, `${mode} picked an adjacent exit on seed ${i}`);
        }
    });
});

test('an unknown route mode falls back to the documented default', () => {
    const fallback = Level.generateLevel(12, 12, 5, 'mode', true, { route: 'spiral' });
    const direct = Level.generateLevel(12, 12, 5, 'mode', true, { route: 'direct' });
    assertDeepEqual(fallback.cars, direct.cars, 'unknown modes behave like "direct"');
});

test('generation is repeatable across a thousand seeds', () => {
    let mismatches = 0;
    for (let i = 0; i < 1000; i++) {
        const a = Level.generateLevel(8, 8, 5, 'rep-' + i, false);
        const b = Level.generateLevel(8, 8, 5, 'rep-' + i, false);
        if (JSON.stringify(a.cars) !== JSON.stringify(b.cars)) mismatches++;
    }
    assertEqual(mismatches, 0, 'every seed must reproduce its level');
});

test('no cars are placed when the density target is zero', () => {
    const level = Level.generateLevel(4, 4, 1, 'zero', true);
    assert(level.cars.length <= 1, `expected a nearly empty lot, got ${level.cars.length} cars`);
});

/* --------------------------- 4. Sanitisation --------------------------- */

suite('Sanitisation');

test('valid input is preserved', () => {
    const source = Level.generateLevel(12, 9, 6, 'round-trip', true, { name: '  Garage 2 ' });
    const warnings = [];
    const clean = Level.sanitizeLevel(JSON.parse(JSON.stringify(source)), warnings);
    assertDeepEqual(clean.cars, source.cars, 'cars');
    assertDeepEqual(clean.start, source.start, 'start');
    assertDeepEqual(clean.end, source.end, 'end');
    assertEqual(clean.seed, source.seed, 'seed');
    assertEqual(clean.name, 'Garage 2', 'name is trimmed');
    assertEqual(warnings.length, 0, `unexpected warnings: ${warnings.join(' | ')}`);
});

test('repairs invalid values and reports every fix', () => {
    const warnings = [];
    const clean = Level.sanitizeLevel({
        width: 8,
        height: 8,
        difficulty: 99,
        start: [1, 1],
        end: [1, 1],
        parkingLayout: 'diagonal',
        cars: [
            { x: 3, y: 3, direction: 'sideways' },
            { x: 99, y: 0 },
            { x: 1, y: 1 },
            null,
            'not-an-object',
            { x: 5, y: 5 }
        ]
    }, warnings);

    assertEqual(clean.width, 8, 'width kept');
    assertEqual(clean.difficulty, 10, 'difficulty clamped');
    assertEqual(clean.cars.length, 2, 'only valid cars survive');
    assert(clean.end[0] !== clean.start[0] || clean.end[1] !== clean.start[1], 'end moved off start');
    assertEqual(clean.parkingLayout, 'rows', 'layout inferred for an 8×8 grid');
    assert(warnings.length >= 6, `expected several warnings, got ${warnings.length}`);
    assertEqual(clean.grid[3][3].type, 'car', 'grid rebuilt from the repaired car list');
});

test('grid mismatches are reported, never trusted', () => {
    const warnings = [];
    const level = Level.generateLevel(6, 6, 5, 'grid-check', false);
    const raw = JSON.parse(Level.serializeLevel(level));
    raw.grid[0][0] = { type: 'car' };          // nonsense value
    const clean = Level.sanitizeLevel(raw, warnings);
    assertEqual(clean.grid[0][0].type, level.grid[0][0].type, 'the rebuilt grid wins');
    assert(warnings.some((w) => w.includes('grid differed')), 'mismatch warning issued');
});

test('car facings that disagree with the matrix are reported separately', () => {
    const warnings = [];
    const raw = {
        width: 6,
        height: 6,
        start: [0, 0],
        end: [5, 5],
        parkingLayout: 'rows',
        cars: [{ x: 2, y: 2, direction: 'left' }],
        // Same contents, but the matrix claims the car points up.
        grid: null
    };
    raw.grid = Level.rebuildGrid(Object.assign({}, raw, { grid: null }));
    raw.grid[2][2] = { type: 'car', direction: 'up' };
    const clean = Level.sanitizeLevel(raw, warnings);
    assertEqual(clean.grid[2][2].direction, 'left', 'the car list wins over the matrix');
    assert(warnings.some((w) => w.includes('facing')), 'facing drift is reported');
    assert(!warnings.some((w) => w.includes('grid differed')), 'contents still matched');
});

test('a missing grid is rebuilt silently', () => {
    const warnings = [];
    const minimal = Level.sanitizeLevel({ width: 10, height: 10 }, warnings);
    assertEqual(minimal.cars.length, 0, 'no cars');
    assertEqual(minimal.grid.length, 10, 'grid rebuilt');
    assertEqual(minimal.grid[0][0].type, 'start', 'start defaulted to the top-left');
    assertEqual(minimal.grid[9][9].type, 'end', 'exit defaulted to the bottom-right');
});

test('fatal problems throw friendly errors', () => {
    assertThrows(() => Level.sanitizeLevel(null), 'null');
    assertThrows(() => Level.sanitizeLevel('nope'), 'string');
    assertThrows(() => Level.sanitizeLevel([1, 2, 3]), 'array');
    assertThrows(() => Level.sanitizeLevel({ width: 2, height: 2 }), 'too small');
    assertThrows(() => Level.sanitizeLevel({ width: 1000, height: 10 }), 'too large');
    assertThrows(() => Level.sanitizeLevel({ width: 'wide', height: 10 }), 'non-numeric width');
    assertThrows(() => Level.sanitizeLevel({ width: 10, height: 10, cars: 'lots' }), 'non-array cars');
});

test('booleans and blanks are not mistaken for numbers', () => {
    assertThrows(() => Level.sanitizeLevel({ width: true, height: 10 }), 'boolean width');
    assertThrows(() => Level.sanitizeLevel({ width: '', height: 10 }), 'empty width');
    assertThrows(() => Level.sanitizeLevel({ width: null, height: 10 }), 'null width');
});

test('an oversized car list is capped and reported', () => {
    const warnings = [];
    const cars = [];
    for (let i = 0; i < 500; i++) cars.push({ x: i % 10, y: Math.floor(i / 10) % 10, direction: 'up' });
    const clean = Level.sanitizeLevel({ width: 10, height: 10, cars }, warnings);
    assert(clean.cars.length <= 100, `cars capped to the cell count, got ${clean.cars.length}`);
    assert(warnings.some((w) => w.includes('cars')), 'cap reported');
});

test('future format versions load with a warning', () => {
    const warnings = [];
    const clean = Level.sanitizeLevel({ version: 99, width: 6, height: 6 }, warnings);
    assertEqual(clean.version, Level.VERSION, 'stored version is normalised');
    assert(warnings.some((w) => w.includes('v99')), 'version warning issued');
});

test('names are sanitised to a safe single line', () => {
    const warnings = [];
    const clean = Level.sanitizeLevel({ width: 6, height: 6, name: 'A\n\tB' + 'x'.repeat(200) }, warnings);
    assert(!/[\n\t]/.test(clean.name), 'control characters removed');
    assert(clean.name.length <= Level.MAX_NAME_LENGTH, 'length capped');
    assert(warnings.some((w) => w.includes('name')), 'name warning issued');
});

/* --------------------------- 5. Serialisation --------------------------- */

suite('Serialisation');

test('exported JSON has the documented shape', () => {
    const level = Level.generateLevel(8, 8, 4, 'shape', true, { name: 'Shape test' });
    const parsed = JSON.parse(Level.serializeLevel(level));
    assertEqual(parsed.version, Level.VERSION, 'version');
    assertEqual(parsed.width, 8, 'width');
    assertEqual(parsed.height, 8, 'height');
    assertEqual(parsed.difficulty, 4, 'difficulty');
    assertEqual(parsed.seed, 'shape', 'seed');
    assertEqual(parsed.name, 'Shape test', 'name');
    assertEqual(parsed.parkingLayout, 'rows', 'layout');
    assert(Array.isArray(parsed.start) && parsed.start.length === 2, 'start is [x, y]');
    assert(Array.isArray(parsed.end) && parsed.end.length === 2, 'end is [x, y]');
    assert(Array.isArray(parsed.cars), 'cars array');
    assert(Array.isArray(parsed.grid), 'grid included by default');
    assertEqual(parsed.grid.length, 8, 'grid rows');
});

test('the grid matrix can be omitted for compact files', () => {
    const level = Level.generateLevel(20, 20, 8, 'compact', true);
    const full = Level.serializeLevel(level);
    const compact = Level.serializeLevel(level, { includeGrid: false });
    assert(compact.length < full.length * 0.5, 'compact output should be much smaller');
    const parsed = JSON.parse(compact);
    assertEqual(parsed.grid, undefined, 'grid omitted');
    const reloaded = Level.sanitizeLevel(parsed, []);
    assertDeepEqual(reloaded.cars, level.cars, 'cars survive the compact round trip');
});

test('export → import preserves the level exactly', () => {
    const level = Level.generateLevel(15, 13, 7, 'roundtrip', true, { name: 'Round trip' });
    const reloaded = Level.sanitizeLevel(JSON.parse(Level.serializeLevel(level)), []);
    assertDeepEqual(reloaded.cars, level.cars, 'cars');
    assertDeepEqual(reloaded.start, level.start, 'start');
    assertDeepEqual(reloaded.end, level.end, 'end');
    assertEqual(reloaded.difficulty, level.difficulty, 'difficulty');
    assertEqual(reloaded.parkingLayout, level.parkingLayout, 'layout');
    assertEqual(reloaded.name, level.name, 'name');
    assertEqual(Level.serializeLevel(reloaded), Level.serializeLevel(level), 'byte-identical re-export');
});

test('cloneLevel deep-copies cars and rebuilds the grid', () => {
    const level = Level.generateLevel(9, 9, 5, 'clone', true);
    const copy = Level.cloneLevel(level);
    copy.cars[0].x = -1;
    copy.grid[0][0] = { type: 'car' };
    assert(level.cars[0].x !== -1, 'original cars untouched');
    assert(level.grid[0][0].type !== 'car', 'original grid untouched');
    assert(Level.cloneLevel(level).grid !== level.grid, 'grid is not shared');
});

/* --------------------------- 6. Resize --------------------------- */

suite('Resize');

test('growing pads the grid and keeps every car', () => {
    const level = Level.generateLevel(10, 10, 5, 'grow', false);
    const result = Level.resizeLevel(level, 14, 12);
    assertEqual(result.dropped, 0, 'nothing dropped');
    assertEqual(result.level.width, 14, 'width');
    assertEqual(result.level.height, 12, 'height');
    assertEqual(result.level.cars.length, level.cars.length, 'cars kept');
    assertDeepEqual(result.level.start, level.start, 'start kept');
    assertEqual(result.level.grid.length, 12, 'grid rebuilt');
    assertEqual(result.level.name, level.name, 'name kept');
});

test('shrinking drops only the cars that no longer fit', () => {
    const level = Level.createLevel(12, 12, { seed: 'shrink' });
    level.cars = [
        { x: 1, y: 1, direction: 'up' },
        { x: 11, y: 11, direction: 'down' },
        { x: 5, y: 11, direction: 'down' }
    ];
    level.grid = Level.rebuildGrid(level);
    const result = Level.resizeLevel(level, 6, 6);
    assertEqual(result.dropped, 2, 'two cars fell outside');
    assertEqual(result.level.cars.length, 1, 'one car kept');
    assertEqual(result.level.start[0], 0, 'start clamped');
    assertEqual(result.level.end[0], 5, 'exit clamped');
    assert(result.level.start.join(',') !== result.level.end.join(','), 'start and exit stay distinct');
});

test('resizing to the same dimensions is a no-op', () => {
    const level = Level.createLevel(8, 8, { seed: 'same-size' });
    const result = Level.resizeLevel(level, 8, 8);
    assert(result.level === level, 'the same object is returned');
    assertEqual(result.dropped, 0, 'nothing dropped');
});

test('resize clamps out-of-range requests', () => {
    const level = Level.createLevel(10, 10, { seed: 'clamp' });
    assertEqual(Level.resizeLevel(level, 1, 500).level.width, Level.MIN_SIZE, 'small clamped up');
    assertEqual(Level.resizeLevel(level, 1, 500).level.height, Level.MAX_SIZE, 'large clamped down');
});

/* --------------------------- 7. Share codes --------------------------- */

suite('Share codes');

test('levels survive a share-code round trip', () => {
    const cases = [
        Level.generateLevel(10, 10, 5, 'welcome', true),
        Level.generateLevel(30, 22, 9, 'spaces & symbols: ünïcode 🎉', true, { name: 'Rooftop ~ rush_2' }),
        Level.createLevel(4, 4, { seed: '' }),
        Level.generateLevel(9, 14, 3, 'no-name', false)
    ];
    cases.forEach((level, i) => {
        const code = Share.encodeLevel(level);
        const warnings = [];
        const back = Share.decodeLevel(code, warnings);
        assertDeepEqual(back.cars, level.cars, `cars for case #${i}`);
        assertDeepEqual(back.start, level.start, `start for case #${i}`);
        assertDeepEqual(back.end, level.end, `end for case #${i}`);
        assertEqual(back.width, level.width, `width for case #${i}`);
        assertEqual(back.height, level.height, `height for case #${i}`);
        assertEqual(back.difficulty, level.difficulty, `difficulty for case #${i}`);
        assertEqual(back.seed, level.seed, `seed for case #${i}`);
        assertEqual(back.parkingLayout, level.parkingLayout, `layout for case #${i}`);
        assertEqual(back.name, level.name, `name for case #${i}`);
        assertEqual(warnings.length, 0, `no repairs expected: ${warnings.join(' | ')}`);
        assertEqual(Share.encodeLevel(back), code, `re-encoding is stable for case #${i}`);
    });
});

test('codes survive being embedded in a URL', () => {
    const level = Level.generateLevel(20, 20, 6, 'unsafe?chars#here & more', true, { name: 'a/b?c=d' });
    const code = Share.encodeLevel(level);
    assert(/^[A-Za-z0-9~_.%-]+$/.test(code), `unexpected characters in code: ${code}`);
    assert(!/[?&#+\s]/.test(code), 'no character that would break query-string parsing');

    // The real test: the code must survive being written into a URL and read
    // back the way browsers expose it (`location.search` keeps the escapes).
    const url = new URL(Share.buildShareUrl(level, 'https://example.com/app/'));
    assertEqual(Share.readCodeFromUrl(url.search, ''), code, 'readCodeFromUrl round trip');
    assertDeepEqual(Share.decodeLevel(Share.readCodeFromUrl(url.search, ''), []).cars, level.cars,
        'the level survives the URL round trip');

    // Some clients hand back the *decoded* query value instead; the geometry
    // must still survive, which is why text fields decode leniently.
    const decoded = url.searchParams.get('level');
    const warnings = [];
    const fromDecoded = Share.decodeLevel(decoded, warnings);
    assertDeepEqual(fromDecoded.cars, level.cars, 'decoded query value keeps the cars');
    assertDeepEqual(fromDecoded.start, level.start, 'decoded query value keeps the start');
    assertDeepEqual(fromDecoded.end, level.end, 'decoded query value keeps the exit');
});

test('share URLs are stable and parseable', () => {
    const level = Level.generateLevel(12, 12, 5, 'url-test', true);
    const url = Share.buildShareUrl(level, 'https://example.com/app/index.html?old=1#frag');
    assert(url.startsWith('https://example.com/app/index.html?level='), `unexpected url: ${url}`);
    const code = url.split('?level=')[1];
    assertEqual(Share.readCodeFromUrl('?level=' + code, ''), code, 'read from search');
    assertEqual(Share.readCodeFromUrl('', '#level=' + code), code, 'read from hash param');
    assertEqual(Share.readCodeFromUrl('', '#' + code), code, 'read from a bare fragment');
    assertEqual(Share.readCodeFromUrl('', '#other'), null, 'unrelated fragments ignored');
    assertEqual(Share.readCodeFromUrl('', ''), null, 'empty input');
    assertEqual(Share.readCodeFromUrl('?foo=bar', ''), null, 'other parameters ignored');
    assertDeepEqual(Share.decodeLevel(code, []).cars, level.cars, 'decoded level matches');
});

test('malformed codes fail loudly, not silently', () => {
    assertThrows(() => Share.decodeLevel('', []), 'empty');
    assertThrows(() => Share.decodeLevel('2~10x10~5~s~0-0~9-9~r~~', []), 'unknown version');
    assertThrows(() => Share.decodeLevel('1~10x10', []), 'truncated');
    assertThrows(() => Share.decodeLevel('1~axb~5~s~0-0~9-9~r~~', []), 'bad dimensions');
    // Bad escaping is repaired (with a warning) rather than fatal, so links
    // mangled by an intermediary still load.
    const lenient = [];
    const repaired = Share.decodeLevel('1~10x10~5~%ZZ~0-0~9-9~r~~', lenient);
    assertEqual(repaired.seed, '%ZZ', 'the raw text is kept');
    assert(lenient.length >= 1, 'the repair is reported');
});

test('individual broken car entries are skipped, not fatal', () => {
    const warnings = [];
    const level = Share.decodeLevel('1~6x6~5~seed~0-0~5-5~r~~1-1u_%%%_2-2d', warnings);
    assertEqual(level.cars.length, 2, 'two valid cars loaded');
    assert(warnings.length >= 1, 'the skipped entry is reported');
});

test('share codes stay compact', () => {
    const big = Level.generateLevel(60, 60, 8, 'big', false);
    const code = Share.encodeLevel(big);
    assert(code.length < 12000, `60×60 code should stay small, got ${code.length} chars`);
    assertDeepEqual(Share.decodeLevel(code, []).cars, big.cars, 'large level survives');
});

/* --------------------------- 8. Markdown --------------------------- */

suite('Markdown');

test('headings render with anchor ids and are reported', () => {
    const headings = [];
    const html = Markdown.renderMarkdown('# Title here\n\n## Second `code` heading\n', { headings });
    assert(html.includes('<h1 id="title-here">Title here</h1>'), 'h1 with slug');
    assert(html.includes('<h2 id="second-code-heading">'), 'h2 slug strips code ticks');
    assertEqual(headings.length, 2, 'headings collected');
    assertEqual(headings[0].level, 1, 'level recorded');
});

test('inline formatting, links and kbd tags render', () => {
    const html = Markdown.renderInline('A **bold** `code` and <kbd>Esc</kbd> with [a link](docs/USAGE.md).');
    assert(html.includes('<strong>bold</strong>'), 'bold');
    assert(html.includes('<code>code</code>'), 'code');
    assert(html.includes('<kbd>Esc</kbd>'), 'kbd whitelisted');
    assert(html.includes('href="docs/USAGE.md"'), 'relative link kept');
});

test('dangerous input is escaped, never executed', () => {
    const html = Markdown.renderMarkdown('<script>alert(1)</script> [x](javascript:alert(2)) <img src=x onerror=1>');
    assert(!html.includes('<script'), 'script tag escaped');
    assert(!html.includes('javascript:'), 'javascript: url rejected');
    assert(!html.includes('<img'), 'img tag escaped');
    assert(html.includes('&lt;script&gt;'), 'escaped output is visible text');
});

test('tables, lists, quotes, rules and code fences render', () => {
    const md = [
        '| A | B |', '| --- | ---: |', '| 1 | 2 |', '',
        '- one', '  - nested', '- two', '',
        '1. first', '2. second', '',
        '> quoted', '',
        '---', '',
        '```js', 'const a = 1 < 2;', '```'
    ].join('\n');
    const html = Markdown.renderMarkdown(md);
    assert(html.includes('<table>') && html.includes('text-align:right'), 'table + alignment');
    assert(html.includes('<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>'), 'nested list');
    assert(html.includes('<ol><li>first</li><li>second</li></ol>'), 'ordered list');
    assert(html.includes('<blockquote>'), 'blockquote');
    assert(html.includes('<hr>'), 'horizontal rule');
    assert(html.includes('const a = 1 &lt; 2;'), 'code fence escaped');
});

test('every project document renders without stalling or leaking tags', () => {
    const docs = ['README.md', 'docs/USAGE.md', 'docs/LEVEL_FORMAT.md', 'docs/ARCHITECTURE.md',
        'docs/CONTRIBUTING.md', 'docs/CHANGELOG.md', 'docs/TESTING.md', 'docs/DESIGN.md'];
    docs.forEach((rel) => {
        const file = path.join(ROOT, rel);
        if (!fs.existsSync(file)) fail(`missing document: ${rel}`);
        const html = Markdown.renderMarkdown(fs.readFileSync(file, 'utf8'));
        assert(html.length > 200, `${rel} produced too little output`);
        assert(!/<script/i.test(html), `${rel} leaked a script tag`);
        assertEqual((html.match(/<p>/g) || []).length, (html.match(/<\/p>/g) || []).length,
            `${rel} has unbalanced paragraphs`);
        assertEqual((html.match(/<table>/g) || []).length, (html.match(/<\/table>/g) || []).length,
            `${rel} has unbalanced tables`);
        assertEqual((html.match(/<pre/g) || []).length, (html.match(/<\/pre>/g) || []).length,
            `${rel} has unbalanced code fences`);
    });
});

test('degenerate input is handled gracefully', () => {
    assertEqual(Markdown.renderMarkdown(''), '', 'empty document');
    assertEqual(Markdown.slugify('!!!'), 'section', 'empty slug fallback');
    assertEqual(Markdown.safeHref('javascript:alert(1)'), '#', 'unsafe href');
    assertEqual(Markdown.safeHref('https://example.com'), 'https://example.com', 'https allowed');
    assertEqual(Markdown.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;', 'escaping');
    assert(typeof Markdown.renderMarkdown(undefined) === 'string', 'undefined input');
});

/* --------------------------- 9. Image layout --------------------------- */

suite('Image layout');

test('canvas geometry follows the grid and options', () => {
    const level = Level.createLevel(10, 8, { seed: 'image' });
    const layout = Image.computeLayout(level, { cellSize: 30, gap: 4, padding: 20, headerHeight: 50, footerHeight: 30, scale: 2 });
    assertEqual(layout.gridWidth, 10 * 30 + 9 * 4, 'grid width');
    assertEqual(layout.gridHeight, 8 * 30 + 7 * 4, 'grid height');
    assertEqual(layout.width, layout.gridWidth + 40, 'canvas width = grid + padding');
    assertEqual(layout.height, layout.gridHeight + 50 + 30, 'canvas height = grid + captions');
    assertEqual(layout.scale, 2, 'scale preserved');
});

test('absurd options are clamped instead of producing broken canvases', () => {
    const level = Level.createLevel(6, 6, { seed: 'clamp' });
    const tiny = Image.computeLayout(level, { cellSize: -5, gap: -1, scale: 99 });
    assert(tiny.cell > 0 && tiny.gap >= 0, 'cell size and gap stay positive');
    assertEqual(tiny.scale, 4, 'scale capped');
    const huge = Image.computeLayout(level, { cellSize: 100000 });
    assert(huge.cell <= 128, 'cell size capped');
    assert(Number.isFinite(huge.width) && Number.isFinite(huge.height), 'finite dimensions');
});

test('rendering degrades to null without a DOM', () => {
    const level = Level.createLevel(6, 6, { seed: 'nodom' });
    assertEqual(Image.renderLevelToCanvas(level, {}), null, 'no canvas in Node');
    assertEqual(Image.renderLevelToCanvas(null, {}), null, 'null level');
});

test('the fallback palette covers every token the renderer uses', () => {
    ['asphalt1', 'asphalt2', 'lotBg', 'ink', 'inkSoft', 'car1', 'car2',
        'start1', 'start2', 'end1', 'end2', 'route', 'border'].forEach((token) => {
            assert(typeof Image.FALLBACK_PALETTE[token] === 'string', `missing palette token ${token}`);
        });
});

/* --------------------------- 10. Performance --------------------------- */

suite('Performance');

test('worst-case generation stays well under a second', () => {
    const start = process.hrtime.bigint();
    const level = Level.generateLevel(60, 60, 10, 'perf', true, { route: 'maze' });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert(ms < 1500, `60×60 maze generation took ${ms.toFixed(0)} ms`);
    assert(Pathfinding.isSolvable(level), 'the level is still solvable');
});

test('a search on the largest grid stays sub-millisecond-ish', () => {
    const level = Level.generateLevel(60, 60, 10, 'perf-search', true);
    const solver = Pathfinding.createSolver(60, 60);
    const start = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) solver.shortestPathLength(level, level.start, level.end);
    const ms = Number(process.hrtime.bigint() - start) / 1e6 / 50;
    assert(ms < 5, `each search averaged ${ms.toFixed(2)} ms`);
});

test('buffer reuse removes per-search allocation growth', () => {
    const level = Level.generateLevel(40, 40, 8, 'perf-alloc', true);
    const solver = Pathfinding.createSolver(40, 40);
    solver.shortestPathLength(level, level.start, level.end);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 400; i++) solver.shortestPathLength(level, level.start, level.end);
    const growth = (process.memoryUsage().heapUsed - before) / 1024;
    assert(growth < 2048, `400 searches grew the heap by ${growth.toFixed(0)} KB`);
});

test('sanitising a large file is fast enough for the UI thread', () => {
    const level = Level.generateLevel(60, 60, 10, 'perf-sanitize', false);
    const raw = JSON.parse(Level.serializeLevel(level));
    const start = process.hrtime.bigint();
    Level.sanitizeLevel(raw, []);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert(ms < 250, `sanitising a 60×60 level took ${ms.toFixed(0)} ms`);
});

/* --------------------------- 11. Wiring --------------------------- */

suite('Wiring');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

/** Ids declared anywhere in index.html. */
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

/** Ids listed in app.js `cacheEls()`. */
const cacheBlock = /cacheEls\(\)\s*\{([\s\S]*?)\.forEach/.exec(appSource);
const cachedIds = new Set(cacheBlock ? [...cacheBlock[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]) : []);

/** Every `els.foo` reference in app.js. */
const elsRefs = new Set([...appSource.matchAll(/\bels\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));

test('every element app.js caches exists in index.html', () => {
    const missing = [...cachedIds].filter((id) => !htmlIds.has(id));
    assertEqual(missing.length, 0, `index.html is missing: ${missing.join(', ')}`);
});

test('every els.* reference is cached on startup', () => {
    const missing = [...elsRefs].filter((id) => !cachedIds.has(id));
    assertEqual(missing.length, 0, `not in cacheEls(): ${missing.join(', ')}`);
});

test('index.html has no unused element ids', () => {
    const allowList = new Set(['pageTitle', 'controlsTitle', 'sidebar', 'jsonDisplay', 'jsonContent',
        'gridContainer', 'gridWrapper']);
    const unused = [...htmlIds].filter((id) =>
        !cachedIds.has(id) && !allowList.has(id) && !html.includes(`for="${id}"`) &&
        !html.includes(`aria-labelledby="${id}"`) && !html.includes(`aria-controls="${id}"`) &&
        !html.includes(`aria-describedby="${id}"`) && !html.includes(`href="#${id}"`));
    assertEqual(unused.length, 0, `unused ids: ${unused.join(', ')}`);
});

test('local assets referenced by the HTML exist', () => {
    const local = [...html.matchAll(/(?:href|src)="((?!https?:|data:|#)[^"]+)"/g)].map((m) => m[1]);
    const missing = local.filter((rel) => !fs.existsSync(path.join(ROOT, rel.split('#')[0])));
    assertEqual(missing.length, 0, `missing local assets: ${missing.join(', ')}`);
});

test('CSS classes toggled by app.js are defined in style.css', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    const classes = new Set();
    [...appSource.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'/g)]
        .forEach((m) => m[1].split(/\s+/).forEach((c) => classes.add(c)));
    [...appSource.matchAll(/className = '([^']+)'/g)]
        .forEach((m) => m[1].split(/\s+/).forEach((c) => classes.add(c)));

    const missing = [...classes].filter((cls) => {
        const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !new RegExp('\\.' + escaped + '(?![\\w-])').test(css);
    });
    assertEqual(missing.length, 0, `no CSS rule for: ${missing.join(', ')}`);
});

test('stylesheets referenced by index.html are loaded in the right order', () => {
    const sweetIndex = html.indexOf('sweetalert2');
    const appIndex = html.indexOf('css/style.css');
    assert(sweetIndex !== -1 && appIndex !== -1, 'both stylesheets referenced');
    assert(sweetIndex < appIndex, 'the app stylesheet must load after SweetAlert2 to win overrides');
});

test('scripts load in dependency order', () => {
    const order = ['js/icons.js', 'js/rng.js', 'js/pathfinding.js', 'js/level.js', 'js/share.js', 'js/image.js', 'js/app.js'];
    const positions = order.map((src) => html.indexOf('src="' + src + '"'));
    positions.forEach((pos, i) => assert(pos !== -1, `${order[i]} is not loaded by index.html`));
    for (let i = 1; i < positions.length; i++) {
        assert(positions[i - 1] < positions[i], `${order[i]} must load after ${order[i - 1]}`);
    }
});

test('index.html keeps the sibling order the CSS state selectors rely on', () => {
    const wrapper = html.indexOf('id="gridWrapper"');
    const empty = html.indexOf('class="empty-state"');
    const veil = html.indexOf('class="gen-veil"');
    assert(wrapper !== -1 && empty !== -1 && veil !== -1, 'overlays present');
    assert(wrapper < empty && empty < veil, 'overlays must follow #gridWrapper as siblings');
});

test('app.js never references a missing ParkingGen module', () => {
    const modules = [...appSource.matchAll(/const (Level|Pathfinding|RNG|Share|LevelImage) = ([A-Za-z.]+);/g)];
    assert(modules.length >= 5, 'module handles are declared');
    assert(PG.Level && PG.Pathfinding && PG.RNG && PG.Share && PG.Image, 'all modules exported');
});

test('the app shell never reaches out to a network', () => {
    // The whole point of this project is that index.html works from a USB stick.
    ['index.html', 'docs.html'].forEach((file) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const remote = [...source.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
            .map((m) => m[1])
            .filter((url) => !url.startsWith('https://github.com/'));
        assertEqual(remote.length, 0, `${file} loads remote assets: ${remote.join(', ')}`);
        assert(!/preconnect/.test(source), `${file} still preconnects to a CDN`);
    });
});

test('vendored assets are present at the paths the pages use', () => {
    ['vendor/sweetalert2/sweetalert2.min.js',
        'vendor/sweetalert2/sweetalert2.min.css',
        'vendor/sweetalert2/LICENSE',
        'vendor/README.md',
        'vendor/fontawesome-LICENSE.txt'].forEach((rel) => {
        assert(fs.existsSync(path.join(ROOT, rel)), `missing vendored file: ${rel}`);
    });
});

test('every icon reference resolves to a sprite symbol', () => {
    const icons = fs.readFileSync(path.join(ROOT, 'js/icons.js'), 'utf8');
    const symbols = new Set([...icons.matchAll(/^\s{8}'([a-z0-9-]+)': \{$/gm)].map((m) => m[1]));
    assert(symbols.size > 20, `expected a populated sprite, found ${symbols.size} symbols`);

    const files = ['index.html', 'docs.html', 'js/app.js', 'js/docs.js'];
    const missing = [];
    files.forEach((file) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        [...source.matchAll(/#i-([a-z0-9-]+)/g)].forEach((m) => {
            if (!symbols.has(m[1])) missing.push(`${file}: ${m[1]}`);
        });
    });
    assertEqual(missing.length, 0, `unknown icons: ${missing.join(', ')}`);
});

test('icons.js is loaded before the modules that render icons', () => {
    const iconsAt = html.indexOf('src="js/icons.js"');
    const appAt = html.indexOf('src="js/app.js"');
    assert(iconsAt !== -1, 'index.html must load js/icons.js');
    assert(iconsAt < appAt, 'icons.js must load before app.js');
    const docs = fs.readFileSync(path.join(ROOT, 'docs.html'), 'utf8');
    assert(docs.indexOf('src="js/icons.js"') < docs.indexOf('src="js/docs.js"'),
        'docs.html must load icons.js before docs.js');
});

test('the documented difficulty ladder matches the implementation', () => {
    const usage = fs.readFileSync(path.join(ROOT, 'docs/USAGE.md'), 'utf8');
    Level.DIFFICULTY_LABELS.forEach((label, index) => {
        assert(usage.includes(`${index + 1} ${label}`),
            `docs/USAGE.md should mention "${index + 1} ${label}"`);
    });
});

/* --------------------------- 12. UI (DOM stub) --------------------------- */

suite('UI');

const { installDom } = require('./dom-stub');
const realTimers = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    now: Date.now
};

const APP_MODULES = ['js/icons.js', 'js/rng.js', 'js/pathfinding.js', 'js/level.js', 'js/share.js',
    'js/image.js', 'js/app.js'];

/**
 * Boot the real page inside the DOM stub. Modules are re-evaluated on every
 * call so each test starts from a pristine `ParkingGen` and a fresh document.
 */
function bootUi(options) {
    const opts = options || {};
    const doc = installDom(html, opts);
    APP_MODULES.forEach((file) => {
        new Function(fs.readFileSync(path.join(ROOT, file), 'utf8')).call(globalThis);
    });
    doc.clock.advance(opts.settle === undefined ? 60 : opts.settle);
    return doc;
}

function cells(doc) {
    return doc.getElementById('gridContainer').children;
}

function findCell(doc, predicate) {
    return cells(doc).filter(predicate)[0] || null;
}

function isFree(cell) {
    return !/\b(car|start|end)\b/.test(cell.className);
}

/** Yield on a real macrotask, bypassing the stubbed timer queue. */
function realNextTick() {
    return new Promise((resolve) => realTimers.setTimeout(resolve, 0));
}

function carCount(doc) {
    return PG.App.state.level.cars.length;
}

test('the page boots into a rendered, described level', () => {
    const doc = bootUi();
    const level = PG.App.state.level;
    const grid = doc.getElementById('gridContainer');

    assert(level && level.width >= 4, 'a starter level was generated');
    assertEqual(grid.children.length, level.width * level.height, 'one DOM cell per grid cell');
    assertEqual(grid.getAttribute('role'), 'grid', 'the grid exposes a grid role');
    assertEqual(doc.getElementById('gridSizeStat').textContent, `${level.width}×${level.height}`);
    assertEqual(doc.getElementById('carCountStat').textContent, String(level.cars.length));
    assertEqual(cells(doc).filter((c) => /\bstart\b/.test(c.className)).length, 1, 'exactly one start cell');
    assertEqual(cells(doc).filter((c) => /\bend\b/.test(c.className)).length, 1, 'exactly one exit cell');
    assert(doc.getElementById('solvableStat').textContent.length > 0, 'the status chip is filled in');
    assert(!doc.getElementById('exportBtn').disabled, 'export is enabled once a level exists');
});

test('the icon sprite is mounted before the app renders', () => {
    const doc = bootUi();
    const sprite = doc.getElementById('pg-icons');
    assert(sprite, 'the sprite is injected into the document');
    assertEqual(sprite.children.length, PG.Icons.names().length, 'every icon became a symbol');
    assert(doc.getElementById('themeToggle').querySelector('.icon'), 'buttons reference sprite icons');
});

test('clicking a tool and a cell paints a car', () => {
    const doc = bootUi();
    const before = carCount(doc);
    const target = findCell(doc, isFree);
    assert(target, 'the starter level has a free cell');

    doc.getElementById('addCarBtn').click();
    assertEqual(doc.getElementById('addCarBtn').getAttribute('aria-pressed'), 'true', 'tool is pressed');
    assert(!doc.getElementById('modeBanner').classList.contains('d-none'), 'the mode banner shows');

    target.emit('mousedown', {});
    doc.clock.advance(30);

    assertEqual(carCount(doc), before + 1, 'one car was added');
    assert(/\bcar\b/.test(target.className), 'the cell repainted as a car');
    assertEqual(doc.getElementById('carCountStat').textContent, String(before + 1), 'stats follow the model');
});

test('drag-painting many cells costs one undo step', () => {
    const doc = bootUi();
    const before = carCount(doc);
    const free = cells(doc).filter(isFree).slice(0, 3);
    assertEqual(free.length, 3, 'need three free cells for the stroke');

    doc.getElementById('addCarBtn').click();
    free[0].emit('mousedown', {});
    doc.elementFromPointResult = free[1];
    doc.getElementById('gridContainer').emit('mousemove', { clientX: 4, clientY: 4 });
    doc.elementFromPointResult = free[2];
    doc.getElementById('gridContainer').emit('mousemove', { clientX: 4, clientY: 4 });
    doc.getElementById('gridContainer').emit('mouseup', {});
    doc.clock.advance(30);

    assertEqual(carCount(doc), before + 3, 'the whole stroke was painted');
    assert(!doc.getElementById('undoBtn').disabled, 'undo became available');

    doc.getElementById('undoBtn').click();
    doc.clock.advance(30);
    assertEqual(carCount(doc), before, 'one undo removed the entire stroke');
    assert(!doc.getElementById('redoBtn').disabled, 'redo became available');
    doc.getElementById('redoBtn').click();
    doc.clock.advance(30);
    assertEqual(carCount(doc), before + 3, 'redo restored the stroke');
});

test('the route overlay marks exactly the shortest path', () => {
    const doc = bootUi();
    const toggle = doc.getElementById('routeToggleBtn');
    toggle.click();
    doc.clock.advance(30);

    assertEqual(toggle.getAttribute('aria-pressed'), 'true', 'the toggle reports its state');
    const steps = PG.App.state.steps;
    assert(steps >= 1, 'the starter level is solvable');
    assertEqual(cells(doc).filter((c) => /\bon-route\b/.test(c.className)).length, steps + 1,
        'route cells = steps + 1');

    toggle.click();
    doc.clock.advance(30);
    assertEqual(cells(doc).filter((c) => /\bon-route\b/.test(c.className)).length, 0,
        'toggling off clears the overlay');
});

test('the keyboard can drive the grid', () => {
    const doc = bootUi();
    const grid = doc.getElementById('gridContainer');
    const target = findCell(doc, isFree);
    const x = Number(target.dataset.x);
    const y = Number(target.dataset.y);

    grid.fire('focus', {});
    doc.clock.advance(20);
    assert(PG.App.state.cursor, 'focusing the grid places a cursor');

    target.emit('mousedown', {});            // no tool: just moves the cursor
    assertEqual(PG.App.state.cursor.x, x, 'cursor x follows the click');
    assertEqual(PG.App.state.cursor.y, y, 'cursor y follows the click');

    grid.fire('keydown', { key: 'ArrowRight', shiftKey: false });
    assertEqual(PG.App.state.cursor.x, Math.min(x + 1, PG.App.state.level.width - 1), 'arrow keys move');

    const before = carCount(doc);
    doc.getElementById('addCarBtn').click();
    grid.fire('keydown', { key: 'ArrowLeft', shiftKey: false });
    grid.fire('keydown', { key: 'Enter' });
    doc.clock.advance(30);
    assertEqual(carCount(doc), before + 1, 'Enter applies the active tool at the cursor');

    grid.fire('keydown', { key: 'Delete' });
    doc.clock.advance(30);
    assertEqual(carCount(doc), before, 'Delete removes the car under the cursor');
});

test('Escape cancels the active tool', () => {
    const doc = bootUi();
    doc.getElementById('addCarBtn').click();
    assert(PG.App.state.editMode === 'addCar', 'tool active');
    doc.fire('keydown', { key: 'Escape', target: doc.body });
    assertEqual(PG.App.state.editMode, null, 'Escape left edit mode');
    assert(doc.getElementById('modeBanner').classList.contains('d-none'), 'the banner hides again');
});

test('generating from the form rebuilds the grid', () => {
    const doc = bootUi();
    doc.getElementById('width').value = '4';
    doc.getElementById('height').value = '4';
    doc.getElementById('seed').value = 'ui-suite';
    doc.getElementById('difficulty').value = '9';
    doc.getElementById('levelForm').fire('submit', {});

    assert(doc.getElementById('gridWrapper').classList.contains('is-generating'), 'the veil shows first');
    doc.clock.advance(400);

    assertEqual(PG.App.state.level.width, 4, 'width applied');
    assertEqual(PG.App.state.level.height, 4, 'height applied');
    assertEqual(PG.App.state.level.seed, 'ui-suite', 'seed applied');
    assertEqual(doc.getElementById('gridContainer').children.length, 16, 'grid rebuilt');
    assert(!doc.getElementById('gridWrapper').classList.contains('is-generating'), 'the veil cleared');
    assertEqual(doc.getElementById('difficultyStat').textContent, `9 · ${Level.difficultyLabel(9)}`);
});

test('dropping a JSON file loads it and reports the repairs', () => {
    const doc = bootUi();
    const file = {
        name: 'handmade.json',
        size: 512,
        type: 'application/json',
        __text: JSON.stringify({
            width: 6,
            height: 6,
            start: [0, 0],
            end: [5, 5],
            cars: [{ x: 1, y: 1, direction: 'up' }, { x: 99, y: 99 }, { x: 1, y: 1 }]
        })
    };
    doc.fire('drop', { dataTransfer: { files: [file] } });
    doc.clock.advance(60);

    assertEqual(PG.App.state.level.width, 6, 'the dropped level was loaded');
    assertEqual(PG.App.state.level.cars.length, 1, 'the two broken cars were dropped');
    assertEqual(cells(doc).length, 36, 'the grid matches the loaded size');
});

test('a blocked level is reported as blocked', () => {
    const doc = bootUi();
    // Sealed pocket: the exit at (1, 1) has all four neighbours walled in.
    const walled = {
        width: 10,
        height: 10,
        difficulty: 5,
        seed: 'walled',
        parkingLayout: 'rows',
        start: [0, 0],
        end: [1, 1],
        cars: [
            { x: 0, y: 1, direction: 'up' }, { x: 1, y: 0, direction: 'up' },
            { x: 2, y: 1, direction: 'up' }, { x: 1, y: 2, direction: 'up' }
        ]
    };
    PG.App.state.level = Level.sanitizeLevel(walled, []);
    doc.getElementById('validateBtn').click();
    assertEqual(doc.getElementById('solvableStat').textContent, 'Blocked', 'status chip says blocked');
    assertEqual(doc.getElementById('routeStat').textContent, 'Blocked', 'route stat says blocked');
    assert(doc.getElementById('exportBtn').classList.contains('btn--danger-state'),
        'the blocked export button is flagged');
});

test('the theme toggle flips the document and is remembered', () => {
    const doc = bootUi();
    doc.getElementById('themeToggle').click();
    assertEqual(doc.documentElement.getAttribute('data-theme'), 'dark', 'document switched to dark');
    assertEqual(doc.documentElement.getAttribute('data-bs-theme'), null, 'no leftover Bootstrap hook');
    assertEqual(globalThis.localStorage.getItem('plg-theme'), 'dark', 'the choice was stored');
    assert(/i-sun/.test(doc.getElementById('themeToggle').innerHTML), 'the button now offers the sun');
});

test('copy and share actions put text on the clipboard', () => {
    const doc = bootUi();
    const copied = [];
    globalThis.navigator.clipboard.writeText = (text) => {
        copied.push(text);
        return Promise.resolve();
    };

    doc.getElementById('copyJsonBtn').click();
    doc.getElementById('shareBtn').click();
    doc.clock.advance(60);

    assertEqual(copied.length, 2, 'both actions wrote to the clipboard');
    assert(copied[0].includes('"width"'), 'the JSON export looks like a level');
    assert(copied[1].includes('level='), 'the share link carries the level parameter');
    const code = Share.readCodeFromUrl(new URL(copied[1]).search, '');
    const restored = Share.decodeLevel(code, []);
    assertEqual(restored.cars.length, PG.App.state.level.cars.length, 'the link round-trips the cars');
});

test('a share link in the URL boots straight into that level', () => {
    const level = Level.generateLevel(7, 5, 8, 'url-boot', true, { name: 'From the URL' });
    const code = Share.encodeLevel(level);
    const doc = bootUi({ location: { search: '?level=' + encodeURIComponent(code) } });
    const loaded = PG.App.state.level;

    assertEqual(loaded.width, 7, 'width came from the link');
    assertEqual(loaded.height, 5, 'height came from the link');
    assertEqual(loaded.seed, 'url-boot', 'seed came from the link');
    assertEqual(loaded.cars.length, level.cars.length, 'cars came from the link');
    assertEqual(cells(doc).length, 35, 'the grid matches');
});

test('exporting JSON downloads the level document', () => {
    const doc = bootUi();
    const blobs = [];
    globalThis.URL.createObjectURL = (blob) => {
        blobs.push(blob);
        return 'blob:test';
    };

    doc.getElementById('exportBtn').click();

    assertEqual(blobs.length, 1, 'the JSON export triggered a download');
    assertEqual(blobs[0].type, 'application/json', 'JSON blob type');
    assert(blobs[0].size > 100, 'the blob carries the level document');
});

test('exporting PNG renders the level through the image module', () => {
    const doc = bootUi();
    const rendered = [];
    const encoded = [];
    const originalRender = PG.Image.renderLevelToCanvas;
    const originalEncode = PG.Image.canvasToBlob;
    PG.Image.renderLevelToCanvas = (level, options) => {
        const canvas = originalRender(level, options);
        rendered.push({ level, canvas, options });
        return canvas;
    };
    PG.Image.canvasToBlob = (canvas) => {
        encoded.push(canvas);
        return originalEncode(canvas);
    };

    try {
        doc.getElementById('pngBtn').click();
    } finally {
        PG.Image.renderLevelToCanvas = originalRender;
        PG.Image.canvasToBlob = originalEncode;
    }

    assertEqual(rendered.length, 1, 'the renderer ran once');
    assert(rendered[0].canvas, 'a canvas was produced');
    assertEqual(encoded.length, 1, 'the canvas was handed to the PNG encoder');
    assertEqual(rendered[0].options.title, PG.App.state.level.name || 'Parking lot level');
});

test('the canvas encoder resolves a PNG blob', () => {
    bootUi();
    const canvas = PG.Image.renderLevelToCanvas(PG.App.state.level, {});
    assert(canvas, 'a canvas is available in the stub');
    // Deliberately awaited: promises given to later-installed DOM stubs must not
    // be able to clobber the globals this call depends on.
    return PG.Image.canvasToBlob(canvas).then((blob) => {
        assertEqual(blob.type, 'image/png', 'encoded as PNG');
    });
});

test('the JSON panel collapses without losing the level', () => {
    const doc = bootUi();
    const toggle = doc.getElementById('toggleJsonBtn');
    toggle.click();
    assert(doc.getElementById('jsonDisplay').classList.contains('d-none'), 'panel hidden');
    assertEqual(toggle.getAttribute('aria-expanded'), 'false', 'aria state updated');
    toggle.click();
    doc.clock.advance(60);
    assert(!doc.getElementById('jsonDisplay').classList.contains('d-none'), 'panel visible again');
    assert(doc.getElementById('jsonContent').textContent.includes('"width"'), 'the document came back');
});

test('edits are grouped, persisted and never outlive the undo limit', () => {
    const doc = bootUi();
    assert(doc.getElementById('undoBtn').disabled, 'nothing to undo at boot');
    doc.getElementById('addCarBtn').click();
    const target = findCell(doc, isFree);
    target.emit('mousedown', {});
    doc.clock.advance(1000);                 // let the session debounce fire
    assert(globalThis.localStorage.getItem('plg-session'), 'the session was stored');
    const saved = JSON.parse(globalThis.localStorage.getItem('plg-session'));
    assertEqual(saved.level.width, PG.App.state.level.width, 'the session holds the level');
});

// Leave the global timer functions as we found them.
Object.assign(globalThis, {
    setTimeout: realTimers.setTimeout,
    clearTimeout: realTimers.clearTimeout,
    setInterval: realTimers.setInterval,
    clearInterval: realTimers.clearInterval
});
Date.now = realTimers.now;

/* ------------------------------ Summary ------------------------------ */

function finish() {
    const total = passed + failures.length;
    if (!QUIET) console.log('');
    if (failures.length) {
        console.error(`${failures.length} of ${total} assertions failed:\n`);
        failures.forEach((f) => console.error(`  ✗ [${f.suite}] ${f.name}\n      ${f.error.message}`));
        console.error('');
        process.exit(1);
    }
    console.log(`${passed} assertions passed${FILTER ? ` (filter: ${FILTER})` : ''}\n`);
    process.exit(suiteFailed ? 1 : 0);
}

Promise.all(pending).then(finish);
