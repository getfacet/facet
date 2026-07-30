import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";
import { MIN_REFERENCE_AGENT_OBSERVATION_CHARS, type ReferenceAgentBudget } from "./budget.js";
import { truncateWithMarker } from "./compaction.js";
import type { ConversationMessage } from "@facet/core";
import type { ProviderStep, TurnMessage } from "../provider.js";

export interface TranscriptToolObservation {
  readonly callId: string;
  readonly content: string;
  readonly toolName?: string;
}

export interface BoundedTranscriptObservation {
  readonly callId: string;
  readonly content: string;
  readonly originalChars: number;
  readonly truncated: boolean;
  readonly omittedChars: number;
}

export interface TranscriptObservationOptions {
  readonly maxObservationChars: ReferenceAgentBudget["maxObservationChars"];
  readonly trace?: ReferenceAgentTrace;
}

export interface ConversationTranscriptResult {
  readonly records: readonly ConversationMessage[];
  readonly messages: readonly TurnMessage[];
  readonly droppedTurnCount: number;
  readonly duplicateMessageCount: number;
}

interface IndexedConversationMessage {
  readonly record: ConversationMessage;
  readonly index: number;
}

export function conversationHistoryToMessages(
  history: readonly ConversationMessage[],
  limit: number,
): ConversationTranscriptResult {
  const byMessageId = new Map<string, IndexedConversationMessage>();
  let duplicateMessageCount = 0;
  for (const record of history) {
    if (!isConversationMessage(record)) continue;
    const existing = byMessageId.get(record.messageId);
    if (existing === undefined) {
      byMessageId.set(record.messageId, { record, index: byMessageId.size });
      continue;
    }
    duplicateMessageCount += 1;
    byMessageId.set(record.messageId, { record, index: existing.index });
  }

  const deduped = [...byMessageId.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.record);
  const bounded = boundedLimit(limit);
  const turnOrder = orderedTurnIds(deduped);
  const keptTurnIds = new Set(bounded === 0 ? [] : turnOrder.slice(-bounded));
  const kept = deduped.filter((record) => keptTurnIds.has(record.turnId));
  return {
    records: kept,
    messages: kept.map(conversationMessageToTurnMessage),
    droppedTurnCount: Math.max(0, turnOrder.length - keptTurnIds.size),
    duplicateMessageCount,
  };
}

export function appendAssistantToolCalls(messages: TurnMessage[], step: ProviderStep): void {
  messages.push({
    role: "assistant_tools",
    text: step.text,
    toolCalls: step.toolCalls,
    ...(step.providerState === undefined ? {} : { providerState: step.providerState }),
  });
}

export function appendProviderStepTranscript(
  messages: TurnMessage[],
  step: ProviderStep,
  observations: readonly TranscriptToolObservation[],
  options: TranscriptObservationOptions,
): readonly BoundedTranscriptObservation[] {
  appendAssistantToolCalls(messages, step);

  const appended: BoundedTranscriptObservation[] = [];
  for (let index = 0; index < step.toolCalls.length; index += 1) {
    const call = step.toolCalls[index];
    const observation = observations[index];
    if (call === undefined) continue;
    if (observation === undefined) continue;
    appended.push(
      appendToolResultObservation(
        messages,
        // The provider call is authoritative for the tool identity. Observation
        // producers cannot opt an unrelated result into an exact-data policy.
        { ...observation, toolName: call.name },
        options,
      ),
    );
  }
  return appended;
}

function appendToolResultObservation(
  messages: TurnMessage[],
  observation: TranscriptToolObservation,
  options: TranscriptObservationOptions,
): BoundedTranscriptObservation {
  const toolName = observation.toolName ?? "unknown";
  const bounded = boundObservationText(observation.content, options.maxObservationChars);
  messages.push({ role: "tool_result", callId: observation.callId, content: bounded.content });

  emitReferenceAgentTrace(
    options.trace,
    bounded.truncated
      ? {
          type: "tool_result",
          toolName,
          callId: observation.callId,
          observationChars: bounded.content.length,
          truncated: true,
          omittedChars: bounded.omittedChars,
        }
      : {
          type: "tool_result",
          toolName,
          callId: observation.callId,
          observationChars: bounded.content.length,
          truncated: false,
        },
  );

  return { callId: observation.callId, ...bounded };
}

export function boundObservationText(
  content: string,
  maxObservationChars: ReferenceAgentBudget["maxObservationChars"],
): Omit<BoundedTranscriptObservation, "callId"> {
  const maxChars = normalizeObservationLimit(maxObservationChars);
  if (content.length <= maxChars) {
    return {
      content,
      originalChars: content.length,
      truncated: false,
      omittedChars: 0,
    };
  }

  const truncated = truncateWithMarker(content, maxChars);
  return {
    content: truncated.content,
    originalChars: content.length,
    truncated: true,
    omittedChars: truncated.omittedChars,
  };
}

export function finalProseForProviderStop(step: ProviderStep): string {
  return step.toolCalls.length === 0 ? step.text.trim() : "";
}

function normalizeObservationLimit(maxObservationChars: number): number {
  if (!Number.isFinite(maxObservationChars)) return MIN_REFERENCE_AGENT_OBSERVATION_CHARS;
  return Math.max(MIN_REFERENCE_AGENT_OBSERVATION_CHARS, Math.floor(maxObservationChars));
}

function conversationMessageToTurnMessage(record: ConversationMessage): TurnMessage {
  return {
    role: record.role === "visitor" ? "user" : "assistant",
    content: record.text,
  };
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  return (
    isRecord(value) &&
    value["kind"] === "conversation" &&
    typeof value["messageId"] === "string" &&
    value["messageId"].length > 0 &&
    typeof value["turnId"] === "string" &&
    (value["role"] === "visitor" || value["role"] === "assistant") &&
    typeof value["text"] === "string" &&
    typeof value["at"] === "number"
  );
}

function boundedLimit(limit: number): number {
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
