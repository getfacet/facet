# @facet/core

Dependency-free Facet contract package. It defines the component-markup grammar,
component catalog validation, bounded data model, document serialization,
conversation/event protocol, revision helpers, and authorized RFC 6902 patch
folding used by every other Facet package.

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
- which components collect visitor input; and
- whether a component may contain children.

`validateCatalog`, `buildCatalogIndex`, `validateComponentSpec`, and
`validateModalConformance` keep that catalog closed and deterministic. `Facet`
is reserved for the grammar envelope, `Screen` must be registered as the screen
root component, and a registered `Modal` must satisfy the dedicated trusted
frame contract.

Core does not ship React components. It only defines what a valid host catalog
means; renderer packages close that catalog against a trusted registry.

## Documents, data, and patches

Validated author markup becomes a `ComponentDocument`: named screens,
component nodes, and bounded data. Core provides:

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
