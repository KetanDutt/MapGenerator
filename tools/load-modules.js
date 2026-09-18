'use strict';

/**
 * load-modules.js — Load the browser modules into a Node.js process.
 *
 * The app's modules are plain IIFEs that attach themselves to
 * `globalThis.ParkingGen`. Evaluating their source in the current global scope
 * reproduces the `<script>`-tag environment without a `jsdom` dependency, so
 * the whole logic layer stays testable with zero installs.
 *
 * Shared by `tools/test.js` and any script that needs the model. `js/app.js` is
 * deliberately absent — it is a controller and expects a DOM; the UI suite boots
 * it separately inside `tools/dom-stub.js`.
 */

const fs = require('fs');
const path = require('path');

/** Modules in dependency order (mirrors index.html). */
const MODULE_FILES = [
    'js/icons.js',
    'js/rng.js',
    'js/pathfinding.js',
    'js/level.js',
    'js/share.js',
    'js/image.js',
    'js/markdown.js'
];

/**
 * Evaluate the app modules and return the `ParkingGen` namespace.
 *
 * @param {string} [root] Repository root (defaults to the parent of tools/).
 * @param {string[]} [files] Override the module list.
 * @returns {object} globalThis.ParkingGen
 */
function loadParkingGen(root, files) {
    const base = root || path.join(__dirname, '..');
    (files || MODULE_FILES).forEach((rel) => {
        const file = path.join(base, rel);
        const code = fs.readFileSync(file, 'utf8');
        // eslint-disable-next-line no-new-func
        new Function(code).call(globalThis);
    });
    if (!globalThis.ParkingGen) throw new Error('ParkingGen namespace was not created.');
    return globalThis.ParkingGen;
}

module.exports = { loadParkingGen, MODULE_FILES };
