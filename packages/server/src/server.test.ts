import { afterEach, describe, expect, it } from "vitest";
import type { FacetAgent } from "@facet/core";
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
