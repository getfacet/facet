# @facet/agent-tools

Provider-neutral Facet stage tools for a host building its own LLM agent loop.

Role: **Agents**.

Use this package when the host already owns provider requests and product
policy but needs Facet's safe authoring mechanism. It provides the canonical
tool specs, prompt kit, immutable design-asset snapshot, strict executor, local
stage buffer, and structured observations. It does not select a provider, make
model requests, retain conversation history, connect to a Facet server, or own
business logic.

Use `@facet/reference-agent` for Facet's complete reference loop. Use
`@facet/agent` for code-authored in-process stage changes. Use
`@facet/agent-client` only to transport a completed external `FacetAgent`; it is
not an LLM tool package.

```bash
npm install @facet/agent-tools
```

## Main workflow

1. Call `createStageToolAssetSnapshot` once for the provider turn.
2. Build the Facet system prompt with `buildFacetAgentSystemPrompt`.
3. Offer `FACET_STAGE_TOOL_SPECS` to the provider.
4. Run provider calls through `createStageToolBuffer`, or deliberately manage
   each shadow with `executeStageTool`.
5. Return `observation` to the provider, forward validated `messages` to the
   Facet runtime, and retain the returned `shadow` for the next call.
6. Repair and retry `rejected` calls. Require `applied_visible` before claiming
   a requested page change is complete.

```ts check-docs
import {
  FACET_STAGE_TOOL_SPECS,
  buildFacetAgentSystemPrompt,
  createStageToolAssetSnapshot,
  createStageToolBuffer,
  executeStageTool,
  parseAgentToolObservation,
} from "@facet/agent-tools";
import type { StageToolResult, ToolCall } from "@facet/agent-tools";
```

All imports come from the published package root. The package depends only on
`@facet/core`.

## Discovery and execution

The prompt exposes bounded Brick, same-Brick Preset, and Pattern indexes. Exact
details are progressive reads:

- `get_pattern` reads one validated reference tree;
- `get_preset` reads one unresolved same-Brick style bundle;
- `get_brick_spec` reads one Brick's fields and owned style paths; and
- `get_style_choices` reads allowed names for one exact local style property.

Style-choice discovery uses the same property-specific Core decision as strict
author and Theme validation. A broader domain member that the exact property
does not allow is never returned as an available choice.

These reads return `no_stage_change`; the model must adapt the guidance and
author ordinary native Bricks with `render_page`, `append_node`, or `set_node`.
The complete Theme remains in the snapshot for strict validation, while its
concrete CSS values stay out of the model prompt.

Strict authoring is atomic. An unknown field, target, property, Preset, token,
fixed choice, or invalid tree reference returns `rejected`, emits zero patches,
and leaves the local shadow unchanged. Renderer fail-soft behavior is a later
defense for stale or bypassed data, not acceptance of an invalid model call.

`render_page` accepts a complete tree as tool input, but the validated runtime
output is an RFC 6902 `patch` message. After initial state, only patches travel
for document changes.

## Read next

- [Custom agent integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md)
  — the complete snapshot, prompt, buffer/executor, provider handoff, and host
  boundaries.
- [Agent tool result contract](https://github.com/getfacet/facet/blob/main/docs/AGENT-TOOL-RESULT-CONTRACT.md)
  — exact observation fields, outcomes, visibility, bounds, and recovery.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
  — Facet's stage and safety invariants.
