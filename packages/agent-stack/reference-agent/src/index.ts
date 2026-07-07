// @facet/reference-agent — the reference Facet brain: provider adapters, prompt
// tools, a streaming tool-loop agent, and the deterministic keyless stub.
export * from "./provider.js";
export * from "./prompt.js";
export * from "./agent.js";
export * from "./stub.js";

export { createQuickstartAgent as createReferenceAgent } from "./agent.js";
export type { QuickstartAgentOptions as ReferenceAgentOptions } from "./agent.js";
export type { QuickstartProvider as ReferenceProvider } from "./provider.js";
