import {
  createStageToolAssetSnapshot,
  type StageToolAssets,
  type StageToolAssetSource,
} from "@facet/agent-tools";
import type { FacetAgent, ServerMessage } from "@facet/core";
import { sessionKey, type Sink, type SummaryStore } from "@facet/runtime";
import {
  enqueueBackgroundCompaction,
  runBackgroundCompaction,
} from "./harness/background-compaction.js";
import {
  normalizeBudget,
  type ReferenceAgentBudgetOverrides,
  type ReferenceAgentBudgetPreset,
  type ReferenceAgentStopReason,
} from "./harness/budget.js";
import {
  createReferenceAgentDiagnosticEmitter,
  type ReferenceAgentDiagnosticObserver,
} from "./harness/diagnostic-observer.js";
import {
  REFERENCE_AGENT_FAILURE_SAY,
  runReferenceAgentLoop,
  type ReferenceAgentLoopSummary,
} from "./harness/loop.js";
import { createProviderSummarizer, type Summarizer } from "./harness/summary.js";
import type { ReferenceAgentTrace } from "./harness/trace.js";
import { DEFAULT_GUIDE, buildSystem } from "./prompt.js";
import type { ReferenceProvider } from "./provider.js";

/**
 * Public factory for the Facet reference agent.
 *
 * The factory owns deployer-facing configuration: guide/assets, compatibility
 * budget aliases, explicit budget overrides, and optional tracing. Turn
 * execution lives in the harness loop.
 */
export interface ReferenceAgentOptions {
  readonly provider: ReferenceProvider;
  /** Deployer's page brief (layer ②). Defaults to the built-in DEFAULT_GUIDE. */
  readonly guide?: string;
  /** Conversation history source for prompt layer ③ (shared with the runtime). */
  readonly sink: Sink;
  readonly agentId: string;
  /** Budget profile. Defaults to the quickstart safety profile. */
  readonly budgetPreset?: ReferenceAgentBudgetPreset;
  /** Explicit budget overrides. These win over legacy aliases and preset values. */
  readonly budget?: ReferenceAgentBudgetOverrides;
  /** Optional bounded trace callback. Failures are ignored by the harness. */
  readonly trace?: ReferenceAgentTrace;
  /** Optional cancellation shared by provider attempts and retry backoff. */
  readonly abortSignal?: AbortSignal;
  /** Optional synchronous bounded lifecycle/tool diagnostic observer. */
  readonly diagnosticObserver?: ReferenceAgentDiagnosticObserver;
  /** Legacy alias for budget.maxHistoryTurns. Ignored when budget.maxHistoryTurns is set. */
  readonly historyTurns?: number;
  /** Legacy alias for budget.maxSteps. Ignored when budget.maxSteps is set. */
  readonly maxSteps?: number;
  /**
   * Static operator assets or a dynamic source acquired once at the start of
   * each provider turn. The result is validated, detached, and deeply frozen
   * before either the prompt or a stage tool can observe it.
   */
  readonly assets: ReferenceAgentAssetSource;
  /**
   * Rolling-summary store. When present, cross-turn context compaction is enabled:
   * a persisted summary is injected on assembly (WU-7) and a background task after
   * each turn rolls it forward. Absent ⇒ no summarizer is constructed and behavior
   * is exactly as before.
   */
  readonly summaryStore?: SummaryStore;
}

export type ReferenceAgentAssetSource =
  StageToolAssetSource | (() => StageToolAssetSource | Promise<StageToolAssetSource>);

/** Internal dependency seam used by package-local tests; not exported from the package root. */
export interface ReferenceAgentDependencies {
  readonly summarizerFactory?: (provider: ReferenceProvider) => Summarizer;
  readonly onBackgroundTask?: (task: Promise<void>) => void;
}

function sayBatch(text: string): readonly ServerMessage[] {
  return [{ kind: "say", text }];
}

export function createReferenceAgent(options: ReferenceAgentOptions): FacetAgent {
  return createReferenceAgentWithDependencies(options);
}

/** Internal factory used to exercise detached compaction deterministically in tests. */
export function createReferenceAgentWithDependencies(
  options: ReferenceAgentOptions,
  dependencies: ReferenceAgentDependencies = {},
): FacetAgent {
  const budget = normalizeBudget({
    ...(options.budgetPreset !== undefined ? { budgetPreset: options.budgetPreset } : {}),
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
    ...(options.historyTurns !== undefined ? { historyTurns: options.historyTurns } : {}),
  });

  // Constructed lazily — only with a store. The deterministic/stub path (no store)
  // never invokes the factory and never runs a summarizer.
  const summarizer: Summarizer | undefined =
    options.summaryStore !== undefined
      ? (dependencies.summarizerFactory ?? createProviderSummarizer)(options.provider)
      : undefined;
  const contextWindowTokens = options.provider.contextWindowTokens;
  const diagnostics = createReferenceAgentDiagnosticEmitter(options.diagnosticObserver);

  return async function* (event, session) {
    if (isSignalAborted(options.abortSignal)) {
      diagnostics({ kind: "stop", reason: "aborted" });
      return;
    }
    let turnSystem: string | undefined;
    try {
      const assets = await acquireTurnAssets(options.assets);
      turnSystem = buildSystem(options.guide ?? DEFAULT_GUIDE, assets);
      const summary = yield* runReferenceAgentLoop({
        provider: options.provider,
        system: turnSystem,
        event,
        session,
        sink: options.sink,
        agentId: options.agentId,
        budget,
        assets,
        ...(options.trace !== undefined ? { trace: options.trace } : {}),
        ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
        diagnostics,
        ...(summarizer !== undefined ? { summarizer } : {}),
        ...(options.summaryStore !== undefined ? { summaryStore: options.summaryStore } : {}),
        ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
        fallbackSay: REFERENCE_AGENT_FAILURE_SAY,
      });
      logStopSummary(summary);
    } catch (error) {
      console.error("[facet-reference-agent] turn failed:", errMsg(error));
      diagnostics({
        kind: "stop",
        reason: isSignalAborted(options.abortSignal) ? "aborted" : "invalid-output",
      });
      if (!isSignalAborted(options.abortSignal)) yield sayBatch(REFERENCE_AGENT_FAILURE_SAY);
    }

    // Cross-turn compaction runs AFTER the turn, detached, on the serial lane.
    // The generator returns without awaiting it; the task can never reject.
    if (
      options.summaryStore !== undefined &&
      summarizer !== undefined &&
      turnSystem !== undefined &&
      !isSignalAborted(options.abortSignal)
    ) {
      const store = options.summaryStore;
      const system = turnSystem;
      const key = sessionKey(options.agentId, session.visitor.visitorId);
      const task = enqueueBackgroundCompaction(key, async () => {
        try {
          await runBackgroundCompaction({
            provider: options.provider,
            system,
            budget,
            event,
            session,
            sink: options.sink,
            agentId: options.agentId,
            visitorId: session.visitor.visitorId,
            summaryStore: store,
            summarizer,
            trace: options.trace,
            ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
          });
        } catch {
          // Background compaction must never surface as an unhandled rejection.
        }
      });
      dependencies.onBackgroundTask?.(task);
    }
  };
}

async function acquireTurnAssets(source: ReferenceAgentAssetSource): Promise<StageToolAssets> {
  const documents = typeof source === "function" ? await source() : source;
  return createStageToolAssetSnapshot(documents);
}

function logStopSummary(summary: ReferenceAgentLoopSummary): void {
  if (summary.stopReason === "provider_stop") return;
  if (summary.stopReason === "unresolved_buffer" && summary.unresolved !== undefined) {
    console.error(
      "[facet-reference-agent] unresolved buffered edits:",
      `${String(summary.unresolved.length)} unresolved edit(s)`,
    );
    return;
  }
  console.error("[facet-reference-agent] turn stopped:", stopReasonMessage(summary.stopReason));
}

function stopReasonMessage(stopReason: ReferenceAgentStopReason): string {
  return stopReason;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
