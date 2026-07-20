# @facet/reference-agent

Facet's reference brain: provider adapters, prompt policy, a bounded streaming
tool loop, context compaction, and a deterministic test fixture.

Role: **Agents**. This is Facet's reference agent implementation.

This package demonstrates a robust Facet agent loop. It is not the product
boundary or a ready-made production brain. Application business logic, domain
tools, identity, spend controls, and production policy belong to the host.

The reusable provider-neutral tool and prompt layer lives in
`@facet/agent-tools`. This package adds OpenAI/Anthropic adapters, event/history
context, retry and stop policy, budgets, tracing, and compaction.

Install this package when you want to run or study that complete reference
brain. For a custom provider loop, integrate `@facet/agent-tools` directly. For
a deterministic TypeScript/rules agent, use `@facet/agent`. For transport from
an external process, `@facet/agent-client` connects a completed `FacetAgent` but
does not provide LLM tools.

```bash
npm install @facet/reference-agent @facet/assets @facet/runtime
```

Consumers must import from the published `@facet/reference-agent` package root.
The internal directory names described below explain the implementation; they
are not public subpaths and must not be copied into integration imports.

```ts
import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { createReferenceAgent, resolveProvider } from "@facet/reference-agent";
import { MemorySink } from "@facet/runtime";

const provider = resolveProvider({}, process.env);
if (provider === null) throw new Error("Set OPENAI_API_KEY or ANTHROPIC_API_KEY");

const agent = createReferenceAgent({
  provider,
  sink: new MemorySink(),
  agentId: "reference",
  guide: "# My Facet page",
  assets: { theme: DEFAULT_THEME, patterns: DEFAULT_PATTERNS },
  budgetPreset: "quickstart",
  trace: (event) => console.debug("[facet-reference-agent]", event),
});
```

## Package layout

- `provider/`: provider turn/tool types and OpenAI/Anthropic adapters.
- `prompt/`: the shared Facet system prompt wrapper, event/history messages,
  and bounded current-stage summaries.
- `harness/`: context assembly, token sizing, compaction, budget normalization,
  retry/stop classification, exact tool observations, tracing, and the
  streaming loop.
- `stub.ts`: deterministic agent fixture for local tests and live-link gates.

## Theme, Presets, Patterns, and Brick discovery

`ReferenceAgentOptions.assets` is required. It accepts either static
`{ theme, patterns }` data or a function that returns that shape, synchronously
or asynchronously. The source is acquired once at the start of each provider
turn, then validated, detached, indexed, and deeply frozen by
`createStageToolAssetSnapshot`.

The complete Theme is used for strict mutation validation but its CSS values do
not enter the prompt. The prompt receives only:

- all eleven Brick names with `description` and `useWhen`;
- active same-Brick Preset names with `description` and `useWhen`; and
- active Pattern names with `description` and `useWhen`.

The model normally considers a Pattern first, then a matching Preset, and then
direct Brick style when a deliberate adjustment is needed. It can call:

- `get_pattern({ name })` for one exact reference tree;
- `get_preset({ brick, name })` for one exact unresolved Preset;
- `get_brick_spec({ type })` for one compact Core Brick field/style contract;
  and
- `get_style_choices({ brick, target, property })` for the allowed names and
  meanings at one exact local style property.

Those four calls are exact asset reads with `outcome: "no_stage_change"`. They
never emit runtime messages or patches and never change the stage shadow or
pending buffer. The model must follow them with ordinary stage mutation tools
when the visitor requested a visible page change.

The singular Theme is host/operator input. It is not selected or mutated by the
model. The browser receives that Theme separately from the stage; Patterns stay
inside the agent/provider loop.

## Tool loop

The reference agent uses the canonical `FACET_STAGE_TOOL_SPECS` from
`@facet/agent-tools`:

- mutations: `render_page`, `append_node`, `set_node`, `remove_node`;
- exact discovery: `get_pattern`, `get_preset`, `get_brick_spec`,
  `get_style_choices`;
- inspection: `inspect_stage`, `inspect_node`; and
- chat: `say`.

Every result is structured. The loop reads `outcome`,
`visible_to_visitor`, `warnings`, `errors`, and `next_action`. `pending`,
`rejected`, `applied_with_warnings`, `applied_not_visible`, and
`no_stage_change` are not visible completion for a requested page edit. The
agent must continue until a mutation returns `applied_visible`, unless the
request was factual and required no stage change.

Exact asset payloads bypass the generic observation-data cap only inside the
reference harness. The newest exact read is retained whole for its first next
provider delivery. In-turn compaction and transcript folding use the same
four-name exact-read policy. If the complete step cannot fit the provider's
declared context window, the loop stops with `context_limit` rather than send a
partial or summarized asset.

Pattern JSON is provider-side only. It is not written into the HTML shell, SSE
frames, reconnect snapshots, browser globals, stage nodes, or transport routes.
Only later ordinary RFC 6902 stage patches reach the runtime and client.

## Context compaction

Pass a `summaryStore` to enable model-assisted compaction. Quickstart wires a
`MemorySummaryStore` by default.

- **Cross-turn:** after a turn, a background task folds older Sink history into
  a rolling redacted summary with a monotonic covered-through marker and
  conversation identity anchor.
- **In-turn:** when the transcript crosses `compactionTriggerRatio`, the oldest
  complete tool step groups fold into one summary and the current stage block
  refreshes from the tool-buffer shadow.

Summarizer throw, timeout, invalid output, store failure, or insufficient gain
falls back to deterministic truncation. Compaction never makes the visitor turn
fail. The agent's optional `abortSignal` reaches both in-turn and detached
cross-turn summarizer attempts; cancellation suppresses retries and prevents a
cancelled cross-turn task from writing a new summary. Without a `summaryStore`,
no summarizer is constructed.

## Provider model and cancellation

The built-in provider factories accept an optional third `ProviderOptions`
argument. `model` is additive and opt-in: omitting it keeps the provider default
listed below. A supplied identifier is trimmed and must contain 1–200
characters; the returned provider's `model` property and request body both use
the normalized value.

When an OpenAI GPT-5.6 model is used with Facet's function tools through Chat
Completions, the adapter sends `reasoning_effort: "none"`. GPT-5.6 requires that
effective effort for Chat Completions function calls; other models and
tool-free GPT-5.6 calls keep their provider defaults.

OpenAI `gpt-5.5-pro` and `gpt-5.4-pro` use the Responses API because those Pro
models are not available through the Chat Completions tool loop. The adapter
translates the same provider-neutral transcript and tool results into stateless
Responses input items, disables response storage, and returns the same
`ProviderStep` shape. Their dated snapshots use the same path. Because Pro
responses can take several minutes, their default per-attempt timeout is ten
minutes; caller cancellation and an explicit `timeoutMs` override still take
precedence. Other OpenAI models continue to use Chat Completions with the
standard 60-second default.

`ProviderStep.providerState` is an optional opaque continuation payload. The
reference harness copies it only onto the matching `assistant_tools` transcript
entry and never interprets it. The stateless OpenAI Responses adapter uses this
field to round-trip encrypted reasoning items and assistant phase metadata with
the next function result; custom providers may omit it.

```ts
import {
  createAnthropicProvider,
  createOpenAiProvider,
} from "@facet/reference-agent";

const openai = createOpenAiProvider(process.env.OPENAI_API_KEY!, fetch, {
  model: "gpt-5.4-mini",
});
const anthropic = createAnthropicProvider(process.env.ANTHROPIC_API_KEY!, fetch, {
  model: "claude-sonnet-4-5",
});
```

`ReferenceAgentOptions.abortSignal` is also optional. When present, the
reference loop passes it to each acting or summarizing provider attempt and uses
it to interrupt retry backoff. The built-in adapters combine that caller
cancellation with their per-attempt timeout. The standard default is `60_000`
ms; OpenAI Pro Responses use the ten-minute default described above. An
already-aborted signal starts no provider work; an abort during a request or
backoff ends the turn without a failure message.

`ReferenceProvider.run` therefore has an optional third
`ProviderRunContext` argument containing `signal?`. Existing custom providers
whose `run` implementation accepts only `(turn, tools)` remain valid; a custom
provider must use the optional signal itself if it wants an in-flight request
to be cancellable. With no `abortSignal`, request timeout, retry, and stop
behavior are unchanged.

## Budgets, tracing, and diagnostics

`createReferenceAgent` accepts:

- `budgetPreset`: `"quickstart"` (default), `"hosted"`, or `"local-dev"`;
- `budget`: field overrides for steps, calls, history/stage/context size,
  observations, provider retries, token limits, and compaction; and
- compatibility aliases `maxSteps` and `historyTurns` when the corresponding
  explicit override is absent.

The provider's declared `contextWindowTokens`, when present, is a hard
pre-request ceiling. The configured budget remains the compaction and policy
ceiling within it.

`trace(event)` receives bounded events such as `turn_start`,
`compaction_triggered`, `compaction_done`, `provider_attempt`, `provider_step`,
`tool_result`, `batch_yield`, `stop`, and `turn_error`. Trace failures are
ignored; async callbacks are serialized with a bounded pending queue.

For synchronous run evidence, pass `diagnosticObserver(event)`. This is a
separate additive event surface, not an extension of the trace union. It emits
ordered `provider-attempt`, `tool-call`, `tool-result`, `batch`, and `stop`
events, plus an explicit `overflow` event when its total-event bound is reached.
Tool inputs, observations, and messages are projected through depth, entry,
string, and encoded-size bounds; sensitive fields and key-looking values are
redacted. Delivered events are detached and deeply frozen.

```ts
const diagnosticObserver = (event: ReferenceAgentDiagnosticEvent): void => {
  diagnostics.push(event);
};

const agent = createReferenceAgent({
  provider,
  sink,
  agentId: "reference",
  assets,
  abortSignal: controller.signal,
  diagnosticObserver,
});
```

The observer is evidence-only and non-controlling. Its return value is ignored;
synchronous throws and rejected returned promises are swallowed, and attempted
mutation cannot change tool execution, emitted batches, or stop policy. After
10,000 ordinary events the observer receives one `overflow` notice and later
events are dropped. Omit `diagnosticObserver` for the previous no-diagnostic
behavior.

## Exports

- `createReferenceAgent`.
- `ReferenceAgentOptions`, `ReferenceAgentAssetSource`, provider types, and
  provider factories/resolution helpers.
- `ReferenceAgentDiagnosticEvent` and `ReferenceAgentDiagnosticObserver`.
- `REFERENCE_AGENT_BUDGET_PRESETS`, budget normalization, stop/retry helpers,
  trace event types, and `ReferenceAgentLoopSummary`.
- `DEFAULT_GUIDE`, `buildSystem`, `TOOLS`, event/stage prompt helpers,
  `FACET_STAGE_TOOL_NAMES`, `FACET_STAGE_TOOL_SPECS`, and stage tool input types.
- summary validation/helpers and token estimator helpers.
- `createStubAgent` and `STUB_TREE`.

The package root intentionally does not re-export the raw
`executeStageTool`; custom provider loops should import that from
`@facet/agent-tools`.

## Provider keys

| Provider | Environment variable | Default model |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.4-mini` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |

An explicit provider requires its matching key. Without an explicit choice,
OpenAI wins when both keys exist, then Anthropic, then `null`. Keys remain in
provider request headers and are never logged, persisted, or sent to the
browser. The adapters use `fetch` directly.

Prompt/history formatting redacts sensitive field names and key-looking field
values with the shared runtime rule. Visitor ids are omitted from prompt data.

## Stub

`createStubAgent()` has no network, randomness, or clock reads. It renders
`STUB_TREE` on visit, echoes messages into the stage and chat, and reports
collected tap fields in sorted order. Use it for deterministic tests and the
quickstart live-test Tier 1 path.

## Read next

- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md)
  for the provider-neutral custom-loop handoff and host-owned boundaries.
- [Agent Tool Result Contract](https://github.com/getfacet/facet/blob/main/docs/AGENT-TOOL-RESULT-CONTRACT.md)
  for exact observation outcomes and recovery behavior.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
  for the stage, patch, and design-asset boundaries.
