# Context: Font Family Tokens

> Evidence gathered by `/spec-bridge` Stage 0 for
> `specs/feature-intake/font-family-tokens.md`.

## Affected Packages And Entrypoints

- `@facet/core`
  - `packages/core/src/tokens.ts:15-24` defines the current style token groups;
    font size and font weight exist, but no font-family token group exists.
  - `packages/core/src/nodes.ts:113-118` defines `TextStyle` as `size`,
    `weight`, `color`, and `align`; there is no `family` token.
  - `packages/core/src/validate.ts:1-16` imports style token groups for
    validation; `validate.ts:283-295` sanitizes text style tokens and currently
    strips everything except `size`, `weight`, `color`, and `align`.
  - `packages/core/src/theme.ts:43-52` defines `FacetTheme` groups; it currently
    has `fontSize` and `fontWeight` but no `fontFamily`.
  - `packages/core/src/theme.ts:75-84` has a closed `KNOWN_KEYS` set; adding a
    theme group requires updating this set or the new group will warn as
    unknown.
  - `packages/core/src/theme.ts:224-270` centralizes per-token-group validation
    into `validateGroup`; `theme.ts:273-313` has value handlers for color,
    dimensions, weight, and ratio.
  - `packages/core/src/spec.ts:8-29` is the single LLM-facing `STAGE_SPEC`;
    `spec.ts:19` currently teaches `TextStyle` without a family token.
  - `packages/core/src/index.ts` barrel-exports tokens/types through
    `export *`, so new exported token constants/types must live in normal core
    modules, not side files.

- `@facet/assets`
  - `packages/assets/src/theme.ts:1-2` imports core token types and
    `DEFAULT_COLORS`; `theme.ts:17-83` defines null-proto default value maps for
    the existing token groups.
  - `packages/assets/src/theme.ts:92-100` assembles `DEFAULT_THEME` from six
    groups. A font-family group must be added here so default assets remain the
    single source of default token values.
  - `packages/assets/src/theme.test.ts:37-65` pins `DEFAULT_THEME` shape and
    null-proto groups; those assertions must expand to the seventh group.

- `@facet/react`
  - `packages/react/src/theme.ts:2-22` imports core token groups and default
    value maps from `@facet/assets`.
  - `packages/react/src/theme.ts:32-39` defines `ResolvedTheme` with six groups;
    `theme.ts:46-53` builds `DEFAULT_RESOLVED` from `@facet/assets`.
  - `packages/react/src/theme.ts:63-77` overlays only own, allowed, primitive
    keys into null-proto maps; adding font-family should reuse this path.
  - `packages/react/src/theme.ts:88-99` resolves named theme documents into full
    token maps; missing groups fall back to defaults.
  - `packages/react/src/theme.ts:183-195` applies text style tokens to CSS;
    this is the narrow renderer site for `style.family`.
  - `packages/react/src/StageRenderer.tsx:674-679` exposes `themes?: readonly
    FacetTheme[]`; no API shape change is needed beyond `FacetTheme`.

- `@facet/quickstart`
  - `packages/quickstart/src/page/main.tsx:84-99` already resolves the current
    theme to paint `document.body` background/color.
  - `packages/quickstart/src/page/main.tsx:143-154` hard-codes the page wrapper
    `fontFamily: "system-ui, -apple-system, sans-serif"`.
  - `packages/react/src/ChatDock.tsx:68-107` uses static app-chrome styles with
    color from `COLOR`, but no font-family. Decision for this feature: keep
    quickstart/ChatDock app chrome on the current inherited/system stack for v1;
    implement Stage text theming first. The page wrapper remains compatible with
    the default `sans` stack, so quickstart does not need a production-code WU.

- `apps/playground`
  - `apps/playground/src/bricks.ts:1-17` and
    `apps/playground/src/tree-builder.ts:10-29` consume `TextStyle` structurally.
    The new optional `family` field is additive, so existing code compiles
    unchanged.

## Package READMEs / Docs

- `AGENTS.md:16-20` states agents emit declarative bricks, style values are
  tokens, and adding capability means adding a node type or token on purpose.
- `docs/ARCHITECTURE.md:94-102` describes style values as tokens whose concrete
  CSS lives in the renderer theme.
- `docs/ARCHITECTURE.md:104-124` documents themes as operator data validated by
  `@facet/core`, shipped once, and resolved by `@facet/react`.
- `packages/assets/README.md:1-18` describes `@facet/assets` as default theme
  and stamp data.

## Existing Tests Near Planned Behavior

- Core tree validation
  - `packages/core/src/validate.test.ts:41-53` pins invalid style-token stripping.
  - `packages/core/src/validate.test.ts:1113-1135` pins style-surface ownership
    for new tokens.

- Core theme validation
  - `packages/core/src/theme.test.ts:40-66` rejects hostile CSS substrings and
    injection characters.
  - `packages/core/src/theme.test.ts:68-86` verifies null-proto output maps and
    hostile key dropping.
  - `packages/core/src/theme.test.ts:154-167` verifies unknown group/token keys
    warn but keep the document.
  - `packages/core/src/theme.test.ts:245-265` round-trips a valid partial theme.

- Core prompt vocabulary
  - `packages/core/src/spec.test.ts:21-30` pins theme-name-only language.
  - `packages/core/src/spec.test.ts:32-76` uses runtime token arrays to catch
    STAGE_SPEC drift for other token additions.

- Assets
  - `packages/assets/src/theme.test.ts:30-65` validates `DEFAULT_THEME`, pinned
    shape, representative values, and null-proto groups.

- React renderer
  - `packages/react/src/theme.test.ts:108-125` pins `textStyle` token-to-CSS
    mapping.
  - `packages/react/src/theme.test.ts:186-235` pins `resolveTheme` fallback,
    overlay behavior, null-proto groups, and hostile key behavior.
  - `packages/react/src/StageRenderer.theme.test.tsx:55-140` verifies resolved
    theme values reach the DOM and fall back fail-safe.

## Current Public API Exports

- `@facet/core` barrels `tokens.ts`, `nodes.ts`, `theme.ts`, `validate.ts`, and
  `spec.ts` from `packages/core/src/index.ts`. Adding `FONT_FAMILIES`,
  `FontFamily`, `TextStyle.family`, and `FacetTheme.fontFamily` is additive.
- `@facet/assets` barrels `theme.ts` from `packages/assets/src/index.ts`.
  Adding `FONT_FAMILY` is additive.
- `@facet/react` re-exports `DEFAULT_THEME` and `COLOR` from `theme.ts`; it does
  not currently export `DEFAULT_RESOLVED`. Adding font-family to `ResolvedTheme`
  is a TypeScript surface change for any direct `ResolvedTheme` consumer, but it
  is additive at runtime.

## Consumer Sweep

Command: `rg "TextStyle|FacetTheme|FONT_SIZES|FONT_WEIGHTS|fontFamily|DEFAULT_THEME|STAGE_SPEC" packages apps docs specs -n`

- `TextStyle` consumers are type-only or helper pass-throughs:
  `packages/react/src/theme.test.ts:1`, `apps/playground/src/bricks.ts:1`,
  `apps/playground/src/tree-builder.ts:10`.
- `FacetTheme` consumers are quickstart/server/agent/react/runtime type uses and
  tests; optional `fontFamily` should not require migration.
- `STAGE_SPEC` is embedded by quickstart prompt (`packages/quickstart/src/prompt.ts:13,115`)
  and bridge/playground paths via core export; a vocabulary update in core
  propagates automatically, but prompt tests should pin it.
- `fontFamily` currently appears only in app chrome CSS:
  `packages/quickstart/src/page/main.tsx:153` and
  `apps/playground/src/App.tsx:184`, not in Facet tree/theme data.

## Risk Register

| Risk id | Evidence | Risk |
|---|---|---|
| RISK-INV-1 | `AGENTS.md:16-20`; `packages/core/src/spec.ts:17-22` | Adding font control must not let the agent emit raw font-family/CSS values. |
| RISK-INV-2 | `packages/core/src/theme.ts:165-180`; `theme.test.ts:40-66` | Font-family values are operator data but still raw CSS strings; validator must reject URL/import/var/expression/javascript/control/injection characters. |
| RISK-INV-3 | `packages/react/src/theme.ts:63-77`; `theme.test.ts:214-235` | Resolved theme maps must stay null-proto and ignore hostile keys after JSON round trip. |
| RISK-API-1 | `packages/core/src/tokens.ts:15-24`; `packages/core/src/index.ts` | New token constants/types are published core API; barrel export and downstream strict typing must remain coherent. |
| RISK-API-2 | `packages/core/src/spec.ts:8-29`; `packages/quickstart/src/prompt.ts:13,115` | STAGE_SPEC change reaches multiple agent-driving prompts; it must advertise only backed capability and no unimplemented tool. |
| RISK-API-3 | `packages/assets/src/theme.test.ts:37-65`; `packages/react/src/theme.test.ts:176-235` | `DEFAULT_THEME` shape and `ResolvedTheme` shape are pinned; tests must be intentionally updated so default-theme single-source identity remains true. |
| RISK-PKG-1 | `AGENTS.md:50-56`; `packages/core/package.json` | `@facet/core` must remain dependency-free and browser-safe; no font parsing dependency or node import. |
| RISK-PKG-2 | `packages/assets/src/theme.ts:1-2`; `packages/react/src/theme.ts:18-24` | `@facet/assets` must remain node-free and renderer-free; react consumes assets, not the other way around. |
| RISK-PKG-3 | `packages/quickstart/src/page/main.tsx:143-154`; `packages/react/src/ChatDock.tsx:68-107` | App chrome has its own font styling/inheritance. Stage font theming could be confused with quickstart/ChatDock font behavior if not explicitly scoped. |

## GO / NO-GO

GO.

The feature is additive and fits Facet's invariant model if raw font-family
strings stay confined to validated operator theme documents, the tree carries
only closed `FontFamily` tokens, and the renderer resolves through the existing
theme overlay path.
