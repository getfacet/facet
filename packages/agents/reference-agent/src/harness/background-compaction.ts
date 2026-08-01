import type { VisitorEvent, ConversationMessage, FacetToolSession } from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";

import { redactSensitiveText } from "../prompt/messages.js";
import type { TurnMessage } from "../provider.js";
import { effectiveCharBudget, type ReferenceAgentBudget } from "./budget.js";
import { truncateWithMarker } from "./compaction.js";
import { measureChars } from "./measure.js";
import {
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
const BACKGROUND_HISTORY_READ_LIMIT = 10_000;

/** Background compaction is serialized per conversation key while different conversations run concurrently. */
const compactionLanes = new Map<string, Promise<void>>();
const minGainCooldown = new Map<string, number>();

export function enqueueBackgroundCompaction(key: string, task: () => Promise<void>): Promise<void> {
  const previous = compactionLanes.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  compactionLanes.set(key, next);
  void next.finally(() => {
    if (compactionLanes.get(key) === next) compactionLanes.delete(key);
  });
  return next;
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
  compactionLanes.clear();
  minGainCooldown.clear();
}

interface ProjectedSummary {
  readonly summary: ConversationSummary;
  readonly generation: number;
  readonly coveredThrough: number;
}

export interface BackgroundCompactionOptions {
  readonly system: string;
  readonly budget: ReferenceAgentBudget;
  readonly event: VisitorEvent;
  readonly session: FacetToolSession;
  readonly sink: Pick<Sink, "history">;
  readonly historyKey?: string | undefined;
  readonly summaryStore: SummaryStore;
  readonly summaryKey?: string | undefined;
  readonly summarizer: Summarizer;
  readonly trace?: ReferenceAgentTrace | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly contextWindowChars?: number | undefined;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function resolveHistoryKey(options: BackgroundCompactionOptions): string | undefined {
  if (options.historyKey !== undefined && options.historyKey.length > 0) return options.historyKey;
  return undefined;
}

/**
 * Roll the persisted rolling summary forward for one conversation. Every failure
 * path degrades to a `compaction_failed` trace and returns; nothing here throws,
 * writes the stage, or blocks the turn (which already returned).
 */
export async function runBackgroundCompaction(options: BackgroundCompactionOptions): Promise<void> {
  const { trace, budget } = options;
  if (isAborted(options.abortSignal)) return;

  const historyKey = resolveHistoryKey(options);
  if (historyKey === undefined) {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "sink_error",
    });
    return;
  }

  let history: readonly ConversationMessage[];
  try {
    history = await options.sink.history(historyKey, BACKGROUND_HISTORY_READ_LIMIT);
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "sink_error",
    });
    return;
  }
  if (isAborted(options.abortSignal) || history.length === 0) return;

  const key = options.summaryKey ?? historyKey;
  let previous: ConversationSummary | undefined;
  let previousCovered = 0;
  let previousGeneration = 0;
  let stored: unknown;
  try {
    stored = await options.summaryStore.read(key);
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "store_error",
    });
    return;
  }
  if (isAborted(options.abortSignal)) return;

  const vetted = vetStoredSummary(stored, history);
  if (vetted.status === "ok") {
    previous = vetted.summary;
    previousCovered = vetted.coveredThrough;
    previousGeneration = vetted.generation;
  }

  if (isWithinMinGainCooldown(key, history.length, budget.compactionCooldownSteps)) return;

  const budgetChars = effectiveCharBudget(budget, options.contextWindowChars);
  const priorProjection: ProjectedSummary | undefined =
    previous !== undefined
      ? { summary: previous, generation: previousGeneration, coveredThrough: previousCovered }
      : undefined;
  const beforeMessages = projectTurnMessages(
    priorProjection,
    priorProjection !== undefined ? history.slice(previousCovered) : history,
  );
  const beforeChars = measureChars({ system: options.system, messages: beforeMessages });
  if (beforeChars <= budget.compactionTriggerRatio * budgetChars) return;

  const window = summaryWindow(history, previousCovered, budget.minRecentTurnsVerbatim);
  const rendered = renderSummaryWindow(window.records, budget.maxSummarizerInputChars);
  if (rendered.recordCount === 0 || rendered.content.length === 0) return;

  const coveredThrough = previousCovered + rendered.recordCount;
  const generation = previousGeneration + 1;

  emitReferenceAgentTrace(trace, {
    type: "compaction_triggered",
    site: "cross_turn",
    estimatedChars: beforeChars,
    budgetChars,
  });

  let summary: ConversationSummary | undefined;
  try {
    summary = await options.summarizer({
      kind: "history",
      ...(previous !== undefined ? { previous } : {}),
      content: rendered.content,
      generation,
      maxSummaryChars: summaryCharBudget(budget.maxSummaryChars),
      timeoutMs: budget.summarizerTimeoutMs,
      retries: budget.summarizerRetries,
      ...(options.abortSignal !== undefined ? { signal: options.abortSignal } : {}),
    });
  } catch {
    summary = undefined;
  }
  if (isAborted(options.abortSignal)) return;
  if (summary === undefined) {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "summarizer_failed",
    });
    return;
  }

  const block = summaryBlockMessage(summary, generation, coveredThrough);
  const previousBlockChars =
    previous !== undefined
      ? turnMessageChars(summaryBlockMessage(previous, previousGeneration, previousCovered))
      : 0;
  const replacedChars = previousBlockChars + rendered.content.length;
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

  if (isAborted(options.abortSignal)) return;
  let written: Awaited<ReturnType<SummaryStore["write"]>>;
  try {
    written = await options.summaryStore.write(key, {
      payload: summaryPayload(summary, history, coveredThrough),
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
  if (!written.ok) {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "store_error",
    });
    return;
  }
  clearMinGainCooldown(key);

  const afterMessages = projectTurnMessages(
    { summary, generation, coveredThrough },
    history.slice(coveredThrough),
  );
  const afterChars = measureChars({ system: options.system, messages: afterMessages });

  emitReferenceAgentTrace(trace, {
    type: "compaction_done",
    site: "cross_turn",
    generation,
    coveredThrough,
    beforeChars,
    afterChars,
  });
}

function projectTurnMessages(
  priorSummary: ProjectedSummary | undefined,
  tail: readonly ConversationMessage[],
): TurnMessage[] {
  const tailMessages = tail.map(conversationMessageToTurnMessage);
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
}

function summaryWindow(
  history: readonly ConversationMessage[],
  start: number,
  minRecentTurns: number,
): { readonly records: readonly ConversationMessage[] } {
  const startIndex = boundedHistoryIndex(start, history.length);
  const tail = history.slice(startIndex);
  const turnOrder = orderedTurnIds(tail);
  const retainedTurns = Math.max(0, Math.floor(minRecentTurns));
  const summarizedTurnCount = Math.max(0, turnOrder.length - retainedTurns);
  if (summarizedTurnCount === 0) return { records: [] };

  const summarizedTurnIds = new Set(turnOrder.slice(0, summarizedTurnCount));
  const records: ConversationMessage[] = [];
  for (const record of tail) {
    if (!summarizedTurnIds.has(record.turnId)) break;
    records.push(record);
  }
  return { records };
}

function renderSummaryWindow(
  records: readonly ConversationMessage[],
  maxChars: number,
): { readonly content: string; readonly recordCount: number } {
  const groups = contiguousTurnGroups(records);
  const lines: string[] = [];
  let contentChars = 0;
  let recordCount = 0;
  const limit = boundedSummaryInputChars(maxChars);

  for (const group of groups) {
    const groupLines = group.map(renderHistoryEntry);
    const groupContent = groupLines.join("\n");
    const separator = lines.length === 0 ? 0 : 1;
    const nextChars = contentChars + separator + groupContent.length;
    if (nextChars > limit) {
      if (lines.length === 0) {
        const truncated = truncateWithMarker(groupContent, limit).content;
        lines.push(truncated);
        recordCount += group.length;
      }
      break;
    }
    lines.push(...groupLines);
    contentChars = nextChars;
    recordCount += group.length;
  }

  return { content: lines.join("\n"), recordCount };
}

function contiguousTurnGroups(
  records: readonly ConversationMessage[],
): readonly (readonly ConversationMessage[])[] {
  const groups: ConversationMessage[][] = [];
  let currentTurnId: string | undefined;
  let current: ConversationMessage[] = [];
  for (const record of records) {
    if (currentTurnId === undefined || record.turnId === currentTurnId) {
      currentTurnId = record.turnId;
      current.push(record);
      continue;
    }
    groups.push(current);
    currentTurnId = record.turnId;
    current = [record];
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function orderedTurnIds(history: readonly ConversationMessage[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const record of history) {
    if (seen.has(record.turnId)) continue;
    seen.add(record.turnId);
    ordered.push(record.turnId);
  }
  return ordered;
}

function boundedHistoryIndex(index: number, length: number): number {
  if (!Number.isSafeInteger(index) || index <= 0) return 0;
  return Math.min(index, length);
}

function boundedSummaryInputChars(maxChars: number): number {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return 1;
  return Math.floor(maxChars);
}

function renderHistoryEntry(record: ConversationMessage): string {
  const role = record.role === "visitor" ? "Visitor" : "Assistant";
  return `${role} turn=${record.turnId} message=${record.messageId}: ${redactSensitiveText(
    record.text,
  )}`;
}

function conversationMessageToTurnMessage(record: ConversationMessage): TurnMessage {
  return {
    role: record.role === "visitor" ? "user" : "assistant",
    content: record.text,
  };
}

function turnMessageChars(message: TurnMessage): number {
  return "content" in message ? message.content.length : message.text.length;
}
