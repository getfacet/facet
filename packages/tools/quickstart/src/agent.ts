import type { FacetAgent, FacetPattern, FacetTheme } from "@facet/core";
import { createReferenceAgent, type ReferenceAgentOptions } from "@facet/reference-agent";
import { MemorySummaryStore, type SummaryStore } from "@facet/runtime";

// Cross-turn LLM-compaction option types, re-exported so quickstart consumers can
// configure compaction without importing @facet/reference-agent (or @facet/runtime)
// directly — the same convenience this barrel already gives the agent factories.
export type { ConversationSummary, Summarizer, SummarizerRequest } from "@facet/reference-agent";
export { MemorySummaryStore } from "@facet/runtime";
export type { SummaryStore } from "@facet/runtime";

/**
 * Options for the quickstart's default agent composition. The generic
 * reference-agent asset source is fixed to one boot-resolved Theme and exact
 * compatible Pattern list, while `summaryStore` is tri-state:
 * - `undefined` (default) ⇒ a fresh `MemorySummaryStore` — cross-turn LLM
 *   compaction is ON out of the box;
 * - `null` ⇒ opt out entirely (no store, no summarizer — the reference agent's
 *   own default);
 * - a store instance ⇒ bring your own (e.g. a durable backend).
 */
export interface QuickstartAgentOptions extends Omit<
  ReferenceAgentOptions,
  "assets" | "summaryStore"
> {
  /** The one effective, validated Theme resolved for this quickstart boot. */
  readonly theme: FacetTheme;
  /** The exact validated Pattern list compatible with `theme`. */
  readonly patterns: readonly FacetPattern[];
  readonly summaryStore?: SummaryStore | null;
}

const SEEDED_PROGRESSIVE_CONTEXT_CHARS = 160_000;

/**
 * The built-in 175-node seed needs more repair room than a generic reference
 * agent. Keep that policy composition-local so the public quickstart preset —
 * and generic createReferenceAgent consumers with small custom providers —
 * retain their existing defaults. The harness treats each provider's declared
 * context window as a hard pre-request limit while leaving the preset token cap
 * as the existing compaction-and-calibration policy.
 */
function seededProgressiveBudget(
  options: Pick<QuickstartAgentOptions, "budget" | "budgetPreset">,
): ReferenceAgentOptions["budget"] {
  if (options.budgetPreset !== undefined && options.budgetPreset !== "quickstart") {
    return options.budget;
  }

  const requested = options.budget;
  const maxContextChars = requested?.maxContextChars ?? SEEDED_PROGRESSIVE_CONTEXT_CHARS;
  return {
    ...requested,
    maxContextChars,
    maxContextTokens: requested?.maxContextTokens ?? maxContextChars / 4,
    maxSummarizerInputChars: requested?.maxSummarizerInputChars ?? maxContextChars / 2,
  };
}

/**
 * Compose the provider-backed quickstart agent with compaction ON by default.
 *
 * The reference agent defaults compaction OFF (no store ⇒ no summarizer is
 * constructed). The quickstart inverts that default here so a first-run local
 * agent keeps a long conversation from replaying in full. `summaryStore: null`
 * restores the off path — the shape the deterministic stub tier relies on, which
 * never composes through here and so never builds a summarizer.
 */
export function createQuickstartAgent(options: QuickstartAgentOptions): FacetAgent {
  const { patterns, summaryStore, theme, ...rest } = options;
  const store: SummaryStore | undefined =
    summaryStore === null ? undefined : (summaryStore ?? new MemorySummaryStore());
  const assets = Object.freeze({ theme, patterns });
  const budget = seededProgressiveBudget(options);
  return createReferenceAgent({
    ...rest,
    ...(budget !== undefined ? { budget } : {}),
    assets,
    ...(store !== undefined ? { summaryStore: store } : {}),
  });
}
