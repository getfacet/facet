---
"@facet/assets": minor
"@facet/react": minor
"@facet/runtime": minor
"@facet/quickstart": minor
---

Unified asset pipeline — one `AssetsStore` for an exact per-agent Theme, Pattern
list, and optional initial tree. Missing assets use Facet defaults; a supplied
Theme replaces the default whole after validation, and supplied Patterns are an
exact list rather than a merge. A renderer maps the Theme to output, while an
agent may inspect Patterns as read-only authoring references.

PRE-1.0 BREAKING (in-repo consumers updated): the `@facet/kit` code-factory
package is REMOVED — its only consumer (`apps/playground`) migrated to a local,
byte-identical `page`/`text` brick helper. The default Theme/Pattern data
moved out of `@facet/react` (`DEFAULT_THEME`) and the retired `@facet/kit` (its
bundled reference trees) into a new node-free package, so a second renderer
can consume the same defaults.

- `@facet/assets` (new): node-free default-asset DATA (deps = `@facet/core` only)
  — the token value maps, `COLOR`, `DEFAULT_THEME`, and `DEFAULT_PATTERNS`
  (hero/card/cta-button as validated concrete native-node reference trees). The
  single, renderer-agnostic source of default-asset truth.
- `@facet/react`: derives its default-theme floor + `DEFAULT_RESOLVED` from
  `@facet/assets` (no duplicated values, no drift); re-exports `DEFAULT_THEME` +
  `COLOR` for back-compat; zero-arg style output byte-identical; `resolveTheme`
  stays the single (render-time) merge site.
- `@facet/runtime`: `loadAssets` seeds the `@facet/assets` defaults through the
  same validation gate. One valid custom Theme replaces the default whole;
  missing or invalid Theme data falls back whole. A present Pattern list is
  exact, while an absent list uses the bundled Patterns. An empty/absent store
  still resolves the defaults, and the
  "never throws" contract now covers the primary store I/O + malformed shapes
  too.
- `@facet/quickstart`: resolves assets through `loadAssets` on EVERY boot (a
  `MemoryAssets` fallback when no `--assets`), so the default theme reaches the
  shell and the Pattern index plus exact on-demand reads reach the agent even
  with no operator assets. Exact reference JSON remains in
  the provider conversation and is not sent to the browser.

(`@facet/*` are versioned together as a fixed group.)
