---
"@facet/core": minor
"@facet/react": minor
"@facet/assets": minor
---

Landing-grade vocabulary: the closed token/brick set now reaches beyond
dashboard scale so an agent can compose a landing/marketing page — an
Apple/Browserbase-style full-height hero with large display type over a
background image, plus dark bands, gradients, and sticky sections — using only
tokens (no pixels, no raw CSS, no absolute positioning). Purely additive.

- `@facet/core`: `FONT_SIZES` extends with `4xl/5xl/6xl`; new closed token groups
  `MIN_HEIGHTS`, `MAX_WIDTHS`, `TRACKINGS`, `LEADINGS`, `GRADIENTS`, `SCRIMS`,
  paint tokens for dark Theme values, plus `HIGHLIGHTS`,
  wired into `BoxStyle`/`TextStyle`; `BoxNode` gains `backdrop?: NodeId` (paint a
  referenced media node as a bounded background layer) and `sticky`. `validateTree`
  validates them fail-safe; every group is operator-theme overridable; `STAGE_SPEC`
  teaches them (names only — no fetch/URL/raw CSS).
- `@facet/react`: `boxStyle`/`textStyle` map the new tokens to CSS; the renderer
  paints the `backdrop` as exactly two renderer-synthesized layers (media cover +
  readability scrim) at negative z-index inside a stacking-context host, so flow
  children always paint above them and no absolute positioning is ever emitted
  onto authored content. The client-owned `colorMode` selects the Theme's light
  or dark paint values for the whole rendered document. The
  backdrop resolves read-only to a media node only, through the existing
  safe-`src` gate, and counts against the render budget.
- `@facet/assets`: `DEFAULT_THEME` gains concrete default values for every new
  group plus a dark palette.

Note: `ResolvedTheme` (`@facet/react`) gains required fields — a minor-breaking
type widening only for an out-of-repo consumer that hand-builds a `ResolvedTheme`
literal (none in-repo; consumers normally obtain it from `resolveTheme`).
Deferred to later bundles: declarative motion, an icon vocabulary + `copy`
action, and pointer-reactive effect tokens (the last via the renderer extension
API).
