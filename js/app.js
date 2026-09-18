/**
 * app.js — UI controller for the Parking Lot Level Generator.
 *
 * Wires the DOM to the level model (`ParkingGen.Level`), pathfinding
 * (`ParkingGen.Pathfinding`), the seeded RNG (`ParkingGen.RNG`), share codes
 * (`ParkingGen.Share`) and the PNG renderer (`ParkingGen.Image`).
 *
 * Design rules kept throughout:
 *
 *  1. **The model is the source of truth.** Every mutation goes through the
 *     helpers in the "Edit operations" section, which push an undo snapshot,
 *     update `level.cars`/`start`/`end`, repaint the affected cell(s) and let
 *     the scheduled sync pipeline refresh the stats, route and JSON preview.
 *  2. **Rendering is coalesced.** Pointer painting can fire dozens of edits
 *     per second; stats/pathfinding/JSON work is funnelled through one
 *     `requestAnimationFrame` pass (plus a throttled JSON refresh, which is
 *     skipped entirely while the JSON panel is collapsed).
 *  3. **Never trust the outside world.** Loaded files, share links and stored
 *     sessions all pass through `Level.sanitizeLevel`.
 *  4. **Motion is CSS.** JS only names the state (a class, a custom property);
 *     timings and easings live in the design tokens, so `prefers-reduced-motion`
 *     can switch the whole interface to a calm mode on its own.
 *
 * Exposed (for debugging/tests) as `window.ParkingGen.App`.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});
    const Level = PG.Level;
    const Pathfinding = PG.Pathfinding;
    const RNG = PG.RNG;
    const Share = PG.Share;
    const LevelImage = PG.Image;
    // The sprite is optional: without js/icons.js the app still runs, it just
    // loses its iconography.
    const Icons = PG.Icons || { svg: function () { return ''; } };

    /* ----------------------------- Constants -------------------------- */

    const STORAGE = {
        theme: 'plg-theme',
        session: 'plg-session'
    };
    const HISTORY_LIMIT = 60;        // undo steps kept in memory
    const JSON_THROTTLE_MS = 150;    // trailing refresh while painting
    const SESSION_DEBOUNCE_MS = 600; // localStorage write delay
    const MAX_FILE_BYTES = 8 * 1024 * 1024;
    const TOAST_DEDUPE_MS = 1200;
    const TOAST_LIFE_MS = 3400;      // matches --toast-life in css/style.css
    const TOAST_LIMIT = 4;           // oldest toast is dropped beyond this
    const SAMPLE = { width: 10, height: 10, difficulty: 5, seed: 'welcome' };
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2;
    const ZOOM_STEP = 0.1;

    const MODE_TEXT = {
        addCar: 'Adding cars — click empty cells',
        removeCar: 'Removing cars — click cars',
        setStart: 'Setting the start — click a cell',
        setEnd: 'Setting the exit — click a cell',
        rotateCar: 'Rotating cars — click a car to turn it'
    };

    /** Toast tone → sprite icon. */
    const TOAST_ICONS = {
        success: 'circle-check',
        error: 'circle-xmark',
        warning: 'triangle-exclamation',
        info: 'circle-info',
        question: 'circle-question'
    };

    /** Sections the compact mobile rail can jump to. */
    const SECTIONS = ['controlsPanel', 'workspace', 'statsSection', 'jsonPanel'];

    const MODE_BUTTONS = {
        addCar: 'addCarBtn',
        removeCar: 'removeCarBtn',
        rotateCar: 'rotateCarBtn',
        setStart: 'setStartBtn',
        setEnd: 'setEndBtn'
    };

    /* ------------------------------- State ---------------------------- */

    const state = {
        level: null,
        editMode: null,
        theme: 'light',
        zoom: 1,
        fitMode: true,
        painting: false,
        gesture: false,        // history grouping for drag-paint gestures
        cursor: null,          // { x, y } keyboard cursor, null when unused
        showRoute: false,
        includeGrid: true,
        steps: -1,             // shortest route length; -1 = blocked
        appliedRoute: new Set(),
        generating: false,
        initialized: false,
        lastStatus: null,
        lastToast: { key: '', at: 0 }
    };

    const history = { past: [], future: [] };
    let solver = null;
    let solverKey = '';
    let carSet = new Set();     // "x,y" of every car, for O(1) hit tests
    let jsonThrottle = null;
    let jsonDirty = true;
    let syncPending = false;
    let announceTimer = null;

    const els = {};

    /* --------------------------- Tiny helpers -------------------------- */

    const raf = typeof global.requestAnimationFrame === 'function'
        ? global.requestAnimationFrame.bind(global)
        : function (cb) { return global.setTimeout(cb, 16); };

    const key = (x, y) => x + ',' + y;

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    function debounce(fn, wait) {
        let timer = null;
        return function () {
            const args = arguments;
            clearTimeout(timer);
            timer = global.setTimeout(() => fn.apply(null, args), wait);
        };
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function cssColor(prop, fallback) {
        try {
            const value = global.getComputedStyle(global.document.documentElement)
                .getPropertyValue(prop);
            return value && value.trim() ? value.trim() : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function cssNumber(prop, fallback) {
        try {
            const value = parseFloat(global.getComputedStyle(global.document.documentElement)
                .getPropertyValue(prop));
            return Number.isFinite(value) ? value : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function cacheEls() {
        [
            'appHeader', 'levelForm', 'gridContainer', 'gridWrapper', 'gridHelp', 'genVeilText',
            'exportBtn', 'copyJsonBtn', 'pngBtn', 'shareBtn', 'seed', 'randomSeedBtn',
            'clearFileBtn', 'fileInput', 'jsonDisplay', 'jsonContent', 'jsonCount',
            'width', 'height', 'difficulty', 'guaranteePath', 'routeMode', 'themeToggle',
            'nameInput', 'widthValue', 'heightValue', 'difficultyValue',
            'addCarBtn', 'removeCarBtn', 'setStartBtn', 'setEndBtn', 'rotateCarBtn',
            'clearAllBtn', 'validateBtn', 'resizeBtn',
            'gridSizeStat', 'carCountStat', 'difficultyStat', 'startPosStat',
            'endPosStat', 'layoutStat', 'fillStat', 'routeStat', 'solvableStat', 'solvableBadge',
            'modeBanner', 'modeBannerText', 'cancelModeBtn',
            'zoomOut', 'zoomIn', 'zoomFit', 'zoomValue', 'undoBtn', 'redoBtn', 'routeToggleBtn',
            'toggleJsonBtn', 'includeGrid', 'dropOverlay', 'helpBtn', 'shortcutsLink', 'liveRegion',
            'toastHost', 'mobileNav', 'emptyAddCarBtn', 'genProgress'
        ].forEach((id) => { els[id] = global.document.getElementById(id); });
    }

    /* ----------------------------- Feedback --------------------------- */

    /**
     * Shared SweetAlert2 options. `backdrop` is themed here because the library
     * has no CSS variable for it; everything else is styled by `css/style.css`.
     */
    function swalConfig(extra) {
        const veil = state.theme === 'dark' ? 'rgba(4, 7, 14, 0.55)' : 'rgba(19, 24, 35, 0.38)';
        return Object.assign({ backdrop: veil }, extra || {});
    }

    /**
     * Toast notification.
     *
     * Rendered into `#toastHost` rather than SweetAlert2 so notifications share
     * the app's material language, stack in one place and are cheap to animate
     * (transform + opacity only). SweetAlert2 stays for dialogs, where its focus
     * trapping is genuinely useful.
     *
     * Identical messages fired within a second of each other are suppressed so
     * drag-painting over the same cell twice cannot stack up duplicate alerts.
     */
    function toast(icon, title, text) {
        const signature = icon + '|' + title + '|' + (text || '');
        const now = Date.now();
        if (state.lastToast.key === signature && now - state.lastToast.at < TOAST_DEDUPE_MS) return;
        state.lastToast = { key: signature, at: now };

        if (!els.toastHost) {
            console.log(`[${icon}] ${title}${text ? ' — ' + text : ''}`);
            return;
        }

        const node = global.document.createElement('div');
        node.className = `toast glass-3 toast--${TOAST_ICONS[icon] ? icon : 'info'}`;
        node.style.setProperty('--toast-life', TOAST_LIFE_MS + 'ms');
        node.setAttribute('role', icon === 'error' ? 'alert' : 'status');
        node.innerHTML =
            `<span class="toast__icon">${Icons.svg(TOAST_ICONS[icon] || TOAST_ICONS.info)}</span>` +
            '<span class="toast__body">' +
            `<span class="toast__title">${escapeHtml(title)}</span>` +
            (text ? `<span class="toast__text">${escapeHtml(text)}</span>` : '') +
            '</span>' +
            `<button class="toast__close" type="button" aria-label="Dismiss">${Icons.svg('xmark')}</button>` +
            '<span class="toast__bar" aria-hidden="true"></span>';

        let timer = null;
        const detach = () => {
            if (node.parentNode) node.parentNode.removeChild(node);
        };
        const dismiss = () => {
            clearTimeout(timer);
            node.classList.add('is-leaving');
            global.setTimeout(detach, 220);
        };
        const arm = (ms) => {
            clearTimeout(timer);
            timer = global.setTimeout(dismiss, ms);
        };

        node.querySelector('.toast__close').addEventListener('click', dismiss);
        // Hovering pauses the countdown (and the progress bar, via CSS).
        node.addEventListener('mouseenter', () => clearTimeout(timer));
        node.addEventListener('mouseleave', () => arm(900));

        els.toastHost.appendChild(node);
        while (els.toastHost.children.length > TOAST_LIMIT) {
            els.toastHost.removeChild(els.toastHost.children[0]);
        }
        arm(TOAST_LIFE_MS);
        return node;
    }

    function confirmDialog(opts) {
        if (global.Swal) {
            return global.Swal.fire(swalConfig(Object.assign({
                showCancelButton: true, confirmButtonText: 'Confirm', cancelButtonText: 'Cancel'
            }, opts))).then((r) => r.isConfirmed);
        }
        return Promise.resolve(global.confirm(opts.text || opts.title || 'Are you sure?'));
    }

    /** Announce a change to assistive technology (throttled). */
    function announce(message) {
        if (!els.liveRegion) return;
        clearTimeout(announceTimer);
        announceTimer = global.setTimeout(() => {
            els.liveRegion.textContent = message;
        }, 120);
    }

    /* ------------------------------ Theme ----------------------------- */

    function applyTheme(next) {
        state.theme = next === 'dark' ? 'dark' : 'light';
        global.document.documentElement.setAttribute('data-theme', state.theme);
        els.themeToggle.innerHTML = state.theme === 'dark'
            ? '<svg class="icon" aria-hidden="true"><use href="#i-sun"></use></svg>'
            : '<svg class="icon" aria-hidden="true"><use href="#i-moon"></use></svg>';
        const label = state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        els.themeToggle.title = label;
        els.themeToggle.setAttribute('aria-label', label);

        // Keep the browser chrome in step with the app on mobile.
        const meta = global.document.querySelector && global.document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', cssColor('--bg-0', state.theme === 'dark' ? '#0a0b0f' : '#f7f8fb'));
        try {
            global.localStorage.setItem(STORAGE.theme, state.theme);
        } catch (_) { /* private mode / storage disabled */ }
    }

    function initTheme() {
        let saved = null;
        try { saved = global.localStorage.getItem(STORAGE.theme); } catch (_) { /* ignore */ }
        if (saved === 'dark' || saved === 'light') {
            applyTheme(saved);
        } else if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) {
            applyTheme('dark');
        } else {
            applyTheme('light');
        }
    }

    /* ----------------------------- Sliders ---------------------------- */

    /** Paint the filled portion of a range track (WebKit uses --fill). */
    function paintSliderFill(el) {
        const min = parseFloat(el.min) || 0;
        const max = parseFloat(el.max) || 1;
        const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
        el.style.setProperty('--fill', pct + '%');
    }

    function updateSliderLabels() {
        els.widthValue.textContent = els.width.value;
        els.heightValue.textContent = els.height.value;
        els.difficultyValue.textContent = Level.difficultyLabel(parseInt(els.difficulty.value, 10));
        ['width', 'height', 'difficulty'].forEach((k) => paintSliderFill(els[k]));
    }

    /* --------------------------- Level helpers ------------------------- */

    function rebuildCarIndex() {
        carSet = new Set(state.level.cars.map((c) => key(c.x, c.y)));
    }

    function hasCar(x, y) {
        return carSet.has(key(x, y));
    }

    function isStart(x, y) {
        return state.level.start[0] === x && state.level.start[1] === y;
    }

    function isEnd(x, y) {
        return state.level.end[0] === x && state.level.end[1] === y;
    }

    function getSolver() {
        const dimensions = state.level.width + 'x' + state.level.height;
        if (!solver || solverKey !== dimensions) {
            solver = Pathfinding.createSolver(state.level.width, state.level.height);
            solverKey = dimensions;
        }
        return solver;
    }

    /** Shortest route as a cell list, or null when blocked. */
    function currentRoute() {
        if (!state.level) return null;
        return Pathfinding.findShortestPath(
            state.level, state.level.start, state.level.end, getSolver().workspace);
    }

    /* ---------------------------- Rendering ---------------------------- */

    function cellAt(x, y) {
        return els.gridContainer.children[y * state.level.width + x] || null;
    }

    function isRouteCell(x, y) {
        return state.appliedRoute.has(key(x, y));
    }

    function describeCell(x, y) {
        const node = state.level.grid[y][x];
        if (node.type === 'start') return `start at ${x}, ${y}`;
        if (node.type === 'end') return `exit at ${x}, ${y}`;
        if (node.type === 'car') return `car at ${x}, ${y} facing ${node.direction}`;
        return `empty at ${x}, ${y}`;
    }

    /** Full (re)build of the grid DOM — used after generate/load/undo/clear. */
    function renderGrid() {
        const level = state.level;
        const frag = global.document.createDocumentFragment();
        let i = 0;
        for (let y = 0; y < level.height; y++) {
            for (let x = 0; x < level.width; x++) {
                const cell = global.document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                cell.style.setProperty('--i', i++);   // staggered entrance delay
                paintCell(cell, x, y);
                frag.appendChild(cell);
            }
        }

        els.gridContainer.innerHTML = '';
        els.gridContainer.style.setProperty('--cols', level.width);
        els.gridContainer.setAttribute('role', 'grid');
        els.gridContainer.setAttribute('aria-label',
            `Parking lot grid, ${level.width} by ${level.height}`);
        els.gridContainer.appendChild(frag);

        // The DOM was rebuilt, so nothing is decorated yet.
        state.appliedRoute = new Set();
        if (state.cursor) applyCursorCell(state.cursor.x, state.cursor.y);

        // One-shot staggered entrance, disarmed after the animation window.
        els.gridContainer.classList.remove('enter');
        void els.gridContainer.offsetWidth;
        els.gridContainer.classList.add('enter');
        clearTimeout(renderGrid._enterTimer);
        renderGrid._enterTimer = global.setTimeout(
            () => els.gridContainer.classList.remove('enter'), 1400);
    }

    /** Update a single cell in place (used by every edit operation). */
    function updateCell(x, y) {
        const cell = cellAt(x, y);
        if (!cell) return;
        paintCell(cell, x, y);
        cell.classList.remove('pulse');
        void cell.offsetWidth;      // restart the animation
        cell.classList.add('pulse');
    }

    function paintCell(cell, x, y) {
        const level = state.level;
        const node = level.grid[y][x];
        const classes = ['cell'];

        // Alternate lane shading so the parking layout reads clearly.
        if (level.parkingLayout === 'rows') {
            if (y % 2 === 1) classes.push('lane-alt');
        } else if (x % 2 === 1) {
            classes.push('lane-alt');
        }

        let label;
        if (node.type === 'start') {
            classes.push('start');
            label = `Start (${x}, ${y})`;
        } else if (node.type === 'end') {
            classes.push('end');
            label = `Exit (${x}, ${y})`;
        } else if (node.type === 'car') {
            classes.push('car', node.direction);
            label = `Car (${x}, ${y}) facing ${node.direction}`;
        } else {
            label = `Empty (${x}, ${y})`;
        }

        if (state.cursor && state.cursor.x === x && state.cursor.y === y) classes.push('cursor');
        if (isRouteCell(x, y)) classes.push('on-route');

        cell.className = classes.join(' ');
        cell.title = label;
        cell.setAttribute('aria-label', label);
        cell.setAttribute('role', 'gridcell');
    }

    /** Highlight/dim the route overlay by diffing against the applied set. */
    function applyRoute(nextSet) {
        const previous = state.appliedRoute;
        const next = nextSet || new Set();

        previous.forEach((k) => {
            if (!next.has(k)) {
                const [x, y] = k.split(',').map(Number);
                const cell = cellAt(x, y);
                if (cell) cell.classList.remove('on-route');
            }
        });
        next.forEach((k) => {
            if (!previous.has(k)) {
                const [x, y] = k.split(',').map(Number);
                const cell = cellAt(x, y);
                if (cell) cell.classList.add('on-route');
            }
        });
        state.appliedRoute = next;
    }

    /* ------------------------------ Sync ------------------------------- */

    function formatKb(bytes) {
        return (bytes / 1024).toFixed(1) + ' KB';
    }

    function refreshJson() {
        if (!state.level) return;
        // Collapsed panels cost nothing: mark dirty and refresh on re-open.
        if (els.jsonDisplay.classList.contains('d-none')) {
            jsonDirty = true;
            return;
        }
        const text = Level.serializeLevel(state.level, { includeGrid: state.includeGrid });
        els.jsonContent.textContent = text;
        els.jsonCount.textContent = formatKb(text.length);
        jsonDirty = false;
    }

    function scheduleJson() {
        jsonDirty = true;
        if (jsonThrottle) return;
        jsonThrottle = global.setTimeout(() => {
            jsonThrottle = null;
            if (jsonDirty) refreshJson();
        }, JSON_THROTTLE_MS);
    }

    /** Coalesce view updates into one animation frame. */
    function scheduleViewSync() {
        if (syncPending) return;
        syncPending = true;
        raf(() => {
            syncPending = false;
            flushView();
        });
    }

    function flushView() {
        if (!state.level) return;
        refreshStats();
        refreshRoute();
        scheduleJson();
        updateActionStates();
        scheduleSessionSave();
    }

    /**
     * Write a stat value, nudging it only when it actually changed. The text is
     * always the exact value (screen readers and tests read it directly); the
     * animation is a CSS class layered on top.
     *
     * Two alternating classes restart the nudge instead of the usual
     * "remove, read offsetWidth, re-add" trick — which would force a style and
     * layout pass for every changed stat inside the render frame.
     */
    function setStat(el, value) {
        if (!el || el.textContent === value) return;
        el.textContent = value;
        const next = el.classList.contains('bump') ? 'bump-alt' : 'bump';
        el.classList.remove('bump', 'bump-alt');
        el.classList.add(next);
    }

    function refreshStats() {
        const level = state.level;
        const total = level.width * level.height;

        setStat(els.gridSizeStat, `${level.width}×${level.height}`);
        setStat(els.carCountStat, String(level.cars.length));
        setStat(els.fillStat, Math.round((level.cars.length / total) * 100) + '%');
        setStat(els.difficultyStat, `${level.difficulty} · ${Level.difficultyLabel(level.difficulty)}`);
        setStat(els.startPosStat, `(${level.start[0]}, ${level.start[1]})`);
        setStat(els.endPosStat, `(${level.end[0]}, ${level.end[1]})`);
        setStat(els.layoutStat, level.parkingLayout === 'rows' ? 'Rows' : 'Columns');

        state.steps = Pathfinding.shortestPathLength(
            level, level.start, level.end, getSolver().workspace);
        const solvable = state.steps >= 0;

        setStat(els.routeStat, solvable
            ? `${state.steps} step${state.steps === 1 ? '' : 's'}`
            : 'Blocked');
        els.solvableStat.textContent = solvable ? 'Solvable' : 'Blocked';
        els.solvableBadge.classList.toggle('badge-ok', solvable);
        els.solvableBadge.classList.toggle('badge-bad', !solvable);

        // A blocked level gets an unmistakable export button + a one-off alert.
        els.exportBtn.classList.toggle('btn--danger-state', !solvable);
        els.gridWrapper.classList.toggle('is-empty', level.cars.length === 0);
        els.gridContainer.setAttribute('aria-label',
            `Parking lot grid, ${level.width} by ${level.height}, ` +
            `${level.cars.length} cars, ${solvable ? 'solvable' : 'blocked'}`);

        if (state.lastStatus !== null && state.lastStatus !== solvable) {
            announce(solvable
                ? 'The level is solvable again.'
                : 'The level is blocked: no route from start to exit.');
        }
        state.lastStatus = solvable;
    }

    function refreshRoute() {
        const showRoute = state.showRoute && state.steps >= 0;
        const path = showRoute ? currentRoute() : null;
        applyRoute(path ? new Set(path.map((p) => key(p[0], p[1]))) : null);
        els.routeToggleBtn.classList.toggle('is-active', state.showRoute);
        els.routeToggleBtn.setAttribute('aria-pressed', String(state.showRoute));
    }

    function updateActionStates() {
        els.undoBtn.disabled = history.past.length === 0;
        els.redoBtn.disabled = history.future.length === 0;
    }

    /* ----------------------------- History ----------------------------- */

    function snapshot() {
        return Level.serializeLevel(state.level, { includeGrid: false, pretty: false });
    }

    function clearHistory() {
        history.past.length = 0;
        history.future.length = 0;
        updateActionStates();
    }

    /** Record the current state *before* a mutation. */
    function pushHistory(label) {
        history.past.push({ snap: snapshot(), label });
        if (history.past.length > HISTORY_LIMIT) history.past.shift();
        history.future.length = 0;
        updateActionStates();
    }

    /** Group every mutation of one drag gesture into a single undo step. */
    function beginGesture(label) {
        if (state.gesture) return;
        state.gesture = true;
        pushHistory(label);
    }

    function endGesture() {
        state.gesture = false;
    }

    function record(label, opts) {
        if (opts && opts.gesture) beginGesture(label);
        else pushHistory(label);
    }

    function restoreSnapshot(entry, direction) {
        let next;
        try {
            next = Level.sanitizeLevel(JSON.parse(entry.snap), []);
        } catch (err) {
            console.error('History restore failed:', err);
            toast('error', 'Could not restore', 'The undo history entry was invalid.');
            return;
        }
        state.level = next;
        rebuildCarIndex();
        state.cursor = null;
        syncFormFromLevel();
        renderGrid();
        flushView();
        refreshJson();
        announce(`${direction} ${entry.label}.`);
    }

    function undo() {
        if (!history.past.length) return;
        const entry = history.past.pop();
        history.future.push({ snap: snapshot(), label: entry.label });
        restoreSnapshot(entry, 'Undid');
        toast('info', 'Undo', entry.label);
    }

    function redo() {
        if (!history.future.length) return;
        const entry = history.future.pop();
        history.past.push({ snap: snapshot(), label: entry.label });
        restoreSnapshot(entry, 'Redid');
        toast('info', 'Redo', entry.label);
    }

    /* -------------------------- Edit operations ------------------------ */

    function addCar(x, y, opts) {
        if (hasCar(x, y) || isStart(x, y) || isEnd(x, y)) {
            toast('error', 'Occupied', 'That cell already has a car, the start or the exit.');
            return false;
        }
        record('add a car', opts);
        const direction = Level.defaultDirection(state.level.parkingLayout, x, y);
        state.level.cars.push({ x, y, direction });
        state.level.grid[y][x] = { type: 'car', direction };
        carSet.add(key(x, y));
        updateCell(x, y);
        scheduleViewSync();
        if (!opts || !opts.quiet) announce(`Car added at ${x}, ${y}, facing ${direction}.`);
        return true;
    }

    function removeCar(x, y, opts) {
        const index = Level.carIndexAt(state.level, x, y);
        if (index === -1) return false;
        record('remove a car', opts);
        state.level.cars.splice(index, 1);
        state.level.grid[y][x] = { type: 'empty' };
        carSet.delete(key(x, y));
        updateCell(x, y);
        scheduleViewSync();
        if (!opts || !opts.quiet) announce(`Car removed from ${x}, ${y}.`);
        return true;
    }

    function rotateCar(x, y, opts) {
        const index = Level.carIndexAt(state.level, x, y);
        if (index === -1) {
            toast('error', 'No car there', 'Pick a cell that contains a car.');
            return false;
        }
        record('rotate a car', opts);
        const dirs = Level.DIRECTIONS;
        const car = state.level.cars[index];
        car.direction = dirs[(dirs.indexOf(car.direction) + 1) % dirs.length];
        state.level.grid[y][x] = { type: 'car', direction: car.direction };
        updateCell(x, y);
        scheduleViewSync();
        if (!opts || !opts.quiet) announce(`Car at ${x}, ${y} now faces ${car.direction}.`);
        return true;
    }

    function setStart(x, y, opts) {
        if (hasCar(x, y) || isEnd(x, y)) {
            toast('error', 'Cannot set start', 'Choose an empty cell that is not the exit.');
            return false;
        }
        if (isStart(x, y)) return false;
        record('move the start', opts);
        const [ox, oy] = state.level.start;
        state.level.grid[oy][ox] = { type: 'empty' };
        state.level.start = [x, y];
        state.level.grid[y][x] = { type: 'start' };
        updateCell(ox, oy);
        updateCell(x, y);
        scheduleViewSync();
        announce(`Start moved to ${x}, ${y}.`);
        return true;
    }

    function setEnd(x, y, opts) {
        if (hasCar(x, y) || isStart(x, y)) {
            toast('error', 'Cannot set exit', 'Choose an empty cell that is not the start.');
            return false;
        }
        if (isEnd(x, y)) return false;
        record('move the exit', opts);
        const [ox, oy] = state.level.end;
        state.level.grid[oy][ox] = { type: 'empty' };
        state.level.end = [x, y];
        state.level.grid[y][x] = { type: 'end' };
        updateCell(ox, oy);
        updateCell(x, y);
        scheduleViewSync();
        announce(`Exit moved to ${x}, ${y}.`);
        return true;
    }

    /** Apply the active tool to a cell. */
    function applyEdit(x, y, opts) {
        switch (state.editMode) {
            case 'addCar': return addCar(x, y, opts);
            case 'removeCar': return removeCar(x, y, opts);
            case 'setStart': return setStart(x, y, opts);
            case 'setEnd': return setEnd(x, y, opts);
            case 'rotateCar': return rotateCar(x, y, opts);
            default: return false;
        }
    }

    /* --------------------------- Edit mode ---------------------------- */

    function setEditMode(mode) {
        state.editMode = state.editMode === mode ? null : mode;
        Object.keys(MODE_BUTTONS).forEach((m) => {
            const btn = els[MODE_BUTTONS[m]];
            const active = m === state.editMode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        els.gridContainer.classList.toggle('editing', state.editMode !== null);
        if (state.editMode) {
            els.modeBannerText.textContent = MODE_TEXT[state.editMode];
            els.modeBanner.classList.remove('d-none');
            announce(MODE_TEXT[state.editMode]);
        } else {
            els.modeBanner.classList.add('d-none');
        }
    }

    /* --------------------------- Pointer input ------------------------- */

    function cellFromEvent(event) {
        const target = event.target;
        if (target && target.classList && target.classList.contains('cell')) {
            return {
                x: parseInt(target.dataset.x, 10),
                y: parseInt(target.dataset.y, 10)
            };
        }
        return null;
    }

    function onGridPointerDown(event) {
        if (!state.level) return;
        const hit = cellFromEvent(event);
        if (!hit) return;

        // No tool selected: use the click to place the keyboard cursor instead,
        // which keeps click-only users oriented without surprising edits.
        if (!state.editMode) {
            setCursor(hit.x, hit.y, { announce: true });
            return;
        }

        state.painting = true;
        endGesture();
        applyEdit(hit.x, hit.y, { gesture: true });
        event.preventDefault();
    }

    function onGridPointerMove(event) {
        if (!state.painting || !state.editMode) return;
        if (state.editMode !== 'addCar' && state.editMode !== 'removeCar') return;

        let clientX = event.clientX;
        let clientY = event.clientY;
        if (event.touches && event.touches.length) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        }
        const el = global.document.elementFromPoint(clientX, clientY);
        if (el && el.classList && el.classList.contains('cell')) {
            const x = parseInt(el.dataset.x, 10);
            const y = parseInt(el.dataset.y, 10);
            if (state.editMode === 'addCar') {
                if (!hasCar(x, y) && !isStart(x, y) && !isEnd(x, y)) {
                    applyEdit(x, y, { gesture: true, quiet: true });
                }
            } else if (hasCar(x, y)) {
                applyEdit(x, y, { gesture: true, quiet: true });
            }
        }
        event.preventDefault();
    }

    function onGridPointerUp() {
        state.painting = false;
        endGesture();
    }

    /* --------------------------- Keyboard nav -------------------------- */

    function setCursor(x, y, opts) {
        const o = opts || {};
        if (!state.level) return;
        const nx = clamp(x, 0, state.level.width - 1);
        const ny = clamp(y, 0, state.level.height - 1);
        if (state.cursor) {
            const previous = cellAt(state.cursor.x, state.cursor.y);
            if (previous) {
                previous.classList.remove('cursor');
                previous.removeAttribute('id');
            }
        }
        state.cursor = { x: nx, y: ny };
        applyCursorCell(nx, ny);
        if (o.scroll !== false) {
            const cell = cellAt(nx, ny);
            if (cell && typeof cell.scrollIntoView === 'function') {
                cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        }
        if (o.announce) announce(describeCell(nx, ny) + '.');
        else if (o.quiet !== true) announce(`${describeCell(nx, ny)}.`);
    }

    function applyCursorCell(x, y) {
        const cell = cellAt(x, y);
        if (!cell) return;
        cell.classList.add('cursor');
        cell.id = 'pg-cursor';
        els.gridContainer.setAttribute('aria-activedescendant', 'pg-cursor');
    }

    function moveCursor(dx, dy) {
        const base = state.cursor || { x: 0, y: 0 };
        setCursor(base.x + dx, base.y + dy, {});
    }

    function onGridKeyDown(event) {
        if (!state.level || event.altKey || event.ctrlKey || event.metaKey) return;
        const step = event.shiftKey ? 5 : 1;
        let handled = true;

        switch (event.key) {
            case 'ArrowLeft': moveCursor(-step, 0); break;
            case 'ArrowRight': moveCursor(step, 0); break;
            case 'ArrowUp': moveCursor(0, -step); break;
            case 'ArrowDown': moveCursor(0, step); break;
            case 'Home': setCursor(state.level.start[0], state.level.start[1], {}); break;
            case 'End': setCursor(state.level.end[0], state.level.end[1], {}); break;
            case 'Enter':
            case ' ':
            case 'Spacebar':
                if (state.editMode) {
                    applyEdit(state.cursor ? state.cursor.x : state.level.start[0],
                        state.cursor ? state.cursor.y : state.level.start[1], {});
                } else {
                    toast('info', 'No tool selected', 'Pick an edit tool, then press Enter on a cell.');
                }
                break;
            case 'Delete':
            case 'Backspace':
                if (state.cursor) {
                    if (!removeCar(state.cursor.x, state.cursor.y, {})) {
                        toast('info', 'Nothing to remove', 'That cell has no car.');
                    }
                }
                break;
            case 'r':
            case 'R':
                if (state.cursor) rotateCar(state.cursor.x, state.cursor.y, {});
                break;
            default:
                handled = false;
        }
        if (handled) event.preventDefault();
    }

    /* ------------------------- Global shortcuts ------------------------ */

    function isTypingTarget(target) {
        if (!target) return false;
        const tag = (target.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    }

    function onDocumentKeyDown(event) {
        const typing = isTypingTarget(event.target);
        const mod = event.ctrlKey || event.metaKey;

        if (mod && (event.key === 'z' || event.key === 'Z')) {
            event.preventDefault();
            if (event.shiftKey) redo(); else undo();
            return;
        }
        if (mod && (event.key === 'y' || event.key === 'Y')) {
            event.preventDefault();
            redo();
            return;
        }
        if (mod && (event.key === 's' || event.key === 'S')) {
            if (typing) return;   // let the browser's save dialog win inside fields
            event.preventDefault();
            exportJson();
            return;
        }
        if (typing || mod) return;

        switch (event.key) {
            case 'Escape':
                if (state.editMode) setEditMode(null);
                break;
            case '?':
                event.preventDefault();
                showShortcuts();
                break;
            case 'g':
            case 'G':
                event.preventDefault();
                generate();
                break;
            case 'd':
            case 'D':
                applyTheme(state.theme === 'dark' ? 'light' : 'dark');
                break;
            case '0':
                fitZoom();
                break;
            case '+':
            case '=':
                zoomBy(ZOOM_STEP);
                break;
            case '-':
            case '_':
                zoomBy(-ZOOM_STEP);
                break;
            case '1': case '2': case '3': case '4': case '5': {
                const mode = Object.keys(MODE_BUTTONS)[Number(event.key) - 1];
                if (mode) setEditMode(mode);
                break;
            }
            default:
                break;
        }
    }

    function showShortcuts() {
        const rows = [
            ['Ctrl/Cmd + Z', 'Undo'],
            ['Ctrl/Cmd + Shift + Z', 'Redo'],
            ['Ctrl/Cmd + S', 'Export JSON'],
            ['G', 'Generate a new level'],
            ['1 … 5', 'Select an edit tool'],
            ['Click + drag', 'Paint or erase many cars'],
            ['Arrow keys', 'Move the grid cursor (Shift = 5 cells)'],
            ['Enter / Space', 'Apply the active tool at the cursor'],
            ['Delete', 'Remove the car under the cursor'],
            ['R', 'Rotate the car under the cursor'],
            ['Home / End', 'Jump to the start / exit cell'],
            ['+ / −', 'Zoom in / out'],
            ['0', 'Fit the grid to the view'],
            ['D', 'Toggle dark mode'],
            ['Esc', 'Cancel the active tool'],
            ['?', 'Show this list']
        ];
        const html = '<div class="kbd-table-wrap"><table class="kbd-table"><tbody>' +
            rows.map((row) => `<tr><th><kbd>${escapeHtml(row[0])}</kbd></th><td>${escapeHtml(row[1])}</td></tr>`).join('') +
            '</tbody></table></div>';

        if (global.Swal) {
            global.Swal.fire(swalConfig({
                title: 'Keyboard shortcuts',
                html,
                width: 460,
                confirmButtonText: 'Got it'
            }));
        } else {
            alert(rows.map((r) => r[0] + ' — ' + r[1]).join('\n'));
        }
    }

    /* ---------------------------- Generation --------------------------- */

    function setGenerating(on) {
        state.generating = on;
        els.levelForm.classList.toggle('loading', on);
        els.gridWrapper.classList.toggle('is-generating', on);
        if (els.genProgress) els.genProgress.style.setProperty('--v', on ? 0 : 1);
        const submitBtn = els.levelForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = on;
    }

    /** Drive the veil's progress bar from the generator's progress callback. */
    function reportProgress(fraction) {
        const value = clamp(Number(fraction) || 0, 0, 1);
        if (els.genProgress) els.genProgress.style.setProperty('--v', value.toFixed(3));
        els.genVeilText.textContent = value >= 1
            ? 'Preparing the lot…'
            : `Generating level… ${Math.round(value * 100)}%`;
    }

    function generate() {
        if (state.generating || !state.level) return;
        const width = parseInt(els.width.value, 10);
        const height = parseInt(els.height.value, 10);
        const difficulty = parseInt(els.difficulty.value, 10);
        const seed = els.seed.value.trim() || RNG.randomSeed();
        const name = Level.sanitizeName(els.nameInput.value);
        const guaranteePath = els.guaranteePath.checked;
        const route = els.routeMode.value;

        els.seed.value = seed;
        setGenerating(true);
        els.genVeilText.textContent = 'Generating level…';
        announce('Generating a new level.');

        // Defer one tick so the loading state can paint before the work.
        global.setTimeout(() => {
            try {
                const next = Level.generateLevel(width, height, difficulty, seed, guaranteePath, {
                    route,
                    name,
                    onProgress: reportProgress
                });
                applyLevel(next, { resetHistory: true, fit: true });
                const steps = state.steps;
                const summary = `${next.width}×${next.height} · ${next.cars.length} cars · ` +
                    `${steps >= 0 ? steps + ' step route' : 'blocked'} · seed “${seed}”`;
                toast('success', 'Level generated', summary);
                announce(`Level generated. ${summary}`);
            } catch (err) {
                console.error('Generation failed:', err);
                toast('error', 'Generation failed', err.message || 'Unexpected error.');
            } finally {
                setGenerating(false);
                els.genVeilText.textContent = 'Generating level…';
            }
        }, 60);
    }

    /* --------------------------- Level lifecycle ------------------------ */

    function syncFormFromLevel() {
        const level = state.level;
        els.width.value = level.width;
        els.height.value = level.height;
        els.difficulty.value = level.difficulty;
        els.seed.value = level.seed;
        els.nameInput.value = level.name || '';
        updateSliderLabels();
    }

    function setActionButtonsEnabled(on) {
        ['exportBtn', 'copyJsonBtn', 'pngBtn', 'shareBtn'].forEach((id) => {
            els[id].disabled = !on;
        });
    }

    /**
     * Install a level as the current document.
     * @param {object} next Sanitised level.
     * @param {object} [opts] { resetHistory, fit, quiet }
     */
    function applyLevel(next, opts) {
        const o = opts || {};
        state.level = next;
        rebuildCarIndex();
        state.cursor = null;
        state.lastStatus = null;
        if (o.resetEditMode !== false) setEditMode(null);
        if (o.resetHistory) clearHistory();
        syncFormFromLevel();
        renderGrid();
        flushView();
        refreshJson();
        setActionButtonsEnabled(true);
        if (o.fit) fitZoom();
        scheduleSessionSave();
    }

    function clearAll() {
        if (!state.level) return;
        confirmDialog({
            icon: 'warning',
            title: 'Clear the parking lot?',
            text: 'All cars are removed and the start/exit reset to opposite corners. You can undo this.',
            confirmButtonText: 'Yes, clear it'
        }).then((ok) => {
            if (!ok) return;
            pushHistory('clear the lot');
            state.level.cars = [];
            state.level.start = [0, 0];
            state.level.end = [state.level.width - 1, state.level.height - 1];
            if (state.level.end[0] === 0 && state.level.end[1] === 0) {
                state.level.end = Level.differentCell(state.level.start,
                    state.level.width, state.level.height);
            }
            state.level.grid = Level.rebuildGrid(state.level);
            rebuildCarIndex();
            renderGrid();
            flushView();
            refreshJson();
            announce('The parking lot has been cleared.');
            toast('success', 'Cleared', 'The parking lot has been reset.');
        });
    }

    /* ------------------------------ Resize ------------------------------ */

    function openResizeDialog() {
        if (!state.level) return;
        const level = state.level;
        const min = Level.MIN_SIZE;
        const max = Level.MAX_SIZE;

        if (global.Swal) {
            global.Swal.fire(swalConfig({
                title: 'Resize grid',
                html: '<div class="resize-form">' +
                    `<label for="swalWidth">Width (${min}–${max})</label>` +
                    `<input id="swalWidth" type="number" class="swal2-input" min="${min}" max="${max}" value="${level.width}">` +
                    `<label for="swalHeight">Height (${min}–${max})</label>` +
                    `<input id="swalHeight" type="number" class="swal2-input" min="${min}" max="${max}" value="${level.height}">` +
                    '<p class="resize-form__hint">Cars outside the new grid are dropped; the start and exit ' +
                    'move inside if needed.</p></div>',
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'Resize',
                preConfirm: () => {
                    const w = parseInt(global.document.getElementById('swalWidth').value, 10);
                    const h = parseInt(global.document.getElementById('swalHeight').value, 10);
                    if (!Number.isFinite(w) || !Number.isFinite(h) ||
                        w < min || w > max || h < min || h > max) {
                        global.Swal.showValidationMessage(`Width and height must be between ${min} and ${max}.`);
                        return false;
                    }
                    return { w, h };
                }
            })).then((result) => {
                if (result.isConfirmed && result.value) resizeLevelTo(result.value.w, result.value.h);
            });
            return;
        }

        // No SweetAlert2: fall back to native prompts.
        const w = parseInt(global.prompt(`New width (${min}–${max})`, String(level.width)), 10);
        if (!Number.isFinite(w)) return;
        const h = parseInt(global.prompt(`New height (${min}–${max})`, String(level.height)), 10);
        if (!Number.isFinite(h)) return;
        resizeLevelTo(w, h);
    }

    function resizeLevelTo(width, height) {
        const before = state.level;
        if (width === before.width && height === before.height) return;
        pushHistory('resize the grid');
        const result = Level.resizeLevel(before, width, height);
        state.level = result.level;
        rebuildCarIndex();
        state.cursor = null;
        syncFormFromLevel();
        renderGrid();
        flushView();
        refreshJson();
        fitZoom();
        const note = result.dropped
            ? ` ${result.dropped} car${result.dropped === 1 ? '' : 's'} no longer fit and were removed.`
            : '';
        toast('success', 'Grid resized', `${width}×${height}.${note}`);
        announce(`Grid resized to ${width} by ${height}.${note}`);
    }

    /* --------------------------- Export / share ------------------------ */

    function safeFilename(text) {
        return String(text).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    }

    function levelBasename() {
        const level = state.level;
        if (level.name) {
            const named = safeFilename(level.name);
            if (named) return `${named}-${level.width}x${level.height}`;
        }
        return `parking-level-${level.width}x${level.height}-d${level.difficulty}-` +
            safeFilename(level.seed || 'level');
    }

    function triggerDownload(filename, blob) {
        const url = URL.createObjectURL(blob);
        const a = global.document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        global.document.body.appendChild(a);
        a.click();
        global.document.body.removeChild(a);
        global.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportJson() {
        if (!state.level) return;
        if (state.steps < 0) {
            confirmDialog({
                icon: 'warning',
                title: 'This level is not solvable',
                text: 'No open route exists from the start to the exit. Export anyway?',
                confirmButtonText: 'Export anyway'
            }).then((ok) => { if (ok) downloadJson(); });
        } else {
            downloadJson();
        }
    }

    function downloadJson() {
        const text = Level.serializeLevel(state.level, { includeGrid: state.includeGrid });
        const filename = levelBasename() + '.json';
        triggerDownload(filename, new Blob([text], { type: 'application/json' }));
        toast('success', 'Level exported', filename);
    }

    function exportPng() {
        if (!state.level) return;
        const canvas = LevelImage.renderLevelToCanvas(state.level, {
            route: state.showRoute ? currentRoute() : null,
            palette: LevelImage.readThemePalette(global.document.documentElement),
            title: state.level.name || 'Parking lot level'
        });
        if (!canvas) {
            toast('error', 'Export failed', 'This browser cannot render the level to an image.');
            return;
        }
        LevelImage.canvasToBlob(canvas).then((blob) => {
            const filename = levelBasename() + '.png';
            triggerDownload(filename, blob);
            toast('success', 'Image exported', filename);
        }).catch((err) => {
            console.error('PNG export failed:', err);
            toast('error', 'Export failed', 'The image could not be encoded.');
        });
    }

    function copyJson() {
        if (!state.level) return;
        const text = Level.serializeLevel(state.level, { includeGrid: state.includeGrid });
        copyText(text, 'Copied', 'The level JSON is on your clipboard.');
    }

    function copyShareLink() {
        if (!state.level) return;
        const url = Share.buildShareUrl(state.level);
        const long = url.length > Share.LONG_CODE_WARNING;
        copyText(url, 'Share link copied',
            long
                ? `The link is ${url.length} characters long — expect chat apps to wrap it.`
                : 'Anyone opening it gets this exact level.');
    }

    /**
     * Copy text with a graceful ladder of fallbacks:
     * async clipboard → hidden textarea → selectable dialog.
     */
    function copyText(text, title, detail) {
        const done = () => toast('success', title, detail);
        const promptFallback = () => {
            if (global.Swal) {
                global.Swal.fire(swalConfig({
                    title: 'Copy it manually',
                    input: 'textarea',
                    inputValue: text,
                    inputAttributes: { 'aria-label': 'Text to copy' },
                    confirmButtonText: 'Close'
                }));
            } else {
                global.prompt('Copy the text below:', text);
            }
        };
        const execFallback = () => {
            try {
                const ta = global.document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', 'readonly');
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                ta.style.opacity = '0';
                global.document.body.appendChild(ta);
                ta.select();
                const ok = global.document.execCommand('copy');
                global.document.body.removeChild(ta);
                if (ok) done(); else promptFallback();
            } catch (err) {
                console.warn('Clipboard fallback failed:', err);
                promptFallback();
            }
        };

        if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
            global.navigator.clipboard.writeText(text)
                .then(done)
                .catch(() => execFallback());
        } else {
            execFallback();
        }
    }

    /* ---------------------------- File loading -------------------------- */

    function loadLevelObject(raw, source) {
        const warnings = [];
        const loaded = Level.sanitizeLevel(raw, warnings);
        applyLevel(loaded, { resetHistory: true, fit: true });

        if (warnings.length) {
            announce(`Level loaded with ${warnings.length} fixes.`);
            if (global.Swal) {
                global.Swal.fire(swalConfig({
                    icon: 'warning',
                    title: 'Level loaded with fixes',
                    html: '<ul class="warning-list">' +
                        warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>',
                    confirmButtonText: 'OK'
                }));
            } else {
                alert('Level loaded with fixes:\n- ' + warnings.join('\n- '));
            }
        } else {
            toast('success', source === 'link' ? 'Shared level loaded' : 'Level loaded',
                `${loaded.width}×${loaded.height} · ${loaded.cars.length} cars`);
        }
    }

    function readFile(file) {
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            toast('error', 'File too large',
                `Level files are small JSON documents — this one is ${formatKb(file.size)}.`);
            return;
        }
        // Reject obviously unrelated files, but stay forgiving about naming.
        if (/^(image|audio|video)\//.test(file.type || '')) {
            toast('error', 'Unsupported file', 'Please choose a .json level file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                loadLevelObject(JSON.parse(e.target.result), 'file');
            } catch (err) {
                console.error('Load failed:', err);
                toast('error', 'Load failed', err.message || 'That is not a valid level JSON file.');
            }
        };
        reader.onerror = () => toast('error', 'Read error', 'Could not read that file.');
        reader.readAsText(file);
    }

    /* --------------------------- Session storage ------------------------ */

    const scheduleSessionSave = debounce(saveSession, SESSION_DEBOUNCE_MS);

    function saveSession() {
        if (!state.level) return;
        try {
            global.localStorage.setItem(STORAGE.session, JSON.stringify({
                v: Level.VERSION,
                savedAt: Date.now(),
                showRoute: state.showRoute,
                includeGrid: state.includeGrid,
                level: JSON.parse(Level.serializeLevel(state.level,
                    { includeGrid: false, pretty: false }))
            }));
        } catch (err) {
            // Quota exceeded or storage disabled — the app keeps working.
            console.warn('Session could not be saved:', err && err.message);
        }
    }

    function readSession() {
        let stored = null;
        try {
            stored = global.localStorage.getItem(STORAGE.session);
        } catch (_) {
            return null;
        }
        if (!stored) return null;
        try {
            const parsed = JSON.parse(stored);
            if (!parsed || !parsed.level) return null;
            const level = Level.sanitizeLevel(parsed.level, []);
            return {
                level,
                showRoute: parsed.showRoute === true,
                includeGrid: parsed.includeGrid !== false
            };
        } catch (err) {
            console.warn('Stored session was unreadable and has been dropped:', err && err.message);
            try { global.localStorage.removeItem(STORAGE.session); } catch (_) { /* ignore */ }
            return null;
        }
    }

    /* -------------------------------- Zoom ------------------------------ */

    function clampZoom(value) {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    }

    function applyZoom() {
        const base = cssNumber('--cell-size', 30);
        els.gridContainer.style.setProperty('--cell-size', (base * state.zoom).toFixed(2) + 'px');
        els.zoomValue.textContent = Math.round(state.zoom * 100) + '%';
    }

    function zoomBy(delta) {
        state.zoom = clampZoom(state.zoom + delta);
        state.fitMode = false;
        applyZoom();
    }

    function fitZoom() {
        if (!state.level) return;
        const level = state.level;
        const base = cssNumber('--cell-size', 30);
        const gap = cssNumber('--cell-gap', 4);
        const pad = parseFloat(global.getComputedStyle(els.gridWrapper).paddingLeft) || 0;
        const availWidth = Math.max(120, els.gridWrapper.clientWidth - pad * 2);
        const availHeight = Math.max(200, els.gridWrapper.clientHeight - pad * 2);
        const unit = base + gap;

        // The final row/column has no trailing gap, hence the `+ gap`.
        const fitWidth = (availWidth + gap) / (level.width * unit);
        const fitHeight = (availHeight + gap) / (level.height * unit);

        state.zoom = clampZoom(Math.min(fitWidth, fitHeight, 1));
        state.fitMode = true;
        applyZoom();
    }

    /* ------------------------------- Wiring ----------------------------- */

    /**
     * Highlight the section the reader is in and slide the rail's indicator.
     * Runs inside the scroll frame below, so it never adds its own listener.
     */
    function updateSectionSpy() {
        if (!els.mobileNav) return;
        const links = els.mobileNav.querySelectorAll('a[data-target]');
        if (!links.length) return;
        const line = (global.innerHeight || 800) * 0.42;
        let active = 0;
        SECTIONS.forEach((id, index) => {
            const section = global.document.getElementById(id);
            if (!section) return;
            const rect = section.getBoundingClientRect();
            if (rect.height > 0 && rect.top <= line) active = index;
        });
        els.mobileNav.style.setProperty('--i', active);
        links.forEach((link, index) => {
            link.classList.toggle('is-active', index === active);
            // The rail is a set of related targets, so the current one is
            // marked for assistive tech as well as visually.
            if (index === active) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        });
    }

    function wireEvents() {
        // Theme.
        els.themeToggle.addEventListener('click', () =>
            applyTheme(state.theme === 'dark' ? 'light' : 'dark'));

        // Scroll work is coalesced into one animation frame: the header wash,
        // the compact rail's hide-on-scroll and the section highlight.
        let lastScroll = global.scrollY || 0;
        let scrollQueued = false;
        const onScrollFrame = () => {
            scrollQueued = false;
            const y = global.scrollY || 0;
            els.appHeader.classList.toggle('scrolled', y > 6);
            if (els.mobileNav) {
                const tuck = y > 420 && y > lastScroll + 4;
                const reveal = y < 420 || y < lastScroll - 4;
                if (tuck) els.mobileNav.classList.add('is-hidden');
                else if (reveal) els.mobileNav.classList.remove('is-hidden');
                updateSectionSpy();
            }
            lastScroll = y;
        };
        const onScroll = () => {
            if (scrollQueued) return;
            scrollQueued = true;
            raf(onScrollFrame);
        };
        global.addEventListener('scroll', onScroll, { passive: true });
        onScrollFrame();

        // Jumping from the rail should feel immediate, before the smooth scroll
        // has had time to catch up.
        if (els.mobileNav) {
            [...els.mobileNav.querySelectorAll('a[data-target]')].forEach((link, index) => {
                link.addEventListener('click', () => {
                    els.mobileNav.style.setProperty('--i', index);
                });
            });
        }

        // Sliders + seed + name.
        ['width', 'height', 'difficulty'].forEach((k) =>
            els[k].addEventListener('input', updateSliderLabels));
        els.randomSeedBtn.addEventListener('click', () => {
            els.seed.value = RNG.randomSeed();
            els.seed.focus();
        });
        els.seed.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); generate(); }
        });
        els.nameInput.addEventListener('input', () => {
            if (!state.level) return;
            state.level.name = Level.sanitizeName(els.nameInput.value);
            scheduleJson();
            scheduleSessionSave();
        });

        // Form submit = generate.
        els.levelForm.addEventListener('submit', (e) => { e.preventDefault(); generate(); });

        // Sidebar edit tools.
        Object.keys(MODE_BUTTONS).forEach((mode) =>
            els[MODE_BUTTONS[mode]].addEventListener('click', () => setEditMode(mode)));
        els.cancelModeBtn.addEventListener('click', () => setEditMode(null));
        if (els.emptyAddCarBtn) {
            els.emptyAddCarBtn.addEventListener('click', () => {
                setEditMode('addCar');
                els.gridContainer.focus();
            });
        }
        els.clearAllBtn.addEventListener('click', clearAll);
        els.resizeBtn.addEventListener('click', openResizeDialog);
        els.validateBtn.addEventListener('click', reportSolvability);

        // Grid pointer input (mouse + touch, click + drag).
        els.gridContainer.addEventListener('mousedown', onGridPointerDown);
        els.gridContainer.addEventListener('mousemove', onGridPointerMove);
        els.gridContainer.addEventListener('touchstart', onGridPointerDown, { passive: false });
        els.gridContainer.addEventListener('touchmove', onGridPointerMove, { passive: false });
        ['mouseup', 'touchend', 'touchcancel', 'mouseleave'].forEach((type) =>
            els.gridContainer.addEventListener(type, onGridPointerUp));
        // Releasing outside the grid still ends the gesture.
        global.addEventListener('mouseup', onGridPointerUp);
        els.gridContainer.addEventListener('keydown', onGridKeyDown);
        els.gridContainer.addEventListener('focus', () => {
            if (!state.cursor && state.level) {
                setCursor(state.level.start[0], state.level.start[1], { scroll: false, quiet: true });
            }
        });

        // Global shortcuts + help.
        global.document.addEventListener('keydown', onDocumentKeyDown);
        els.helpBtn.addEventListener('click', showShortcuts);
        els.shortcutsLink.addEventListener('click', showShortcuts);

        // Actions.
        els.exportBtn.addEventListener('click', exportJson);
        els.copyJsonBtn.addEventListener('click', copyJson);
        els.pngBtn.addEventListener('click', exportPng);
        els.shareBtn.addEventListener('click', copyShareLink);
        els.undoBtn.addEventListener('click', undo);
        els.redoBtn.addEventListener('click', redo);
        els.routeToggleBtn.addEventListener('click', toggleRoute);

        // File loading.
        els.fileInput.addEventListener('change', (e) => {
            readFile(e.target.files && e.target.files[0]);
            e.target.value = '';
        });
        els.clearFileBtn.addEventListener('click', () => { els.fileInput.value = ''; });

        // Drag & drop anywhere on the page.
        const overlay = els.dropOverlay;
        let dragDepth = 0;
        global.document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragDepth++;
            overlay.classList.add('show');
        });
        global.document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) overlay.classList.remove('show');
        });
        global.document.addEventListener('dragover', (e) => e.preventDefault());
        global.document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDepth = 0;
            overlay.classList.remove('show');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) readFile(file);
        });

        // Zoom.
        els.zoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP));
        els.zoomOut.addEventListener('click', () => zoomBy(-ZOOM_STEP));
        els.zoomFit.addEventListener('click', fitZoom);
        global.addEventListener('resize', debounce(() => {
            if (state.fitMode) fitZoom();
            if (els.mobileNav) updateSectionSpy();
        }, 150));

        // JSON panel.
        els.toggleJsonBtn.addEventListener('click', toggleJsonPanel);
        els.includeGrid.addEventListener('change', () => {
            state.includeGrid = els.includeGrid.checked;
            refreshJson();
            scheduleSessionSave();
        });

        // Persist the session when the page is hidden or closed.
        global.addEventListener('pagehide', saveSession);
        global.document.addEventListener('visibilitychange', () => {
            if (global.document.visibilityState === 'hidden') saveSession();
        });
    }

    function toggleRoute() {
        if (!state.level) return;
        if (state.steps < 0) {
            toast('error', 'Nothing to show', 'The exit is unreachable — clear some cars first.');
            return;
        }
        state.showRoute = !state.showRoute;
        refreshRoute();
        scheduleSessionSave();
        announce(state.showRoute
            ? `Showing the shortest route: ${state.steps} steps.`
            : 'Route overlay hidden.');
    }

    function toggleJsonPanel() {
        const hidden = els.jsonDisplay.classList.toggle('d-none');
        els.toggleJsonBtn.setAttribute('aria-expanded', String(!hidden));
        els.toggleJsonBtn.innerHTML = hidden
            ? '<svg class="icon" aria-hidden="true"><use href="#i-chevron-down"></use></svg> Show JSON'
            : '<svg class="icon" aria-hidden="true"><use href="#i-chevron-up"></use></svg> Hide JSON';
        if (!hidden) refreshJson();   // catch up after being collapsed
    }

    function reportSolvability() {
        if (!state.level) return;
        // Recompute rather than trusting the (frame-coalesced) cached value, and
        // push the result through the normal stat pipeline so the chip can never
        // disagree with the toast.
        refreshStats();
        refreshRoute();
        const steps = state.steps;
        if (steps >= 0) {
            toast('success', 'Level is solvable',
                `The shortest route is ${steps} step${steps === 1 ? '' : 's'} ` +
                `(${steps + 1} cells) long. ${state.showRoute ? '' : 'Use “Show route” to see it.'}`);
            announce(`Level is solvable. Shortest route: ${steps} steps.`);
        } else {
            toast('error', 'Level is blocked',
                'No route from start to exit — remove or rotate some cars.');
            announce('Level is blocked. No route from start to exit.');
        }
    }

    /* -------------------------------- Boot ------------------------------ */

    function bootLevel() {
        const code = Share.readCodeFromUrl(global.location.search, global.location.hash);
        if (code) {
            try {
                const warnings = [];
                const shared = Share.decodeLevel(code, warnings);
                applyLevel(shared, { resetHistory: true, fit: true });
                if (warnings.length) {
                    announce(`Shared level loaded with ${warnings.length} fixes.`);
                }
                toast('success', 'Share link loaded',
                    `${shared.width}×${shared.height} · ${shared.cars.length} cars`);
                return;
            } catch (err) {
                console.error('Share link failed:', err);
                toast('error', 'Share link could not be read', err.message);
            }
        }

        const session = readSession();
        if (session) {
            state.showRoute = session.showRoute;
            state.includeGrid = session.includeGrid;
            els.includeGrid.checked = state.includeGrid;
            applyLevel(session.level, { resetHistory: true, fit: true });
            toast('info', 'Session restored', 'Your last level is back. Press “Generate” for a new one.');
            return;
        }

        applyLevel(Level.generateLevel(SAMPLE.width, SAMPLE.height, SAMPLE.difficulty,
            SAMPLE.seed, true), { resetHistory: true, fit: true });
    }

    function init() {
        if (state.initialized) return;
        state.initialized = true;

        cacheEls();
        initTheme();
        updateSliderLabels();
        wireEvents();
        bootLevel();
        applyZoom();
        fitZoom();
    }

    PG.App = {
        init,
        state,
        // Exposed for debugging from the console.
        undo, redo, generate, exportJson, exportPng, copyShareLink, fitZoom, toast
    };

    if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
