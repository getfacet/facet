import type { StageToolBuffer } from "@facet/agent-tools";
import type { JsonPatchOperation, ServerMessage } from "@facet/core";
import type { ProviderStep, TurnMessage } from "../provider.js";
import type { ReferenceAgentBudget } from "./budget.js";
import { appendProviderStepTranscript, type TranscriptToolObservation } from "./transcript.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

export interface ExecuteToolStepOptions {
  readonly buffer: StageToolBuffer;
  readonly step: ProviderStep;
  readonly messages: TurnMessage[];
  readonly budget: ReferenceAgentBudget;
  readonly trace: ReferenceAgentTrace | undefined;
}

export interface ExecuteToolStepResult {
  readonly batch: readonly ServerMessage[];
  readonly mutated: boolean;
  readonly said: boolean;
  readonly toolCallCount: number;
}

export function executeToolStep(options: ExecuteToolStepOptions): ExecuteToolStepResult {
  const batch: ServerMessage[] = [];
  const observations: TranscriptToolObservation[] = [];
  let mutated = false;
  let said = false;

  for (const call of options.step.toolCalls) {
    const outcome = options.buffer.run(call);
    mutated = mutated || outcome.mutated;
    said = said || outcome.said;
    appendMessages(batch, outcome.messages);
    observations.push({ callId: call.id, content: outcome.observation, toolName: call.name });
  }

  appendProviderStepTranscript(options.messages, options.step, observations, {
    maxObservationChars: options.budget.maxObservationChars,
    ...(options.trace !== undefined ? { trace: options.trace } : {}),
  });

  return {
    batch: coalescePatchMessages(batch),
    mutated,
    said,
    toolCallCount: options.step.toolCalls.length,
  };
}

export function emitBatchYieldTrace(
  trace: ReferenceAgentTrace | undefined,
  messages: readonly ServerMessage[],
): void {
  const stats = batchStats(messages);
  emitReferenceAgentTrace(trace, {
    type: "batch_yield",
    messageCount: messages.length,
    patchCount: stats.patchCount,
    sayCount: stats.sayCount,
  });
}

export function sayBatch(text: string): readonly ServerMessage[] {
  return [{ kind: "say", text }];
}

function appendMessages(target: ServerMessage[], messages: readonly ServerMessage[]): void {
  for (const message of messages) target.push(message);
}

function coalescePatchMessages(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  const patches: JsonPatchOperation[] = [];
  const out: ServerMessage[] = [];
  let placed = false;
  for (const message of messages) {
    if (message.kind !== "patch") {
      out.push(message);
      continue;
    }
    if (!placed) {
      out.push({ kind: "patch", patches });
      placed = true;
    }
    for (const patch of message.patches) patches.push(patch);
  }
  return out;
}

export function hasPatchBatch(messages: readonly ServerMessage[]): boolean {
  return messages.some((message) => message.kind === "patch" && message.patches.length > 0);
}

function batchStats(messages: readonly ServerMessage[]): {
  readonly patchCount: number;
  readonly sayCount: number;
} {
  let patchCount = 0;
  let sayCount = 0;
  for (const message of messages) {
    if (message.kind === "say") sayCount += 1;
    else if (message.kind === "patch") patchCount += message.patches.length;
  }
  return { patchCount, sayCount };
}
