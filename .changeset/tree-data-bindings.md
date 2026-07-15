---
"@facet/core": minor
"@facet/react": minor
"@facet/agent": minor
"@facet/agent-tools": minor
"@facet/reference-agent": minor
---

Tree data warehouse + bindings: an agent can declare a dataset once in an
optional top-level `data` map on the stage tree and bind multiple display nodes
(`table`, `chart`, `list`, `keyValue`, and single-cell `text`) to it by name via a
new
optional `from` field, instead of copying the same rows/series into each node. A
single `/data/<name>` (or `/data/<name>/<i>/<col>`) patch then updates every
bound view. Purely additive — inline data stays valid, and `from` is opt-in.

- `@facet/core`: optional `FacetTree.data` (`Record<string, Dataset>`), `from?`
  on the five data-bearing node types plus `column?`/`row?` on `text`;
  new `Dataset`/`DataRow`/`DataCell`/`DataWarehouse` types, the pure
  `sanitizeDataWarehouse` (closed row-record schema, forbidden-key-safe, capped)
  and the single `resolveNodeData` (precedence + fixed per-node projection).
  `validateTree` sanitizes `data`; `treeHasContent`/`treeRenderableNodeIds`
  resolve `from` so a data-backed node counts as content. `STAGE_SPEC` teaches
  the warehouse + `from` binding (names only — no fetch/resolver/expression).
- `@facet/react`: the renderer resolves `from` for every data-bearing node
  (read-only; no client-side data writer), projecting the row-records into each
  node's shape; a dangling/absent `from` renders empty and never throws.
- `@facet/agent`: `Stage.setData(name, rows)` emits a `/data/<name>` patch.
- `@facet/agent-tools` / `@facet/reference-agent`: `describeNode` reports the
  resolved counts of from-bound nodes, and the prompt kit + system prompt teach
  authoring data once and binding many views.

Local table sort is a later closed renderer capability. Row-predicate filtering
over shared data remains deferred; fixed choices can navigate pre-authored
screens locally without adding a second data writer.
