import type { FacetAgent } from "@facet/core";
import { createQuickstartAgent, type QuickstartAgentOptions } from "@facet/reference-agent";
import { MemorySummaryStore, type SummaryStore } from "@facet/runtime";

export { createQuickstartAgent, createReferenceAgent } from "@facet/reference-agent";
export type { QuickstartAgentOptions, ReferenceAgentOptions } from "@facet/reference-agent";

// Cross-turn LLM-compaction option types, re-exported so quickstart consumers can
// configure compaction without importing @facet/reference-agent (or @facet/runtime)
// directly — the same convenience this barrel already gives the agent factories.
export type { ConversationSummary, Summarizer, SummarizerRequest } from "@facet/reference-agent";
export { MemorySummaryStore } from "@facet/runtime";
export type { SummaryStore } from "@facet/runtime";

/**
 * Options for the quickstart's default agent composition. Identical to
 * `QuickstartAgentOptions` except `summaryStore` is tri-state:
 * - `undefined` (default) ⇒ a fresh `MemorySummaryStore` — cross-turn LLM
 *   compaction is ON out of the box;
 * - `null` ⇒ opt out entirely (no store, no summarizer — the reference agent's
 *   own default);
 * - a store instance ⇒ bring your own (e.g. a durable backend).
 */
export interface ComposeQuickstartAgentOptions extends Omit<
  QuickstartAgentOptions,
  "summaryStore"
> {
  readonly summaryStore?: SummaryStore | null;
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
export function composeQuickstartAgent(options: ComposeQuickstartAgentOptions): FacetAgent {
  const { summaryStore, ...rest } = options;
  const store: SummaryStore | undefined =
    summaryStore === null ? undefined : (summaryStore ?? new MemorySummaryStore());
  return createQuickstartAgent({
    ...rest,
    ...(store !== undefined ? { summaryStore: store } : {}),
  });
}
