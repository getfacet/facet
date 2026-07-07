// @facet/quickstart — the one-command wrapper/server for a live Facet page.
// The reference brain lives in @facet/reference-agent and is re-exported here
// for compatibility. The `facet-quickstart` bin (src/cli.ts) is the one
// non-barrel entry, per repo convention.
export * from "@facet/reference-agent";
export * from "./server.js";
