import type { ProviderStep, ProviderTurn, ReferenceProvider, ToolSpec } from "../provider.js";
import {
  classifyProviderFailure,
  type ReferenceAgentBudget,
  type ReferenceAgentStopReason,
} from "./budget.js";
import type { ReferenceAgentContextStats } from "./context.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

const MAX_TRACE_TOOL_NAMES = 16;

export type ProviderRunResult =
  | { readonly status: "ok"; readonly step: ProviderStep }
  | {
      readonly status: "error";
      readonly stopReason: Extract<ReferenceAgentStopReason, "provider_error" | "retry_exhausted">;
    };

export interface ProviderRunOptions {
  readonly provider: ReferenceProvider;
  readonly turn: ProviderTurn;
  readonly tools: readonly ToolSpec[];
  readonly budget: ReferenceAgentBudget;
  readonly trace?: ReferenceAgentTrace;
  readonly estimatedContextChars: number;
}

export async function runProviderStep(options: ProviderRunOptions): Promise<ProviderRunResult> {
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

export function emitContextCompactionTrace(
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

export function emitProviderStepTrace(
  trace: ReferenceAgentTrace | undefined,
  provider: ReferenceProvider,
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

export function optionalHttpStatus(
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
