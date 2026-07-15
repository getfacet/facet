# @facet/core

The Facet contract: the declarative stage spec in the Component -> Primitive
Fallback authoring model, catalog policy, style tokens and theme recipes,
validation for concrete composition reference datasets, the
[RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) JSON Patch
`applyPatch`, validators, and the session/event types. It depends on nothing —
every other Facet package builds on it.

The style-token vocabulary includes colors, spacing, typography
(`FontFamily` / `FontSize` / `FontWeight`), radii, media ratios, flow layout,
and bounded text/media style choices. Theme recipes are token-only style bundles
for component variants and closed internal recipe parts; concrete CSS values
live in validated theme data, not in agent-authored trees. Recipe parts let a
theme describe renderer-owned affordances such as field labels/controls, table
cells, tabs, chart plots, progress fills, and list rows without
letting agents emit raw CSS or arbitrary part keys.

```bash
npm install @facet/core
```

Core helpers do the heavy lifting: `validateTree` turns arbitrary input (e.g. an
LLM's JSON) into a guaranteed-renderable tree, preserving valid primitive
fallback and routing every intrinsic/legacy component through one canonical
component validator while dropping malformed payloads;
`validateCatalog` turns untrusted catalog data into bounded UI policy; `validateTheme` gates
token-value maps, component recipes, and recipe parts as operator data;
`validateComposition` turns an untrusted composition document into a validated
`FacetComposition` or refuses it whole. A composition is a self-contained native
node dataset with `{ name, metadata: { description, ... }, root, nodes }`; its
root may be a leaf or a container. The validator sanitizes node shapes and
tokens, prunes dangling children, breaks cycles, and requires the root and
`metadata.description` to survive. A raw node map above 1023 nodes rejects the
entire document. `applyPatch` is the one patch function that runs identically on
server and client.

The public `normalizeVisitorContext`, `normalizeClientEvent`, and
`normalizeLocalCollectedEvent` helpers give every transport the same rejecting,
closed-shape boundary for untrusted browser input. They drop unknown keys, apply
the shared field/action bounds, and clamp optional view snapshots through
`sanitizeView` before an event reaches an agent or Sink.

```ts
import {
  applyPatch,
  EMPTY_TREE,
  validateComposition,
  validateCatalog,
  validateTree,
} from "@facet/core";

// Fail-safe: unknown nodes / bad tokens are stripped, never thrown on.
const { tree, issues } = validateTree(EMPTY_TREE);

// Catalogs are UI vocabulary and reference-exposure policy, not hosted policy.
const { catalog } = validateCatalog({
  name: "product-ui",
  theme: { active: "default", switchPolicy: "locked" },
  components: [{ type: "button", variants: ["primary"] }, { type: "metric" }],
  compositions: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: ["component", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
  },
});

// Reference datasets contain concrete native nodes; validation never mutates a stage.
const { composition } = validateComposition({
  name: "welcome-card",
  metadata: { description: "A compact welcome card with one action." },
  root: "card",
  nodes: {
    card: {
      id: "card",
      type: "box",
      style: { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md" },
      children: ["title", "start"],
    },
    title: {
      id: "title",
      type: "text",
      value: "Welcome",
      style: { size: "lg", weight: "bold" },
    },
    start: {
      id: "start",
      type: "button",
      label: "Get started",
      onPress: { kind: "agent", name: "start" },
    },
  },
});

// Only patches travel — the same pure applyPatch on both ends.
const next = applyPatch(tree, [
  {
    op: "add",
    path: "/nodes/hello",
    value: { id: "hello", type: "text", value: "Hi" },
  },
  { op: "add", path: "/nodes/root/children/-", value: "hello" },
]);

// A consumer can inspect `composition`, adapt its native nodes, then author
// ordinary RFC 6902 operations. Core does not apply a reference to a stage.
```

Composition documents admit only the same closed native node and token
vocabulary as stage trees. Raw HTML, JavaScript, CSS, fetch/query/resolver
instructions, unknown node kinds, and invalid root documents are refused
fail-safe. There is no reference-node, placeholder, dependency-graph, or
composition-specific stage mutation API in core: a consumer reads the validated
data and authors ordinary native nodes and patches itself.

`FacetCatalog.compositions` is only an exposure policy for those optional
datasets (`all` or an allow-list); it is not an authoring tier. The fixed catalog
authoring order is `component -> primitive`.

The theme, catalog, and composition-validation implementations are organized as
private responsibility modules behind these same root exports. Their helpers
are not additional package entry points; the public API remains the contract
exported from `@facet/core`. Composition assets may carry bounded metadata for
agent guidance, while stage edits remain ordinary nodes and JSON Patch operations. `applyPatch`
enforces JSON Pointer reads for source operations (`move`, `copy`, and `test`)
and requires object-member `replace`/`remove` targets to exist before mutating,
so stale ops do not leave partial object members behind or count as stage edits.

Also exported: small dependency-free async primitives the other packages build
on — `createSerialQueue` (per-key ordering) and `createSemaphore` (FIFO
concurrency cap).

The agent contract is `FacetAgent`: given a `ClientEvent` and `FacetSession`, it
returns either one `ServerMessage[]` or an `AsyncIterable<ServerMessage[]>`.
Streaming agents yield closed batches; the runtime applies and delivers each
batch before pulling the next.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
