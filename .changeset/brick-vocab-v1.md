---
"@facet/core": minor
"@facet/react": minor
"@facet/quickstart": minor
"@facet/server": minor
---

Brick/token vocabulary v1: `image` becomes `media` (`kind:"image"|"video"`) with
legacy image-tree normalization, native field controls gain
`checkbox`/`radio`/`select`/`switch` plus capped `options`, and box layout gains
`scroll:"x"|"y"` plus `columns(2|3|4)`.

The new vocabulary is validated through the stored tree/fold/composition path and the
raw React render path. Unsafe media URLs are skipped, unknown media kinds and
missing sources degrade fail-safe, checked boolean controls collect `true` while
unchecked boolean controls and unselected radio groups omit their collected field
key, and horizontal scroll is bounded so the page does not widen.
