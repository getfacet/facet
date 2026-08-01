import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentControlFrame, VisitorEvent, VisitorEventFrame } from "@facet/core";
import { collectTurnOutcome, validateTurnOutcome } from "@facet/core";
import { offlineFor } from "./offline.js";
import { writeSse } from "./sse.js";

interface RuntimeContext {
  readonly event: VisitorEvent;
}

interface RuntimeLikeAgent {
  run(context: RuntimeContext): Promise<string | { readonly text: string | null } | null>;
}

interface Pending {
  readonly correlationId: string;
  readonly eventId: string;
  readonly resolve: (result: { readonly text: string | null }) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface AgentChannelDeps {
  readonly agentTimeoutMs?: number;
  readonly maxPendingTurns?: number;
  readonly fallbackAgent?: RuntimeLikeAgent;
}

export interface AgentChannel {
  readonly agent: RuntimeLikeAgent;
  attach(res: ServerResponse): void;
  isConnected(): boolean;
  heartbeat(): void;
  resolve(frame: AgentControlFrame): boolean;
  dropIfCurrent(res: ServerResponse): void;
  close(): void;
}

const RUNTIME_AUTHORITY_TIMEOUT_MS = 30_000;
const REMOTE_TIMEOUT_SAFETY_MARGIN_MS = 1_000;
const MAX_REMOTE_PENDING_TURNS = 256;

export const REMOTE_TIMEOUT_TEXT =
  "(still working — this is taking longer than usual; the answer will appear here when it's ready)";

function textFromControl(frame: AgentControlFrame): string | null | undefined {
  const validated = validateTurnOutcome(frame.outcome);
  if (!validated.ok || validated.outcome.patches.length > 0) return undefined;
  if (
    validated.outcome.conversation !== undefined &&
    validated.outcome.conversation.turnId !== frame.eventId
  ) {
    return undefined;
  }
  return validated.outcome.conversation?.text ?? null;
}

function controlCorrelationId(frame: AgentControlFrame): string {
  return frame.correlationId ?? frame.eventId;
}

function resolveAgentTimeoutMs(requested: number | undefined): number {
  const candidate =
    requested === undefined || !Number.isFinite(requested)
      ? RUNTIME_AUTHORITY_TIMEOUT_MS
      : requested;
  return Math.floor(
    Math.max(
      1,
      Math.min(candidate, RUNTIME_AUTHORITY_TIMEOUT_MS - REMOTE_TIMEOUT_SAFETY_MARGIN_MS),
    ),
  );
}

function remoteFrameTimeoutMs(timeoutMs: number): number {
  return Math.max(
    1,
    timeoutMs > REMOTE_TIMEOUT_SAFETY_MARGIN_MS
      ? timeoutMs - REMOTE_TIMEOUT_SAFETY_MARGIN_MS
      : timeoutMs,
  );
}

function positiveIntegerOption(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

export function createAgentChannel(deps: AgentChannelDeps = {}): AgentChannel {
  const timeoutMs = resolveAgentTimeoutMs(deps.agentTimeoutMs);
  const maxPendingTurns = positiveIntegerOption(deps.maxPendingTurns, MAX_REMOTE_PENDING_TURNS);
  const pending = new Map<string, Pending>();
  let stream: ServerResponse | null = null;
  let lastHeartbeat = Date.now();

  const settle = (correlationId: string, text: string | null): boolean => {
    const turn = pending.get(correlationId);
    if (turn === undefined) return false;
    clearTimeout(turn.timer);
    pending.delete(correlationId);
    turn.resolve({ text });
    return true;
  };

  const settleAll = (text: string | null): void => {
    for (const eventId of [...pending.keys()]) {
      settle(eventId, text);
    }
  };

  const remoteAgent: RuntimeLikeAgent = {
    run: ({ event }) => {
      const current = stream;
      if (current === null) {
        return Promise.resolve({ text: offlineFor(event) });
      }
      if (pending.size >= maxPendingTurns) {
        return Promise.resolve({ text: REMOTE_TIMEOUT_TEXT });
      }
      const correlationId = randomUUID();
      const frame: VisitorEventFrame = Object.freeze({
        kind: "visitor_event" as const,
        correlationId,
        timeoutMs: remoteFrameTimeoutMs(timeoutMs),
        event,
      });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(correlationId, REMOTE_TIMEOUT_TEXT);
        }, timeoutMs);
        pending.set(correlationId, {
          correlationId,
          eventId: event.eventId,
          timer,
          resolve,
        });
        writeSse(current, { data: frame });
      });
    },
  };

  const agent: RuntimeLikeAgent = {
    run: (context) =>
      stream !== null
        ? remoteAgent.run(context)
        : deps.fallbackAgent !== undefined
          ? deps.fallbackAgent.run(context)
          : Promise.resolve({ text: offlineFor(context.event) }),
  };

  const reaper = setInterval(() => {
    if (stream === null) return;
    if (Date.now() - lastHeartbeat >= RUNTIME_AUTHORITY_TIMEOUT_MS) {
      stream.end();
      stream = null;
      settleAll(REMOTE_TIMEOUT_TEXT);
      return;
    }
    stream.write(": ping\n\n");
  }, 10_000);

  return {
    agent,
    attach(res) {
      stream = res;
      lastHeartbeat = Date.now();
    },
    isConnected: () => stream !== null,
    heartbeat() {
      lastHeartbeat = Date.now();
    },
    resolve(frame) {
      const correlationId = controlCorrelationId(frame);
      const turn = pending.get(correlationId);
      if (turn === undefined || turn.eventId !== frame.eventId) return false;
      const text = textFromControl(frame);
      if (text === undefined) return false;
      settle(correlationId, text);
      void collectTurnOutcome(frame.outcome);
      return true;
    },
    dropIfCurrent(res) {
      if (stream === res) {
        stream = null;
        settleAll(REMOTE_TIMEOUT_TEXT);
      }
    },
    close() {
      clearInterval(reaper);
      stream?.end();
      stream = null;
      settleAll(REMOTE_TIMEOUT_TEXT);
    },
  };
}
