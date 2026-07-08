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
} from "@facet/agent-tools";
import type { StageToolResult, ToolCall, ToolSpec } from "@facet/agent-tools";
```

The package depends only on `@facet/core`, so it can be reused by external agent
authors without pulling in the reference agent or a Node-only provider stack.
