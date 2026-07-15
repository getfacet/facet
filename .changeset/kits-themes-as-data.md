---
"@facet/core": minor
"@facet/agent": minor
"@facet/react": minor
"@facet/runtime": minor
"@facet/quickstart": minor
"@facet/server": minor
"@facet/client": minor
---

Kits & themes as data — reskin and pre-seed a Facet page without touching code.
Four additive layers, one flow, and the invariants hold: **the LLM never authors
theme values** (it selects a theme by NAME), **composition data stays out of the
system prompt** (the prompt contains only a validated name/description index;
the provider may fetch one complete concrete dataset on demand with the
read-only `get_composition` tool), and **no new protocol messages** are
introduced (the theme map and initial stage ship inline in the quickstart
shell, while composition reads remain provider-side).

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
  `FacetTree.theme?: string` (a name, kept-if-string by `validateTree`);
  `FacetComposition` + `validateComposition`; the `STAGE_SPEC` theme line
  (select-by-name).
- `@facet/agent`: `Stage.theme(name)` — one top-level RFC 6902 `add`.
- `@facet/react`: `DEFAULT_THEME`, `ResolvedTheme`, `resolveTheme`; the style fns
  gain a defaulted trailing theme parameter (zero-arg output byte-identical);
  `StageRenderer` gains an optional `themes` prop. ChatDock keeps the default
  palette.
- `@facet/runtime`: the `AssetsStore` registry adapter (`MemoryAssets`, plus
  `FileAssets` behind `@facet/runtime/node`), `loadAssets` (runs the core
  validators once at boot, skips invalid documents with logged issues), and
  `withInitialStage` — a `StageStore` decorator that seeds fresh sessions from a
  validated initial tree inside the runtime's serialized write path; the seed
  travels the patch channel as the first versioned frame of the seeding turn (and
  the quickstart shell also ships it for an instant first paint).
- `@facet/assets`: node-free default-asset DATA (deps = `@facet/core` only) —
  `DEFAULT_THEME` and `DEFAULT_COMPOSITIONS` (hero, card, cta-button, and more as
  validated compositions), the single source of default-theme truth
  (`@facet/react` derives its floor from it; `loadAssets` seeds it as the base
  layer).
- `@facet/quickstart`: `--assets <dir>` (reads `*.theme.json`,
  `*.composition.json`, `initial.tree.json`), theme names + descriptions and
  a validated composition name/description index injected into the prompt, a
  `set_theme` tool (a NAME argument only) plus `get_composition` (an exact,
  read-only lookup by listed name), and the escaped theme map inlined into the
  shell. After a read, the model authors ordinary native stage nodes through the
  existing tools. With no `--assets`, boot is byte-identical.

(`@facet/*` are versioned together as a fixed group.)
