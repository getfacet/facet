import { EMPTY_TREE, type ClientEvent, type FacetSession } from "@facet/core";
import type { Sink } from "@facet/runtime";

import type { ProviderTurn, TurnMessage } from "../provider.js";
import { buildInitialMessages, describeEvent, formatCurrentStageForPrompt } from "../prompt.js";
import type { ReferenceAgentBudget, ReferenceAgentStopReason } from "./budget.js";
import { compactHistoryMessages, estimateMessagesChars } from "./compaction.js";

export type ReferenceAgentContextStageMode = "json" | "summary";

export interface AssembleProviderContextOptions {
  readonly system: string;
  readonly event: ClientEvent;
  readonly session: FacetSession;
  readonly sink: Sink;
  readonly agentId: string;
  readonly budget: ReferenceAgentBudget;
}

export interface ReferenceAgentContextStats {
  readonly estimatedContextChars: number;
  readonly historyChars: number;
  readonly historyCompacted: boolean;
  readonly droppedHistoryTurns: number;
  readonly omittedHistoryChars: number;
  readonly stageMode: ReferenceAgentContextStageMode;
  readonly messageCount: number;
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

export async function assembleProviderContext(
  options: AssembleProviderContextOptions,
): Promise<ReferenceAgentContextResult> {
  let history;
  try {
    history = await options.sink.history(options.agentId, options.session.visitor.visitorId);
  } catch (error) {
    return { status: "sink_error", stopReason: "sink_error", error };
  }

  const historyMessages = renderHistoryMessages(
    options.event,
    options.session,
    history,
    options.budget,
  );
  const fullStage = formatCurrentStageForPrompt(options.session.stage, {
    maxJsonChars: options.budget.maxStageJsonChars,
    maxSummaryNodes: options.budget.maxStageSummaryNodes,
  });
  const fullStageMode = stageModeOf(fullStage);
  const fullCandidate = buildCandidate(options, historyMessages, fullStage, fullStageMode);
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
    buildCandidate(options, historyMessages, summaryStage, "summary"),
    options.budget,
  );
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
  return {
    messages: initialMessages.slice(0, -1),
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
  const compactedHistory = compactHistoryMessages(history.messages, {
    maxChars: availableHistoryChars,
    droppedTurnCount: history.droppedTurnCount,
  });
  const messages = [...compactedHistory.messages, finalMessage];
  const estimatedContextChars = estimateProviderTurnChars(options.system, messages);

  return {
    turn: {
      system: options.system,
      messages,
    },
    stats: {
      estimatedContextChars,
      historyChars: compactedHistory.charCount,
      historyCompacted: compactedHistory.compacted,
      droppedHistoryTurns: compactedHistory.droppedTurnCount,
      omittedHistoryChars: compactedHistory.omittedCharCount,
      stageMode,
      messageCount: messages.length,
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

function estimateProviderTurnChars(system: string, messages: readonly TurnMessage[]): number {
  return `system: ${system}\n`.length + estimateMessagesChars(messages);
}

function stageModeOf(stagePrompt: string): ReferenceAgentContextStageMode {
  return stagePrompt.startsWith("CURRENT STAGE: ") ? "json" : "summary";
}
