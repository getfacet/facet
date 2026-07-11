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
executor, catalog-aware enforcement, stage-shadow folding/summaries, a buffered
helper for streamed tool batches, and reusable LLM-facing Facet authoring
guidance.

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
Primitive Brick -> Component -> Catalog model, the tool playbook, the structured
tool-result contract, and optional theme, catalog, and composition metadata.

The prompt kit is not a complete agent. Your loop still owns the page brief,
business logic, domain tools, provider messages, history, current event,
current stage context, budgets, retries, and stop policy.

```ts
const system = buildFacetAgentSystemPrompt({
  pageBrief: "# Pricing concierge\n\nHelp each visitor compare plans.",
  assets: {
    themes,
    catalog,
    compositions,
  },
});
```

Asset sections expose only prompt-safe metadata: theme names/descriptions,
catalog policy, composition names/descriptions, slot names, and whitelisted
composition metadata such as category, use/avoid guidance, tags, variants,
repeatability, preferred parent, composition, data requirements, and follow-up
edit hints. They never expose theme CSS values, composition node JSON, slot
default values, provider keys, visitor ids, secrets, or unknown asset fields.
The advertised compositions are expanded server-side when the model calls the
`use_composition` tool; their node JSON never enters the prompt.

The component-model guidance tells agents to try advertised compositions first,
then intrinsic components and catalog-advertised variants, before falling back to
primitive bricks. It names product-quality defaults such as sections, cards,
fields, buttons, tabs, nav, tables, charts, metrics, key-value rows, badges,
progress, alerts, lists, dividers, forms, search, filters, empty states, and
loading states without exposing renderer recipe parts, theme token values, or
composition node JSON as stage syntax.

The catalog prompt section is active UI authoring policy. It tells the model the
active theme, whether theme switching is a locked theme or explicitly allowed,
which components and variants are allowed, whether all compositions or only named
compositions may be used, whether primitive fallback is allowed, and the preferred
order: `composition -> component -> primitive`.

Catalog policy is deliberately narrower than hosted platform policy. It guides
and gates the UI the model may author; it does not define tenant isolation,
authentication, billing, usage metering, rate limits, spend caps, or operational
admin policy.

## Catalog-Aware Enforcement

Pass the same catalog into `executeStageTool` through `StageToolAssets`:

```ts
const result = executeStageTool(call, {
  shadow,
  assets: { themes, catalog, compositions },
});
```

`StageToolAssets.compositions` is the executor's composition library: the
`use_composition` tool (input type `UseCompositionToolInput` — a composition
`name`, string slot `params`, and `at.parent`) expands one of those documents
server-side into ordinary validated patches with fresh ids. An unknown name, a
name outside the catalog allow-list, or a failed expansion is a structured
rejection (`invalid_composition`) with zero patches; a missing or non-container
`at.parent` is `invalid_parent`.

The executor enforces catalog policy before it emits patches:

- `render_page`, `append_node`, and `set_node` reject disallowed node types and
  disallowed variants. For tone-capable components, a `tone` used without
  an allowed `variant` is treated as a recipe selector and is rejected unless
  the catalog advertises that name.
- `use_composition` rejects composition names outside an allow-list catalog
  before expansion.
- `set_theme` rejects locked theme changes and names outside an allowed theme
  list.

These are catalog_policy rejections: the structured observation has
`outcome: "rejected"`, `applied: false`, `patch_count: 0`, a catalog-policy
message, and a `next_action` telling the model to use an allowed composition,
component, primitive, variant, or theme. Treat them as repair instructions, not
as visible success.

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
