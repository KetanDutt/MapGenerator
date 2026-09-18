# Vendored assets

Everything the app needs ships in this repository. There is no `npm install`,
no CDN request and no build step, so the editor works from a plain `file://`
open, from an air-gapped machine and from a USB stick.

| Path | What | Version | Licence |
| --- | --- | --- | --- |
| `sweetalert2/sweetalert2.min.js` | Dialog + toast library | 11.14.5 | MIT (`sweetalert2/LICENSE`) |
| `sweetalert2/sweetalert2.min.css` | Its stylesheet (themed in `css/style.css` §18) | 11.14.5 | MIT |
| `fontawesome-LICENSE.txt` | Licence for the icon artwork used by `js/icons.js` | — | CC BY 4.0 |

## Why vendor instead of link a CDN?

The project's promise is “open the HTML file and it works”. A CDN link breaks
that promise offline, leaks a request to a third party on every page load, and
can be swapped or taken down independently of this repository. The alternative —
a bundler plus `node_modules` — contradicts the zero-build design. Vendoring two
static files (~70 KB total) keeps both promises.

SweetAlert2 is used for confirmations, the resize dialog and toasts. It is
**optional**: `js/app.js` checks for `window.Swal` and falls back to
`alert`/`confirm`/`console`, so deleting this folder degrades the UI instead of
breaking it (the wiring test will remind you).

## Updating SweetAlert2

```bash
npm pack sweetalert2@<version>          # downloads the tarball only
tar -xzf sweetalert2-<version>.tgz
cp package/dist/sweetalert2.min.js  vendor/sweetalert2/
cp package/dist/sweetalert2.min.css vendor/sweetalert2/
cp package/LICENSE                  vendor/sweetalert2/
```

Then update the version in this table, reload `index.html`, and check the
dialog theme: `css/style.css` overrides `.swal2-*` colours with the app's design
tokens, so a major SweetAlert2 bump may need new selectors there.

## Icons

`js/icons.js` is a generated module holding the icon artwork as an inline SVG
sprite (mounted at runtime, so it works over `file://`). The paths come from
**Font Awesome Free 6.5.2** (`@fortawesome/fontawesome-free`), which requires
attribution — that is what `fontawesome-LICENSE.txt` and the header comment in
`js/icons.js` are for.

To add an icon: copy the `d` attribute from the corresponding
`svgs/solid/<name>.svg` into the `ICONS` map in `js/icons.js` (keep the
`viewBox`), then use it as
`<svg class="icon"><use href="#i-<name>"></use></svg>`. The test suite fails if
a `<use>` reference has no matching symbol, so a typo cannot ship silently.
