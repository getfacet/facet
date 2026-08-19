# @facet/core

Dependency-free Facet contract package. It defines the component-markup grammar,
component content and prop contracts, catalog validation, bounded data and asset
models, document serialization, conversation/event protocol, revision helpers,
and authorized RFC 6902 patch folding used by every other Facet package.

Role: **Core**.

```bash
npm install @facet/core
```

Use this package when you need the safe data contract without a renderer,
transport, runtime process, or agent brain.

## Component markup

Agents author one declarative markup envelope:

- `<Facet entry="...">` wraps the document.
- `<Screen name="...">` declares each screen root.
- Registered component tags describe UI through declared scalar props.
- `data:path`, `nav:screen`, and `agent:action` references are the only
  reference forms.

The parser rejects executable or host-escape syntax before catalog validation:
raw HTML, JavaScript or JSX expressions, event-handler props, imports, spreads,
inline JSON objects, raw CSS, arbitrary style keys, and unsupported reference
schemes. The resulting AST is data, not code.

`validateAuthorMarkup` then checks the parsed markup against the active
`FacetCatalog` and the current data model. Unknown tags, undeclared props,
invalid scalar values, unauthorized bindings, and unresolved action/collection
contracts reject atomically with one repair-oriented author error.

```ts check-docs
import { parseMarkup, serializeDocument, validateAuthorMarkup } from "@facet/core";
import { DEFAULT_CATALOG } from "@facet/assets";

const parsed = parseMarkup(
  `<Facet entry="home"><Screen name="home"><Text value="Hello" /></Screen></Facet>`,
);

if (!parsed.ok) {
  throw new Error(parsed.error.repair);
}

const validated = validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, {});
if (!validated.ok) {
  throw new Error(validated.error.repair);
}

const serialized = serializeDocument(validated.document);
console.log(serialized.text);
```

## Catalog and component specs

`FacetCatalog` is the host-owned list of component specifications an agent may
author against. A catalog declares:

- tag names;
- accepted props and scalar domains;
- which props may bind to data paths;
- optional shallow shapes for structured bound props;
- a closed content mode and any named slot contracts;
- which components collect each bounded visitor value kind; and
- which component-owned theme recipe tokens the active theme must fill.

Every component declares exactly one `content` branch:

- `{ mode: "none" }` accepts no child nodes and derives the discovery class
  `Leaf`.
- `{ mode: "children" }` accepts ordered, unslotted child nodes and derives
  `Container`.
- `{ mode: "slots", slots: { ... } }` requires direct children to use a
  declared `slot="name"` and derives `Structured`. Each slot declares bounded
  guidance, minimum and maximum child counts, and an optional registered-tag
  allowlist. Every allowlisted tag must be registered in the same catalog.

`deriveComponentContentClass` computes those agent-facing classes from content;
they are not independent catalog policy. The parser stores a direct child's
literal slot as `ComponentNode.slot`, separate from ordinary props, and document
validation enforces the parent contract before a mutation can commit. The exact
`slot` name is therefore reserved from component prop declarations.

`validateCatalog`, `buildCatalogIndex`, `validateComponentSpec`, and
`validateModalConformance` keep that catalog closed and deterministic. `Facet`
is reserved for the grammar envelope, `Screen` must be registered as the screen
root component, and a registered `Modal` must satisfy the dedicated trusted
frame contract.

Core does not ship React components. It only defines what a valid host catalog
means; renderer packages close that catalog against a trusted registry.

The default catalog is supplied by `@facet/assets` and contains exactly 47 tags:

`Screen`, `Stack`, `Row`, `Grid`, `Split`, `AppShell`, `Section`, `Card`,
`Modal`, `Divider`, `Navigation`, `NavigationItem`, `Button`, `ActionGroup`,
`ActionBar`, `Text`, `Avatar`, `Icon`, `Image`, `Badge`, `Metric`,
`MetricGroup`, `Table`, `Chart`, `Progress`, `Timeline`, `List`, `Header`,
`Collection`, `ItemCard`, `Detail`, `PropertyList`, `Property`, `Board`,
`BoardColumn`, `Calendar`, `Result`, `Empty`, `Alert`, `Form`, `Field`,
`Select`, `ChoiceGroup`, `Toggle`, `MessageThread`, `Accordion`, and
`AccordionItem`.

## Structured props and assets

An `array` or `object` prop is binding-only. It may declare a `shape` containing
one closed, shallow field map whose values are `string`, `number`, or `boolean`,
with bounded guidance and optional required flags. Shapes do not nest and do not
admit unions or arbitrary schema keywords. A bound object must match the field
map exactly; every item of a shaped array must match independently. Structured
props without a shape remain bounded open records for components that select
their own display fields.

Core also defines `FacetAssetRegistry`, an immutable host-pinned map of bounded
keys to V1 image descriptors. `validateFacetAssetRegistry` snapshots descriptors
of the form `{ kind: "image", src, width?, height? }`, where `src` is a safe
HTTPS URL or image data URI supplied by the host. Author markup can refer to one
only as `asset:key` on a string prop declaring `assetKind: "image"`. Literal
URLs, data bindings, unknown keys, wrong kinds, and malformed registries fail
closed. `resolveFacetAsset` performs the same checked lookup for rendering.

## Typed collection

`CollectedValue` is exactly `string | boolean | readonly string[]`. A
collectable component declares its injected value prop and one `valueKind`:
`string`, `boolean`, or `string[]`. Facet owns the field address, validates the
runtime value against that declaration, freezes string arrays, and applies the
existing scalar size and array-count bounds before an event is forwarded.
Numbers, objects, and files are not collected values.

## Components and composition

A component is a host-owned catalog spec paired with trusted registered render
code. A composition is the agent-authored tree of those registered components
inside a screen. Content modes and slots constrain that tree, but they do not
turn a subtree into another catalog entry. Asset registries contain host-pinned
media descriptors, not component trees or reusable compositions. Hosts extend
the component vocabulary by supplying a matching catalog and registry; agents
compose only the immutable vocabulary active for their session.

## Theme contract

Core owns Facet Design Contract v1: required `foundation` and `semantic` theme
layers, catalog-declared component `recipes`, and host-declared `extensions`.
`validateTheme`, `validateThemeExtensionDeclarations`, `themeToCssVars`,
`themeTokenVar`, `themeTokenRef`, and `FACET_THEME_CONTRACT` are the shared
helpers every runtime, renderer, and asset package uses to keep theme data
closed and CSS custom-property names stable.

Recipe namespaces derive from component tags with `facetThemeToKebabCase`.
Catalog validation rejects recipe-owning tags that collide after that
projection, so a theme namespace always resolves to one component recipe
contract.

## Documents, data, and patches

Validated author markup becomes a `ComponentDocument`: named screens,
component nodes with optional slot assignment, and bounded data. Core provides:

- `buildDocument` for constructing a document from parsed markup;
- `serializeDocument` and `serializeScreen` for safe prompt/readback text;
- `writePath`, `measurePublishPayload`, and `evaluateCandidateModel` for data
  publication limits;
- `resolveBinding` for schema-authorized read-only bindings; and
- `applyPatch` for the shared RFC 6902 fold.

Only validated patches change a live stage. Runtime and browser clients use the
same fold, so stale or bypassed state is either rejected atomically or reduced
to a safe subset.

## Protocol and runtime-neutral types

Core also owns the transport-neutral message vocabulary:
`FacetAgent`, `FacetTransport`, `TurnOutcome`, `ServerFrame`, `PatchFrame`,
`VisitorEvent`, `StageRevision`, and related validation helpers. Those types let
runtime, client transports, renderers, and agent packages agree on revision
coherence without introducing package cycles.

## Documentation

- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  system invariants and runtime behavior.
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md) —
  ownership and dependency direction.
- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md) —
  supported adoption paths.
