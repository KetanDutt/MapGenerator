/**
 * pathfinding.js — Grid pathfinding utilities.
 *
 * Breadth-first search over the parking grid. Cars are obstacles; the
 * start and end cells are always passable. BFS guarantees the shortest
 * 4-directional path when one exists.
 *
 * Exposed as `ParkingGen.Pathfinding`.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});

    // Neighbour offsets: right, left, down, up.
    const DIRS = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ];

    /**
     * Build an occupancy lookup from a level's car list.
     * @param {object} level
     * @returns {Uint8Array} width*height buffer; 1 = blocked.
     */
    function buildBlocked(level) {
        const blocked = new Uint8Array(level.width * level.height);
        for (const car of level.cars) {
            if (car.x >= 0 && car.x < level.width && car.y >= 0 && car.y < level.height) {
                blocked[car.y * level.width + car.x] = 1;
            }
        }
        return blocked;
    }

    /**
     * Find the shortest path between two points using BFS.
     *
     * @param {object} level A level object ({width, height, cars}).
     * @param {[number, number]} start [x, y]
     * @param {[number, number]} end [x, y]
     * @returns {Array<[number, number]>|null} List of [x, y] cells from start
     *   to end (inclusive), or null if no path exists.
     */
    function findShortestPath(level, start, end) {
        const { width, height } = level;
        const sx = start[0], sy = start[1];
        const ex = end[0], ey = end[1];

        if (sx === ex && sy === ey) return [[sx, sy]];

        const blocked = buildBlocked(level);
        const size = width * height;
        const visited = new Uint8Array(size);
        // Parent index for each visited cell (-1 = no parent / start cell).
        const parent = new Int32Array(size).fill(-1);

        const queue = new Int32Array(size);
        let head = 0, tail = 0;
        const startIdx = sy * width + sx;
        queue[tail++] = startIdx;
        visited[startIdx] = 1;

        const targetIdx = ey * width + ex;

        let found = false;
        while (head < tail) {
            const current = queue[head++];
            if (current === targetIdx) { found = true; break; }

            const cx = current % width;
            const cy = (current / width) | 0;

            for (let d = 0; d < DIRS.length; d++) {
                const nx = cx + DIRS[d][0];
                const ny = cy + DIRS[d][1];
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                const ni = ny * width + nx;
                if (visited[ni]) continue;
                // Cars block movement; start/end are always passable.
                if (blocked[ni] && ni !== targetIdx && ni !== startIdx) continue;

                visited[ni] = 1;
                parent[ni] = current;
                queue[tail++] = ni;
            }
        }

        if (!found) return null;

        // Reconstruct path by walking parents from end back to start.
        const path = [];
        let cur = targetIdx;
        while (cur !== -1) {
            path.push([cur % width, (cur / width) | 0]);
            if (cur === startIdx) break;
            cur = parent[cur];
        }
        path.reverse();
        return path;
    }

    /**
     * Check whether a level's start cell can reach its end cell.
     * @param {object} level
     * @returns {boolean}
     */
    function isSolvable(level) {
        if (!level || !level.start || !level.end) return false;
        return findShortestPath(level, level.start, level.end) !== null;
    }

    PG.Pathfinding = { findShortestPath, isSolvable, buildBlocked };
})(typeof window !== 'undefined' ? window : globalThis);
