---
"@facet/core": minor
"@facet/react": minor
"@facet/quickstart": patch
---

Renderer transitions v1: `useFacet` now exposes renderer-local transition
metadata, and `StageRenderer` can use it to smooth live patch updates with
brick-level enter/exit motion or a stage crossfade for root document writes and
large edits.

- `@facet/core`: `StageFoldResult.rootReplaced?: boolean` reports whether an
  actually-applied patch op wrote the root document, so renderers do not guess
  from raw patch shape after salvage.
- `@facet/react`: new `StageTransitionHint`, `UseFacetState.transition`, and
  optional `StageRendererProps.transition`; same-id updates remain immediate,
  exiting visuals are inert, and reduced-motion users get the final UI without
  animation.
- `@facet/quickstart`: the built page wires `transition` from `useFacet` into
  `StageRenderer`, enabling root-replace crossfades in the default live surface.
