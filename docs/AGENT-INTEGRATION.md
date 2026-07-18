# Agent Integration

Use this guide when an application wants its own LLM/provider loop to author a
Facet page. Facet supplies the closed tool schemas, prompt guidance, validation,
local stage shadow, structured observations, and RFC 6902 patch messages. The
host still owns the model call and the product policy around it.

For the shortest runnable path, start with the
[Getting Started guide](GETTING-STARTED.md). For exact result fields and outcome
semantics, use the [Agent Tool Result Contract](AGENT-TOOL-RESULT-CONTRACT.md).
For Theme, Preset, Pattern, and style concepts, use the
[Design System guide](DESIGN-SYSTEM.md). The [Architecture](ARCHITECTURE.md)
remains the authority for Facet's invariants. Return to the
[Facet overview](../README.md) to choose a different adoption path.

## Choose the agent package by job

The similarly named packages do different jobs:

| Need | Package | What it provides | What it does not provide |
| --- | --- | --- | --- |
| Give an LLM safe Facet tools inside your own provider loop | `@facet/agent-tools` | Tool specs, prompt kit, validated asset snapshot, executor, buffer, observations | Provider client, model requests, history, transport, business policy |
| Author a stage from TypeScript code, tests, or rules | `@facet/agent` | In-process `Stage` methods and `defineAgent` | LLM tool schemas or a provider loop |
| Study or run Facet's reference LLM brain | `@facet/reference-agent` | OpenAI/Anthropic adapters, bounded tool loop, budgets, compaction, tracing, fixture | A production product-policy boundary |
| Dial an external `FacetAgent` into the reference server | `@facet/agent-client` | SSE connection, heartbeat, reconnect, event routing | LLM tools, prompt construction, or model calls |

Choose `@facet/agent-tools` for a custom LLM loop. `@facet/agent-client` may
transport a completed external `FacetAgent`, but it does not replace
`@facet/agent-tools` inside that agent.

## What Facet owns and what the host owns

Facet owns the mechanism between a model tool call and a safe stage message:

```text
Facet-owned mechanism
  closed tool specs + Facet prompt
  validated Theme/Pattern snapshot
  strict tool execution + local shadow
  structured observation + patch/say messages
```

The application host owns everything around that mechanism:

```text
Host-owned policy
  provider and model selection
  credentials and provider requests
  conversation-history retention and compaction policy
  network/provider retry, timeout, spend, and token budgets
  external domain tools and business rules
  identity, authorization, audit, and abuse controls
```

Facet reports enough information for the host and model to make those
decisions; it does not choose them. In particular, a rejected authoring call may
need a **model repair and retry**, while a failed provider request may need a
**host network retry**. These are separate policies.

## Install and use public entrypoints

Install the tool mechanism and one source of Theme/Pattern data. This example
uses Facet's bundled defaults:

```bash
npm install @facet/agent-tools @facet/assets @facet/core
```

Import only published package roots. Do not import package `src/*` paths or
copy internals from the reference agent.

The following concrete setup is checked against the current public exports:

```ts check-docs
import {
  FACET_STAGE_TOOL_SPECS,
  buildFacetAgentSystemPrompt,
  createStageToolAssetSnapshot,
  createStageToolBuffer,
  executeStageTool,
  parseAgentToolObservation,
  type ToolCall,
} from "@facet/agent-tools";
import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { EMPTY_TREE } from "@facet/core";

const assets = createStageToolAssetSnapshot({
  theme: DEFAULT_THEME,
  patterns: DEFAULT_PATTERNS,
});
const system = buildFacetAgentSystemPrompt({
  pageBrief: "Help the visitor compare plans.",
  assets,
});
const buffer = createStageToolBuffer(EMPTY_TREE, assets);
const call = {
  id: "tool-1",
  name: "inspect_stage",
  input: { maxNodes: 20 },
} satisfies ToolCall;

const buffered = buffer.run(call);
const observation = parseAgentToolObservation(buffered.observation);
const direct = executeStageTool(call, { shadow: EMPTY_TREE, assets });

void FACET_STAGE_TOOL_SPECS;
void system;
void observation;
void direct;
```

Use the buffer for a normal multi-call provider turn. Use `executeStageTool`
when the host deliberately manages each call's shadow and batching itself.

## Build one immutable turn snapshot

At the start of a provider turn, acquire the effective Theme and exact Pattern
list, then call `createStageToolAssetSnapshot`. Pass that same snapshot to the
system prompt and every tool execution in the turn.

The snapshot has two roles:

- it gives strict author validation one stable Theme and Pattern view;
- it gives the model small indexes for progressive discovery.

The prompt sees Brick, Preset, and Pattern names plus bounded discovery
metadata. It does not see concrete Theme CSS values or complete Pattern trees.
An exact read returns one selected unresolved asset to the provider transcript;
that payload never becomes a browser message or stage field by itself.

If assets may change between turns, take a new snapshot at the next turn
boundary. Do not change snapshots halfway through one model/tool exchange.

## Give the model the prompt and tool specs

Pass the string from `buildFacetAgentSystemPrompt` as the Facet portion of the
system prompt. Give the provider the public `FACET_STAGE_TOOL_SPECS` collection
as callable tools. Translate only the provider's envelope into a provider-neutral
`ToolCall` with `id`, `name`, and `input`; do not rewrite the Facet parameters.

The Facet prompt teaches this discovery order:

1. Consider Pattern metadata. Call `get_pattern` when a worked structure fits.
2. Consider a same-Brick Preset. Call `get_preset` when its visual role fits.
3. Call `get_brick_spec` before using an unfamiliar Brick.
4. Call `get_style_choices` only for one unfamiliar Brick/target/property value.
5. Author ordinary native Bricks with a mutation tool.

The style-choice result is already filtered through the exact property's Core
allow-list. It does not expose broader token or fixed-domain members that the
subsequent strict mutation would reject at that path.

Pattern and Preset reads are guidance, not stage writes. A Pattern is not a
component reference or insertion command. The model adapts it and re-authors
native Bricks. A Preset is a same-Brick style name, not a new Brick kind.

## Run the provider-neutral handoff

Place the loop behind Core's public `FacetAgent` contract: it receives one
visitor event and current session, then returns a message array, a promise of a
message array, or an async iterable of message batches. Seed the tool buffer
from `session.stage`; return or yield the buffer's `messages`. The Facet runtime
then validates the agent-message subset, persists the resulting stage, and
delivers the batch through the selected transport.

The provider invocation is intentionally not a Facet API. The following is
**pseudocode**; adapt it to the provider and history model owned by your host:

```text
assets = snapshot effective Theme and Patterns for this turn
system = build the Facet system prompt from page brief + assets
buffer = create a stage-tool buffer from current session stage + assets

repeat within host-owned limits:
  step = host calls its provider with system, transcript, and Facet tool specs

  if step contains tool calls:
    for each provider call in order:
      call = translate provider envelope to { id, name, input }
      outcome = buffer.run(call)
      append outcome.observation as that call's tool_result
      forward outcome.messages to the Facet runtime batch
      keep buffer.shadow as the next call's current stage

    emit/coalesce the runtime batch
    buffer.resetEmittedPatchOps()
    continue with the provider's next step

  if step contains final prose:
    apply host completion policy
    stop

unresolved = buffer.drainUnresolved()
if unresolved is not empty:
  report/repair the unfinished hierarchy; do not claim page completion
```

One `buffer.run(call)` outcome contains the complete handoff:

| Field | Recipient | Purpose |
| --- | --- | --- |
| `observation` | Provider transcript as the matching tool result | Machine-readable status, outcome, repair guidance, and optional exact-read data |
| `messages` | Facet runtime/output batch | Validated `patch` and `say` messages only |
| `shadow` | Next local execution | The stage after accepted patches have been folded |
| `mutated` / `said` | Host loop control and telemetry | Whether that buffered outcome changed the stage or emitted chat |

When using `executeStageTool` directly, the result also exposes `patches`,
`patchCount`, `changedNodeIds`, `issues`, and the next `shadow`. Do not recompute
patches from prose, and do not advance your shadow after a rejection.

## Complete tool input is not the wire format

`render_page` accepts a complete `FacetTree` in its **tool input** because the
model needs a simple way to describe a whole desired page. `append_node` and
`set_node` similarly accept complete native Brick objects.

The executor validates those values and produces Facet `ServerMessage` output.
After the initial stage snapshot, the runtime wire carries **patches only** for
document changes: RFC 6902 operations inside `patch` messages. The browser and
server fold them with the same `applyPatch` implementation.

Therefore:

- do not forward the raw `render_page` tool argument to the browser;
- do not invent a second full-document message protocol;
- forward the executor/buffer's validated messages;
- keep provider observations on the agent side.

A root-replacement RFC 6902 operation may contain a complete tree as its patch
value. It is still a validated patch message, not a separate document-writing
channel.

## Treat observations as control flow

Parse each observation and branch on `outcome`. For a visitor request that
requires a page edit, only `applied_visible` is evidence that the requested
stage change reached a visible part of the server-side shadow.

| Outcome | Required loop behavior |
| --- | --- |
| `applied_visible` | Continue if more work remains; otherwise the page change may be complete. |
| `applied_not_visible` | Attach the Brick to a visible container or inspect the stage. |
| `applied_with_warnings` | Inspect and repair when the warning affects the request. |
| `pending` | Define missing children or replace the pending container. |
| `rejected` | Read `code`, `errors`, and `next_action`; repair the complete call and retry. |
| `no_stage_change` | Continue to a mutation when the visitor asked for a page change. |

Never translate `status: "error"` into a generic successful provider result.
For `invalid_authoring`, preserve the bounded error paths and allowed choices in
the next model handoff. The rejected call emits zero patches and leaves the
shadow unchanged, so retry from that same shadow.

Reads and inspection may legitimately return `no_stage_change`. Chat-only
`say` also does not prove that a requested page edit happened. The exact result
schema, visibility definition, bounds, and recovery rules live in the
[Agent Tool Result Contract](AGENT-TOOL-RESULT-CONTRACT.md).

## Keep the three failure boundaries separate

Facet uses three different safety policies. They are not interchangeable:

1. **Strict author rejection.** At the agent mutation boundary, any invalid
   authored field, target, style property, Preset, token, fixed choice, or tree
   reference rejects the complete call atomically. The result is `rejected`,
   with zero patches and an unchanged shadow. The model repairs and retries.
2. **Fail-soft stale rendering.** If stale, persisted, partially patched, or
   bypassed data reaches tree validation or the renderer, invalid fragments are
   pruned or skipped so valid Bricks and siblings can remain visible. This is a
   last defense, not successful agent authoring.
3. **Whole-Theme fallback.** If host/operator Theme data is invalid, asset
   loading and rendering use the complete bundled default Theme. Facet does not
   partially merge the invalid custom Theme. This host-level Theme fallback is
   not a successful model mutation either.

Code handling a `rejected` observation must not wait for fail-soft rendering or
Theme fallback to rescue the call.

## Production checklist

- Build the prompt and executor from the same immutable asset snapshot.
- Offer only `FACET_STAGE_TOOL_SPECS`; never add raw HTML, JavaScript, or CSS
  escape tools as Facet authoring equivalents.
- Keep exact Pattern/Preset/Brick/style-choice payloads agent-side and preserve
  them whole through their first provider handoff.
- Keep tool-result observations paired with the provider call id.
- Forward only executor/buffer messages to the Facet runtime.
- Require `applied_visible` before claiming a requested page change is done.
- Bound steps, calls, context, observations, provider retries, and time in host
  policy.
- Keep provider keys, identity, authorization, external tools, and business
  data outside the Facet Document.
- Use public package roots only.

For a maintained example of these decisions, read the public API of
`@facet/reference-agent`. Treat it as a reference implementation, not as a
source of private imports or mandatory product policy.
