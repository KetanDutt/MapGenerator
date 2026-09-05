/**
 * rng.js — Deterministic seeded pseudo-random number generator.
 *
 * A small, self-contained implementation (mulberry32 + string hash) so the
 * app does not depend on an external CDN (seedrandom) for deterministic
 * generation. The same seed always produces the same sequence of numbers.
 *
 * Exposed as `ParkingGen.RNG` on the global `ParkingGen` namespace.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});

    /**
     * Hash a string seed into a 32-bit unsigned integer (xmur3-style).
     * @param {string} str
     * @returns {number}
     */
    function hashSeed(str) {
        let h = 1779033703 ^ String(str).length;
        for (let i = 0; i < String(str).length; i++) {
            h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        // Finalise the hash.
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
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * Create a seeded random generator.
     * @param {string|number} seed
     * @returns {{ next: function(): number, int: function(number, number): number,
     *            pick: function(Array): *, shuffle: function(Array): Array }}
     */
    function createRNG(seed) {
        const rand = mulberry32(hashSeed(seed));

        return {
            /** Random float in [0, 1). */
            next: rand,

            /** Random integer in [min, max) (max exclusive). */
            int(min, max) {
                return min + Math.floor(rand() * (max - min));
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
                    [out[i], out[j]] = [out[j], out[i]];
                }
                return out;
            }
        };
    }

    /**
     * Generate a short, URL-safe random seed string (not deterministic).
     * @returns {string}
     */
    function randomSeed() {
        const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
        if (global.crypto && global.crypto.getRandomValues) {
            const buf = new Uint32Array(9);
            global.crypto.getRandomValues(buf);
            let out = '';
            for (let i = 0; i < 9; i++) out += alphabet[buf[i] % alphabet.length];
            return out;
        }
        // Fallback for very old environments.
        let out = '';
        for (let i = 0; i < 9; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
        return out;
    }

    PG.RNG = { createRNG, randomSeed, hashSeed };
})(typeof window !== 'undefined' ? window : globalThis);
