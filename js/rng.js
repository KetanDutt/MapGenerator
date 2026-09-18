/**
 * rng.js — Deterministic seeded pseudo-random number generator.
 *
 * A small, self-contained implementation (mulberry32 + xmur3 string hash) so
 * the app never depends on an external CDN for deterministic generation. The
 * same seed always produces the same sequence of numbers, which is what makes
 * levels reproducible and shareable.
 *
 * Exposed as `ParkingGen.RNG` on the global `ParkingGen` namespace.
 *
 * NOTE: this module is intentionally dependency-free and runs unchanged in the
 * browser and in Node.js (see `tools/test.js`).
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});

    /**
     * Hash a string seed into a 32-bit unsigned integer (xmur3-style).
     *
     * The string is coerced once (not per iteration) so hashing stays cheap
     * even for long seeds.
     *
     * @param {string|number} str Seed value; coerced with `String()`.
     * @returns {number} Unsigned 32-bit hash.
     */
    function hashSeed(str) {
        const s = String(str);
        let h = 1779033703 ^ s.length;
        for (let i = 0; i < s.length; i++) {
            h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        // Finalise the hash (avalanche).
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    }

    /**
     * mulberry32 PRNG — fast, decent-quality 32-bit generator.
     * @param {number} seed 32-bit integer seed.
     * @returns {function(): number} Function returning a float in [0, 1).
     */
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * Create a seeded random generator.
     *
     * Every method draws from the same underlying stream, so the full sequence
     * of values is reproducible for a given seed.
     *
     * @param {string|number} seed
     * @returns {{
     *   next: function(): number,
     *   int: function(number, number): number,
     *   bool: function(number): boolean,
     *   pick: function(Array): *,
     *   shuffle: function(Array): Array,
     *   reseed: function(string|number): void
     * }}
     */
    function createRNG(seed) {
        let rand = mulberry32(hashSeed(seed));

        return {
            /** Random float in [0, 1). */
            next: function () { return rand(); },

            /**
             * Random integer in [min, max). `max` is exclusive, matching
             * `Array#slice` and `for (i = min; i < max; i++)` intuition.
             */
            int(min, max) {
                return min + Math.floor(rand() * (max - min));
            },

            /** Random boolean, true with probability `p` (default 0.5). */
            bool(p) {
                return rand() < (p === undefined ? 0.5 : p);
            },

            /** Pick a random element from an array (non-mutating). */
            pick(arr) {
                return arr[Math.floor(rand() * arr.length)];
            },

            /** Fisher–Yates shuffle (returns a new shuffled array). */
            shuffle(arr) {
                const out = arr.slice();
                for (let i = out.length - 1; i > 0; i--) {
                    const j = Math.floor(rand() * (i + 1));
                    const tmp = out[i];
                    out[i] = out[j];
                    out[j] = tmp;
                }
                return out;
            },

            /** Re-seed in place (rarely needed; handy for tests/tools). */
            reseed(nextSeed) {
                rand = mulberry32(hashSeed(nextSeed));
            }
        };
    }

    const SEED_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

    /**
     * Generate a short, URL-safe random seed string (NOT deterministic).
     *
     * Uses `crypto.getRandomValues` with rejection sampling so every character
     * is uniformly distributed (a plain `% 36` would bias the first four
     * characters). Falls back to `Math.random` in very old environments.
     *
     * @param {number} [length=9] Number of characters.
     * @returns {string}
     */
    function randomSeed(length) {
        const n = Math.max(1, Math.round(length) || 9);
        let out = '';
        if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
            const buf = new Uint32Array(1);
            // 36 * 119304647 = 4294967292, the largest multiple of 36 that fits
            // in 2^32; larger draws are rejected rather than folded back down
            // (which would bias the first few alphabet characters).
            const LIMIT = 4294967292;
            for (let i = 0; i < n; i++) {
                let v;
                do {
                    global.crypto.getRandomValues(buf);
                    v = buf[0];
                } while (v >= LIMIT);
                out += SEED_ALPHABET[v % SEED_ALPHABET.length];
            }
            return out;
        }
        for (let i = 0; i < n; i++) {
            out += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
        }
        return out;
    }

    PG.RNG = { createRNG, randomSeed, hashSeed, mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
