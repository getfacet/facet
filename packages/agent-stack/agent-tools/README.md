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
  selectCompositionReferences,
} from "@facet/agent-tools";
import type {
  GetCompositionToolInput,
  StageToolResult,
  ToolCall,
  ToolSpec,
} from "@facet/agent-tools";
```

The package depends only on `@facet/core`, so it can be reused by external agent
authors without pulling in the reference agent or a Node-only provider stack.

## Prompt kit

`buildFacetAgentSystemPrompt` assembles the Facet-specific system guidance that
most LLM agents need before they call the stage tools. It includes `STAGE_SPEC`
from `@facet/core`, compact page UX guidance, edit-before-append rules, the
closed native-brick model, the tool playbook, the structured
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

Asset sections expose only prompt-safe indexes: theme names/descriptions,
catalog policy, and each exposed composition's name plus
`metadata.description`. Theme CSS values, composition node JSON, other
composition metadata, provider keys, visitor ids, secrets, and unknown asset
fields do not enter the system prompt.

The guidance teaches exactly eleven authorable bricks: `box`, `text`, `media`,
`input`, `richtext`, `table`, `chart`, `list`, `keyValue`, `progress`, and
`loading`. Actions, navigation, grouped inputs, label/value summaries, fixed
filters, sections, cards, and empty states are authored from those bricks.
Optional composition references show concrete examples: skip the read for a
simple UI; for a complex UI, inspect one and then author native nodes separately.
Renderer recipe parts, theme token values, and composition node JSON never
become stage syntax.

The catalog prompt section is active UI authoring policy. It tells the model the
active theme, whether theme switching is a locked theme or explicitly allowed,
which bricks and variants are allowed, and whether all compositions or only
named compositions may be exposed as references. Composition policy controls
reference exposure, not a stage authoring layer.

Catalog policy is deliberately narrower than hosted platform policy. It guides
and gates the UI the model may author; it does not define tenant isolation,
authentication, billing, usage metering, rate limits, spend caps, or operational
admin policy.

## Composition reference reads

`selectCompositionReferences(compositions, catalog?)` is the shared pure
boundary used by both prompt indexing and lookup. It validates untrusted
documents in input order, keeps the first valid occurrence of each name, applies
the catalog's composition exposure policy, detaches caller-owned objects, and
returns a newly allocated deeply frozen array. To keep the name/description
index inside the smallest reference-agent context profile, exposure stops
deterministically after 128 selected references; prompt indexing and lookup
therefore see the same bounded set. Omitting the catalog exposes every valid
reference within that cap; supplying a malformed catalog fails closed to an
empty array.

The canonical `get_composition` tool accepts exactly `{ name: string }` and
performs a read-only lookup in that selected snapshot. A successful read returns
the complete serialized validated dataset in the normal structured observation
with `outcome: "no_stage_change"`: no messages, patches, changed node ids, or
shadow mutation occur. Unknown or disallowed names reject with
`invalid_composition`; malformed or extra input fields reject with
`invalid_input`. After a successful read, the model must author the stage
separately with native stage tools.

The exact dataset is the one role-specific exception to the generic observation
data cap, so it is never replaced with a truncation marker. The surrounding
provider loop must still enforce its total-context limit before another model
call; if the complete result cannot fit, stop rather than pass a partial value.
The public `formatAgentToolObservation` API remains capped and has no bypass
option.

## Catalog-aware enforcement

Pass the same catalog into `executeStageTool` through `StageToolAssets`:

```ts
const result = executeStageTool(call, {
  shadow,
  assets: { themes, catalog, compositions },
});
```

`StageToolAssets.compositions` is an optional list of concrete native reference
datasets. Both the prompt and `get_composition` pass it through
`selectCompositionReferences`, so the offered name-description index and
readable documents follow the same validation, dedupe, and catalog exposure
policy.

The executor enforces catalog policy at both write and reference-read boundaries:

- `render_page`, `append_node`, and `set_node` reject disallowed node types and
  disallowed variants. For tone-capable bricks, a `tone` used without
  an allowed `variant` is treated as a recipe selector and is rejected unless
  the catalog advertises that name.
- `get_composition` rejects names outside the catalog exposure allow-list and
  never emits a stage effect.
- `set_theme` rejects locked theme changes and names outside an allowed theme
  list.

Catalog-policy rejections from authoring tools have `outcome: "rejected"`,
`applied: false`, `patch_count: 0`, a catalog-policy message, and a
`next_action` telling the model to use an allowed brick, variant, or theme. An
unavailable reference read instead uses the bounded
`invalid_composition` result described above. Treat every rejection as a repair
instruction, not as visible success.

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
