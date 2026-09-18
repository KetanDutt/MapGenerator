#!/usr/bin/env node
'use strict';

/**
 * serve.js — Zero-dependency static file server for local development.
 *
 *   node tools/serve.js            # http://localhost:8080
 *   node tools/serve.js 3000       # custom port
 *   PORT=9000 node tools/serve.js  # or via the environment
 *
 * Why not `python3 -m http.server`? This one sends correct MIME types for
 * `.js`/`.md`/`.json`, disables caching (so a reload always shows the latest
 * edit), and refuses to serve anything outside the repository root.
 *
 * It binds to 0.0.0.0 so the app is reachable from containers, VMs and remote
 * previews — not just from the machine running the server.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(path.join(__dirname, '..'));
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8'
};

const NOT_FOUND = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>404 — Not found</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; margin: 0; display: grid; place-items: center;
         min-height: 100vh; background: #f4f5f8; color: #181b23; }
  main { text-align: center; padding: 32px; }
  h1 { margin: 0 0 6px; font-size: 1.4rem; }
  p { margin: 0 0 18px; color: #4d5468; }
  a { color: #2e6bee; }
</style></head>
<body><main>
  <h1>404 — Not found</h1>
  <p>That file is not part of the project.</p>
  <a href="/index.html">Back to the level editor</a>
</main></body></html>`;

/** Resolve a request path to a file inside ROOT (or null when unsafe). */
function resolveTarget(requestPath) {
    let pathname;
    try {
        pathname = decodeURIComponent(requestPath.split('?')[0].split('#')[0]);
    } catch (_) {
        return null;
    }
    if (pathname === '/') pathname = '/index.html';
    const target = path.resolve(path.join(ROOT, pathname));
    // Path traversal guard: the resolved path must stay inside the root.
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
    return target;
}

function send(res, status, body, headers) {
    res.writeHead(status, Object.assign({
        'Cache-Control': 'no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
    }, headers || {}));
    res.end(body);
}

const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    const target = resolveTarget(req.url || '/');
    if (!target) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    fs.stat(target, (err, stats) => {
        if (err || !stats.isFile()) {
            send(res, 404, NOT_FOUND, { 'Content-Type': 'text/html; charset=utf-8' });
            return;
        }
        const type = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': stats.size,
            'Cache-Control': 'no-store, must-revalidate',
            'X-Content-Type-Options': 'nosniff'
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        fs.createReadStream(target).pipe(res);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try: node tools/serve.js ${PORT + 1}`);
    } else {
        console.error('Server error:', err.message);
    }
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    console.log(`Parking Lot Level Generator → http://localhost:${PORT}`);
    console.log(`Serving ${ROOT} (Ctrl+C to stop)`);
});
