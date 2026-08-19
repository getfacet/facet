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

The default assets cover landing, personal, commerce, booking, SaaS, analytics,
support, collaboration, education, knowledge, finance, and operations services.
The default catalog has exactly 47 registered tags:

`Screen`, `Stack`, `Row`, `Grid`, `Split`, `AppShell`, `Section`, `Card`,
`Modal`, `Divider`, `Navigation`, `NavigationItem`, `Button`, `ActionGroup`,
`ActionBar`, `Text`, `Avatar`, `Icon`, `Image`, `Badge`, `Metric`,
`MetricGroup`, `Table`, `Chart`, `Progress`, `Timeline`, `List`, `Header`,
`Collection`, `ItemCard`, `Detail`, `PropertyList`, `Property`, `Board`,
`BoardColumn`, `Calendar`, `Result`, `Empty`, `Alert`, `Form`, `Field`,
`Select`, `ChoiceGroup`, `Toggle`, `MessageThread`, `Accordion`, and
`AccordionItem`.

Every default spec declares one closed content mode. `none`, `children`, and
`slots` derive the agent-facing classes `Leaf`, `Container`, and `Structured`
respectively; the class is never separate metadata. Structured components use
named slots with bounded cardinality. For example, `AppShell` separates
`navigation`, `header`, and required `main`; `Collection` separates `controls`,
required `items`, and `actions`; and `Form` requires `fields` and `actions`.
Trusted implementations receive immutable named slot arrays, while ordinary
containers receive ordered children.

Structured bound props can declare a closed shallow scalar shape. The default
option shape is `{ label: string, value: string, disabled?: boolean }`; calendar
events use `{ id: string, title: string, start: string, end?: string, tone?:
string }`; and messages use `{ id: string, author: string, body: string,
timestamp?: string, side?: string, status?: string }`. `Table.rows` and
`Chart.data` deliberately remain bounded open record arrays because their
authored key props select display fields.

Collected values are typed through the Core contract. `Field` and `Calendar`
collect strings, `Toggle` collects a boolean, `Select` collects one string, and
`ChoiceGroup` collects a bounded string array. `Button` can request named field
values for an `agent:` event, but no default component collects a number,
object, or file.

The default theme is a coherent baseline for demos, examples, and hosts that do
not need a custom visual system yet. Foundation and semantic token names remain
closed by Core, component recipes are declared by the active catalog, extension
namespaces are declared by the host, and registered React components decide how
those values render.

`Image` accepts only an `asset:key` reference resolved from the immutable image
registry supplied at renderer bootstrap. The package supplies no remote media
by default: an omitted registry becomes an empty frozen registry. Arbitrary URL
literals and Data Model bindings cannot satisfy the image asset prop.

The catalog defines components, not reusable compositions. A host may replace
the catalog, registry, and theme together to add its own trusted components. An
agent still owns each screen tree and composes only registered components;
neither the media asset registry nor catalog metadata stores authored subtrees.

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
