import { createServer, type Server, type ServerResponse } from "node:http";
import {
  createSerialQueue,
  type FacetAgent,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";
import { FacetRuntime, type Sink, type StageStore } from "@facet/runtime";
import { createAgentChannel } from "./agent-channel.js";
import { createFrameLogStore, type FrameLogStore } from "./frame-log.js";
import { createLateWindow, LATE_WINDOW_LIMIT } from "./late.js";
import type { FacetServerObserver } from "./observer.js";
import { DEFAULT_OFFLINE_FACE } from "./offline.js";
import { handleControl, handleEvent, handleRecord } from "./server-post.js";
import {
  pruneUnrecoverableHandlingTurns,
  rehydrate,
  resumeStream,
  writeFrame,
  type HandlingTurn,
  type PostHandlerDeps,
} from "./server-rehydrate.js";

export type { FacetServerObservation, FacetServerObserver } from "./observer.js";

/**
 * The reference Facet transport: a tiny Node server carrying events to an agent
 * and streaming patches back — dependency-free (Node http only).
 *
 * Two channels, both SSE + POST so an agent behind NAT only ever dials OUT:
 * - browser side: `GET /stream?visitorId=…` (SSE) + `POST /event`.
 * - agent side:   `GET /agent/stream?agentId=…` (SSE) + `POST /agent/control`.
 *
 * An external agent that holds `/agent/stream` becomes the brain for `agentId`;
 * it is exposed to the runtime as an ordinary `FacetAgent` (see the agent channel),
 * so the runtime treats remote and in-process agents identically. If no external
 * agent is connected, the optional in-process `agent` is used as a fallback.
 *
 * TRUST MODEL: this is a REFERENCE transport for local/self-hosted single-operator
 * use with public/anonymous pages — NOT a hardened multi-tenant server. By default
 * the `/agent/*` channel is unauthenticated (set `agentToken` to require a secret)
 * and `visitorId` is trusted verbatim as the session key. Put your own auth in
 * front of it for multi-tenant or sensitive-per-visitor deployments. See SECURITY.md.
 */
export interface FacetServerOptions {
  readonly port: number;
  /** Bind address passed to `listen` (default: all interfaces, unchanged). Set
   * `"127.0.0.1"` for a loopback-only server (e.g. an internal instance behind
   * a wrapper). */
  readonly host?: string;
  readonly agentId: string;
  /** In-process fallback used when no external agent is connected. */
  readonly agent?: FacetAgent;
  /** How long to wait for a remote agent's control response (default 120s — a
   * persistent session's cold first turn includes model + MCP startup). A turn
   * that outlives this gets a non-terminal interim note; its real result is
   * delivered late (see the late window) when the agent finally posts it. */
  readonly agentTimeoutMs?: number;
  /** How long an agent stream may go without a heartbeat before it's reaped
   * (default 30s). The reaper polls at `min(10s, agentStaleMs)`. */
  readonly agentStaleMs?: number;
  /** Shared secret required on the `/agent/*` channel. When set, an agent must send a matching `x-facet-token` header. */
  readonly agentToken?: string;
  /** Page shown to a fresh visitor when no agent is connected (the offline face). */
  readonly offlineFace?: FacetTree;
  /** Where the page lives — defaults to in-memory. Pass a durable one to survive restarts. */
  readonly stageStore?: StageStore;
  /** Where the conversation goes — store, forward, or drop. Defaults to in-memory. */
  readonly sink?: Sink;
  /** Optional detached/frozen UI-IN and accepted-frame diagnostics. The callback
   * is non-controlling: throws and attempted payload mutation are ignored. */
  readonly observer?: FacetServerObserver;
}

export interface FacetServer {
  listen(): Promise<void>;
  close(): Promise<void>;
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Last-Event-ID is NOT a CORS-safelisted request header: without it here, a
  // cross-origin EventSource reconnect (which carries the header after the first
  // stamped frame) would fail preflight and never resume. Content-Type covers the
  // POST channels.
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
}

export function createFacetServer(options: FacetServerOptions): FacetServer {
  const offlineFace = options.offlineFace ?? DEFAULT_OFFLINE_FACE;
  // Live browser connections per visitor (the fan-out set for `deliver`).
  const browserStreams = new Map<string, Set<ServerResponse>>();
  // Per-session replay log (server-local — the Sink is NOT the replay store) and the
  // bounded late-delivery window for parked timed-out/dropped turns.
  const frameLog: FrameLogStore = createFrameLogStore();
  // Arrival + frame ranges for turns whose Sink record may not be visible to
  // rehydrate history yet — server-local so an LRU eviction of the frame log can't
  // detach them mid-turn. Multiple same-visitor turns can be pending when a durable
  // Sink is slow; each is removed once its reserved record slot settles.
  const handling = new Map<string, HandlingTurn[]>();
  const lateWindow = createLateWindow(LATE_WINDOW_LIMIT);
  // Per-visitor delivery lane: serializes {apply → seq-assign → log → fan-out} so
  // apply-order equals delivery-order by construction. Live turns and late applies
  // are lane tasks; the replay/rehydrate paths run synchronously and never assign seqs.
  const lane = createSerialQueue<void>();

  // The agent-side link: validates the stale knob, owns the pending map + reaper, and
  // presents the remote/fallback/offline agent to the runtime.
  const channel = createAgentChannel({
    agentTimeoutMs: options.agentTimeoutMs,
    agentStaleMs: options.agentStaleMs,
    fallbackAgent: options.agent,
    offlineFace,
    lateWindow,
    // The active lane turn's arrival pair, from the last server-local pending range.
    // The empty-era fallback can never match a real era, so an unknown context
    // degrades toward falsely-stale — never false-fresh.
    handlingContext: (visitorId) => {
      const turns = handling.get(visitorId);
      return turns?.[turns.length - 1] ?? { index: -1, era: "" };
    },
  });

  const runtime = new FacetRuntime({
    agentId: options.agentId,
    agent: channel.agent,
    ...(options.stageStore !== undefined ? { stageStore: options.stageStore } : {}),
    ...(options.sink !== undefined ? { sink: options.sink } : {}),
  });

  /** Deliver messages to a visitor's browser channel — SYNCHRONOUS, no await. The
   * seq-assign + log-append half is delegated to the frame log (the only seq-assigning
   * path); this fans the stamped frames out to every live connection. Frames are
   * logged even with zero connections (that's the late-result-while-disconnected case
   * the resume path replays). Called ONLY from lane tasks. */
  const deliver = (visitorId: string, messages: readonly ServerMessage[]): void => {
    if (messages.length === 0) return;
    const stamped = frameLog.append(visitorId, messages);
    pruneUnrecoverableHandlingTurns(handling, visitorId, frameLog.logFor(visitorId));
    const connections = browserStreams.get(visitorId);
    if (connections === undefined) return;
    for (const { id, json } of stamped) {
      for (const res of connections) writeFrame(res, json, id);
    }
  };

  const postDeps: PostHandlerDeps = {
    lane,
    runtime,
    frameLog,
    deliver,
    handling,
    observer: options.observer,
  };

  const server: Server = createServer((req, res) => {
    // Node delivers malformed request-targets (e.g. `//[`) verbatim, and
    // `new URL` throws on them — an unguarded throw in this handler becomes an
    // uncaughtException that crashes the process. Reject them as 400 instead.
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    // CORS only on the browser channel — the /agent/* control channel is a
    // server-side (bridge) connection, not for cross-origin browser use, so don't
    // advertise it to arbitrary web origins.
    if (!url.pathname.startsWith("/agent/")) setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const streamHeaders = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(channel.isConnected() ? "ok agent=remote" : "ok agent=local");
      return;
    }

    // ── browser side ──────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/stream") {
      const visitorId = url.searchParams.get("visitorId");
      if (visitorId === null) {
        res.writeHead(400);
        res.end();
        return;
      }
      res.writeHead(200, streamHeaders);
      res.write(": connected\n\n");
      let closed = false;
      req.on("close", () => {
        closed = true;
        const set = browserStreams.get(visitorId);
        set?.delete(res);
        // Prune the empty Set so browserStreams doesn't grow unbounded.
        if (set?.size === 0) browserStreams.delete(visitorId);
      });
      const join = (): void => {
        let set = browserStreams.get(visitorId);
        if (set === undefined) {
          set = new Set();
          browserStreams.set(visitorId, set);
        }
        set.add(res);
      };

      const lastEventId = req.headers["last-event-id"];
      if (
        typeof lastEventId === "string" &&
        resumeStream(res, visitorId, lastEventId, frameLog, join)
      ) {
        return;
      }
      void rehydrate(res, visitorId, frameLog, runtime, handling, lane, () => closed, join);
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      handleEvent(req, res, postDeps);
      return;
    }

    if (req.method === "POST" && url.pathname === "/record") {
      handleRecord(req, res, postDeps);
      return;
    }

    // ── agent side ────────────────────────────────────────────────
    // The agent-side channel is a control surface for the link — gate it with the
    // shared token so a third party can't connect or inject control responses.
    if (url.pathname.startsWith("/agent/")) {
      if (options.agentToken !== undefined && req.headers["x-facet-token"] !== options.agentToken) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("forbidden");
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/agent/stream") {
      if (channel.isConnected()) {
        res.writeHead(409, { "Content-Type": "text/plain" });
        res.end("agent already connected");
        return;
      }
      res.writeHead(200, streamHeaders);
      res.write(": agent connected\n\n");
      channel.attach(res);
      req.on("close", () => channel.dropIfCurrent(res, "(agent disconnected)"));
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/heartbeat") {
      channel.heartbeat();
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/control") {
      handleControl(req, res, channel, lateWindow, postDeps);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        const onError = (error: Error): void => reject(error); // e.g. EADDRINUSE
        server.once("error", onError);
        const onListening = (): void => {
          server.removeListener("error", onError);
          resolve();
        };
        if (options.host !== undefined) server.listen(options.port, options.host, onListening);
        else server.listen(options.port, onListening);
      }),
    close: () =>
      new Promise((resolve, reject) => {
        // Stop the reaper and end the agent stream first, or server.close() never
        // resolves on the held-open SSE connections.
        channel.close();
        for (const set of browserStreams.values()) {
          for (const res of set) res.end();
        }
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}
