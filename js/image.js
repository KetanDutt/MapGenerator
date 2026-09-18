/**
 * image.js — Render a level to a canvas so it can be exported as a PNG.
 *
 * The renderer mirrors the on-screen look of the app (asphalt lanes, rounded
 * cars with direction arrows, green **S** / red **E** markers, optional route
 * trace) and adds a caption strip with the level's key statistics — handy for
 * issue reports, design reviews and sharing a puzzle on social media.
 *
 * Split in two so the maths stays testable without a DOM:
 *   - `computeLayout(level, options)` → pure geometry (no canvas required)
 *   - `renderLevelToCanvas(level, options)` → draws with the 2D context
 *
 * Exposed as `ParkingGen.Image`.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});

    const DEFAULTS = {
        cellSize: 34,
        gap: 4,
        padding: 26,
        headerHeight: 58,
        footerHeight: 40,
        scale: 2,              // 2× = crisp on retina screens
        showRoute: true,
        caption: true,
        title: ''
    };

    /** Fallback palette (matches the app's light theme tokens). */
    const FALLBACK_PALETTE = {
        asphalt1: '#e8ebf1',
        asphalt2: '#dfe4ec',
        lotBg: '#f7f8fb',
        ink: '#181b23',
        inkSoft: '#4d5468',
        car1: '#4a7ef0',
        car2: '#2a55d8',
        start1: '#35a866',
        start2: '#1f854c',
        end1: '#e25a66',
        end2: '#c23a47',
        route: '#2e6bee',
        border: 'rgba(24, 27, 35, 0.10)'
    };

    function clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    /**
     * Pure geometry for a level image.
     *
     * @param {object} level
     * @param {object} [options] See DEFAULTS.
     * @returns {{cell:number, gap:number, pad:number, cols:number, rows:number,
     *   gridWidth:number, gridHeight:number, width:number, height:number,
     *   gridX:number, gridY:number, scale:number}}
     */
    function computeLayout(level, options) {
        const o = Object.assign({}, DEFAULTS, options || {});
        const cell = clampNumber(o.cellSize, 8, 128, DEFAULTS.cellSize);
        const gap = clampNumber(o.gap, 0, 24, DEFAULTS.gap);
        const pad = clampNumber(o.padding, 0, 120, DEFAULTS.padding);
        const cols = level.width;
        const rows = level.height;
        const gridWidth = cols * cell + (cols - 1) * gap;
        const gridHeight = rows * cell + (rows - 1) * gap;
        const header = o.caption ? clampNumber(o.headerHeight, 0, 200, DEFAULTS.headerHeight) : pad;
        const footer = o.caption ? clampNumber(o.footerHeight, 0, 200, DEFAULTS.footerHeight) : pad;

        return {
            cell,
            gap,
            pad,
            cols,
            rows,
            gridWidth,
            gridHeight,
            gridX: pad,
            gridY: header,
            width: Math.round(gridWidth + pad * 2),
            height: Math.round(gridHeight + header + footer),
            scale: clampNumber(o.scale, 1, 4, DEFAULTS.scale)
        };
    }

    /** Read the app's design tokens so the PNG matches the active theme. */
    function readThemePalette(root) {
        const palette = Object.assign({}, FALLBACK_PALETTE);
        if (!root || typeof global.getComputedStyle !== 'function') return palette;
        let styles;
        try {
            styles = global.getComputedStyle(root);
        } catch (_) {
            return palette;
        }
        if (!styles) return palette;
        const map = {
            asphalt1: '--asphalt-1',
            asphalt2: '--asphalt-2',
            ink: '--text-1',
            inkSoft: '--text-2',
            car1: '--car-1',
            car2: '--car-2',
            start1: '--start-1',
            start2: '--start-2',
            end1: '--end-1',
            end2: '--end-2',
            route: '--accent-1',
            border: '--line-1'
        };
        Object.keys(map).forEach((key) => {
            const value = styles.getPropertyValue(map[key]);
            if (value && value.trim()) palette[key] = value.trim();
        });
        return palette;
    }

    /** Rounded rectangle path (with a `roundRect` fast path when available). */
    function roundRect(ctx, x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, radius);
            return;
        }
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.arcTo(x + w, y, x + w, y + radius, radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
        ctx.lineTo(x + radius, y + h);
        ctx.arcTo(x, y + h, x, y + h - radius, radius);
        ctx.lineTo(x, y + radius);
        ctx.arcTo(x, y, x + radius, y, radius);
        ctx.closePath();
    }

    function fillRoundRect(ctx, x, y, w, h, r, fill) {
        roundRect(ctx, x, y, w, h, r);
        ctx.fillStyle = fill;
        ctx.fill();
    }

    function gradient(ctx, x, y, w, h, from, to) {
        const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
        g.addColorStop(0, from);
        g.addColorStop(1, to);
        return g;
    }

    /** Arrow glyph for a car's facing, drawn as a triangle in cell space. */
    function drawDirectionArrow(ctx, cx, cy, size, direction, color) {
        const s = size * 0.34;
        ctx.save();
        ctx.translate(cx, cy);
        if (direction === 'down') ctx.rotate(Math.PI);
        else if (direction === 'left') ctx.rotate(-Math.PI / 2);
        else if (direction === 'right') ctx.rotate(Math.PI / 2);

        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.72, s * 0.6);
        ctx.lineTo(0, s * 0.22);
        ctx.lineTo(-s * 0.72, s * 0.6);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }

    /**
     * Draw a level onto a fresh canvas.
     *
     * @param {object} level
     * @param {object} [options] DEFAULTS plus { palette, route }.
     *   `route` is the BFS path (array of [x, y]) drawn when `showRoute`.
     * @returns {?HTMLCanvasElement} null when canvas is unavailable.
     */
    function renderLevelToCanvas(level, options) {
        if (!level || typeof global.document === 'undefined') return null;
        const o = Object.assign({}, DEFAULTS, options || {});
        const L = computeLayout(level, o);
        const palette = Object.assign({}, FALLBACK_PALETTE, o.palette || {});

        const canvas = global.document.createElement('canvas');
        if (!canvas || typeof canvas.getContext !== 'function') return null;
        canvas.width = Math.round(L.width * L.scale);
        canvas.height = Math.round(L.height * L.scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.scale(L.scale, L.scale);

        // Card background.
        fillRoundRect(ctx, 0, 0, L.width, L.height, 18, palette.lotBg);
        ctx.strokeStyle = palette.border;
        ctx.lineWidth = 1;
        roundRect(ctx, 0.5, 0.5, L.width - 1, L.height - 1, 18);
        ctx.stroke();

        // Caption.
        if (o.caption) {
            ctx.fillStyle = palette.ink;
            ctx.font = '600 18px -apple-system, "Segoe UI", Roboto, sans-serif';
            ctx.textBaseline = 'middle';
            const title = String(o.title || level.name || 'Parking lot level');
            ctx.fillText(truncate(ctx, title, L.width - L.pad * 2), L.pad, 26);

            ctx.fillStyle = palette.inkSoft;
            ctx.font = '13px -apple-system, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(truncate(ctx, subtitleFor(level, o), L.width - L.pad * 2), L.pad, 44);
        }

        // Cells.
        const cellRadius = Math.max(2, L.cell * 0.22);
        for (let y = 0; y < L.rows; y++) {
            for (let x = 0; x < L.cols; x++) {
                const px = L.gridX + x * (L.cell + L.gap);
                const py = L.gridY + y * (L.cell + L.gap);
                const node = level.grid[y][x];
                const laneAlt = level.parkingLayout === 'rows' ? y % 2 === 1 : x % 2 === 1;

                if (node.type === 'car') {
                    fillRoundRect(ctx, px, py, L.cell, L.cell, cellRadius,
                        gradient(ctx, px, py, L.cell, L.cell, palette.car1, palette.car2));
                    drawDirectionArrow(ctx, px + L.cell / 2, py + L.cell / 2, L.cell,
                        node.direction, 'rgba(255, 255, 255, 0.95)');
                } else if (node.type === 'start' || node.type === 'end') {
                    const isStart = node.type === 'start';
                    fillRoundRect(ctx, px, py, L.cell, L.cell, cellRadius,
                        gradient(ctx, px, py, L.cell, L.cell,
                            isStart ? palette.start1 : palette.end1,
                            isStart ? palette.start2 : palette.end2));
                    ctx.fillStyle = '#ffffff';
                    ctx.font = `700 ${Math.round(L.cell * 0.44)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.fillText(isStart ? 'S' : 'E', px + L.cell / 2, py + L.cell / 2 + 1);
                    ctx.textAlign = 'left';
                } else {
                    fillRoundRect(ctx, px, py, L.cell, L.cell, cellRadius,
                        laneAlt ? palette.asphalt2 : palette.asphalt1);
                }
            }
        }

        // Route trace.
        const route = o.route;
        if (o.showRoute && Array.isArray(route) && route.length > 1) {
            ctx.save();
            ctx.strokeStyle = palette.route;
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = Math.max(3, L.cell * 0.22);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([L.cell * 0.42, L.cell * 0.34]);
            ctx.beginPath();
            route.forEach((point, i) => {
                const cx = L.gridX + point[0] * (L.cell + L.gap) + L.cell / 2;
                const cy = L.gridY + point[1] * (L.cell + L.gap) + L.cell / 2;
                if (i === 0) ctx.moveTo(cx, cy);
                else ctx.lineTo(cx, cy);
            });
            ctx.stroke();
            ctx.restore();
        }

        // Footer metrics.
        if (o.caption) {
            ctx.fillStyle = palette.inkSoft;
            ctx.font = '12px -apple-system, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(
                truncate(ctx, footerFor(level, o), L.width - L.pad * 2),
                L.pad,
                L.height - 20
            );
        }

        return canvas;
    }

    /** `"Long text…"` — trims to fit `maxWidth` with ellipsis. */
    function truncate(ctx, text, maxWidth) {
        const s = String(text);
        if (ctx.measureText(s).width <= maxWidth) return s;
        let cut = s.length;
        while (cut > 1 && ctx.measureText(s.slice(0, cut) + '…').width > maxWidth) cut--;
        return s.slice(0, cut) + '…';
    }

    function difficultyLabel(level) {
        if (PG.Level && typeof PG.Level.difficultyLabel === 'function') {
            return PG.Level.difficultyLabel(level.difficulty);
        }
        return 'Difficulty ' + level.difficulty;
    }

    function subtitleFor(level, o) {
        const total = level.width * level.height;
        const fill = total ? Math.round((level.cars.length / total) * 100) : 0;
        const steps = Array.isArray(o.route) && o.route.length ? o.route.length - 1 : null;
        return [
            `${level.width}×${level.height}`,
            `difficulty ${level.difficulty} (${difficultyLabel(level)})`,
            `${level.cars.length} cars · ${fill}% full`,
            steps === null ? 'no route' : `shortest route ${steps} steps`
        ].join('  ·  ');
    }

    function footerFor(level, o) {
        const parts = [
            `seed "${level.seed}"`,
            level.parkingLayout === 'columns' ? 'columns layout' : 'rows layout'
        ];
        if (o.branding !== false) parts.push('Parking Lot Level Generator');
        return parts.join('  ·  ');
    }

    /**
     * Convert a canvas to a PNG blob.
     * @param {HTMLCanvasElement} canvas
     * @returns {Promise<Blob>}
     */
    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            if (typeof canvas.toBlob === 'function') {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas could not be encoded as PNG.'));
                }, 'image/png');
                return;
            }
            // Very old browsers: fall back to a data URL.
            try {
                const dataUrl = canvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                const binary = global.atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                resolve(new Blob([bytes], { type: 'image/png' }));
            } catch (err) {
                reject(err);
            }
        });
    }

    PG.Image = {
        DEFAULTS,
        FALLBACK_PALETTE,
        computeLayout,
        readThemePalette,
        renderLevelToCanvas,
        canvasToBlob
    };
})(typeof window !== 'undefined' ? window : globalThis);
