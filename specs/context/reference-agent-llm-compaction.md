# Context: `reference-agent-llm-compaction`

Spec-writer-facing evidence pack. All file:line references were gathered during
the context pass. Do not invent new facts beyond what is captured here.

## Affected packages

- `@facet/reference-agent`
- `@facet/runtime`
- `@facet/store-postgres`
- `@facet/quickstart`

## Code entrypoints

### `@facet/reference-agent`

- **`packages/agent-stack/reference-agent/src/harness/context.ts:54`** —
  `assembleProviderContext()` is the cross-turn assembly seam. It must load the
  persisted summary, inject it as a user-role block at the head of history
  (`renderHistoryMessages:94`), replay only post-`coveredThrough` turns, and keep
  deterministic compaction (`compactHistoryMessages`) as the final guard.
- **`packages/agent-stack/reference-agent/src/harness/loop.ts:175`** —
  `runReadyProviderLoop` while-loop hard-stops with `context_limit` at
  `:177-180`; in-turn compaction hooks here (compact oldest whole
  `assistant_tools` + `tool_result` groups, refresh `CURRENT STAGE` from
  `buffer.shadow`, continue). `runReferenceAgentLoop:104` is where post-turn
  background compaction is triggered after the final batch.
- **`packages/agent-stack/reference-agent/src/harness/compaction.ts:24`** —
  `compactHistoryMessages` + `groupTurns:191` (2-message turn grouping) +
  `estimateMessagesChars:86` are the existing deterministic-truncation fallback
  the feature must preserve and fall back to. Reuse the group/pair-boundary logic
  for in-turn step-group compaction.
- **`packages/agent-stack/reference-agent/src/harness/budget.ts:3`** —
  `ReferenceAgentBudget` interface + `REFERENCE_AGENT_BUDGET_PRESETS:30`
  (char-based) + `normalizeBudget:143` with the legacy-alias pattern
  (`budgetCandidates:222`). Add token-based fields with the char fields as legacy
  aliases; add per-preset caps and trigger / target / cooldown /
  minRecentVerbatim / maxSummaryTokens / summarizer-timeout constants.
- **`packages/agent-stack/reference-agent/src/provider/types.ts:10`** —
  `ProviderStep` (add `readonly usage`) + `QuickstartProvider:35` (add optional
  `contextWindowTokens`); `postJson:56` is the shared adapter POST helper.
- **`packages/agent-stack/reference-agent/src/provider/anthropic.ts:118`** —
  `createAnthropicProvider.run` must parse `usage.input_tokens` /
  `usage.output_tokens` from the body and add `cache_control` breakpoints on the
  stable system + tools prefix (`parseAnthropicStep:86` currently discards
  usage).
- **`packages/agent-stack/reference-agent/src/provider/openai.ts:78`** —
  `createOpenAiProvider.run` must parse `body.usage` into `ProviderStep.usage`
  (`parseOpenAiStep:40` currently discards it); body otherwise unchanged.
- **`packages/agent-stack/reference-agent/src/harness/trace.ts:3`** —
  `REFERENCE_AGENT_TRACE_EVENT_TYPES` union + per-event interfaces; add
  `compaction_triggered` / `done` / `failed` + token-usage trace events following
  the `ReferenceAgentContextCompactedTraceEvent:24` shape.
- **`packages/agent-stack/reference-agent/src/prompt/messages.ts:16`** —
  `REDACTED_PROMPT_VALUE` + `SENSITIVE_FIELD_NAME` / `VALUE` regexes (used on
  inputs) must also run over the summarizer OUTPUT and the persisted payload.
  `buildInitialMessages:133` + `describeEvent:35` feed history assembly where the
  summary block injects.
- **`packages/agent-stack/reference-agent/src/agent.ts:56`** —
  `createQuickstartAgent` wires `QuickstartAgentOptions` (`:26`) into
  `runReferenceAgentLoop`; add `summaryStore` + an injectable summarizer factory +
  compaction options here. The `index.ts:1` barrel must export the new public
  types.

### `@facet/runtime`

- **`packages/core/runtime/src/sink.ts:35`** — `Sink` interface +
  Memory / Null / Forward implementations is the exact pattern for the new
  brain-agnostic `SummaryStore` interface + `MemorySummaryStore` (opaque payload +
  `coveredThrough` + `generation`, keyed by `agentId` + `visitorId` via
  `sessionKey`); barrel export added at `index.ts:1`.
- **`packages/core/runtime/src/file-sink.ts:28`** — `FileSink` (JSONL,
  `node:fs`, `isStoredEvent` shape guard, skip-corrupt-line) is the template for
  `FileSummaryStore`; it must be exported only from `node.ts:1` (the Node-only
  barrel) to keep the main index browser-safe.

### `@facet/store-postgres`

- **`packages/extensions/store-postgres/src/postgres-store.ts:79`** — the
  `PostgresSink` pattern (`constructor(pool)`, interface-only methods,
  `initSchema:16` table DDL) is the template for `PostgresSummaryStore` (new
  `facet_summary` table, monotonic `coveredThrough`, corrupt-payload read →
  `undefined`); barrel export at `index.ts:1`.

### `@facet/quickstart`

- **`packages/agent-stack/quickstart/src/cli.ts:187`** — `new MemorySink()` is
  created and shared; wire a new `MemorySummaryStore()` here (compaction ON by
  default) and pass it into `createQuickstartAgent` (`:203`) and
  `startQuickstart`. `server.ts:344` `bootInternalServer` passes sink /
  stageStore through to `createFacetServer` — thread the summary store the same
  way. `quickstart/src/agent.ts` re-exports reference-agent options.

## Risk register

### RISK-INV-1 (INV) — Invariant #6, two-writers coherence

The background summarizer is a NEW detached writer that escapes both of the
runtime's per-visitor serial lanes. `FacetRuntime.serialize`
(`packages/core/runtime/src/runtime.ts:104`) and `serializeRecord`
(`packages/core/runtime/src/runtime.ts:109`) only wrap the turn generator and the
sink `record()` write; the agent's own generator return value is DISCARDED by
`iterateAgentResult`'s `for await...of` (`packages/core/core/src/agent-result.ts:18`),
and the runtime exposes NO post-turn hook. The brief's cross-turn compaction must
therefore be a fire-and-forget promise spawned inside the reference-agent
generator (`createQuickstartAgent`'s `return async function*`,
`packages/agent-stack/reference-agent/src/agent.ts:75-88`, after the
`yield* runReferenceAgentLoop`), which runs OUTSIDE `serialize`/`serializeRecord`.

Consequence: two consecutive turns for the same `(agentId, visitorId)` can each
launch a summarizer whose `SummaryStore.put` overlaps, and a slow/stale writer can
clobber a newer generation.

Resolution the spec MUST implement: a reference-agent-owned
per-`(agentId, visitorId)` serialization lane (reuse the exported
`createSerialQueue` from `@facet/core`,
`packages/core/core/src/serial-queue.ts:10`, keyed via `sessionKey` at
`packages/core/runtime/src/stage-store.ts:29`) PLUS a monotonic `coveredThrough`
guard enforced inside `SummaryStore.put` that rejects/ignores any regressive write
(DC-009) — the runtime does not and must not provide this ordering for detached
agent work.

### RISK-INV-2 (INV) — Invariant #6, read-your-own-write staleness

Staleness between the detached summarizer (reader) and the runtime's sink writer.
The just-finished turn's sink record is written fire-and-forget on
`serializeRecord` via the reserved slot (`reserveRecordSlot`
`packages/core/runtime/src/runtime.ts:226-236`; `settleRecord` / final
`settleRecord` at `runtime.ts:354` and `runtime.ts:430`) and is NOT guaranteed
persisted when the agent generator returns. A background compaction reads
`sink.history()` (`packages/agent-stack/reference-agent/src/harness/context.ts:59`)
with no handle to that write lane, so it can compute `coveredThrough` against a
history missing the latest turn(s); a lagging background write then lets assembly
load a summary whose `coveredThrough` exceeds the current sink length (Example 4 /
DC-015).

Resolution the spec MUST implement:
- (a) assembly discards the summary when `coveredThrough` > sink length and falls
  back to deterministic truncation (DC-015);
- (b) the verbatim top-up must slice history AFTER `coveredThrough`, not by
  `maxHistoryTurns` alone — `renderHistoryMessages` at
  `packages/agent-stack/reference-agent/src/harness/context.ts:94-110` currently
  slices by `budget.maxHistoryTurns` and must become `coveredThrough`-relative so
  lagging summaries are always safe (DC-014);
- (c) `coveredThrough` clamped to the observed history length at write time so it
  can never outrun the sink.

### RISK-INV-3 (INV) — Invariant #1, no domain/brain awareness in core/runtime

The new `SummaryStore` interface added to `@facet/runtime` (barrel
`packages/core/runtime/src/index.ts:2-5`, alongside `Sink` in
`packages/core/runtime/src/sink.ts`) must keep an OPAQUE payload. The existing
`Sink` / `StoredEvent` shape only stores core protocol types (`ServerMessage`,
`CollectedEvent`); if `SummaryStore` typed its payload as the reference-agent's
LLM summary schema or validated it inside runtime, then `@facet/runtime` (and by
transitive re-export `@facet/server`) would gain LLM/brain awareness, violating
the brief's own constraint (brief lines 122-125: "core/runtime/server keep zero
LLM awareness; the summary JSON schema is owned and validated by
`@facet/reference-agent`") and invariant #1.

Resolution the spec MUST implement: `SummaryStore` payload typed as opaque
serializable JSON (`unknown` / `Record<string, unknown>`) carrying only
`coveredThrough` + `generation` metadata; ALL schema validation lives in
`@facet/reference-agent`, which discards corrupt/invalid payloads on read →
`undefined` (DC-012). `PostgresSummaryStore` (`@facet/store-postgres`) and
`MemorySummaryStore` must round-trip the payload verbatim without interpreting it.

### RISK-API-1 (API) — `ProviderStep.usage`: additive iff optional

BREAKING-IF-REQUIRED. `ProviderStep` is a PUBLISHED interface
(`packages/agent-stack/reference-agent/src/provider/types.ts:10-13`), re-exported
from the barrel (`src/provider.ts:22`, `src/index.ts:3`
`export * from ./provider.js`) and mirrored as a public `.d.ts`. It is the RETURN
type every `QuickstartProvider.run()` produces — both built-in adapters
(`src/provider/openai.ts:40` `parseOpenAiStep(): ProviderStep`,
`src/provider/anthropic.ts:86` `parseAnthropicStep(): ProviderStep`) and any
external/custom provider a deployer writes. The brief (Public API table, brief
line 224 `ProviderStep.usage`) adds a `usage` field.

Resolution the spec MUST implement: declare it OPTIONAL —
`readonly usage?: { inputTokens?: number; outputTokens?: number; ... }` — so the
two adapters and any custom provider that omits usage still structurally satisfy
`ProviderStep` (calibration must degrade to estimate-only when absent, per brief
line 136 / DC-008). If added as REQUIRED it silently breaks every third-party
provider and the journey harness path
(`packages/agent-stack/quickstart/e2e/journey/harness.ts:163` resolves a
`QuickstartProvider`). Classification: additive iff optional; breaking if
required.

### RISK-API-2 (API) — `QuickstartProvider.contextWindowTokens`: additive iff optional-with-default

BREAKING-IF-REQUIRED. `QuickstartProvider` is a PUBLISHED interface
(`packages/agent-stack/reference-agent/src/provider/types.ts:35-40`), aliased
publicly as `ReferenceProvider` (`src/index.ts:37`) and re-exported verbatim by
`@facet/quickstart` (`packages/agent-stack/quickstart/src/provider.ts:13-14`).
Consumers implement it: built-in adapters (`src/provider/openai.ts:82`,
`src/provider/anthropic.ts:112` `): QuickstartProvider`), `resolveProvider`
(`src/provider/resolve.ts:19`), and any deployer-supplied brain. The brief (line
224) adds `contextWindowTokens`.

Resolution: make it OPTIONAL — `readonly contextWindowTokens?: number` — AND give
the budget/estimator a conservative default when absent (brief line 224 "custom
providers without `contextWindowTokens` get a conservative default"; Decision Lock
line 244 "custom default 100k"). A required field would break every existing
`QuickstartProvider` / `ReferenceProvider` implementer at compile time.
Classification: additive iff optional-with-default.

### RISK-API-3 (API) — `ReferenceAgentBudget`: additive iff no field removed/renamed

COUPLING / BREAKING-IF-RENAMED. `ReferenceAgentBudget` is a PUBLISHED interface
(`packages/agent-stack/reference-agent/src/harness/budget.ts:3-15`) with the
exported preset table `REFERENCE_AGENT_BUDGET_PRESETS` (`budget.ts:30`,
`satisfies Record<ReferenceAgentBudgetPreset, ReferenceAgentBudget>`) and
`normalizeBudget()` (`budget.ts:143`). Its char fields (`maxContextChars`,
`maxHistoryChars`, `maxStageJsonChars`, `maxStageSummaryNodes`) are read
internally by `harness/context.ts:71,86,127-128,163,177`. The brief (line 224)
says char fields "become legacy aliases" and adds token-based fields.

Resolution: the change MUST be additive-only — KEEP every existing char field on
the interface (do not remove/rename), ADD the new token fields, and populate the
new fields in ALL THREE preset literals (`quickstart` / `hosted` / `local-dev`,
`budget.ts:31-69`) or the `satisfies` constraint fails to typecheck.
`ReferenceAgentBudgetOverrides = Partial<ReferenceAgentBudget>` (`budget.ts:17`)
stays safe under addition. Removing/renaming char fields breaks `context.ts` reads
AND any external caller reading `budget.maxContextChars`. Also update
`chooseBudgetValue` / `budgetCandidates` (`budget.ts:222`) and MIN / BUDGET_FIELDS
tables (`budget.ts:109-137`) for each new token field. Classification: additive
iff no existing field removed/renamed.

### RISK-API-4 (API) — compaction trace events: additive union, three-way coherence

COUPLING. The compaction trace events (brief lines 224 / DC-003
`compaction_triggered` / `done` / `failed`, token usage) touch a PUBLISHED,
tightly-coupled trio in
`packages/agent-stack/reference-agent/src/harness/trace.ts`:
- (a) the const array `REFERENCE_AGENT_TRACE_EVENT_TYPES` (`trace.ts:3-13`,
  exported, drives `ReferenceAgentTraceEventType`),
- (b) the discriminated union `ReferenceAgentTraceEvent` (`trace.ts:97-106`, the
  argument type of the public `ReferenceAgentTrace` callback consumers supply,
  `trace.ts:108`),
- (c) the exhaustive `switch (event.type)` in
  `sanitizeReferenceAgentTraceEvent` (`trace.ts:160-244`) which has NO default and
  whose return type is `ReferenceAgentTraceEvent`.

Resolution: any new event kind MUST be added to all three coherently — add the
string to the const array, add the interface + union arm, and add a `case` in the
sanitize switch (a new union member without a matching case fails typecheck via
the no-implicit-return contract, and if bypassed would let an unsanitized event
escape). Adding events is otherwise additive for the callback consumer; note that
any external consumer exhaustively switching on `event.type` with a `never` guard
will need a new branch (acceptable pre-1.0). No non-test external consumers of the
union were found (grep of packages/apps outside `trace.ts`/tests = none).

### RISK-API-5 (API) — new store barrels: additive, barrel-completeness obligation

ADDITIVE (no existing consumer to break). The new `@facet/runtime`
`SummaryStore` / `MemorySummaryStore` (brief line 223) must be exported through
the browser-safe barrel `packages/core/runtime/src/index.ts` (currently lines
2-5) and the file-backed `FileSummaryStore` through the node barrel
`packages/core/runtime/src/node.ts` (currently lines 3-5), matching the `./` and
`./node` subpaths in `packages/core/runtime/package.json:20-22`.
`PostgresSummaryStore` (brief line 225) exports through
`packages/extensions/store-postgres/src/index.ts` (currently 2 lines). All are
net-new symbols with zero existing consumers (apps/playground uses only
`FacetRuntime` / `FileSink` / `FileStageStore` — `App.tsx:4`, `server.ts:12` —
none of the new names), so purely additive.

Resolution/constraint the spec must honor: keep `@facet/runtime` LLM-agnostic —
`SummaryStore` payload stays OPAQUE (brief lines 122-125), the summary JSON schema
owned/validated only by `@facet/reference-agent`; do NOT import reference-agent
types into runtime or it inverts the one-way dependency (CLAUDE.md: everything
depends on `@facet/core`; runtime must not depend on the agent stack).

### RISK-PKG-1 (PKG) — import-cycle hazard

The brief places the new `SummaryStore` interface + `MemorySummaryStore` in
`@facet/runtime` (`packages/core/runtime/package.json` deps = only `@facet/core` +
`@facet/assets`) but the summary JSON schema is owned/validated by
`@facet/reference-agent`. `@facet/reference-agent` already imports FROM runtime
(`packages/agent-stack/reference-agent/src/harness/context.ts:2`
`import type { Sink } from "@facet/runtime"`; also `src/agent.ts:3`,
`harness/loop.ts:10`). If `SummaryStore`'s payload is typed against
reference-agent's concrete summary type, runtime would have to import
reference-agent → runtime→reference-agent→runtime cycle.

Resolution the spec MUST encode: `SummaryStore` payload MUST be opaque
(`unknown` / `string` / generic `<T>`, e.g.
`{ payload: unknown; coveredThrough: number; generation: number }`) exactly like
the existing store payload discipline; ALL schema shape + `validateSummary`
validation lives in `@facet/reference-agent`; `@facet/runtime` and `@facet/core`
stay LLM/schema-unaware. Runtime must NOT gain a dependency on any agent-stack
package.

### RISK-PKG-2 (PKG) — barrel-export + browser-safe/node split obligation

Runtime's main entry is browser-safe by contract
(`packages/core/runtime/src/index.ts` header: "Browser-safe entry: no Node
built-ins. File/DB backends live in `@facet/runtime/node`"); node-only file
backends live in `packages/core/runtime/src/node.ts`.

Resolution the spec MUST implement:
- (a) `MemorySummaryStore` + the `SummaryStore` interface in a new
  `summary-store.ts` exported from the `src/index.ts:1` barrel with NO `node:fs` /
  `node:*` import (keeps the main entry browser-safe);
- (b) `FileSummaryStore` in a new `file-summary-store.ts` exported from
  `src/node.ts` (which today only re-exports `file-stage-store` / `file-sink` /
  `file-assets`) — it may use `node:fs`;
- (c) `PostgresSummaryStore` exported from
  `packages/extensions/store-postgres/src/index.ts:1` alongside the existing
  `postgres-assets` / `postgres-store` re-exports.

Missing any of these barrels means the new public surface is unreachable and fails
the "new public API exported through the package barrel index.ts" Definition of
Done.
