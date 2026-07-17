# Agent Tool Result Contract

Facet stage tools are consumed by LLMs, so their results must be machine-readable
and hard to misinterpret. A tool result is not just a log line. It is the model's
only feedback loop for deciding whether to continue editing the stage, inspect
the current state, or tell the visitor that the work is done.

This contract applies to LLM-facing Facet stage tool observations emitted by
`@facet/agent-tools` and consumed by `@facet/reference-agent`.

## Required Shape

Every LLM-facing observation is a JSON string with these fields. Generic
observations are bounded; the four exact design-asset reads described below are
deliberate provider-context exceptions:

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
payload that would be lossy to squeeze into the prose `message`.

For the public generic formatter, `data` is:

- optional — present only when a tool has structured metadata to hand back;
- bounded — capped like every other field (≤ 2048 chars);
- always valid JSON — a consumer can `JSON.parse` it directly.

If a generic `data` value exceeds that bound, it is replaced wholesale with
`{ "truncated": true }` rather than sliced into invalid JSON. Consumers should
parse generic `data` inside a `try`/`catch`, ignore parse errors, and treat that
marker as unavailable detail.

#### Exact design-asset read exceptions

Four read-only tools return unresolved design-system data without changing the
stage:

| Tool | Exact input | Exact `data` payload |
| --- | --- | --- |
| `get_pattern` | `{ "name": "<Pattern index name>" }` | One complete validated Pattern: bounded discovery metadata plus its concrete native-Brick tree. |
| `get_preset` | `{ "brick": "<Brick type>", "name": "<Preset index name>" }` | One same-Brick Preset with metadata and unresolved style names. |
| `get_brick_spec` | `{ "type": "<one exact Brick type>" }` | One compact Core projection: fields, root/owned style paths, value source, states, and applicability. It never accepts a batch. |
| `get_style_choices` | `{ "brick": "<Brick type>", "target": "<root or owned target>", "property": "<owned property>" }` | The allowed names and metadata for that one exact local property. It is never a global token lookup. |

A successful read uses the standard observation envelope. For example:

```json
{
  "version": 1,
  "tool": "get_pattern",
  "status": "ok",
  "outcome": "no_stage_change",
  "applied": false,
  "stage_changed": false,
  "visible_to_visitor": false,
  "patch_count": 0,
  "changed_node_ids": [],
  "omitted_changed_node_count": 0,
  "warnings": [],
  "omitted_warning_count": 0,
  "message": "Read one exact unresolved Pattern.",
  "next_action": "Adapt the reference and author ordinary native Bricks separately; do not insert it blindly.",
  "summary": "no stage changes",
  "data": "{\"name\":\"hero\",\"description\":\"A hero reference.\",\"useWhen\":\"Use for a focused landing introduction.\",\"root\":\"hero.root\",\"nodes\":{\"hero.root\":{\"id\":\"hero.root\",\"type\":\"box\",\"children\":[\"hero.title\"]},\"hero.title\":{\"id\":\"hero.title\",\"type\":\"text\",\"value\":\"Hello\"}}}"
}
```

For `get_pattern` and `get_preset`, `JSON.parse(data)` is deep-equal to the
selected validated object: no fields are dropped, no ids are minted, concrete
Theme values are not resolved, and no truncation marker is substituted.
`get_brick_spec` and `get_style_choices` similarly preserve their exact compact
Core-derived projections. A package-private asset formatter owns these
exceptions; the public generic formatter keeps its normal cap and exposes no
bypass.

One detached, deeply frozen turn snapshot supplies the Theme, Pattern list, and
the bounded Pattern/Preset/Brick indexes. The prompt exposes index metadata only;
exact details appear after an explicit successful read. A missing indexed name
or unavailable Brick-owned path returns `not_available`. Missing, malformed, or
extra input fields return `invalid_input`. Every rejection leaves the stage
shadow and buffered edits unchanged.

The reference transcript preserves every complete successful asset read past
the generic observation cap. Its newest tool group is pinned verbatim through
the next provider handoff even when recent-step retention is zero. If the whole
request still exceeds the context budget, the loop sends neither a partial
value nor a summary; it stops with `context_limit` before that provider call.
After one complete handoff, normal later step-group compaction may resume.

All four payloads are agent/provider-side only. They do not enter a stage
message, patch, browser global, HTML shell, SSE frame, reconnect snapshot, or
client protocol. A Pattern is guidance, not insertion syntax: the model must
adapt it and author the desired UI with ordinary native stage tools.

## Outcomes

| Outcome | Meaning | May the model claim the page is done? |
| --- | --- | --- |
| `applied_visible` | The stage changed and the changed stage is reachable from the server-side render root, or a visible stage metadata field changed. | Yes, if the requested work is complete. |
| `applied_not_visible` | A patch was applied, but the changed node is not reachable from the current server-side render root. | No. Attach the node to a visible parent or inspect first. |
| `applied_with_warnings` | A patch was applied, but validation/folding dropped or sanitized something. | Usually no. Inspect or repair when the warning affects the requested work. |
| `pending` | The edit is buffered, usually because a container references child ids that do not exist yet. No patch was emitted. | No. Define the missing children or change the edit. |
| `rejected` | The tool call was invalid or unsafe. No patch was emitted. | No. Follow `next_action`. |
| `no_stage_change` | The tool intentionally did not mutate the stage, for example an asset read, `inspect_stage`, `inspect_node`, or `say`. | Only if no page change was required. A design-asset read is not page completion. |

## False-Success Rule

A tool result must never report plain success when the visible stage did not
reflect the requested page change.

In particular:

- `set_node` can create or replace a node without attaching it to a visible
  parent. That is `applied_not_visible`, not visible success.
- `render_page`, `append_node`, and `set_node` run strict author validation.
  Unknown Brick fields, unavailable style paths, invalid Preset names, or values
  outside the local closed choices reject the complete authoring call with
  `code: "invalid_authoring"`, bounded `errors`, and no patch.
- Buffered edits are `pending`, not success.
- Rejected edits emit no patch and must include a concrete `next_action`.
- Fail-soft sanitation is a separate renderer/fold defense for stale or bypassed
  data. It may drop only invalid style fragments while keeping valid Bricks and
  siblings; it is not the normal LLM authoring acceptance path.

## Visibility Definition

`visible_to_visitor` is computed from the server-side stage shadow:

- A node is visible when it is reachable from the active render root and no
  hidden box on that path suppresses it.
- `root`, `screens`, or `entry` metadata changes count as visible stage changes
  because they affect what the renderer can show.
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
- `rejected` with `invalid_authoring`: use the bounded `errors` entries. Each
  entry names an exact document path and may include `allowed` choices; repair
  the complete call and retry.
- `rejected` with `invalid_input`, `invalid_parent`, `invalid_tree`, or
  `patch_limit`: follow `next_action` and retry with the corrected shape or a
  smaller change.
- `rejected` with `not_available`: choose an exact name from the active index,
  or an exact Brick/target/property path returned by `get_brick_spec`.

## Bounds And Privacy

Observations must remain safe to place in a provider transcript. Generic
observations remain bounded; exact design-asset reads follow the dedicated
whole-value/context-stop rule above.

- Do not include full stage JSON by default.
- Bound tool names, changed node id lists, warnings, messages, next actions, and
  summaries.
- Normalize non-finite, missing, or negative counts to safe non-negative
  integers before JSON serialization. A count must never become JSON `null`.
- If a changed node id is too long for the observation contract, omit it and
  increment `omitted_changed_node_count`.
- Do not include provider keys, visitor ids, collected secrets, raw CSS values,
  resolved Theme values, or unbounded user input. Complete Pattern and Preset
  data is allowed only through the validated exact-read path; Core-derived Brick
  and local-choice projections contain closed names and guidance, never concrete
  CSS. None of these payloads is forwarded to the browser or trace callbacks.
- Keep the contract provider-neutral; OpenAI and Anthropic receive the same
  logical observation content.
