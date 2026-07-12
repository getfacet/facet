# @facet/reference-agent

Reference Facet brain: provider adapters, prompt policy, a bounded streaming
harness, and a deterministic test fixture.

Tier: **Reference Implementation**.

This package is a reference harness, not Facet's product boundary and not a
customer production brain. Use it to understand a robust tool-calling loop, test
Facet end to end, or bootstrap local evaluations. Agent business logic, domain tools,
and production policy belong to the application or platform that uses Facet.

The reusable Facet stage tool and prompt-kit layer lives in
`@facet/agent-tools`. That package owns the canonical tool specs,
`executeStageTool`, inspection helpers, result types, local stage-shadow
helpers, catalog-aware enforcement, and provider-neutral Facet authoring
guidance without choosing a provider or reference policy. Use
`@facet/agent-tools` directly for custom agent loops. This package consumes that
layer and adds the OpenAI/Anthropic adapters, reference page brief,
event/history/stage context, bounded harness loop, and deterministic test
fixture.

`@facet/quickstart` composes this package for the provider-backed
`facet-quickstart` path. You can import it directly when you want the reference
agent without the quickstart CLI/server/page wrapper.

```ts
import { MemorySink } from "@facet/runtime";
import { DEFAULT_CATALOG, DEFAULT_COMPOSITIONS } from "@facet/assets";
import { createReferenceAgent, resolveProvider } from "@facet/reference-agent";

const provider = resolveProvider({}, process.env);
if (provider === null) throw new Error("Set OPENAI_API_KEY or ANTHROPIC_API_KEY");

const agent = createReferenceAgent({
  provider,
  sink: new MemorySink(),
  agentId: "reference",
  guide: "# My Facet page",
  catalog: DEFAULT_CATALOG,
  compositions: DEFAULT_COMPOSITIONS,
  budgetPreset: "quickstart",
  trace: (event) => console.debug("[facet-reference-agent]", event),
});
```

## Package layout

- `provider/`: provider turn/tool types, OpenAI and Anthropic adapters, and env
  resolution. The top-level `provider.ts` remains a compatibility barrel.
- `prompt/`: compatibility wrapper around the shared agent-tools prompt kit,
  plus event/history transcript messages and bounded current-stage summaries.
  The package root keeps the prompt helpers used by quickstart, including
  `TOOLS`, without exporting the raw agent-tools executor.
- `harness/`: context assembly, token-calibrated sizing, background and in-turn
  compaction, budget normalization, retry/stop classification, transcript
  observations, trace events, and the streaming loop. Test-only compaction
  controls remain internal to this harness rather than the package API.
- `stub.ts`: deterministic agent fixture for local tests and live-link gates.

The harness is bounded by default. It compacts sink history, includes full stage
JSON only after a bounded length check says it can fit, falls back to
deterministic stage summaries for large pages, retries only classified retryable
provider failures, and emits one fallback chat line when a turn otherwise
produces no useful output. Corrupt sink history rows and malformed stage
metadata degrade to placeholders/summaries instead of aborting prompt assembly.

## LLM context compaction

Pass a `summaryStore` (any `@facet/runtime` `SummaryStore`; quickstart wires
`MemorySummaryStore` by default) and the harness compacts with the same
provider/model it acts with, sized in tokens calibrated from provider-reported
usage (the Anthropic adapter also enables `cache_control` prefix caching on the
stable system+tools prefix):

- **Cross-turn** — after a turn, a background task on a per-visitor serial lane
  folds older sink history (chunked under `maxSummarizerInputChars`) into a
  rolling, redacted, schema-validated conversation summary. It persists with a
  monotonic covered-through marker plus a conversation-identity anchor, so a
  wiped/reset sink rebuilds at generation 1 instead of resurrecting a foreign
  summary. The next turn injects it as a pinned user-role data block ahead of
  the verbatim recent turns.
- **In-turn** — when the tool transcript passes `compactionTriggerRatio` of the
  effective token budget, the oldest whole tool step-groups fold into one
  summary message (pair-safe for both provider wire formats) and the stage
  block refreshes from the tool-buffer shadow under a never-inflate guard, so
  the turn continues instead of hard-stopping at `context_limit`.

Every summarizer failure (throw, timeout, invalid output, store error,
insufficient gain) degrades to the deterministic truncation pipeline — a turn
is never blocked or failed by compaction. Without a `summaryStore`, no
summarizer is constructed and behavior is exactly the deterministic pipeline.
Compaction emits `compaction_triggered` / `compaction_done` /
`compaction_failed` trace events with the site (`cross_turn` / `in_turn`).

## Budgets and tracing

`createReferenceAgent` accepts additive budget options:

- `budgetPreset`: `"quickstart"` (default), `"hosted"`, or `"local-dev"`.
- `budget`: field-level overrides for steps, tool calls, context/history/stage
  character limits, observation/final-text caps, provider retries, retry
  backoff, and the token/compaction model (`maxContextTokens`,
  `compactionTriggerRatio`/`compactionTargetRatio`,
  `minRecentTurnsVerbatim`/`minRecentStepsVerbatim`, `maxSummaryTokens`,
  `maxSummarizerInputChars`, `summarizerTimeoutMs`/`summarizerRetries`,
  `compactionCooldownSteps`, `contextWindowTokensDefault`).
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

`ReferenceAgentOptions.compositions` is the operator's composition library.
`createReferenceAgent` snapshots those documents (and the `catalog`) once at
creation with a structured clone — later mutation of the caller's composition
objects never alters the prompt or execution of any turn.

Reference-agent catalog consumption has two paths:

- Prompt path: `buildSystem(guide, assets?)` takes `PromptAssets` (`themes`,
  `compositions`, optional `catalog`) and delegates to the agent-tools prompt
  kit, which includes theme names, the active catalog, composition names,
  slot names, and whitelisted composition metadata — never composition node
  JSON or slot default values. Catalog guidance includes
  locked theme behavior, allowed component variants, composition policy,
  primitive fallback, compact-screen guidance, product-quality component
  defaults, and `composition -> component -> primitive`.
- Executor path: the same `catalog` and the immutable composition snapshot are
  passed as stage-tool assets to the buffered executor, where `use_composition`
  expands them server-side. That makes catalog policy
  enforceable, not just prompt text: disallowed components/variants/compositions, tone-only
  recipe selectors outside the advertised variants, and locked theme changes are
  rejected before any patch is yielded to the runtime.

Catalog policy here is UI authoring policy for the reference brain. It is not
hosted platform policy for auth, tenants, billing, metering, rate limits, spend
caps, secrets operations, or admin workflows.

`buildSystem(guide, assets?)` remains the reference-agent compatibility helper,
but its fixed Facet guidance now comes from `@facet/agent-tools`. This package
still owns the reference `DEFAULT_GUIDE`, provider adapters, context assembly,
history compaction, budgets, retries, trace events, and fallback behavior.
The reference prompt consumes the reusable component-model guidance from
agent-tools; it does not duplicate renderer recipes, theme token values,
composition node JSON, provider keys, or visitor ids.

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
