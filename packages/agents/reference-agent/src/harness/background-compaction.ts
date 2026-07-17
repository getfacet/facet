import { createSerialQueue } from "@facet/core";
import type { ClientEvent, FacetSession } from "@facet/core";
import { sessionKey, type Sink, type StoredEvent, type SummaryStore } from "@facet/runtime";

import { buildInitialMessages, renderHistoryEntry, TOOLS } from "../prompt.js";
import type { ReferenceProvider, TurnMessage } from "../provider.js";
import { effectiveTokenBudget, type ReferenceAgentBudget } from "./budget.js";
import { truncateWithMarker } from "./compaction.js";
import { createTokenEstimator, estimateTurnChars } from "./estimate.js";
import {
  conversationAnchor,
  summaryBlockMessage,
  summaryCharBudget,
  summaryPayload,
  vetStoredSummary,
  type ConversationSummary,
  type Summarizer,
} from "./summary.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

/** Fraction a new summary must shrink the text it replaces, else the write is skipped. */
const MIN_COMPACTION_GAIN_RATIO = 0.25;
const MAX_COOLDOWN_KEYS = 1024;

/** Background compaction is serialized per agent/visitor while different visitors run concurrently. */
const compactionLane = createSerialQueue<void>();
const minGainCooldown = new Map<string, number>();

export function enqueueBackgroundCompaction(key: string, task: () => Promise<void>): Promise<void> {
  return compactionLane(key, task);
}

function markMinGainSkip(key: string, historyLength: number): void {
  minGainCooldown.delete(key);
  if (minGainCooldown.size >= MAX_COOLDOWN_KEYS) {
    const oldest = minGainCooldown.keys().next().value;
    if (oldest !== undefined) minGainCooldown.delete(oldest);
  }
  minGainCooldown.set(key, historyLength);
}

function clearMinGainCooldown(key: string): void {
  minGainCooldown.delete(key);
}

function isWithinMinGainCooldown(
  key: string,
  historyLength: number,
  cooldownSteps: number,
): boolean {
  const marker = minGainCooldown.get(key);
  if (marker === undefined) return false;
  if (historyLength < marker) {
    minGainCooldown.delete(key);
    return false;
  }
  return historyLength - marker < cooldownSteps;
}

/** Internal test seam; this module is not exported from the package root. */
export function resetBackgroundCompactionForTests(): void {
  minGainCooldown.clear();
}

interface ProjectedSummary {
  readonly summary: ConversationSummary;
  readonly generation: number;
  readonly coveredThrough: number;
}

export interface BackgroundCompactionOptions {
  readonly provider: ReferenceProvider;
  readonly system: string;
  readonly budget: ReferenceAgentBudget;
  readonly event: ClientEvent;
  readonly session: FacetSession;
  readonly sink: Sink;
  readonly agentId: string;
  readonly visitorId: string;
  readonly summaryStore: SummaryStore;
  readonly summarizer: Summarizer;
  readonly trace: ReferenceAgentTrace | undefined;
  readonly contextWindowTokens?: number;
}

/**
 * Roll the persisted rolling summary forward for one conversation. Every failure
 * path degrades to a `compaction_failed` trace and returns; nothing here throws,
 * writes the stage, or blocks the turn (which already returned).
 */
export async function runBackgroundCompaction(options: BackgroundCompactionOptions): Promise<void> {
  const { trace, budget } = options;

  let history: readonly StoredEvent[];
  try {
    history = await options.sink.history(options.agentId, options.visitorId);
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "sink_error",
    });
    return;
  }

  const anchor = conversationAnchor(history);
  if (anchor === undefined) return;

  const key = sessionKey(options.agentId, options.visitorId);
  let previous: ConversationSummary | undefined;
  let previousCovered = 0;
  let previousGeneration = 0;
  let stored: Awaited<ReturnType<SummaryStore["get"]>>;
  try {
    stored = await options.summaryStore.get(options.agentId, options.visitorId);
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "store_error",
    });
    return;
  }
  const vetted = vetStoredSummary(stored, history);
  if (vetted.status === "ok") {
    previous = vetted.summary;
    previousCovered = vetted.coveredThrough;
    previousGeneration = vetted.generation;
  } else if (vetted.status === "invalid" || vetted.status === "mismatch") {
    try {
      await options.summaryStore.delete(options.agentId, options.visitorId);
    } catch {
      emitReferenceAgentTrace(trace, {
        type: "compaction_failed",
        site: "cross_turn",
        reason: "store_error",
      });
      return;
    }
  }

  if (isWithinMinGainCooldown(key, history.length, budget.compactionCooldownSteps)) return;

  const projectTurnMessages = (
    priorSummary: ProjectedSummary | undefined,
    tail: readonly StoredEvent[],
  ): TurnMessage[] => {
    const tailMessages = buildInitialMessages(
      options.event,
      options.session,
      tail,
      budget.maxHistoryTurns,
      { maxJsonChars: budget.maxStageJsonChars, maxSummaryNodes: budget.maxStageSummaryNodes },
    );
    return priorSummary === undefined
      ? tailMessages
      : [
          summaryBlockMessage(
            priorSummary.summary,
            priorSummary.generation,
            priorSummary.coveredThrough,
          ),
          ...tailMessages,
        ];
  };

  const estimator = createTokenEstimator();
  const budgetTokens = effectiveTokenBudget(budget, options.contextWindowTokens);
  const priorProjection: ProjectedSummary | undefined =
    previous !== undefined
      ? { summary: previous, generation: previousGeneration, coveredThrough: previousCovered }
      : undefined;
  const beforeMessages = projectTurnMessages(
    priorProjection,
    priorProjection !== undefined ? history.slice(previousCovered) : history,
  );
  const beforeTokens = estimator.estimateTokens(
    estimateTurnChars(options.system, beforeMessages, TOOLS),
  );
  if (beforeTokens <= budget.compactionTriggerRatio * budgetTokens) return;

  const fullEnd = history.length - budget.minRecentTurnsVerbatim;
  if (fullEnd <= previousCovered) return;

  const window = history.slice(previousCovered, fullEnd);
  const renderedLines: string[] = [];
  let contentChars = 0;
  for (const [index, entry] of window.entries()) {
    const line = truncateWithMarker(
      renderHistoryEntry(entry),
      budget.maxSummarizerInputChars,
    ).content;
    const separator = index === 0 ? 0 : 1;
    const nextChars = contentChars + separator + line.length;
    if (index > 0 && nextChars > budget.maxSummarizerInputChars) break;
    contentChars = nextChars;
    renderedLines.push(line);
  }

  const end = previousCovered + renderedLines.length;
  const generation = previousGeneration + 1;
  const content = renderedLines.join("\n");

  emitReferenceAgentTrace(trace, {
    type: "compaction_triggered",
    site: "cross_turn",
    estimatedTokens: beforeTokens,
    budgetTokens,
  });

  let summary: ConversationSummary | undefined;
  try {
    summary = await options.summarizer({
      kind: "history",
      ...(previous !== undefined ? { previous } : {}),
      content,
      generation,
      maxSummaryChars: summaryCharBudget(budget.maxSummaryTokens),
      timeoutMs: budget.summarizerTimeoutMs,
      retries: budget.summarizerRetries,
    });
  } catch {
    summary = undefined;
  }
  if (summary === undefined) {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "summarizer_failed",
    });
    return;
  }

  const coveredThrough = Math.min(end, history.length);
  const block = summaryBlockMessage(summary, generation, coveredThrough);
  const previousBlockChars =
    previous !== undefined
      ? turnMessageChars(summaryBlockMessage(previous, previousGeneration, previousCovered))
      : 0;
  const replacedChars = previousBlockChars + content.length;
  const gain = replacedChars > 0 ? (replacedChars - turnMessageChars(block)) / replacedChars : 0;
  if (gain < MIN_COMPACTION_GAIN_RATIO) {
    markMinGainSkip(key, history.length);
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "min_gain",
    });
    return;
  }

  let written: boolean;
  try {
    written = await options.summaryStore.put(options.agentId, options.visitorId, {
      payload: summaryPayload(summary, anchor),
      coveredThrough,
      generation,
    });
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "store_error",
    });
    return;
  }
  if (!written) {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "stale_write",
    });
    return;
  }
  clearMinGainCooldown(key);

  const afterMessages = projectTurnMessages(
    { summary, generation, coveredThrough },
    history.slice(coveredThrough),
  );
  const afterTokens = estimator.estimateTokens(
    estimateTurnChars(options.system, afterMessages, TOOLS),
  );

  emitReferenceAgentTrace(trace, {
    type: "compaction_done",
    site: "cross_turn",
    generation,
    coveredThrough,
    beforeTokens,
    afterTokens,
  });
}

function turnMessageChars(message: TurnMessage): number {
  return "content" in message ? message.content.length : message.text.length;
}
