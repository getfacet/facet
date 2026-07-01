import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
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
 */
export interface FacetServerOptions {
  readonly port: number;
  readonly agentId: string;
  /** In-process fallback used when no external agent is connected. */
  readonly agent?: FacetAgent;
  /** How long to wait for a remote agent's control response (default 60s). */
  readonly agentTimeoutMs?: number;
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

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
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

export function createFacetServer(options: FacetServerOptions): FacetServer {
  const timeoutMs = options.agentTimeoutMs ?? 60_000;
  const staleMs = 30_000; // reap an agent that hasn't sent a heartbeat this long
  const browserStreams = new Map<string, Set<ServerResponse>>();
  const pending = new Map<number, Pending>();
  let agentStream: ServerResponse | null = null;
  let lastHeartbeat = 0;
  let requestCounter = 0;

  const offlineFace = options.offlineFace ?? DEFAULT_OFFLINE_FACE;
  const offline = (text: string): readonly ServerMessage[] => [{ kind: "say", text }];

  /** What a visitor gets when no agent is connected: the offline face on a fresh
   * visit, a short note otherwise. */
  const offlineFor = (event: ClientEvent): readonly ServerMessage[] =>
    event.kind === "visit"
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
      return offlineFor(event);
    }
    const requestId = (requestCounter += 1);
    return new Promise<readonly ServerMessage[]>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(offline("(agent timed out)"));
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      sse(stream, {
        type: "event",
        requestId,
        visitorId: session.visitor.visitorId,
        event,
        stage: session.stage,
      });
    });
  };

  const agent: FacetAgent = (event, session) =>
    agentStream !== null
      ? remoteAgent(event, session)
      : options.agent !== undefined
        ? options.agent(event, session)
        : offlineFor(event);

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
    setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
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
      let set = browserStreams.get(visitorId);
      if (set === undefined) {
        set = new Set();
        browserStreams.set(visitorId, set);
      }
      set.add(res);
      // Re-hydrate a (re)connecting viewer: the current page, then past chat.
      const stage = runtime.stageFor(visitorId);
      if (stage !== undefined) {
        sse(res, { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] });
      }
      for (const entry of runtime.historyFor(visitorId)) {
        for (const message of entry.messages) {
          if (message.kind === "say") sse(res, message);
        }
      }
      req.on("close", () => set?.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      readJson(req)
        .then((body) => {
          const { visitor, event } = body as { visitor: VisitorContext; event: ClientEvent };
          res.writeHead(202);
          res.end();
          void runtime
            .handle(visitor, event)
            .then((messages) => pushToBrowser(visitor.visitorId, messages))
            .catch((error: unknown) => console.error("[facet] handle failed:", error));
        })
        .catch(() => {
          res.writeHead(400);
          res.end();
        });
      return;
    }

    // ── agent side ────────────────────────────────────────────────
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
          const { requestId, messages } = body as {
            requestId: number;
            messages: readonly ServerMessage[];
          };
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
      new Promise((resolve) => {
        server.listen(options.port, () => resolve());
      }),
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(reaper);
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
