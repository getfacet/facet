import type { AgentEvent, ConversationMessage, FacetToolSession } from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";

import type { ProviderTurn, TurnMessage } from "../provider.js";
import { buildInitialMessages, formatCurrentStageForPrompt } from "../prompt.js";
import {
  effectiveCharBudget,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import { compactHistoryMessages, estimateMessagesChars } from "./compaction.js";
import { measureChars } from "./measure.js";
import { summaryBlockMessage, vetStoredSummary } from "./summary.js";
import { conversationHistoryToMessages } from "./transcript.js";

export type ReferenceAgentContextStageMode = "markup" | "summary";

/** Why a persisted summary was NOT injected on a turn that had a store. */
export type ReferenceAgentSummaryDiscardReason = "mismatch" | "invalid" | "store_error" | "budget";

export interface AssembleProviderContextOptions {
  readonly system: string;
  readonly event: AgentEvent;
  readonly session: FacetToolSession;
  readonly sink: Pick<Sink, "history">;
  readonly historyKey: string;
  readonly budget: ReferenceAgentBudget;
  readonly summaryStore?: Pick<SummaryStore, "read">;
  readonly summaryKey?: string;
  readonly contextWindowChars?: number;
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
  /** Prior conversation records the injected summary folds in (present only when injected). */
  readonly summaryCoveredThrough?: number;
  /** Why a stored summary was skipped (present only when a store existed but nothing was injected). */
  readonly summaryDiscarded?: ReferenceAgentSummaryDiscardReason;
  /** Redelivered conversation messages collapsed by stable messageId. */
  readonly duplicateHistoryMessages: number;
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

/** Resolved summary state: the block to inject (if any) plus how many records it covers. */
interface ResolvedSummary {
  /** The user-role summary block to inject at the head of the history layer. */
  readonly block?: TurnMessage;
  /** Conversation records to skip before verbatim replay (0 when nothing is injected). */
  readonly replayFrom: number;
  readonly stats: SummaryDecisionStats;
}

export async function assembleProviderContext(
  options: AssembleProviderContextOptions,
): Promise<ReferenceAgentContextResult> {
  let history: readonly ConversationMessage[];
  try {
    history = await options.sink.history(
      options.historyKey,
      historyReadLimit(options.budget.maxHistoryTurns),
    );
  } catch (error) {
    return { status: "sink_error", stopReason: "sink_error", error };
  }

  const transcript = conversationHistoryToMessages(history, options.budget.maxHistoryTurns);
  const summary = await resolveSummary(options, transcript.records);
  const verbatimHistory =
    summary.block === undefined
      ? transcript.messages
      : transcript.messages.slice(summary.replayFrom);

  const contextLimit = effectiveCharBudget(options.budget, options.contextWindowChars);
  const fullFinalMessage = finalPromptMessage(options, {
    maxMarkupChars: options.budget.maxStageJsonChars,
    maxSummaryNodes: options.budget.maxStageSummaryNodes,
  });
  const fullCandidate = buildCandidate(
    options,
    verbatimHistory,
    transcript.droppedTurnCount,
    transcript.duplicateMessageCount,
    fullFinalMessage,
    stageModeOf(fullFinalMessage),
    summary.block,
    summary.stats,
    contextLimit,
  );
  if (fullCandidate.stats.stageMode === "markup" && fitsContext(fullCandidate, contextLimit)) {
    return readyResult(fullCandidate);
  }

  if (fullCandidate.stats.stageMode === "summary") {
    return resultForCandidate(fullCandidate, contextLimit);
  }

  const summaryFinalMessage = finalPromptMessage(options, {
    maxMarkupChars: 0,
    maxSummaryNodes: options.budget.maxStageSummaryNodes,
  });
  return resultForCandidate(
    buildCandidate(
      options,
      verbatimHistory,
      transcript.droppedTurnCount,
      transcript.duplicateMessageCount,
      summaryFinalMessage,
      "summary",
      summary.block,
      summary.stats,
      contextLimit,
    ),
    contextLimit,
  );
}

async function resolveSummary(
  options: AssembleProviderContextOptions,
  history: readonly ConversationMessage[],
): Promise<ResolvedSummary> {
  const store = options.summaryStore;
  if (store === undefined) return { replayFrom: 0, stats: { summaryInjected: false } };

  let stored: unknown;
  try {
    stored = await store.read(options.summaryKey ?? options.historyKey);
  } catch {
    return {
      replayFrom: 0,
      stats: { summaryInjected: false, summaryDiscarded: "store_error" },
    };
  }

  const vetted = vetStoredSummary(stored, history);
  switch (vetted.status) {
    case "none":
      return { replayFrom: 0, stats: { summaryInjected: false } };
    case "invalid":
      return { replayFrom: 0, stats: { summaryInjected: false, summaryDiscarded: "invalid" } };
    case "mismatch":
      return { replayFrom: 0, stats: { summaryInjected: false, summaryDiscarded: "mismatch" } };
    case "ok":
      return {
        block: summaryBlockMessage(vetted.summary, vetted.generation, vetted.coveredThrough),
        replayFrom: vetted.replayFrom,
        stats: {
          summaryInjected: true,
          summaryGeneration: vetted.generation,
          summaryCoveredThrough: vetted.coveredThrough,
        },
      };
  }
}

function buildCandidate(
  options: AssembleProviderContextOptions,
  historyMessages: readonly TurnMessage[],
  droppedHistoryTurns: number,
  duplicateHistoryMessages: number,
  finalMessage: TurnMessage,
  stageMode: ReferenceAgentContextStageMode,
  summaryBlock: TurnMessage | undefined,
  summaryStats: SummaryDecisionStats,
  contextLimit: number,
): ContextCandidate {
  const baseChars = measureTurnChars(options.system, [finalMessage]);
  const availableHistoryChars = Math.min(
    options.budget.maxHistoryChars,
    Math.max(0, contextLimit - baseChars),
  );

  const blockChars = summaryBlock === undefined ? 0 : estimateMessagesChars([summaryBlock]);
  const pinBlock = summaryBlock !== undefined && blockChars <= availableHistoryChars;
  const effectiveStats: SummaryDecisionStats =
    summaryBlock !== undefined && !pinBlock
      ? { summaryInjected: false, summaryDiscarded: "budget" }
      : summaryStats;
  const droppedForCoveredRecords =
    summaryBlock !== undefined && !pinBlock ? (summaryStats.summaryCoveredThrough ?? 0) : 0;

  const compactedHistory = compactHistoryMessages(historyMessages, {
    maxChars: pinBlock ? availableHistoryChars - blockChars : availableHistoryChars,
    droppedTurnCount: droppedHistoryTurns + droppedForCoveredRecords,
  });
  const messages = [
    ...(pinBlock ? [summaryBlock] : []),
    ...compactedHistory.messages,
    finalMessage,
  ];
  const estimatedContextChars = measureTurnChars(options.system, messages);

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
      duplicateHistoryMessages,
      ...effectiveStats,
    },
  };
}

function resultForCandidate(
  candidate: ContextCandidate,
  maxContextChars: number,
): ReferenceAgentContextResult {
  if (fitsContext(candidate, maxContextChars)) return readyResult(candidate);
  return {
    status: "context_limit",
    stopReason: "context_limit",
    estimatedContextChars: candidate.stats.estimatedContextChars,
    maxContextChars,
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

function fitsContext(candidate: ContextCandidate, maxContextChars: number): boolean {
  return candidate.stats.estimatedContextChars <= maxContextChars;
}

function finalPromptMessage(
  options: AssembleProviderContextOptions,
  stageOptions: {
    readonly maxMarkupChars: number;
    readonly maxSummaryNodes: number;
  },
): TurnMessage {
  return (
    buildInitialMessages(options.event, options.session, [], 0, stageOptions).at(-1) ?? {
      role: "user",
      content: formatCurrentStageForPrompt(options.session, stageOptions),
    }
  );
}

function stageModeOf(message: TurnMessage): ReferenceAgentContextStageMode {
  const content = "content" in message ? message.content : "";
  if (
    content.includes("currentScreenMarkup:\n") &&
    !content.includes("currentScreenMarkup:\n(omitted by character limit)")
  ) {
    return "markup";
  }
  return "summary";
}

function measureTurnChars(system: string, messages: readonly TurnMessage[]): number {
  return measureChars({ system, messages });
}

function historyReadLimit(maxHistoryTurns: number): number {
  if (!Number.isSafeInteger(maxHistoryTurns) || maxHistoryTurns <= 0) return 0;
  return maxHistoryTurns * 2;
}
