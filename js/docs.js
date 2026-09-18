/**
 * docs.js — Documentation browser for `docs.html`.
 *
 * Loads the Markdown files in `docs/` (plus the README), renders them with the
 * project's own `ParkingGen.Markdown` renderer and wires up the document list,
 * per-document table of contents, filter box and theme toggle.
 *
 * Every document is served straight from the repository, so the viewer never
 * duplicates content: edit the Markdown, reload, done. If the page is opened
 * over `file://` (where `fetch` is blocked) a clear fallback message links to
 * the raw files instead.
 *
 * Exposed as `ParkingGenDocs` for debugging.
 */
(function (global) {
    'use strict';

    const DOCS = [
        {
            slug: 'usage',
            file: 'docs/USAGE.md',
            title: 'Usage guide',
            blurb: 'Every control in the editor, step by step.'
        },
        {
            slug: 'level-format',
            file: 'docs/LEVEL_FORMAT.md',
            title: 'Level JSON format',
            blurb: 'The schema your game engine has to read.'
        },
        {
            slug: 'architecture',
            file: 'docs/ARCHITECTURE.md',
            title: 'Architecture',
            blurb: 'How the modules fit together and why.'
        },
        {
            slug: 'design',
            file: 'docs/DESIGN.md',
            title: 'Design system',
            blurb: 'Tokens, glass materials and motion rules behind the UI.'
        },
        {
            slug: 'testing',
            file: 'docs/TESTING.md',
            title: 'Testing',
            blurb: 'What the suite covers and how to extend it.'
        },
        {
            slug: 'contributing',
            file: 'docs/CONTRIBUTING.md',
            title: 'Contributing',
            blurb: 'Conventions, workflow and review checklist.'
        },
        {
            slug: 'changelog',
            file: 'docs/CHANGELOG.md',
            title: 'Changelog',
            blurb: 'What changed in each release of the tool.'
        },
        {
            slug: 'readme',
            file: 'README.md',
            title: 'Overview (README)',
            blurb: 'The project at a glance.'
        }
    ];

    const els = {};
    let current = null;
    const cache = new Map();

    function $(id) {
        return global.document.getElementById(id);
    }

    /* ------------------------------- Theme ------------------------------ */

    function applyTheme(theme) {
        global.document.documentElement.setAttribute('data-theme', theme);
        const meta = global.document.querySelector
            && global.document.querySelector('meta[name="theme-color"]');
        let wash = '';
        try {
            wash = global.getComputedStyle(global.document.documentElement)
                .getPropertyValue('--bg-0').trim();
        } catch (_) { /* fall through to the defaults below */ }
        if (meta) meta.setAttribute('content', wash || (theme === 'dark' ? '#0a0b0f' : '#f7f8fb'));
        els.themeToggle.innerHTML = theme === 'dark'
            ? '<svg class="icon" aria-hidden="true"><use href="#i-sun"></use></svg>'
            : '<svg class="icon" aria-hidden="true"><use href="#i-moon"></use></svg>';
        try {
            global.localStorage.setItem('plg-theme', theme);
        } catch (_) { /* storage unavailable */ }
    }

    function initTheme() {
        let saved = null;
        try {
            saved = global.localStorage.getItem('plg-theme');
        } catch (_) { /* ignore */ }
        if (saved === 'dark' || saved === 'light') applyTheme(saved);
        else if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
        else applyTheme('light');
    }

    /* ------------------------------ Loading ----------------------------- */

    /** Fetch a text file with an XHR fallback (older browsers, file://). */
    function fetchText(url) {
        if (typeof global.fetch === 'function') {
            return global.fetch(url, { cache: 'no-cache' }).then((response) => {
                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                return response.text();
            });
        }
        return new Promise((resolve, reject) => {
            const xhr = new global.XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = () => {
                if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) resolve(xhr.responseText);
                else reject(new Error(`${xhr.status} ${xhr.statusText}`));
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send();
        });
    }

    function showError(doc) {
        els.docError.classList.remove('d-none');
        els.errorRawLink.href = doc.file;
        els.docBody.innerHTML = '';
        els.tocBox.classList.add('d-none');
        els.docTitle.textContent = doc.title;
        els.docBlurb.textContent = 'The Markdown source could not be read in this context.';
    }

    function renderToc(headings) {
        // Only the top levels keep the list readable.
        const relevant = headings.filter((h) => h.level <= 3);
        if (relevant.length < 3) {
            els.tocBox.classList.add('d-none');
            els.tocList.innerHTML = '';
            return;
        }
        els.tocBox.classList.remove('d-none');
        els.tocList.innerHTML = relevant.map((h) =>
            `<li class="docs-toc__item docs-toc__item--h${h.level}">` +
            `<a href="#${h.id}" data-anchor="${h.id}">${escapeHtml(h.text)}</a></li>`).join('');
    }

    function escapeHtml(text) {
        return global.ParkingGen && global.ParkingGen.Markdown
            ? global.ParkingGen.Markdown.escapeHtml(text)
            : String(text);
    }

    function load(slug, options) {
        const doc = DOCS.find((d) => d.slug === slug) || DOCS[0];
        const opts = options || {};
        current = doc.slug;
        els.docError.classList.add('d-none');
        els.docTitle.textContent = doc.title;
        els.docBlurb.textContent = doc.blurb;
        els.rawLink.href = doc.file;
        els.docBody.setAttribute('aria-busy', 'true');
        markActive(doc.slug);
        global.document.title = `${doc.title} · Parking Lot Level Generator`;

        const render = (text) => {
            const headings = [];
            els.docBody.innerHTML = global.ParkingGen.Markdown.renderMarkdown(text, { headings });
            renderToc(headings);
            els.docBody.setAttribute('aria-busy', 'false');
            if (opts.scrollTo) {
                const target = global.document.getElementById(opts.scrollTo);
                if (target) {
                    target.scrollIntoView();
                    return;
                }
            }
            global.scrollTo({ top: 0, behavior: 'auto' });
            els.appHeader.classList.toggle('scrolled', false);
        };

        if (cache.has(doc.file)) {
            render(cache.get(doc.file));
            return Promise.resolve();
        }
        // Skeleton shaped like a document (title, lead, body blocks) so the
        // layout does not jump when the real content arrives.
        els.docBody.innerHTML =
            '<div class="docs-skeleton" aria-hidden="true">' +
            '<span class="docs-skeleton__line docs-skeleton__line--title"></span>' +
            '<span class="docs-skeleton__line docs-skeleton__line--lead"></span>' +
            '<span class="docs-skeleton__line"></span>' +
            '<span class="docs-skeleton__line docs-skeleton__line--short"></span>' +
            '<span class="docs-skeleton__block"></span>' +
            '<span class="docs-skeleton__line"></span>' +
            '<span class="docs-skeleton__line docs-skeleton__line--short"></span>' +
            '</div>' +
            '<p class="sr-only">Loading ' + escapeHtml(doc.file) + '…</p>';

        return fetchText(doc.file)
            .then((text) => {
                cache.set(doc.file, text);
                render(text);
            })
            .catch((err) => {
                console.error('Document load failed:', err);
                showError(doc);
            });
    }

    /* ------------------------------- Nav -------------------------------- */

    function markActive(slug) {
        [...els.docList.querySelectorAll('a')].forEach((link) => {
            const active = link.dataset.slug === slug;
            link.classList.toggle('is-active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }

    function buildNav() {
        els.docList.innerHTML = DOCS.map((doc) =>
            `<a class="docs-nav__link" href="#${doc.slug}" data-slug="${doc.slug}">` +
            `<span class="docs-nav__title">${escapeHtml(doc.title)}</span>` +
            `<span class="docs-nav__blurb">${escapeHtml(doc.blurb)}</span></a>`).join('');
        els.docCount.textContent = `${DOCS.length} documents`;
    }

    function filterNav(term) {
        const needle = term.trim().toLowerCase();
        let visible = 0;
        [...els.docList.querySelectorAll('a')].forEach((link) => {
            const haystack = (link.textContent || '').toLowerCase();
            const match = !needle || haystack.indexOf(needle) !== -1;
            link.classList.toggle('d-none', !match);
            if (match) visible++;
        });
        els.docCount.textContent = needle
            ? `${visible} of ${DOCS.length} documents`
            : `${DOCS.length} documents`;
        // Only claim "no match" when a filter actually excluded something: an
        // empty list on `file://` means the fetch failed, not that the user
        // searched for nothing.
        if (els.docEmpty) els.docEmpty.classList.toggle('d-none', visible > 0 || !needle);
    }

    /* ------------------------------ Wiring ------------------------------ */

    function slugForHash(hash) {
        const raw = String(hash || '').replace(/^#/, '').trim();
        if (!raw) return null;
        // `#usage` (document) or `#usage/some-heading` (document + anchor).
        const [slug, anchor] = raw.split('/');
        return { slug: DOCS.some((d) => d.slug === slug) ? slug : null, anchor: anchor || null };
    }

    function onHashChange() {
        const target = slugForHash(global.location.hash);
        // A fragment that matches a heading inside the current document is
        // handled by the browser natively; only switch documents when needed.
        if (!target || !target.slug || target.slug === current) return;
        load(target.slug, { scrollTo: target.anchor });
    }

    function onDocLinkClick(event) {
        const link = event.target.closest && event.target.closest('a[data-anchor]');
        if (!link) return;
        event.preventDefault();
        const id = link.dataset.anchor;
        const target = global.document.getElementById(id);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            global.history.replaceState(null, '', `${global.location.pathname}${global.location.search}#${current}/${id}`);
        }
    }

    function init() {
        ['themeToggle', 'docList', 'docBody', 'docError', 'docTitle', 'docBlurb', 'docFilter',
            'tocBox', 'tocList', 'copyLinkBtn', 'rawLink', 'errorRawLink', 'appHeader', 'docCount',
            'docEmpty']
            .forEach((id) => { els[id] = $(id); });

        if (!global.ParkingGen || !global.ParkingGen.Markdown) {
            els.docBody.textContent = 'The Markdown renderer failed to load (js/markdown.js is missing).';
            return;
        }

        initTheme();
        els.themeToggle.addEventListener('click', () => {
            applyTheme(global.document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        });

        const onScroll = () => els.appHeader.classList.toggle('scrolled', global.scrollY > 6);
        global.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        buildNav();
        els.docFilter.addEventListener('input', () => filterNav(els.docFilter.value));
        els.docBody.addEventListener('click', onDocLinkClick);
        global.addEventListener('hashchange', onHashChange);

        els.copyLinkBtn.addEventListener('click', () => {
            const url = global.location.href;
            const done = () => {
                els.copyLinkBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-check"></use></svg>Link copied';
                global.setTimeout(() => {
                    els.copyLinkBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-link"></use></svg>Copy link to this page';
                }, 2000);
            };
            if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
                global.navigator.clipboard.writeText(url).then(done).catch(() => global.prompt('Copy:', url));
            } else {
                global.prompt('Copy:', url);
            }
        });

        const target = slugForHash(global.location.hash);
        load(target && target.slug ? target.slug : DOCS[0].slug,
            { scrollTo: target && target.anchor });
    }

    global.ParkingGenDocs = { DOCS, load, slugForHash, init };

    if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
