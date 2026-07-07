import { createStageToolBuffer } from "@facet/agent-tools";
import type { StageToolAssets, StageToolBuffer } from "@facet/agent-tools";
import type {
  ClientEvent,
  FacetSession,
  FacetTree,
  JsonPatchOperation,
  ServerMessage,
} from "@facet/core";
import type { Sink } from "@facet/runtime";

import { TOOLS } from "../prompt.js";
import type {
  ProviderStep,
  ProviderTurn,
  QuickstartProvider,
  ToolSpec,
  TurnMessage,
} from "../provider.js";
import {
  classifyProviderFailure,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import { estimateMessagesChars } from "./compaction.js";
import { assembleProviderContext, type ReferenceAgentContextStats } from "./context.js";
import { appendProviderStepTranscript, finalProseForProviderStop } from "./transcript.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

export const REFERENCE_AGENT_FAILURE_SAY =
  "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.";

const MAX_TRACE_TOOL_NAMES = 16;

export type ReferenceAgentLoopBufferFactory = (
  initialShadow: FacetTree,
  assets: StageToolAssets,
) => StageToolBuffer;

export interface ReferenceAgentLoopOptions {
  readonly provider: QuickstartProvider;
  readonly system: string;
  readonly event: ClientEvent;
  readonly session: FacetSession;
  readonly sink: Sink;
  readonly agentId: string;
  readonly budget: ReferenceAgentBudget;
  readonly assets?: StageToolAssets;
  readonly tools?: readonly ToolSpec[];
  readonly trace?: ReferenceAgentTrace;
  readonly bufferFactory?: ReferenceAgentLoopBufferFactory;
  readonly fallbackSay?: string;
}

export interface ReferenceAgentLoopSummary {
  readonly stopReason: ReferenceAgentStopReason;
  readonly stepCount: number;
  readonly toolCallCount: number;
  readonly finalTextChars?: number;
  readonly unresolved?: readonly string[];
}

type ProviderRunResult =
  | { readonly status: "ok"; readonly step: ProviderStep }
  | {
      readonly status: "error";
      readonly stopReason: Extract<ReferenceAgentStopReason, "provider_error" | "retry_exhausted">;
    };

interface ProviderRunOptions {
  readonly provider: QuickstartProvider;
  readonly turn: ProviderTurn;
  readonly tools: readonly ToolSpec[];
  readonly budget: ReferenceAgentBudget;
  readonly trace?: ReferenceAgentTrace;
  readonly estimatedContextChars: number;
}

interface ReadyLoopOptions {
  readonly provider: QuickstartProvider;
  readonly system: string;
  readonly turn: ProviderTurn;
  readonly buffer: StageToolBuffer;
  readonly tools: readonly ToolSpec[];
  readonly budget: ReferenceAgentBudget;
  readonly trace: ReferenceAgentTrace | undefined;
}

interface LoopState {
  readonly buffer?: StageToolBuffer;
  readonly mutated: boolean;
  readonly said: boolean;
  readonly finalText: string;
  readonly stopReason: ReferenceAgentStopReason;
  readonly stepCount: number;
  readonly toolCallCount: number;
}

interface FinishLoopOptions extends LoopState {
  readonly fallbackSay: string;
  readonly trace: ReferenceAgentTrace | undefined;
}

export async function* runReferenceAgentLoop(
  options: ReferenceAgentLoopOptions,
): AsyncGenerator<readonly ServerMessage[], ReferenceAgentLoopSummary, void> {
  const trace = options.trace;
  const tools = options.tools ?? TOOLS;
  const assets = options.assets ?? {};
  const bufferFactory = options.bufferFactory ?? createStageToolBuffer;
  const fallbackSay = options.fallbackSay ?? REFERENCE_AGENT_FAILURE_SAY;

  let state = emptyLoopState("empty_turn");

  emitReferenceAgentTrace(trace, { type: "turn_start", eventKind: options.event.kind });

  try {
    const context = await assembleProviderContext({
      system: options.system,
      event: options.event,
      session: options.session,
      sink: options.sink,
      agentId: options.agentId,
      budget: options.budget,
    });

    if (context.status === "sink_error") {
      state = emptyLoopState("sink_error");
      emitReferenceAgentTrace(trace, {
        type: "turn_error",
        reason: "sink_error",
        retryable: false,
      });
    } else if (context.status === "context_limit") {
      state = emptyLoopState("context_limit");
    } else {
      emitContextCompactionTrace(trace, context.stats);
      state = yield* runReadyProviderLoop({
        provider: options.provider,
        system: options.system,
        turn: context.turn,
        buffer: bufferFactory(options.session.stage, assets),
        tools,
        budget: options.budget,
        trace,
      });
    }
  } catch (error) {
    const classification = classifyProviderFailure(error);
    state = emptyLoopState("provider_error");
    emitReferenceAgentTrace(trace, {
      type: "turn_error",
      reason: classification.reason,
      retryable: classification.retryable,
      ...optionalHttpStatus(classification.httpStatus),
    });
  }

  const summary = yield* finishReferenceAgentLoop({ ...state, fallbackSay, trace });
  return summary;
}

async function* runReadyProviderLoop(
  options: ReadyLoopOptions,
): AsyncGenerator<readonly ServerMessage[], LoopState, void> {
  const messages = [...options.turn.messages];
  let mutated = false;
  let said = false;
  let finalText = "";
  let stopReason: ReferenceAgentStopReason | undefined;
  let stepCount = 0;
  let toolCallCount = 0;

  try {
    while (stepCount < options.budget.maxSteps) {
      const estimatedContextChars = estimateProviderTurnChars(options.system, messages);
      if (estimatedContextChars > options.budget.maxContextChars) {
        stopReason = "context_limit";
        break;
      }

      const providerResult = await runProviderStep({
        provider: options.provider,
        turn: { system: options.turn.system, messages },
        tools: options.tools,
        budget: options.budget,
        ...(options.trace !== undefined ? { trace: options.trace } : {}),
        estimatedContextChars,
      });
      if (providerResult.status === "error") {
        stopReason = providerResult.stopReason;
        break;
      }

      const step = providerResult.step;
      stepCount += 1;

      if (step.toolCalls.length > options.budget.maxToolCallsPerStep) {
        emitProviderStepTrace(options.trace, options.provider, step, stepCount);
        stopReason = "tool_call_limit";
        break;
      }

      if (step.toolCalls.length === 0) {
        emitProviderStepTrace(options.trace, options.provider, step, stepCount);
        finalText = boundFinalText(finalProseForProviderStop(step), options.budget);
        stopReason = finalText.length > 0 || mutated || said ? "provider_stop" : "empty_turn";
        break;
      }

      emitProviderStepTrace(options.trace, options.provider, step, stepCount);

      const toolResult = executeToolStep({
        buffer: options.buffer,
        step,
        messages,
        budget: options.budget,
        trace: options.trace,
      });
      toolCallCount += toolResult.toolCallCount;
      mutated = mutated || toolResult.mutated;
      said = said || toolResult.said;

      if (toolResult.batch.length > 0) {
        emitBatchYieldTrace(options.trace, toolResult.batch);
        yield toolResult.batch;
        if (hasPatchBatch(toolResult.batch)) options.buffer.resetEmittedPatchOps();
      }
    }
  } catch (error) {
    const classification = classifyProviderFailure(error);
    stopReason = "provider_error";
    emitReferenceAgentTrace(options.trace, {
      type: "turn_error",
      reason: classification.reason,
      retryable: classification.retryable,
      ...optionalHttpStatus(classification.httpStatus),
    });
  }

  return {
    buffer: options.buffer,
    mutated,
    said,
    finalText,
    stopReason: stopReason ?? "max_steps",
    stepCount,
    toolCallCount,
  };
}

async function* finishReferenceAgentLoop(
  options: FinishLoopOptions,
): AsyncGenerator<readonly ServerMessage[], ReferenceAgentLoopSummary, void> {
  let stopReason = options.stopReason;
  let said = options.said;
  let finalText = options.finalText;
  let fallbackEmitted = false;

  const unresolved = options.buffer?.drainUnresolved() ?? [];
  if (unresolved.length > 0) {
    stopReason = "unresolved_buffer";
    finalText = "";
    if (!fallbackEmitted) {
      const batch = sayBatch(options.fallbackSay);
      emitBatchYieldTrace(options.trace, batch);
      yield batch;
      said = true;
      fallbackEmitted = true;
    }
  }

  if (!fallbackEmitted && !said && finalText.length > 0) {
    const batch = sayBatch(finalText);
    emitBatchYieldTrace(options.trace, batch);
    yield batch;
    said = true;
  }

  if (!fallbackEmitted && !options.mutated && !said) {
    const batch = sayBatch(options.fallbackSay);
    emitBatchYieldTrace(options.trace, batch);
    yield batch;
    said = true;
    fallbackEmitted = true;
  }

  emitReferenceAgentTrace(options.trace, {
    type: "stop",
    reason: stopReason,
    stepCount: options.stepCount,
    toolCallCount: options.toolCallCount,
    ...(finalText.length > 0 ? { finalTextChars: finalText.length } : {}),
  });

  return {
    stopReason,
    stepCount: options.stepCount,
    toolCallCount: options.toolCallCount,
    ...(finalText.length > 0 ? { finalTextChars: finalText.length } : {}),
    ...(unresolved.length > 0 ? { unresolved } : {}),
  };
}

interface ExecuteToolStepOptions {
  readonly buffer: StageToolBuffer;
  readonly step: ProviderStep;
  readonly messages: TurnMessage[];
  readonly budget: ReferenceAgentBudget;
  readonly trace: ReferenceAgentTrace | undefined;
}

interface ExecuteToolStepResult {
  readonly batch: readonly ServerMessage[];
  readonly mutated: boolean;
  readonly said: boolean;
  readonly toolCallCount: number;
}

function executeToolStep(options: ExecuteToolStepOptions): ExecuteToolStepResult {
  const batch: ServerMessage[] = [];
  const observations = [];
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

function emptyLoopState(stopReason: ReferenceAgentStopReason): LoopState {
  return {
    mutated: false,
    said: false,
    finalText: "",
    stopReason,
    stepCount: 0,
    toolCallCount: 0,
  };
}

async function runProviderStep(options: ProviderRunOptions): Promise<ProviderRunResult> {
  let attempt = 1;
  while (true) {
    emitReferenceAgentTrace(options.trace, {
      type: "provider_attempt",
      provider: options.provider.name,
      model: options.provider.model,
      attempt,
      messageCount: options.turn.messages.length,
      toolCount: options.tools.length,
      estimatedContextChars: options.estimatedContextChars,
    });

    try {
      const step = await options.provider.run(options.turn, options.tools);
      return { status: "ok", step };
    } catch (error) {
      const classification = classifyProviderFailure(error);
      const canRetry = classification.retryable && attempt <= options.budget.maxProviderRetries;
      if (canRetry) {
        const nextAttempt = attempt + 1;
        emitReferenceAgentTrace(options.trace, {
          type: "provider_retry",
          provider: options.provider.name,
          model: options.provider.model,
          attempt: nextAttempt,
          retryInMs: options.budget.retryBackoffMs,
          reason: classification.reason,
          ...optionalHttpStatus(classification.httpStatus),
        });
        await sleep(options.budget.retryBackoffMs);
        attempt = nextAttempt;
        continue;
      }

      emitReferenceAgentTrace(options.trace, {
        type: "turn_error",
        reason: classification.reason,
        retryable: classification.retryable,
        ...optionalHttpStatus(classification.httpStatus),
      });
      return {
        status: "error",
        stopReason: classification.retryable ? "retry_exhausted" : "provider_error",
      };
    }
  }
}

function emitContextCompactionTrace(
  trace: ReferenceAgentTrace | undefined,
  stats: ReferenceAgentContextStats,
): void {
  if (!stats.historyCompacted && stats.droppedHistoryTurns === 0) return;
  const includedHistoryTurns = Math.max(0, Math.floor((stats.messageCount - 1) / 2));
  emitReferenceAgentTrace(trace, {
    type: "context_compacted",
    originalHistoryTurns: includedHistoryTurns + stats.droppedHistoryTurns,
    includedHistoryTurns,
    droppedHistoryTurns: stats.droppedHistoryTurns,
    originalChars: stats.historyChars + stats.omittedHistoryChars,
    includedChars: stats.historyChars,
    stageMode: stats.stageMode,
  });
}

function emitProviderStepTrace(
  trace: ReferenceAgentTrace | undefined,
  provider: QuickstartProvider,
  step: ProviderStep,
  stepCount: number,
): void {
  if (trace === undefined) return;
  emitReferenceAgentTrace(trace, {
    type: "provider_step",
    provider: provider.name,
    model: provider.model,
    step: stepCount,
    textChars: step.text.length,
    toolCallCount: step.toolCalls.length,
    toolNames: step.toolCalls.slice(0, MAX_TRACE_TOOL_NAMES).map((call) => call.name),
  });
}

function emitBatchYieldTrace(
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

function estimateProviderTurnChars(system: string, messages: ProviderTurn["messages"]): number {
  return `system: ${system}\n`.length + estimateMessagesChars(messages);
}

function sayBatch(text: string): readonly ServerMessage[] {
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

function hasPatchBatch(messages: readonly ServerMessage[]): boolean {
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

function boundFinalText(text: string, budget: ReferenceAgentBudget): string {
  const trimmed = text.trim();
  const maxChars = Math.max(1, Math.floor(budget.maxFinalTextChars));
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}

function optionalHttpStatus(
  httpStatus: number | undefined,
): Partial<{ readonly httpStatus: number }> {
  return httpStatus === undefined ? {} : { httpStatus };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
