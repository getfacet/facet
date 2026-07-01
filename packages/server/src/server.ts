import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { FacetRuntime } from "@facet/runtime";

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
}

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
  const browserStreams = new Map<string, Set<ServerResponse>>();
  const pending = new Map<number, Pending>();
  let agentStream: ServerResponse | null = null;
  let requestCounter = 0;

  const offline = (text: string): readonly ServerMessage[] => [{ kind: "say", text }];

  /** The remote agent, presented to the runtime as a normal FacetAgent. */
  const remoteAgent: FacetAgent = (event: ClientEvent, session: FacetSession) => {
    const stream = agentStream;
    if (stream === null) {
      return offline("(no agent connected)");
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
      });
    });
  };

  const agent: FacetAgent = (event, session) =>
    agentStream !== null
      ? remoteAgent(event, session)
      : options.agent !== undefined
        ? options.agent(event, session)
        : offline("(no agent connected)");

  const runtime = new FacetRuntime({ agentId: options.agentId, agent });

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
      const stage = runtime.stageFor(visitorId);
      if (stage !== undefined) {
        sse(res, { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] });
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
      req.on("close", () => {
        if (agentStream === res) agentStream = null;
        for (const [id, p] of pending) {
          clearTimeout(p.timer);
          p.resolve(offline("(agent disconnected)"));
          pending.delete(id);
        }
      });
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

  return {
    listen: () =>
      new Promise((resolve) => {
        server.listen(options.port, () => resolve());
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
