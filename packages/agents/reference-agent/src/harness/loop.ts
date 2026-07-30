import {
  deriveMessageId,
  truncateConversationText,
  type AgentEvent,
  type ConversationMessage,
  type FacetToolSession,
  type TurnOutcome,
} from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";

import { TOOLS, buildInitialMessages } from "../prompt.js";
import type { ProviderTurn, ReferenceProvider, ToolSpec, TurnMessage } from "../provider.js";
import {
  classifyProviderFailure,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import { assembleProviderContext } from "./context.js";
import {
  createReferenceAgentDiagnosticEmitter,
  type ReferenceAgentDiagnosticEmitter,
  type ReferenceAgentDiagnosticObserver,
} from "./diagnostic-observer.js";
import { executeToolStep, emitBatchYieldTrace } from "./loop-batches.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

export const REFERENCE_AGENT_FALLBACK_TEXT =
  "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.";

export interface ReferenceAgentLoopOptions {
  readonly provider: ReferenceProvider;
  readonly system: string;
  readonly event: AgentEvent;
  readonly session: FacetToolSession;
  readonly budget: ReferenceAgentBudget;
  readonly tools?: readonly ToolSpec[];
  readonly sink?: Pick<Sink, "history">;
  readonly historyKey?: string;
  readonly summaryStore?: Pick<SummaryStore, "read">;
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
  let stepCount = 0;
  let toolCallCount = 0;

  while (stepCount < options.budget.maxSteps) {
    if (options.abortSignal?.aborted === true) {
      return { messages, stopReason: "provider_error", stepCount, toolCallCount, finalText: "" };
    }
    const turn: ProviderTurn = { system: options.system, messages };
    const stepNumber = stepCount + 1;
    diagnostics({ kind: "provider-attempt", attempt: stepNumber });
    emitReferenceAgentTrace(options.trace, {
      type: "provider_attempt",
      provider: options.provider.name,
      model: options.provider.model,
      attempt: stepNumber,
      messageCount: messages.length,
      toolCount: tools.length,
    });

    try {
      const step = await options.provider.run(turn, tools, {
        ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal }),
      });
      stepCount += 1;
      emitReferenceAgentTrace(options.trace, {
        type: "provider_step",
        provider: options.provider.name,
        model: options.provider.model,
        step: stepCount,
        textChars: step.text.length,
        toolCallCount: step.toolCalls.length,
        toolNames: step.toolCalls.map((call) => call.name),
      });

      if (step.toolCalls.length === 0) {
        return {
          messages,
          stopReason: "provider_stop",
          stepCount,
          toolCallCount,
          finalText: step.text,
        };
      }

      const executed = await executeToolStep({
        session: options.session,
        step,
        messages,
        budget: options.budget,
        trace: options.trace,
        diagnostics,
      });
      toolCallCount += executed.toolCallCount;
      if (executed.fragments.length > 0) {
        emitBatchYieldTrace(options.trace, executed.fragments);
        yield executed.fragments;
      }
    } catch (error) {
      const classification = classifyProviderFailure(error);
      emitReferenceAgentTrace(options.trace, {
        type: "turn_error",
        reason: classification.reason,
        retryable: classification.retryable,
        ...(classification.httpStatus === undefined
          ? {}
          : { httpStatus: classification.httpStatus }),
      });
      return {
        messages,
        stopReason: "provider_error",
        stepCount,
        toolCallCount,
        finalText: REFERENCE_AGENT_FALLBACK_TEXT,
      };
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

async function initialMessages(options: ReferenceAgentLoopOptions): Promise<
  | { readonly status: "ready"; readonly messages: readonly TurnMessage[] }
  | {
      readonly status: "stopped";
      readonly stopReason: Extract<ReferenceAgentStopReason, "context_limit" | "sink_error">;
    }
> {
  if (options.sink === undefined || options.historyKey === undefined) {
    return {
      status: "ready",
      messages: buildInitialMessages(options.event, options.session, [], 0),
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
    return { status: "ready", messages: result.turn.messages };
  }
  return { status: "stopped", stopReason: result.stopReason };
}

function finalConversationOutcome(
  event: AgentEvent,
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
