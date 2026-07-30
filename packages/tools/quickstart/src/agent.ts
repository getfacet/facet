import { createReferenceAgent, type ReferenceAgentOptions } from "@facet/reference-agent";
import { MemorySummaryStore, type SummaryStore } from "@facet/runtime";

// Cross-turn LLM-compaction option types, re-exported so quickstart consumers can
// configure compaction without importing @facet/reference-agent (or @facet/runtime)
// directly — the same convenience this barrel already gives the agent factories.
export type { ConversationSummary, Summarizer, SummarizerRequest } from "@facet/reference-agent";
export { MemorySummaryStore } from "@facet/runtime";
export type { SummaryStore } from "@facet/runtime";

/**
 * Options for the quickstart's default agent composition. The quickstart adds
 * one policy on top of the reference agent: cross-turn summary storage is ON by
 * default, while `summaryStore: null` opts out.
 */
export interface QuickstartAgentOptions extends Omit<ReferenceAgentOptions, "summaryStore"> {
  readonly summaryStore?: SummaryStore | null;
}

const SEEDED_PROGRESSIVE_CONTEXT_CHARS = 160_000;

/**
 * The built-in seed needs more repair room than a generic reference agent. Keep
 * that policy composition-local so generic createReferenceAgent consumers with
 * small custom providers retain their existing defaults.
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
    contextWindowCharsDefault: requested?.contextWindowCharsDefault ?? maxContextChars,
    maxSummarizerInputChars: requested?.maxSummarizerInputChars ?? maxContextChars / 2,
  };
}

/** Compose the provider-backed quickstart agent with compaction ON by default. */
export function createQuickstartAgent(options: QuickstartAgentOptions) {
  const { summaryStore, ...rest } = options;
  const store: SummaryStore | undefined =
    summaryStore === null ? undefined : (summaryStore ?? new MemorySummaryStore());
  const budget = seededProgressiveBudget(options);
  return createReferenceAgent({
    ...rest,
    ...(budget !== undefined ? { budget } : {}),
    ...(store !== undefined ? { summaryStore: store } : {}),
  });
}
