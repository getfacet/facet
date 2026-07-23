---
"@facet/core": minor
"@facet/assets": minor
"@facet/react": minor
"@facet/agent-tools": minor
---

Grow the closed `box` layout vocabulary so an agent can express product-grade
page structures — split panes, responsive grids, horizontal shelves, and
bounded viewports — without a new container Brick, a layout-mode enum, or any
raw CSS. `box` stays Facet's only container.

Core adds four orthogonal, additive properties plus one member on the existing
`columns` domain: `basis` and `itemWidth` (a new `layoutWidth` token domain —
`basis` holds a split-pane / shelf item at a pane width, `itemWidth` is the item
floor for an auto grid), `maxHeight` (a new `maxHeight` token domain that bounds
a box to its own scrolling viewport), a row-only `collapse` (`none`/`stack`),
and `columns:"auto"`. Each is wired at both the strict author boundary and the
fail-soft render boundary. `FacetThemeTokens` gains two required token groups
(`layoutWidth`, `maxHeight`): a Theme that spreads `...DEFAULT_THEME.tokens`
inherits them, but a **standalone** custom-theme literal must add both — a
pre-1.0 breaking change (an incomplete Theme falls back whole to `DEFAULT_THEME`).

The React renderer translates the new properties to flow-only CSS: `basis` →
`flex-basis` with no-shrink, `columns:"auto"` → a container-clamped
`repeat(auto-fit,minmax(min(itemWidth,100%),1fr))` grid, an authored `maxHeight`
that wins over the renderer's default scroll cap and brings its own overflow
containment, and `collapse:"stack"` as a framework-owned `@media` rule in the
per-stage stylesheet (no absolute positioning, no JS resize listener, nothing new
in the view snapshot) keyed to one renderer-owned narrow breakpoint that the
reported `view.viewport` classification shares. `@facet/assets` adds a looks-only
`rail` Preset and four validation Patterns (`app-shell`, `split-pane`,
`product-grid`, `media-shelf`); discovery prose and `STAGE_SPEC` enumerate the
new choices and the narrow-adaptation authority rule.
