# @facet/agent-tools

Provider-agnostic Facet stage tools for authors building their own LLM agent
loop.

Role: **Agents**.

This package owns the reusable mechanism layer: canonical tool definitions,
shared call/result types, strict execution against a local stage shadow,
buffering helpers, structured observations, and Facet prompt guidance. It does
not select a provider, make model requests, read environment variables, or own
application business logic.

Use `@facet/reference-agent` when you want Facet's complete reference loop. Use
this package when you only need the safe Facet authoring surface.

## Public surface

```ts
import {
  FACET_STAGE_TOOL_SPECS,
  buildFacetAgentSystemPrompt,
  createStageToolAssetSnapshot,
  createStageToolBuffer,
  executeStageTool,
  parseAgentToolObservation,
  selectPatternReference,
} from "@facet/agent-tools";
import type {
  GetBrickSpecToolInput,
  GetPatternToolInput,
  GetPresetToolInput,
  GetStyleChoicesToolInput,
  StageToolResult,
  ToolCall,
} from "@facet/agent-tools";
```

The package depends only on `@facet/core`.

## Asset snapshot and prompt

Create one exact immutable snapshot from the effective Theme and Pattern list:

```ts
const assets = createStageToolAssetSnapshot({ theme, patterns });

const system = buildFacetAgentSystemPrompt({
  pageBrief: "# Pricing concierge\n\nHelp each visitor compare plans.",
  assets,
});
```

`createStageToolAssetSnapshot` revalidates, detaches, deduplicates, indexes, and
deep-freezes the input. The resulting `StageToolAssets` contains:

- the complete `theme` for strict authoring and exact Preset reads;
- exact compatible `patterns` for Pattern reads;
- a Brick index with `type`, `description`, and `useWhen`;
- a same-Brick Preset index with `brick`, `name`, `description`, and `useWhen`;
  and
- a Pattern index with `name`, `description`, and `useWhen`.

The prompt receives only the three bounded indexes. Concrete Theme values,
full Pattern trees, provider keys, visitor ids, and unknown asset fields remain
private. Exact data is returned only when the model calls the matching read
tool.

The prompt teaches Pattern and Preset discovery before direct styling. For an
unfamiliar Brick, the model reads its fields and local style paths with
`get_brick_spec`, then calls `get_style_choices` only when it must choose an
unfamiliar value for one exact Brick/target/property path.

## Canonical tools

`FACET_STAGE_TOOL_SPECS` contains eleven tools:

| Tool | Purpose |
| --- | --- |
| `render_page` | Strictly replace the complete Facet Document. |
| `append_node` | Add one new Brick and attach it to an existing box. |
| `set_node` | Insert or replace one Brick by id. |
| `remove_node` | Remove one node and clean references. |
| `say` | Send one short chat message. |
| `get_pattern` | Read one exact indexed Pattern. |
| `get_preset` | Read one exact same-Brick Preset. |
| `get_brick_spec` | Read one compact Core Brick specification. |
| `get_style_choices` | Read allowed values and meanings for one local style property. |
| `inspect_stage` | Read a bounded stage summary. |
| `inspect_node` | Read one bounded node subtree. |

Read inputs are exact:

```ts
const patternInput = { name: "hero" } satisfies GetPatternToolInput;
const presetInput = { brick: "box", name: "panel" } satisfies GetPresetToolInput;
const brickInput = { type: "progress" } satisfies GetBrickSpecToolInput;
const choicesInput = {
  brick: "progress",
  target: "track",
  property: "height",
} satisfies GetStyleChoicesToolInput;
```

All four exact reads return `outcome: "no_stage_change"` with no messages,
patches, changed ids, or shadow mutation. `get_pattern` returns an exact
compatible reference tree; `get_preset` returns its unresolved metadata/style
bundle; `get_brick_spec` projects Core's fields and local style paths; and
`get_style_choices` returns property-local names with their meaning and usage
guidance. Unknown names or paths fail closed with `not_available`.

These exact read payloads are the narrow exception to the generic observation
data cap. A provider loop must preserve the complete selected result for its
first next-model delivery and stop at its total context limit rather than send
partial asset data.

## Strict execution

Pass the same snapshot used by the prompt to every execution:

```ts
const result = executeStageTool(call, { shadow, assets });
```

`render_page`, `append_node`, and `set_node` validate against the effective
Theme. An unknown field, Brick-owned style target/property, Preset, token name,
or fixed choice rejects the complete call with structured repair errors and no
patch. The renderer's later fail-safe behavior is not used to excuse invalid
agent authoring.

The model may use four style forms on a Brick: omit style, Preset only, direct
style only, or Preset plus deliberate direct overrides. Resolution is Theme
default, then same-Brick Preset, then direct style.

When adding a hierarchy below an existing parent, define unattached leaves with
`set_node`, define inner boxes bottom-up with `set_node`, and call
`append_node` only once for the completed top node. Attaching a descendant to
the destination and also naming it inside the new box creates two parents and
is invalid authoring practice.

## Structured observations

Tool observations are JSON strings with machine-readable fields including
`outcome`, `applied`, `visible_to_visitor`, `warnings`, `errors`, and
`next_action`.

| Outcome | Meaning |
| --- | --- |
| `applied_visible` | The requested stage change is visible. |
| `applied_not_visible` | The stage changed, but the relevant Brick is unattached or otherwise not visible. |
| `applied_with_warnings` | A non-authoring fold diagnostic occurred after a change. |
| `pending` | A buffered edit still needs dependencies; no patch was emitted. |
| `rejected` | The call was invalid or unsafe; no patch was emitted. |
| `no_stage_change` | A read, inspect, or chat call intentionally did not mutate the stage. |

For a request to build or change the page, reads and inspections are preparation
only. The loop must continue through a mutation tool and receive
`applied_visible` before claiming completion. Factual requests that require no
page change do not need a mutation.

See
[`docs/AGENT-TOOL-RESULT-CONTRACT.md`](../../../docs/AGENT-TOOL-RESULT-CONTRACT.md)
for the full result policy.
