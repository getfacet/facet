---
"@facet/ag-ui": minor
"@facet/agent": minor
"@facet/agent-client": minor
"@facet/agent-tools": minor
"@facet/assets": minor
"@facet/bridge": minor
"@facet/cli": minor
"@facet/client": minor
"@facet/core": minor
"@facet/quickstart": minor
"@facet/react": minor
"@facet/reference-agent": minor
"@facet/runtime": minor
"@facet/server": minor
"@facet/store-postgres": minor
---

Hard-cut Facet's style and design-system contract to one agent-friendly model.

- Every native Brick owns a closed `style` vocabulary: shared-looking target or
  property names on different Bricks are still separate Brick-owned contracts.
  Styles may be omitted, select a same-Brick Preset, use direct semantic token
  names, or combine a Preset with direct overrides. Raw CSS remains Theme-only.
- One complete per-agent Theme contains concrete token values, Brick defaults,
  and Presets. It cannot be selected from a Facet document. The host-owned
  `colorMode` switches the whole document between Theme light and dark paint.
- Patterns replace reusable reference trees. They are exact, read-only examples
  with discovery metadata; agents inspect them and then author ordinary Bricks.
- Agent discovery is progressive and bounded through `get_pattern`,
  `get_preset`, single-Brick `get_brick_spec`, and exact-path
  `get_style_choices`. Authoring errors are structured and atomic so an agent can
  retry, while the renderer still skips only invalid fragments.
- Assets are exactly `theme.json`, `patterns.json`, and optional
  `initial.tree.json` (or equivalent store fields). The former asset-policy,
  reference-tree, style-selector, subtree-palette, and document-Theme surfaces
  have no compatibility aliases or runtime conversion.

All in-repo consumers, storage adapters, prompts, tests, and documentation move
atomically to the new contract.
