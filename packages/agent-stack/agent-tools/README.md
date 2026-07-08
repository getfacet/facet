# @facet/agent-tools

Provider-agnostic Facet stage tools for people building their own external
agents.

Tier: **Agent Authoring**.

This package is the reusable mechanism layer: shared tool-call contracts,
result shapes, and stage-tool helpers that can sit inside any provider loop.
It does not choose a model, make provider requests, read environment variables,
or own a reference policy.

`@facet/reference-agent` is separate on purpose. It is Facet's runnable reference
brain with provider adapters, prompt policy, a tool loop, and the deterministic
stub used by quickstart. Use `@facet/reference-agent` when you want that complete
agent. Use `@facet/agent-tools` when you are writing your own agent and only need
the safe Facet stage tool surface.

## Current surface

PR1 ships the reusable stage-tool surface used by the reference agent:
canonical tool specs, shared tool-call/result types, a provider-agnostic
executor, stage-shadow folding/summaries, and a buffered helper for streamed
tool batches.

```ts
import {
  FACET_STAGE_TOOL_SPECS,
  createStageToolBuffer,
  executeStageTool,
  parseAgentToolObservation,
} from "@facet/agent-tools";
import type { StageToolResult, ToolCall, ToolSpec } from "@facet/agent-tools";
```

The package depends only on `@facet/core`, so it can be reused by external agent
authors without pulling in the reference agent or a Node-only provider stack.

## LLM-facing observations

Tool observations are structured JSON strings, not prose-only log lines. The
model sees fields such as `outcome`, `applied`, `visible_to_visitor`,
`warnings`, and `next_action`.

Important outcomes:

| Outcome | Meaning |
| --- | --- |
| `applied_visible` | The stage changed and the relevant change is reachable from the server-side render root. |
| `applied_not_visible` | A patch applied, but the changed node is not visible yet; attach it to a visible box before claiming completion. |
| `applied_with_warnings` | The stage changed but validation/folding dropped or sanitized something. |
| `pending` | The edit is buffered, usually waiting for missing child nodes; no patch was emitted yet. |
| `rejected` | The tool call was invalid or unsafe; no patch was emitted. |
| `no_stage_change` | The tool intentionally did not mutate the stage, such as inspect or say. |

See [`docs/AGENT-TOOL-RESULT-CONTRACT.md`](../../../docs/AGENT-TOOL-RESULT-CONTRACT.md)
for the full policy. The key rule: never treat `applied_not_visible`,
`applied_with_warnings`, `pending`, or `rejected` as visible completion.
Use `parseAgentToolObservation` when your loop needs to branch on the structured
fields rather than string-matching result text.
