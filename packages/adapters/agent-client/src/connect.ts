import {
  collectTurnOutcome,
  deriveMessageId,
  validateAgentEvent,
  validateTurnOutcome,
} from "@facet/core";
import type { AgentControlFrame, AgentEventFrame, FacetAgent, TurnOutcome } from "@facet/core";

export interface ConnectOptions {
  readonly serverUrl: string;
  readonly agentId: string;
  readonly agent: FacetAgent;
  readonly heartbeatMs?: number;
  readonly reconnectMs?: number;
  readonly token?: string;
  readonly onStatus?: (status: "connected" | "disconnected") => void;
}

export interface AgentConnection {
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEventFrame(value: unknown): AgentEventFrame | undefined {
  if (!isRecord(value) || value["kind"] !== "agent_event") {
    return undefined;
  }
  const result = validateAgentEvent(value["event"]);
  return result.ok
    ? Object.freeze({ kind: "agent_event" as const, event: result.event })
    : undefined;
}

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
const CONFLICT_409_BUDGET_MS = 60_000;
const GENERIC_AGENT_FAILURE_TEXT = "The agent could not complete this turn.";

function errorOutcome(frame: AgentEventFrame, text: string): TurnOutcome {
  return Object.freeze({
    stageRevision: frame.event.stageRevision,
    patches: Object.freeze([]),
    conversation: Object.freeze({
      kind: "conversation" as const,
      messageId: deriveMessageId(frame.event.eventId, "assistant"),
      turnId: frame.event.eventId,
      role: "assistant" as const,
      text,
      at: Date.now(),
    }),
  });
}

export function connectAgent(options: ConnectOptions): AgentConnection {
  const { serverUrl, agentId, agent } = options;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const reconnectMs = options.reconnectMs ?? 2_000;

  let closed = false;
  let controller: AbortController | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let conflictStreakStartedAt: number | null = null;

  const authHeaders: Record<string, string> =
    options.token !== undefined ? { "x-facet-token": options.token } : {};

  const post = (path: string, body: unknown): Promise<unknown> =>
    fetch(`${serverUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    }).catch(() => undefined);

  const sendControl = (eventId: string, outcome: TurnOutcome): Promise<unknown> => {
    const frame: AgentControlFrame = Object.freeze({
      kind: "agent_control" as const,
      eventId,
      outcome,
    });
    return post("/agent/control", frame);
  };

  const beat = (): void => {
    void post("/agent/heartbeat", {});
  };

  const handleEvent = async (frame: AgentEventFrame): Promise<void> => {
    let outcome: TurnOutcome;
    try {
      const raw = await agent.handleEvent(frame);
      const validated = validateTurnOutcome(raw);
      if (
        !validated.ok ||
        validated.outcome.patches.length > 0 ||
        (validated.outcome.conversation !== undefined &&
          validated.outcome.conversation.turnId !== frame.event.eventId)
      ) {
        outcome = errorOutcome(frame, GENERIC_AGENT_FAILURE_TEXT);
      } else {
        outcome = validated.outcome;
      }
    } catch {
      outcome = errorOutcome(frame, GENERIC_AGENT_FAILURE_TEXT);
    }
    collectTurnOutcome(outcome);
    await sendControl(frame.event.eventId, outcome);
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
      return;
    }
    if (!response.ok) {
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
        return;
      }
      conflictStreakStartedAt = null;
      return;
    }
    if (response.body === null) {
      conflictStreakStartedAt = null;
      return;
    }
    conflictStreakStartedAt = null;

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
            const frame = readEventFrame(JSON.parse(payload));
            if (frame !== undefined) void handleEvent(frame);
          } catch {
            // One malformed frame is inert; the stream continues.
          }
        }
      }
    } catch {
      // stream error → reconnect
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
