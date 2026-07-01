---
"@facet/core": minor
---

Initial public release of Facet — a TypeScript framework for living pages an
agent owns: one public link the agent re-renders live, per visitor, driven by
conversation. Ships the core spec (declarative bricks + tokens + RFC 6902
patches + fail-safe validation), the runtime (StageStore + Sink), the agent SDKs
and `facet` CLI, the reference SSE/POST server, the React renderer, presets, and
a Postgres store adapter. (`@facet/*` are versioned together as a fixed group.)
