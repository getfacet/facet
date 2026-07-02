import { afterEach, describe, expect, it } from "vitest";
import type { FacetAgent, FacetSession, FacetTree, VisitorContext } from "@facet/core";
import { MemoryStageStore, type StageStore } from "@facet/runtime";
import { createFacetServer, type FacetServer } from "./server.js";

const sayAgent: FacetAgent = () => [{ kind: "say", text: "hello from agent" }];

/** Bind to a random high port, retrying on collisions. */
async function start(
  options: Omit<Parameters<typeof createFacetServer>[0], "port">,
): Promise<{ server: FacetServer; base: string }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const server = createFacetServer({ ...options, port });
    try {
      await server.listen();
      return { server, base: `http://127.0.0.1:${port}` };
    } catch {
      // EADDRINUSE — try another port
    }
  }
  throw new Error("could not bind a test port");
}

/** Read SSE frames from a /stream response until `count` data lines arrived. */
async function readFrames(response: Response, count: number): Promise<unknown[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: unknown[] = [];
  let buffer = "";
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (chunk.startsWith("data: ")) frames.push(JSON.parse(chunk.slice(6)));
      index = buffer.indexOf("\n\n");
    }
  }
  await reader.cancel();
  return frames;
}

/** Collect SSE data frames for a bounded window, then stop (the stream stays open,
 * so a count-based reader would block — here we want "whatever arrived in `ms`"). */
async function collectFrames(response: Response, ms: number): Promise<unknown[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: unknown[] = [];
  let buffer = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()));
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === null || chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (line.startsWith("data: ")) frames.push(JSON.parse(line.slice(6)));
        index = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel();
  }
  return frames;
}

/** Poll `predicate` until it's true or the window elapses. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timed out");
}

/** Wraps a StageStore so only `get` (the rehydrate read) is delayed — `open`/`save`
 * (the /event write path) stay fast, opening the reconnect race window on purpose.
 * The snapshot is captured NOW (before the racing write commits) but returned LATE,
 * modelling a stale rehydrate that resolves after a newer live patch has shipped. */
class DelayedGetStore implements StageStore {
  constructor(
    private readonly inner: StageStore,
    private readonly delayMs: number,
  ) {}
  async get(agentId: string, visitorId: string): Promise<FacetSession | undefined> {
    const snapshot = await this.inner.get(agentId, visitorId);
    await new Promise((r) => setTimeout(r, this.delayMs));
    return snapshot;
  }
  open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    return this.inner.open(agentId, visitor);
  }
  save(session: FacetSession): Promise<void> {
    return this.inner.save(session);
  }
}

/** Rejects the FIRST `get` (a rehydrate failure) then delegates — the second
 * connection's rehydrate succeeds, modelling a transient store error + reconnect. */
class FailOnceGetStore implements StageStore {
  private failed = false;
  constructor(private readonly inner: StageStore) {}
  async get(agentId: string, visitorId: string): Promise<FacetSession | undefined> {
    if (!this.failed) {
      this.failed = true;
      throw new Error("transient store failure");
    }
    return this.inner.get(agentId, visitorId);
  }
  open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    return this.inner.open(agentId, visitor);
  }
  save(session: FacetSession): Promise<void> {
    return this.inner.save(session);
  }
}

/** Resolves `true` if the server ends the SSE response within `ms`, else `false`
 * (the stream is still open). Data/comment frames are ignored — only closure matters. */
async function streamEnded(response: Response, ms: number): Promise<boolean> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()));
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === null) return false; // window elapsed, stream still open
      if (chunk.done) return true; // server ended the response
    }
    return false;
  } finally {
    await reader.cancel();
  }
}

let running: FacetServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("browser channel", () => {
  it("answers /health", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok agent=local");
  });

  it("rejects /stream without a visitorId", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await fetch(`${base}/stream`);
    expect(response.status).toBe(400);
  });

  it("rejects malformed and mis-shaped /event bodies", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const post = (body: string): Promise<Response> =>
      fetch(`${base}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ event: { kind: "visit" } }))).status).toBe(400); // no visitor
    expect(
      (await post(JSON.stringify({ visitor: { visitorId: "v" }, event: { kind: "nope" } }))).status,
    ).toBe(400);
  });

  it("delivers the agent's reply over the visitor's SSE stream", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const stream = await fetch(`${base}/stream?visitorId=v`);
    expect(stream.status).toBe(200);

    const accepted = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: { visitorId: "v" }, event: { kind: "message", text: "hi" } }),
    });
    expect(accepted.status).toBe(202);

    const frames = await readFrames(stream, 1);
    expect(frames[0]).toEqual({ kind: "say", text: "hello from agent" });
  });

  it("only sends CORS headers on the browser channel", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const browser = await fetch(`${base}/health`);
    expect(browser.headers.get("access-control-allow-origin")).toBe("*");
    const agent = await fetch(`${base}/agent/heartbeat`, { method: "POST" });
    expect(agent.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("agent channel", () => {
  it("gates /agent/* behind the shared token when configured", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent, agentToken: "s3cret" });
    running = server;
    const anonymous = await fetch(`${base}/agent/heartbeat`, { method: "POST" });
    expect(anonymous.status).toBe(403);
    const authed = await fetch(`${base}/agent/heartbeat`, {
      method: "POST",
      headers: { "x-facet-token": "s3cret" },
    });
    expect(authed.status).toBe(204);
  });

  it("serves the offline face to a visitor when no agent exists", async () => {
    const { server, base } = await start({ agentId: "a" }); // no in-process agent
    running = server;
    const stream = await fetch(`${base}/stream?visitorId=v`);
    await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "visit", visitor: { visitorId: "v" } },
      }),
    });
    const frames = (await readFrames(stream, 1)) as { kind: string }[];
    expect(frames[0]?.kind).toBe("patch"); // the offline face render
  });

  it("returns 404 for unknown routes", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe("hardening", () => {
  it("rehydrate cannot overwrite a newer live patch", async () => {
    const seedTree: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { direction: "col" }, children: ["t1"] },
        t1: { id: "t1", type: "text", value: "seed" },
      },
    };
    const agent: FacetAgent = (event) => {
      if (event.kind === "message" && event.text === "seed") {
        return [{ kind: "patch", patches: [{ op: "replace", path: "", value: seedTree }] }];
      }
      if (event.kind === "message" && event.text === "bump") {
        return [
          { kind: "patch", patches: [{ op: "replace", path: "/nodes/t1/value", value: "bumped" }] },
        ];
      }
      return [];
    };
    const inner = new MemoryStageStore();
    const stageStore = new DelayedGetStore(inner, 150);
    const { server, base } = await start({ agentId: "a", agent, stageStore });
    running = server;

    const post = (text: string): Promise<Response> =>
      fetch(`${base}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitor: { visitorId: "v" }, event: { kind: "message", text } }),
      });

    // Seed a stored stage to rehydrate FROM (no stream connected yet — just persist).
    await post("seed");
    await waitFor(async () => (await inner.get("a", "v"))?.stage.nodes["t1"] !== undefined);

    // Open the (re)connecting viewer, then immediately fire a newer live patch. The
    // stale rehydrate snapshot (delayed 150ms) resolves AFTER the bump has shipped.
    const stream = await fetch(`${base}/stream?visitorId=v`);
    expect(stream.status).toBe(200);
    await post("bump");

    const frames = (await collectFrames(stream, 500)) as {
      kind?: string;
      patches?: { path?: string }[];
    }[];
    const isFullReplace = (f: (typeof frames)[number]): boolean =>
      f.kind === "patch" && f.patches?.[0]?.path === "";
    const isLivePatch = (f: (typeof frames)[number]): boolean =>
      f.kind === "patch" && f.patches?.[0]?.path === "/nodes/t1/value";
    const fullIdx = frames.findIndex(isFullReplace);
    const liveIdx = frames.findIndex(isLivePatch);

    expect(fullIdx).toBeGreaterThanOrEqual(0); // the full-replace rehydrate must arrive
    // …and it must precede any live patch (a stale full-replace after a newer patch
    // would silently roll the viewer back).
    expect(liveIdx === -1 || fullIdx < liveIdx).toBe(true);
  });

  it("ends the stream when rehydrate fails, so the viewer can reconnect", async () => {
    const stageStore = new FailOnceGetStore(new MemoryStageStore());
    const { server, base } = await start({ agentId: "a", agent: sayAgent, stageStore });
    running = server;

    // First connect: the rehydrate `get` throws — the response must END rather than
    // stay open forever (a frozen viewer the server never pings or reconnects).
    const first = await fetch(`${base}/stream?visitorId=v`);
    expect(first.status).toBe(200);
    expect(await streamEnded(first, 1_000)).toBe(true);

    // Reconnect: the second `get` succeeds, so the stream stays open (stays healthy).
    const second = await fetch(`${base}/stream?visitorId=v`);
    expect(second.status).toBe(200);
    expect(await streamEnded(second, 300)).toBe(false);
  });

  it("rejects an /event action payload that is an array", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "action", action: { name: "buy", payload: ["a", "b"] } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an /event action payload with a non-primitive value", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "action", action: { name: "buy", payload: { nested: { deep: 1 } } } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an oversized /event body", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // A well-shaped body over the 5 MiB cap: without the cap this would 202.
    const huge = "x".repeat(6 * 1024 * 1024);
    let status = 0;
    try {
      const response = await fetch(`${base}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor: { visitorId: "v" },
          event: { kind: "message", text: huge },
        }),
      });
      status = response.status;
    } catch {
      // A reset mid-upload also means "not accepted" — the cap fired.
      status = 400;
    }
    expect(status).toBe(400);
  });
});
