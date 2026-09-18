/**
 * share.js — Compact, human-inspectable level sharing codes.
 *
 * A level can be flattened into a short URL-safe string so a share link
 * reproduces the *exact* level (including hand edits), not just its seed.
 *
 * Format (v1), fields joined with `~`:
 *
 *   1~<w>x<h>~<difficulty>~<seed>~<sx>-<sy>~<ex>-<ey>~<r|c>~<name>~<cars>
 *
 *   cars   : `x-y<dir>` entries joined with `_`; dir ∈ {u,r,d,l}
 *   name   : omitted when empty; `seed` and `name` are percent-encoded and
 *            have the `~`/`_` separators escaped so they can hold any text.
 *
 * Only unreserved URL characters are emitted, so a payload can live in a
 * query string or a fragment without further escaping. Decoding runs through
 * `Level.sanitizeLevel`, so a hostile or truncated code can never produce an
 * unsafe level object.
 *
 * Exposed as `ParkingGen.Share`.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});
    const FIELDS = 9;
    const CODE_VERSION = 1;
    const DIR_LETTERS = ['u', 'r', 'd', 'l'];         // matches Level.DIRECTIONS order
    const LETTER_DIRS = { u: 'up', r: 'right', d: 'down', l: 'left' };
    /** Query-string key used by `?level=…` share links. */
    const PARAM = 'level';

    /** Encode one text field, escaping the two structural separators too. */
    function encodeField(value) {
        return encodeURIComponent(String(value))
            .replace(/~/g, '%7E')
            .replace(/_/g, '%5F');
    }

    /**
     * Percent-decode one text field.
     *
     * Deliberately lenient: a code that travelled through a tool which
     * normalises escapes (some chat clients and URL parsers hand back the
     * *decoded* query value) is still usable, because the seed/name are
     * metadata only — the geometry lives in the other fields.
     */
    function decodeField(value, warnings) {
        try {
            return decodeURIComponent(value);
        } catch (_) {
            if (warnings) {
                warnings.push('A text field in the share link was not escaped correctly; used as-is.');
            }
            return value;
        }
    }

    function encodePoint(p) {
        return p[0] + '-' + p[1];
    }

    function decodePoint(text) {
        const parts = String(text).split('-');
        if (parts.length !== 2) throw new Error('Share code has a malformed coordinate.');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new Error('Share code has a non-numeric coordinate.');
        }
        return [x, y];
    }

    /**
     * Flatten a level into a share code.
     * @param {object} level
     * @returns {string} URL-safe payload.
     */
    function encodeLevel(level) {
        const cars = level.cars.map((car) => {
            const index = PG.Level.DIRECTIONS.indexOf(car.direction);
            return car.x + '-' + car.y + DIR_LETTERS[index === -1 ? 0 : index];
        }).join('_');

        return [
            CODE_VERSION,
            level.width + 'x' + level.height,
            level.difficulty,
            encodeField(level.seed),
            encodePoint(level.start),
            encodePoint(level.end),
            level.parkingLayout === 'columns' ? 'c' : 'r',
            encodeField(level.name || ''),
            cars
        ].join('~');
    }

    /**
     * Rebuild a level from a share code.
     * @param {string} code
     * @param {string[]} [warnings] Collector for repairs (see sanitizeLevel).
     * @returns {object} Sanitised level object.
     * @throws {Error} on malformed codes.
     */
    function decodeLevel(code, warnings) {
        if (typeof code !== 'string' || !code.trim()) {
            throw new Error('Share code is empty.');
        }
        warnings = warnings || [];
        const parts = code.trim().split('~');
        if (parts.length < FIELDS - 1) {
            throw new Error('Share code is incomplete or truncated.');
        }
        // Tolerate a payload whose trailing car list was dropped entirely.
        while (parts.length < FIELDS) parts.push('');

        const version = Number(parts[0]);
        if (version !== CODE_VERSION) {
            throw new Error(`Share code version ${parts[0]} is not supported.`);
        }

        const dims = String(parts[1]).split('x');
        if (dims.length !== 2) throw new Error('Share code has malformed dimensions.');

        const raw = {
            version: CODE_VERSION,
            width: Number(dims[0]),
            height: Number(dims[1]),
            difficulty: Number(parts[2]),
            seed: decodeField(parts[3], warnings),
            start: decodePoint(parts[4]),
            end: decodePoint(parts[5]),
            parkingLayout: parts[6] === 'c' ? 'columns' : 'rows',
            cars: []
        };

        const name = decodeField(parts[7], warnings);
        if (name) raw.name = name;

        const skipped = [];
        if (parts[8]) {
            for (const entry of parts[8].split('_')) {
                if (!entry) continue;
                try {
                    const dir = entry.slice(-1);
                    const coords = decodePoint(entry.slice(0, -1));
                    raw.cars.push({
                        x: coords[0],
                        y: coords[1],
                        direction: LETTER_DIRS[dir] || 'up'
                    });
                } catch (_) {
                    // One bad entry should never invalidate the whole level.
                    skipped.push(entry);
                }
            }
        }
        if (skipped.length) {
            warnings.push(
                `${skipped.length} car entr${skipped.length === 1 ? 'y' : 'ies'} in the share link could not be read and ${skipped.length === 1 ? 'was' : 'were'} skipped.`
            );
        }

        return PG.Level.sanitizeLevel(raw, warnings);
    }

    /**
     * Build a full share URL for a level.
     *
     * @param {object} level
     * @param {string} [baseUrl] Absolute page URL (defaults to the current one
     *   with any existing query/hash stripped).
     * @returns {string}
     */
    function buildShareUrl(level, baseUrl) {
        const base = baseUrl || (
            typeof global.location !== 'undefined'
                ? global.location.origin + global.location.pathname
                : ''
        );
        return base.replace(/[?#].*$/, '') + '?' + PARAM + '=' + encodeLevel(level);
    }

    /**
     * Read a level out of a URL's query string / fragment.
     *
     * Accepts `?level=<code>`, `#level=<code>` (and a bare `#<code>`).
     * Pure: pass the strings explicitly to keep it unit-testable.
     *
     * @param {string} search e.g. `location.search`
     * @param {string} hash e.g. `location.hash`
     * @returns {string|null} The raw share code, or null when absent.
     */
    function readCodeFromUrl(search, hash) {
        const fromSearch = new RegExp('[?&]' + PARAM + '=([^&]+)').exec(String(search || ''));
        if (fromSearch) return fromSearch[1];
        const rawHash = String(hash || '').replace(/^#/, '');
        if (!rawHash) return null;
        const fromHash = new RegExp('(?:^|&)' + PARAM + '=([^&]+)').exec(rawHash);
        if (fromHash) return fromHash[1];
        // A bare fragment is accepted only when it looks like a v1 code.
        return /^1~/.test(rawHash) ? rawHash : null;
    }

    /** Characters at which a share link becomes awkward to paste around. */
    const LONG_CODE_WARNING = 2000;

    PG.Share = {
        CODE_VERSION,
        PARAM,
        LONG_CODE_WARNING,
        encodeLevel,
        decodeLevel,
        buildShareUrl,
        readCodeFromUrl
    };
})(typeof window !== 'undefined' ? window : globalThis);
