// @facet/quickstart — the one-command wrapper/server for a live Facet page.
// The `facet-quickstart` bin (src/cli.ts) is the one non-barrel entry.
export { QUICKSTART_INITIAL_STAGE } from "./guide.js";
export { createQuickstartAgent } from "./agent.js";
export type { QuickstartAgentOptions } from "./agent.js";
export { startQuickstart } from "./server.js";
export type { QuickstartServerOptions, RunningQuickstart } from "./server.js";

export type {
  ConversationSummary,
  ReferenceAgentBudget,
  ReferenceAgentBudgetOptions,
  ReferenceAgentBudgetOverrides,
  ReferenceAgentBudgetPreset,
  ReferenceAgentDiagnosticEvent,
  ReferenceAgentDiagnosticObserver,
  ReferenceAgentOptions,
  ReferenceAgentTrace,
  ReferenceAgentTraceEvent,
  ReferenceProvider,
  Summarizer,
  SummarizerRequest,
} from "@facet/reference-agent";
