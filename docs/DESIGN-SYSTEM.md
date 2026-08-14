# Design System

Facet's design system is a closed component catalog plus a layered theme
contract and a trusted React registry. Agents choose registered tags and
declared props; hosts own the theme values and the React components that render
them.

## Default component set

The default assets package registers 38 components:

`Screen`, `AppShell`, `Stack`, `Row`, `Split`, `Grid`, `Modal`, `Card`, `Empty`,
`LogoMark`, `Nav`, `SideNav`, `SideNavItem`, `Section`, `Divider`, `Hero`,
`Avatar`, `ProfileHeader`,
`ProductShowcase`, `VisualPanel`, `MediaCard`, `LinkList`, `SocialLinks`,
`FeatureList`, `StatStrip`, `Gallery`, `Testimonial`, `Timeline`, `CTA`,
`Alert`, `Progress`, `Footer`, `Text`, `Metric`, `Badge`, `Table`, `Button`,
and `Field`.

```ts check-docs
import { DEFAULT_CATALOG } from "@facet/assets";

const tags = DEFAULT_CATALOG.components.map((component) => component.tag);

console.log(tags.includes("Text"), tags.includes("Modal"));
```

The default set is meant to cover service surfaces, not only dashboards:
personal/bio, marketing/landing, commerce/booking, SaaS/workspace,
content/editorial, data/report, and support/form-flow screens. `Metric` remains
available for workspace/report surfaces, but it is not the center of every
default example. `Table` is a content/data-display component: it can support a
report, a resume, a booking list, or an order queue without turning the whole
screen into a dashboard.
`Badge` is a compact status label, not an action surrogate: its tones map to the
semantic status tokens and the default React implementation keeps it inline
width inside stretched stacks.

`Screen` is the root for a named screen. `AppShell`, `Stack`, `Row`, `Split`,
and `Grid` keep authored layout flow-contained. `Modal` is the dedicated overlap contract. Expression
components such as `LogoMark`, `Nav`, `SideNav`, `SideNavItem`, `Hero`, `ProfileHeader`,
`ProductShowcase`, `VisualPanel`, `MediaCard`, `SocialLinks`, `StatStrip`,
`Gallery`, `Timeline`, `Footer`, `Section`, `CTA`, `Testimonial`, `Avatar`,
`LinkList`, and `Progress` provide first-impression, editorial, profile,
commerce, workspace, and service-page structure. Content and interactive
components expose only their declared scalar, action, collection, and binding
props.

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
`Row`, `Stack`, `Hero` or `CTA` decides whether that button appears under a
headline, beside another button, or inside a form section. `Stack` also has
bounded `justify` and `grow` props so equal-height cards can distribute vertical
space without exposing CSS.

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

1. a Core component spec declaring the tag, authoring role metadata, and prop
   schema;
2. a catalog containing that spec; and
3. a trusted React registry entry for the same tag.

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

Authoring metadata is required for default and custom components. Choose one
role from `layout`, `display`, `action`, or `task`, then provide that role's
closed semantic fields. Roles help an agent discover a useful component; they
do not alter theme ownership, registry trust, props, or child composition.

## Data and actions

Declared props may accept `data:` bindings only when the component spec allows
that prop to bind. Actions use explicit `nav:` and `agent:` references. `nav:`
changes browser-local screen state; `agent:` forwards a validated event with the
fields named by the component contract.

Facet components do not perform product-domain fetches. The host or agent tools
fetch data, authorize it, and publish a bounded projection into Facet.

The default assets still defer URL-bearing media, raw external links, pricing
blocks, and open form composition. `LogoMark` and `Avatar` render trusted marks
or initials, not image URLs; `MediaCard` provides image-like rhythm without an
external media prop; and `LinkList`/`SocialLinks` group trusted `Button` actions
rather than raw anchors. Components such as `Image`, `Logo`, `Pricing`, and
`Form` need separate safe policy or repeated-use evidence before they become
default catalog members.

## Failure policy

Invalid author markup rejects atomically. Corrupt persisted input is handled by
the runtime and renderer fail-safe boundaries: unsafe fragments are reduced or
isolated, and valid siblings continue.

The fail-safe path is for stale or bypassed data, not for accepting invalid
model output.
