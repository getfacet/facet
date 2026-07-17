---
"@facet/core": minor
"@facet/agent": minor
"@facet/react": minor
"@facet/runtime": minor
"@facet/quickstart": minor
"@facet/server": minor
"@facet/client": minor
---

Themes and Patterns as data — reskin and pre-seed a Facet page without touching
code. Per-agent assets contain one complete Theme, one exact Pattern list, and
an optional initial tree. The LLM sees semantic token/Preset names but never raw
Theme CSS values. Pattern bodies stay out of the system prompt: the prompt holds
only a validated name/description/useWhen index and the provider may fetch one
complete Pattern with the read-only `get_pattern` tool. No new protocol message
is introduced; Theme paint and the initial stage ship inline in the quickstart
shell while Pattern reads remain provider-side.

PRE-1.0 BREAKING (in-repo consumers all updated): `FacetRuntime.handle` and
`applyMessages` now return `TurnResult` (`{ messages, agentMutated }`) instead
of a bare message array, so transports can tell a real agent edit from the
prepended seed frame (`@facet/server` gates its late-result staleness bookkeeping
on `agentMutated`; `@facet/client`'s `LocalTransport` updated).

Convergence by construction: the new `@facet/core` `foldPatchIntoStage`
(batch-atomic apply → bounded per-op salvage honoring RFC 6902 `test` guards →
`validateTree`) runs identically in `FacetRuntime` and `useFacet`, so the stored
and live trees cannot drift; a turn's patch messages coalesce into one folded
frame, and patch batches are capped at `MAX_PATCH_OPS` at the wire, the fold,
and the salvage clone.

- `@facet/core`: `FacetTheme` + `validateTheme` — the one safety gate where raw
  CSS enters, as OPERATOR data only (per-group token-name allowlist,
  `url()`/`var()`/`expression()`/`javascript:` denied, dimensions clamped, hostile
  keys never resolve, WCAG contrast measured as a warning never a rejection);
  `FacetPattern` + `validatePattern`; the `STAGE_SPEC` closed authoring rules.
- `@facet/agent`: native stage authoring remains RFC 6902-only; Theme is host
  asset data and cannot be selected from the document.
- `@facet/react`: `DEFAULT_THEME`, `ResolvedTheme`, `resolveTheme`; the style fns
  gain a defaulted trailing theme parameter (zero-arg output byte-identical);
  `StageRenderer` gains one optional `theme` prop. ChatDock keeps the default
  palette.
- `@facet/runtime`: the `AssetsStore` registry adapter (`MemoryAssets`, plus
  `FileAssets` behind `@facet/runtime/node`), `loadAssets` (runs the core
  validators once at boot, skips invalid documents with logged issues), and
  `withInitialStage` — a `StageStore` decorator that seeds fresh sessions from a
  validated initial tree inside the runtime's serialized write path; the seed
  travels the patch channel as the first versioned frame of the seeding turn (and
  the quickstart shell also ships it for an instant first paint).
- `@facet/assets`: node-free default-asset DATA (deps = `@facet/core` only) —
  `DEFAULT_THEME` and `DEFAULT_PATTERNS` (hero, card, cta-button, and more as
  validated Patterns), the single source of default-Theme truth
  (`@facet/react` derives its floor from it; `loadAssets` seeds it as the base
  layer).
- `@facet/quickstart`: `--assets <dir>` reads only `theme.json`,
  `patterns.json`, and `initial.tree.json`; injects compact Pattern, Preset, and
  Brick indexes; exposes exact `get_pattern`, `get_preset`, `get_brick_spec`, and
  `get_style_choices` reads; and inlines the escaped Theme into the shell. After
  discovery the model authors ordinary native stage nodes through existing
  mutation tools. With no `--assets`, bundled defaults apply.

(`@facet/*` are versioned together as a fixed group.)
