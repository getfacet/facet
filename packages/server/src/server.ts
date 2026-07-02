import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type AgentEventFrame,
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { FacetRuntime, type Sink, type StageStore } from "@facet/runtime";

/**
 * The reference Facet transport: a tiny Node server carrying events to an agent
 * and streaming patches back — dependency-free (Node http only).
 *
 * Two channels, both SSE + POST so an agent behind NAT only ever dials OUT:
 * - browser side: `GET /stream?visitorId=…` (SSE) + `POST /event`.
 * - agent side:   `GET /agent/stream?agentId=…` (SSE) + `POST /agent/control`.
 *
 * An external agent that holds `/agent/stream` becomes the brain for `agentId`;
 * it is exposed to the runtime as an ordinary `FacetAgent` (see RemoteAgent), so
 * the runtime treats remote and in-process agents identically. If no external
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
  readonly agentId: string;
  /** In-process fallback used when no external agent is connected. */
  readonly agent?: FacetAgent;
  /** How long to wait for a remote agent's control response (default 120s — a
   * persistent session's cold first turn includes model + MCP startup). */
  readonly agentTimeoutMs?: number;
  /** Shared secret required on the `/agent/*` channel. When set, an agent must send a matching `x-facet-token` header. */
  readonly agentToken?: string;
  /** Page shown to a fresh visitor when no agent is connected (the offline face). */
  readonly offlineFace?: FacetTree;
  /** Where the page lives — defaults to in-memory. Pass a durable one to survive restarts. */
  readonly stageStore?: StageStore;
  /** Where the conversation goes — store, forward, or drop. Defaults to in-memory. */
  readonly sink?: Sink;
}

const DEFAULT_OFFLINE_FACE: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      style: { direction: "col", gap: "sm", pad: "2xl", align: "center" },
      children: ["o1", "o2"],
    },
    o1: {
      id: "o1",
      type: "text",
      value: "This page is offline right now",
      style: { size: "xl", weight: "bold" },
    },
    o2: {
      id: "o2",
      type: "text",
      value: "Its agent isn't connected. Check back soon.",
      style: { color: "fg-muted" },
    },
  },
};

export interface FacetServer {
  listen(): Promise<void>;
  close(): Promise<void>;
}

interface Pending {
  readonly resolve: (messages: readonly ServerMessage[]) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sse(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Max accepted request body. A single-operator reference transport still shouldn't
 * buffer an unbounded upload into memory, so both POST channels (/event and
 * /agent/control) cap here. Raise it if a legitimate payload (a large stage patch)
 * grows past this; lower it to tighten the DoS surface. */
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB

function readJson(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    // utf8 decoding must happen on the stream (a multibyte char split across
    // two chunks corrupts under per-chunk String()).
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > maxBytes) {
        // Past the cap: stop buffering, shed the rest of the upload, and reject so
        // the caller's existing `.catch` answers 400.
        reject(new Error("request body exceeds size cap"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Shape-check an untrusted browser /event body before trusting it — including
 * the per-kind payload (a kind-only check lets `{kind:"action"}` without an
 * action object crash downstream consumers, e.g. the persistent bridge). */
function isEventBody(body: unknown): body is { visitor: VisitorContext; event: ClientEvent } {
  if (typeof body !== "object" || body === null) return false;
  const { visitor, event } = body as { visitor?: unknown; event?: unknown };
  if (typeof visitor !== "object" || visitor === null) return false;
  if (typeof (visitor as { visitorId?: unknown }).visitorId !== "string") return false;
  if (typeof event !== "object" || event === null) return false;
  const { kind, text, action } = event as { kind?: unknown; text?: unknown; action?: unknown };
  if (kind === "visit") {
    const eventVisitor = (event as { visitor?: unknown }).visitor;
    return (
      typeof eventVisitor === "object" &&
      eventVisitor !== null &&
      typeof (eventVisitor as { visitorId?: unknown }).visitorId === "string"
    );
  }
  if (kind === "message") return typeof text === "string";
  if (kind === "action") {
    if (typeof action !== "object" || action === null) return false;
    if (typeof (action as { name?: unknown }).name !== "string") return false;
    const payload = (action as { payload?: unknown }).payload;
    if (payload === undefined) return true;
    // Mirror core's asAction: the payload must be a plain object (its `isObject`
    // excludes arrays and null), and every value a primitive — otherwise a nested
    // object or an array would pass a kind-only check and reach the agent.
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
    return Object.values(payload).every(
      (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
  }
  return false;
}

/** Shape-check an /agent/control body before resolving a pending request with it —
 * per-kind, so a malformed message can't smuggle a non-array `patches` or a
 * non-string `text` into the runtime and the browser. */
function isControlBody(
  body: unknown,
): body is { requestId: number; messages: readonly ServerMessage[] } {
  if (typeof body !== "object" || body === null) return false;
  const { requestId, messages } = body as { requestId?: unknown; messages?: unknown };
  if (typeof requestId !== "number") return false;
  if (!Array.isArray(messages)) return false;
  return messages.every((m) => {
    if (typeof m !== "object" || m === null) return false;
    const { kind, text, patches } = m as { kind?: unknown; text?: unknown; patches?: unknown };
    if (kind === "say") return typeof text === "string";
    if (kind === "patch") return Array.isArray(patches);
    return false;
  });
}

export function createFacetServer(options: FacetServerOptions): FacetServer {
  const timeoutMs = options.agentTimeoutMs ?? 120_000;
  const staleMs = 30_000; // reap an agent that hasn't sent a heartbeat this long
  const browserStreams = new Map<string, Set<ServerResponse>>();
  const pending = new Map<number, Pending>();
  let agentStream: ServerResponse | null = null;
  let lastHeartbeat = 0;
  let requestCounter = 0;

  const offlineFace = options.offlineFace ?? DEFAULT_OFFLINE_FACE;
  const offline = (text: string): readonly ServerMessage[] => [{ kind: "say", text }];

  /** Does this session already hold a real page (beyond an empty root)? */
  const hasBuiltStage = (session: FacetSession): boolean => {
    const root = session.stage.nodes[session.stage.root];
    if (session.stage.screens !== undefined && Object.keys(session.stage.screens).length > 0) {
      return true;
    }
    return root !== undefined && "children" in root && root.children.length > 0;
  };

  /** What a visitor gets when no agent is connected: the offline face on a FRESH
   * visit, a short note otherwise. A RETURNING visitor's built page must never be
   * overwritten (the offline patch would be persisted over their real stage). */
  const offlineFor = (event: ClientEvent, session?: FacetSession): readonly ServerMessage[] =>
    event.kind === "visit" && (session === undefined || !hasBuiltStage(session))
      ? [{ kind: "patch", patches: [{ op: "replace", path: "", value: offlineFace }] }]
      : [{ kind: "say", text: "This page's agent is offline right now — check back soon." }];

  const dropAgent = (reason: string): void => {
    if (agentStream === null) return;
    agentStream = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.resolve(offline(reason));
      pending.delete(id);
    }
  };

  /** The remote agent, presented to the runtime as a normal FacetAgent. */
  const remoteAgent: FacetAgent = (event: ClientEvent, session: FacetSession) => {
    const stream = agentStream;
    if (stream === null) {
      return offlineFor(event, session);
    }
    const requestId = (requestCounter += 1);
    return new Promise<readonly ServerMessage[]>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(offline("(agent timed out)"));
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      const frame: AgentEventFrame = {
        type: "event",
        requestId,
        visitorId: session.visitor.visitorId,
        event,
        stage: session.stage,
      };
      sse(stream, frame);
    });
  };

  const agent: FacetAgent = (event, session) =>
    agentStream !== null
      ? remoteAgent(event, session)
      : options.agent !== undefined
        ? options.agent(event, session)
        : offlineFor(event, session);

  const runtime = new FacetRuntime({
    agentId: options.agentId,
    agent,
    ...(options.stageStore !== undefined ? { stageStore: options.stageStore } : {}),
    ...(options.sink !== undefined ? { sink: options.sink } : {}),
  });

  const pushToBrowser = (visitorId: string, messages: readonly ServerMessage[]): void => {
    const connections = browserStreams.get(visitorId);
    if (connections === undefined) return;
    for (const res of connections) {
      for (const message of messages) sse(res, message);
    }
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
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
      res.end(agentStream !== null ? "ok agent=remote" : "ok agent=local");
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
      // Re-hydrate a (re)connecting viewer — current page (full replace), then past
      // chat — and WRITE those frames BEFORE joining the live fan-out set. Joining
      // first (as before) let a stale full-replace, snapshotted before a concurrent
      // live patch, resolve afterwards and roll the viewer back to the old stage.
      //
      // RESIDUAL (frames landing in the snapshot-read→set-join window below are not
      // re-sent to this connection): a `say` produced in the window can be LOST here
      // (historyFor reads the sink directly while handleOne records fire-and-forget,
      // so the say may not be persisted yet AND arrives before we join); an
      // incremental patch produced in the window is dropped, and since the client's
      // applyPatch throws on the now-stale tree the viewer only catches up on the
      // NEXT reconnect (a fresh full-snapshot replay), not the next event. Accepted
      // for now; the full fix (version/seq gating on frames) is deferred to a later
      // round per the recorded waiver.
      void (async () => {
        const stage = await runtime.stageFor(visitorId);
        if (closed) return;
        if (stage !== undefined) {
          sse(res, { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] });
        }
        for (const entry of await runtime.historyFor(visitorId)) {
          if (closed) return;
          for (const message of entry.messages) {
            if (message.kind === "say") sse(res, message);
          }
        }
        if (closed) return;
        let set = browserStreams.get(visitorId);
        if (set === undefined) {
          set = new Set();
          browserStreams.set(visitorId, set);
        }
        set.add(res);
      })().catch((error: unknown) => {
        // Rehydrate failed BEFORE the connection joined the fan-out set — logging
        // alone would strand the viewer on a healthy-looking SSE stream that never
        // gets patches and never reconnects (the server only pings agent streams).
        // End the response so EventSource auto-reconnects and retries the rehydrate.
        console.error("[facet] rehydrate failed:", error);
        res.end();
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      readJson(req)
        .then((body) => {
          if (!isEventBody(body)) {
            res.writeHead(400);
            res.end();
            return;
          }
          const { visitor, event } = body;
          res.writeHead(202);
          res.end();
          void runtime
            .handle(visitor, event)
            .then((messages) => pushToBrowser(visitor.visitorId, messages))
            .catch((error: unknown) => {
              // Don't leave the visitor staring at a 202 that went nowhere.
              console.error("[facet] handle failed:", error);
              pushToBrowser(visitor.visitorId, [
                { kind: "say", text: "(the agent hit an error — try again)" },
              ]);
            });
        })
        .catch(() => {
          res.writeHead(400);
          res.end();
        });
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
      if (agentStream !== null) {
        res.writeHead(409, { "Content-Type": "text/plain" });
        res.end("agent already connected");
        return;
      }
      res.writeHead(200, streamHeaders);
      res.write(": agent connected\n\n");
      agentStream = res;
      lastHeartbeat = Date.now();
      req.on("close", () => {
        if (agentStream === res) dropAgent("(agent disconnected)");
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/heartbeat") {
      lastHeartbeat = Date.now();
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/control") {
      readJson(req)
        .then((body) => {
          if (!isControlBody(body)) {
            res.writeHead(400);
            res.end();
            return;
          }
          const { requestId, messages } = body;
          const p = pending.get(requestId);
          if (p !== undefined) {
            clearTimeout(p.timer);
            pending.delete(requestId);
            p.resolve(messages);
          }
          res.writeHead(202);
          res.end();
        })
        .catch(() => {
          res.writeHead(400);
          res.end();
        });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // Liveness: keep the agent stream warm and reap it if heartbeats stop (covers
  // a half-open connection where the agent's machine died without a clean close).
  const reaper = setInterval(() => {
    if (agentStream === null) return;
    if (Date.now() - lastHeartbeat > staleMs) {
      agentStream.end();
      dropAgent("(agent went quiet)");
      return;
    }
    agentStream.write(": ping\n\n");
  }, 10_000);

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        const onError = (error: Error): void => reject(error); // e.g. EADDRINUSE
        server.once("error", onError);
        server.listen(options.port, () => {
          server.removeListener("error", onError);
          resolve();
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(reaper);
        // End held-open SSE connections first, or server.close() never resolves.
        agentStream?.end();
        for (const set of browserStreams.values()) {
          for (const res of set) res.end();
        }
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}
