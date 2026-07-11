---
"@facet/assets": minor
"@facet/react": minor
"@facet/runtime": minor
"@facet/quickstart": minor
---

Unified asset pipeline — one `AssetsStore` for themes AND compositions, with the
Facet-provided defaults as a base layer and per-agent custom assets layered on
top (add / refine, never a wholesale replace). Management is unified; application
stays at each consumer (a renderer maps a theme → its output; the graft applies
compositions).

PRE-1.0 BREAKING (in-repo consumers updated): the `@facet/kit` code-factory
package is REMOVED — its only consumer (`apps/playground`) migrated to a local,
byte-identical `page`/`text` brick helper. The default theme/composition DATA
moved out of `@facet/react` (`DEFAULT_THEME`) and the retired `@facet/kit` (its
bundled composition trees) into a new node-free package, so a second renderer
can consume the same defaults.

- `@facet/assets` (new): node-free default-asset DATA (deps = `@facet/core` only)
  — the token value maps, `COLOR`, `DEFAULT_THEME`, and `DEFAULT_COMPOSITIONS`
  (hero/card/cta-button as validated `FacetComposition` trees). The single,
  renderer-agnostic source of default-asset truth.
- `@facet/react`: derives its default-theme floor + `DEFAULT_RESOLVED` from
  `@facet/assets` (no duplicated values, no drift); re-exports `DEFAULT_THEME` +
  `COLOR` for back-compat; zero-arg style output byte-identical; `resolveTheme`
  stays the single (render-time) merge site.
- `@facet/runtime`: `loadAssets` seeds the `@facet/assets` defaults through the
  SAME validation gate and layers custom on top with symmetric collision rules —
  themes shadow per-name via a load-time list swap (render's `resolveTheme` does
  the per-field overlay), compositions union with a custom name shadowing a
  same-named default. An empty/absent store still resolves the defaults, and the
  "never throws" contract now covers the primary store I/O + malformed shapes
  too.
- `@facet/quickstart`: resolves assets through `loadAssets` on EVERY boot (a
  `MemoryAssets` fallback when no `--assets`), so the default theme + composition
  library reach the agent and shell even with no operator assets.

(`@facet/*` are versioned together as a fixed group.)
