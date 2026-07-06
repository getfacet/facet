# Spec: Agent-side transport (A1 + A2)

Status: draft · Scope: minimal, reference implementation

## Goal

Let an **external agent** (a separate process — a user's local Claude Code, a
hosted agent service, anything that can hold an HTTP connection) OWN a Facet
agent's pages: receive visitor events and control the stage — without the agent
being co-located in the server process and **without the agent exposing any
public endpoint** (it dials out).

This opens customer segments 2 (terminal users) and 3 (external agent
developers). Segment 1 (in-process JS agents via `@facet/agent`) already works.

## Two channels

```
[browser] ⇄ (① SSE + POST, built) ⇄ [@facet/server] ⇄ (② this spec) ⇄ [external agent]
```

- **①** browser ↔ server: already implemented (`/stream`, `/event`).
- **②** server ↔ agent: THIS spec. The agent **dials out** and holds a
  long-lived stream (SSE), posts control back (POST) — the same dependency-free
  pattern as ①, and NAT-safe (only an outbound connection, like a GitHub Actions
  runner). A WebSocket variant is a future adapter, not required.

## A1 — the wire protocol (server ↔ agent)

The agent opens two things against the hosted server:

- `GET /agent/stream?agentId=<id>` → **SSE**. The agent's inbound event channel.
  While open, the server routes that agent's visitor events here. One live
  connection claims the agentId (single-owner for v0).
- `POST /agent/control` → the agent's outbound channel. Body:
  `{ agentId, requestId, messages: ServerMessage[] }`.

Frames:

- **server → agent** (SSE): `{ "type": "event", "requestId": <n>, "visitorId": <id>, "event": <ClientEvent> }`
- **agent → server** (POST /agent/control): `{ "requestId": <n>, "messages": <ServerMessage[]> }`

**Correlation:** every event carries a `requestId`; the agent echoes it in its
control response. The server matches the response to the pending request.

**Server internals — `RemoteAgent` adapter:** the remote agent is exposed to the
runtime as an ordinary `FacetAgent`. On `handle(event, session)` it allocates a
`requestId`, pushes the `event` frame down the agent's SSE stream, and awaits the
matching `/agent/control` POST, returning its `messages`. The runtime then
applies patches to the session and pushes them to the browser exactly as for an
in-process agent — the runtime does not know the agent is remote.

**Fallback / liveness:** if no agent stream is connected, the server uses the
optional in-process `agent` (if provided) or replies with a single
`say("(no agent connected)")`. A per-request timeout resolves to
`say("(agent timed out)")` so a browser is never stuck. Reconnect/replay
(missed-event backfill, at-least-once vs at-most-once) is deferred (A5).

## A2 — the control surface (what the agent sends)

The agent controls the stage by sending `ServerMessage[]` — the **same** output
an in-process agent returns: `patch` (RFC 6902 ops) and `say`. This is the wire
form of `@facet/agent`'s Stage operations (`render` / `append` / `remove` /
`screens` / `theme` / `say`).

How an external agent PRODUCES those messages (the agent-facing surface):

- **(a) TS bridge** using `@facet/agent`'s `Stage` — implemented first (the demo
  agent client builds messages with the SDK and POSTs them).
- **(b) `facet` shell CLI** (`facet append …`, `facet theme …`, `facet say …`) a
  terminal agent invokes — a thin wrapper over (a). Next layer.
- **(c) MCP tools** (`render` / `append` / `theme` / `say`) the agent calls —
  next layer.

v0 implements the wire protocol + (a). (b)/(c) are thin clients over the same
wire and come with the local bridge (A3).

## Out of scope (this step)

- Local bridge daemon driving a real local Claude (`claude -p` / Agent SDK) — A3.
- Multi-language agent SDKs — A4.
- Reconnect/replay, auth tokens, multiple concurrent agents per id — later.

## Demo / DoD

A **separate process** connects to the server as the agent for `agentId=live`,
and a browser visitor's events are answered by that external process (page
builds, chat replies) — proving the agent is no longer co-located. Verified by a
smoke test: agent-client connects, `POST /event` (visit) → event reaches the
client over SSE → client POSTs control → patch reaches the browser stream.
