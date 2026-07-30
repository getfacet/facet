import type { ServerResponse } from "node:http";
import type { AgentControlFrame, AgentEvent, AgentEventFrame } from "@facet/core";
import { collectTurnOutcome, validateTurnOutcome } from "@facet/core";
import { offlineFor } from "./offline.js";
import { writeSse } from "./sse.js";

interface RuntimeContext {
  readonly event: AgentEvent;
}

interface RuntimeLikeAgent {
  run(context: RuntimeContext): Promise<string | { readonly text: string | null } | null>;
}

interface Pending {
  readonly eventId: string;
  readonly resolve: (result: { readonly text: string | null }) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface AgentChannelDeps {
  readonly agentTimeoutMs?: number;
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

export function createAgentChannel(deps: AgentChannelDeps = {}): AgentChannel {
  const requestedTimeoutMs = deps.agentTimeoutMs ?? RUNTIME_AUTHORITY_TIMEOUT_MS;
  const timeoutMs = Math.min(requestedTimeoutMs, RUNTIME_AUTHORITY_TIMEOUT_MS);
  const pending = new Map<string, Pending>();
  let stream: ServerResponse | null = null;
  let lastHeartbeat = Date.now();

  const settle = (eventId: string, text: string | null): boolean => {
    const turn = pending.get(eventId);
    if (turn === undefined) return false;
    clearTimeout(turn.timer);
    pending.delete(eventId);
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
      if (pending.has(event.eventId)) {
        return Promise.resolve({ text: REMOTE_TIMEOUT_TEXT });
      }
      const frame: AgentEventFrame = Object.freeze({ kind: "agent_event" as const, event });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(event.eventId, REMOTE_TIMEOUT_TEXT);
        }, timeoutMs);
        pending.set(event.eventId, {
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
      if (!pending.has(frame.eventId)) return false;
      const text = textFromControl(frame);
      if (text === undefined) return false;
      settle(frame.eventId, text);
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
