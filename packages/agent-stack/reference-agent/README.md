# @facet/reference-agent

Reference Facet brain: provider adapters, prompt policy, a bounded streaming
harness, and a deterministic test fixture.

Tier: **Reference Implementation**.

This package is a reference harness, not Facet's product boundary and not a
customer production brain. Use it to understand a robust tool-calling loop, test
Facet end to end, or bootstrap local evaluations. Agent business logic, domain tools,
and production policy belong to the application or platform that uses Facet.

The reusable Facet stage tool layer lives in `@facet/agent-tools`. That package
owns the canonical tool specs, `executeStageTool`, inspection helpers, result
types, and local stage-shadow helpers without choosing a provider or reference
policy. Use `@facet/agent-tools` directly for custom agent loops. This package
consumes that layer and adds the OpenAI/Anthropic adapters, system prompt,
bounded harness loop, and deterministic test fixture.

`@facet/quickstart` composes this package for the provider-backed
`facet-quickstart` path. You can import it directly when you want the reference
agent without the quickstart CLI/server/page wrapper.

```ts
import { MemorySink } from "@facet/runtime";
import { createReferenceAgent, resolveProvider } from "@facet/reference-agent";

const provider = resolveProvider({}, process.env);
if (provider === null) throw new Error("Set OPENAI_API_KEY or ANTHROPIC_API_KEY");

const agent = createReferenceAgent({
  provider,
  sink: new MemorySink(),
  agentId: "reference",
  guide: "# My Facet page",
  budgetPreset: "quickstart",
  trace: (event) => console.debug("[facet-reference-agent]", event),
});
```

## Package layout

- `provider/`: provider turn/tool types, OpenAI and Anthropic adapters, and env
  resolution. The top-level `provider.ts` remains a compatibility barrel.
- `prompt/`: system prompt, event/history transcript messages, and bounded
  current-stage summaries. The package root keeps the prompt helpers used by
  quickstart, including `TOOLS`, without exporting the raw agent-tools executor.
- `harness/`: context assembly, deterministic compaction, budget normalization,
  retry/stop classification, transcript observations, trace events, and the
  streaming loop.
- `stub.ts`: deterministic agent fixture for local tests and live-link gates.

The harness is bounded by default. It compacts sink history, includes full stage
JSON only after a bounded length check says it can fit, falls back to
deterministic stage summaries for large pages, retries only classified retryable
provider failures, and emits one fallback chat line when a turn otherwise
produces no useful output. Corrupt sink history rows and malformed stage
metadata degrade to placeholders/summaries instead of aborting prompt assembly.

## Budgets and tracing

`createReferenceAgent` accepts additive budget options:

- `budgetPreset`: `"quickstart"` (default), `"hosted"`, or `"local-dev"`.
- `budget`: field-level overrides for steps, tool calls, context/history/stage
  character limits, observation/final-text caps, provider retries, and retry
  backoff.
- Legacy `maxSteps` and `historyTurns` still work when the corresponding
  explicit budget override is absent.

Preset intent:

| Preset | Intended use |
| --- | --- |
| `quickstart` | Conservative default for local first-run and npx evaluation. |
| `hosted` | More generous reference-harness profile for controlled hosted evaluations; not an endorsement that this package is your production brain. |
| `local-dev` | Generous but still bounded local experimentation profile. |

Pass `trace(event)` to observe bounded, sanitized harness events such as
`turn_start`, `context_compacted`, `provider_attempt`, `provider_retry`,
`provider_step`, `tool_result`, `batch_yield`, `stop`, and `turn_error`.
Trace callback failures are ignored so observability cannot break a visitor turn.
Async trace callbacks are serialized per callback with a bounded pending queue;
when the queue is saturated, terminal `stop`/`turn_error` events are preserved
over ordinary trace events.

## Tool Layer

Use `@facet/agent-tools` directly when you are writing your own provider loop
and only need the safe Facet stage tool surface:

```ts
import { FACET_STAGE_TOOL_SPECS, executeStageTool } from "@facet/agent-tools";
```

The tool loop feeds the model structured JSON tool results. The prompt teaches
the model to inspect `outcome`, `visible_to_visitor`, `warnings`, and
`next_action` before claiming completion. In particular, `pending`,
`rejected`, `applied_with_warnings`, and `applied_not_visible` are not visible
success. This keeps false-success cases, such as creating an unattached node
with `set_node`, inside the repair loop.

Use `@facet/reference-agent` when you want Facet's runnable reference brain.

## Exports

- `createReferenceAgent` plus compatibility alias `createQuickstartAgent`.
- `ReferenceAgentOptions` plus compatibility alias `QuickstartAgentOptions`.
- `ReferenceProvider` plus compatibility alias `QuickstartProvider`.
- Harness budget and trace helpers: `REFERENCE_AGENT_BUDGET_PRESETS`,
  `normalizeBudget`, stop reason constants/types, retry classification helpers,
  `REFERENCE_AGENT_TRACE_EVENT_TYPES`, trace emitter/sanitizer types, and
  `ReferenceAgentLoopSummary`.
- Provider helpers: `resolveProvider`, `createOpenAiProvider`,
  `createAnthropicProvider`, model constants, and provider turn/tool types.
- Prompt/tool compatibility: `DEFAULT_GUIDE`, `buildSystem`, `TOOLS`,
  `describeEvent`, `buildInitialMessages`, `PromptAssets`, and the Facet stage
  tool types re-exported from `@facet/agent-tools`.
- Stub: `createStubAgent`, `STUB_TREE`.

## Provider keys

Provider keys are read from environment variables by `resolveProvider`:

| Provider | Key env var | Default model |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `gpt-5.4-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |

An explicit provider flag requires its matching key. Without a flag, OpenAI wins
when both keys are present, then Anthropic, then `null`.

Keys are never logged, persisted, or placed in the browser bundle. They travel
only in the provider request auth header. The adapters use raw `fetch`; no
provider SDK dependency is bundled here.

The prompt formatter includes normal collected fields so actions can use form
context, but field names that look sensitive (`password`, `token`, `api_key`,
provider-key-like names) and key-looking field values are rendered as
`[redacted]`. Visit prompts include non-secret context such as referrer/locale
and omit the `visitorId` bearer key.

## Stub

`createStubAgent()` is deterministic: no network, no randomness, and no clock
reads. It renders `STUB_TREE` on visit, echoes messages into the stage and chat,
responds to `theme <name>`, and echoes collected tap fields in sorted order.

Use it for local tests and the quickstart live-test Tier 1 path, not as the
public quickstart experience.
