# Design System

Facet's design system is a closed component catalog plus a layered theme
contract and a trusted React registry. Agents choose registered tags and
declared props; hosts own the theme values and the React components that render
them.

## Default component set

The default assets package registers 47 components:

`Screen`, `Stack`, `Row`, `Grid`, `Split`, `AppShell`, `Section`, `Card`,
`Modal`, `Divider`, `Navigation`, `NavigationItem`, `Button`, `ActionGroup`,
`ActionBar`, `Header`, `Collection`, `ItemCard`, `Detail`, `PropertyList`,
`Property`, `Board`, `BoardColumn`, `Calendar`, `Result`, `Empty`, `Alert`,
`Text`, `Avatar`, `Icon`, `Image`, `Badge`, `Metric`, `MetricGroup`, `Table`,
`Chart`, `Progress`, `Timeline`, `List`, `Form`, `Field`, `Select`,
`ChoiceGroup`, `Toggle`, `MessageThread`, `Accordion`, and `AccordionItem`.

Every component declares one closed content contract. A leaf accepts no child
components, a container accepts ordinary children, and a structured component
declares named slots with cardinality and optional allowed-tag rules. Agent
integrations derive these three discovery classes from the contract; the class
does not add separate runtime authority.

```ts check-docs
import { DEFAULT_CATALOG } from "@facet/assets";

const tags = DEFAULT_CATALOG.components.map((component) => component.tag);

console.log(tags.includes("Text"), tags.includes("Modal"));
```

The default set covers marketing, profile, commerce, booking, workspace,
editorial, reporting, support, and form flows without giving authored markup raw
HTML or CSS. `Screen` is the named root. Flow containers establish spatial
structure, structured task components provide stable regions, and leaf
components display data or collect bounded input. `Modal` remains the dedicated
framework-owned overlap contract.

`Metric`, `Table`, and `Chart` support analytical views without making every
screen a dashboard. `Badge` is a compact status label rather than an action.
`Image` resolves only host-pinned assets, and `Icon` accepts only its declared
closed name set.

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

Recipes style a component's own surface, typography, spacing, borders, and
states. They do not decide where a button goes in a screen. Placement is
authored composition through `Screen`, `AppShell`, `Stack`, `Row`, `Split`,
`Grid`, `Section`, `Card`, and sibling order. For example, a button's recipe
controls its fill, border, radius, padding, and focus ring; the surrounding
`Row`, `Stack`, `Header`, or `ActionGroup` decides whether that button appears
under a heading, beside another button, or inside a form section. `Stack` also
has bounded `justify` and `grow` props so equal-height cards can distribute
vertical space without exposing CSS.

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

The spec's content mode determines whether the component is a leaf, container,
or structured component. `whenToUse` explains the problem the component solves;
props, slots, structured shapes, asset kinds, and collection metadata define the
complete authoring contract.

A prop that activates navigation or an agent event is a string prop declaring
`action: true`. Only that prop may carry `nav:` or `agent:`; ordinary labels and
other string props cannot become hidden interaction sources. A trusted custom
component reports that exact prop name through `onAction(prop)`.

Renderer bootstrap rejects mismatched tag sets. Unknown authored tags and
undeclared props reject at author validation before any React component can
mount.

Quickstart's `--design <path>` flag is a local inspection path for trusted design
modules. It starts from the default catalog/theme/registry, lets the module
change default theme values, declare extension token namespaces when needed, and
add component specs with matching trusted registry entries. Replacing default
component tags or default registry entries is rejected; untrusted design input
should use a host-owned data-only integration instead of executable local module
loading.
When a design module is active, the Quickstart Assets source filter can show
`Imported` component tags and screen examples separately from `Default` assets,
or combine both in `All`.

## Data and actions

Declared props may accept `data:` bindings only when the component spec allows
that prop to bind. Action-marked props use explicit `nav:` and `agent:` references. `nav:`
changes browser-local screen state; `agent:` forwards a validated event with the
fields named by the component contract.

Facet components do not perform product-domain fetches. The host or agent tools
fetch data, authorize it, and publish a bounded projection into Facet.

The default assets still exclude raw external links and arbitrary media URLs.
`Image` accepts only an `asset:` reference resolved from the host-pinned asset
registry. `Navigation`, `ActionGroup`, and related components compose trusted
`Button` actions rather than raw anchors. `Form` groups Facet-owned collectable
controls and an explicit action region; customer data access remains outside the
component package.

## Failure policy

Invalid author markup rejects atomically. Corrupt persisted input is handled by
the runtime and renderer fail-safe boundaries: unsafe fragments are reduced or
isolated, and valid siblings continue.

The fail-safe path is for stale or bypassed data, not for accepting invalid
model output.
