import {
  deriveMessageId,
  truncateConversationText,
  type VisitorEvent,
  type ConversationMessage,
  type FacetToolSession,
  type TurnOutcome,
} from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";

import { TOOLS, buildInitialMessages } from "../prompt.js";
import type { ProviderTurn, ReferenceProvider, ToolSpec, TurnMessage } from "../provider.js";
import {
  effectiveCharBudget,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import { estimateMessagesChars } from "./compaction.js";
import { assembleProviderContext, type ReferenceAgentContextStats } from "./context.js";
import {
  createReferenceAgentDiagnosticEmitter,
  type ReferenceAgentDiagnosticEmitter,
  type ReferenceAgentDiagnosticObserver,
} from "./diagnostic-observer.js";
import { compactInTurnTranscript, shouldCompactInTurn } from "./in-turn-compaction.js";
import { executeToolStep, emitBatchYieldTrace } from "./loop-batches.js";
import { measureChars } from "./measure.js";
import {
  emitContextCompactionTrace,
  emitProviderStepTrace,
  runProviderStep,
} from "./provider-step.js";
import type { Summarizer } from "./summary.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

export const REFERENCE_AGENT_FALLBACK_TEXT =
  "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.";

export interface ReferenceAgentLoopOptions {
  readonly provider: ReferenceProvider;
  readonly system: string;
  readonly event: VisitorEvent;
  readonly session: FacetToolSession;
  readonly budget: ReferenceAgentBudget;
  readonly tools?: readonly ToolSpec[];
  readonly sink?: Pick<Sink, "history">;
  readonly historyKey?: string;
  readonly summaryStore?: Pick<SummaryStore, "read">;
  readonly summarizer?: Summarizer;
  readonly contextWindowChars?: number;
  readonly trace?: ReferenceAgentTrace;
  readonly abortSignal?: AbortSignal;
  readonly diagnosticObserver?: ReferenceAgentDiagnosticObserver;
  readonly diagnostics?: ReferenceAgentDiagnosticEmitter;
  readonly now?: () => number;
}

export interface ReferenceAgentLoopSummary {
  readonly stopReason: ReferenceAgentStopReason;
  readonly stepCount: number;
  readonly toolCallCount: number;
  readonly finalTextChars?: number;
  readonly unresolved?: readonly string[];
}

interface LoopState {
  readonly messages: TurnMessage[];
  readonly stopReason: ReferenceAgentStopReason;
  readonly stepCount: number;
  readonly toolCallCount: number;
  readonly finalText: string;
}

export async function* runReferenceAgentLoop(
  options: ReferenceAgentLoopOptions,
): AsyncGenerator<readonly TurnOutcome[], ReferenceAgentLoopSummary, void> {
  const tools = options.tools ?? TOOLS;
  const diagnostics =
    options.diagnostics ?? createReferenceAgentDiagnosticEmitter(options.diagnosticObserver);
  emitReferenceAgentTrace(options.trace, {
    type: "turn_start",
    eventKind: options.event.eventName,
  });

  const state = yield* runProviderLoop(options, tools, diagnostics);
  const final = finalConversationOutcome(
    options.event,
    options.session.stageRevision,
    state.finalText,
    options.now?.() ?? Date.now(),
  );
  if (final !== undefined) {
    const batch = [final];
    emitBatchYieldTrace(options.trace, batch);
    yield batch;
  }
  emitReferenceAgentTrace(options.trace, {
    type: "stop",
    reason: state.stopReason,
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
    ...(state.finalText.length > 0 ? { finalTextChars: state.finalText.length } : {}),
  });
  diagnostics({
    kind: "stop",
    reason: state.stopReason === "provider_stop" ? "complete" : diagnosticStop(state.stopReason),
  });
  return {
    stopReason: state.stopReason,
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
    ...(state.finalText.length > 0 ? { finalTextChars: state.finalText.length } : {}),
  };
}

async function* runProviderLoop(
  options: ReferenceAgentLoopOptions,
  tools: readonly ToolSpec[],
  diagnostics: ReferenceAgentDiagnosticEmitter,
): AsyncGenerator<readonly TurnOutcome[], LoopState, void> {
  const initial = await initialMessages(options);
  if (initial.status === "stopped") {
    return {
      messages: [],
      stopReason: initial.stopReason,
      stepCount: 0,
      toolCallCount: 0,
      finalText: REFERENCE_AGENT_FALLBACK_TEXT,
    };
  }

  const messages = [...initial.messages];
  emitContextCompactionTrace(options.trace, initial.stats);
  const initialContextLength = messages.length;
  let lastCompactionStep: number | undefined;
  let compactionGeneration = initial.stats.summaryGeneration ?? 0;
  let stepCount = 0;
  let toolCallCount = 0;

  while (stepCount < options.budget.maxSteps) {
    if (options.abortSignal?.aborted === true) {
      return { messages, stopReason: "provider_error", stepCount, toolCallCount, finalText: "" };
    }
    const turn: ProviderTurn = { system: options.system, messages };
    const providerResult = await runProviderStep({
      provider: options.provider,
      turn,
      tools,
      budget: options.budget,
      ...(options.trace === undefined ? {} : { trace: options.trace }),
      ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal }),
      diagnostics,
      estimatedContextChars: estimateTurnChars(options.system, messages, tools),
    });

    if (providerResult.status === "error") {
      return {
        messages,
        stopReason: providerResult.stopReason,
        stepCount,
        toolCallCount,
        finalText: REFERENCE_AGENT_FALLBACK_TEXT,
      };
    }

    const step = providerResult.step;
    stepCount += 1;
    emitProviderStepTrace(options.trace, options.provider, step, stepCount);

    if (step.toolCalls.length === 0) {
      const finalText = boundFinalText(step.text, options.budget.maxFinalTextChars);
      return {
        messages,
        stopReason: finalText.length === 0 ? "empty_turn" : "provider_stop",
        stepCount,
        toolCallCount,
        finalText: finalText.length === 0 ? REFERENCE_AGENT_FALLBACK_TEXT : finalText,
      };
    }

    if (step.toolCalls.length > options.budget.maxToolCallsPerStep) {
      return {
        messages,
        stopReason: "tool_call_limit",
        stepCount,
        toolCallCount,
        finalText: REFERENCE_AGENT_FALLBACK_TEXT,
      };
    }

    const executed = await runToolStep({
      session: options.session,
      step,
      messages,
      budget: options.budget,
      trace: options.trace,
      diagnostics,
    });
    if (executed.status === "error") {
      emitReferenceAgentTrace(options.trace, {
        type: "turn_error",
        reason: "tool_execution_error",
        retryable: false,
      });
      return {
        messages,
        stopReason: "provider_error",
        stepCount,
        toolCallCount,
        finalText: REFERENCE_AGENT_FALLBACK_TEXT,
      };
    }
    toolCallCount += executed.toolCallCount;
    if (executed.fragments.length > 0) {
      emitBatchYieldTrace(options.trace, executed.fragments);
      yield executed.fragments;
    }

    const compacted = await maybeCompactInTurn({
      options,
      tools,
      messages,
      initialContextLength,
      stepCount,
      lastCompactionStep,
      generation: compactionGeneration + 1,
    });
    if (compacted.compacted) {
      lastCompactionStep = stepCount;
      compactionGeneration += 1;
    }
  }

  return {
    messages,
    stopReason: "max_steps",
    stepCount,
    toolCallCount,
    finalText: REFERENCE_AGENT_FALLBACK_TEXT,
  };
}

async function runToolStep(options: Parameters<typeof executeToolStep>[0]): Promise<
  | {
      readonly status: "ok";
      readonly fragments: readonly TurnOutcome[];
      readonly toolCallCount: number;
    }
  | { readonly status: "error" }
> {
  try {
    const result = await executeToolStep(options);
    return { status: "ok", ...result };
  } catch {
    return { status: "error" };
  }
}

async function initialMessages(options: ReferenceAgentLoopOptions): Promise<
  | {
      readonly status: "ready";
      readonly messages: readonly TurnMessage[];
      readonly stats: ReferenceAgentContextStats;
    }
  | {
      readonly status: "stopped";
      readonly stopReason: Extract<ReferenceAgentStopReason, "context_limit" | "sink_error">;
    }
> {
  if (options.sink === undefined || options.historyKey === undefined) {
    const messages = buildInitialMessages(options.event, options.session, [], 0);
    return {
      status: "ready",
      messages,
      stats: {
        estimatedContextChars: estimateTurnChars(options.system, messages, options.tools ?? TOOLS),
        historyChars: 0,
        historyCompacted: false,
        droppedHistoryTurns: 0,
        omittedHistoryChars: 0,
        stageMode: "markup",
        messageCount: messages.length,
        summaryInjected: false,
        duplicateHistoryMessages: 0,
      },
    };
  }

  const result = await assembleProviderContext({
    system: options.system,
    event: options.event,
    session: options.session,
    sink: options.sink,
    historyKey: options.historyKey,
    budget: options.budget,
    ...(options.summaryStore === undefined ? {} : { summaryStore: options.summaryStore }),
    ...(options.contextWindowChars === undefined
      ? {}
      : { contextWindowChars: options.contextWindowChars }),
  });
  if (result.status === "ready") {
    return { status: "ready", messages: result.turn.messages, stats: result.stats };
  }
  return { status: "stopped", stopReason: result.stopReason };
}

interface MaybeCompactInTurnOptions {
  readonly options: ReferenceAgentLoopOptions;
  readonly tools: readonly ToolSpec[];
  readonly messages: TurnMessage[];
  readonly initialContextLength: number;
  readonly stepCount: number;
  readonly lastCompactionStep: number | undefined;
  readonly generation: number;
}

async function maybeCompactInTurn(
  input: MaybeCompactInTurnOptions,
): Promise<{ readonly compacted: boolean }> {
  const { options, tools, messages, initialContextLength, stepCount, lastCompactionStep } = input;
  const budgetChars = effectiveCharBudget(options.budget, options.contextWindowChars);
  const beforeChars = estimateTurnChars(options.system, messages, tools);
  if (
    !shouldCompactInTurn(
      {
        budget: options.budget,
        ...(options.contextWindowChars === undefined
          ? {}
          : { contextWindowChars: options.contextWindowChars }),
      },
      messages,
      initialContextLength,
      beforeChars,
      stepCount,
      lastCompactionStep,
    )
  ) {
    return { compacted: false };
  }

  emitReferenceAgentTrace(options.trace, {
    type: "compaction_triggered",
    site: "in_turn",
    estimatedChars: beforeChars,
    budgetChars,
  });
  const result = await compactInTurnTranscript({
    messages,
    initialContextLength,
    event: options.event,
    session: options.session,
    budget: options.budget,
    summarizer: options.summarizer,
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    generation: input.generation,
    targetChars: Math.floor(budgetChars * options.budget.compactionTargetRatio),
    fixedChars: estimateFixedTurnChars(options.system, tools),
  });
  if (result.compactedGroupCount === 0) {
    emitReferenceAgentTrace(options.trace, {
      type: "compaction_failed",
      site: "in_turn",
      reason: "min_gain",
    });
    return { compacted: false };
  }

  messages.splice(0, messages.length, ...result.messages);
  emitReferenceAgentTrace(options.trace, {
    type: "compaction_done",
    site: "in_turn",
    generation: input.generation,
    coveredThrough: result.compactedGroupCount,
    beforeChars,
    afterChars: estimateTurnChars(options.system, messages, tools),
  });
  return { compacted: true };
}

function estimateTurnChars(
  system: string,
  messages: readonly TurnMessage[],
  tools: readonly ToolSpec[],
): number {
  return estimateFixedTurnChars(system, tools) + estimateMessagesChars(messages);
}

function estimateFixedTurnChars(system: string, tools: readonly ToolSpec[]): number {
  return measureChars(system) + measureChars(tools);
}

function boundFinalText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function finalConversationOutcome(
  event: VisitorEvent,
  stageRevision: number,
  text: string,
  at: number,
): TurnOutcome | undefined {
  if (text.length === 0) return undefined;
  const conversation: ConversationMessage = {
    kind: "conversation",
    messageId: deriveMessageId(event.eventId, "assistant"),
    turnId: event.eventId,
    role: "assistant",
    text: truncateConversationText(text),
    at,
  };
  return { stageRevision, patches: [], conversation };
}

function diagnosticStop(
  reason: ReferenceAgentStopReason,
): "budget" | "aborted" | "provider-error" | "invalid-output" {
  if (reason === "max_steps" || reason === "tool_call_limit" || reason === "context_limit") {
    return "budget";
  }
  if (reason === "provider_error" || reason === "retry_exhausted") return "provider-error";
  if (reason === "sink_error") return "provider-error";
  return "invalid-output";
}
