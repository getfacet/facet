import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";
import { MIN_REFERENCE_AGENT_OBSERVATION_CHARS, type ReferenceAgentBudget } from "./budget.js";
import { truncateWithMarker } from "./compaction.js";
import { isExactAssetReadToolName } from "./asset-read-policy.js";
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

export function appendAssistantToolCalls(messages: TurnMessage[], step: ProviderStep): void {
  messages.push({ role: "assistant_tools", text: step.text, toolCalls: step.toolCalls });
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

export function appendToolResultObservation(
  messages: TurnMessage[],
  observation: TranscriptToolObservation,
  options: TranscriptObservationOptions,
): BoundedTranscriptObservation {
  const toolName = observation.toolName ?? "unknown";
  const bounded = isExactAssetReadToolName(toolName)
    ? exactObservationText(observation.content)
    : boundObservationText(observation.content, options.maxObservationChars);
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

function exactObservationText(content: string): Omit<BoundedTranscriptObservation, "callId"> {
  return {
    content,
    originalChars: content.length,
    truncated: false,
    omittedChars: 0,
  };
}
