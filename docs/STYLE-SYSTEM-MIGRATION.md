# Style System Migration

Facet's current style system is a pre-1.0 hard cut. It does not translate old
documents, asset registries, style selectors, or discovery tool inputs. Migrate
the source data and agent calls before starting on the new version.

## What is supported now

Each agent has:

- one complete Theme;
- zero or more exact validated Patterns;
- an optional initial Facet tree.

Each Facet Document contains native Bricks and their optional `style` objects.
It does not choose or mutate the Theme. The host supplies the Theme to the
renderer and owns `colorMode`.

The supported asset files are:

```text
theme.json
patterns.json
initial.tree.json   # optional
```

Other pre-cutover asset files and fields are not aliases for these files. File
and runtime loaders report bounded issues and continue with the current defaults
where possible.

## Current terminology

Use these terms consistently in code, prompts, and documentation:

| Example | Name |
| --- | --- |
| `fontSize`, `gap`, `background` | style property |
| `label`, `control`, `track`, `fill` | Brick-owned style target |
| `md`, `lg`, `success` | token name |
| `row`, `column`, `auto`, `full` | fixed choice |
| `16px`, `#16a34a`, a font stack | concrete Theme value |
| `space.md = 16px` | Theme token definition |
| `panel`, `heading` | same-Brick Preset name |
| a named style bundle with guidance | Preset definition |
| a validated worked Facet tree with guidance | Pattern |

Targets with the same spelling on different Bricks are still separate. The
owning Brick always determines which properties, states, and choices are legal.

## Theme migration

A current Theme is complete rather than a partial overlay:

```ts
interface FacetTheme {
  name: string;
  description?: string;
  tokens: FacetThemeTokens;
  defaults: BrickStyleDefinitionMap;
  presets?: FacetPresets;
}
```

To migrate Theme data:

1. Start from `DEFAULT_THEME` or another current complete Theme.
2. Define every required token in every token group.
3. Define both `tokens.paint.light` and `tokens.paint.dark`.
4. Provide one valid default style for all 11 Bricks.
5. Move reusable same-Brick style bundles into `presets[brick][name]` and add
   `description`, `useWhen`, optional `avoidWhen`, and `style`.
6. Run `validateTheme`; treat a missing `theme` result as rejection of the whole
   custom Theme.

Do not put concrete CSS values in a Facet Document. Documents use token names;
the Theme owns their CSS meanings.

## Document migration

Every Brick may omit `style` or use one of these forms:

```json
{ "id": "copy", "type": "text", "value": "Ready" }
```

```json
{
  "id": "copy",
  "type": "text",
  "value": "Ready",
  "style": { "preset": "heading" }
}
```

```json
{
  "id": "copy",
  "type": "text",
  "value": "Ready",
  "style": { "color": "success", "fontWeight": "semibold" }
}
```

```json
{
  "id": "copy",
  "type": "text",
  "value": "Ready",
  "style": { "preset": "heading", "color": "success" }
}
```

Resolution is always:

```text
Theme default → same-Brick Preset → direct style
```

Migrate each old style object by selecting the owning Brick's current property
and target names from `BRICK_CONTRACT`. Do not rename keys by guesswork. A
property may accept token names, fixed choices, or a smaller state-specific
subset; use the discovery tools described below.

Remove any document field that tries to select a design system or switch display
mode. Pass the one Theme as host configuration. Pass `colorMode` to
`StageRenderer`; use `system` when browser preference should lead.

## Pattern migration

A current Pattern is one complete valid Facet tree plus discovery metadata:

```ts
interface FacetPattern extends FacetTree {
  name: string;
  description: string;
  useWhen: string;
  avoidWhen?: string;
}
```

Patterns have no parameters and are never inserted automatically. Convert a
worked reference into ordinary native Bricks, validate the complete tree against
the effective Theme, and place it in `patterns.json`. The agent reads it for
guidance and re-authors adapted content through normal mutation tools.

## Agent tool migration

Use progressive discovery instead of placing the whole design system in every
mutation schema:

1. Read Pattern names and guidance; call `get_pattern({ name })` when useful.
2. Read Preset names and guidance; call `get_preset({ brick, name })` when useful.
3. For one unfamiliar Brick, call `get_brick_spec({ type })`.
4. For one unfamiliar direct value, call
   `get_style_choices({ brick, target, property })`.
5. Author the actual change with `render_page`, `set_node`, `append_node`, or
   `remove_node`.

`get_brick_spec` accepts one `type`, not a batch. `get_style_choices` uses the
exact Brick-owned path returned by the Brick specification. Asset reads return
`no_stage_change`; they do not satisfy a request to change the page.

Pattern and Preset styles from the validated snapshot are already known-valid.
Use the choice lookup only when the agent directly chooses an unfamiliar value.

## Error handling

Current authoring is strict and atomic. If a mutation contains an invalid field,
target, property, state, Preset name, token name, fixed choice, or reference:

- the whole mutation is rejected;
- no patch is emitted;
- the tool result contains bounded structured errors and a retry action.

Repair the complete call and retry. Do not rely on the renderer to make an
invalid call acceptable.

The renderer remains fail-soft for stale or bypassed external state. It ignores
invalid style fragments and skips unknown or dangling nodes so valid siblings
can remain visible. This is a visitor-safety fallback, not a compatibility
layer.

## Cutover checklist

- [ ] Asset storage exposes only one complete Theme, exact Patterns, and an
      optional initial tree.
- [ ] Theme validation succeeds with complete token maps, defaults, and valid
      same-Brick Presets.
- [ ] Documents contain no design-system selector or client display-mode field.
- [ ] Every Brick style key, target, state, and value comes from the current Core
      contract.
- [ ] Agent calls use the current single-Brick and local-choice discovery inputs.
- [ ] Rejected authoring results are repaired and retried; success is based on a
      visible applied mutation.
- [ ] `pnpm verify`, `pnpm package:smoke`, and
      `node scripts/check-style-hard-cut.mjs` pass.

There is no dual-read period, alias table, automatic rewrite, or runtime fallback
to a pre-cutover authoring model. Keep any one-time data conversion outside
Facet, validate its output against the current public APIs, and deploy the
converted assets and agent calls together.
