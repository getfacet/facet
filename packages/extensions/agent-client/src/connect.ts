import {
  collectMessages,
  EMPTY_TREE,
  type AgentControlFrame,
  type AgentEventFrame,
  type FacetAgent,
  type FacetSession,
  type ServerMessage,
} from "@facet/core";

/**
 * Connects an EXTERNAL agent to a Facet server and keeps it there.
 *
 * This is the reusable agent-side core: it dials OUT to the server (so it works
 * behind NAT with no public endpoint), holds the event stream, sends heartbeats,
 * reconnects on drop, and routes each visitor event to your `FacetAgent` — the
 * SAME agent function you'd register in-process. Segment-3 developers import this
 * directly; the segment-2 local bridge is this plus a local-model driver.
 *
 * Reconnect is for TRANSIENT failures (network errors, `5xx`, dropped streams).
 * A `403` (bad token) is TERMINAL: retrying can never succeed, so the connection
 * logs the reason and stops the loop immediately. A `409` (link already owned) is
 * retried for a bounded WALL-CLOCK window before giving up: most 409s are
 * transient — a dropped connection leaves a ghost stream registered until the
 * server's heartbeat reaper clears it, and a NAT'd agent's own redial races that
 * window — so stopping on the first 409 would down the bridge until a human
 * restarts it. The budget is time-based, not attempt-based, so a small
 * `reconnectMs` can't burn it before the reaper window elapses. Only 409s that
 * persist past the budget (genuine second-owner contention) are terminal.
 */
export interface ConnectOptions {
  readonly serverUrl: string;
  readonly agentId: string;
  /** Your brain — identical shape to an in-process agent. */
  readonly agent: FacetAgent;
  /** Heartbeat interval (default 10s). The server reaps agents that go quiet. */
  readonly heartbeatMs?: number;
  /** Delay before reconnecting after a drop (default 2s). */
  readonly reconnectMs?: number;
  /** Shared secret for the `/agent/*` channel, if the server requires one. */
  readonly token?: string;
  readonly onStatus?: (status: "connected" | "disconnected") => void;
}

export interface AgentConnection {
  close(): void;
}

// The wire frame contract lives in @facet/core (AgentEventFrame) so the server
// (emitter) and this consumer can't drift.
function isEventFrame(value: unknown): value is AgentEventFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as {
    type?: unknown;
    requestId?: unknown;
    visitorId?: unknown;
    event?: unknown;
  };
  return (
    frame.type === "event" &&
    typeof frame.requestId === "number" &&
    typeof frame.visitorId === "string" &&
    typeof frame.event === "object" &&
    frame.event !== null
  );
}

/**
 * Splits an SSE buffer into complete frames' `data:` payloads plus the leftover
 * (an incomplete trailing frame). Pure and testable: handles a frame split
 * across chunks, multiple frames per chunk, and non-`data:` lines (comments /
 * heartbeats) without losing following frames.
 */
export function parseSseFrames(buffer: string): { readonly data: string[]; readonly rest: string } {
  const data: string[] = [];
  let rest = buffer;
  let split = rest.indexOf("\n\n");
  while (split !== -1) {
    const frame = rest.slice(0, split);
    rest = rest.slice(split + 2);
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    if (dataLine !== undefined) data.push(dataLine.slice("data:".length).trim());
    split = rest.indexOf("\n\n");
  }
  return { data, rest };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// How long to keep retrying 409s before treating the link as genuinely owned by
// someone else. A 409 is usually the agent's OWN ghost stream from a dropped
// connection: the server keeps it registered until the heartbeat reaper trips
// (staleMs 30s + sweep every 10s ≈ 40s worst case). 60s comfortably outlasts
// that window. This is WALL-CLOCK, not an attempt count, on purpose: reconnectMs
// is a public option, so an attempt budget would burn out in seconds at a small
// cadence and terminate the agent on its own ghost — the exact failure this
// guards against. Only 409s that persist a full minute mean a real second owner.
const CONFLICT_409_BUDGET_MS = 60_000;

export function connectAgent(options: ConnectOptions): AgentConnection {
  const { serverUrl, agentId, agent } = options;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const reconnectMs = options.reconnectMs ?? 2_000;

  let closed = false;
  let controller: AbortController | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // Wall-clock start of the current unbroken run of 409s (null = no streak).
  let conflictStreakStartedAt: number | null = null;

  // Send the shared secret as a header, not a query param (query params leak into
  // access logs / referrers).
  const authHeaders: Record<string, string> =
    options.token !== undefined ? { "x-facet-token": options.token } : {};

  const post = (path: string, body: unknown): Promise<unknown> =>
    fetch(`${serverUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    }).catch(() => undefined);

  // The control reply carries only what the server reads: it routes by requestId
  // and authenticates the link by token, so the frame omits agentId (see
  // AgentControlFrame). The heartbeat handler reads nothing from its body — it
  // just stamps lastHeartbeat — so the beat posts an empty body.
  const sendControl = (requestId: number, messages: readonly ServerMessage[]): Promise<unknown> => {
    const frame: AgentControlFrame = { requestId, messages };
    return post("/agent/control", frame);
  };

  const beat = (): void => {
    void post("/agent/heartbeat", {});
  };

  const handleEvent = async (frame: AgentEventFrame): Promise<void> => {
    const session: FacetSession = {
      agentId,
      visitor: { visitorId: frame.visitorId },
      stage: frame.stage ?? EMPTY_TREE,
    };
    let messages: readonly ServerMessage[];
    try {
      messages = await collectMessages(agent(frame.event, session));
    } catch (error) {
      messages = [
        {
          kind: "say",
          text: `(agent error: ${error instanceof Error ? error.message : "unknown"})`,
        },
      ];
    }
    await sendControl(frame.requestId, messages);
  };

  const runOnce = async (): Promise<void> => {
    controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(`${serverUrl}/agent/stream?agentId=${encodeURIComponent(agentId)}`, {
        headers: { Accept: "text/event-stream", ...authHeaders },
        signal: controller.signal,
      });
    } catch {
      // Network error: do NOT reset the 409 streak clock — otherwise a
      // 409/network-flap alternation could defeat the budget and retry forever.
      return; // server down — the loop will retry
    }
    if (!response.ok) {
      // 403 (bad token) can never succeed on retry — stop immediately. 409 (link
      // already owned) is usually a transient ghost-stream race, so retry it for
      // a bounded wall-clock window (see CONFLICT_409_BUDGET_MS) before concluding
      // a second owner genuinely holds the link. Other non-ok statuses (e.g. 500)
      // are transient and fall through to the reconnect delay.
      if (response.status === 403) {
        console.error("[facet] agent connection refused (403: bad token) — not reconnecting");
        closed = true;
        return;
      }
      if (response.status === 409) {
        if (conflictStreakStartedAt === null) conflictStreakStartedAt = Date.now();
        if (Date.now() - conflictStreakStartedAt >= CONFLICT_409_BUDGET_MS) {
          console.error(
            "[facet] agent connection refused (409: link already owned) — not reconnecting",
          );
          closed = true;
        }
        return; // keep the streak clock running; other outcomes below reset it
      }
      // A real non-409 HTTP response means the slot state changed — end the streak.
      conflictStreakStartedAt = null;
      return;
    }
    if (response.body === null) {
      conflictStreakStartedAt = null;
      return;
    }
    conflictStreakStartedAt = null; // successful connect

    options.onStatus?.("connected");
    beat();
    heartbeatTimer = setInterval(beat, heartbeatMs);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { data, rest } = parseSseFrames(buffer);
        buffer = rest;
        for (const payload of data) {
          try {
            const parsed: unknown = JSON.parse(payload);
            if (isEventFrame(parsed)) void handleEvent(parsed);
          } catch {
            // skip one malformed frame without dropping the rest of the buffer
          }
        }
      }
    } catch {
      // stream error → fall through to reconnect
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      options.onStatus?.("disconnected");
    }
  };

  const loop = async (): Promise<void> => {
    while (!closed) {
      await runOnce();
      if (closed) break;
      await delay(reconnectMs);
    }
  };
  void loop();

  return {
    close: (): void => {
      closed = true;
      controller?.abort();
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    },
  };
}
