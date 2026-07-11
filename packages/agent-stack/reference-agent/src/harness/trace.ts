import type { ReferenceAgentStopReason } from "./budget.js";

export const REFERENCE_AGENT_TRACE_EVENT_TYPES = [
  "turn_start",
  "context_compacted",
  "provider_attempt",
  "provider_retry",
  "provider_step",
  "tool_result",
  "batch_yield",
  "stop",
  "turn_error",
  "compaction_triggered",
  "compaction_done",
  "compaction_failed",
] as const;

export type ReferenceAgentTraceEventType = (typeof REFERENCE_AGENT_TRACE_EVENT_TYPES)[number];

export type ReferenceAgentTraceStageMode = "json" | "summary";

/** Which compaction surface emitted the event: the cross-turn background lane or in-turn folding. */
export type ReferenceAgentCompactionSite = "cross_turn" | "in_turn";

/** Why a compaction attempt did not persist a new summary. */
export type ReferenceAgentCompactionFailReason =
  "summarizer_failed" | "store_error" | "sink_error" | "min_gain" | "stale_write";

export interface ReferenceAgentTurnStartTraceEvent {
  readonly type: "turn_start";
  readonly eventKind: string;
  readonly historyTurns?: number;
}

export interface ReferenceAgentContextCompactedTraceEvent {
  readonly type: "context_compacted";
  readonly originalHistoryTurns: number;
  readonly includedHistoryTurns: number;
  readonly droppedHistoryTurns: number;
  readonly originalChars: number;
  readonly includedChars: number;
  readonly stageMode?: ReferenceAgentTraceStageMode;
  readonly stageNodeCount?: number;
}

export interface ReferenceAgentProviderAttemptTraceEvent {
  readonly type: "provider_attempt";
  readonly provider?: string;
  readonly model?: string;
  readonly attempt: number;
  readonly messageCount: number;
  readonly toolCount: number;
  readonly estimatedContextChars?: number;
}

export interface ReferenceAgentProviderRetryTraceEvent {
  readonly type: "provider_retry";
  readonly provider?: string;
  readonly model?: string;
  readonly attempt: number;
  readonly retryInMs: number;
  readonly reason: string;
  readonly httpStatus?: number;
}

export interface ReferenceAgentProviderStepTraceEvent {
  readonly type: "provider_step";
  readonly provider?: string;
  readonly model?: string;
  readonly step: number;
  readonly textChars: number;
  readonly toolCallCount: number;
  readonly toolNames: readonly string[];
}

export interface ReferenceAgentToolResultTraceEvent {
  readonly type: "tool_result";
  readonly toolName: string;
  readonly callId: string;
  readonly observationChars: number;
  readonly truncated: boolean;
  readonly omittedChars?: number;
}

export interface ReferenceAgentBatchYieldTraceEvent {
  readonly type: "batch_yield";
  readonly messageCount: number;
  readonly patchCount: number;
  readonly sayCount: number;
}

export interface ReferenceAgentStopTraceEvent {
  readonly type: "stop";
  readonly reason: ReferenceAgentStopReason;
  readonly stepCount: number;
  readonly toolCallCount: number;
  readonly finalTextChars?: number;
}

export interface ReferenceAgentTurnErrorTraceEvent {
  readonly type: "turn_error";
  readonly reason: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
}

export interface ReferenceAgentCompactionTriggeredTraceEvent {
  readonly type: "compaction_triggered";
  readonly site: ReferenceAgentCompactionSite;
  readonly estimatedTokens: number;
  readonly budgetTokens: number;
}

export interface ReferenceAgentCompactionDoneTraceEvent {
  readonly type: "compaction_done";
  readonly site: ReferenceAgentCompactionSite;
  readonly generation: number;
  readonly coveredThrough: number;
  readonly beforeTokens: number;
  readonly afterTokens: number;
}

export interface ReferenceAgentCompactionFailedTraceEvent {
  readonly type: "compaction_failed";
  readonly site: ReferenceAgentCompactionSite;
  readonly reason: ReferenceAgentCompactionFailReason;
}

export type ReferenceAgentTraceEvent =
  | ReferenceAgentTurnStartTraceEvent
  | ReferenceAgentContextCompactedTraceEvent
  | ReferenceAgentProviderAttemptTraceEvent
  | ReferenceAgentProviderRetryTraceEvent
  | ReferenceAgentProviderStepTraceEvent
  | ReferenceAgentToolResultTraceEvent
  | ReferenceAgentBatchYieldTraceEvent
  | ReferenceAgentStopTraceEvent
  | ReferenceAgentTurnErrorTraceEvent
  | ReferenceAgentCompactionTriggeredTraceEvent
  | ReferenceAgentCompactionDoneTraceEvent
  | ReferenceAgentCompactionFailedTraceEvent;

export type ReferenceAgentTrace = (event: ReferenceAgentTraceEvent) => void | Promise<void>;

const MAX_TRACE_STRING_CHARS = 160;
const MAX_TRACE_REASON_CHARS = 240;
const MAX_TRACE_LIST_ITEMS = 16;
const MAX_TRACE_COUNT = 1_000_000_000;
const MAX_PENDING_TRACE_EVENTS = 64;
const REDACTED = "[redacted]";

interface TraceQueueState {
  readonly pending: ReferenceAgentTraceEvent[];
  running: boolean;
}

const traceQueues = new WeakMap<ReferenceAgentTrace, TraceQueueState>();

export function emitReferenceAgentTrace(
  trace: ReferenceAgentTrace | undefined,
  event: ReferenceAgentTraceEvent,
): void {
  if (trace === undefined) return;

  const sanitized = sanitizeReferenceAgentTraceEvent(event);
  let queue = traceQueues.get(trace);
  if (queue === undefined) {
    queue = { pending: [], running: false };
    traceQueues.set(trace, queue);
  }

  if (queue.running) {
    enqueueTraceEvent(queue, sanitized);
    return;
  }

  runTraceEvent(trace, queue, sanitized);
}

export function sanitizeReferenceAgentTraceEvent(
  event: ReferenceAgentTraceEvent,
): ReferenceAgentTraceEvent {
  try {
    return sanitizeKnownReferenceAgentTraceEvent(event);
  } catch {
    // Tracing must never alter the agent turn.
    return {
      type: "turn_error",
      reason: "trace_sanitize_error",
      retryable: false,
    };
  }
}

function sanitizeKnownReferenceAgentTraceEvent(
  event: ReferenceAgentTraceEvent,
): ReferenceAgentTraceEvent {
  switch (event.type) {
    case "turn_start":
      return {
        type: "turn_start",
        eventKind: boundTraceString(event.eventKind),
        ...optionalTraceInteger("historyTurns", event.historyTurns),
      };
    case "context_compacted":
      return {
        type: "context_compacted",
        originalHistoryTurns: safeTraceInteger(event.originalHistoryTurns),
        includedHistoryTurns: safeTraceInteger(event.includedHistoryTurns),
        droppedHistoryTurns: safeTraceInteger(event.droppedHistoryTurns),
        originalChars: safeTraceInteger(event.originalChars),
        includedChars: safeTraceInteger(event.includedChars),
        ...optionalStageMode(event.stageMode),
        ...optionalTraceInteger("stageNodeCount", event.stageNodeCount),
      };
    case "provider_attempt":
      return {
        type: "provider_attempt",
        ...optionalTraceString("provider", event.provider),
        ...optionalTraceString("model", event.model),
        attempt: safeTraceInteger(event.attempt),
        messageCount: safeTraceInteger(event.messageCount),
        toolCount: safeTraceInteger(event.toolCount),
        ...optionalTraceInteger("estimatedContextChars", event.estimatedContextChars),
      };
    case "provider_retry":
      return {
        type: "provider_retry",
        ...optionalTraceString("provider", event.provider),
        ...optionalTraceString("model", event.model),
        attempt: safeTraceInteger(event.attempt),
        retryInMs: safeTraceInteger(event.retryInMs),
        reason: boundTraceString(event.reason, MAX_TRACE_REASON_CHARS),
        ...optionalTraceInteger("httpStatus", event.httpStatus),
      };
    case "provider_step":
      return {
        type: "provider_step",
        ...optionalTraceString("provider", event.provider),
        ...optionalTraceString("model", event.model),
        step: safeTraceInteger(event.step),
        textChars: safeTraceInteger(event.textChars),
        toolCallCount: safeTraceInteger(event.toolCallCount),
        toolNames: event.toolNames
          .slice(0, MAX_TRACE_LIST_ITEMS)
          .map((toolName) => boundTraceString(toolName)),
      };
    case "tool_result":
      return {
        type: "tool_result",
        toolName: boundTraceString(event.toolName),
        callId: boundTraceString(event.callId),
        observationChars: safeTraceInteger(event.observationChars),
        truncated: event.truncated,
        ...optionalTraceInteger("omittedChars", event.omittedChars),
      };
    case "batch_yield":
      return {
        type: "batch_yield",
        messageCount: safeTraceInteger(event.messageCount),
        patchCount: safeTraceInteger(event.patchCount),
        sayCount: safeTraceInteger(event.sayCount),
      };
    case "stop":
      return {
        type: "stop",
        reason: event.reason,
        stepCount: safeTraceInteger(event.stepCount),
        toolCallCount: safeTraceInteger(event.toolCallCount),
        ...optionalTraceInteger("finalTextChars", event.finalTextChars),
      };
    case "turn_error":
      return {
        type: "turn_error",
        reason: boundTraceString(event.reason, MAX_TRACE_REASON_CHARS),
        retryable: event.retryable,
        ...optionalTraceInteger("httpStatus", event.httpStatus),
      };
    case "compaction_triggered":
      return {
        type: "compaction_triggered",
        site: boundCompactionSite(event.site),
        estimatedTokens: safeTraceInteger(event.estimatedTokens),
        budgetTokens: safeTraceInteger(event.budgetTokens),
      };
    case "compaction_done":
      return {
        type: "compaction_done",
        site: boundCompactionSite(event.site),
        generation: safeTraceInteger(event.generation),
        coveredThrough: safeTraceInteger(event.coveredThrough),
        beforeTokens: safeTraceInteger(event.beforeTokens),
        afterTokens: safeTraceInteger(event.afterTokens),
      };
    case "compaction_failed":
      return {
        type: "compaction_failed",
        site: boundCompactionSite(event.site),
        reason: boundCompactionFailReason(event.reason),
      };
  }
}

function boundCompactionSite(site: ReferenceAgentCompactionSite): ReferenceAgentCompactionSite {
  return site === "in_turn" ? "in_turn" : "cross_turn";
}

const COMPACTION_FAIL_REASONS: ReadonlySet<ReferenceAgentCompactionFailReason> = new Set([
  "summarizer_failed",
  "store_error",
  "sink_error",
  "min_gain",
  "stale_write",
]);

function boundCompactionFailReason(
  reason: ReferenceAgentCompactionFailReason,
): ReferenceAgentCompactionFailReason {
  return COMPACTION_FAIL_REASONS.has(reason) ? reason : "summarizer_failed";
}

function optionalTraceString<Key extends string>(
  key: Key,
  value: string | undefined,
): Partial<Record<Key, string>> {
  if (value === undefined) return {};
  return { [key]: boundTraceString(value) } as Record<Key, string>;
}

function runTraceEvent(
  trace: ReferenceAgentTrace,
  queue: TraceQueueState,
  event: ReferenceAgentTraceEvent,
): void {
  queue.running = true;
  try {
    const result = trace(event);
    if (isPromiseLike(result)) {
      void Promise.resolve(result).then(
        () => {
          drainTraceQueue(trace, queue);
        },
        () => {
          drainTraceQueue(trace, queue);
        },
      );
      return;
    }
  } catch {
    // Tracing must never alter the agent turn.
  }
  drainTraceQueue(trace, queue);
}

function drainTraceQueue(trace: ReferenceAgentTrace, queue: TraceQueueState): void {
  const next = queue.pending.shift();
  if (next === undefined) {
    queue.running = false;
    traceQueues.delete(trace);
    return;
  }
  runTraceEvent(trace, queue, next);
}

function enqueueTraceEvent(queue: TraceQueueState, event: ReferenceAgentTraceEvent): void {
  if (queue.pending.length < MAX_PENDING_TRACE_EVENTS) {
    queue.pending.push(event);
    return;
  }

  if (event.type === "stop" || event.type === "turn_error") {
    queue.pending.splice(lastOrdinaryTraceIndex(queue.pending), 1);
    queue.pending.push(event);
  }
}

function lastOrdinaryTraceIndex(events: readonly ReferenceAgentTraceEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "stop" && event?.type !== "turn_error") return index;
  }
  return events.length - 1;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value["then"] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalTraceInteger<Key extends string>(
  key: Key,
  value: number | undefined,
): Partial<Record<Key, number>> {
  if (value === undefined) return {};
  return { [key]: safeTraceInteger(value) } as Record<Key, number>;
}

function optionalStageMode(
  stageMode: ReferenceAgentTraceStageMode | undefined,
): Partial<{ readonly stageMode: ReferenceAgentTraceStageMode }> {
  if (stageMode === undefined) return {};
  return { stageMode };
}

function safeTraceInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_TRACE_COUNT, Math.floor(value)));
}

function boundTraceString(value: string, maxChars = MAX_TRACE_STRING_CHARS): string {
  const redacted = redactTraceString(value);
  if (redacted.length <= maxChars) return redacted;
  const marker = "[truncated]";
  const keepChars = Math.max(0, maxChars - marker.length);
  return `${redacted.slice(0, keepChars)}${marker}`;
}

function redactTraceString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:api[_-]?key|x-api-key|authorization)\s*[:=]\s*[^,;\s]+/gi, (match) => {
      const separator = match.includes("=") ? "=" : ":";
      const key = match.slice(0, match.indexOf(separator)).trim();
      return `${key}${separator}${REDACTED}`;
    })
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, REDACTED);
}
