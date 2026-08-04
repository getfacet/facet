import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { FacetCatalog, FacetTheme, FacetThemeExtensionDeclaration } from "@facet/core";
import { FacetRuntime, MemorySink, MemoryStageStore, bootstrapSession } from "@facet/runtime";
import type { Sink, StageStore } from "@facet/runtime";
import { createAgentChannel } from "./agent-channel.js";
import { createFrameLogStore } from "./frame-log.js";
import type { FrameLogStore } from "./frame-log.js";
import { emitFacetServerObservation, type FacetServerObserver } from "./observer.js";
import { handleControl, handleEvent, handleMessage, type PostHandlerDeps } from "./server-post.js";
import { rehydrate, resumeStream, writeFrame } from "./server-rehydrate.js";

export type { FacetServerObservation, FacetServerObserver } from "./observer.js";

type FacetServerAgent = {
  run(
    context: Parameters<ConstructorParameters<typeof FacetRuntime>[0]["agent"]["run"]>[0],
  ):
    | Promise<string | { readonly text: string | null } | null | undefined>
    | string
    | { readonly text: string | null }
    | null
    | undefined;
};

export interface FacetServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly catalog: FacetCatalog;
  readonly theme: FacetTheme;
  readonly themeExtensions?: readonly FacetThemeExtensionDeclaration[];
  readonly copy?: unknown;
  readonly initialMarkup?: string;
  readonly agent?: FacetServerAgent | undefined;
  readonly agentTimeoutMs?: number | undefined;
  readonly turnTimeoutMs?: number | undefined;
  readonly agentToken?: string;
  readonly stageStore?: StageStore;
  readonly sink?: Sink;
  readonly observer?: FacetServerObserver;
}

export interface FacetServer {
  listen(): Promise<void>;
  close(): Promise<void>;
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
}

function sessionKeyFrom(url: URL): string | undefined {
  return url.searchParams.get("sessionKey") ?? undefined;
}

function resumeCursorFrom(
  req: IncomingMessage,
  url: URL,
):
  | { readonly ok: true; readonly cursor: string | undefined }
  | { readonly ok: false; readonly status: 400 } {
  const query = url.searchParams.getAll("lastEventId");
  const header = req.headers["last-event-id"];
  if (query.length > 1 || Array.isArray(header)) {
    return { ok: false, status: 400 };
  }
  const queryCursor = query[0];
  if (header !== undefined && queryCursor !== undefined && header !== queryCursor) {
    return { ok: false, status: 400 };
  }
  const cursor = header ?? queryCursor;
  return { ok: true, cursor: cursor === "" ? undefined : cursor };
}

export function createFacetServer(options: FacetServerOptions): FacetServer {
  const store = options.stageStore ?? new MemoryStageStore();
  const sink = options.sink ?? new MemorySink();
  const frameLog: FrameLogStore = createFrameLogStore();
  const streams = new Map<string, Set<ServerResponse>>();
  const runtimes = new Map<string, FacetRuntime>();
  const closeBrowserStreams = (): void => {
    for (const set of streams.values()) {
      for (const res of set) {
        try {
          res.end();
        } catch {
          // Best-effort shutdown: a response may already be closing.
        }
      }
    }
    streams.clear();
  };

  const boot = bootstrapSession({
    catalog: options.catalog,
    theme: options.theme,
    ...(options.themeExtensions === undefined ? {} : { themeExtensions: options.themeExtensions }),
    ...(options.copy === undefined ? {} : { copy: options.copy }),
    ...(options.initialMarkup === undefined ? {} : { initialMarkup: options.initialMarkup }),
  });
  if (!boot.ok) {
    throw new Error(`${boot.code}: ${boot.detail}`);
  }

  const ensureSession = async (sessionKey: string): Promise<void> => {
    if ((await store.get(sessionKey)) !== null) return;
    const saved = await store.save(sessionKey, boot.session, 0);
    if (!saved.ok && saved.currentRevision !== 0) {
      throw new Error("session bootstrap conflict");
    }
  };

  const fallbackAgent =
    options.agent === undefined
      ? undefined
      : {
          run: async (
            context: Parameters<ConstructorParameters<typeof FacetRuntime>[0]["agent"]["run"]>[0],
          ) => (await options.agent?.run(context)) ?? null,
        };

  const channel = createAgentChannel({
    ...(options.agentTimeoutMs === undefined ? {} : { agentTimeoutMs: options.agentTimeoutMs }),
    ...(options.turnTimeoutMs === undefined
      ? {}
      : { runtimeAuthorityTimeoutMs: options.turnTimeoutMs }),
    ...(fallbackAgent === undefined ? {} : { fallbackAgent }),
  });

  const runtimeFor = (sessionKey: string): FacetRuntime => {
    const existing = runtimes.get(sessionKey);
    if (existing !== undefined) return existing;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: channel.agent,
      ...(options.turnTimeoutMs === undefined ? {} : { turnTimeoutMs: options.turnTimeoutMs }),
      deliver: (entry) => {
        const stamped = frameLog.append(sessionKey, entry);
        emitFacetServerObservation(options.observer, {
          kind: "accepted-frame",
          sessionKey,
          frame: entry.frame,
          seq: entry.seq,
        });
        const live = streams.get(sessionKey);
        if (live === undefined) return;
        for (const res of live) writeFrame(res, stamped.json, stamped.id);
      },
      diagnostics: (diagnostic) =>
        emitFacetServerObservation(options.observer, {
          kind: "diagnostic",
          sessionKey: diagnostic.sessionKey,
          code: diagnostic.code,
          detail: diagnostic.detail,
        }),
    });
    runtimes.set(sessionKey, runtime);
    return runtime;
  };

  const postDeps: PostHandlerDeps = {
    runtimeFor,
    ensureSession,
    ...(options.observer === undefined ? {} : { observer: options.observer }),
  };

  const server: Server = createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    if (!url.pathname.startsWith("/agent/")) setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(channel.isConnected() ? "ok agent=remote" : "ok agent=local");
      return;
    }

    if (req.method === "GET" && url.pathname === "/stream") {
      const sessionKey = sessionKeyFrom(url);
      if (sessionKey === undefined) {
        res.writeHead(400);
        res.end();
        return;
      }
      const resumeCursor = resumeCursorFrom(req, url);
      if (!resumeCursor.ok) {
        res.writeHead(resumeCursor.status);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");

      let closed = false;
      const join = (): void => {
        let set = streams.get(sessionKey);
        if (set === undefined) {
          set = new Set();
          streams.set(sessionKey, set);
        }
        set.add(res);
      };
      req.on("close", () => {
        closed = true;
        const set = streams.get(sessionKey);
        set?.delete(res);
        if (set?.size === 0) streams.delete(sessionKey);
      });

      if (
        resumeCursor.cursor !== undefined &&
        resumeStream(res, sessionKey, resumeCursor.cursor, frameLog, join)
      ) {
        return;
      }
      void rehydrate(res, sessionKey, frameLog, store, sink, ensureSession, () => closed, join);
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      handleEvent(req, res, postDeps);
      return;
    }

    if (req.method === "POST" && url.pathname === "/message") {
      handleMessage(req, res, postDeps);
      return;
    }

    if (url.pathname.startsWith("/agent/")) {
      if (options.agentToken !== undefined && req.headers["x-facet-token"] !== options.agentToken) {
        res.writeHead(403);
        res.end();
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/agent/stream") {
      if (channel.isConnected()) {
        res.writeHead(409);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": agent connected\n\n");
      channel.attach(res);
      req.on("close", () => channel.dropIfCurrent(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/heartbeat") {
      channel.heartbeat();
      res.writeHead(202);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/control") {
      handleControl(req, res, channel);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          server.off("error", reject);
          resolve();
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        channel.close();
        closeBrowserStreams();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
