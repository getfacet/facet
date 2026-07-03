// @facet/quickstart — the reference brain: a one-command live Facet page owned
// by a built-in LLM agent (OpenAI/Anthropic via QuickstartProvider) or the
// deterministic keyless stub. The `facet-quickstart` bin (src/cli.ts) is the
// one non-barrel entry, per repo convention.
export * from "./provider.js";
export * from "./prompt.js";
export * from "./agent.js";
export * from "./stub.js";
export * from "./server.js";
