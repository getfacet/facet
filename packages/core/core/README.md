# @facet/core

The Facet contract: the declarative stage spec (v1 high-level bricks plus the
primitive `box`, `text`, `media`, and `field` fallback), catalog policy, style
tokens and theme recipes, reusable stamp expansion/metadata, the
[RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) JSON Patch
`applyPatch`, validators, and the session/event types. It depends on nothing —
every other Facet package builds on it.

The style-token vocabulary includes colors, spacing, typography
(`FontFamily` / `FontSize` / `FontWeight`), radii, media ratios, flow layout,
and bounded text/media style choices. Theme recipes are token-only style bundles
for component variants and closed internal recipe parts; concrete CSS values
live in validated theme data, not in agent-authored trees. Recipe parts let a
theme describe renderer-owned affordances such as field labels/controls, table
cells, tabs, chart plots, progress fills, list rows, and divider rules without
letting agents emit raw CSS or arbitrary part keys.

```bash
npm install @facet/core
```

Core helpers do the heavy lifting: `validateTree` turns arbitrary input (e.g. an
LLM's JSON) into a guaranteed-renderable tree, preserving valid primitive
fallback and high-level nodes while dropping malformed payloads; `validateCatalog`
turns untrusted catalog data into bounded UI policy; `validateTheme` gates
token-value maps, component recipes, and recipe parts as operator data;
`expandStamp` fills
validated stamp slots, preserves bounded metadata, prunes the root-reachable
subtree, drops stamped actions that point outside that subtree, and remaps ids
before a caller emits ordinary patches. `applyPatch` is the one patch function
that runs identically on server and client.

```ts
import {
  applyPatch,
  EMPTY_TREE,
  expandStamp,
  validateCatalog,
  validateTree,
} from "@facet/core";

// Fail-safe: unknown nodes / bad tokens are stripped, never thrown on.
const { tree, issues } = validateTree(EMPTY_TREE);

// Catalogs are UI vocabulary policy, not hosted auth/billing/tenant policy.
const { catalog } = validateCatalog({
  name: "product-ui",
  theme: { active: "default", switchPolicy: "locked" },
  bricks: [{ type: "section", variants: ["surface"] }, { type: "card" }],
  stamps: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: ["stamp", "brick", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
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

const expanded = expandStamp(
  {
    name: "card",
    slots: { title: "Card title" },
    root: "card.root",
    nodes: {
      "card.root": { id: "card.root", type: "box", children: ["card.title"] },
      "card.title": { id: "card.title", type: "text", value: "{{title}}" },
    },
  },
  { title: "Hello" },
  { parent: "root" },
  { existingIds: new Set(Object.keys(tree.nodes)) },
);
```

`expandStamp` is fail-safe: malformed params become issues and defaults, unknown
parents return no ops, and the returned ids are fresh only for the nodes that
will actually be emitted. Stamps may carry bounded metadata for prompt guidance,
but expansion still emits ordinary nodes and JSON Patch operations. `applyPatch`
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
