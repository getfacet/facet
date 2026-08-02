# Design System

Facet's design system is a closed component catalog plus a layered theme
contract and a trusted React registry. Agents choose registered tags and
declared props; hosts own the theme values and the React components that render
them.

## Default component set

The default assets package registers thirteen components:

`Screen`, `Stack`, `Row`, `Grid`, `Modal`, `Card`, `Empty`, `Text`, `Metric`,
`Badge`, `Button`, `Field`, and `Table`.

```ts check-docs
import { DEFAULT_CATALOG } from "@facet/assets";

const tags = DEFAULT_CATALOG.components.map((component) => component.tag);

console.log(tags.includes("Text"), tags.includes("Modal"));
```

`Screen` is the root for a named screen. Layout components keep authored layout
flow-contained. `Modal` is the dedicated overlap contract. Content and
interactive components expose only their declared scalar, action, collection,
and binding props.

## Use the default assets

The package root exports plain data: `DEFAULT_CATALOG`,
`DEFAULT_COMPONENT_SPECS`, and `DEFAULT_THEME`. React implementations live behind
the explicit React subpath as `DEFAULT_REGISTRY`.

```ts check-docs
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { bootstrapRenderer } from "@facet/react";

const boot = bootstrapRenderer({
  catalog: DEFAULT_CATALOG,
  registry: DEFAULT_REGISTRY,
  theme: DEFAULT_THEME,
});

if (!boot.ok) {
  throw new Error(boot.detail);
}

console.log(boot.registry.Text !== undefined);
```

The root entrypoint imports no React. That split lets server-side code validate
catalog/theme data without loading renderer code.

## Theme contract

Core defines Facet Design Contract v1 as two required layers and two declared
layers:

- `foundation` is the raw design scale: palette, typography, spacing, sizing,
  radii, borders, shadow, opacity, motion, effects, breakpoints, and density.
- `semantic` maps those scales into UI meaning: canvas, surface, text, border,
  action, status, state, focus, selection, disabled, loading, layer, validation,
  and the remaining required contract roles exported by `FACET_THEME_CONTRACT`.
- `recipes` are component-owned token namespaces declared by
  `ComponentSpec.themeRecipe`. They are required when the active catalog
  declares them. The namespace is the component tag transformed with
  `facetThemeToKebabCase`, so a catalog rejects recipe-owning tags that collide
  after that CSS variable projection.
- `extensions` are host-owned token namespaces declared through bootstrap
  `themeExtensions`.

`DEFAULT_THEME` is the default asset theme that fills the required
foundation/semantic layers and the default catalog's component recipes.
Component specs decide which prop values an author may write; theme data decides
how trusted components turn those values into visual output.

```ts check-docs
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { themeToCssVars } from "@facet/core";

const vars = themeToCssVars(DEFAULT_THEME, { catalog: DEFAULT_CATALOG });

console.log(vars["--facet-semantic-text-default"] !== undefined);
```

Hosts may replace the theme with another complete theme that passes Core
validation. Required foundation and semantic token names are closed; hosts may
add their own extension namespaces only by declaring them at bootstrap. Facet
does not merge partial themes at runtime, and authored markup does not contain
raw CSS, hex colors, imports, or executable style logic.

## Custom components

A custom component set has three required parts:

1. a Core component spec declaring the tag and prop schema;
2. a catalog containing that spec; and
3. a trusted React registry entry for the same tag.

Renderer bootstrap rejects mismatched tag sets. Unknown authored tags and
undeclared props reject at author validation before any React component can
mount.

## Data and actions

Declared props may accept `data:` bindings only when the component spec allows
that prop to bind. Actions use explicit `nav:` and `agent:` references. `nav:`
changes browser-local screen state; `agent:` forwards a validated event with the
fields named by the component contract.

Facet components do not perform product-domain fetches. The host or agent tools
fetch data, authorize it, and publish a bounded projection into Facet.

## Failure policy

Invalid author markup rejects atomically. Corrupt persisted input is handled by
the runtime and renderer fail-safe boundaries: unsafe fragments are reduced or
isolated, and valid siblings continue.

The fail-safe path is for stale or bypassed data, not for accepting invalid
model output.
