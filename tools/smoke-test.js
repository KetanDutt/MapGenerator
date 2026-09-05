#!/usr/bin/env node
/**
 * smoke-test.js — Dependency-free sanity checks for the core level logic.
 *
 * Runs under Node.js:  node tools/smoke-test.js
 *
 * It loads the browser-oriented modules (which attach themselves to
 * `globalThis.ParkingGen`) and exercises generation, determinism,
 * pathfinding and level sanitisation. Exits non-zero on failure.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
['js/rng.js', 'js/pathfinding.js', 'js/level.js'].forEach((rel) => {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    // Evaluate in the current global scope so `globalThis.ParkingGen` is shared.
    // eslint-disable-next-line no-new-func
    new Function(code).call(globalThis);
});

const PG = globalThis.ParkingGen;
const { Level, Pathfinding } = PG;

let passed = 0;
let failed = 0;

function assert(cond, message) {
    if (cond) {
        passed++;
        console.log(`  ✓ ${message}`);
    } else {
        failed++;
        console.error(`  ✗ ${message}`);
    }
}

function assertThrows(fn, message) {
    try {
        fn();
        failed++;
        console.error(`  ✗ ${message} (did not throw)`);
    } catch (_) {
        passed++;
        console.log(`  ✓ ${message}`);
    }
}

console.log('\n— RNG —');
const r1 = PG.RNG.createRNG('test-seed');
const seq1 = [r1.next(), r1.next(), r1.next()];
const r2 = PG.RNG.createRNG('test-seed');
const seq2 = [r2.next(), r2.next(), r2.next()];
assert(JSON.stringify(seq1) === JSON.stringify(seq2), 'same seed produces same sequence');
const r3 = PG.RNG.createRNG('different-seed');
assert(r3.next() !== seq1[0], 'different seed produces different sequence');
assert(seq1.every((v) => v >= 0 && v < 1), 'PRNG output is within [0, 1)');
const shuffled = r3.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
assert(shuffled.length === 8 && [1, 2, 3, 4, 5, 6, 7, 8].every((n) => shuffled.includes(n)), 'shuffle preserves elements');

console.log('\n— Generation —');
const level = Level.generateLevel(10, 10, 5, 'abc123', true);
assert(level.width === 10 && level.height === 10, 'grid dimensions are honoured');
assert(level.cars.length > 0, 'level contains cars');
assert(level.cars.length <= Math.floor(0.4 * 100), 'car count respects density cap');
assert(level.grid.length === 10 && level.grid[0].length === 10, 'grid matrix dimensions match');
assert(Pathfinding.isSolvable(level), 'generated "guarantee path" level is solvable');

const again = Level.generateLevel(10, 10, 5, 'abc123', true);
assert(JSON.stringify(again.cars) === JSON.stringify(level.cars), 'generation is deterministic for a seed');
assert(JSON.stringify(again.start) === JSON.stringify(level.start), 'start position is deterministic');

const carKeys = new Set(level.cars.map((c) => c.x + ',' + c.y));
assert(carKeys.size === level.cars.length, 'no overlapping cars');
assert(!carKeys.has(level.start[0] + ',' + level.start[1]), 'no car on start');
assert(!carKeys.has(level.end[0] + ',' + level.end[1]), 'no car on end');
assert(level.start[0] !== level.end[0] || level.start[1] !== level.end[1], 'start and end differ');
assert(['up', 'down', 'left', 'right'].every((d) => true) &&
    level.cars.every((c) => Level.DIRECTIONS.includes(c.direction)), 'all car directions are valid');

// Grid matrix matches the car/start/end source of truth.
let gridConsistent = true;
for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
        const t = level.grid[y][x].type;
        const isCar = level.cars.some((c) => c.x === x && c.y === y);
        const isStart = level.start[0] === x && level.start[1] === y;
        const isEnd = level.end[0] === x && level.end[1] === y;
        if ((t === 'car') !== isCar) gridConsistent = false;
        if ((t === 'start') !== isStart) gridConsistent = false;
        if ((t === 'end') !== isEnd) gridConsistent = false;
        if (t === 'empty' && (isCar || isStart || isEnd)) gridConsistent = false;
    }
}
assert(gridConsistent, 'grid matrix is consistent with cars/start/end');

console.log('\n— Difficulty / density —');
const easy = Level.generateLevel(20, 20, 1, 'density', false);
const hard = Level.generateLevel(20, 20, 10, 'density', false);
assert(hard.cars.length > easy.cars.length, `higher difficulty yields more cars (${easy.cars.length} < ${hard.cars.length})`);
assert(hard.cars.length <= Math.floor(0.4 * 400), 'hard level respects density cap');

console.log('\n— Layout / direction rules —');
const rows = Level.generateLevel(10, 14, 5, 'layout', false);
assert(rows.parkingLayout === 'rows', 'tall grid uses rows layout');
const cols = Level.generateLevel(14, 10, 5, 'layout', false);
assert(cols.parkingLayout === 'columns', 'wide grid uses columns layout');

console.log('\n— Pathfinding —');
const open = Level.generateLevel(6, 6, 1, 'open', false);
open.cars = [];
open.grid = Level.rebuildGrid(open);
const route = Pathfinding.findShortestPath(open, open.start, open.end);
assert(Array.isArray(route), 'BFS returns a path on an open grid');
assert(route[0][0] === open.start[0] && route[0][1] === open.start[1], 'path starts at start');
const last = route[route.length - 1];
assert(last[0] === open.end[0] && last[1] === open.end[1], 'path ends at end');
const manhattan = Math.abs(open.end[0] - open.start[0]) + Math.abs(open.end[1] - open.start[1]);
assert(route.length === manhattan + 1, `BFS path is shortest (${route.length - 1} steps == ${manhattan})`);

// Fully blocked level (wall of cars between columns) is unsolvable.
const blocked = Level.generateLevel(5, 5, 5, 'blocked', false);
blocked.start = [0, 2];
blocked.end = [4, 2];
blocked.cars = [];
for (let y = 0; y < 5; y++) blocked.cars.push({ x: 2, y, direction: 'up' });
blocked.grid = Level.rebuildGrid(blocked);
assert(!Pathfinding.isSolvable(blocked), 'wall of cars blocks the path');

console.log('\n— Sanitisation (loading untrusted JSON) —');
const warnings = [];
const clean = Level.sanitizeLevel({
    width: 8,
    height: 8,
    difficulty: 99,            // out of range → clamped, warning
    start: [1, 1],
    end: [1, 1],               // same as start → moved, warning
    cars: [
        { x: 3, y: 3, direction: 'sideways' }, // bad direction → defaulted
        { x: 99, y: 0 },                        // out of bounds → dropped
        { x: 1, y: 1 },                         // overlaps start → dropped
        null,                                   // not an object → dropped
        { x: 5, y: 5 }                          // valid
    ]
}, warnings);
assert(clean.width === 8 && clean.height === 8, 'sanitise keeps valid dimensions');
assert(clean.difficulty === 10, 'difficulty clamped to 10');
assert(clean.cars.length === 2, `invalid cars removed (kept ${clean.cars.length})`);
assert(clean.end[0] !== clean.start[0] || clean.end[1] !== clean.start[1], 'end moved off start');
assert(warnings.length >= 4, `warnings collected for every fix (${warnings.length})`);
assert(Array.isArray(clean.grid) && clean.grid.length === 8, 'sanitise rebuilds the grid');

assertThrows(() => Level.sanitizeLevel({ width: 2, height: 2 }), 'too-small grid rejected');
// Note: a missing grid matrix is fine — it is rebuilt from cars/start/end.
const minimal = Level.sanitizeLevel({ width: 10, height: 10 }, []);
assert(Array.isArray(minimal.grid) && minimal.cars.length === 0, 'minimal level (no grid/cars) is rebuilt safely');
assertThrows(() => Level.sanitizeLevel('nope'), 'non-object rejected');
assertThrows(() => Level.sanitizeLevel({ width: 'wide', height: 10 }), 'non-numeric dimensions rejected');
assertThrows(() => Level.sanitizeLevel({ width: 1000, height: 1000 }), 'oversized grid rejected');

console.log('\n— Round trip (export → import) —');
const exported = JSON.parse(JSON.stringify(level));
const reloaded = Level.sanitizeLevel(exported, []);
assert(JSON.stringify(reloaded.cars) === JSON.stringify(level.cars), 'cars survive export/import');
assert(JSON.stringify(reloaded.start) === JSON.stringify(level.start), 'start survives export/import');
assert(JSON.stringify(reloaded.end) === JSON.stringify(level.end), 'end survives export/import');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
