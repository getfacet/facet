import { createStageToolBuffer } from "@facet/agent-tools";
import type { StageToolAssets, StageToolBuffer } from "@facet/agent-tools";
import type { ClientEvent, FacetSession, FacetTree, ServerMessage } from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";

import { TOOLS } from "../prompt.js";
import type { ProviderTurn, ReferenceProvider, ToolSpec, TurnMessage } from "../provider.js";
import {
  classifyProviderFailure,
  effectiveTokenBudget,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import { assembleProviderContext } from "./context.js";
import { createTokenEstimator, estimateProviderTurnChars, estimateTurnChars } from "./estimate.js";
import {
  compactInTurnTranscript,
  hasPendingExactAssetReadHandoff,
  shouldCompactInTurn,
} from "./in-turn-compaction.js";
import { emitBatchYieldTrace, executeToolStep, hasPatchBatch, sayBatch } from "./loop-batches.js";
import {
  emitContextCompactionTrace,
  emitProviderStepTrace,
  optionalHttpStatus,
  runProviderStep,
} from "./provider-step.js";
import type { Summarizer } from "./summary.js";
import { finalProseForProviderStop } from "./transcript.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

export const REFERENCE_AGENT_FAILURE_SAY =
  "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.";

export type ReferenceAgentLoopBufferFactory = (
  initialShadow: FacetTree,
  assets?: StageToolAssets,
) => StageToolBuffer;

export interface ReferenceAgentLoopOptions {
  readonly provider: ReferenceProvider;
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
  /** In-turn transcript summarizer. Absent ⇒ deterministic step-group truncation. */
  readonly summarizer?: Summarizer;
  /** Provider's declared context window (tokens); bounds the effective token budget. */
  readonly contextWindowTokens?: number;
  /** Cross-turn rolling-summary source (read side); forwarded to context assembly. */
  readonly summaryStore?: Pick<SummaryStore, "get">;
}

export interface ReferenceAgentLoopSummary {
  readonly stopReason: ReferenceAgentStopReason;
  readonly stepCount: number;
  readonly toolCallCount: number;
  readonly finalTextChars?: number;
  readonly unresolved?: readonly string[];
}

interface ReadyLoopOptions {
  readonly provider: ReferenceProvider;
  readonly system: string;
  readonly event: ClientEvent;
  readonly turn: ProviderTurn;
  readonly buffer: StageToolBuffer;
  readonly tools: readonly ToolSpec[];
  readonly budget: ReferenceAgentBudget;
  readonly trace: ReferenceAgentTrace | undefined;
  readonly summarizer: Summarizer | undefined;
  readonly contextWindowTokens: number | undefined;
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
      ...(options.summaryStore !== undefined ? { summaryStore: options.summaryStore } : {}),
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
        event: options.event,
        turn: context.turn,
        buffer:
          options.assets === undefined
            ? bufferFactory(options.session.stage)
            : bufferFactory(options.session.stage, options.assets),
        tools,
        budget: options.budget,
        trace,
        summarizer: options.summarizer,
        contextWindowTokens: options.contextWindowTokens,
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
  let messages: TurnMessage[] = [...options.turn.messages];
  const initialContextLength = options.turn.messages.length;
  const tokenEstimator = createTokenEstimator();
  let lastCompactionStep: number | undefined;
  let compactionGeneration = 0;
  let mutated = false;
  let said = false;
  let finalText = "";
  let stopReason: ReferenceAgentStopReason | undefined;
  let stepCount = 0;
  let toolCallCount = 0;

  try {
    while (stepCount < options.budget.maxSteps) {
      const budgetTokens = effectiveTokenBudget(options.budget, options.contextWindowTokens);
      let estimatedContextChars = estimateProviderTurnChars(options.system, messages);
      let turnChars = estimateTurnChars(options.system, messages, options.tools);

      // In-turn compaction: when EITHER the token trigger fires or the char cap
      // is exceeded between steps (both subject to the cooldown + min-group
      // guards), fold the oldest whole step groups into one message, refresh the
      // stage, and continue rather than hard-stopping mid-turn. Attempting
      // compaction before the char hard-stop keeps a high chars-per-token
      // calibration from starving the token trigger.
      const charOver = estimatedContextChars > options.budget.maxContextChars;
      let compactionAttempted = false;
      if (
        shouldCompactInTurn(
          options,
          messages,
          initialContextLength,
          tokenEstimator,
          turnChars,
          charOver,
          stepCount,
          lastCompactionStep,
        )
      ) {
        compactionAttempted = true;
        const beforeTokens = tokenEstimator.estimateTokens(turnChars);
        emitReferenceAgentTrace(options.trace, {
          type: "compaction_triggered",
          site: "in_turn",
          estimatedTokens: beforeTokens,
          budgetTokens,
        });
        compactionGeneration += 1;
        const compacted = await compactInTurnTranscript({
          messages,
          initialContextLength,
          event: options.event,
          shadow: options.buffer.shadow,
          budget: options.budget,
          summarizer: options.summarizer,
          generation: compactionGeneration,
          // Landing target in chars: keep as many recent step groups verbatim as
          // fit under compactionTargetRatio of the effective budget.
          targetChars: Math.floor(
            options.budget.compactionTargetRatio * budgetTokens * tokenEstimator.charsPerToken(),
          ),
          fixedChars: estimateTurnChars(options.system, [], options.tools),
        });
        messages = [...compacted.messages];
        lastCompactionStep = stepCount;
        turnChars = estimateTurnChars(options.system, messages, options.tools);
        estimatedContextChars = estimateProviderTurnChars(options.system, messages);
        const afterTokens = tokenEstimator.estimateTokens(turnChars);
        if (compacted.compactedGroupCount > 0) {
          // A missing summarizer is the deterministic design, not a failure;
          // compaction_failed is reserved for a summarizer that was attempted.
          const failed = !compacted.summarized && options.summarizer !== undefined;
          emitReferenceAgentTrace(
            options.trace,
            failed
              ? { type: "compaction_failed", site: "in_turn", reason: "summarizer_failed" }
              : {
                  type: "compaction_done",
                  site: "in_turn",
                  generation: compactionGeneration,
                  coveredThrough: compacted.compactedGroupCount,
                  beforeTokens,
                  afterTokens,
                },
          );
        }
      }

      // Last-resort hard stops (recomputed post-compaction). The CHAR cap is an
      // unconditional stop — but only after compaction has had its chance above,
      // so a high chars-per-token calibration can no longer preempt the token
      // trigger. The TOKEN budget stays a post-compaction last resort exactly as
      // before. A declared PROVIDER window is different: after compaction gets
      // its chance, exceeding that real request limit always stops before the
      // provider call. The preset TOKEN cap remains calibration policy: it fires
      // only when a compaction attempt still could not land the turn under
      // budget, never preempting group accumulation early in a turn.
      if (estimatedContextChars > options.budget.maxContextChars) {
        stopReason = "context_limit";
        break;
      }
      const estimatedTokens = tokenEstimator.estimateTokens(turnChars);
      const declaredProviderWindowOver =
        typeof options.contextWindowTokens === "number" &&
        Number.isFinite(options.contextWindowTokens) &&
        options.contextWindowTokens > 0 &&
        estimatedTokens > options.contextWindowTokens;
      if (declaredProviderWindowOver) {
        stopReason = "context_limit";
        break;
      }
      const tokenOver = estimatedTokens > budgetTokens;
      if (
        tokenOver &&
        (compactionAttempted || hasPendingExactAssetReadHandoff(messages, initialContextLength))
      ) {
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
      tokenEstimator.calibrate(turnChars, step.usage?.inputTokens);

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

function boundFinalText(text: string, budget: ReferenceAgentBudget): string {
  const trimmed = text.trim();
  const maxChars = Math.max(1, Math.floor(budget.maxFinalTextChars));
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}
