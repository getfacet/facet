# @facet/assets

Default Facet component catalog, layered theme data, and trusted default
React implementations. The package keeps plain data at the root entrypoint and
React code behind the explicit browser-safe subpath.

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

The default theme is a neutral baseline for demos, examples, and hosts that do
not need a custom visual system yet. Foundation and semantic token names remain
closed by Core, component recipes are declared by the active catalog, extension
namespaces are declared by the host, and registered React components decide how
those values render.

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
