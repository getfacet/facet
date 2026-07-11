import { EMPTY_TREE, type ClientEvent, type FacetSession } from "@facet/core";
import type { Sink, StoredEvent, SummaryStore } from "@facet/runtime";

import type { ProviderTurn, TurnMessage } from "../provider.js";
import { buildInitialMessages, describeEvent, formatCurrentStageForPrompt } from "../prompt.js";
import type { ReferenceAgentBudget, ReferenceAgentStopReason } from "./budget.js";
import { compactHistoryMessages, estimateMessagesChars } from "./compaction.js";
import { estimateProviderTurnChars } from "./estimate.js";
import { summaryBlockMessage, vetStoredSummary } from "./summary.js";

export type ReferenceAgentContextStageMode = "json" | "summary";

/** Why a persisted summary was NOT injected on a turn that had a store. */
export type ReferenceAgentSummaryDiscardReason = "mismatch" | "invalid" | "store_error" | "budget";

export interface AssembleProviderContextOptions {
  readonly system: string;
  readonly event: ClientEvent;
  readonly session: FacetSession;
  readonly sink: Sink;
  readonly agentId: string;
  readonly budget: ReferenceAgentBudget;
  /**
   * Optional rolling-summary source. When present, a valid + consistent summary
   * is injected ONCE at the head of the history layer and only post-`coveredThrough`
   * turns replay verbatim. Absent ⇒ exactly the no-summary behavior. Only `get`
   * is used; a read failure is caught and assembly proceeds without a summary.
   */
  readonly summaryStore?: Pick<SummaryStore, "get">;
}

export interface ReferenceAgentContextStats {
  readonly estimatedContextChars: number;
  readonly historyChars: number;
  readonly historyCompacted: boolean;
  readonly droppedHistoryTurns: number;
  readonly omittedHistoryChars: number;
  readonly stageMode: ReferenceAgentContextStageMode;
  readonly messageCount: number;
  /** True only when a valid, consistent summary was injected into the history layer. */
  readonly summaryInjected: boolean;
  /** Generation of the injected summary (present only when injected). */
  readonly summaryGeneration?: number;
  /** Prior-turn count the injected summary folds in (present only when injected). */
  readonly summaryCoveredThrough?: number;
  /** Why a stored summary was skipped (present only when a store existed but nothing was injected). */
  readonly summaryDiscarded?: ReferenceAgentSummaryDiscardReason;
}

export type ReferenceAgentContextResult =
  | {
      readonly status: "ready";
      readonly turn: ProviderTurn;
      readonly stats: ReferenceAgentContextStats;
    }
  | {
      readonly status: "context_limit";
      readonly stopReason: Extract<ReferenceAgentStopReason, "context_limit">;
      readonly estimatedContextChars: number;
      readonly maxContextChars: number;
      readonly stats: ReferenceAgentContextStats;
    }
  | {
      readonly status: "sink_error";
      readonly stopReason: Extract<ReferenceAgentStopReason, "sink_error">;
      readonly error: unknown;
    };

interface ContextCandidate {
  readonly turn: ProviderTurn;
  readonly stats: ReferenceAgentContextStats;
}

/** The subset of stats describing the summary-injection decision for a turn. */
interface SummaryDecisionStats {
  readonly summaryInjected: boolean;
  readonly summaryGeneration?: number;
  readonly summaryCoveredThrough?: number;
  readonly summaryDiscarded?: ReferenceAgentSummaryDiscardReason;
}

/** Resolved summary state: the block to inject (if any) plus how many turns it covers. */
interface ResolvedSummary {
  /** The user-role summary block to inject at the head of the history layer. */
  readonly block?: TurnMessage;
  /** History entries to skip before verbatim replay (0 when nothing is injected). */
  readonly coveredThrough: number;
  readonly stats: SummaryDecisionStats;
}

export async function assembleProviderContext(
  options: AssembleProviderContextOptions,
): Promise<ReferenceAgentContextResult> {
  let history: Awaited<ReturnType<Sink["history"]>>;
  try {
    history = await options.sink.history(options.agentId, options.session.visitor.visitorId);
  } catch (error) {
    return { status: "sink_error", stopReason: "sink_error", error };
  }

  const summary = await resolveSummary(options, history);
  const verbatimHistory =
    summary.block !== undefined ? history.slice(summary.coveredThrough) : history;

  const historyMessages = renderHistoryMessages(
    options.event,
    options.session,
    verbatimHistory,
    options.budget,
  );
  const fullStage = formatCurrentStageForPrompt(options.session.stage, {
    maxJsonChars: options.budget.maxStageJsonChars,
    maxSummaryNodes: options.budget.maxStageSummaryNodes,
  });
  const fullStageMode = stageModeOf(fullStage);
  const fullCandidate = buildCandidate(
    options,
    historyMessages,
    fullStage,
    fullStageMode,
    summary.block,
    summary.stats,
  );
  if (fullStageMode === "json" && fitsContext(fullCandidate, options.budget)) {
    return readyResult(fullCandidate);
  }

  if (fullStageMode === "summary") {
    return resultForCandidate(fullCandidate, options.budget);
  }

  const summaryStage = formatCurrentStageForPrompt(options.session.stage, {
    maxJsonChars: 0,
    maxSummaryNodes: options.budget.maxStageSummaryNodes,
  });
  return resultForCandidate(
    buildCandidate(options, historyMessages, summaryStage, "summary", summary.block, summary.stats),
    options.budget,
  );
}

/**
 * Load and vet a persisted rolling summary through the shared `vetStoredSummary`,
 * so the reader applies the SAME consistency checks as the writer — including the
 * conversation-anchor match that catches a durable store re-injecting a wiped
 * sink's OLD summary once the new history regrows past the stale marker. A read
 * failure, invalid payload, or anchor/counter mismatch all resolve to "no
 * injection" with a recorded reason. NEVER throws.
 */
async function resolveSummary(
  options: AssembleProviderContextOptions,
  history: readonly StoredEvent[],
): Promise<ResolvedSummary> {
  const store = options.summaryStore;
  if (store === undefined) return { coveredThrough: 0, stats: { summaryInjected: false } };

  let stored;
  try {
    stored = await store.get(options.agentId, options.session.visitor.visitorId);
  } catch {
    return {
      coveredThrough: 0,
      stats: { summaryInjected: false, summaryDiscarded: "store_error" },
    };
  }

  const vetted = vetStoredSummary(stored, history);
  switch (vetted.status) {
    case "none":
      return { coveredThrough: 0, stats: { summaryInjected: false } };
    case "invalid":
      return { coveredThrough: 0, stats: { summaryInjected: false, summaryDiscarded: "invalid" } };
    case "mismatch":
      return { coveredThrough: 0, stats: { summaryInjected: false, summaryDiscarded: "mismatch" } };
    case "ok":
      return {
        block: summaryBlockMessage(vetted.summary, vetted.generation, vetted.coveredThrough),
        coveredThrough: vetted.coveredThrough,
        stats: {
          summaryInjected: true,
          summaryGeneration: vetted.generation,
          summaryCoveredThrough: vetted.coveredThrough,
        },
      };
  }
}

function renderHistoryMessages(
  event: ClientEvent,
  session: FacetSession,
  history: Awaited<ReturnType<Sink["history"]>>,
  budget: ReferenceAgentBudget,
): {
  readonly messages: readonly TurnMessage[];
  readonly droppedTurnCount: number;
} {
  const limit = budget.maxHistoryTurns;
  const historySession = { ...session, stage: EMPTY_TREE };
  const initialMessages = buildInitialMessages(event, historySession, history, limit);
  const verbatim = initialMessages.slice(0, -1);
  return {
    messages: verbatim,
    droppedTurnCount: Math.max(0, history.length - limit),
  };
}

function buildCandidate(
  options: AssembleProviderContextOptions,
  history: {
    readonly messages: readonly TurnMessage[];
    readonly droppedTurnCount: number;
  },
  stagePrompt: string,
  stageMode: ReferenceAgentContextStageMode,
  summaryBlock: TurnMessage | undefined,
  summaryStats: SummaryDecisionStats,
): ContextCandidate {
  const finalMessage: TurnMessage = {
    role: "user",
    content: `${describeEvent(options.event)}\n\n${stagePrompt}`,
  };
  const baseChars = estimateProviderTurnChars(options.system, [finalMessage]);
  const availableHistoryChars = Math.min(
    options.budget.maxHistoryChars,
    Math.max(0, options.budget.maxContextChars - baseChars),
  );

  // Pin the summary block: reserve its chars up front and compact ONLY the
  // verbatim tail, so char pressure drops/truncates recent turns instead of the
  // block that stands in for every covered turn. If the block alone can't fit
  // the history budget, omit it (recorded as a `"budget"` discard) rather than
  // sending a partial or misleading `summaryInjected` stat.
  const blockChars = summaryBlock !== undefined ? estimateMessagesChars([summaryBlock]) : 0;
  const pinBlock = summaryBlock !== undefined && blockChars <= availableHistoryChars;
  const effectiveStats: SummaryDecisionStats =
    summaryBlock !== undefined && !pinBlock
      ? { summaryInjected: false, summaryDiscarded: "budget" }
      : summaryStats;

  // When the summary block is dropped for budget, the turns it covered were
  // already sliced off the verbatim tail — so fold their count into the
  // compaction note's `droppedTurnCount` instead of letting them vanish
  // silently and understate what the model no longer sees.
  const droppedForCoveredTurns =
    summaryBlock !== undefined && !pinBlock ? (summaryStats.summaryCoveredThrough ?? 0) : 0;

  const compactedHistory = compactHistoryMessages(history.messages, {
    maxChars: pinBlock ? availableHistoryChars - blockChars : availableHistoryChars,
    droppedTurnCount: history.droppedTurnCount + droppedForCoveredTurns,
  });
  const historyMessages = pinBlock
    ? [summaryBlock, ...compactedHistory.messages]
    : compactedHistory.messages;
  const messages = [...historyMessages, finalMessage];
  const estimatedContextChars = estimateProviderTurnChars(options.system, messages);

  return {
    turn: {
      system: options.system,
      messages,
    },
    stats: {
      estimatedContextChars,
      historyChars: compactedHistory.charCount + (pinBlock ? blockChars : 0),
      historyCompacted: compactedHistory.compacted,
      droppedHistoryTurns: compactedHistory.droppedTurnCount,
      omittedHistoryChars: compactedHistory.omittedCharCount,
      stageMode,
      messageCount: messages.length,
      ...effectiveStats,
    },
  };
}

function resultForCandidate(
  candidate: ContextCandidate,
  budget: ReferenceAgentBudget,
): ReferenceAgentContextResult {
  if (fitsContext(candidate, budget)) return readyResult(candidate);
  return {
    status: "context_limit",
    stopReason: "context_limit",
    estimatedContextChars: candidate.stats.estimatedContextChars,
    maxContextChars: budget.maxContextChars,
    stats: candidate.stats,
  };
}

function readyResult(candidate: ContextCandidate): ReferenceAgentContextResult {
  return {
    status: "ready",
    turn: candidate.turn,
    stats: candidate.stats,
  };
}

function fitsContext(candidate: ContextCandidate, budget: ReferenceAgentBudget): boolean {
  return candidate.stats.estimatedContextChars <= budget.maxContextChars;
}

function stageModeOf(stagePrompt: string): ReferenceAgentContextStageMode {
  return stagePrompt.startsWith("CURRENT STAGE: ") ? "json" : "summary";
}
