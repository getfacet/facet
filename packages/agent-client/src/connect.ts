import {
  EMPTY_TREE,
  type ClientEvent,
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
  readonly onStatus?: (status: "connected" | "disconnected") => void;
}

export interface AgentConnection {
  close(): void;
}

interface EventFrame {
  readonly type: "event";
  readonly requestId: number;
  readonly visitorId: string;
  readonly event: ClientEvent;
}

function isEventFrame(value: unknown): value is EventFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "event"
  );
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function connectAgent(options: ConnectOptions): AgentConnection {
  const { serverUrl, agentId, agent } = options;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const reconnectMs = options.reconnectMs ?? 2_000;

  let closed = false;
  let controller: AbortController | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const post = (path: string, body: unknown): Promise<unknown> =>
    fetch(`${serverUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);

  const sendControl = (requestId: number, messages: readonly ServerMessage[]): Promise<unknown> =>
    post("/agent/control", { agentId, requestId, messages });

  const beat = (): void => {
    void post("/agent/heartbeat", { agentId });
  };

  const handleEvent = async (frame: EventFrame): Promise<void> => {
    const session: FacetSession = {
      agentId,
      visitor: { visitorId: frame.visitorId },
      stage: EMPTY_TREE,
    };
    let messages: readonly ServerMessage[];
    try {
      messages = await agent(frame.event, session);
    } catch (error) {
      messages = [{ kind: "say", text: `(agent error: ${error instanceof Error ? error.message : "unknown"})` }];
    }
    await sendControl(frame.requestId, messages);
  };

  const runOnce = async (): Promise<void> => {
    controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(`${serverUrl}/agent/stream?agentId=${encodeURIComponent(agentId)}`, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
    } catch {
      return; // server down — the loop will retry
    }
    if (!response.ok || response.body === null) {
      return;
    }

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
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frameText = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const dataLine = frameText.split("\n").find((line) => line.startsWith("data:"));
          if (dataLine === undefined) continue;
          const parsed: unknown = JSON.parse(dataLine.slice("data:".length).trim());
          if (isEventFrame(parsed)) void handleEvent(parsed);
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
