import type { InProcessFacetAgent } from "@facet/agent";
import type { FacetToolSession } from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";

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
  REFERENCE_AGENT_FALLBACK_TEXT,
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
 * The factory owns deployer-facing configuration: page brief, compatibility
 * budget aliases, explicit budget overrides, and optional tracing. Turn
 * execution lives in the harness loop, while the runtime owns conversation
 * framing and persistence.
 */
export interface ReferenceAgentOptions {
  readonly provider: ReferenceProvider;
  /** Deployer's page brief. Defaults to the built-in DEFAULT_GUIDE. */
  readonly guide?: string;
  /** Conversation history source for summary maintenance (shared with the runtime). */
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
   * Rolling-summary store. When present, cross-turn context compaction is enabled
   * if the host session exposes a stable conversation key.
   */
  readonly summaryStore?: SummaryStore;
}

/** Internal dependency seam used by package-local tests; not exported from the package root. */
export interface ReferenceAgentDependencies {
  readonly summarizerFactory?: (provider: ReferenceProvider) => Summarizer;
  readonly onBackgroundTask?: (task: Promise<void>) => void;
}

export function createReferenceAgent(options: ReferenceAgentOptions): InProcessFacetAgent {
  return createReferenceAgentWithDependencies(options);
}

/** Internal factory used to exercise detached compaction deterministically in tests. */
export function createReferenceAgentWithDependencies(
  options: ReferenceAgentOptions,
  dependencies: ReferenceAgentDependencies = {},
): InProcessFacetAgent {
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
  const contextWindowChars = providerContextWindowChars(options.provider);
  const diagnostics = createReferenceAgentDiagnosticEmitter(options.diagnosticObserver);

  return Object.freeze({
    async run(context: Parameters<InProcessFacetAgent["run"]>[0]) {
      const { event, session } = context;
      if (isSignalAborted(options.abortSignal)) {
        diagnostics({ kind: "stop", reason: "aborted" });
        return { text: null };
      }

      let turnSystem: string | undefined;
      let finalText: string | null = null;
      try {
        turnSystem = buildSystem(options.guide ?? DEFAULT_GUIDE);
        const historyKey = historyKeyFromSession(options.agentId, session);
        const iterator = runReferenceAgentLoop({
          provider: options.provider,
          system: turnSystem,
          event,
          session,
          budget,
          ...(historyKey === undefined
            ? {}
            : {
                sink: options.sink,
                historyKey,
                ...(options.summaryStore === undefined
                  ? {}
                  : { summaryStore: options.summaryStore }),
                ...(contextWindowChars === undefined ? {} : { contextWindowChars }),
              }),
          ...(options.trace !== undefined ? { trace: options.trace } : {}),
          ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
          diagnostics,
          now: Date.now,
        });
        while (true) {
          const next = await iterator.next();
          if (next.done) {
            logStopSummary(next.value);
            break;
          }
          finalText = finalConversationText(next.value) ?? finalText;
        }
      } catch (error) {
        console.error("[facet-reference-agent] turn failed:", errMsg(error));
        diagnostics({
          kind: "stop",
          reason: isSignalAborted(options.abortSignal) ? "aborted" : "invalid-output",
        });
        finalText = isSignalAborted(options.abortSignal) ? null : REFERENCE_AGENT_FALLBACK_TEXT;
      }

      maybeStartBackgroundCompaction({
        options,
        dependencies,
        summarizer,
        turnSystem,
        event,
        session,
        contextWindowChars,
      });

      return { text: finalText };
    },
  });
}

function maybeStartBackgroundCompaction(input: {
  readonly options: ReferenceAgentOptions;
  readonly dependencies: ReferenceAgentDependencies;
  readonly summarizer: Summarizer | undefined;
  readonly turnSystem: string | undefined;
  readonly event: Parameters<InProcessFacetAgent["run"]>[0]["event"];
  readonly session: FacetToolSession;
  readonly contextWindowChars: number | undefined;
}): void {
  const { options, dependencies, summarizer, turnSystem, event, session, contextWindowChars } =
    input;
  const historyKey = historyKeyFromSession(options.agentId, session);
  const summaryStore = options.summaryStore;
  if (
    summaryStore === undefined ||
    summarizer === undefined ||
    turnSystem === undefined ||
    historyKey === undefined ||
    isSignalAborted(options.abortSignal)
  ) {
    return;
  }

  const task = enqueueBackgroundCompaction(historyKey, async () => {
    try {
      await runBackgroundCompaction({
        system: turnSystem,
        budget: normalizeBudget({
          ...(options.budgetPreset !== undefined ? { budgetPreset: options.budgetPreset } : {}),
          ...(options.budget !== undefined ? { budget: options.budget } : {}),
          ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
          ...(options.historyTurns !== undefined ? { historyTurns: options.historyTurns } : {}),
        }),
        event,
        session,
        sink: options.sink,
        historyKey,
        summaryStore,
        summarizer,
        ...(options.trace !== undefined ? { trace: options.trace } : {}),
        ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
        ...(contextWindowChars !== undefined ? { contextWindowChars } : {}),
      });
    } catch {
      // Background compaction must never surface as an unhandled rejection.
    }
  });
  dependencies.onBackgroundTask?.(task);
}

function finalConversationText(
  fragments: readonly { readonly conversation?: { readonly text: string } }[],
): string | undefined {
  for (let index = fragments.length - 1; index >= 0; index -= 1) {
    const text = fragments[index]?.conversation?.text;
    if (text !== undefined) return text;
  }
  return undefined;
}

function historyKeyFromSession(agentId: string, session: FacetToolSession): string | undefined {
  if (!isRecord(session)) return undefined;
  const direct = session["sessionKey"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const visitor = session["visitor"];
  if (isRecord(visitor)) {
    const visitorId = visitor["visitorId"];
    if (typeof visitorId === "string" && visitorId.length > 0) {
      return `${agentId}:${visitorId}`;
    }
  }
  return undefined;
}

function providerContextWindowChars(provider: ReferenceProvider): number | undefined {
  const tokens = provider.contextWindowTokens;
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) return undefined;
  return Math.floor(tokens * 4);
}

function logStopSummary(summary: ReferenceAgentLoopSummary): void {
  if (summary.stopReason === "provider_stop") return;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
