---
"@facet/core": minor
"@facet/react": minor
"@facet/agent-tools": minor
---

Raise the `chart` and `table` Bricks to a product-grade analytics surface
without adding a Brick or opening the style vocabulary. Core gains four closed,
extensible additions: a per-series `axis` choice (`primary`/`secondary`), a
per-column `width` choice (`auto`/`narrow`/`medium`/`wide`), table-root
`dividers` (`none`/`rows`/`grid`) and `stickyHeader` style properties, and a
bounded `emptyLabel` field — each wired at both the strict author boundary and
the fail-soft render boundary.

The React renderer rebuilds chart geometry around a larger plot area,
step-aligned tick values, compact tick labels, grid-behind-marks and
comparison-under-current line layering, and independent primary/secondary value
scales when series select them; with no secondary assignment a chart renders
exactly as before. The table renderer owns its bounded horizontal scroll region
so a wide grid never pushes its parent, pins a header inside that same
renderer-owned region at a framework-owned offset and height, allocates closed
column widths, draws row/column dividers, and renders an authored empty-state
label. Discovery prose and `STAGE_SPEC` enumerate the new choices.

Two adjacent corrections ride along: `textWrap: "nowrap"` now clips flowing text
with an ellipsis at its container edge instead of letting the line paint past it
(a table keeps its own bounded scroll instead), and Core's renderability
predicate finally counts a valid `kind: "icon"` media node as content, so an
icon-only change is no longer reported to the agent as invisible.
