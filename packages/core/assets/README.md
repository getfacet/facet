# @facet/assets

Default Facet component catalog, layered theme data, and trusted default React
implementations. The package keeps plain data at the root entrypoint and React
code behind the explicit browser-safe subpath.

Role: **Core**.

```bash
npm install @facet/assets @facet/core
```

## Root entrypoint

`@facet/assets` exports exactly the default data a host can validate and pass
to Core/runtime surfaces:

- `DEFAULT_CATALOG` — the registered default component tags and prop schemas.
- `DEFAULT_COMPONENT_SPECS` — the component spec list used to build the catalog.
- `DEFAULT_THEME` — one complete Facet Design Contract v1 theme: required
  foundation and semantic tokens plus recipes for the default catalog.

The root entrypoint imports no React and no browser globals. A server can load
the default catalog and theme without pulling renderer code into its graph.

## React subpath

`@facet/assets/react` exports `DEFAULT_REGISTRY`, the trusted React
implementation map for the same default tag set. Renderer bootstrap compares
the active catalog with the registry exactly, so an authored component can only
mount when both halves of the host trust boundary agree.

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

console.log(boot.catalog.components.length);
```

## Default design system

The default assets cover service surfaces rather than only dashboards:
personal/bio, marketing/landing, commerce/booking, SaaS/workspace,
content/editorial, data/report, and support/form-flow screens. Dashboard UI is
one supported group, not the identity of the whole catalog.

The default catalog has 38 registered tags:

`Screen`, `AppShell`, `Stack`, `Row`, `Split`, `Grid`, `Modal`, `Card`, `Empty`,
`LogoMark`, `Nav`, `SideNav`, `SideNavItem`, `Section`, `Divider`, `Hero`,
`Avatar`, `ProfileHeader`,
`ProductShowcase`, `VisualPanel`, `MediaCard`, `LinkList`, `SocialLinks`,
`FeatureList`, `StatStrip`, `Gallery`, `Testimonial`, `Timeline`, `CTA`,
`Alert`, `Progress`, `Footer`, `Text`, `Metric`, `Badge`, `Table`, `Button`,
and `Field`.

The default specs classify those tags for agent discovery as `layout`,
`surface`, `content`, or `interaction`. This optional metadata helps an agent
plan composition before detail; it does not affect rendering or require every
custom component to declare a role.

The default theme is a coherent baseline for demos, examples, and hosts that do
not need a custom visual system yet. Foundation and semantic token names remain
closed by Core, component recipes are declared by the active catalog, extension
namespaces are declared by the host, and registered React components decide how
those values render.

Component props still own composition. For example, `AppShell` separates a rail
from main content, `Split` creates an asymmetric two-column rhythm, and
`Stack justify="between"` plus `grow="true"` can distribute content inside an
equal-height card, while the card, button, text, and badge recipes decide how
those elements look.
`Badge` is deliberately status-shaped rather than button-shaped: non-neutral
tones use semantic status background, border, and text tokens, and the default
React implementation keeps badges to their content width inside stretched
layouts.

URL-bearing media and raw external-link components are not half-opened in the
default set. `LogoMark` and `Avatar` are mark/initials-only, `MediaCard`
provides image-like rhythm without arbitrary media URLs, and `LinkList` plus
`SocialLinks` compose trusted `Button` actions. Image, logo, pricing, and form
components need separate safe asset-reference or repeated-use policy before
becoming default components.

Use this package unchanged for the built-in component set, or provide your own
catalog/registry/theme trio when the host has a different trusted component
system.

## Documentation

- [Design System](https://github.com/getfacet/facet/blob/main/docs/DESIGN-SYSTEM.md) —
  catalog, registry, and theme ownership.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  trust boundary and runtime behavior.
- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md) —
  supported adoption paths.
