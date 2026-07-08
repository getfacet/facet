---
"@facet/agent-tools": patch
"@facet/reference-agent": patch
---

Add a reusable Facet agent prompt kit to `@facet/agent-tools`. Custom LLM/tool
loops can now import shared Facet guidance for `STAGE_SPEC`, compact page UX,
edit-before-append behavior, tool-result recovery, and theme/stamp metadata
privacy without depending on the reference agent.

`@facet/reference-agent` now delegates its fixed Facet system-prompt sections to
that shared kit while keeping its existing `buildSystem(guide, assets?)`,
`PromptAssets`, and `TOOLS` compatibility surface.
