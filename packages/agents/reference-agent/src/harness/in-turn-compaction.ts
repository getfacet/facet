import type { ClientEvent, FacetTree } from "@facet/core";
import { describeEvent, formatCurrentStageForPrompt } from "../prompt.js";
import type { TurnMessage } from "../provider.js";
import { isExactAssetReadToolName } from "./asset-read-policy.js";
import { effectiveTokenBudget, type ReferenceAgentBudget } from "./budget.js";
import { estimateMessagesChars, groupTranscriptSteps, splitStepGroups } from "./compaction.js";
import type { TokenEstimator } from "./estimate.js";
import {
  summaryBlockMessage,
  summaryCharBudget,
  type ConversationSummary,
  type Summarizer,
  type SummarizerRequest,
} from "./summary.js";

export interface InTurnCompactionPolicy {
  readonly budget: ReferenceAgentBudget;
  readonly contextWindowTokens: number | undefined;
}

export interface CompactInTurnOptions {
  readonly messages: readonly TurnMessage[];
  readonly initialContextLength: number;
  readonly event: ClientEvent;
  readonly shadow: FacetTree;
  readonly budget: ReferenceAgentBudget;
  readonly summarizer: Summarizer | undefined;
  readonly abortSignal?: AbortSignal;
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
export function shouldCompactInTurn(
  options: InTurnCompactionPolicy,
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

export interface CompactInTurnResult {
  readonly messages: readonly TurnMessage[];
  readonly summarized: boolean;
  readonly compactedGroupCount: number;
}

/**
 * Replace the oldest in-turn step groups with one summary (or deterministic
 * marker) message, keep the last `minRecentStepsVerbatim` groups verbatim, and
 * refresh the initial context's stage block from the current shadow tree.
 */
export async function compactInTurnTranscript(
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

/**
 * Landing-target sizing: keep as many recent step groups verbatim as still fit
 * under `targetChars` (compactionTargetRatio × effective budget), but never
 * fewer than `minRecentStepsVerbatim` and normally compact at least one group.
 * The newest exact asset-read group is pinned intact for its first provider
 * handoff, even if that leaves no group compactable. The summary block is
 * budgeted at its `maxSummaryTokens` upper bound.
 */
function chooseVerbatimKeepGroups(
  inTurn: readonly TurnMessage[],
  initialContextChars: number,
  options: CompactInTurnOptions,
): number {
  const groups = groupTranscriptSteps(inTurn);
  const pinsNewestAssetRead = newestGroupContainsExactAssetRead(groups);
  const maxKeep = pinsNewestAssetRead ? groups.length : groups.length - 1;
  const requiredKeep = Math.max(options.budget.minRecentStepsVerbatim, pinsNewestAssetRead ? 1 : 0);
  const minKeep = Math.min(requiredKeep, maxKeep);
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

function newestGroupContainsExactAssetRead(groups: readonly (readonly TurnMessage[])[]): boolean {
  const newest = groups.at(-1);
  return (
    newest?.some(
      (message) =>
        message.role === "assistant_tools" &&
        message.toolCalls.some((call) => isExactAssetReadToolName(call.name)),
    ) ?? false
  );
}

/**
 * True while the newest in-turn step group carries an exact asset read
 * that has not yet reached the provider. The loop uses the same grouping rule
 * as compaction so a cooldown cannot accidentally bypass the hard token stop
 * for the pinned first handoff.
 */
export function hasPendingExactAssetReadHandoff(
  messages: readonly TurnMessage[],
  initialContextLength: number,
): boolean {
  return newestGroupContainsExactAssetRead(
    groupTranscriptSteps(messages.slice(initialContextLength)),
  );
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
      maxSummaryChars: summaryCharBudget(options.budget.maxSummaryTokens),
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
