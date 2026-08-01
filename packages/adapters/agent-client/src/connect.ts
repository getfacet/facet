import {
  collectTurnOutcome,
  deriveMessageId,
  validateVisitorEvent,
  validateTurnOutcome,
} from "@facet/core";
import type { AgentControlFrame, VisitorEventFrame, FacetAgent, TurnOutcome } from "@facet/core";

export interface ConnectOptions {
  readonly serverUrl: string;
  readonly agentId: string;
  readonly agent: FacetAgent;
  readonly heartbeatMs?: number;
  readonly reconnectMs?: number;
  readonly maxConcurrentTurns?: number;
  readonly maxQueuedTurns?: number;
  readonly token?: string;
  readonly onStatus?: (status: "connected" | "disconnected") => void;
}

export interface AgentConnection {
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEventFrame(value: unknown): VisitorEventFrame | undefined {
  if (!isRecord(value) || value["kind"] !== "visitor_event") {
    return undefined;
  }
  const result = validateVisitorEvent(value["event"]);
  if (!result.ok) return undefined;
  const correlationId = value["correlationId"];
  const timeoutMs = value["timeoutMs"];
  if (
    correlationId !== undefined &&
    (typeof correlationId !== "string" || correlationId.length === 0)
  ) {
    return undefined;
  }
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: "visitor_event" as const,
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    event: result.event,
  });
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

const CONFLICT_409_BUDGET_MS = 60_000;
const CONTROL_POST_TIMEOUT_MS = 5_000;
const GENERIC_AGENT_FAILURE_TEXT = "The agent could not complete this turn.";
const BUSY_AGENT_FAILURE_TEXT = "The agent is busy. Please try again shortly.";
const EXPIRED_AGENT_FAILURE_TEXT = "The agent could not complete this turn before the deadline.";

function errorOutcome(frame: VisitorEventFrame, text: string): TurnOutcome {
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
  const maxConcurrentTurns = positiveIntegerOption(options.maxConcurrentTurns, 4);
  const maxQueuedTurns = positiveIntegerOption(options.maxQueuedTurns, 32);

  let closed = false;
  let controller: AbortController | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let conflictStreakStartedAt: number | null = null;
  const inFlight = new Set<AbortController>();
  const controlPosts = new Set<AbortController>();
  const turnQueue: QueuedTurn[] = [];
  let activeTurns = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeReconnect: (() => void) | null = null;

  const authHeaders: Record<string, string> =
    options.token !== undefined ? { "x-facet-token": options.token } : {};

  const post = async (
    path: string,
    body: unknown,
    timeoutMs?: number,
  ): Promise<Response | undefined> => {
    const postController = timeoutMs === undefined ? undefined : new AbortController();
    const timer =
      postController === undefined ? null : setTimeout(() => postController.abort(), timeoutMs);
    if (postController !== undefined) controlPosts.add(postController);
    try {
      return await fetch(`${serverUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(body),
        ...(postController === undefined ? {} : { signal: postController.signal }),
      });
    } catch {
      return undefined;
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (postController !== undefined) controlPosts.delete(postController);
    }
  };

  const sendControl = async (
    eventFrame: VisitorEventFrame,
    outcome: TurnOutcome,
  ): Promise<void> => {
    const control: AgentControlFrame = Object.freeze({
      kind: "agent_control" as const,
      eventId: eventFrame.event.eventId,
      ...(eventFrame.correlationId === undefined
        ? {}
        : { correlationId: eventFrame.correlationId }),
      outcome,
    });
    const response = await post("/agent/control", control, CONTROL_POST_TIMEOUT_MS);
    if (response === undefined || !response.ok) {
      const status = response === undefined ? "network" : String(response.status);
      throw new Error(`POST /agent/control failed: ${status}`);
    }
  };

  const logControlFailure = (error: unknown): void => {
    console.error("[facet] control post failed:", error);
  };

  const rejectBusy = (frame: VisitorEventFrame): void => {
    void sendControl(frame, errorOutcome(frame, BUSY_AGENT_FAILURE_TEXT)).catch(logControlFailure);
  };

  const rejectExpired = (frame: VisitorEventFrame): void => {
    void sendControl(frame, errorOutcome(frame, EXPIRED_AGENT_FAILURE_TEXT)).catch(
      logControlFailure,
    );
  };

  const beat = (): void => {
    void post("/agent/heartbeat", {});
  };

  const handleEvent = async (
    queued: QueuedTurn,
    streamInFlight: Set<AbortController>,
  ): Promise<void> => {
    const turnController = new AbortController();
    const frame = queued.frame;
    const timeout = timeoutForQueuedTurn(queued, () => turnController.abort());
    inFlight.add(turnController);
    streamInFlight.add(turnController);
    const work = runAgentTurn(agent, frame, turnController.signal);
    const aborted = abortSignal(turnController.signal);
    const outcome = await Promise.race([work, aborted]);
    if (timeout !== null) clearTimeout(timeout);
    inFlight.delete(turnController);
    streamInFlight.delete(turnController);
    if (outcome === "aborted" || closed || turnController.signal.aborted) {
      return;
    }
    collectTurnOutcome(outcome);
    try {
      await sendControl(frame, outcome);
    } catch (error) {
      logControlFailure(error);
    }
  };

  const pumpTurns = (): void => {
    while (!closed && activeTurns < maxConcurrentTurns) {
      const queued = turnQueue.shift();
      if (queued === undefined) return;
      if (queued.streamInFlight.closed) {
        continue;
      }
      if (remainingTimeoutMs(queued) === 0) {
        rejectExpired(queued.frame);
        continue;
      }
      activeTurns += 1;
      void handleEvent(queued, queued.streamInFlight.controllers).finally(() => {
        activeTurns -= 1;
        pumpTurns();
      });
    }
  };

  const waitBeforeReconnect = (): Promise<void> => {
    if (closed || reconnectMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      wakeReconnect = (): void => {
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        wakeReconnect = null;
        resolve();
      };
      reconnectTimer = setTimeout(() => wakeReconnect?.(), reconnectMs);
    });
  };

  const enqueueEvent = (frame: VisitorEventFrame, streamInFlight: StreamInFlight): void => {
    if (closed || streamInFlight.closed) {
      return;
    }
    const queued = Object.freeze({ frame, streamInFlight, receivedAt: Date.now() });
    if (activeTurns < maxConcurrentTurns) {
      activeTurns += 1;
      void handleEvent(queued, streamInFlight.controllers).finally(() => {
        activeTurns -= 1;
        pumpTurns();
      });
      return;
    }
    if (turnQueue.length >= maxQueuedTurns) {
      rejectBusy(frame);
      return;
    }
    turnQueue.push(queued);
  };

  const discardQueuedForStream = (streamInFlight: StreamInFlight): void => {
    for (let index = turnQueue.length - 1; index >= 0; index -= 1) {
      if (turnQueue[index]?.streamInFlight === streamInFlight) {
        turnQueue.splice(index, 1);
      }
    }
  };

  const runOnce = async (): Promise<void> => {
    controller = new AbortController();
    const streamInFlight: StreamInFlight = {
      controllers: new Set<AbortController>(),
      closed: false,
    };
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
            if (frame !== undefined) enqueueEvent(frame, streamInFlight);
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
      streamInFlight.closed = true;
      discardQueuedForStream(streamInFlight);
      for (const turn of streamInFlight.controllers) {
        turn.abort();
        inFlight.delete(turn);
      }
      streamInFlight.controllers.clear();
      options.onStatus?.("disconnected");
    }
  };

  const loop = async (): Promise<void> => {
    while (!closed) {
      await runOnce();
      if (closed) break;
      await waitBeforeReconnect();
    }
  };
  void loop();

  return {
    close: (): void => {
      closed = true;
      controller?.abort();
      wakeReconnect?.();
      turnQueue.length = 0;
      for (const turn of inFlight) turn.abort();
      inFlight.clear();
      for (const post of controlPosts) post.abort();
      controlPosts.clear();
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    },
  };
}

interface StreamInFlight {
  readonly controllers: Set<AbortController>;
  closed: boolean;
}

interface QueuedTurn {
  readonly frame: VisitorEventFrame;
  readonly streamInFlight: StreamInFlight;
  readonly receivedAt: number;
}

function positiveIntegerOption(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function timeoutForQueuedTurn(
  turn: QueuedTurn,
  abort: () => void,
): ReturnType<typeof setTimeout> | null {
  const remaining = remainingTimeoutMs(turn);
  if (remaining === undefined) return null;
  if (remaining === 0) {
    abort();
    return null;
  }
  return setTimeout(abort, remaining);
}

function remainingTimeoutMs(turn: QueuedTurn): number | undefined {
  if (turn.frame.timeoutMs === undefined) return undefined;
  return Math.max(0, turn.frame.timeoutMs - (Date.now() - turn.receivedAt));
}

async function runAgentTurn(
  agent: FacetAgent,
  frame: VisitorEventFrame,
  signal: AbortSignal,
): Promise<TurnOutcome> {
  try {
    const raw = await agent.handleEvent(frame, { signal });
    const validated = validateTurnOutcome(raw);
    if (
      !validated.ok ||
      validated.outcome.patches.length > 0 ||
      (validated.outcome.conversation !== undefined &&
        validated.outcome.conversation.turnId !== frame.event.eventId)
    ) {
      return errorOutcome(frame, GENERIC_AGENT_FAILURE_TEXT);
    }
    return validated.outcome;
  } catch {
    return errorOutcome(frame, GENERIC_AGENT_FAILURE_TEXT);
  }
}

function abortSignal(signal: AbortSignal): Promise<"aborted"> {
  if (signal.aborted) {
    return Promise.resolve("aborted");
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
}
