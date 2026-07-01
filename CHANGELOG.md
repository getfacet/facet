# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/). Nothing is published to
npm yet, so there are no released versions.

## Unreleased

### Added

- Core spec: four low-level bricks (`box`/`text`/`image`/`field`), style tokens,
  a dependency-free RFC 6902 JSON Patch implementation, and `validateTree`
  (the fail-safe boundary for untrusted stage sources).
- `@facet/runtime`: per-`(agent, visitor)` session store + event loop.
- `@facet/agent`: the `Stage` control API + `defineAgent` (in-process agents).
- `@facet/react`: `StageRenderer`, token `theme`, `useFacet`, `ChatDock`.
- `@facet/server`: reference SSE + POST transport for both the browser side and
  the agent side (external agents dial in; heartbeat + liveness); offline face.
- `@facet/agent-client`: dial-in SDK for external agents.
- `@facet/cli`: the `facet` command (a running agent's action surface).
- `@facet/kit`: optional presets over the bricks.
- Statefulness: the visitor's current stage travels with each event so agents
  refine instead of rebuild.
- Persistence is split into two concerns: `StageStore` (the page — always Facet's,
  used to re-hydrate a reconnecting viewer) and `Sink` (the conversation — often
  owned elsewhere, so pluggable: `MemorySink`/`FileSink` store it for replay,
  `ForwardSink` hands it to your system, `NullSink` drops it). Durable,
  dependency-free `FileStageStore`/`FileSink` reference implementations survive a
  restart (playground: `FACET_STORE=file`).
- `apps/playground`: gallery, LLM-generated, live-server, and two-visitor demos.
- Unit tests, CI, and contributor docs.
