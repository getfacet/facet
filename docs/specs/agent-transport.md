# Agent-side transport (A1 + A2)

Status: implemented reference protocol

## Goal

Let an external agent own a Facet link without exposing a public endpoint. The
agent dials out to the reference server, receives visitor events, and returns
Facet patch/chat messages. This remains a local/self-hosted reference transport,
not a hosted multi-tenant edge.

## Two channels

```text
[browser] ⇄ SSE + POST ⇄ [@facet/server] ⇄ SSE + POST ⇄ [external agent]
```

- Browser side: `GET /stream`, `POST /event`, and record-only `POST /record`.
- Agent side: `GET /agent/stream?agentId=<id>` and `POST /agent/control`.

Both sides use outbound-friendly SSE plus POST. A WebSocket or hosted protocol
adapter can implement the same core contracts without changing Facet's stage
model.

## A1 — agent wire protocol

One live agent stream owns an `agentId` at a time. The server sends SSE frames
containing an `AgentEventFrame` with a numeric `requestId`, visitor context, and
the normalized `ClientEvent`. The agent answers `POST /agent/control` with an
`AgentControlFrame`:

```json
{ "requestId": 42, "messages": [{ "kind": "say", "text": "Done" }] }
```

The server correlates the response with the pending turn, applies its RFC 6902
patches through the same runtime fold used by in-process agents, and streams the
result to the browser. The runtime does not need to know whether the brain is
local or remote.

`@facet/agent-client` implements the dial-out client. It sends heartbeats,
reconnects after transient failures, stops on rejected credentials, and retries
a temporary ownership conflict for a bounded stale-connection window. The
server may require a shared `agentToken`; production platforms should replace
that reference trust model with scoped identity and authorization.

If no external agent owns the link, `@facet/server` uses its optional in-process
fallback agent or the configured offline face. A slow turn emits an interim
notice and may still be applied when it completes; a stale late patch never
overwrites a newer stage.

## A2 — control surfaces

The external agent returns the same agent-emitted `ServerMessage[]` as an
in-process agent: `patch` and `say`. Supported authoring surfaces are:

- `@facet/agent` for TypeScript `Stage` operations.
- The `facet` CLI for render/set/append/remove/screens/say commands.
- `@facet/bridge`, which exposes those actions to local Claude/Codex runners.

All three ultimately produce the same closed Facet document and JSON Patch
protocol; none can send raw HTML, JavaScript, or CSS.

## Deliberate limits

- A link has one active external owner in this reference protocol.
- Browser/project identity, tenant isolation, billing, metering, rate limits,
  abuse controls, audit logs, and scoped secrets belong to a hosting platform.
- Durable distributed delivery and worker-fleet orchestration are adapter work,
  not responsibilities of the reference server.

The end-to-end path is covered by the agent-client/server suites and the live
quickstart gate: browser event → agent SSE → correlated control POST → validated
patch/chat frame → browser stream.
