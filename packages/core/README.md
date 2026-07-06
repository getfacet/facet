# @facet/core

The Facet contract: the declarative stage spec (`box` / `text` / `media` /
`field` bricks + style tokens), reusable stamp expansion, the
[RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) JSON Patch
`applyPatch`, `validateTree`, and the session/event types. It depends on nothing
— every other Facet package builds on it.

```bash
npm install @facet/core
```

Three pure functions do the heavy lifting: `validateTree` turns arbitrary input
(e.g. an LLM's JSON) into a guaranteed-renderable tree, `expandStamp` fills
validated stamp slots, prunes the root-reachable subtree, drops stamped actions
that point outside that subtree, and remaps ids before a caller emits ordinary
patches. `applyPatch` is the one patch function that runs identically on server
and client.

```ts
import { applyPatch, EMPTY_TREE, expandStamp, validateTree } from "@facet/core";

// Fail-safe: unknown nodes / bad tokens are stripped, never thrown on.
const { tree, issues } = validateTree(EMPTY_TREE);

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
will actually be emitted.

Also exported: small dependency-free async primitives the other packages build
on — `createSerialQueue` (per-key ordering) and `createSemaphore` (FIFO
concurrency cap).

The agent contract is `FacetAgent`: given a `ClientEvent` and `FacetSession`, it
returns either one `ServerMessage[]` or an `AsyncIterable<ServerMessage[]>`.
Streaming agents yield closed batches; the runtime applies and delivers each
batch before pulling the next.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
