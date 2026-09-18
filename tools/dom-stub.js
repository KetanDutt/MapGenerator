'use strict';

/**
 * dom-stub.js — A tiny DOM/browser stub, just big enough to run `js/app.js`
 * under Node.
 *
 * Why hand-roll one instead of using jsdom? The project deliberately has zero
 * dependencies and must stay installable/CI-runnable with nothing but Node.
 * Roughly 300 lines of stub buys the highest-value test we can get for a
 * zero-build UI: actually *executing* the controller — booting the app,
 * clicking a tool, painting cars, undoing, exporting — instead of only
 * statically checking that ids line up.
 *
 * Supported: HTML parsing of the project's own (well-formed) markup, an
 * element tree with `classList`/`dataset`/attributes/`innerHTML`/`textContent`,
 * event listener registration plus bubbling dispatch, `getComputedStyle` with
 * the app's CSS custom properties, a canvas stub, `localStorage`,
 * `requestAnimationFrame` and the handful of window/document APIs the
 * controller touches.
 */

/* ------------------------------- Elements ------------------------------- */

class ClassList {
    constructor(element) {
        this.element = element;
        this.names = new Set();
    }

    add() {
        [...arguments].forEach((name) => String(name).split(/\s+/).filter(Boolean)
            .forEach((n) => this.names.add(n)));
        this._sync();
    }

    remove() {
        [...arguments].forEach((name) => this.names.delete(String(name)));
        this._sync();
    }

    toggle(name, force) {
        const key = String(name);
        const want = force === undefined ? !this.names.has(key) : Boolean(force);
        if (want) this.names.add(key);
        else this.names.delete(key);
        this._sync();
        return want;
    }

    contains(name) {
        return this.names.has(String(name));
    }

    _sync() {
        this.element._className = [...this.names].join(' ');
    }

    toString() {
        return [...this.names].join(' ');
    }
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

class Element {
    constructor(tagName, ownerDocument) {
        this.tagName = String(tagName || 'div').toUpperCase();
        this.ownerDocument = ownerDocument || null;
        this.parentNode = null;
        this.childNodes = [];
        this.attributes = new Map();
        this.dataset = {};
        this.style = createStyle();
        this.listeners = new Map();
        this.classList = new ClassList(this);
        this._className = '';
        this._textContent = '';
        this._innerHTML = '';
        this._id = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.title = '';
        this.href = '';
        this.src = '';
        this.type = '';
        this.name = '';
        this.files = [];
        this.nodes = null;
        this.scrollTop = 0;
        this._stubCanvas = this.tagName === 'CANVAS';
    }

    /* ---- identity ---- */
    get id() { return this._id; }

    set id(value) {
        const previous = this._id;
        this._id = String(value || '');
        if (this.ownerDocument) this.ownerDocument._registerId(this, previous);
    }

    get className() { return this._className; }

    set className(value) {
        this._className = String(value || '');
        this.classList.names = new Set(this._className.split(/\s+/).filter(Boolean));
    }

    get children() {
        return this.childNodes.filter((node) => node instanceof Element);
    }

    get firstChild() {
        return this.childNodes[0] || null;
    }

    /* ---- tree ---- */
    appendChild(child) {
        if (child && child.__fragment) {
            child.childNodes.slice().forEach((node) => this.appendChild(node));
            child.childNodes.length = 0;
            return child;
        }
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    insertBefore(child, reference) {
        const index = this.childNodes.indexOf(reference);
        child.parentNode = this;
        if (index === -1) this.childNodes.push(child);
        else this.childNodes.splice(index, 0, child);
        return child;
    }

    removeChild(child) {
        const index = this.childNodes.indexOf(child);
        if (index !== -1) this.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
    }

    /* ---- attributes ---- */
    setAttribute(name, value) {
        const key = String(name);
        this.attributes.set(key, String(value));
        if (key === 'id') this.id = value;
        if (key === 'class') this.className = value;
        if (key === 'style') this.style.cssText = String(value);
        if (key === 'disabled') this.disabled = true;
        if (key === 'checked') this.checked = true;
        if (key.startsWith('data-')) {
            const camel = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[camel] = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(String(name));
    }

    removeAttribute(name) {
        const key = String(name);
        this.attributes.delete(key);
        if (key === 'id') this.id = '';
    }

    /* ---- content ---- */
    get textContent() {
        if (this.childNodes.length === 0) return this._textContent;
        return this.childNodes.map((node) => (node instanceof Element
            ? node.textContent
            : node.text)).join('');
    }

    set textContent(value) {
        this.childNodes.length = 0;
        this._textContent = String(value === undefined || value === null ? '' : value);
        this._innerHTML = '';
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        const html = String(value === undefined || value === null ? '' : value);
        this._innerHTML = html;
        this.childNodes.length = 0;
        this._textContent = '';
        if (!html.trim()) return;
        // Only the app's own simple markup is parsed back (icons in buttons).
        if (html.indexOf('<') === 0 && this.ownerDocument) {
            this.ownerDocument._parseInto(this, html);
        } else {
            this._textContent = html;
        }
    }

    /* ---- events ---- */
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
    }

    removeEventListener(type, handler) {
        const list = this.listeners.get(type);
        if (!list) return;
        const index = list.indexOf(handler);
        if (index !== -1) list.splice(index, 1);
    }

    /** Fire listeners on this element only. */
    fire(type, event) {
        const handlers = this.listeners.get(type) || [];
        const payload = Object.assign({
            type,
            target: this,
            currentTarget: this,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.propagationStopped = true; }
        }, event || {});
        handlers.slice().forEach((handler) => handler.call(this, payload));
        return payload;
    }

    /** Fire listeners on this element and its ancestors (simple bubbling). */
    emit(type, event) {
        let node = this;
        let payload = null;
        while (node) {
            payload = node.fire(type, Object.assign({}, event, { target: this }));
            if (payload.propagationStopped) break;
            node = node.parentNode;
        }
        if (this.ownerDocument) {
            this.ownerDocument.fireWindow(type, Object.assign({}, event, { target: this }));
        }
        return payload;
    }

    click() {
        this.emit('click', {});
    }

    focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
        this.fire('focus', {});
    }

    blur() {
        this.fire('blur', {});
    }

    select() { /* no-op */ }

    scrollIntoView() { /* no-op */ }

    /* ---- layout ---- */
    get offsetWidth() { return 100; }

    get clientWidth() { return 800; }

    get clientHeight() { return 600; }

    getBoundingClientRect() {
        return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    }

    /* ---- selectors (the small subset the app uses) ---- */
    matches(selector) {
        const sel = String(selector).trim();
        const tagMatch = /^([a-zA-Z]+)/.exec(sel);
        if (tagMatch && this.tagName !== tagMatch[1].toUpperCase()) return false;
        const classMatch = /\.([\w-]+)/.exec(sel);
        if (classMatch && !this.classList.contains(classMatch[1])) return false;
        const idMatch = /#([\w-]+)/.exec(sel);
        if (idMatch && this.id !== idMatch[1]) return false;
        const attrMatches = sel.match(/\[([\w-]+)(?:="([^"]*)")?\]/g) || [];
        return attrMatches.every((raw) => {
            const parsed = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(raw);
            if (!this.hasAttribute(parsed[1])) return false;
            return parsed[2] === undefined || this.getAttribute(parsed[1]) === parsed[2];
        });
    }

    querySelector(selector) {
        const stack = this.children.slice();
        while (stack.length) {
            const node = stack.shift();
            if (node.matches(selector)) return node;
            stack.push(...node.children);
        }
        return null;
    }

    querySelectorAll(selector) {
        const out = [];
        const stack = this.children.slice();
        while (stack.length) {
            const node = stack.shift();
            if (node.matches(selector)) out.push(node);
            stack.push(...node.children);
        }
        return out;
    }

    /* ---- canvas ---- */
    getContext() {
        return this._context || (this._context = createCanvasContext(), this._context);
    }

    toBlob(callback) {
        callback({ type: 'image/png', size: 1024, __blob: true });
    }

    toDataURL() {
        return 'data:image/png;base64,iVBORw0KGgo=';
    }
}

class TextNode {
    constructor(text) {
        this.text = text;
        this.parentNode = null;
        this.nodeType = 3;
    }
}

/* ------------------------------ Factories ------------------------------- */

function createStyle() {
    const style = {
        cssText: '',
        _props: new Map(),
        setProperty(name, value) {
            style._props.set(String(name), String(value));
            style[toCamel(String(name))] = String(value);
        },
        getPropertyValue(name) {
            return style._props.has(String(name)) ? style._props.get(String(name)) : '';
        },
        removeProperty(name) {
            style._props.delete(String(name));
        }
    };
    return style;
}

function toCamel(prop) {
    return prop.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function createCanvasContext() {
    const noop = () => {};
    return {
        canvas: null,
        scale: noop,
        save: noop,
        restore: noop,
        translate: noop,
        rotate: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        arcTo: noop,
        rect: noop,
        roundRect: noop,
        fill: noop,
        stroke: noop,
        fillRect: noop,
        strokeRect: noop,
        fillText: noop,
        setLineDash: noop,
        measureText: (text) => ({ width: String(text).length * 7 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        drawImage: noop,
        clearRect: noop
    };
}

/* ------------------------------- Document ------------------------------- */

class DomStub {
    constructor() {
        this.window = null;                       // set to the global object on install
        this.windowListeners = new Map();
        this.documentElement = new Element('html', this);
        this.body = new Element('body', this);
        this.head = new Element('head', this);
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);

        this.idIndex = new Map();
        this.readyState = 'complete';
        this.title = '';
        this.visibilityState = 'visible';
        this.activeElement = null;
        this.styleSheets = [];
        this.listeners = new Map();
        this.elementFromPointResult = null;
        this.elementFromPoint = () => this.elementFromPointResult;
        this.execCommand = () => true;
        this.createElement = (tag) => new Element(tag, this);
        this.createDocumentFragment = () => {
            const fragment = new Element('#fragment', this);
            fragment.__fragment = true;
            return fragment;
        };
        this.querySelector = (selector) => this.body.querySelector(selector);
        this.querySelectorAll = (selector) => this.body.querySelectorAll(selector);
        this.addEventListener = (type, handler) => {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(handler);
        };
        this.removeEventListener = (type, handler) => {
            const list = this.listeners.get(type) || [];
            const index = list.indexOf(handler);
            if (index !== -1) list.splice(index, 1);
        };
    }

    _registerId(element, previous) {
        if (previous && this.idIndex.get(previous) === element) this.idIndex.delete(previous);
        if (element.id) this.idIndex.set(element.id, element);
    }

    getElementById(id) {
        const found = this.idIndex.get(String(id));
        if (found) return found;
        // Fall back to a tree walk for elements created before ids were indexed.
        const stack = this.documentElement.children.slice();
        while (stack.length) {
            const node = stack.shift();
            if (node.id === String(id)) {
                this.idIndex.set(node.id, node);
                return node;
            }
            stack.push(...node.children);
        }
        return null;
    }

    /** Fire a document-level listener (with window fallthrough). */
    fire(type, event) {
        const handlers = this.listeners.get(type) || [];
        const payload = Object.assign({
            type,
            target: this,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.propagationStopped = true; }
        }, event || {});
        handlers.slice().forEach((handler) => handler(payload));
        if (!payload.propagationStopped) this.fireWindow(type, payload);
        return payload;
    }

    /** Fire window-level listeners (globalThis when installed). */
    fireWindow(type, event) {
        const handlers = this.windowListeners.get(type) || [];
        const payload = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, event || {});
        handlers.slice().forEach((handler) => handler(payload));
        return payload;
    }

    addWindowListener(type, handler) {
        if (!this.windowListeners.has(type)) this.windowListeners.set(type, []);
        this.windowListeners.get(type).push(handler);
    }

    removeWindowListener(type, handler) {
        const list = this.windowListeners.get(type) || [];
        const index = list.indexOf(handler);
        if (index !== -1) list.splice(index, 1);
    }

    /** Parse a fragment of markup into `parent` (very small subset). */
    _parseInto(parent, html) {
        const tokens = String(html).match(/<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/g) || [];
        const stack = [parent];
        tokens.forEach((token) => {
            if (token.startsWith('<!')) return;
            if (token.startsWith('</')) {
                if (stack.length > 1) stack.pop();
                return;
            }
            if (token.startsWith('<')) {
                const selfClosing = /\/>$/.test(token);
                const match = /^<\s*([a-zA-Z0-9-]+)([\s\S]*)$/.exec(token.replace(/\/>$/, '>'));
                if (!match) return;
                const tag = match[1];
                const element = new Element(tag, this);
                const attrs = match[2].match(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g) || [];
                attrs.forEach((raw) => {
                    const parsed = /^([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?$/.exec(raw);
                    if (!parsed) return;
                    const value = parsed[2] !== undefined ? parsed[2]
                        : parsed[3] !== undefined ? parsed[3]
                            : parsed[4] !== undefined ? parsed[4] : '';
                    element.setAttribute(parsed[1], value);
                });
                const top = stack[stack.length - 1];
                top.appendChild(element);
                if (!selfClosing && !VOID_TAGS.has(tag.toLowerCase())) stack.push(element);
                return;
            }
            const top = stack[stack.length - 1];
            top.childNodes.push(new TextNode(token));
        });
    }

    /** Build a fully formed document from HTML source. */
    loadHtml(html) {
        this.body.childNodes.length = 0;
        this.head.childNodes.length = 0;
        this._parseInto(this.body, html);
        // Move anything that belongs in <head> (meta/link/title/style).
        this.body.childNodes.slice().forEach((node) => {
            if (node instanceof Element && ['META', 'LINK', 'TITLE', 'STYLE'].includes(node.tagName)) {
                this.body.removeChild(node);
                this.head.appendChild(node);
            }
        });
        this.body.children.forEach((element) => walk(element, (node) => {
            if (node.id) this.idIndex.set(node.id, node);
        }));
        return this;
    }
}

function walk(node, visit) {
    visit(node);
    node.children.forEach((child) => walk(child, visit));
}

/* --------------------------- Virtual clock ------------------------------ */

/**
 * A controllable clock so timer-driven behaviour (the generation deferral, the
 * JSON throttle, session debounce, toast dedupe) can be tested deterministically
 * instead of sleeping.
 */
function createClock(startAt) {
    let now = startAt || 1700000000000;
    let sequence = 0;
    const timers = new Map();

    return {
        now: () => now,
        setTimeout(fn, delay) {
            const id = ++sequence;
            timers.set(id, { fn, at: now + (Number(delay) || 0), id });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        /** Run every timer due within `ms`, in time order, then advance. */
        advance(ms) {
            const target = now + (Number(ms) || 0);
            let guard = 0;
            while (guard++ < 10000) {
                let next = null;
                timers.forEach((timer) => {
                    if (timer.at <= target && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) {
                        next = timer;
                    }
                });
                if (!next) break;
                timers.delete(next.id);
                now = Math.max(now, next.at);
                next.fn();
            }
            now = target;
        },
        pending: () => timers.size
    };
}

/* -------------------------------- Install ------------------------------- */

/**
 * Install the stub onto `globalThis` and return the document.
 *
 * @param {string} html Markup to parse into the document body.
 * @returns {object} The document stub (with `.window`).
 */
function installDom(html, options) {
    const opts = options || {};
    const doc = new DomStub();
    if (html) doc.loadHtml(html);

    const g = globalThis;
    const clock = createClock();
    doc.clock = clock;
    if (opts.fakeTimers !== false) {
        g.setTimeout = (fn, delay) => clock.setTimeout(fn, delay);
        g.clearTimeout = (id) => clock.clearTimeout(id);
        g.setInterval = (fn, delay) => clock.setTimeout(fn, delay);
        g.clearInterval = (id) => clock.clearTimeout(id);
        g.Date.now = () => clock.now();
    }
    // In a browser `window` *is* the global object, and the app relies on that
    // (it reads `global.document`, `global.setTimeout`, `global.Swal`, …).
    g.window = g;
    doc.window = g;
    g.document = doc;
    g.addEventListener = (type, handler) => doc.addWindowListener(type, handler);
    g.removeEventListener = (type, handler) => doc.removeWindowListener(type, handler);
    g.getComputedStyle = () => ({
        paddingLeft: '20px',
        paddingRight: '20px',
        getPropertyValue(name) {
            if (name === '--cell-size') return '30px';
            if (name === '--cell-gap') return '4px';
            if (name === '--veil-bg') return 'rgba(0,0,0,0.5)';
            return '';
        }
    });
    g.requestAnimationFrame = (cb) => g.setTimeout(() => cb(g.Date.now()), 0);
    g.cancelAnimationFrame = (id) => g.clearTimeout(id);
    g.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    g.scrollTo = () => {};
    g.scrollY = 0;
    g.alert = () => {};
    g.confirm = () => true;
    g.prompt = () => null;
    g.URL.createObjectURL = () => 'blob:stub';
    g.URL.revokeObjectURL = () => {};
    g.Blob = class Blob {
        constructor(parts, options) {
            this.parts = parts || [];
            this.type = (options && options.type) || '';
            this.size = this.parts.join('').length;
        }
    };
    g.FileReader = class FileReader {
        readAsText(file) {
            this.result = file && file.__text ? file.__text : '';
            if (this.onload) this.onload({ target: { result: this.result } });
        }
    };
    g.XMLHttpRequest = class XMLHttpRequest {
        open() {}
        send() { if (this.onerror) this.onerror(new Error('stub')); }
    };

    const store = new Map();
    Object.keys(opts.storage || {}).forEach((k) => store.set(String(k), String(opts.storage[k])));
    g.localStorage = {
        getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: (key) => { store.delete(String(key)); },
        clear: () => store.clear(),
        get length() { return store.size; }
    };

    // Node exposes `navigator` as a getter-only global, so define rather than
    // assign. A missing clipboard API is fine — app.js then exercises its
    // textarea fallback, which is what we want covered anyway.
    try {
        Object.defineProperty(g, 'navigator', {
            value: Object.assign({}, g.navigator, {
                clipboard: { writeText: () => Promise.resolve() }
            }),
            configurable: true,
            writable: true
        });
    } catch (_) { /* keep whatever the runtime provides */ }

    const location = {
        href: 'http://localhost/index.html',
        origin: 'http://localhost',
        pathname: '/index.html',
        search: '',
        hash: ''
    };
    Object.assign(location, opts.location || {});
    g.location = location;
    g.history = { replaceState() {}, pushState() {} };

    return doc;
}

module.exports = { installDom, createClock, Element, TextNode, DomStub };
