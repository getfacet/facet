/**
 * /live-test Tier 1a (spec Decision 7, DC-001 + DC-008) — the deterministic
 * stub E2E over the REAL boot path: `startQuickstart` (wrapper + loopback
 * proxy) driven by `createStubAgent`, a fixture page bundle injected via
 * `pageBundlePath`. Lives inside the root vitest glob on purpose, so plain
 * `pnpm test` runs it — zero keys, zero network beyond localhost, ephemeral
 * random ports (parallel-safe), and no clock-derived assertions (run-twice
 * must be identical).
 *
 * The SSE frame plumbing is ADAPTED from packages/server/src/server.test.ts
 * (parseBlock/drainFrames/readEvents) — copied locally, never imported across
 * packages from a test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQuickstart, type RunningQuickstart } from "./server.js";
import { createStubAgent } from "./stub.js";

const FIXTURE_BUNDLE = `console.log("facet quickstart fixture bundle");\n`;

/** One parsed SSE frame: its optional `id:` line and its decoded `data:` payload. */
interface SseFrame {
  readonly id?: string;
  readonly data: unknown;
}

/** Parse a `\n\n`-delimited SSE block into its id + data, or undefined for a
 * comment-only block (`: connected`). */
function parseBlock(block: string): SseFrame | undefined {
  let id: string | undefined;
  let dataLine: string | undefined;
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) id = line.slice(4);
    else if (line.startsWith("data: ")) dataLine = line.slice(6);
  }
  if (dataLine === undefined) return undefined;
  return id === undefined ? { data: JSON.parse(dataLine) } : { id, data: JSON.parse(dataLine) };
}

/** Split a raw SSE buffer at `\n\n` boundaries into complete blocks plus the
 * leftover (incomplete) tail. */
function drainFrames(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let index = buffer.indexOf("\n\n");
  while (index !== -1) {
    blocks.push(buffer.slice(0, index));
    buffer = buffer.slice(index + 2);
    index = buffer.indexOf("\n\n");
  }
  return { blocks, rest: buffer };
}

/** Read SSE frames from a /stream response until `count` data frames arrived,
 * then cancel the reader (disconnecting the stream). */
async function readEvents(response: Response, count: number): Promise<SseFrame[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { blocks, rest } = drainFrames(buffer);
    buffer = rest;
    for (const block of blocks) {
      const frame = parseBlock(block);
      if (frame !== undefined) frames.push(frame);
    }
  }
  await reader.cancel();
  return frames;
}

/** A held-open /stream connection that yields frames incrementally — the same
 * parsing as `readEvents`, but the connection survives between `next` calls so
 * a test can interleave POSTs and frame assertions without reconnect races. */
interface StreamReader {
  next(count: number): Promise<SseFrame[]>;
  close(): Promise<void>;
}

async function openStream(base: string, visitorId: string): Promise<StreamReader> {
  const response = await fetch(`${base}/stream?visitorId=${visitorId}`);
  if (response.status !== 200) throw new Error(`stream connect failed: ${response.status}`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const pending: SseFrame[] = [];
  let buffer = "";
  return {
    next: async (count: number): Promise<SseFrame[]> => {
      const out: SseFrame[] = [];
      for (;;) {
        while (pending.length > 0 && out.length < count) out.push(pending.shift()!);
        if (out.length >= count) return out;
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended before enough frames arrived");
        buffer += decoder.decode(value, { stream: true });
        const { blocks, rest } = drainFrames(buffer);
        buffer = rest;
        for (const block of blocks) {
          const frame = parseBlock(block);
          if (frame !== undefined) pending.push(frame);
        }
      }
    },
    close: () => reader.cancel(),
  };
}

const kindOf = (data: unknown): string | undefined => (data as { kind?: string }).kind;

const sayTexts = (frames: readonly SseFrame[]): string[] =>
  frames
    .map((f) => f.data)
    .filter((d): d is { kind: "say"; text: string } => kindOf(d) === "say")
    .map((d) => d.text);

function postEvent(base: string, visitorId: string, event: unknown): Promise<Response> {
  return fetch(`${base}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: { visitorId }, event }),
  });
}

/** Boot `startQuickstart` on a random free port, retrying on collisions (the
 * server.test.ts bind-retry pattern). */
async function boot(pageBundlePath: string): Promise<RunningQuickstart> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    try {
      return await startQuickstart({
        port,
        agentId: "quickstart-e2e",
        agent: createStubAgent(),
        pageBundlePath,
      });
    } catch {
      // EADDRINUSE — try another port
    }
  }
  throw new Error("could not boot startQuickstart on a free port");
}

let fixtureDir: string;
let running: RunningQuickstart;
let base: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "facet-quickstart-e2e-"));
  const bundlePath = join(fixtureDir, "app.js");
  await writeFile(bundlePath, FIXTURE_BUNDLE, "utf8");
  running = await boot(bundlePath);
  base = running.url;
});

afterAll(async () => {
  await running.close();
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("quickstart E2E — static shell + proxy plumbing", () => {
  it("GET / returns the HTML shell", async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain('<div id="root">');
    expect(body).toContain('src="/app.js"');
  });

  it("GET /app.js serves the injected fixture bundle", async () => {
    const response = await fetch(`${base}/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toBe(FIXTURE_BUNDLE);
  });

  it("proxies /health to the internal facet server", async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ok agent=local");
  });

  it("answers 404 for /agent/stream at the wrapper (agent channel not exposed)", async () => {
    const response = await fetch(`${base}/agent/stream`);
    expect(response.status).toBe(404);
    await response.text();
  });

  it("refuses a cross-origin POST /event (CSRF guard) but allows same-origin", async () => {
    const body = JSON.stringify({
      visitor: { visitorId: "csrf" },
      event: { kind: "message", text: "hi" },
    });
    // A malicious site the deployer visits ⇒ rejected before any provider call.
    const cross = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body,
    });
    expect(cross.status).toBe(403);
    await cross.text();

    // The served page (same host) ⇒ allowed.
    const sameOrigin = new URL(base).host;
    const same = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `http://${sameOrigin}` },
      body,
    });
    expect(same.status).toBe(202);
    await same.text();
  });

  it("does not leak Access-Control-Allow-Origin on proxied responses", async () => {
    const response = await fetch(`${base}/health`);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await response.text();
  });
});

describe("quickstart E2E — stub flow through the proxy (DC-001, DC-008)", () => {
  it("stub run: visit snapshot, chat patch, collect press echoes fields", async () => {
    const visitorId = "e2e-flow";
    const stream = await openStream(base, visitorId);
    try {
      // Fresh connect leads with an unstamped reset.
      const [reset] = await stream.next(1);
      expect(kindOf(reset?.data)).toBe("reset");

      // Visit → the stub renders STUB_TREE: one patch frame whose payload
      // carries the signup form (both fields), the collect submit, and screens.
      const visitPost = await postEvent(base, visitorId, {
        kind: "visit",
        visitor: { visitorId },
      });
      expect(visitPost.status).toBe(202);
      const [visitPatch] = await stream.next(1);
      expect(kindOf(visitPatch?.data)).toBe("patch");
      const snapshotText = JSON.stringify(visitPatch?.data);
      expect(snapshotText).toContain('"signup"');
      expect(snapshotText).toContain('"signup-name"');
      expect(snapshotText).toContain('"signup-email"');
      expect(snapshotText).toContain('"screens"');
      expect(snapshotText).toContain('"collect":"signup"');

      // Chat → deterministic stub-echo patch + say on the SAME connection.
      await postEvent(base, visitorId, { kind: "message", text: "hello" });
      const chatFrames = await stream.next(2);
      expect(chatFrames.map((f) => kindOf(f.data))).toEqual(["patch", "say"]);
      const chatText = JSON.stringify(chatFrames.map((f) => f.data));
      expect(chatText).toContain("stub-echo");
      expect(chatText).toContain("echo: hello");
      expect(sayTexts(chatFrames)).toEqual(["stub: hello"]);

      // Collect press: the harness posts the fields the renderer would
      // snapshot — this pins server-guard → runtime → agent → sink → SSE
      // (the honest-seam note: the renderer's PRODUCTION of fields is proven
      // at unit level in WU-3; `collect` on the action is ignored server-side).
      const pressPost = await postEvent(base, visitorId, {
        kind: "action",
        action: { kind: "agent", name: "submit", collect: "signup" },
        fields: { name: "Ada", email: "a@b.c" },
      });
      expect(pressPost.status).toBe(202);
      const pressFrames = await stream.next(1);
      // Sorted key=value pairs — deterministic across runs.
      expect(sayTexts(pressFrames)).toEqual(["submit: email=a@b.c name=Ada"]);
    } finally {
      await stream.close();
    }
  });

  it("resumes through the proxy with Last-Event-ID (continuation, not full replay)", async () => {
    const visitorId = "e2e-resume";
    const stream1 = await fetch(`${base}/stream?visitorId=${visitorId}`);
    await postEvent(base, visitorId, { kind: "visit", visitor: { visitorId } });
    await postEvent(base, visitorId, { kind: "message", text: "one" });
    // reset + visit patch + echo patch + say("stub: one")
    const first = await readEvents(stream1, 4);
    expect(sayTexts(first)).toEqual(["stub: one"]);
    const stamped = first.filter((f) => f.id !== undefined);
    const lastId = stamped[stamped.length - 1]?.id;
    expect(lastId).toBeDefined();
    const era = lastId!.slice(0, lastId!.indexOf(":"));
    const lastSeq = Number(lastId!.slice(lastId!.indexOf(":") + 1));

    // readEvents cancelled stream1's reader; this turn lands while nobody
    // is listening.
    await postEvent(base, visitorId, { kind: "message", text: "two" });
    await new Promise((r) => setTimeout(r, 50)); // let the lane drain

    // Reconnect WITH the resume token, through the proxy (request-header
    // forwarding pinned): exactly the gap (patch + say), stamped in
    // continuing seq order, no reset — a continuation, not a full replay.
    const stream2 = await fetch(`${base}/stream?visitorId=${visitorId}`, {
      headers: { "Last-Event-ID": `${era}:${String(lastSeq)}` },
    });
    const resumed = await readEvents(stream2, 2);
    expect(resumed.every((f) => kindOf(f.data) !== "reset")).toBe(true);
    expect(resumed.map((f) => kindOf(f.data))).toEqual(["patch", "say"]);
    expect(sayTexts(resumed)).toEqual(["stub: two"]);
    const seqs = resumed.map((f) => Number(f.id!.slice(f.id!.indexOf(":") + 1)));
    expect(seqs).toEqual([lastSeq + 1, lastSeq + 2]);
  });

  it("answers a rapid double message with two replies in order", async () => {
    const visitorId = "e2e-rapid";
    const stream = await openStream(base, visitorId);
    try {
      await stream.next(1); // reset
      await postEvent(base, visitorId, { kind: "visit", visitor: { visitorId } });
      await stream.next(1); // visit patch
      // Fire the second message immediately after the first — no waiting for
      // the first reply (the per-visitor lane must serialize the turns).
      await postEvent(base, visitorId, { kind: "message", text: "first" });
      await postEvent(base, visitorId, { kind: "message", text: "second" });
      const frames = await stream.next(4); // (echo patch + say) × 2
      expect(sayTexts(frames)).toEqual(["stub: first", "stub: second"]);
    } finally {
      await stream.close();
    }
  });
});
