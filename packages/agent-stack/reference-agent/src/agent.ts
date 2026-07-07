import type { StageToolAssets } from "@facet/agent-tools";
import type { FacetAgent, FacetStamp, FacetTheme, ServerMessage } from "@facet/core";
import type { Sink } from "@facet/runtime";
import {
  normalizeBudget,
  type ReferenceAgentBudgetOverrides,
  type ReferenceAgentBudgetPreset,
  type ReferenceAgentStopReason,
} from "./harness/budget.js";
import {
  REFERENCE_AGENT_FAILURE_SAY,
  runReferenceAgentLoop,
  type ReferenceAgentLoopSummary,
} from "./harness/loop.js";
import type { ReferenceAgentTrace } from "./harness/trace.js";
import { DEFAULT_GUIDE, buildSystem } from "./prompt.js";
import type { QuickstartProvider } from "./provider.js";

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
}

function sayBatch(text: string): readonly ServerMessage[] {
  return [{ kind: "say", text }];
}

export function createQuickstartAgent(options: QuickstartAgentOptions): FacetAgent {
  const stamps = (options.stamps ?? []).map((stamp) => structuredClone(stamp));
  const assets: StageToolAssets = { stamps };
  const system = buildSystem(options.guide ?? DEFAULT_GUIDE, {
    themes: options.themes ?? [],
    stamps,
  });
  const budget = normalizeBudget({
    ...(options.budgetPreset !== undefined ? { budgetPreset: options.budgetPreset } : {}),
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
    ...(options.historyTurns !== undefined ? { historyTurns: options.historyTurns } : {}),
  });

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
        fallbackSay: REFERENCE_AGENT_FAILURE_SAY,
      });
      logStopSummary(summary);
    } catch (error) {
      console.error("[facet-quickstart] turn failed:", errMsg(error));
      yield sayBatch(REFERENCE_AGENT_FAILURE_SAY);
    }
  };
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
