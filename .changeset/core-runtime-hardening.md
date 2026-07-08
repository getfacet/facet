---
"@facet/core": patch
"@facet/runtime": patch
---

Close the core/runtime hardening pass. `@facet/core` now rejects JSON Patch
source reads and missing `replace`/`remove` targets before mutating, keeps patch
batch salvage non-throwing for hostile operation accessors, and aligns theme
color admission with contrast parsing for opaque hex, rgb/rgba, hsl/hsla, and a
conservative named-color table. `@facet/runtime` now keeps `loadAssets` fail-soft
across adapter rejects, malformed store shapes, hostile accessors/arrays,
oversized asset arrays, and initial-tree validation failures; returned asset
issues are bounded/sanitized; and `withInitialStage` preserves seed re-emission
across failed first saves, including committed seeds whose pending report was
evicted before the runtime could consume it.
