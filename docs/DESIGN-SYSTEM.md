# Design System

If you are evaluating Facet or choosing an adoption path, start with the
[Facet README](../README.md). This guide owns the current styling and asset
model.

Facet separates what an agent authors from how a host brands and renders it.
The short rule is:

> The agent authors Bricks and closed style names. The host supplies one Theme.
> The renderer resolves those names into presentation.

This guide explains that workflow for application operators and coding agents.
For the system invariants, see [Architecture](ARCHITECTURE.md). For the exact
machine-readable contract, use `@facet/core`; this guide intentionally does not
copy an exhaustive Brick, property, or token table.

## The vocabulary

| Example | Term | Owner |
| --- | --- | --- |
| `fontSize`, `gap`, `background` | style property | Core defines it per Brick and target; the agent may choose it there. |
| `label`, `control`, `track`, `fill` | Brick-owned style target | Core defines it for one Brick; the renderer owns the corresponding internal part. |
| `md`, `lg`, `success` | token name | Core defines its meaning and where it is allowed; the agent chooses the name. |
| `row`, `column`, `auto`, `full` | fixed choice | Core and the renderer define behavior that does not change with a brand. |
| `16px`, `#16a34a`, a font stack | concrete Theme value | The operator supplies it inside Theme data; the agent never puts it in a Facet Document. |
| `space.md = 16px` | Theme token definition | The Theme maps one Core token name to one concrete value. |
| `panel`, `heading` | Preset name | A Theme defines it for one Brick; the agent may select it from that Brick's style. |
| a named style bundle with guidance | Preset definition | A Theme combines valid properties for one Brick only. |
| a validated worked Facet tree with guidance | Pattern | The asset owner supplies an example; the agent reads, adapts, and re-authors it as ordinary Bricks. |

These terms are deliberately separate. A token is one closed value name. A
Preset is a named bundle of style properties. A Pattern is a complete example
tree and may already use Presets and direct style.

## Brick-owned style vocabulary

Every Brick has one optional `style` entry point, but there is no open global
style object. Core defines a closed vocabulary for each Brick:

- the properties that apply to the Brick root;
- any internal targets the Brick exposes, such as `input.style.control` or
  `progress.style.track`;
- the states allowed on each target, such as `hover`, `focus`, or `checked`;
- which token domain or fixed-choice domain each property accepts; and
- any input-kind restriction on a target.

The same spelling does not create a global part. `chart.style.title` and
`list.style.title`, for example, belong to separate Brick contracts. Conversely,
several Bricks may allow a `color` property backed by the same semantic color
tokens. A token domain may be useful to many Bricks or to only one current
Brick; in both cases Core defines the domain once and each Brick explicitly
chooses whether to allow it.

`BRICK_CONTRACT`, `TOKEN_STYLE_VALUE_CONTRACT`, and
`FIXED_STYLE_VALUE_CONTRACT` are the authorities. Add a new visual capability
by deliberately extending those Core contracts, validation, and rendering—not
by accepting arbitrary CSS.

## The four authoring forms

An agent always authors a Brick. Styling that Brick is optional and has four
forms.

### 1. Theme default only

```json
{ "id": "copy", "type": "text", "value": "Ready" }
```

The active Theme's `text` default supplies the appearance.

### 2. Preset

```json
{
  "id": "copy",
  "type": "text",
  "value": "Ready",
  "style": { "preset": "heading" }
}
```

The Preset must exist under the same Brick type. A `text` Brick cannot select a
`box` Preset.

### 3. Direct style

```json
{
  "id": "copy",
  "type": "text",
  "value": "Ready",
  "style": { "color": "success", "fontWeight": "semibold" }
}
```

The property and value names must be allowed at the exact `text` root path.

### 4. Preset plus a direct adjustment

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

Later layers override only exact properties allowed by the Brick contract.
Nested targets and states stay inside the same `style` object. For example, a
Theme Preset or direct `input` style may address `control.focus` only when the
`input` contract exposes that state and property. The agent does not select a
renderer-internal DOM element.

The same closed-contract rule covers the bounded `box` backdrop and
modal/drawer behavior. Those are deliberate `box` fields with renderer-owned
containment and layering, not a dedicated overlay Brick or an arbitrary
positioning surface.

## How an agent should choose

Use the smallest amount of new styling needed:

1. Read Pattern metadata first. If a worked structure fits, inspect it and
   re-author an adapted tree.
2. Keep the valid Presets and direct styles already demonstrated by that Pattern
   when their roles still fit.
3. Otherwise prefer a same-Brick Preset whose `useWhen` matches the visual role.
4. Use direct style for Pattern-specific layout or a deliberate local
   adjustment.
5. Omit `style` when the Theme default is the intended result.

This is guidance, not hidden expansion. A Pattern read never inserts nodes, and
a Preset never supplies structure or behavior. The agent always authors the
resulting native Bricks and styles through normal mutation tools.

### Progressive discovery

An agent does not need the complete design system in every mutation schema.
`@facet/agent-tools` exposes it progressively:

1. Pattern names, descriptions, and `useWhen`; `get_pattern` returns one exact
   validated example.
2. Preset names and guidance; `get_preset` returns one exact same-Brick style
   bundle.
3. Brick names and guidance; `get_brick_spec` returns one Brick's fields and
   style paths.
4. One unfamiliar local choice; `get_style_choices` returns allowed values and
   meanings for one exact Brick, target, and property.

Pattern and Preset styles from the validated asset snapshot are already known
valid. Direct choices still pass strict validation when the mutation runs.

## Use the default assets

`@facet/assets` exports the complete `DEFAULT_THEME` and the exact validated
`DEFAULT_PATTERNS`. Use them when the application needs Facet's bundled visual
system and reference examples without brand customization:

```ts check-docs
import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";

export const assets = {
  theme: DEFAULT_THEME,
  patterns: DEFAULT_PATTERNS,
};
```

The package contains data only. The host passes these values through its asset
and renderer wiring; importing them does not create a renderer, runtime, or
agent.

## How an operator defines a Theme

Each agent asset snapshot has exactly one complete `FacetTheme`. If the operator
does not provide one, Facet uses `DEFAULT_THEME`. A Theme contains:

- a complete value for every Core token name, including light and dark paint;
- one valid default style for every Brick; and
- optional same-Brick Presets with `description`, `useWhen`, optional
  `avoidWhen`, and a style bundle.

Starting from `DEFAULT_THEME` is the shortest safe way to create a complete
brand Theme. Concrete CSS values belong only in this operator-side data:

```ts check-docs
import { validateTheme, type FacetTheme } from "@facet/core";
import { DEFAULT_THEME } from "@facet/assets";

const candidate = {
  ...DEFAULT_THEME,
  name: "acme",
  description: "Acme's clear, high-contrast application design system.",
  tokens: {
    ...DEFAULT_THEME.tokens,
    space: { ...DEFAULT_THEME.tokens.space, md: "1rem" },
    fontSize: { ...DEFAULT_THEME.tokens.fontSize, lg: "1.25rem" },
    paint: {
      light: {
        ...DEFAULT_THEME.tokens.paint.light,
        color: {
          ...DEFAULT_THEME.tokens.paint.light.color,
          accent: "#1746a2",
          focusRing: "#1746a2",
        },
      },
      dark: {
        ...DEFAULT_THEME.tokens.paint.dark,
        color: {
          ...DEFAULT_THEME.tokens.paint.dark.color,
          accent: "#8fb4ff",
          focusRing: "#b8ceff",
        },
      },
    },
  },
  presets: {
    ...DEFAULT_THEME.presets,
    box: {
      ...DEFAULT_THEME.presets?.box,
      brandPanel: {
        description: "A bordered brand surface for grouped content.",
        useWhen: "Use for a distinct settings or summary region.",
        avoidWhen: "Avoid for an ungrouped content flow.",
        style: {
          gap: "md",
          padding: "lg",
          background: "surface",
          borderColor: "accent",
          borderWidth: "thin",
          borderRadius: "md",
        },
      },
    },
  },
} satisfies FacetTheme;

const result = validateTheme(candidate);
if (result.theme === undefined) {
  throw new Error(result.issues.map((issue) => issue.message).join("\n"));
}

export const ACME_THEME = result.theme;
```

`satisfies FacetTheme` checks the TypeScript shape for trusted source data.
`validateTheme` is still required at an untrusted asset boundary and enforces
runtime bounds, safe concrete values, and contrast diagnostics.

### Add a Pattern

A Pattern is a complete valid tree plus bounded discovery prose. Its tree uses
the same closed Brick and style syntax as a document:

```ts check-docs
import { validatePattern, type FacetPattern, type FacetTheme } from "@facet/core";

const supportSummary = {
  name: "support-summary",
  description: "A surfaced support-case heading and status.",
  useWhen: "Use to summarize one support case before its detail.",
  avoidWhen: "Avoid for a list of many cases.",
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      children: ["title", "status"],
      style: { preset: "brandPanel" },
    },
    title: {
      id: "title",
      type: "text",
      value: "Case 1042",
      style: { preset: "heading" },
    },
    status: {
      id: "status",
      type: "text",
      value: "Resolved",
      style: { color: "success", fontWeight: "semibold" },
    },
  },
} satisfies FacetPattern;

export function readSupportSummary(theme: FacetTheme): FacetPattern {
  const result = validatePattern(supportSummary, theme);
  if (result.pattern === undefined) {
    throw new Error(result.issues.join("\n"));
  }
  return result.pattern;
}
```

Validate a Pattern against the effective Theme because its Preset names must
exist there. Asset loading keeps valid Patterns and omits invalid entries. An
explicit empty Pattern list means the agent receives no Patterns.

## `colorMode` is client state

One Theme contains both `tokens.paint.light` and `tokens.paint.dark`. The host
passes `"light"`, `"dark"`, or `"system"` to `StageRenderer`; `"system"` is the
default. The browser resolves the effective mode, while server rendering uses a
deterministic light fallback.

`colorMode` is not a Facet Document field. Changing it does not mutate the
Theme, emit a patch, or give the agent another style surface. It is browser
view-state that the host may include in the next read-only view snapshot.

## Three different failure boundaries

Do not treat all invalid data as one fallback policy.

1. **Agent-authored mutation: strict rejection.** An invalid field, target,
   state, Preset, token, fixed choice, reference, or bound rejects the complete
   mutation. The tool returns structured repair guidance, emits zero patches,
   and keeps local shadow state unchanged. The agent repairs the call and
   retries.
2. **Persisted or render input: fail-soft display.** Stale, partially patched,
   persisted, or bypassed input may contain invalid fragments. Tree validation
   and rendering drop unsafe style fragments and unusable references and skip
   unknown or dangling nodes so valid siblings can remain visible. This does
   not turn a rejected agent call into success.
3. **Custom Theme: whole-Theme fallback.** `validateTheme` never returns a
   partial Theme. If a custom Theme has any error, asset loading and rendering
   use the complete bundled Theme. Contrast findings may remain warnings when
   structural validation succeeds.

Pattern validation has its own asset-list behavior: each invalid Pattern is
hidden as a whole while other valid Patterns may remain available.

## Where to look next

- [Architecture](ARCHITECTURE.md) — invariants, runtime behavior, validation,
  layout, assets, and package boundaries.
- [`@facet/core`](https://github.com/getfacet/facet/blob/main/packages/core/core/README.md)
  — exact contract and validation entry points.
- [`@facet/assets`](https://github.com/getfacet/facet/blob/main/packages/core/assets/README.md)
  — bundled Theme and Pattern data.
