/**
 * Provider layer for the Facet reference agent.
 *
 * The built-in agent is a TOOL-CALLING loop, not a single-shot completion: each
 * turn the model calls tools (append/set/remove a node, render the whole page,
 * say a chat line) across multiple steps, observing each result. So a provider
 * here exposes native tool-use -- `run(turn, tools)` returns the model's tool
 * calls (and any prose) for one step; the agent executes them and loops.
 *
 * Raw `fetch`, no SDK dependencies: each adapter is one POST endpoint plus one
 * response shape, so the official SDKs would add two heavyweight dependency
 * trees to an npx-first package for zero capability. `fetchImpl` is injectable
 * so the shared contract suite exercises both adapters against mocked HTTP.
 *
 * API keys are read from env by `resolveProvider`, travel ONLY in the provider's
 * auth header, and are never logged or echoed in errors (messages name the env
 * VAR, never its value).
 */
export { TURN_TIMEOUT_MS } from "./provider/types.js";
export type {
  ProviderOptions,
  ProviderStep,
  ProviderTurn,
  ProviderUsage,
  ReferenceProvider,
  ReferenceProvider as QuickstartProvider,
  ToolCall,
  ToolSpec,
  TurnMessage,
} from "./provider/types.js";
export { DEFAULT_OPENAI_MODEL, createOpenAiProvider } from "./provider/openai.js";
export { DEFAULT_ANTHROPIC_MODEL, createAnthropicProvider } from "./provider/anthropic.js";
export { resolveProvider } from "./provider/resolve.js";
export type { ResolveProviderFlags } from "./provider/resolve.js";
