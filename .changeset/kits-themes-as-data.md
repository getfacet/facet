---
"@facet/core": minor
"@facet/agent": minor
"@facet/react": minor
"@facet/runtime": minor
"@facet/kit": minor
"@facet/quickstart": minor
---

Kits & themes as data — reskin and pre-seed a Facet page without touching code.
Four additive layers, one flow, and the invariants hold: **the LLM never authors
theme values** (it selects a theme by NAME), **stamps are never expanded**
(they reach the model as prompt data and are copied into ordinary patches), and
**no new protocol messages** are introduced (the theme map ships inline in the
quickstart shell; `@facet/server`/`@facet/client` are untouched).

- `@facet/core`: `FacetTheme` + `validateTheme` — the one safety gate where raw
  CSS enters, as OPERATOR data only (per-group token-name allowlist,
  `url()`/`var()`/`expression()`/`javascript:` denied, dimensions clamped, hostile
  keys never resolve, WCAG contrast measured as a warning never a rejection);
  `FacetTree.theme?: string` (a name, kept-if-string by `validateTree`);
  `FacetStamp` + `validateStamp`; the `STAGE_SPEC` theme line (select-by-name).
- `@facet/agent`: `Stage.theme(name)` — one top-level RFC 6902 `add`.
- `@facet/react`: `DEFAULT_THEME`, `ResolvedTheme`, `resolveTheme`; the style fns
  gain a defaulted trailing theme parameter (zero-arg output byte-identical);
  `StageRenderer` gains an optional `themes` prop. ChatDock keeps the default
  palette.
- `@facet/runtime`: the `AssetsStore` registry adapter (`MemoryAssets`, plus
  `FileAssets` behind `@facet/runtime/node`), `loadAssets` (runs the core
  validators once at boot, skips invalid documents with logged issues), and
  `withInitialStage` — a `StageStore` decorator that seeds fresh sessions from a
  validated initial tree inside the runtime's serialized write path.
- `@facet/kit`: per-instantiation id prefixes on `Builder`, a `fragment()` graft
  API, and `KIT_STAMPS` (hero/card/cta-button as validated stamps). `page()`
  output is byte-identical to today.
- `@facet/quickstart`: `--assets <dir>` (reads `*.theme.json`, `*.stamp.json`,
  `initial.tree.json`), theme names + descriptions and stamp fragments injected
  into the prompt, a `set_theme` tool (a NAME argument only), and the escaped
  theme map inlined into the shell. With no `--assets`, boot is byte-identical.

(`@facet/*` are versioned together as a fixed group.)
