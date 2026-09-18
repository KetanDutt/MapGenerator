# Design system

The interface is a small design system, not a stylesheet that grew. Everything
is driven by custom properties declared in one place, there is no framework and
no preprocessor, and a theme is a single attribute on `<html>`.

The material language is **layered glass over a quiet background**: translucent
surfaces that sit at different depths, with the level itself always the deepest
thing on screen. Four rules keep it from turning into decoration:

1. **Text is never translucent.** Blur and tint apply to surfaces; ink colours
   are opaque and contrast-checked.
2. **Every surface is one of four materials** — no ad-hoc blends.
3. **Depth means something.** A surface only floats if it really is above
   something else (navigation, dialogs, toasts).
4. **Motion is short and cheap.** Transform/opacity only, 120–500 ms, and it
   names a state change — it never plays for its own sake.

## Files

| File | Contents |
| --- | --- |
| `css/style.css` | Tokens, reset, background field, materials, shared components (buttons, fields, header, footer, dialogs, toasts), utilities, motion, reduced-motion/print. |
| `css/editor.css` | The level editor: panels, form, toolbar, board and cells, tools, stats, JSON panel, drop overlay, editor responsive rules. |
| `css/docs.css` | The viewer: layout, document navigation, article, Markdown typography, loading/error states. |

Both pages load `style.css` first, then their own file, so a page can restyle a
shared primitive without touching the other page.

## Depth layers

| Layer | Z token | Contents |
| --- | --- | --- |
| **L0 — background** | *below everything* | Page wash (`body`) plus `.ambient` colour fields and the masked survey grid. |
| **L1 — content** | `--z-content` | `.app-main`, `.docs-layout`; text and controls. |
| **L2 — cards** | *in flow* | Panels, the board, the tool list, stats, the JSON well. |
| **L3 — navigation** | `--z-sticky`, `--z-header` | Sticky glass header and the compact mobile rail. |
| **L4 — overlays** | `--z-drop` | Drop-zone overlay, empty-lot hint, generation veil. |
| **L5 — dialogs** | `--z-dialog` | SweetAlert2 modals. |
| **L6 — toasts** | `--z-toast` | The in-app notification stack. |

## Tokens

All tokens live in `:root` and are re-declared (never re-invented) under
`[data-theme="dark"]`.

| Group | Tokens | Notes |
| --- | --- | --- |
| Type | `--font-sans`, `--font-mono`, `--fs-2xs`…`--fs-3xl`, `--lh-*`, `--track-*` | System stacks only — no webfonts, no layout shift. |
| Space | `--s-1`…`--s-9`, `--gutter`, `--shell` | 4 px rhythm. |
| Radius | `--r-xs`…`--r-2xl`, `--r-pill` | 8 → 30 px; chrome never mixes two radii on one edge. |
| Motion | `--dur-1`…`--dur-4`, `--ease-out`, `--ease-inout`, `--ease-spring`, `--ease-glide` | 140 / 220 / 320 / 460 ms. |
| Glass | `--glass-{strong,surface,panel,float}-{bg,bd,hi}`, `--glass-blur-{sm,md,lg,xl}`, `--glass-sat` | Materials below. |
| Fields | `--field-bg{-hover,-focus}`, `--field-bd`, `--hover-surface`, `--active-surface` | Every interactive surface. |
| Colour | `--bg-0/1`, `--bg-tint-a/b/c`, `--bg-vignette`, `--text-1..3`, `--accent-*`, `--success-*`, `--danger-*`, `--warning-*`, `--line-1..3` | `-1` for marks, `-ink` for text on the matching `-soft` tint. |
| Shadow | `--sh-1`…`--sh-4`, `--sh-accent` | All large, all soft, none blacker than 5 % at the centre. |
| Board | `--cell-size`, `--cell-gap`, `--asphalt-*`, `--car-*`, `--start-*`, `--end-*`, `--lane-tint`, `--route-tint` | `--cell-size` is rewritten by JS when zooming; the token stays the base size so “Fit” can read it. |
| Utility | `--chevron`, `--ring`, `--veil-bg`, `--drop-veil`, `--header-h`, `--z-*` | |

## Materials

| Class | Nominal role | Blur |
| --- | --- | --- |
| `.glass-1` | Navigation, dialogs — the most prominent surface | `--glass-blur-md` |
| `.glass-2` | Panels, cards, the board | `--glass-blur-sm` |
| `.glass-3` | Floating surfaces: toasts, the drop card, the mobile rail | `--glass-blur-lg` |

The `--glass-panel-*` tier is deliberately unused by a utility class: the board
(`.grid-wrapper`) drops to it so the level reads as the deepest surface in the
editor. Tinted states (badges, mode banner, tinted buttons) are *not* a glass
tier — they are opaque-enough tints built from `--*-soft` / `--*-line`.

Three safeguards keep the translucency honest:

- `@media (prefers-reduced-transparency: reduce)` swaps the materials for
  near-opaque equivalents.
- `@supports not (backdrop-filter: …)` raises the alpha of every material, so
  browsers without blur still get readable surfaces.
- Tinted text uses `--*-ink` colours that are contrast-checked against the tint
  itself, not against the page.

## Components

- **Buttons** — `.btn` (glass) plus `--primary` (soft-filled accent with a
  highlight and a gentle shadow), `--secondary`, `--ghost`, `--ghost-danger`,
  `--tint-success`, `--tint-warning`, `--danger-state`, `--sm`, `--shuffle`.
  Hover lifts 1 px, press scales to 0.975, disabled drops opacity *and*
  saturation. `.icon-btn` (+ `--sm`, `--theme`) shares the same state machine.
- **Fields** — `.field`, `.field__input` (+ `--file` with a styled picker
  button, `--select` with a tokenised chevron), `.inputgroup`, `.check`, the
  `.switch` pair, and the range slider (`.field__range`, whose filled portion is
  painted through `--fill` by JS for WebKit).
- **Header** — `.app-header` is a floating bar; `.scrolled` (set by JS once the
  page moves) fades in a gradient wash and deepens the shadow instead of
  hard-switching to a solid bar.
- **Mobile rail** — `.mobile-nav` is a compact bottom bar that appears below
  860 px, slides away while scrolling down, and marks the section in view with a
  single indicator that translates between links (`--i`).
- **Panels, tools, stats** — `.panel`, `.tool-grid`/`.tool` (icon + name +
  description + check mark), `.stats`/`.stat`/`.badge`.
- **Board** — `.grid-wrapper` (deepest glass, scrollable safety net) + `.grid` +
  `.cell` variants: `car` (CSS direction arrow, no image), `start`, `end`,
  `on-route`, `cursor`, `pulse`. Every dimension derives from `--cell-size`, so
  zooming keeps proportions at any size.
- **Feedback** — `.mode-banner`, `.empty-state` (with a real action button),
  `.gen-veil` + determinate `.progress`, `.toast` stack, and SweetAlert2
  dialogs restyled to the same material.
- **Docs** — `.docs-layout`, `.docs-nav`, `.docs-toc`, `.docs-body` typography
  and the `.md-*` blocks produced by the Markdown renderer, plus a
  content-shaped skeleton (`.docs-skeleton`) while a document loads.
- **Icons** — `.icon`: an inline `<svg>` sized in `em` (so it matches the text
  beside it) and coloured by `currentColor` (so hover/active/theme states need
  no icon-specific rules). There is no icon font.

## Motion

| Band | Duration | Used for |
| --- | --- | --- |
| Micro | `--dur-1` (140 ms) | Hover, press, icons |
| Standard | `--dur-2` (220 ms) | Focus, colour/border state changes |
| Structural | `--dur-3` (320 ms) | Panels, banner, rail, cell reveal |
| Entrance | `--dur-4` (460 ms) | Dialogs, toasts, page reveal |

- Only `transform`, `opacity`, `background-color`, `box-shadow` and `filter`
  are animated — no layout thrash, no animated `top`/`left`/`width`.
- Entrances are one-shot: the staggered cell reveal (`.grid.enter .cell`, using
  a per-cell `--i`) is disarmed by JS after the animation window so it never
  re-runs during edits; the content column staggers from `.app-main > *`.
- Nothing animates `backdrop-filter`, and no blur layer is animated on a loop:
  the ambient fields are static, so blur cost is paid once.
- The only infinite animations are the loading spinner and the floating hint on
  the drop target — both exist only while a transient state is on screen. The
  document skeleton is a static placeholder for the same reason.
- Interactive motion uses `--ease-spring`; structural motion uses `--ease-out` /
  `--ease-glide`. Bounce is capped at ~1.3.
- `prefers-reduced-motion: reduce` collapses every duration, removes the
  staggered reveal, the floating icons, the pulsing dot and the toast countdown
  bar, and disables hover lifts — state changes stay visible, they just stop
  moving.

## Accessibility

- **Contrast** — `--text-1/2/3` and every `-ink` colour clear WCAG AA (4.5:1)
  against the wash *and* against the brightest glass in both themes; the audit
  numbers are reproducible from the token values.
- **Focus** — a global `:focus-visible` ring (2 px accent, 2 px offset) on top
  of the per-component focus states, plus a skip link on both pages.
- **Keyboard** — the grid is focusable and fully drivable; dialogs trap focus;
  every control is a real `<button>`/`<input>`/`<select>`/`<label>`.
- **Screen readers** — cells expose `role="gridcell"` with descriptive labels,
  the cursor is announced via `aria-activedescendant`, a polite live region
  reports status, edits and generation, and toasts are announced by the toast
  host (`role="alert"` for errors, `role="status"` otherwise) instead of
  competing with it.
- **Motion/zoom** — no parallax, no auto-playing animation, and the zoom
  controls plus “Fit” let users pick a comfortable cell size.
- **Touch** — the board pans with one finger when no tool is selected and
  switches to paint-only gestures (`touch-action: none`) while a tool is armed.

## Extending the UI

1. Add tokens first; only hard-code a value when it is genuinely one-off (and
   say why in a comment).
2. Reuse a material, a radius scale step and an existing duration band — a new
   component should not introduce a new blur or easing.
3. Keep board geometry driven by `--cell-size`, and size decorations in
   `em`/`calc(var(--cell-size) * …)` so zoom keeps proportions.
4. If JS toggles a class, add the rule in one of the `css/*.css` files — the
   suite fails when a JS-toggled class has no rule, and when markup uses a class
   that no stylesheet defines.
5. Check `prefers-reduced-motion`, `prefers-reduced-transparency` and the
   `@supports not (backdrop-filter)` fallback before calling a component done.
