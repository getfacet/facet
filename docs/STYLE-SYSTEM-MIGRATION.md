# Style System Migration

For the current framework overview and adoption paths, start with the
[Facet README](../README.md). This document is only for the pre-1.0 style-system
cutover.

It covers moving pre-cutover assets, Facet Documents, and agent calls to the
current pre-1.0 Theme/Preset/Pattern contract. For current concepts
and authoring examples, read the [Design System guide](DESIGN-SYSTEM.md). For
invariants and validation behavior, read [Architecture](ARCHITECTURE.md).

There is no dual-read period, alias table, automatic rewrite, or runtime
compatibility bridge. Convert every producer and asset source before deploying
the current version.

## Cutover target

Each agent must resolve to:

- one complete Theme, with `DEFAULT_THEME` used when no custom Theme is
  supplied;
- one exact validated Pattern list, with `DEFAULT_PATTERNS` used when the list
  is absent and no Patterns used when it is explicitly empty; and
- an optional initial Facet tree.

The supported file-backed asset names are:

```text
theme.json
patterns.json
initial.tree.json   # optional
```

A Facet Document contains only native Bricks and their optional closed `style`
objects. It never selects a Theme or display mode. The host supplies the Theme,
and the browser owns `colorMode`.

## Migrate Theme data

1. Start from `DEFAULT_THEME` or another current complete `FacetTheme`.
2. Define every Core token name in its required token group, including both
   `tokens.paint.light` and `tokens.paint.dark`.
3. Provide one valid default style for all 11 Bricks.
4. Move each reusable style bundle to `presets[brick][name]`. Give it
   `description`, `useWhen`, optional `avoidWhen`, and one style definition for
   that same Brick.
5. Run `validateTheme` at the untrusted asset boundary. Treat a missing `theme`
   result as rejection of the complete custom Theme.

Do not migrate concrete CSS values into Facet Documents. They remain inside
Theme token definitions. Do not partially merge a malformed custom Theme;
asset loading and rendering fall back to the complete bundled Theme.

## Migrate Facet Documents

For every Brick with style data:

1. Find its current fields, root properties, nested targets, states, and value
   domains in `BRICK_CONTRACT` or with `get_brick_spec`.
2. Replace the style with one of the [four current authoring
   forms](DESIGN-SYSTEM.md#the-four-authoring-forms): Theme default only,
   same-Brick Preset, direct style, or Preset plus a direct adjustment.
3. Use only token names or fixed choices allowed at that exact Brick-owned path.
   For an unfamiliar direct value, use `get_style_choices` rather than guessing.
4. Remove any document field that selects a design system or light/dark mode.
   Pass one Theme and `colorMode` through host/renderer configuration instead.

Resolution after conversion is always:

```text
Theme default → same-Brick Preset → direct style
```

The current flow-only layout contract has no arbitrary positioning or z-index.
Convert any overlay presentation to the bounded `box` backdrop and modal/drawer
fields only when that behavior is actually needed. There is no dedicated
overlay Brick.

## Migrate Patterns

Convert each reusable worked example into one complete valid `FacetPattern`:

- include `name`, `description`, `useWhen`, and optional `avoidWhen`;
- include an ordinary Facet tree (`root`, `nodes`, and optional `screens`,
  `entry`, and `data`);
- use only native Bricks and current same-Brick Preset/direct style syntax; and
- validate it against the effective Theme before exposing it.

Patterns have no parameters and are never inserted automatically. After
`get_pattern`, the agent adapts the example and re-authors ordinary Bricks
through the normal strict mutation tools.

## Migrate agent calls

Replace any eager all-design-system prompt or retired reference operation with
the current progressive sequence:

1. inspect Pattern metadata and call `get_pattern({ name })` when a worked
   structure fits;
2. inspect Preset metadata and call `get_preset({ brick, name })` when a visual
   role fits;
3. call `get_brick_spec({ type })` for one unfamiliar Brick;
4. call `get_style_choices({ brick, target, property })` for one unfamiliar
   direct value; and
5. author the change with `render_page`, `set_node`, `append_node`, or
   `remove_node`.

Asset reads return `no_stage_change`. They do not satisfy a request to change
the page. Mutation success requires a visible applied outcome.

Current authored mutations are strict and atomic. If a call contains an invalid
field, target, property, state, Preset, token, fixed choice, reference, or bound,
the complete call is rejected with zero patches. Return the structured issues
to the agent, repair the call, and retry. Do not reinterpret renderer fail-soft
behavior as authoring success.

## Deploy the cutover

Deploy converted assets and converted agent calls together. Before switching
traffic, verify:

- [ ] Asset storage exposes only one complete Theme, the exact Pattern list,
      and an optional initial tree.
- [ ] `validateTheme` succeeds and both paint modes are complete.
- [ ] Every Pattern validates against the effective Theme.
- [ ] Documents contain no Theme selector, display-mode field, raw CSS, or
      style key outside the current Brick contract.
- [ ] Discovery calls use one Brick or one local style path at a time.
- [ ] Rejected mutation results are repaired and retried; success is based on a
      visible applied mutation.
- [ ] `pnpm verify`, `pnpm package:smoke`, and
      `node scripts/check-style-hard-cut.mjs` pass.

Keep one-time conversion code outside Facet. Validate its output through the
current public APIs, then remove the converter after the hard cut.
