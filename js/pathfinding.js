/**
 * pathfinding.js — Grid pathfinding utilities.
 *
 * Breadth-first search over the parking grid. Cars are obstacles; the start
 * and end cells are always passable. BFS guarantees the shortest
 * 4-directional path when one exists, which doubles as the "minimum number of
 * moves" metric surfaced in the UI.
 *
 * Performance notes
 * -----------------
 * Every search reuses a preallocated scratch workspace (typed arrays for the
 * occupancy map, the visited bitmap, the parent links and the queue). The UI
 * runs a search after *every* edit — including once per cell while
 * drag-painting — so avoiding per-call allocation keeps large (60×60) levels
 * jank-free and removes GC pressure.
 *
 * Exposed as `ParkingGen.Pathfinding`.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});

    /** Neighbour offsets. Order is stable so paths are deterministic. */
    const DIRS = [
        [1, 0],   // right
        [-1, 0],  // left
        [0, 1],   // down
        [0, -1]   // up
    ];

    /**
     * Allocate (or reuse) a scratch workspace sized for a `width × height`
     * grid. Buffers are keyed by size so a single workspace object is reused
     * across searches of the same level.
     *
     * @param {number} width
     * @param {number} height
     * @param {object} [workspace] Existing workspace to reuse when it fits.
     * @returns {object} Workspace with `blocked`, `visited`, `parent`,
     *   `queue`, `stamp` and `size`.
     */
    function createWorkspace(width, height, workspace) {
        const size = width * height;
        if (workspace && workspace.size === size && workspace.width === width) {
            return workspace;
        }
        return {
            width,
            height,
            size,
            blocked: new Uint8Array(size),
            // Uint32 stamp array instead of clearing `visited` on every search:
            // a cell counts as visited when `stamp[i] === currentStamp`.
            stamp: new Uint32Array(size),
            visitedMark: 0,
            parent: new Int32Array(size),
            queue: new Int32Array(size),
            // BFS depth per visited cell (steps from the start cell).
            dist: new Int32Array(size)
        };
    }

    /**
     * Build an occupancy lookup from a level's car list.
     *
     * @param {object} level
     * @param {object} [workspace] Optional workspace from `createWorkspace`.
     * @returns {Uint8Array} width*height buffer; 1 = blocked.
     */
    function buildBlocked(level, workspace) {
        const ws = workspace || createWorkspace(level.width, level.height);
        ws.blocked.fill(0);
        const { width, height } = level;
        for (const car of level.cars) {
            if (car.x >= 0 && car.x < width && car.y >= 0 && car.y < height) {
                ws.blocked[car.y * width + car.x] = 1;
            }
        }
        return ws.blocked;
    }

    /** True when [x, y] lies inside the grid. */
    function inBounds(level, x, y) {
        return x >= 0 && x < level.width && y >= 0 && y < level.height;
    }

    /**
     * BFS core. Returns the index of the target cell, or -1 when unreachable.
     * With `recordParents` the `parent` array is filled so the path can be
     * reconstructed; `canReach` skips that work.
     *
     * @param {object} level
     * @param {number} sx @param {number} sy
     * @param {number} tx @param {number} ty
     * @param {object} ws Workspace.
     * @param {boolean} recordParents
     * @returns {number} target index or -1.
     */
    function bfs(level, sx, sy, tx, ty, ws, recordParents) {
        const width = level.width;
        const height = level.height;
        const blocked = ws.blocked;
        const startIdx = sy * width + sx;
        const targetIdx = ty * width + tx;

        const mark = (ws.visitedMark = (ws.visitedMark + 1) >>> 0) || 1;
        if (ws.visitedMark === 0) {
            // Stamp wrapped around (4 billion searches — only reachable in
            // theory, but resetting is cheap insurance).
            ws.stamp.fill(0);
            ws.visitedMark = mark;
        }
        const stamp = ws.stamp;
        const parent = ws.parent;
        const queue = ws.queue;
        const dist = ws.dist;

        let head = 0;
        let tail = 0;
        queue[tail++] = startIdx;
        stamp[startIdx] = mark;
        dist[startIdx] = 0;
        if (recordParents) parent[startIdx] = -1;

        while (head < tail) {
            const current = queue[head++];
            if (current === targetIdx) return current;

            const cx = current % width;
            const cy = (current / width) | 0;
            const nextDist = dist[current] + 1;

            for (let d = 0; d < 4; d++) {
                const nx = cx + DIRS[d][0];
                const ny = cy + DIRS[d][1];
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                const ni = ny * width + nx;
                if (stamp[ni] === mark) continue;
                // Cars block movement; start/end stay passable even if a car
                // (from an imported file) sits on them.
                if (blocked[ni] && ni !== targetIdx && ni !== startIdx) continue;

                stamp[ni] = mark;
                dist[ni] = nextDist;
                if (recordParents) parent[ni] = current;
                queue[tail++] = ni;
            }
        }
        return -1;
    }

    /**
     * Find the shortest path between two points using BFS.
     *
     * @param {object} level A level object ({width, height, cars}).
     * @param {[number, number]} start [x, y]
     * @param {[number, number]} end [x, y]
     * @param {object} [workspace] Optional reusable workspace.
     * @returns {Array<[number, number]>|null} List of [x, y] cells from start
     *   to end (inclusive), or null if no path exists.
     */
    function findShortestPath(level, start, end, workspace) {
        if (!level || !Array.isArray(start) || !Array.isArray(end)) return null;
        const sx = start[0], sy = start[1];
        const ex = end[0], ey = end[1];
        if (!inBounds(level, sx, sy) || !inBounds(level, ex, ey)) return null;

        const width = level.width;
        const ws = createWorkspace(width, level.height, workspace);
        buildBlocked(level, ws);

        if (sx === ex && sy === ey) return [[sx, sy]];

        const targetIdx = bfs(level, sx, sy, ex, ey, ws, true);
        if (targetIdx === -1) return null;

        // Walk the parent links from the target back to the start. The path is
        // bounded by the grid size, so `unshift`-free reversal is safe.
        const parent = ws.parent;
        const path = [];
        let cur = targetIdx;
        while (cur !== -1 && cur !== undefined) {
            path.push([cur % width, (cur / width) | 0]);
            if (cur === sy * width + sx) break;
            cur = parent[cur];
        }
        path.reverse();
        return path;
    }

    /**
     * Reachability check *without* path reconstruction — the fast path used by
     * the live status badge and the generator's placement loop.
     *
     * @param {object} level
     * @param {[number, number]} start
     * @param {[number, number]} end
     * @param {object} [workspace]
     * @returns {boolean}
     */
    function canReach(level, start, end, workspace) {
        if (!level || !Array.isArray(start) || !Array.isArray(end)) return false;
        if (!inBounds(level, start[0], start[1]) || !inBounds(level, end[0], end[1])) return false;
        const ws = createWorkspace(level.width, level.height, workspace);
        buildBlocked(level, ws);
        return bfs(level, start[0], start[1], end[0], end[1], ws, false) !== -1;
    }

    /**
     * Length of the shortest route in *steps* (0 when start === end), or -1
     * when the exit is unreachable. Cheaper than `findShortestPath` because no
     * cell list is materialised — this is what the generator and the live
     * "Route" statistic use.
     *
     * @param {object} level
     * @param {[number, number]} start
     * @param {[number, number]} end
     * @param {object} [workspace]
     * @returns {number}
     */
    function shortestPathLength(level, start, end, workspace) {
        if (!level || !Array.isArray(start) || !Array.isArray(end)) return -1;
        const sx = start[0], sy = start[1];
        const ex = end[0], ey = end[1];
        if (!inBounds(level, sx, sy) || !inBounds(level, ex, ey)) return -1;

        const ws = createWorkspace(level.width, level.height, workspace);
        buildBlocked(level, ws);
        if (sx === ex && sy === ey) return 0;

        const targetIdx = bfs(level, sx, sy, ex, ey, ws, false);
        return targetIdx === -1 ? -1 : ws.dist[targetIdx];
    }

    /**
     * Check whether a level's start cell can reach its end cell.
     * @param {object} level
     * @param {object} [workspace]
     * @returns {boolean}
     */
    function isSolvable(level, workspace) {
        if (!level || !level.start || !level.end) return false;
        return canReach(level, level.start, level.end, workspace);
    }

    /**
     * Create a stateful solver bound to a level's dimensions. Handy for the
     * generator, which runs thousands of searches against the same grid size.
     *
     * @param {number} width
     * @param {number} height
     * @returns {{isSolvable: function(object): boolean,
     *            findShortestPath: function(object, Array, Array): ?Array}}
     */
    function createSolver(width, height) {
        const ws = createWorkspace(width, height);
        return {
            workspace: ws,
            isSolvable(level) { return canReach(level, level.start, level.end, ws); },
            shortestPathLength(level, start, end) {
                return shortestPathLength(level, start, end, ws);
            },
            findShortestPath(level, start, end) {
                return findShortestPath(level, start, end, ws);
            }
        };
    }

    PG.Pathfinding = {
        DIRS,
        createWorkspace,
        createSolver,
        buildBlocked,
        findShortestPath,
        shortestPathLength,
        canReach,
        isSolvable
    };
})(typeof window !== 'undefined' ? window : globalThis);
