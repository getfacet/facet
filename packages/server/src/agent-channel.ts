import type { ServerResponse } from "node:http";
import type {
  AgentEventFrame,
  ClientEvent,
  FacetAgent,
  FacetSession,
  FacetTree,
  ServerMessage,
} from "@facet/core";
import type { LateWindow } from "./late.js";
import { offlineFor } from "./offline.js";
import { writeSse } from "./sse.js";

/** The non-terminal note delivered when a turn outlives `agentTimeoutMs`: it must
 * NOT read as terminal, because the turn is parked and its real result will still
 * arrive via the late path (A-3). */
const INTERIM_TIMEOUT_SAY =
  "(still working — this is taking longer than usual; the answer will appear here when it's ready)";

interface Pending {
  readonly resolve: (messages: readonly ServerMessage[]) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  // The turn's origin, kept so a timed-out request can be re-applied late: a
  // later /agent/control for this id re-injects its messages through the runtime.
  readonly visitor: FacetSession["visitor"];
  readonly event: ClientEvent;
  // The per-visitor arrival index of this turn's event, used to detect a NEWER
  // turn that has already applied before a late result lands (see `lastApplied`).
  readonly index: number;
  // The frame-log era at park time (see the parked-turn note in late.ts).
  readonly era: string;
}

/** Everything the agent channel needs from its host, injected so the channel owns
 * no HTTP routing and no frame-log internals. */
export interface AgentChannelDeps {
  /** How long to wait for a remote agent's control response (default 120s). */
  readonly agentTimeoutMs: number | undefined;
  /** How long an agent stream may go without a heartbeat before it's reaped
   * (default 30s). The reaper polls at `min(10s, agentStaleMs)`. */
  readonly agentStaleMs: number | undefined;
  /** In-process fallback used when no external agent is connected. */
  readonly fallbackAgent: FacetAgent | undefined;
  /** The configured offline face (fresh-visit fallback). */
  readonly offlineFace: FacetTree;
  /** The shared late-delivery window: timed-out/dropped turns park here. */
  readonly lateWindow: LateWindow;
  /** The arrival index + era of the turn currently being handled for a visitor,
   * read at park time so a late result can be compared against newer turns and
   * detected as stale across a frame-log re-mint. */
  readonly handlingContext: (visitorId: string) => { readonly index: number; readonly era: string };
}

/** The agent-side link: the external agent presented to the runtime as a normal
 * `FacetAgent`, plus the attach/heartbeat/resolve/drop/close seams server.ts wires
 * into its `/agent/*` routes and lifecycle. */
export interface AgentChannel {
  /** The agent presented to the runtime: the remote agent when one is connected,
   * else the in-process fallback, else the offline face. */
  readonly agent: FacetAgent;
  /** Adopt an agent SSE stream (already `writeHead`-ed by the caller) as the live
   * link and start its heartbeat clock. */
  attach(res: ServerResponse): void;
  /** Whether a remote agent is currently connected (for /health and the 409 guard). */
  isConnected(): boolean;
  /** Record an agent heartbeat. */
  heartbeat(): void;
  /** Settle an in-time pending turn with the agent's messages; returns true if a
   * pending existed (its lane task applies + delivers), false if none — the caller
   * then checks the late window. */
  resolve(requestId: number, messages: readonly ServerMessage[]): boolean;
  /** Drop the link IFF `res` is still the live stream (the stream-close handler),
   * parking every in-flight turn so a reconnecting agent can still land it late. */
  dropIfCurrent(res: ServerResponse, reason: string): void;
  /** Stop the reaper and end the agent stream (server close()). */
  close(): void;
}

export function createAgentChannel(deps: AgentChannelDeps): AgentChannel {
  const timeoutMs = deps.agentTimeoutMs ?? 120_000;
  // Same fail-fast posture as agentStaleMs below: 0/negative/NaN would fire the
  // interim timeout immediately on every turn (each request parks + says
  // "still working") — a misconfig, not a mode.
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`agentTimeoutMs must be a positive integer (got ${String(timeoutMs)})`);
  }
  const staleMs = deps.agentStaleMs ?? 30_000; // reap an agent quiet this long
  // Fail-fast on a misconfigured knob (config-time, same posture as parseBridgePort):
  // 0/negative would make the reaper interval `min(10s, staleMs)` fire on ~0ms ticks
  // and reap healthy agents. A positive integer of ms is required; sub-second values
  // are the operator's call.
  if (!Number.isInteger(staleMs) || staleMs < 1) {
    throw new Error(
      `agentStaleMs must be a positive integer of milliseconds; got ${String(deps.agentStaleMs)}`,
    );
  }

  const pending = new Map<number, Pending>();
  let agentStream: ServerResponse | null = null;
  let lastHeartbeat = 0;
  let requestCounter = 0;

  const offline = (text: string): readonly ServerMessage[] => [{ kind: "say", text }];

  const dropAgent = (reason: string): void => {
    if (agentStream === null) return;
    agentStream = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      // Resolve the in-flight HTTP wait with the terminal offline note (as before),
      // AND park the turn so an agent that reconnects and posts the finished work
      // still lands it via the late path.
      deps.lateWindow.park(id, { visitor: p.visitor, event: p.event, index: p.index, era: p.era });
      p.resolve(offline(reason));
      pending.delete(id);
    }
  };

  /** The remote agent, presented to the runtime as a normal FacetAgent. */
  const remoteAgent: FacetAgent = (event: ClientEvent, session: FacetSession) => {
    const stream = agentStream;
    if (stream === null) {
      return offlineFor(deps.offlineFace, event, session);
    }
    const requestId = (requestCounter += 1);
    // The arrival index + era of the turn currently being handled for this visitor
    // (index set by the /event lane task before it awaits the agent) — tagged onto
    // the park so a late result can be compared against newer turns AND detected as
    // stale if the frame log was re-minted (era change) in between.
    const { index, era } = deps.handlingContext(session.visitor.visitorId);
    return new Promise<readonly ServerMessage[]>((resolve) => {
      const timer = setTimeout(() => {
        // The turn outlived the wait: resolve it with a NON-terminal interim note
        // and park it, so a later /agent/control still applies + delivers the real
        // answer (late path). Exactly one of {in-time resolve, this} runs per id.
        pending.delete(requestId);
        deps.lateWindow.park(requestId, { visitor: session.visitor, event, index, era });
        resolve([{ kind: "say", text: INTERIM_TIMEOUT_SAY }]);
      }, timeoutMs);
      pending.set(requestId, { resolve, timer, visitor: session.visitor, event, index, era });
      const frame: AgentEventFrame = {
        type: "event",
        requestId,
        visitorId: session.visitor.visitorId,
        event,
        stage: session.stage,
      };
      // A no-id SSE frame (the agent channel never carries a Last-Event-ID) — same
      // shared `writeSse` writer as the browser channel, so the wire shape can't drift.
      writeSse(stream, { data: frame });
    });
  };

  const agent: FacetAgent = (event, session) =>
    agentStream !== null
      ? remoteAgent(event, session)
      : deps.fallbackAgent !== undefined
        ? deps.fallbackAgent(event, session)
        : offlineFor(deps.offlineFace, event, session);

  // Liveness: keep the agent stream warm and reap it if heartbeats stop (covers
  // a half-open connection where the agent's machine died without a clean close).
  const reaper = setInterval(
    () => {
      if (agentStream === null) return;
      if (Date.now() - lastHeartbeat > staleMs) {
        agentStream.end();
        dropAgent("(agent went quiet)");
        return;
      }
      agentStream.write(": ping\n\n");
    },
    Math.min(10_000, staleMs),
  );

  return {
    agent,
    attach(res) {
      agentStream = res;
      lastHeartbeat = Date.now();
    },
    isConnected: () => agentStream !== null,
    heartbeat() {
      lastHeartbeat = Date.now();
    },
    resolve(requestId, messages) {
      const p = pending.get(requestId);
      if (p === undefined) return false;
      // In-time: resolve the still-waiting turn; its lane task applies + delivers.
      clearTimeout(p.timer);
      pending.delete(requestId);
      p.resolve(messages);
      return true;
    },
    dropIfCurrent(res, reason) {
      if (agentStream === res) dropAgent(reason);
    },
    close() {
      clearInterval(reaper);
      agentStream?.end();
    },
  };
}
