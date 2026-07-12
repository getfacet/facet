// Browser-side transports: the counterpart of @facet/agent-client for the
// visitor's side of the reference protocol. Both implement the FacetTransport
// contract from @facet/core, so `useFacet(transport)` accepts either.
export { SseTransport } from "./sse-transport.js";
export { LocalTransport } from "./local-transport.js";
export { browserVisitorId } from "./visitor.js";
export { persistView, loadPersistedView } from "./view-storage.js";
