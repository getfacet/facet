import type { StageToolAssets } from "@facet/agent-tools";
import { createSerialQueue } from "@facet/core";
import type {
  ClientEvent,
  FacetAgent,
  FacetCatalog,
  FacetSession,
  FacetStamp,
  FacetTheme,
  ServerMessage,
} from "@facet/core";
import { sessionKey, type Sink, type StoredEvent, type SummaryStore } from "@facet/runtime";
import {
  effectiveTokenBudget,
  normalizeBudget,
  type ReferenceAgentBudget,
  type ReferenceAgentBudgetOverrides,
  type ReferenceAgentBudgetPreset,
  type ReferenceAgentStopReason,
} from "./harness/budget.js";
import { truncateWithMarker } from "./harness/compaction.js";
import { createTokenEstimator, estimateTurnChars } from "./harness/estimate.js";
import {
  REFERENCE_AGENT_FAILURE_SAY,
  runReferenceAgentLoop,
  type ReferenceAgentLoopSummary,
} from "./harness/loop.js";
import {
  conversationAnchor,
  createProviderSummarizer,
  summaryBlockMessage,
  summaryCharBudget,
  summaryPayload,
  vetStoredSummary,
  type ConversationSummary,
  type Summarizer,
} from "./harness/summary.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./harness/trace.js";
import {
  DEFAULT_GUIDE,
  buildInitialMessages,
  buildSystem,
  renderHistoryEntry,
  TOOLS,
} from "./prompt.js";
import type { QuickstartProvider, TurnMessage } from "./provider.js";

/** Fraction a new summary must shrink the text it replaces, else the write is skipped. */
const MIN_COMPACTION_GAIN_RATIO = 0.25;

/**
 * One process-wide serial lane keyed by `sessionKey(agentId, visitorId)`: the
 * background post-turn compaction for a visitor runs after any earlier one for
 * the same visitor (so a stale generation can never clobber a newer one), while
 * different visitors compact concurrently. Drained keys are dropped internally.
 */
const compactionLane = createSerialQueue<void>();

/**
 * Per-`sessionKey` history length recorded at the last sub-min-gain skip. While a
 * conversation stays within `compactionCooldownSteps` new turns of that mark, the
 * background task returns without re-running the summarizer, so a summary that
 * can't shrink the context never loops call→skip on every visitor turn (DC-011).
 * Bounded with insertion-order eviction, mirroring runtime.ts's pending-seed cap.
 */
const minGainCooldown = new Map<string, number>();
const MAX_COOLDOWN_KEYS = 1024;

function markMinGainSkip(key: string, historyLength: number): void {
  minGainCooldown.delete(key); // re-set moves the key to newest in insertion order
  if (minGainCooldown.size >= MAX_COOLDOWN_KEYS) {
    const oldest = minGainCooldown.keys().next().value;
    if (oldest !== undefined) minGainCooldown.delete(oldest);
  }
  minGainCooldown.set(key, historyLength);
}

function clearMinGainCooldown(key: string): void {
  minGainCooldown.delete(key);
}

function isWithinMinGainCooldown(
  key: string,
  historyLength: number,
  cooldownSteps: number,
): boolean {
  const marker = minGainCooldown.get(key);
  if (marker === undefined) return false;
  // A shrunken history means the sink was wiped: this is a NEW conversation and
  // a raw-length comparison against the old one is meaningless — clear the
  // marker so the fresh conversation compacts (and cleans up) immediately.
  if (historyLength < marker) {
    minGainCooldown.delete(key);
    return false;
  }
  return historyLength - marker < cooldownSteps;
}

/** TEST-ONLY: clear the min-gain cooldown markers so a skip in one test can never
 * cool down a later one that shares the same `sessionKey`. Never called in production. */
export function __resetCompactionCooldownForTests(): void {
  minGainCooldown.clear();
}

/**
 * Public factory for the Facet reference agent.
 *
 * The factory owns deployer-facing configuration: guide/assets, compatibility
 * budget aliases, explicit budget overrides, and optional tracing. Turn
 * execution lives in the harness loop.
 */
export interface QuickstartAgentOptions {
  readonly provider: QuickstartProvider;
  /** Deployer's page brief (layer ②). Defaults to the built-in DEFAULT_GUIDE. */
  readonly guide?: string;
  /** Conversation history source for prompt layer ③ (shared with the runtime). */
  readonly sink: Sink;
  readonly agentId: string;
  /** Budget profile. Defaults to the quickstart safety profile. */
  readonly budgetPreset?: ReferenceAgentBudgetPreset;
  /** Explicit budget overrides. These win over legacy aliases and preset values. */
  readonly budget?: ReferenceAgentBudgetOverrides;
  /** Optional bounded trace callback. Failures are ignored by the harness. */
  readonly trace?: ReferenceAgentTrace;
  /** Legacy alias for budget.maxHistoryTurns. Ignored when budget.maxHistoryTurns is set. */
  readonly historyTurns?: number;
  /** Legacy alias for budget.maxSteps. Ignored when budget.maxSteps is set. */
  readonly maxSteps?: number;
  /** Operator themes offered to the model by NAME in prompt ② (validated by the
   * caller). The model selects one with `set_theme`; values never reach it. */
  readonly themes?: readonly FacetTheme[];
  /** Operator stamps (reusable fragments) advertised by name for server-side expansion. */
  readonly stamps?: readonly FacetStamp[];
  /** Active catalog policy advertised to the model and enforced by stage tools. */
  readonly catalog?: FacetCatalog;
  /**
   * Rolling-summary store. When present, cross-turn context compaction is enabled:
   * a persisted summary is injected on assembly (WU-7) and a background task after
   * each turn rolls it forward. Absent ⇒ no summarizer is constructed and behavior
   * is exactly as before.
   */
  readonly summaryStore?: SummaryStore;
  /**
   * Injectable summarizer factory (test seam). Defaults to `createProviderSummarizer`.
   * Only invoked when `summaryStore` is set — the stub/deterministic path builds none.
   */
  readonly summarizerFactory?: (provider: QuickstartProvider) => Summarizer;
  /**
   * TEST-ONLY hook receiving the fire-and-forget background-compaction promise so a
   * test can await it. Never awaited by production callers; the turn returns first.
   */
  readonly onBackgroundTask?: (task: Promise<void>) => void;
}

function sayBatch(text: string): readonly ServerMessage[] {
  return [{ kind: "say", text }];
}

export function createQuickstartAgent(options: QuickstartAgentOptions): FacetAgent {
  const stamps = (options.stamps ?? []).map((stamp) => structuredClone(stamp));
  const catalog = options.catalog === undefined ? undefined : structuredClone(options.catalog);
  const assets: StageToolAssets = {
    stamps,
    ...(catalog !== undefined ? { catalog } : {}),
  };
  const system = buildSystem(options.guide ?? DEFAULT_GUIDE, {
    themes: options.themes ?? [],
    stamps,
    ...(catalog !== undefined ? { catalog } : {}),
  });
  const budget = normalizeBudget({
    ...(options.budgetPreset !== undefined ? { budgetPreset: options.budgetPreset } : {}),
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
    ...(options.historyTurns !== undefined ? { historyTurns: options.historyTurns } : {}),
  });

  // Constructed lazily — only with a store. The deterministic/stub path (no store)
  // never invokes the factory and never runs a summarizer.
  const summarizer: Summarizer | undefined =
    options.summaryStore !== undefined
      ? (options.summarizerFactory ?? createProviderSummarizer)(options.provider)
      : undefined;
  const contextWindowTokens = options.provider.contextWindowTokens;

  return async function* (event, session) {
    try {
      const summary = yield* runReferenceAgentLoop({
        provider: options.provider,
        system,
        event,
        session,
        sink: options.sink,
        agentId: options.agentId,
        budget,
        assets,
        ...(options.trace !== undefined ? { trace: options.trace } : {}),
        ...(summarizer !== undefined ? { summarizer } : {}),
        ...(options.summaryStore !== undefined ? { summaryStore: options.summaryStore } : {}),
        ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
        fallbackSay: REFERENCE_AGENT_FAILURE_SAY,
      });
      logStopSummary(summary);
    } catch (error) {
      console.error("[facet-quickstart] turn failed:", errMsg(error));
      yield sayBatch(REFERENCE_AGENT_FAILURE_SAY);
    }

    // Cross-turn compaction runs AFTER the turn, detached, on the serial lane.
    // The generator returns without awaiting it; the task can never reject.
    if (options.summaryStore !== undefined && summarizer !== undefined) {
      const store = options.summaryStore;
      const key = sessionKey(options.agentId, session.visitor.visitorId);
      const task = compactionLane(key, async () => {
        try {
          await runBackgroundCompaction({
            provider: options.provider,
            system,
            budget,
            event,
            session,
            sink: options.sink,
            agentId: options.agentId,
            visitorId: session.visitor.visitorId,
            summaryStore: store,
            summarizer,
            trace: options.trace,
            ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
          });
        } catch {
          // Background compaction must never surface as an unhandled rejection.
        }
      });
      options.onBackgroundTask?.(task);
    }
  };
}

/** A vetted prior/new summary projected into a turn: its block plus how far it covers. */
interface ProjectedSummary {
  readonly summary: ConversationSummary;
  readonly generation: number;
  readonly coveredThrough: number;
}

interface BackgroundCompactionOptions {
  readonly provider: QuickstartProvider;
  readonly system: string;
  readonly budget: ReferenceAgentBudget;
  readonly event: ClientEvent;
  readonly session: FacetSession;
  readonly sink: Sink;
  readonly agentId: string;
  readonly visitorId: string;
  readonly summaryStore: SummaryStore;
  readonly summarizer: Summarizer;
  readonly trace: ReferenceAgentTrace | undefined;
  readonly contextWindowTokens?: number;
}

/**
 * Roll the persisted rolling summary forward for one conversation. Every failure
 * path degrades to a `compaction_failed` trace and returns; nothing here throws,
 * writes the stage, or blocks the turn (which already returned).
 */
async function runBackgroundCompaction(options: BackgroundCompactionOptions): Promise<void> {
  const { trace, budget } = options;

  let history: readonly StoredEvent[];
  try {
    history = await options.sink.history(options.agentId, options.visitorId);
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "sink_error",
    });
    return;
  }

  // A summary is keyed to the conversation identity of the sink it summarizes.
  // With no history there is nothing to compact and no anchor to key on.
  const anchor = conversationAnchor(history);
  if (anchor === undefined) return;

  const key = sessionKey(options.agentId, options.visitorId);

  // Load + vet the stored record BEFORE the hysteresis check: a record left by a
  // wiped/volatile sink (mismatched anchor, or a marker beyond the sink) must be
  // cleaned up even on turns where no compaction is needed, otherwise its high
  // `coveredThrough` blocks every future generation-1 rebuild via the monotonic
  // put guard, and the delete would never run if hysteresis returned first.
  let previous: ConversationSummary | undefined;
  let previousCovered = 0;
  let previousGeneration = 0;
  let stored: Awaited<ReturnType<SummaryStore["get"]>>;
  try {
    stored = await options.summaryStore.get(options.agentId, options.visitorId);
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "store_error",
    });
    return;
  }
  const vetted = vetStoredSummary(stored, history);
  if (vetted.status === "ok") {
    previous = vetted.summary;
    previousCovered = vetted.coveredThrough;
    previousGeneration = vetted.generation;
  } else if (vetted.status === "invalid" || vetted.status === "mismatch") {
    // The record blocks the monotonic put (foreign conversation or corrupt) —
    // delete it so a fresh generation-1 rebuild can proceed.
    try {
      await options.summaryStore.delete(options.agentId, options.visitorId);
    } catch {
      emitReferenceAgentTrace(trace, {
        type: "compaction_failed",
        site: "cross_turn",
        reason: "store_error",
      });
      return;
    }
  }

  // Cross-turn cooldown after a sub-min-gain skip: until `compactionCooldownSteps`
  // new turns have accumulated, return silently (like the hysteresis return) rather
  // than repeat the summarizer call → min_gain skip cycle every turn. Checked AFTER
  // the stale-record cleanup above so a wiped sink is always repaired first.
  if (isWithinMinGainCooldown(key, history.length, budget.compactionCooldownSteps)) return;

  // Project the messages the NEXT turn will ACTUALLY assemble — a vetted summary
  // injected as a block plus only the post-`coveredThrough` tail, never the full
  // raw history — so hysteresis measures what the real assembly builds instead of
  // re-triggering forever once the raw recent window crosses the trigger. Shared
  // by `beforeTokens` and the post-put `afterTokens` so they can never diverge.
  const projectTurnMessages = (
    priorSummary: ProjectedSummary | undefined,
    tail: readonly StoredEvent[],
  ): TurnMessage[] => {
    const tailMessages = buildInitialMessages(
      options.event,
      options.session,
      tail,
      budget.maxHistoryTurns,
      // Mirror the REAL assembly's stage bounds (context.ts) — the projection
      // must measure the same stage rendering the next turn will send.
      { maxJsonChars: budget.maxStageJsonChars, maxSummaryNodes: budget.maxStageSummaryNodes },
    );
    return priorSummary === undefined
      ? tailMessages
      : [
          summaryBlockMessage(
            priorSummary.summary,
            priorSummary.generation,
            priorSummary.coveredThrough,
          ),
          ...tailMessages,
        ];
  };

  // Hysteresis: only compact when the projected next-turn context would pass the
  // trigger ratio of the effective token budget.
  const estimator = createTokenEstimator();
  const budgetTokens = effectiveTokenBudget(budget, options.contextWindowTokens);
  const priorProjection: ProjectedSummary | undefined =
    previous !== undefined
      ? { summary: previous, generation: previousGeneration, coveredThrough: previousCovered }
      : undefined;
  const beforeMessages = projectTurnMessages(
    priorProjection,
    priorProjection !== undefined ? history.slice(previousCovered) : history,
  );
  const beforeTokens = estimator.estimateTokens(
    estimateTurnChars(options.system, beforeMessages, TOOLS),
  );
  if (beforeTokens <= budget.compactionTriggerRatio * budgetTokens) return;

  // Keep the most recent `minRecentTurnsVerbatim` turns out of the summary.
  const fullEnd = history.length - budget.minRecentTurnsVerbatim;
  if (fullEnd <= previousCovered) return; // nothing new to fold in

  // Chunked catch-up: render entries one at a time from `previousCovered`, fusing
  // the render with the cap so a pre-existing long durable sink never materializes
  // its whole backlog (nor a ~48K stage prompt per entry) before truncating. Stop
  // as soon as adding the next entry would exceed `maxSummarizerInputChars`, always
  // including at least one so progress is guaranteed. On success `coveredThrough`
  // advances only to the truncated end, so the next run folds the remainder.
  const window = history.slice(previousCovered, fullEnd);
  const renderedLines: string[] = [];
  let contentChars = 0;
  for (const [index, entry] of window.entries()) {
    // Bound EVERY rendered entry to the cap — a single oversized visitor message
    // must never build a request the provider will reject on every retry.
    const line = truncateWithMarker(
      renderHistoryEntry(entry),
      budget.maxSummarizerInputChars,
    ).content;
    const separator = index === 0 ? 0 : 1; // the join adds one "\n" between entries
    const nextChars = contentChars + separator + line.length;
    if (index > 0 && nextChars > budget.maxSummarizerInputChars) break;
    contentChars = nextChars;
    renderedLines.push(line);
  }

  const end = previousCovered + renderedLines.length;
  const generation = previousGeneration + 1;
  const content = renderedLines.join("\n");

  emitReferenceAgentTrace(trace, {
    type: "compaction_triggered",
    site: "cross_turn",
    estimatedTokens: beforeTokens,
    budgetTokens,
  });

  let summary: ConversationSummary | undefined;
  try {
    summary = await options.summarizer({
      kind: "history",
      ...(previous !== undefined ? { previous } : {}),
      content,
      generation,
      maxSummaryChars: summaryCharBudget(budget.maxSummaryTokens),
      timeoutMs: budget.summarizerTimeoutMs,
      retries: budget.summarizerRetries,
    });
  } catch {
    summary = undefined;
  }
  if (summary === undefined) {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "summarizer_failed",
    });
    return;
  }

  const coveredThrough = Math.min(end, history.length); // RISK-INV-2c: clamp to observed length
  const block = summaryBlockMessage(summary, generation, coveredThrough);

  // Min-gain: a new summary must be materially smaller than the block+turns it
  // replaces, else skip to avoid re-trigger loops that never shrink the context.
  const previousBlockChars =
    previous !== undefined
      ? turnMessageChars(summaryBlockMessage(previous, previousGeneration, previousCovered))
      : 0;
  const replacedChars = previousBlockChars + content.length;
  const gain = replacedChars > 0 ? (replacedChars - turnMessageChars(block)) / replacedChars : 0;
  if (gain < MIN_COMPACTION_GAIN_RATIO) {
    markMinGainSkip(key, history.length);
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "min_gain",
    });
    return;
  }

  let written: boolean;
  try {
    written = await options.summaryStore.put(options.agentId, options.visitorId, {
      payload: summaryPayload(summary, anchor),
      coveredThrough,
      generation,
    });
  } catch {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "store_error",
    });
    return;
  }
  if (!written) {
    emitReferenceAgentTrace(trace, {
      type: "compaction_failed",
      site: "cross_turn",
      reason: "stale_write",
    });
    return;
  }
  clearMinGainCooldown(key); // progress made — a future skip re-arms the cooldown

  const afterMessages = projectTurnMessages(
    { summary, generation, coveredThrough },
    history.slice(coveredThrough),
  );
  const afterTokens = estimator.estimateTokens(
    estimateTurnChars(options.system, afterMessages, TOOLS),
  );

  emitReferenceAgentTrace(trace, {
    type: "compaction_done",
    site: "cross_turn",
    generation,
    coveredThrough,
    beforeTokens,
    afterTokens,
  });
}

/** Character length of a rendered turn message, across the `TurnMessage` variants. */
function turnMessageChars(message: TurnMessage): number {
  return "content" in message ? message.content.length : message.text.length;
}

function logStopSummary(summary: ReferenceAgentLoopSummary): void {
  if (summary.stopReason === "provider_stop") return;
  if (summary.stopReason === "unresolved_buffer" && summary.unresolved !== undefined) {
    console.error(
      "[facet-quickstart] unresolved buffered edits:",
      `${String(summary.unresolved.length)} unresolved edit(s)`,
    );
    return;
  }
  console.error("[facet-quickstart] turn stopped:", stopReasonMessage(summary.stopReason));
}

function stopReasonMessage(stopReason: ReferenceAgentStopReason): string {
  return stopReason;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
