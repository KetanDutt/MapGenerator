/**
 * app.js — UI controller for the Parking Lot Level Generator.
 *
 * Wires the DOM to the level model (ParkingGen.Level), pathfinding
 * (ParkingGen.Pathfinding) and RNG (ParkingGen.RNG). All grid mutations go
 * through the helpers here so that `cars`, the `grid` matrix, the rendered
 * DOM, the JSON preview and the stats panel always stay in sync.
 */
(function (global) {
    'use strict';

    const PG = global.ParkingGen;
    const { Level, Pathfinding, RNG } = PG;

    document.addEventListener('DOMContentLoaded', init);

    /* ----------------------------- State ---------------------------- */

    let level = null;           // current level object (source of truth)
    let editMode = null;        // null | 'addCar' | 'removeCar' | 'setStart' | 'setEnd' | 'rotateCar'
    let theme = 'light';
    let isPainting = false;     // drag-to-paint in progress
    let zoom = 1;
    let generating = false;

    const MODE_TEXT = {
        addCar: 'Adding cars — click empty cells',
        removeCar: 'Removing cars — click cars',
        setStart: 'Setting the start — click a cell',
        setEnd: 'Setting the exit — click a cell',
        rotateCar: 'Rotating cars — click a car to turn it'
    };

    /* -------------------------- DOM helpers -------------------------- */

    const $ = (id) => document.getElementById(id);

    const els = {};

    function cacheEls() {
        [
            'levelForm', 'gridContainer', 'gridWrapper', 'exportBtn', 'copyJsonBtn',
            'seed', 'randomSeedBtn', 'clearFileBtn', 'fileInput', 'jsonDisplay',
            'jsonContent', 'width', 'height', 'difficulty', 'useDFS', 'themeToggle',
            'widthValue', 'heightValue', 'difficultyValue',
            'addCarBtn', 'removeCarBtn', 'setStartBtn', 'setEndBtn', 'rotateCarBtn',
            'clearAllBtn', 'validateBtn',
            'gridSizeStat', 'carCountStat', 'difficultyStat', 'startPosStat',
            'endPosStat', 'layoutStat', 'fillStat', 'solvableStat', 'solvableBadge',
            'modeBanner', 'modeBannerText', 'cancelModeBtn',
            'zoomOut', 'zoomIn', 'zoomFit', 'zoomValue',
            'toggleJsonBtn', 'dropOverlay', 'jsonCount'
        ].forEach((id) => { els[id] = $(id); });
    }

    /* --------------------------- Notifications ------------------------ */

    function swalConfig(extra) {
        return Object.assign({ theme: theme, backdrop: 'rgba(0,0,0,0.5)' }, extra || {});
    }

    function toast(icon, title, text) {
        if (global.Swal) {
            global.Swal.fire(swalConfig({
                icon, title, text, toast: true, position: 'top-end',
                showConfirmButton: false, timer: 2200, timerProgressBar: true
            }));
        } else {
            // Graceful fallback if the SweetAlert CDN failed to load.
            console.log(`[${icon}] ${title}${text ? ' — ' + text : ''}`);
        }
    }

    function confirmDialog(opts) {
        if (global.Swal) {
            return global.Swal.fire(swalConfig(Object.assign({
                showCancelButton: true, confirmButtonText: 'Confirm', cancelButtonText: 'Cancel'
            }, opts))).then((r) => r.isConfirmed);
        }
        return Promise.resolve(global.confirm(opts.text || opts.title || 'Are you sure?'));
    }

    /* ----------------------------- Theme ----------------------------- */

    function applyTheme(next) {
        theme = next;
        document.documentElement.setAttribute('data-bs-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
        els.themeToggle.innerHTML = theme === 'dark'
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
        els.themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        try { localStorage.setItem('plg-theme', theme); } catch (_) { /* private mode */ }
    }

    function initTheme() {
        let saved = null;
        try { saved = localStorage.getItem('plg-theme'); } catch (_) { /* ignore */ }
        if (saved === 'dark' || saved === 'light') {
            applyTheme(saved);
        } else if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) {
            applyTheme('dark');
        } else {
            applyTheme('light');
        }
    }

    /* --------------------------- Sliders ----------------------------- */

    function updateSliderLabels() {
        els.widthValue.textContent = els.width.value;
        els.heightValue.textContent = els.height.value;
        els.difficultyValue.textContent = els.difficulty.value;
    }

    /* --------------------------- Grid render -------------------------- */

    function cellIndex(x, y) {
        return y * level.width + x;
    }

    /** Full (re)build of the grid DOM. Used after generate/load/clear. */
    function renderGrid() {
        const frag = document.createDocumentFragment();
        for (let y = 0; y < level.height; y++) {
            for (let x = 0; x < level.width; x++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                paintCell(cell, x, y);
                frag.appendChild(cell);
            }
        }
        els.gridContainer.innerHTML = '';
        els.gridContainer.style.setProperty('--cols', level.width);
        els.gridContainer.style.setProperty('--rows', level.height);
        els.gridContainer.appendChild(frag);
    }

    /** Update a single cell's classes/tooltip without touching the rest. */
    function updateCell(x, y) {
        const cell = els.gridContainer.children[cellIndex(x, y)];
        if (cell) paintCell(cell, x, y);
    }

    function paintCell(cell, x, y) {
        const node = level.grid[y][x];
        cell.className = 'cell';

        // Alternate lane shading for empty asphalt so the layout reads well.
        if (level.parkingLayout === 'rows') {
            if (y % 2 === 1) cell.classList.add('lane-alt');
        } else if (x % 2 === 1) {
            cell.classList.add('lane-alt');
        }

        if (node.type === 'start') {
            cell.classList.add('start');
            cell.title = `Start (${x}, ${y})`;
        } else if (node.type === 'end') {
            cell.classList.add('end');
            cell.title = `Exit (${x}, ${y})`;
        } else if (node.type === 'car') {
            cell.classList.add('car', node.direction);
            cell.title = `Car (${x}, ${y}) facing ${node.direction}`;
        } else {
            cell.title = `Empty (${x}, ${y})`;
        }
    }

    function refreshJson() {
        els.jsonContent.textContent = JSON.stringify(level, null, 2);
        els.jsonCount.textContent = `${(els.jsonContent.textContent.length / 1024).toFixed(1)} KB`;
    }

    /* ----------------------------- Stats ----------------------------- */

    function updateStats() {
        if (!level) return;
        els.gridSizeStat.textContent = `${level.width}×${level.height}`;
        els.carCountStat.textContent = level.cars.length;
        els.difficultyStat.textContent = `${level.difficulty} · ${Level.difficultyLabel(level.difficulty)}`;
        els.startPosStat.textContent = `(${level.start[0]}, ${level.start[1]})`;
        els.endPosStat.textContent = `(${level.end[0]}, ${level.end[1]})`;
        els.layoutStat.textContent = level.parkingLayout === 'rows' ? 'Rows' : 'Columns';
        const total = level.width * level.height;
        const fill = Math.round((level.cars.length / total) * 100);
        els.fillStat.textContent = `${fill}%`;

        const solvable = Pathfinding.isSolvable(level);
        els.solvableStat.textContent = solvable ? 'Solvable' : 'Blocked';
        els.solvableBadge.classList.toggle('badge-ok', solvable);
        els.solvableBadge.classList.toggle('badge-bad', !solvable);
        els.exportBtn.classList.toggle('btn-outline-warning', !solvable);
    }

    /** Re-sync every panel after a mutation. */
    function syncAll(paintAll) {
        if (paintAll) renderGrid();
        refreshJson();
        updateStats();
    }

    /* -------------------------- Edit helpers -------------------------- */

    function findCar(x, y) {
        return level.cars.findIndex((c) => c.x === x && c.y === y);
    }

    function isStart(x, y) { return level.start[0] === x && level.start[1] === y; }
    function isEnd(x, y) { return level.end[0] === x && level.end[1] === y; }

    function addCar(x, y) {
        if (findCar(x, y) !== -1 || isStart(x, y) || isEnd(x, y)) {
            toast('error', 'Occupied', 'That cell already has a car, start or exit.');
            return;
        }
        const direction = Level.defaultDirection(level.parkingLayout, x, y);
        level.cars.push({ x, y, direction });
        level.grid[y][x] = { type: 'car', direction };
        updateCell(x, y);
        syncAll(false);
    }

    function removeCar(x, y) {
        const idx = findCar(x, y);
        if (idx === -1) return;
        level.cars.splice(idx, 1);
        level.grid[y][x] = { type: 'empty' };
        updateCell(x, y);
        syncAll(false);
    }

    function rotateCar(x, y) {
        const idx = findCar(x, y);
        if (idx === -1) return;
        const dirs = Level.DIRECTIONS;
        const car = level.cars[idx];
        car.direction = dirs[(dirs.indexOf(car.direction) + 1) % dirs.length];
        level.grid[y][x] = { type: 'car', direction: car.direction };
        updateCell(x, y);
        syncAll(false);
    }

    function setStart(x, y) {
        if (findCar(x, y) !== -1 || isEnd(x, y)) {
            toast('error', 'Cannot set start', 'Choose an empty cell that is not the exit.');
            return;
        }
        if (isStart(x, y)) return;
        const [ox, oy] = level.start;
        level.grid[oy][ox] = { type: 'empty' };
        level.start = [x, y];
        level.grid[y][x] = { type: 'start' };
        updateCell(ox, oy);
        updateCell(x, y);
        syncAll(false);
    }

    function setEnd(x, y) {
        if (findCar(x, y) !== -1 || isStart(x, y)) {
            toast('error', 'Cannot set exit', 'Choose an empty cell that is not the start.');
            return;
        }
        if (isEnd(x, y)) return;
        const [ox, oy] = level.end;
        level.grid[oy][ox] = { type: 'empty' };
        level.end = [x, y];
        level.grid[y][x] = { type: 'end' };
        updateCell(ox, oy);
        updateCell(x, y);
        syncAll(false);
    }

    function applyEdit(x, y) {
        switch (editMode) {
            case 'addCar': addCar(x, y); break;
            case 'removeCar': removeCar(x, y); break;
            case 'setStart': setStart(x, y); break;
            case 'setEnd': setEnd(x, y); break;
            case 'rotateCar': rotateCar(x, y); break;
            default: break;
        }
    }

    /* --------------------------- Edit mode --------------------------- */

    const MODE_BUTTONS = {
        addCar: 'addCarBtn',
        removeCar: 'removeCarBtn',
        setStart: 'setStartBtn',
        setEnd: 'setEndBtn',
        rotateCar: 'rotateCarBtn'
    };

    function setEditMode(mode) {
        editMode = editMode === mode ? null : mode;
        Object.keys(MODE_BUTTONS).forEach((m) => {
            els[MODE_BUTTONS[m]].classList.toggle('active', m === editMode);
        });
        els.gridContainer.classList.toggle('editing', editMode !== null);
        if (editMode) {
            els.modeBannerText.textContent = MODE_TEXT[editMode];
            els.modeBanner.classList.remove('d-none');
        } else {
            els.modeBanner.classList.add('d-none');
        }
    }

    /* --------------------- Pointer input (click + drag) --------------- */

    function cellFromEvent(event) {
        const target = event.target;
        if (target && target.classList && target.classList.contains('cell')) {
            return { x: parseInt(target.dataset.x, 10), y: parseInt(target.dataset.y, 10), el: target };
        }
        return null;
    }

    function onGridPointerDown(event) {
        if (!level || !editMode) return;
        const hit = cellFromEvent(event);
        if (!hit) return;
        isPainting = true;
        // Rotate/setStart/setEnd act once per click; add/remove support drag.
        applyEdit(hit.x, hit.y);
        event.preventDefault();
    }

    function onGridPointerMove(event) {
        if (!isPainting || !editMode) return;
        if (editMode !== 'addCar' && editMode !== 'removeCar') return;
        let clientX = event.clientX, clientY = event.clientY;
        if (event.touches && event.touches.length) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        }
        const el = document.elementFromPoint(clientX, clientY);
        if (el && el.classList && el.classList.contains('cell')) {
            const x = parseInt(el.dataset.x, 10);
            const y = parseInt(el.dataset.y, 10);
            if (editMode === 'addCar') {
                if (findCar(x, y) === -1 && !isStart(x, y) && !isEnd(x, y)) applyEdit(x, y);
            } else {
                if (findCar(x, y) !== -1) applyEdit(x, y);
            }
        }
        event.preventDefault();
    }

    function onGridPointerUp() {
        isPainting = false;
    }

    /* --------------------------- Generation -------------------------- */

    function setGenerating(on) {
        generating = on;
        els.levelForm.classList.toggle('loading', on);
        const submitBtn = els.levelForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = on;
    }

    function generate() {
        if (generating) return;
        const width = parseInt(els.width.value, 10);
        const height = parseInt(els.height.value, 10);
        const difficulty = parseInt(els.difficulty.value, 10);
        const seed = els.seed.value.trim() || RNG.randomSeed();
        const guaranteePath = els.useDFS.checked;

        els.seed.value = seed;
        setGenerating(true);

        // Defer so the loading state can paint before the (synchronous) work.
        setTimeout(() => {
            try {
                level = Level.generateLevel(width, height, difficulty, seed, guaranteePath);
                setEditMode(null);
                renderGrid();
                syncAll(false);
                setActionButtonsEnabled(true);
                fitZoom();
                toast('success', 'Level generated', `${level.width}×${level.height} · seed "${seed}"`);
            } catch (err) {
                console.error('Generation failed:', err);
                toast('error', 'Generation failed', err.message || 'Unexpected error.');
            } finally {
                setGenerating(false);
            }
        }, 60);
    }

    function setActionButtonsEnabled(on) {
        els.exportBtn.disabled = !on;
        els.copyJsonBtn.disabled = !on;
    }

    /* --------------------------- Clear all --------------------------- */

    function clearAll() {
        if (!level) return;
        confirmDialog({
            icon: 'warning',
            title: 'Clear the parking lot?',
            text: 'All cars are removed and the start/exit reset to opposite corners.',
            confirmButtonText: 'Yes, clear it'
        }).then((ok) => {
            if (!ok) return;
            level.cars = [];
            level.start = [0, 0];
            level.end = [level.width - 1, level.height - 1];
            level.grid = Level.rebuildGrid(level);
            renderGrid();
            syncAll(false);
            toast('success', 'Cleared', 'The parking lot has been reset.');
        });
    }

    /* ------------------------- Export / copy -------------------------- */

    function download(filename, text) {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function safeFilename(s) {
        return String(s).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'level';
    }

    function exportLevel() {
        if (!level) return;
        if (!Pathfinding.isSolvable(level)) {
            confirmDialog({
                icon: 'warning',
                title: 'This level is not solvable',
                text: 'No open path exists from start to exit. Export anyway?',
                confirmButtonText: 'Export anyway'
            }).then((ok) => { if (ok) doExport(); });
        } else {
            doExport();
        }
    }

    function doExport() {
        const name = `parking-level-${level.width}x${level.height}-d${level.difficulty}-${safeFilename(level.seed)}.json`;
        download(name, JSON.stringify(level, null, 2));
        toast('success', 'Level exported', name);
    }

    function copyJson() {
        if (!level) return;
        const text = JSON.stringify(level, null, 2);
        const done = () => toast('success', 'Copied', 'Level JSON is on your clipboard.');
        const fail = () => toast('error', 'Copy failed', 'Select the JSON and copy it manually.');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done, fail));
        } else {
            fallbackCopy(text, done, fail);
        }
    }

    function fallbackCopy(text, done, fail) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            done();
        } catch (_) {
            fail();
        }
    }

    /* --------------------------- Load files --------------------------- */

    function loadLevelObject(obj) {
        const warnings = [];
        const loaded = Level.sanitizeLevel(obj, warnings);
        level = loaded;

        els.width.value = level.width;
        els.height.value = level.height;
        els.difficulty.value = level.difficulty;
        els.seed.value = level.seed;
        updateSliderLabels();

        setEditMode(null);
        renderGrid();
        syncAll(false);
        setActionButtonsEnabled(true);
        fitZoom();

        if (warnings.length) {
            if (global.Swal) {
                global.Swal.fire(swalConfig({
                    icon: 'warning',
                    title: 'Level loaded with fixes',
                    html: '<ul style="text-align:left;margin:0;padding-left:1.2rem">' +
                        warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>',
                    confirmButtonText: 'OK'
                }));
            } else {
                alert('Level loaded with fixes:\n- ' + warnings.join('\n- '));
            }
        } else {
            toast('success', 'Level loaded', `${level.width}×${level.height}, ${level.cars.length} cars`);
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function readFile(file) {
        if (!file) return;
        if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
            toast('error', 'Unsupported file', 'Please choose a .json level file.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                loadLevelObject(JSON.parse(e.target.result));
            } catch (err) {
                console.error('Load failed:', err);
                toast('error', 'Load failed', err.message || 'That is not a valid level JSON file.');
            }
        };
        reader.onerror = () => toast('error', 'Read error', 'Could not read the file.');
        reader.readAsText(file);
    }

    /* ------------------------------ Zoom ------------------------------ */

    const MIN_ZOOM = 0.5, MAX_ZOOM = 2, ZOOM_STEP = 0.1;

    function applyZoom() {
        els.gridContainer.style.setProperty('--cell-size', 30 * zoom + 'px');
        els.zoomValue.textContent = Math.round(zoom * 100) + '%';
    }

    function fitZoom() {
        if (!level) return;
        const wrapperWidth = els.gridWrapper.clientWidth - 24;
        const wrapperHeight = Math.max(320, els.gridWrapper.clientHeight - 24);
        const fitW = wrapperWidth / (level.width * (30 + 4));
        const fitH = wrapperHeight / (level.height * (30 + 4));
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(fitW, fitH, 1)));
        applyZoom();
    }

    /* ----------------------------- Init ------------------------------- */

    let initialized = false;

    function init() {
        if (initialized) return;
        initialized = true;

        cacheEls();
        initTheme();
        updateSliderLabels();

        // Theme
        els.themeToggle.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));

        // Sliders
        ['width', 'height', 'difficulty'].forEach((k) =>
            els[k].addEventListener('input', updateSliderLabels));

        // Seed
        els.randomSeedBtn.addEventListener('click', () => { els.seed.value = RNG.randomSeed(); });
        els.seed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); generate(); } });

        // Form
        els.levelForm.addEventListener('submit', (e) => { e.preventDefault(); generate(); });

        // Sidebar edit tools
        els.addCarBtn.addEventListener('click', () => setEditMode('addCar'));
        els.removeCarBtn.addEventListener('click', () => setEditMode('removeCar'));
        els.setStartBtn.addEventListener('click', () => setEditMode('setStart'));
        els.setEndBtn.addEventListener('click', () => setEditMode('setEnd'));
        els.rotateCarBtn.addEventListener('click', () => setEditMode('rotateCar'));
        els.cancelModeBtn.addEventListener('click', () => setEditMode(null));
        els.clearAllBtn.addEventListener('click', clearAll);

        // Validate button: show pathfinding status explicitly.
        els.validateBtn.addEventListener('click', () => {
            if (!level) return;
            const path = Pathfinding.findShortestPath(level, level.start, level.end);
            if (path) {
                toast('success', 'Level is solvable', `Shortest route is ${path.length} cells long.`);
            } else {
                toast('error', 'Level is blocked', 'No route from start to exit — remove or rotate some cars.');
            }
        });

        // Grid pointer input (mouse + touch, click + drag). Handlers are bound
        // to the grid itself so clicks on the surrounding UI (e.g. the theme
        // toggle) are never intercepted.
        els.gridContainer.addEventListener('mousedown', onGridPointerDown);
        els.gridContainer.addEventListener('mousemove', (e) => { if (isPainting) onGridPointerMove(e); });
        els.gridContainer.addEventListener('mouseup', onGridPointerUp);
        els.gridContainer.addEventListener('mouseleave', onGridPointerUp);
        els.gridContainer.addEventListener('touchstart', onGridPointerDown, { passive: false });
        els.gridContainer.addEventListener('touchmove', onGridPointerMove, { passive: false });
        els.gridContainer.addEventListener('touchend', onGridPointerUp);
        els.gridContainer.addEventListener('touchcancel', onGridPointerUp);

        // Escape cancels the active edit tool.
        global.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && editMode) setEditMode(null);
        });

        // Actions
        els.exportBtn.addEventListener('click', exportLevel);
        els.copyJsonBtn.addEventListener('click', copyJson);

        // File loading
        els.fileInput.addEventListener('change', (e) => {
            readFile(e.target.files[0]);
            e.target.value = '';
        });
        els.clearFileBtn.addEventListener('click', () => { els.fileInput.value = ''; });

        // Drag & drop a level file anywhere on the page.
        const overlay = els.dropOverlay;
        let dragDepth = 0;
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragDepth++;
            overlay.classList.add('show');
        });
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) overlay.classList.remove('show');
        });
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDepth = 0;
            overlay.classList.remove('show');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) readFile(file);
        });

        // Zoom
        els.zoomIn.addEventListener('click', () => { zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP); applyZoom(); });
        els.zoomOut.addEventListener('click', () => { zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP); applyZoom(); });
        els.zoomFit.addEventListener('click', fitZoom);

        // JSON panel toggle
        els.toggleJsonBtn.addEventListener('click', () => {
            const hidden = els.jsonDisplay.classList.toggle('d-none');
            els.toggleJsonBtn.innerHTML = hidden
                ? '<i class="fas fa-code me-1"></i> Show JSON'
                : '<i class="fas fa-code me-1"></i> Hide JSON';
        });

        // Start with a generated sample level (deterministic seed).
        level = Level.generateLevel(10, 10, 5, 'welcome', true);
        renderGrid();
        syncAll(false);
        setActionButtonsEnabled(true);
        applyZoom();
        fitZoom();
    }
})(typeof window !== 'undefined' ? window : globalThis);
