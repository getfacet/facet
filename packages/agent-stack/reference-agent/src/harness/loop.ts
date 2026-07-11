import { createStageToolBuffer } from "@facet/agent-tools";
import type { StageToolAssets, StageToolBuffer } from "@facet/agent-tools";
import type {
  ClientEvent,
  FacetSession,
  FacetTree,
  JsonPatchOperation,
  ServerMessage,
} from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";

import { describeEvent, formatCurrentStageForPrompt, TOOLS } from "../prompt.js";
import type {
  ProviderStep,
  ProviderTurn,
  QuickstartProvider,
  ToolSpec,
  TurnMessage,
} from "../provider.js";
import {
  classifyProviderFailure,
  effectiveTokenBudget,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import { estimateMessagesChars, groupTranscriptSteps, splitStepGroups } from "./compaction.js";
import { assembleProviderContext, type ReferenceAgentContextStats } from "./context.js";
import {
  createTokenEstimator,
  estimateProviderTurnChars,
  estimateTurnChars,
  type TokenEstimator,
} from "./estimate.js";
import {
  summaryBlockMessage,
  summaryCharBudget,
  type ConversationSummary,
  type Summarizer,
  type SummarizerRequest,
} from "./summary.js";
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
        buffer: bufferFactory(options.session.stage, assets),
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
      // before: it fires only when a compaction attempt still could not land the
      // turn under budget, never preempting group accumulation early in a turn.
      if (estimatedContextChars > options.budget.maxContextChars) {
        stopReason = "context_limit";
        break;
      }
      if (compactionAttempted && tokenEstimator.estimateTokens(turnChars) > budgetTokens) {
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
  // Non-history messages: the final event+stage message, the pinned summary
  // block (when injected), and the compaction note (when compaction ran).
  const nonHistoryMessages = 1 + (stats.summaryInjected ? 1 : 0) + (stats.historyCompacted ? 1 : 0);
  const includedHistoryTurns = Math.max(
    0,
    Math.floor((stats.messageCount - nonHistoryMessages) / 2),
  );
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

interface CompactInTurnOptions {
  readonly messages: readonly TurnMessage[];
  readonly initialContextLength: number;
  readonly event: ClientEvent;
  readonly shadow: FacetTree;
  readonly budget: ReferenceAgentBudget;
  readonly summarizer: Summarizer | undefined;
  readonly generation: number;
  /** Landing target for the whole turn, in chars (compactionTargetRatio × budget). */
  readonly targetChars: number;
  /** Chars of the turn outside the messages (system prompt + tool schemas). */
  readonly fixedChars: number;
}

/**
 * Decide whether to compact the in-turn transcript before the next step: EITHER
 * the estimate passes the trigger ratio of the effective token budget OR the
 * turn is already over the char cap (`charOver`); in both cases the cooldown
 * since the last attempt must have elapsed and there must be more than
 * `minRecentStepsVerbatim` in-turn step groups (the messages appended after the
 * assembled initial context — never the initial context itself).
 */
function shouldCompactInTurn(
  options: ReadyLoopOptions,
  messages: readonly TurnMessage[],
  initialContextLength: number,
  tokenEstimator: TokenEstimator,
  turnChars: number,
  charOver: boolean,
  stepCount: number,
  lastCompactionStep: number | undefined,
): boolean {
  const budget = options.budget;
  const triggerTokens =
    budget.compactionTriggerRatio * effectiveTokenBudget(budget, options.contextWindowTokens);
  const tokenTrigger = tokenEstimator.estimateTokens(turnChars) > triggerTokens;
  if (!tokenTrigger && !charOver) return false;
  if (
    lastCompactionStep !== undefined &&
    stepCount - lastCompactionStep < budget.compactionCooldownSteps
  ) {
    return false;
  }
  const inTurnGroups = groupTranscriptSteps(messages.slice(initialContextLength));
  return inTurnGroups.length > budget.minRecentStepsVerbatim;
}

interface CompactInTurnResult {
  readonly messages: readonly TurnMessage[];
  readonly summarized: boolean;
  readonly compactedGroupCount: number;
}

/**
 * Replace the oldest in-turn step groups with one summary (or deterministic
 * marker) message, keep the last `minRecentStepsVerbatim` groups verbatim, and
 * refresh the initial context's stage block from the current shadow tree.
 */
async function compactInTurnTranscript(
  options: CompactInTurnOptions,
): Promise<CompactInTurnResult> {
  const initialContext = options.messages.slice(0, options.initialContextLength);
  const inTurn = options.messages.slice(options.initialContextLength);
  // Refresh the stage FIRST, then size the verbatim-keep window from the
  // POST-refresh initial-context chars. Sizing off the pre-refresh context would
  // mis-budget the landing target by the refresh delta.
  const refreshedContext = refreshStageBlock(
    initialContext,
    options.event,
    options.shadow,
    options.budget,
  );
  const keepGroups = chooseVerbatimKeepGroups(
    inTurn,
    estimateMessagesChars(refreshedContext),
    options,
  );
  const { compactable, verbatim } = splitStepGroups(inTurn, keepGroups);
  if (compactable.length === 0) {
    return { messages: options.messages, summarized: false, compactedGroupCount: 0 };
  }

  const compactedGroupCount = groupTranscriptSteps(compactable).length;
  const omittedChars = estimateMessagesChars(compactable);
  const injected = await summarizeCompactableGroups({
    compactable,
    compactedGroupCount,
    omittedChars,
    summarizer: options.summarizer,
    generation: options.generation,
    budget: options.budget,
  });
  return {
    messages: [...refreshedContext, injected.message, ...verbatim],
    summarized: injected.summarized,
    compactedGroupCount,
  };
}

/**
 * Landing-target sizing: keep as many recent step groups verbatim as still fit
 * under `targetChars` (compactionTargetRatio × effective budget), but never
 * fewer than `minRecentStepsVerbatim` and always compact at least one group.
 * The summary block is budgeted at its `maxSummaryTokens` upper bound.
 */
function chooseVerbatimKeepGroups(
  inTurn: readonly TurnMessage[],
  initialContextChars: number,
  options: CompactInTurnOptions,
): number {
  const groups = groupTranscriptSteps(inTurn);
  const maxKeep = groups.length - 1;
  const minKeep = Math.min(options.budget.minRecentStepsVerbatim, maxKeep);
  const summaryBound = summaryCharBudget(options.budget.maxSummaryTokens);
  const base = options.fixedChars + initialContextChars + summaryBound;
  let suffixChars = 0;
  let keep = minKeep;
  for (let candidate = 1; candidate <= maxKeep; candidate += 1) {
    const group = groups[groups.length - candidate] ?? [];
    suffixChars += estimateMessagesChars(group);
    if (candidate <= minKeep) continue;
    if (base + suffixChars <= options.targetChars) keep = candidate;
  }
  return keep;
}

/**
 * Rebuild the final initial-context user message (event + stage) with a fresh
 * stage rendering from the current shadow tree, leaving the rest untouched.
 *
 * NEVER-INFLATE GUARD: the whole point of compaction is to shrink the turn, so a
 * refresh must never grow it. Render at full JSON bounds first, but if that
 * message is LARGER than the one it replaces (e.g. the initial assembly had
 * chosen a small stage summary because full JSON didn't fit the whole context),
 * fall back to summary mode. A summary-mode render is bounded small and is
 * preferred even when it is itself larger than a stale original — but the
 * full-JSON render must never replace a smaller original.
 */
function refreshStageBlock(
  initialContext: readonly TurnMessage[],
  event: ClientEvent,
  shadow: FacetTree,
  budget: ReferenceAgentBudget,
): readonly TurnMessage[] {
  const original = initialContext.at(-1);
  if (original === undefined) return initialContext;
  const head = initialContext.slice(0, -1);
  const originalChars = estimateMessagesChars([original]);

  const fullMessage = refreshedStageMessage(event, shadow, budget, budget.maxStageJsonChars);
  if (estimateMessagesChars([fullMessage]) <= originalChars) {
    return [...head, fullMessage];
  }
  const summaryMessage = refreshedStageMessage(event, shadow, budget, 0);
  return [...head, summaryMessage];
}

function refreshedStageMessage(
  event: ClientEvent,
  shadow: FacetTree,
  budget: ReferenceAgentBudget,
  maxJsonChars: number,
): TurnMessage {
  const stagePrompt = formatCurrentStageForPrompt(shadow, {
    maxJsonChars,
    maxSummaryNodes: budget.maxStageSummaryNodes,
  });
  return {
    role: "user",
    content: `${describeEvent(event)}\n\n${stagePrompt}`,
  };
}

interface SummarizeGroupsOptions {
  readonly compactable: readonly TurnMessage[];
  readonly compactedGroupCount: number;
  readonly omittedChars: number;
  readonly summarizer: Summarizer | undefined;
  readonly generation: number;
  readonly budget: ReferenceAgentBudget;
}

async function summarizeCompactableGroups(
  options: SummarizeGroupsOptions,
): Promise<{ readonly message: TurnMessage; readonly summarized: boolean }> {
  if (options.summarizer !== undefined) {
    const summary = await runSummarizerSafely(options.summarizer, {
      kind: "transcript",
      content: renderStepGroupsForSummary(options.compactable),
      generation: options.generation,
      maxSummaryChars: summaryCharBudget(options.budget.maxSummaryTokens),
      timeoutMs: options.budget.summarizerTimeoutMs,
      retries: options.budget.summarizerRetries,
    });
    if (summary !== undefined) {
      return {
        message: summaryBlockMessage(summary, options.generation, options.compactedGroupCount),
        summarized: true,
      };
    }
  }
  return {
    message: {
      role: "user",
      content: transcriptCompactionMarker(options.compactedGroupCount, options.omittedChars),
    },
    summarized: false,
  };
}

/** Invoke a Summarizer, absorbing any throw/reject into the deterministic fallback. */
async function runSummarizerSafely(
  summarizer: Summarizer,
  request: SummarizerRequest,
): Promise<ConversationSummary | undefined> {
  try {
    return await summarizer(request);
  } catch {
    return undefined;
  }
}

/** Plain-text rendering of compactable step groups: tool names, args, observations. */
function renderStepGroupsForSummary(messages: readonly TurnMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "assistant_tools":
        if (message.text.length > 0) lines.push(`assistant: ${message.text}`);
        for (const toolCall of message.toolCalls) {
          lines.push(`tool_call ${toolCall.name} ${safeJsonArgs(toolCall.input)}`);
        }
        break;
      case "tool_result":
        lines.push(`tool_result ${message.callId}: ${message.content}`);
        break;
      default:
        lines.push(`${message.role}: ${message.content}`);
    }
  }
  return lines.join("\n");
}

function transcriptCompactionMarker(groupCount: number, omittedChars: number): string {
  return `[transcript compacted: ${String(groupCount)} step group(s) summarized-unavailable, dropped; ${String(
    omittedChars,
  )} chars omitted]`;
}

function safeJsonArgs(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
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
