# Design system — “Liquid Glass”

The UI is a self-contained design system in `css/style.css` (+ `css/docs.css`
for the documentation viewer). There is no CSS framework and no preprocessor:
everything is driven by custom properties, so a theme change is a one-line
override and the whole palette stays consistent.

## Layers

| Layer | Contents |
| --- | --- |
| **0 — Ambient** | `.ambient`: static, very soft radial colour fields behind everything. |
| **1 — Content** | `.app-main` / `.docs-layout`; `--z-content`. |
| **3 — Glass surfaces** | Header, panels, sidebar, stage (`--z-header`). |
| **5 — Overlays** | Empty-lot hint, generation veil, route glow (`--z-sticky`). |
| **6 — Floating** | Drop-zone overlay and the SweetAlert layer (`--z-drop`, `--z-dialog`). |

## Tokens

All tokens live in `:root` and are re-declared (never re-invented) under
`[data-theme="dark"]`.

| Group | Examples | Notes |
| --- | --- | --- |
| Typography | `--font-sans`, `--font-mono` | System stacks only — no webfonts, no FOUT. |
| Radii | `--radius-xs` … `--radius-xl`, `--radius-pill` | |
| Motion | `--dur-1` (130 ms), `--dur-2` (220 ms), `--dur-3` (360 ms), `--ease-out`, `--ease-inout`, `--ease-spring` | Micro / standard / structural durations. |
| Blur | `--blur-1` … `--blur-3` | 14 / 22 / 32 px. |
| Colour | `--bg-0`, `--text-1..3`, `--accent-*`, `--success-*`, `--danger-*`, `--warning-*`, `--line-1..2` | |
| Glass | `--glass-1..3-bg`, `--glass-*-border`, `--inset-hi`, `--sheen` | Four material strengths (see below). |
| Grid | `--cell-size` (30 px), `--cell-gap` (4 px), `--asphalt-1..2`, `--car-*`, `--start-*`, `--end-*` | `--cell-size` is written by JS when zooming; the token itself stays the base size so “Fit” can read it. |
| Depth | `--shadow-1..3`, `--veil-bg`, `--drop-veil` | |

### Glass materials

| Class | Use | Backdrop |
| --- | --- | --- |
| `.glass-1` | Navigation, sidebar, dialogs — the most prominent surface | `blur(--blur-1)` |
| `.glass-2` | Panels, cards, grid stage | `blur(--blur-2)` |
| `.glass-3` | Floating toasts, the drop card | `blur(--blur-3)` |

Browsers without `backdrop-filter` get opaque equivalents through an
`@supports not (...)` block, so text contrast never depends on the blur.

## Components

- **Buttons** — `.btn` plus modifiers (`--primary`, `--secondary`, `--ghost`,
  `--tint-success`, `--tint-warning`, `--ghost-danger`, `--danger-state`,
  `--sm`). Toggle buttons add `.is-active` and `aria-pressed`.
- **Icon buttons** — `.icon-btn` (+ `--sm`, `--theme`).
- **Fields** — `.field`, `.field__input` (+ `--file`, `--select`),
  `.inputgroup`, `.check`, the `.switch` pair and the range slider
  (`.field__range`, with `--fill` painted by JS for WebKit).
- **Panels** — `.panel`, `.panel__head`, `.panel__tools`, `.panel__meta`.
- **Tools** — `.tool-grid` / `.tool` (icon + name + description + check mark).
- **Stats** — `.stats` / `.stat`, with the status chip as `.badge`
  (`.badge-ok` / `.badge-bad`).
- **Grid** — `.grid` + `.cell` variants (`lane-alt`, `start`, `end`, `car` with
  a pure-CSS direction arrow, `pulse`, `cursor`, `on-route`).
- **Icons** — `.icon`: an inline `<svg>` sized in `em` (so it matches the text it
  sits beside) and coloured by `currentColor` (so hover/active/theme states need
  no icon-specific rules). `.icon--lg` and `.icon-slot` cover the larger cases.
  There is no icon font.
- **Feedback** — `.mode-banner`, `.empty-state`, `.gen-veil` + `.spinner`,
  SweetAlert2 dialogs and toasts restyled to match.
- **Docs** — `.docs-layout`, `.docs-nav`, `.docs-toc`, `.docs-body` typography
  and `.md-*` blocks produced by the Markdown renderer.

## Motion rules

- Only `transform`, `opacity`, `background-color` and `box-shadow` are
  animated — no layout thrash, no `top/left` transitions.
- Entrances are one-shot: the staggered cell reveal (`.grid.enter .cell` with a
  per-cell `--i` custom property) is disarmed by JS after the animation window
  so it never re-runs during edits.
- State changes on a single cell get a short `.pulse`; the rest of the grid is
  never re-animated.
- `prefers-reduced-motion: reduce` collapses all durations and disables the
  staggered reveal, the floating drop icon and the pulsing status dot.

## Accessibility

- **Contrast** — text tokens are chosen to clear WCAG AA on their surfaces in
  both themes; the glass tints stay light/dark enough for the opaque fallback.
- **Focus** — a global `:focus-visible` ring (2 px accent, 2 px offset) plus a
  skip link on both pages.
- **Keyboard** — the grid is focusable and fully drivable; dialogs trap focus;
  every control is a real `<button>`/`<input>`/`<select>`.
- **Screen readers** — cells expose `role="gridcell"` with descriptive labels,
  the cursor is announced via `aria-activedescendant`, and a polite live region
  reports level status, edits and undo.
- **Motion/zoom** — no parallax or auto-playing animation, and the zoom controls
  plus “Fit” let users pick a comfortable cell size.

## Extending the UI

1. Add tokens first; only hard-code values when the value is genuinely
   one-off (and add a comment saying why).
2. Build new components from the existing materials and radii so light/dark
   parity is automatic.
3. Keep the grid geometry driven by `--cell-size`, and size any decoration in
   `em`/`calc(var(--cell-size) * …)` so zoom keeps proportions.
4. If JS toggles a class, add the rule in `css/style.css` — the test suite
   fails when a JS-toggled class has no rule.
5. Check `prefers-reduced-motion` and the `@supports not (backdrop-filter)`
   fallback before calling a component finished.
