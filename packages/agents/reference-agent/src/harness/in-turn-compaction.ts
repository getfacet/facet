import type { AgentEvent, FacetToolSession } from "@facet/core";

import { describeEvent, formatCurrentStageForPrompt } from "../prompt.js";
import type { TurnMessage } from "../provider.js";
import { effectiveCharBudget, type ReferenceAgentBudget } from "./budget.js";
import { estimateMessagesChars, groupTranscriptSteps, splitStepGroups } from "./compaction.js";
import {
  summaryBlockMessage,
  summaryCharBudget,
  type ConversationSummary,
  type Summarizer,
  type SummarizerRequest,
} from "./summary.js";

export interface InTurnCompactionPolicy {
  readonly budget: ReferenceAgentBudget;
  readonly contextWindowChars?: number;
}

export interface CompactInTurnOptions {
  readonly messages: readonly TurnMessage[];
  readonly initialContextLength: number;
  readonly event: AgentEvent;
  readonly session: FacetToolSession;
  readonly budget: ReferenceAgentBudget;
  readonly summarizer: Summarizer | undefined;
  readonly abortSignal?: AbortSignal;
  readonly generation: number;
  /** Landing target for the whole turn, in characters. */
  readonly targetChars: number;
  /** Characters of the turn outside the messages (system prompt + tool schemas). */
  readonly fixedChars: number;
}

export function shouldCompactInTurn(
  options: InTurnCompactionPolicy,
  messages: readonly TurnMessage[],
  initialContextLength: number,
  turnChars: number,
  stepCount: number,
  lastCompactionStep: number | undefined,
): boolean {
  const budget = options.budget;
  const triggerChars =
    budget.compactionTriggerRatio * effectiveCharBudget(budget, options.contextWindowChars);
  if (turnChars <= triggerChars) return false;
  if (
    lastCompactionStep !== undefined &&
    stepCount - lastCompactionStep < budget.compactionCooldownSteps
  ) {
    return false;
  }
  const inTurnGroups = groupTranscriptSteps(messages.slice(initialContextLength));
  return inTurnGroups.length > budget.minRecentStepsVerbatim;
}

export interface CompactInTurnResult {
  readonly messages: readonly TurnMessage[];
  readonly summarized: boolean;
  readonly compactedGroupCount: number;
}

export async function compactInTurnTranscript(
  options: CompactInTurnOptions,
): Promise<CompactInTurnResult> {
  const initialContext = options.messages.slice(0, options.initialContextLength);
  const inTurn = options.messages.slice(options.initialContextLength);
  const refreshedContext = refreshStageBlock(
    initialContext,
    options.event,
    options.session,
    options.budget,
  );
  const keepGroups = chooseVerbatimKeepGroups(
    inTurn,
    estimateMessagesChars(refreshedContext),
    options,
  );
  const { compactable, verbatim } = splitStepGroups(inTurn, keepGroups);
  if (compactable.length === 0) {
    return {
      messages: [...refreshedContext, ...verbatim],
      summarized: false,
      compactedGroupCount: 0,
    };
  }

  const compactedGroupCount = groupTranscriptSteps(compactable).length;
  const omittedChars = estimateMessagesChars(compactable);
  const injected = await summarizeCompactableGroups({
    compactable,
    compactedGroupCount,
    omittedChars,
    summarizer: options.summarizer,
    ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
    generation: options.generation,
    budget: options.budget,
  });
  return {
    messages: [...refreshedContext, injected.message, ...verbatim],
    summarized: injected.summarized,
    compactedGroupCount,
  };
}

function chooseVerbatimKeepGroups(
  inTurn: readonly TurnMessage[],
  initialContextChars: number,
  options: CompactInTurnOptions,
): number {
  const groups = groupTranscriptSteps(inTurn);
  const maxKeep = Math.max(0, groups.length - 1);
  const minKeep = Math.min(options.budget.minRecentStepsVerbatim, maxKeep);
  const summaryBound = summaryCharBudget(options.budget.maxSummaryChars);
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

function refreshStageBlock(
  initialContext: readonly TurnMessage[],
  event: AgentEvent,
  session: FacetToolSession,
  budget: ReferenceAgentBudget,
): readonly TurnMessage[] {
  const original = initialContext.at(-1);
  if (original === undefined) return initialContext;
  const head = initialContext.slice(0, -1);
  const stagePrompt = formatCurrentStageForPrompt(session, {
    maxMarkupChars: budget.maxStageJsonChars,
    maxSummaryNodes: budget.maxStageSummaryNodes,
  });
  return [
    ...head,
    {
      role: "user",
      content: `${describeEvent(event)}\n\n${stagePrompt}`,
    },
  ];
}

interface SummarizeGroupsOptions {
  readonly compactable: readonly TurnMessage[];
  readonly compactedGroupCount: number;
  readonly omittedChars: number;
  readonly summarizer: Summarizer | undefined;
  readonly abortSignal?: AbortSignal;
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
      maxSummaryChars: summaryCharBudget(options.budget.maxSummaryChars),
      timeoutMs: options.budget.summarizerTimeoutMs,
      retries: options.budget.summarizerRetries,
      ...(options.abortSignal !== undefined ? { signal: options.abortSignal } : {}),
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
