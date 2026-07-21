# @facet/core

The dependency-free Facet contract: one closed native-Brick document
vocabulary, one closed Brick style system, validation, the
[RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) patch implementation,
and session/event types. Every other Facet package builds on this package.

Role: **Core**.

```bash
npm install @facet/core
```

Start with the practical
[Design System guide](https://github.com/getfacet/facet/blob/main/docs/DESIGN-SYSTEM.md).
Use this package README for Core's public contract and validation entry points.

## Closed authoring surface

`FacetNode` is a union of exactly eleven Bricks: `box`, `text`, `media`,
`input`, `richtext`, `table`, `chart`, `list`, `keyValue`, `progress`, and
`loading`. Only `box` owns child node ids. Documents are declarative data with
flow layout; they never contain raw HTML, JavaScript, CSS, authored fetches, or
renderer plug-ins.

`BRICK_CONTRACT` is the single machine-readable specification for that surface.
For each Brick it defines:

- field names and whether they are required;
- `description`, `useWhen`, and optional `avoidWhen` guidance;
- the Brick-owned root and nested style targets;
- each target's exact properties, states, and input-kind applicability; and
- whether each property accepts a token name or a fixed renderer choice.

The same contract drives strict author validation, renderer style resolution,
and progressive agent discovery through `get_brick_spec` and
`get_style_choices`.

Core's property-specific style-value helpers are the shared decision point for
those consumers. They intersect a token or fixed-choice domain with the exact
property's allow-list, so discovery never advertises a value that author or
Theme validation would reject at that path.

The product-grade surface stays closed even where it needs more precision:
`media` accepts only images, videos, and known generic icon names; text-bearing
styles expose bounded wrap/clamp choices only at compatible paths; table columns
may declare closed text alignment; and chart series/plot metadata accepts only
known line-style and token-backed axis/grid/label color controls.

## Style, Theme, and Presets

Every Brick has one optional `style` object, but each Brick owns a different
closed style vocabulary. For example, `input.style.control` and
`progress.style.track` are valid only because their owning Brick contract
defines them. Similar target names on two Bricks are still separate local
vocabularies.

Style properties accept only:

- token names, whose concrete CSS values come from the active Theme; or
- fixed choices, whose behavior is owned by the renderer.

`TOKEN_STYLE_VALUE_CONTRACT` and `FIXED_STYLE_VALUE_CONTRACT` provide the closed
value domains plus `description`, `useWhen`, and optional `avoidWhen` metadata.
An agent never needs concrete CSS values to choose a style.

`FacetTheme` is one complete operator-owned design system. It contains complete
token maps, light and dark paint branches, a default style for every Brick, and
optional same-Brick Presets. A `FacetPreset` contains discovery metadata and one
unresolved style bundle. Style resolution order is:

1. Theme default;
2. same-Brick Preset named by `style.preset`;
3. direct values in the Brick's `style`.

The Theme is host input, not Facet Document syntax. The host also owns the
light/dark color-mode preference; the agent does not mutate either one.

Core vocabulary grows only after evidence. Brand identity, density, and repeated
composition should first be expressed with custom Themes, same-Brick Presets,
and Patterns. Add a new Brick or closed `box` layout field only when a
reference-grade benchmark shows that the existing declarative vocabulary cannot
represent the target without a raw CSS or markup escape hatch.

## Validation boundaries

Core exposes two deliberately different validation paths:

- `validateAuthorNode` and `validateAuthorTree` are strict, Theme-aware
  boundaries for agent mutation calls. Any invalid field, style path, Preset,
  or value rejects the complete authored value with bounded repair issues.
- `validateTree` is the fail-safe boundary for stale or bypassed stored data. It
  keeps safe siblings, drops invalid fragments, prunes dangling references, and
  never throws on unknown nodes. It returns a `TreeValidationResult`.

`resolveTreeScreen(tree, preferredScreen)` exposes the shared fail-soft live-root
policy used by Core content checks and the React renderer: preferred live screen,
then live `entry`, then the first live screen, then the plain tree root.

`validateTheme` accepts one complete Theme or refuses it whole. It allow-lists
every token group, Brick default, Preset, target, state, and property; rejects
unsafe CSS constructs; bounds dimensions and typography values; and reports
contrast findings as warnings after structural validation succeeds.

`FacetPattern` is an exact read-only reference tree with `name`, `description`,
`useWhen`, optional `avoidWhen`, and ordinary Facet tree fields.
`validatePattern(input, theme)` validates one Pattern against the effective
Theme. `validatePatternList(input, theme)` accepts at most 64 entries and hides
each invalid or Theme-incompatible Pattern whole.

```ts check-docs
import {
  applyPatch,
  escapeJsonPointerToken,
  validateAuthorTree,
  validatePattern,
  validateTheme,
} from "@facet/core";

declare const operatorTheme: unknown;
declare const modelDocument: unknown;
declare const operatorPattern: unknown;

const themeResult = validateTheme(operatorTheme);
if (themeResult.theme === undefined) throw new Error("Invalid Theme");

const authored = validateAuthorTree(modelDocument, themeResult.theme);
if (authored.value === undefined) {
  // Return authored.issues to the agent and retry the complete call.
  throw new Error("Invalid Facet Document");
}

const pattern = validatePattern(operatorPattern, themeResult.theme).pattern;

const helloId = "hello";
const helloPath = `/nodes/${escapeJsonPointerToken(helloId)}`;

const next = applyPatch(authored.value, [
  {
    op: "add",
    path: helloPath,
    value: {
      id: "hello",
      type: "text",
      value: "Hi",
      style: { preset: "body", color: "accent" },
    },
  },
  { op: "add", path: "/nodes/root/children/-", value: helloId },
]);
```

Pattern reads do not change a stage. An agent inspects one and then authors
ordinary Bricks through the normal strict mutation tools. Only the resulting
RFC 6902 patches travel to the runtime and client.

Also exported are the normalized browser event/view contracts, data-binding
helpers, `FacetAgent`, and small dependency-free async primitives such as
`createSerialQueue` and `createSemaphore`.

## Documentation

- [Design System guide](https://github.com/getfacet/facet/blob/main/docs/DESIGN-SYSTEM.md) —
  current styling concepts, asset authoring, discovery, and failure boundaries.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  system invariants and runtime behavior.
- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md) —
  choose and wire an integration path.
