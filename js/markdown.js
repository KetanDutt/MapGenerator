/**
 * markdown.js — Tiny dependency-free Markdown renderer for the in-app docs
 * viewer (`docs.html`).
 *
 * Supports the subset the project's documentation actually uses:
 * ATX headings (with slug ids for anchors), paragraphs, fenced code blocks,
 * blockquotes, ordered/unordered lists (including nesting), horizontal rules,
 * GFM tables, and inline code / bold / italic / links / strikethrough.
 *
 * Safety: all text is HTML-escaped first; only a small whitelist of inline
 * tags (`kbd`, `br`, `sub`, `sup`, `abbr`) is restored afterwards, and link
 * targets are restricted to safe schemes. Rendering is pure (string → string)
 * so it is unit-tested in `tools/test.js`.
 *
 * Exposed as `ParkingGen.Markdown`.
 */
(function (global) {
    'use strict';

    const PG = (global.ParkingGen = global.ParkingGen || {});

    const INLINE_HTML_WHITELIST = ['kbd', 'br', 'sub', 'sup', 'abbr', 'mark', 'strong', 'em'];

    /** Escape the five HTML-significant characters. */
    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    /** GitHub-style anchor slug for a heading. */
    function slugify(text) {
        return String(text)
            .toLowerCase()
            .replace(/<[^>]+>/g, '')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 80) || 'section';
    }

    /** Schemes that are safe to turn into a clickable link. */
    const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

    /**
     * Reject anything that could execute code when clicked; allow relative
     * paths, fragments and the common web schemes.
     */
    function safeHref(href) {
        const url = String(href).trim().replace(/[\u0000-\u001f\u007f]/g, '');
        if (!url) return '#';
        const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(url);
        if (scheme && SAFE_SCHEMES.indexOf(scheme[1].toLowerCase()) === -1) return '#';
        return url;
    }

    /**
     * Render the inline span syntax of a single line.
     * @param {string} text Raw (unescaped) markdown source.
     * @returns {string} HTML.
     */
    function renderInline(text) {
        const codeSpans = [];
        let out = String(text);

        // 1. Pull code spans out first so their contents are never parsed.
        out = out.replace(/`([^`]+)`/g, (_, code) => {
            codeSpans.push(code);
            return '\u0000CODE' + (codeSpans.length - 1) + '\u0000';
        });

        // 2. Escape everything left.
        out = escapeHtml(out);

        // 3. Links: [label](href "title") — the label may contain markup.
        out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
            (_, label, href, title) => {
                const attrs = ' href="' + escapeHtml(safeHref(href)) + '"';
                const titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
                return '<a' + attrs + titleAttr + '>' + label + '</a>';
            });

        // 4. Emphasis. Bold before italic so ** wins over *.
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // 5. Restore the whitelisted inline HTML tags the docs use.
        INLINE_HTML_WHITELIST.forEach((tag) => {
            const open = new RegExp('&lt;(' + tag + '(?:\\s[^&]*?)?)&gt;', 'gi');
            const close = new RegExp('&lt;\\/(' + tag + ')&gt;', 'gi');
            out = out.replace(open, '<$1>').replace(close, '</$1>');
        });

        // 6. Put the escaped code spans back.
        out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, index) =>
            '<code>' + escapeHtml(codeSpans[Number(index)]) + '</code>');

        return out;
    }

    function splitRow(line) {
        return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    }

    const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

    function alignmentFor(cell) {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
    }

    /**
     * Render a full Markdown document to HTML.
     *
     * @param {string} markdown
     * @param {object} [options] { headings: Array } — populated with
     *   `{ level, text, id }` entries so callers can build a table of contents.
     * @returns {string} HTML string.
     */
    function renderMarkdown(markdown, options) {
        const o = options || {};
        const headings = o.headings || null;
        const lines = String(markdown === undefined || markdown === null ? '' : markdown)
            .replace(/\r\n?/g, '\n')
            .split('\n');
        const html = [];
        const usedIds = new Set();
        let i = 0;

        const uniqueId = (text) => {
            const base = slugify(text);
            let id = base;
            let n = 2;
            while (usedIds.has(id)) id = base + '-' + n++;
            usedIds.add(id);
            return id;
        };

        while (i < lines.length) {
            const line = lines[i];

            // Blank line.
            if (!line.trim()) { i++; continue; }

            // Fenced code block.
            const fence = /^\s*```(\w*)\s*$/.exec(line);
            if (fence) {
                const lang = fence[1];
                const body = [];
                i++;
                while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
                i++; // closing fence (or EOF)
                html.push('<pre class="md-pre"><code' +
                    (lang ? ' class="lang-' + escapeHtml(lang) + '"' : '') + '>' +
                    escapeHtml(body.join('\n')) + '</code></pre>');
                continue;
            }

            // ATX heading.
            const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
            if (heading) {
                const level = heading[1].length;
                const text = heading[2];
                const id = uniqueId(text);
                if (headings) headings.push({ level, text: text.replace(/[*`]/g, ''), id });
                html.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
                i++;
                continue;
            }

            // Horizontal rule.
            if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
                html.push('<hr>');
                i++;
                continue;
            }

            // GFM table.
            if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
                const header = splitRow(line);
                const aligns = splitRow(lines[i + 1]).map(alignmentFor);
                const rows = [];
                i += 2;
                while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                    rows.push(splitRow(lines[i]));
                    i++;
                }
                const cell = (text, tag, align) => {
                    const style = align ? ` style="text-align:${align}"` : '';
                    return `<${tag}${style}>${renderInline(text)}</${tag}>`;
                };
                let table = '<div class="md-table-wrap"><table><thead><tr>';
                header.forEach((text, c) => { table += cell(text, 'th', aligns[c]); });
                table += '</tr></thead><tbody>';
                rows.forEach((row) => {
                    table += '<tr>';
                    for (let c = 0; c < header.length; c++) table += cell(row[c] === undefined ? '' : row[c], 'td', aligns[c]);
                    table += '</tr>';
                });
                table += '</tbody></table></div>';
                html.push(table);
                continue;
            }

            // Blockquote (consecutive `>` lines are rendered together).
            if (/^\s*>\s?/.test(line)) {
                const body = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    body.push(lines[i].replace(/^\s*>\s?/, ''));
                    i++;
                }
                html.push('<blockquote>' + renderMarkdown(body.join('\n')) + '</blockquote>');
                continue;
            }

            // Lists (ordered / unordered, with nested levels via indentation).
            if (LIST_ITEM.test(line)) {
                const parsed = parseList(lines, i);
                if (parsed.next > i) {
                    html.push(parsed.html);
                    i = parsed.next;
                } else {
                    // Safety valve: never stall the parser on an odd line.
                    html.push('<p>' + renderInline(line) + '</p>');
                    i++;
                }
                continue;
            }

            // Paragraph: consume until a blank line or a new block starts.
            const para = [];
            while (i < lines.length && lines[i].trim() &&
                !/^\s*(```|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]) &&
                !(lines[i].includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]))) {
                para.push(lines[i++]);
            }
            if (para.length) html.push('<p>' + renderInline(para.join('\n')) + '</p>');
            else i++; // safety: never loop forever on an odd line
        }

        return html.join('\n');
    }

    /** `- item` / `* item` / `+ item` / `1. item` / `1) item` */
    const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

    /**
     * Parse a list starting at `start`.
     *
     * Returns the rendered HTML (including nested lists, which are attached to
     * the preceding item) and the index of the first unconsumed line. A blank
     * line ends the list, which matches how the project's docs are written.
     */
    function parseList(lines, start) {
        const first = LIST_ITEM.exec(lines[start]);
        const baseIndent = first[1].length;
        const ordered = /\d/.test(first[2]);
        const items = [];
        let i = start;

        while (i < lines.length) {
            const raw = lines[i];
            if (!raw.trim()) break;                       // blank line ends the list
            const match = LIST_ITEM.exec(raw);
            const indent = match ? match[1].length : Infinity;

            if (match && indent < baseIndent) break;       // back out to a parent list
            if (match && indent > baseIndent) {
                // Consume the deeper block and render it as a child list.
                const block = [];
                while (i < lines.length && lines[i].trim()) {
                    const inner = LIST_ITEM.exec(lines[i]);
                    if (inner && inner[1].length <= baseIndent) break;
                    block.push(lines[i]);
                    i++;
                }
                // Drop one nesting level so the child parses from column zero.
                const nested = parseList(block.map((l) => l.replace(/^ {1,4}/, '')), 0);
                if (items.length) items[items.length - 1].children.push(nested.html);
                continue;
            }
            if (!match) {
                if (items.length && /^\s+\S/.test(raw)) {  // wrapped continuation line
                    items[items.length - 1].text.push(raw.trim());
                    i++;
                    continue;
                }
                break;
            }

            items.push({ text: [match[3]], children: [] });
            i++;
        }

        const rendered = items.map((item) =>
            '<li>' + renderInline(item.text.join(' ')) + item.children.join('') + '</li>');

        const tag = ordered ? 'ol' : 'ul';
        return { html: `<${tag}>${rendered.join('')}</${tag}>`, next: i, count: items.length };
    }

    PG.Markdown = { renderMarkdown, renderInline, escapeHtml, slugify, safeHref };
})(typeof window !== 'undefined' ? window : globalThis);
