import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ClientEvent, ServerMessage, VisitorContext } from "@facet/core";
import type { FacetRuntime } from "@facet/runtime";

/**
 * The reference Facet transport: a tiny Node server that carries events to the
 * runtime and streams patches back.
 *
 * - `GET  /stream?visitorId=…` — Server-Sent Events; the viewer's live channel.
 *   On connect it sends a snapshot of the current stage (so reconnects and extra
 *   tabs immediately show the live page).
 * - `POST /event` — body `{ visitor, event }`; runs the runtime and pushes the
 *   resulting messages to every open stream for that visitor (the small fan-out).
 *
 * This is intentionally dependency-free (Node http only) and single-process. A
 * production deployment swaps the delivery layer for a durable/distributed one;
 * the runtime's `SessionStore` and this transport are the seams for that.
 */
export interface FacetServerOptions {
  readonly runtime: FacetRuntime;
  readonly port: number;
}

export interface FacetServer {
  listen(): Promise<void>;
  close(): Promise<void>;
}

interface EventBody {
  readonly visitor: VisitorContext;
  readonly event: ClientEvent;
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
  const { runtime, port } = options;
  const streams = new Map<string, Set<ServerResponse>>();

  const write = (res: ServerResponse, message: ServerMessage): void => {
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  };

  const push = (visitorId: string, messages: readonly ServerMessage[]): void => {
    const connections = streams.get(visitorId);
    if (connections === undefined) return;
    for (const res of connections) {
      for (const message of messages) write(res, message);
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

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method === "GET" && url.pathname === "/stream") {
      const visitorId = url.searchParams.get("visitorId");
      if (visitorId === null) {
        res.writeHead(400);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");

      let set = streams.get(visitorId);
      if (set === undefined) {
        set = new Set();
        streams.set(visitorId, set);
      }
      set.add(res);

      const stage = runtime.stageFor(visitorId);
      if (stage !== undefined) {
        write(res, { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] });
      }

      req.on("close", () => {
        set?.delete(res);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      readJson(req)
        .then((body) => {
          const { visitor, event } = body as EventBody;
          res.writeHead(202);
          res.end();
          void runtime
            .handle(visitor, event)
            .then((messages) => push(visitor.visitorId, messages))
            .catch((error: unknown) => console.error("[facet] handle failed:", error));
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
        server.listen(port, () => resolve());
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
