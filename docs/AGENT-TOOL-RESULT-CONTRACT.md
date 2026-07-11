# Agent Tool Result Contract

Facet stage tools are consumed by LLMs, so their results must be machine-readable
and hard to misinterpret. A tool result is not just a log line. It is the model's
only feedback loop for deciding whether to continue editing the stage, inspect
the current state, or tell the visitor that the work is done.

This contract applies to LLM-facing Facet stage tool observations emitted by
`@facet/agent-tools` and consumed by `@facet/reference-agent`.

## Required Shape

Every LLM-facing observation is a bounded JSON string with these fields:

```json
{
  "version": 1,
  "tool": "append_node",
  "status": "ok",
  "outcome": "applied_visible",
  "applied": true,
  "stage_changed": true,
  "visible_to_visitor": true,
  "patch_count": 2,
  "changed_node_ids": ["root", "headline"],
  "omitted_changed_node_count": 0,
  "warnings": [],
  "omitted_warning_count": 0,
  "message": "Appended \"headline\" under \"root\".",
  "next_action": "",
  "summary": "2 patch ops; changed 2 nodes: headline, root"
}
```

The provider transcript receives this JSON as the normal `tool_result` content.
The field names are intentionally provider-neutral.
The status, outcome, and fact booleans must be coherent: `rejected`, `pending`,
and `no_stage_change` are never applied, and `applied_visible` always means the
stage changed and the changed state is visitor-visible.

### Optional `data` field

Some tools attach an optional `data?: string` field carrying a machine-readable
payload that would be lossy to squeeze into the prose `message`. It is:

- optional — present only when a tool has structured metadata to hand back;
- bounded — capped in length like every other field (≤ 2048 chars);
- always valid JSON — a consumer can `JSON.parse` it directly.

`use_composition` is the producer today: on success it emits
`data` as JSON `{ "root", "slots", "ids", "slotsOmitted"?, "idsOmitted"? }`
describing the expanded fragment's root id, slot-name → node-id map, and
old → new node-id map; every part of the payload participates in the length
budget (root first, then slot entries, then id entries), and `slotsOmitted` /
`idsOmitted` count the entries dropped when a map was too large to fit. This
structured payload moved OUT of `message`, which is now prose only. As a final
safety net, if a `data` value ever exceeds the length bound it is replaced
wholesale with `{ "truncated": true }` rather than sliced mid-JSON.

Consumer rule: parse `data` inside a `try`/`catch` and ignore it on any parse
error. If the parsed value is `{ "truncated": true }`, treat the structured
detail as unavailable and fall back to `inspect_stage` to read the resulting
nodes.

## Outcomes

| Outcome | Meaning | May the model claim the page is done? |
| --- | --- | --- |
| `applied_visible` | The stage changed and the changed stage is reachable from the server-side render root, or a visible stage metadata field changed. | Yes, if the requested work is complete. |
| `applied_not_visible` | A patch was applied, but the changed node is not reachable from the current server-side render root. | No. Attach the node to a visible parent or inspect first. |
| `applied_with_warnings` | A patch was applied, but validation/folding dropped or sanitized something. | Usually no. Inspect or repair when the warning affects the requested work. |
| `pending` | The edit is buffered, usually because a container references child ids that do not exist yet. No patch was emitted. | No. Define the missing children or change the edit. |
| `rejected` | The tool call was invalid or unsafe. No patch was emitted. | No. Follow `next_action`. |
| `no_stage_change` | The tool intentionally did not mutate the stage, for example `inspect_stage`, `inspect_node`, or `say`. | Only if no page change was required. |

## False-Success Rule

A tool result must never report plain success when the visible stage did not
reflect the requested page change.

In particular:

- `set_node` can create or replace a node without attaching it to a visible
  parent. That is `applied_not_visible`, not visible success.
- `render_page` can sanitize invalid nodes. If anything was dropped, the result
  is `applied_with_warnings`.
- Buffered edits are `pending`, not success.
- Rejected edits emit no patch and must include a concrete `next_action`.
- Catalog policy rejections are `rejected`, not warnings. They emit no patch
  when the active catalog disallows a node type, component variant, composition, or theme
  switch.

## Visibility Definition

`visible_to_visitor` is computed from the server-side stage shadow:

- A node is visible when it is reachable from the active render root and no
  hidden box on that path suppresses it.
- `theme`, `root`, `screens`, or `entry` metadata changes count as visible stage
  changes because they affect what the renderer can show.
- Browser-local `navigate` and `toggle` view state is not part of this value.
  Those effects are local to the browser and are not authoritative stage writes.

This is deliberately conservative. If a tool result says
`visible_to_visitor: false`, the model must not claim the visitor can see the
change.

## Recovery Rules

Every non-complete result should include a concrete `next_action`.

- `applied_not_visible`: append the node under an existing visible container, or
  call `inspect_stage` / `inspect_node` to find a visible parent.
- `applied_with_warnings`: inspect the affected stage area or retry with a valid
  closed tree.
- `pending`: define the missing child nodes in the same turn, or replace the
  pending container with a closed node.
- `rejected`: fix the named input, parent, composition, tree, or patch
  limit issue and retry.

Catalog policy rejection is a specific rejected class, often referred to in docs
and tests as `catalog_policy`. The JSON observation still uses the closest
stable `code` value such as `invalid_input`, `invalid_tree`,
`invalid_composition`, or
`invalid_parent`; the catalog detail appears in `message` and the recovery path
appears in `next_action`.

When a catalog policy rejection happens:

- disallowed node type or component variant: use an allowed primitive/component,
  use an allowed variant, or fall back to primitives only when the catalog
  permits primitive fallback;
- disallowed composition: choose a composition allowed by the active catalog
  (via the `use_composition` tool), or compose the UI from allowed
  components/primitives;
- locked theme: keep the active catalog theme and do not call `set_theme`;
- allowed-theme list miss: pick a theme listed by the active catalog.

## Bounds And Privacy

Observations must remain bounded and safe to place in a provider transcript.

- Do not include full stage JSON by default.
- Bound tool names, changed node id lists, warnings, messages, next actions, and
  summaries.
- Normalize non-finite, missing, or negative counts to safe non-negative
  integers before JSON serialization. A count must never become JSON `null`.
- If a changed node id is too long for the observation contract, omit it and
  increment `omitted_changed_node_count`.
- Do not include provider keys, visitor ids, collected secrets, raw CSS values,
  full composition JSON, or unbounded user input.
- Keep the contract provider-neutral; OpenAI and Anthropic receive the same
  logical observation content.
