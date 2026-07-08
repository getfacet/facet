# @facet/agent-tools

Provider-agnostic Facet stage tools for people building their own external
agents.

Tier: **Agent Authoring**.

This package is the reusable mechanism layer: shared tool-call contracts,
result shapes, stage-tool helpers, and provider-neutral Facet prompt guidance
that can sit inside any LLM/tool loop. It does not choose a model, make provider
requests, read environment variables, or own a reference policy.

`@facet/reference-agent` is separate on purpose. It is Facet's runnable reference
brain with provider adapters, prompt policy, a tool loop, and the deterministic
stub used by quickstart. Use `@facet/reference-agent` when you want that complete
agent. Use `@facet/agent-tools` when you are writing your own agent and only need
the safe Facet stage tool surface.

## Current surface

This package ships the reusable stage-tool surface used by the reference agent:
canonical tool specs, shared tool-call/result types, a provider-agnostic
executor, stage-shadow folding/summaries, a buffered helper for streamed tool
batches, and reusable LLM-facing Facet authoring guidance.

```ts
import {
  FACET_STAGE_TOOL_SPECS,
  buildFacetAgentSystemPrompt,
  createStageToolBuffer,
  executeStageTool,
  parseAgentToolObservation,
} from "@facet/agent-tools";
import type { StageToolResult, ToolCall, ToolSpec } from "@facet/agent-tools";
```

The package depends only on `@facet/core`, so it can be reused by external agent
authors without pulling in the reference agent or a Node-only provider stack.

## Prompt kit

`buildFacetAgentSystemPrompt` assembles the Facet-specific system guidance that
most LLM agents need before they call the stage tools. It includes `STAGE_SPEC`
from `@facet/core`, compact page UX guidance, edit-before-append rules, the
tool playbook, the structured tool-result contract, and optional theme/stamp
metadata.

The prompt kit is not a complete agent. Your loop still owns the page brief,
business logic, domain tools, provider messages, history, current event,
current stage context, budgets, retries, and stop policy.

```ts
const system = buildFacetAgentSystemPrompt({
  pageBrief: "# Pricing concierge\n\nHelp each visitor compare plans.",
  assets: {
    themes,
    stamps,
  },
});
```

Asset sections expose only theme/stamp names, descriptions, and stamp slot names
so the model can choose `set_theme` or `use_stamp` without seeing CSS values or
stamp node JSON.

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
