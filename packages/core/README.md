# @facet/core

The Facet contract: the declarative stage spec (`box` / `text` / `image` /
`field` bricks + style tokens), the [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902)
JSON Patch `applyPatch`, `validateTree`, and the session/event types. It depends
on nothing — every other Facet package builds on it.

```bash
npm install @facet/core
```

Two pure functions do the heavy lifting: `validateTree` turns arbitrary input
(e.g. an LLM's JSON) into a guaranteed-renderable tree, and `applyPatch` is the
one patch function that runs identically on server and client.

```ts
import { applyPatch, EMPTY_TREE, validateTree } from "@facet/core";

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
```

Also exported: small dependency-free async primitives the other packages build
on — `createSerialQueue` (per-key ordering) and `createSemaphore` (FIFO
concurrency cap).

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
