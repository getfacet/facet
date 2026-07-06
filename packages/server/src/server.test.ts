import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_FIELD_VALUE_CHARS,
  MAX_PATCH_OPS,
  type AgentEventFrame,
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import {
  MemorySink,
  MemoryStageStore,
  withInitialStage,
  type Sink,
  type StageStore,
  type StoredEvent,
} from "@facet/runtime";
import { createFacetServer, type FacetServer } from "./server.js";
import { isStaleLateResult } from "./late.js";

const sayAgent: FacetAgent = () => [{ kind: "say", text: "hello from agent" }];

/** The non-terminal note the per-event timeout now delivers (A-3). */
const INTERIM_SAY =
  "(still working — this is taking longer than usual; the answer will appear here when it's ready)";

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
 * leftover (incomplete) tail — the frame-splitting loop the readers share. */
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

/** Read SSE frames from a /stream response until `count` data frames arrived. */
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

/** Read SSE frames from a /stream response until `count` data lines arrived. */
async function readFrames(response: Response, count: number): Promise<unknown[]> {
  return (await readEvents(response, count)).map((f) => f.data);
}

/** Collect SSE frames (id + data) for a bounded window, then stop (the stream stays
 * open, so a count-based reader would block — here we want "whatever arrived in `ms`"). */
async function collectEvents(response: Response, ms: number): Promise<SseFrame[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()));
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === null || chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const { blocks, rest } = drainFrames(buffer);
      buffer = rest;
      for (const block of blocks) {
        const frame = parseBlock(block);
        if (frame !== undefined) frames.push(frame);
      }
    }
  } finally {
    await reader.cancel();
  }
  return frames;
}

/** Collect SSE data payloads for a bounded window. */
async function collectFrames(response: Response, ms: number): Promise<unknown[]> {
  return (await collectEvents(response, ms)).map((f) => f.data);
}

function eventReader(response: Response): {
  next(ms: number): Promise<SseFrame | undefined>;
  close(): Promise<void>;
} {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (ms: number): Promise<SseFrame | undefined> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const drained = drainFrames(buffer);
      buffer = drained.rest;
      for (const [i, block] of drained.blocks.entries()) {
        const frame = parseBlock(block);
        if (frame !== undefined) {
          buffer =
            drained.blocks
              .slice(i + 1)
              .map((b) => `${b}\n\n`)
              .join("") + buffer;
          return frame;
        }
      }
      const timeoutMs = Math.max(0, deadline - Date.now());
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === null || chunk.done) return undefined;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    return undefined;
  };
  return { next, close: () => reader.cancel() };
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

/** A dialed-in fake remote agent: holds `/agent/stream` and reads the event
 * frames the server pushes, so a test can respond via `/agent/control`. */
interface AgentLink {
  readonly response: Response;
  nextEvent(): Promise<AgentEventFrame>;
  close(): Promise<void>;
}

async function dialAgent(base: string, token?: string): Promise<AgentLink> {
  const response = await fetch(`${base}/agent/stream`, {
    headers: token !== undefined ? { "x-facet-token": token } : {},
  });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no agent body");
  const decoder = new TextDecoder();
  let buffer = "";
  const nextEvent = async (): Promise<AgentEventFrame> => {
    for (;;) {
      const { blocks, rest } = drainFrames(buffer);
      buffer = rest;
      for (const [i, block] of blocks.entries()) {
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6)) as { type?: string };
            if (data.type === "event") {
              // Re-buffer the blocks after this one so a later nextEvent still sees them.
              buffer =
                blocks
                  .slice(i + 1)
                  .map((b) => `${b}\n\n`)
                  .join("") + buffer;
              return data as AgentEventFrame;
            }
          }
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("agent stream ended");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { response, nextEvent, close: () => reader.cancel() };
}

function postEvent(base: string, visitorId: string, event: ClientEventLike): Promise<Response> {
  return fetch(`${base}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: { visitorId }, event }),
  });
}
type ClientEventLike =
  | { kind: "message"; text: string }
  | { kind: "visit"; visitor: { visitorId: string } }
  | { kind: "tap"; action: { name: string; payload?: unknown }; fields?: unknown };

/** POST a collected local tap to /record. `event` is `unknown` so a test can send a
 * deliberately malformed body (DC-007). */
function postRecord(base: string, visitorId: string, event: unknown): Promise<Response> {
  return fetch(`${base}/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: { visitorId }, event }),
  });
}

function control(
  base: string,
  requestId: number,
  messages: readonly ServerMessage[],
  token?: string,
): Promise<Response> {
  return fetch(`${base}/agent/control`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token !== undefined ? { "x-facet-token": token } : {}),
    },
    body: JSON.stringify({ requestId, messages }),
  });
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

/** A store whose `open` can be toggled to throw — models a store that fails on a
 * specific write (here, the late-apply path) without disturbing earlier writes. */
class ToggleOpenFailStore implements StageStore {
  failOpen = false;
  constructor(private readonly inner: StageStore) {}
  get(agentId: string, visitorId: string): Promise<FacetSession | undefined> {
    return this.inner.get(agentId, visitorId);
  }
  open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    if (this.failOpen) throw new Error("late store failure");
    return this.inner.open(agentId, visitor);
  }
  save(session: FacetSession): Promise<void> {
    return this.inner.save(session);
  }
}

/** The text field of a stored node, if present (nodes are a union — box has no value). */
const nodeValue = (session: FacetSession | undefined, id: string): string | undefined =>
  (session?.stage.nodes[id] as { value?: string } | undefined)?.value;

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

const sayText = (frames: SseFrame[]): string[] =>
  frames
    .map((f) => f.data)
    .filter((d): d is { kind: "say"; text: string } => (d as { kind?: string }).kind === "say")
    .map((d) => d.text);

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

    const accepted = await postEvent(base, "v", { kind: "message", text: "hi" });
    expect(accepted.status).toBe(202);

    // A full (re)connect now leads with an unstamped reset, then the live say.
    const frames = await readFrames(stream, 2);
    expect(frames[0]).toEqual({ kind: "reset" });
    expect(frames[1]).toEqual({ kind: "say", text: "hello from agent" });
  });

  it("streams yielded batches to /stream before the turn finishes, in seq order", async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const agent: FacetAgent = async function* () {
      yield [{ kind: "say", text: "one" }];
      await secondGate;
      yield [{ kind: "say", text: "two" }];
    };
    const { server, base } = await start({ agentId: "a", agent });
    running = server;
    const stream = await fetch(`${base}/stream?visitorId=v`);
    const reader = eventReader(stream);
    try {
      const accepted = await postEvent(base, "v", { kind: "message", text: "hi" });
      expect(accepted.status).toBe(202);

      const first = await reader.next(500);
      expect(first?.data).toEqual({ kind: "reset" });
      const streamed = await reader.next(500);
      expect(streamed?.data).toEqual({ kind: "say", text: "one" });

      releaseSecond();
      const second = await reader.next(500);
      expect(second?.data).toEqual({ kind: "say", text: "two" });
      const seqs = [streamed?.id, second?.id].map((id) => Number(id!.slice(id!.indexOf(":") + 1)));
      expect(seqs[1]).toBe(seqs[0]! + 1);
    } finally {
      await reader.close();
    }
  });

  it("keeps later same-visitor events behind an unfinished streamed turn", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const agent: FacetAgent = async function* (event) {
      if (event.kind !== "message") return;
      yield [{ kind: "say", text: `${event.text}:one` }];
      if (event.text === "first") await firstGate;
      yield [{ kind: "say", text: `${event.text}:two` }];
    };
    const { server, base } = await start({ agentId: "a", agent });
    running = server;
    const stream = await fetch(`${base}/stream?visitorId=v`);
    const reader = eventReader(stream);
    try {
      await postEvent(base, "v", { kind: "message", text: "first" });
      expect((await reader.next(500))?.data).toEqual({ kind: "reset" });
      expect((await reader.next(500))?.data).toEqual({ kind: "say", text: "first:one" });

      await postEvent(base, "v", { kind: "message", text: "second" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      releaseFirst();
      expect((await reader.next(500))?.data).toEqual({ kind: "say", text: "first:two" });
      expect((await reader.next(500))?.data).toEqual({ kind: "say", text: "second:one" });
      expect((await reader.next(500))?.data).toEqual({ kind: "say", text: "second:two" });
    } finally {
      await reader.close();
    }
  });

  it("streams different visitors in parallel while one visitor is mid-turn", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const agent: FacetAgent = async function* (_event, session) {
      const id = session.visitor.visitorId;
      yield [{ kind: "say", text: `${id}:one` }];
      if (id === "a") await gateA;
      yield [{ kind: "say", text: `${id}:two` }];
    };
    const { server, base } = await start({ agentId: "a", agent });
    running = server;
    const streamA = await fetch(`${base}/stream?visitorId=a`);
    const streamB = await fetch(`${base}/stream?visitorId=b`);
    const readerA = eventReader(streamA);
    const readerB = eventReader(streamB);
    try {
      await postEvent(base, "a", { kind: "message", text: "go" });
      expect((await readerA.next(500))?.data).toEqual({ kind: "reset" });
      expect((await readerA.next(500))?.data).toEqual({ kind: "say", text: "a:one" });

      await postEvent(base, "b", { kind: "message", text: "go" });
      expect((await readerB.next(500))?.data).toEqual({ kind: "reset" });
      expect((await readerB.next(500))?.data).toEqual({ kind: "say", text: "b:one" });

      releaseA();
      expect((await readerA.next(500))?.data).toEqual({ kind: "say", text: "a:two" });
    } finally {
      await readerA.close();
      await readerB.close();
    }
  });

  it("full rehydrate includes streamed says delivered before the turn-final sink record", async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const agent: FacetAgent = async function* () {
      yield [{ kind: "say", text: "one" }];
      await secondGate;
      yield [{ kind: "say", text: "two" }];
    };
    const { server, base } = await start({ agentId: "a", agent });
    running = server;
    const stream1 = await fetch(`${base}/stream?visitorId=v`);
    const reader1 = eventReader(stream1);
    let reader2: ReturnType<typeof eventReader> | undefined;
    try {
      await postEvent(base, "v", { kind: "message", text: "hi" });
      expect((await reader1.next(500))?.data).toEqual({ kind: "reset" });
      expect((await reader1.next(500))?.data).toEqual({ kind: "say", text: "one" });

      const stream2 = await fetch(`${base}/stream?visitorId=v`);
      reader2 = eventReader(stream2);
      expect((await reader2.next(500))?.data).toEqual({ kind: "reset" });
      expect((await reader2.next(500))?.data).toMatchObject({ kind: "patch" });
      expect((await reader2.next(500))?.data).toEqual({ kind: "say", text: "one" });

      releaseSecond();
      expect((await reader2.next(500))?.data).toEqual({ kind: "say", text: "two" });
    } finally {
      releaseSecond();
      await reader1.close();
      await reader2?.close();
    }
  });

  it("full rehydrate does not duplicate completed streamed says retained in the frame log", async () => {
    const sink = new MemorySink();
    const agent: FacetAgent = async function* () {
      yield [{ kind: "say", text: "one" }];
      yield [{ kind: "say", text: "two" }];
    };
    const { server, base } = await start({ agentId: "a", agent, sink });
    running = server;
    const stream1 = await fetch(`${base}/stream?visitorId=v`);
    await postEvent(base, "v", { kind: "message", text: "hi" });
    const first = await readEvents(stream1, 3);
    expect(sayText(first)).toEqual(["one", "two"]);
    await waitFor(async () => (await sink.history("a", "v")).length === 1);

    const stream2 = await fetch(`${base}/stream?visitorId=v`);
    const rehydrated = await readEvents(stream2, 4);

    expect(rehydrated[0]?.data).toEqual({ kind: "reset" });
    expect(rehydrated[1]?.data).toMatchObject({ kind: "patch" });
    expect(sayText(rehydrated)).toEqual(["one", "two"]);
  });

  it("full rehydrate keeps an older same-text history say when an active retained say matches it", async () => {
    const sink = new MemorySink();
    let sameTurns = 0;
    let patchId = 0;
    let releaseSecondSame!: () => void;
    const secondSameGate = new Promise<void>((resolve) => {
      releaseSecondSame = resolve;
    });
    const agent: FacetAgent = async function* (event) {
      if (event.kind !== "message") return;
      if (event.text === "same") {
        sameTurns += 1;
        yield [{ kind: "say", text: "same" }];
        if (sameTurns === 2) await secondSameGate;
        return;
      }
      const id = `p${String(patchId)}`;
      patchId += 1;
      yield [
        {
          kind: "patch",
          patches: [{ op: "add", path: `/nodes/${id}`, value: { id, type: "text", value: id } }],
        },
      ];
    };
    const { server, base } = await start({ agentId: "a", agent, sink });
    running = server;

    await postEvent(base, "v", { kind: "message", text: "same" });
    for (let i = 0; i < 205; i += 1) {
      await postEvent(base, "v", { kind: "message", text: "patch" });
    }
    await waitFor(async () => (await sink.history("a", "v")).length >= 206);

    const live = await fetch(`${base}/stream?visitorId=v`);
    const liveReader = eventReader(live);
    let rehydrateReader: ReturnType<typeof eventReader> | undefined;
    try {
      expect((await liveReader.next(500))?.data).toEqual({ kind: "reset" });
      expect((await liveReader.next(500))?.data).toMatchObject({ kind: "patch" });
      expect((await liveReader.next(500))?.data).toEqual({ kind: "say", text: "same" });

      await postEvent(base, "v", { kind: "message", text: "same" });
      expect((await liveReader.next(500))?.data).toEqual({ kind: "say", text: "same" });

      const rehydrating = await fetch(`${base}/stream?visitorId=v`);
      rehydrateReader = eventReader(rehydrating);
      const frames = [
        await rehydrateReader.next(500),
        await rehydrateReader.next(500),
        await rehydrateReader.next(500),
        await rehydrateReader.next(500),
      ].filter((frame): frame is SseFrame => frame !== undefined);
      expect(sayText(frames)).toEqual(["same", "same"]);
    } finally {
      releaseSecondSame();
      await liveReader.close();
      await rehydrateReader?.close();
    }
  });

  it("advertises Last-Event-ID in CORS so cross-origin resume works", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // The cross-origin EventSource reconnect carries Last-Event-ID; the preflight
    // must allow it or the resume never happens.
    const preflight = await fetch(`${base}/stream?visitorId=v`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Last-Event-ID");
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
    await postEvent(base, "v", { kind: "visit", visitor: { visitorId: "v" } });
    // reset (leading) then the offline-face patch.
    const frames = (await readFrames(stream, 2)) as { kind: string }[];
    expect(frames[0]?.kind).toBe("reset");
    expect(frames.some((f) => f.kind === "patch")).toBe(true);
  });

  it("returns 404 for unknown routes", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe("isStaleLateResult (late-apply staleness)", () => {
  it("is not stale when the era matches and no newer turn applied", () => {
    expect(isStaleLateResult({ era: "e1", index: 3 }, { era: "e1", lastApplied: 3 })).toBe(false);
    expect(isStaleLateResult({ era: "e1", index: 3 }, { era: "e1", lastApplied: 2 })).toBe(false);
    expect(isStaleLateResult({ era: "e1", index: 3 }, { era: "e1", lastApplied: -1 })).toBe(false);
  });

  it("is stale when a newer turn already applied (same era)", () => {
    expect(isStaleLateResult({ era: "e1", index: 3 }, { era: "e1", lastApplied: 4 })).toBe(true);
  });

  it("is stale when the era no longer matches (log re-minted after eviction/restart)", () => {
    // Even though 0 is not > 5, the era mismatch alone makes it stale — a re-minted
    // log's counters are meaningless, so the fail-safe direction is to drop the patch.
    expect(isStaleLateResult({ era: "old", index: 5 }, { era: "new", lastApplied: 0 })).toBe(true);
    expect(isStaleLateResult({ era: "old", index: 5 }, { era: "new", lastApplied: 9 })).toBe(true);
  });
});

describe("async delivery — late results", () => {
  it("applies a late /agent/control result after the per-event timeout", async () => {
    const inner = new MemoryStageStore();
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 100, stageStore: inner });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "slow please" });
    const evt = await link.nextEvent();

    const seed: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { direction: "col" }, children: ["t1"] },
        t1: { id: "t1", type: "text", value: "late answer body" },
      },
    };
    // Respond only AFTER the per-event timeout has fired (interim note delivered).
    await new Promise((r) => setTimeout(r, 180));
    const posted = await control(base, evt.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: seed }] },
      { kind: "say", text: "here is the late answer" },
    ]);
    expect(posted.status).toBe(202);

    // Collect everything the tab received (leading reset, interim note, late result).
    const frames = await collectEvents(stream, 1_000);
    const says = sayText(frames);
    expect(says).toContain(INTERIM_SAY); // non-terminal note fired at the timeout
    expect(says).toContain("here is the late answer"); // the late result was delivered
    // …and applied to the stored session.
    await waitFor(async () => (await inner.get("a", "v"))?.stage.nodes["t1"] !== undefined);
    await link.close();
  });

  it("applies an in-time result exactly once with no interim note", async () => {
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 5_000 });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "hi" });
    const evt = await link.nextEvent();
    await control(base, evt.requestId, [{ kind: "say", text: "prompt answer" }]);

    const frames = await collectEvents(stream, 500);
    const says = sayText(frames);
    expect(says).toEqual(["prompt answer"]); // exactly once, no interim note
    await link.close();
  });

  it("salvages a good op from a late result with one stale op", async () => {
    const inner = new MemoryStageStore();
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 100, stageStore: inner });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "go" });
    const evt = await link.nextEvent();
    await new Promise((r) => setTimeout(r, 160));

    const good: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { direction: "col" }, children: ["g1"] },
        g1: { id: "g1", type: "text", value: "good op landed" },
      },
    };
    // One stale op (replace a node that doesn't exist) + one good op (replace root).
    await control(base, evt.requestId, [
      {
        kind: "patch",
        patches: [
          { op: "replace", path: "/nodes/ghost/value", value: "nope" },
          { op: "replace", path: "", value: good },
        ],
      },
    ]);

    // The good op lands in the store despite the stale op…
    await waitFor(async () => (await inner.get("a", "v"))?.stage.nodes["g1"] !== undefined);
    // …and the stream survives (still open, not torn down by the bad op).
    expect(await streamEnded(stream, 200)).toBe(false);
    await link.close();
  });

  it("lands a result the agent posts after reconnecting (dropAgent parks pending)", async () => {
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 5_000 });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "work" });
    const evt = await link.nextEvent();
    // Agent dies mid-turn — dropAgent parks {visitor,event} in the late window.
    await link.close();
    await waitFor(async () => (await (await fetch(`${base}/health`)).text()) === "ok agent=local");

    // The agent reconnects and posts the finished work for the same requestId.
    const link2 = await dialAgent(base);
    await control(base, evt.requestId, [{ kind: "say", text: "reconnected answer" }]);
    const frames = await collectEvents(stream, 800);
    expect(sayText(frames)).toContain("reconnected answer");
    await link2.close();
  });

  it("answers 202 no-op for a control POST whose late-window entry was evicted", async () => {
    // LATE_WINDOW_LIMIT is 100; a requestId never parked answers a silent 202.
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await control(base, 999_999, [{ kind: "say", text: "orphan" }]);
    expect(response.status).toBe(202);
  });

  const labelTree = (label: string): FacetTree => ({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", style: { direction: "col" }, children: ["t"] },
      t: { id: "t", type: "text", value: label },
    },
  });

  it("marks a mutating streamed turn applied once so an older parked late patch is stale", async () => {
    const inner = new MemoryStageStore();
    const fallback: FacetAgent = async function* (event) {
      if (event.kind === "message" && event.text === "second") {
        yield [{ kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r2") }] }];
        yield [{ kind: "say", text: "answer 2" }];
      }
    };
    const { server, base } = await start({
      agentId: "a",
      agent: fallback,
      agentTimeoutMs: 120,
      stageStore: inner,
    });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "first" });
    const evt1 = await link.nextEvent();
    await new Promise((r) => setTimeout(r, 180)); // e1 parks
    await link.close();
    await waitFor(async () => (await (await fetch(`${base}/health`)).text()) === "ok agent=local");

    await postEvent(base, "v", { kind: "message", text: "second" });
    await waitFor(async () => nodeValue(await inner.get("a", "v"), "t") === "r2");

    await control(base, evt1.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r1") }] },
      { kind: "say", text: "answer 1" },
    ]);

    const frames = await collectEvents(stream, 800);
    expect(sayText(frames)).toContain("answer 1");
    expect(nodeValue(await inner.get("a", "v"), "t")).toBe("r2");
  });

  it("drops a stale late result's patch but keeps its say when a newer turn applied", async () => {
    // Inversion: e1 times out and parks (index 0); e2 (index 1) then applies r2
    // fully; e1's real result r1 arrives LAST. r1's stage mutation must NOT overwrite
    // r2 — but r1's conversational say still lands (the interim promise is honored).
    const inner = new MemoryStageStore();
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 120, stageStore: inner });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "first" });
    const evt1 = await link.nextEvent();

    // e2 queues behind e1; its agent frame only arrives after e1's interim timeout.
    await postEvent(base, "v", { kind: "message", text: "second" });
    const evt2 = await link.nextEvent();
    await control(base, evt2.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r2") }] },
      { kind: "say", text: "answer 2" },
    ]);
    await waitFor(async () => nodeValue(await inner.get("a", "v"), "t") === "r2");

    // e1's real result arrives late — stale (index 0 < lastApplied 1).
    await control(base, evt1.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r1") }] },
      { kind: "say", text: "answer 1" },
    ]);

    const frames = await collectEvents(stream, 800);
    expect(sayText(frames)).toContain("answer 1"); // the say still lands
    // …and the stored stage is still r2's — no stale rollback.
    expect(nodeValue(await inner.get("a", "v"), "t")).toBe("r2");
    await link.close();
  });

  it("applies a parked late patch after a live turn whose patch ops ALL failed salvage", async () => {
    // Effect-based agentMutated: e1 times out and parks (index 0). e2 replies
    // live with a patch whose every op targets a nonexistent node — the fold
    // applies nothing, so the turn mutated the stage NOT AT ALL. lastApplied must
    // therefore stay -1, and e1's real late patch must still APPLY (not be dropped
    // as stale behind e2). With presence-based agentMutated e2 would falsely bump
    // lastApplied to 1 and strip e1's r1 to say-only.
    const inner = new MemoryStageStore();
    const sink = new MemorySink();
    const { server, base } = await start({
      agentId: "a",
      agentTimeoutMs: 120,
      stageStore: inner,
      sink,
    });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "first" });
    const evt1 = await link.nextEvent();

    // e2 queues behind e1; its agent frame arrives after e1's interim timeout.
    await postEvent(base, "v", { kind: "message", text: "second" });
    const evt2 = await link.nextEvent();
    // Every op targets a node id that no longer exists → all fail salvage → the
    // stored stage is untouched by e2.
    await control(base, evt2.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "/nodes/ghost/value", value: "nope" }] },
      { kind: "say", text: "answer 2" },
    ]);
    // e1's interim record (timeout) + e2's live record → history reaches 2 once e2 applied.
    await waitFor(async () => (await sink.history("a", "v")).length >= 2);
    expect(nodeValue(await inner.get("a", "v"), "t")).toBeUndefined(); // e2 mutated nothing

    // e1's real late result arrives — NOT stale (e2 did not advance lastApplied),
    // so r1's patch must land on the stored stage rather than be stripped to say-only.
    await control(base, evt1.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r1") }] },
      { kind: "say", text: "answer 1" },
    ]);
    await waitFor(async () => nodeValue(await inner.get("a", "v"), "t") === "r1");
    expect(nodeValue(await inner.get("a", "v"), "t")).toBe("r1");
    const frames = await collectEvents(stream, 400);
    expect(sayText(frames)).toContain("answer 1");
    await link.close();
  });

  it("applies an older parked late patch after a NEWER late result whose ops all failed salvage", async () => {
    // Late-seam variant of the effect-based agentMutated rule: e1 AND e2 both
    // time out and park. e2's late result arrives FIRST, carrying a patch whose
    // every op fails salvage — it mutates nothing, so it must NOT advance
    // lastApplied. e1's older late patch must then still APPLY rather than be
    // stripped to say-only as stale. With presence-based gating on the late
    // path, e2 would falsely bump lastApplied to 1 and e1's r1 would be lost.
    const inner = new MemoryStageStore();
    const sink = new MemorySink();
    const { server, base } = await start({
      agentId: "a",
      agentTimeoutMs: 120,
      stageStore: inner,
      sink,
    });
    running = server;
    const link = await dialAgent(base);

    await postEvent(base, "v", { kind: "message", text: "first" });
    const evt1 = await link.nextEvent();
    await postEvent(base, "v", { kind: "message", text: "second" });
    const evt2 = await link.nextEvent();
    // Both turns time out and park (two interim records reach the sink).
    await waitFor(async () => (await sink.history("a", "v")).length >= 2);

    // e2's late result first: all ops fail salvage → stage untouched.
    await control(base, evt2.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "/nodes/ghost/value", value: "nope" }] },
      { kind: "say", text: "answer 2" },
    ]);
    // Wait for e2's late lane task to actually run: its "answer 2" say lands in
    // the sink as the third record (after the two interim-timeout records).
    await waitFor(async () => (await sink.history("a", "v")).length >= 3);
    expect(nodeValue(await inner.get("a", "v"), "t")).toBeUndefined();

    // e1's older late patch must still land (e2 must not have bumped lastApplied).
    await control(base, evt1.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r1") }] },
      { kind: "say", text: "answer 1" },
    ]);
    await waitFor(async () => nodeValue(await inner.get("a", "v"), "t") === "r1");
    expect(nodeValue(await inner.get("a", "v"), "t")).toBe("r1");
    await link.close();
  });

  it("applies a parked late patch after a say-only turn merely re-emitted the seed frame", async () => {
    // Regression (seed frame vs lastApplied): a seeded fresh session parks turn I
    // (its persist save rejects once, so the seed stays armed). A say-only turn J
    // then RE-EMITS the still-armed seed frame and persists — but J's own agent
    // mutated nothing, so it must NOT advance lastApplied. Turn I's real late
    // patch must then still APPLY, not be dropped as stale behind J.
    const inner = new MemoryStageStore();
    const seededStore = withInitialStage(inner, labelTree("seed"));
    let failNextSave = true;
    // Reject ONLY the first runtime-facing save (turn I's persist); `open` still
    // seeds through the underlying store, so the fresh seeded session persists.
    const flakyStore: StageStore = {
      get: (a, v) => seededStore.get(a, v),
      open: (a, v) => seededStore.open(a, v),
      save: (s) => {
        if (failNextSave) {
          failNextSave = false;
          return Promise.reject(new Error("save boom"));
        }
        return seededStore.save(s);
      },
      takeSeeded: (a, v) => seededStore.takeSeeded?.(a, v) ?? false,
    };
    const sink = new MemorySink();
    const { server, base } = await start({
      agentId: "a",
      agentTimeoutMs: 120,
      stageStore: flakyStore,
      sink,
    });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    // Turn I: fresh visit seeds the session; the agent times out (parks I) and
    // I's persist save rejects once — the seed stays armed for the next turn.
    await postEvent(base, "v", { kind: "message", text: "first" });
    const evt1 = await link.nextEvent();
    await new Promise((r) => setTimeout(r, 200)); // let I time out + park (interim)

    // Turn J: a say-only in-time reply. It re-emits the still-armed seed frame and
    // persists, but its own agent mutated nothing — so lastApplied must stay -1.
    await postEvent(base, "v", { kind: "message", text: "second" });
    const evt2 = await link.nextEvent();
    await control(base, evt2.requestId, [{ kind: "say", text: "answer 2" }]);
    await waitFor(async () => (await sink.history("a", "v")).length >= 1); // J persisted

    // Turn I's real late result arrives — with the agentMutated gate it is NOT
    // stale (J did not advance lastApplied), so r1 must land on the stored stage.
    await control(base, evt1.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r1") }] },
      { kind: "say", text: "answer 1" },
    ]);
    await waitFor(async () => nodeValue(await inner.get("a", "v"), "t") === "r1");
    expect(nodeValue(await inner.get("a", "v"), "t")).toBe("r1");
    const frames = await collectEvents(stream, 400);
    expect(sayText(frames)).toContain("answer 1");
    await link.close();
  });

  it("applies a late result's patches when only interim turns intervened (no stage mutation)", async () => {
    // e1 parks (idx 0); e2 ALSO times out (interim say only, idx 1) — no newer stage
    // mutation. e1's real result must still apply its patches (lastApplied stays -1;
    // an interim/say-only turn must not falsely mark the parked patch stale).
    const inner = new MemoryStageStore();
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 100, stageStore: inner });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "first" });
    const evt1 = await link.nextEvent();
    await postEvent(base, "v", { kind: "message", text: "second" });
    await link.nextEvent(); // e2's frame arrives after e1's timeout
    await new Promise((r) => setTimeout(r, 160)); // let e2 time out too (interim only)

    await control(base, evt1.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("r1") }] },
      { kind: "say", text: "answer 1" },
    ]);
    await waitFor(async () => nodeValue(await inner.get("a", "v"), "t") === "r1");
    const frames = await collectEvents(stream, 400);
    expect(sayText(frames)).toContain("answer 1");
    await link.close();
  });

  it("delivers an error say when a late apply's store write fails", async () => {
    const store = new ToggleOpenFailStore(new MemoryStageStore());
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 120, stageStore: store });
    running = server;
    const link = await dialAgent(base);
    const stream = await fetch(`${base}/stream?visitorId=v`);

    await postEvent(base, "v", { kind: "message", text: "go" });
    const evt = await link.nextEvent();
    await new Promise((r) => setTimeout(r, 200)); // let e1 time out + park

    // The late apply's store open throws — the visitor must get an error say, not be
    // left waiting forever on the interim "it's coming" note.
    store.failOpen = true;
    await control(base, evt.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: labelTree("late") }] },
    ]);
    const frames = await collectEvents(stream, 800);
    expect(sayText(frames)).toContain("(the agent hit an error — try again)");
    await link.close();
  });

  it("records two sink entries for a timed-out event (interim then real)", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agentTimeoutMs: 100, sink });
    running = server;
    const link = await dialAgent(base);
    await postEvent(base, "v", { kind: "message", text: "slow" });
    const evt = await link.nextEvent();
    await new Promise((r) => setTimeout(r, 160)); // interim fires + parks
    await control(base, evt.requestId, [{ kind: "say", text: "the real answer" }]);
    // A timed-out turn records TWICE: handleOne's interim say, then applyMessages' real.
    await waitFor(async () => (await sink.history("a", "v")).length >= 2);
    expect((await sink.history("a", "v")).length).toBe(2);
    await link.close();
  });
});

describe("async delivery — resume & rehydrate", () => {
  const echoAgent: FacetAgent = (event) =>
    event.kind === "message" ? [{ kind: "say", text: event.text }] : [];

  it("replays exactly the missed frames on resume with Last-Event-ID", async () => {
    const { server, base } = await start({ agentId: "a", agent: echoAgent });
    running = server;

    const stream1 = await fetch(`${base}/stream?visitorId=v`);
    await postEvent(base, "v", { kind: "message", text: "a" });
    await postEvent(base, "v", { kind: "message", text: "b" });
    // reset + say(a) + say(b); grab the era from the last stamped frame.
    const first = await readEvents(stream1, 3);
    const stamped = first.filter((f) => f.id !== undefined);
    const lastId = stamped[stamped.length - 1]?.id;
    expect(lastId).toBeDefined();
    const era = lastId!.slice(0, lastId!.indexOf(":"));
    const lastSeq = Number(lastId!.slice(lastId!.indexOf(":") + 1));

    // readEvents already cancelled stream1's reader (disconnecting it); two more
    // events land while nobody is listening.
    await postEvent(base, "v", { kind: "message", text: "c" });
    await postEvent(base, "v", { kind: "message", text: "d" });
    await waitFor(async () => true); // let the lane drain
    await new Promise((r) => setTimeout(r, 50));

    // Reconnect with the resume token: exactly the gap, in seq order, no reset, no dups.
    const stream2 = await fetch(`${base}/stream?visitorId=v`, {
      headers: { "Last-Event-ID": `${era}:${lastSeq}` },
    });
    const resumed = await readEvents(stream2, 2);
    expect(resumed.map((f) => f.data)).toEqual([
      { kind: "say", text: "c" },
      { kind: "say", text: "d" },
    ]);
    // No reset on a resume (a resume must not clear chat).
    expect(resumed.every((f) => (f.data as { kind: string }).kind === "say")).toBe(true);
    // Stamped in strictly increasing seq order continuing past lastSeq.
    const seqs = resumed.map((f) => Number(f.id!.slice(f.id!.indexOf(":") + 1)));
    expect(seqs).toEqual([lastSeq + 1, lastSeq + 2]);
  });

  const seededTree: FacetTree = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", style: { direction: "col" }, children: ["s1"] },
      s1: { id: "s1", type: "text", value: "seeded stage" },
    },
  };
  // Seeds a stored stage on "seed", otherwise echoes the message text.
  const seedAgent: FacetAgent = (event) => {
    if (event.kind === "message" && event.text === "seed") {
      return [{ kind: "patch", patches: [{ op: "replace", path: "", value: seededTree }] }];
    }
    return event.kind === "message" ? [{ kind: "say", text: event.text }] : [];
  };

  it("degrades every malformed resume token to a full rehydrate, never 4xx/5xx", async () => {
    const inner = new MemoryStageStore();
    const { server, base } = await start({ agentId: "a", agent: seedAgent, stageStore: inner });
    running = server;

    // Seed a stored stage so a full rehydrate produces a full-replace patch, and
    // grab the live era from the stamped snapshot.
    const seedStream = await fetch(`${base}/stream?visitorId=v`);
    await postEvent(base, "v", { kind: "message", text: "seed" });
    const seedFrames = await readEvents(seedStream, 2); // reset + snapshot patch
    const stampedSeed = seedFrames.find((f) => f.id !== undefined);
    const era = stampedSeed?.id?.slice(0, stampedSeed.id.indexOf(":")) ?? "zzz";

    const tokens = [
      "", // empty
      "garbage", // no colon
      "nocolon-either", // no colon
      `${era}:`, // empty seq (Number("") === 0 would wrongly resume)
      `${era}:abc`, // non-integer seq
      `${era}: 1`, // leading whitespace coerces under Number()
      `${era}:0x1`, // hex coerces under Number()
      `${era}:1e2`, // exponent coerces under Number()
      `${era}:-2`, // negative other than the valid -1 base
      `wrong-era:0`, // era mismatch
      `${era}:999999`, // future seq beyond lastAssigned
    ];
    for (const token of tokens) {
      const stream = await fetch(`${base}/stream?visitorId=v`, {
        headers: { "Last-Event-ID": token },
      });
      expect(stream.status).toBe(200); // never 4xx/5xx for a resume token
      const frames = await readEvents(stream, 2);
      expect(frames[0]?.data).toEqual({ kind: "reset" }); // leading reset
      expect(
        frames.some(
          (f) =>
            (f.data as { kind?: string }).kind === "patch" &&
            (f.data as { patches?: { path?: string }[] }).patches?.[0]?.path === "",
        ),
      ).toBe(true); // full-replace snapshot
    }
  });

  it("accepts era:-1 as a valid resume base (no reset, no re-rehydrate loop)", async () => {
    // A pre-populated stage with NO delivered frames stamps its snapshot id era:-1;
    // resuming from that base must join without a reset (else an idle tab that only
    // ever received the snapshot would full-rehydrate on every reconnect).
    const inner = new MemoryStageStore();
    await inner.save({ agentId: "a", visitor: { visitorId: "v" }, stage: seededTree });
    const { server, base } = await start({ agentId: "a", agent: seedAgent, stageStore: inner });
    running = server;

    const s1 = await fetch(`${base}/stream?visitorId=v`);
    const first = await readEvents(s1, 2); // reset + snapshot stamped era:-1
    const snap = first.find((f) => f.id !== undefined);
    expect(snap?.id?.endsWith(":-1")).toBe(true); // stamped at N0 = -1
    const era = snap!.id!.slice(0, snap!.id!.indexOf(":"));

    const s2 = await fetch(`${base}/stream?visitorId=v`, {
      headers: { "Last-Event-ID": `${era}:-1` },
    });
    // Valid resume: no reset frame (not a full rehydrate).
    const frames = await collectEvents(s2, 250);
    expect(frames.every((f) => (f.data as { kind?: string }).kind !== "reset")).toBe(true);
  });

  it("ends the stream when the ring overflows during a rehydrate read", async () => {
    // The gap's head falls off the 200-frame ring mid-read → unstitchable → the
    // finalization writes nothing and ends, and the retry full-rehydrates.
    const RING_OVERFLOW = 201; // > FRAME_LOG_LIMIT (200) in server.ts
    const flood: FacetAgent = (event) =>
      event.kind === "message" && event.text === "flood"
        ? Array.from({ length: RING_OVERFLOW }, (_, i) => ({ kind: "say", text: `f${i}` }))
        : [{ kind: "patch", patches: [{ op: "replace", path: "", value: seededTree }] }];
    const inner = new MemoryStageStore();
    const stageStore = new DelayedGetStore(inner, 200);
    const { server, base } = await start({ agentId: "a", agent: flood, stageStore });
    running = server;

    // Seed a stored stage (one delivered frame → watermark N0 = 0 at the next connect).
    await postEvent(base, "v", { kind: "message", text: "seed" });
    await waitFor(async () => (await inner.get("a", "v"))?.stage.nodes["s1"] !== undefined);

    const first = await fetch(`${base}/stream?visitorId=v`);
    // During the 200ms delayed read, one event floods >FRAME_LOG_LIMIT frames.
    await postEvent(base, "v", { kind: "message", text: "flood" });
    expect(await streamEnded(first, 1_500)).toBe(true);

    // The retry (no token) full-rehydrates cleanly and stays open.
    const second = await fetch(`${base}/stream?visitorId=v`);
    const frames = await readEvents(second, 1);
    expect(frames[0]?.data).toEqual({ kind: "reset" });
  });

  it("leads a full rehydrate with an unstamped reset and stamps from the snapshot", async () => {
    const inner = new MemoryStageStore();
    const { server, base } = await start({ agentId: "a", agent: seedAgent, stageStore: inner });
    running = server;

    // Seed a stored stage first, from a connection we then drop.
    const s1 = await fetch(`${base}/stream?visitorId=v`);
    await postEvent(base, "v", { kind: "message", text: "seed" });
    await readEvents(s1, 2); // reset + snapshot (also disconnects s1)

    const stream = await fetch(`${base}/stream?visitorId=v`);
    const frames = await readEvents(stream, 2);
    // The reset frame carries NO id:.
    expect(frames[0]?.data).toEqual({ kind: "reset" });
    expect(frames[0]?.id).toBeUndefined();
    // Stamping starts at the snapshot (the full-replace patch).
    const snapshot = frames[1];
    expect((snapshot?.data as { kind?: string }).kind).toBe("patch");
    expect(snapshot?.id).toBeDefined();
    expect(snapshot?.id).toContain(":");
  });

  it("paints a token-less tab promptly during a mid-flight slow turn", async () => {
    // A slow (never-answered within the window) turn is in flight; a fresh
    // token-less tab must still rehydrate promptly (rehydrate runs OUTSIDE the lane).
    const inner = new MemoryStageStore();
    const { server, base } = await start({
      agentId: "a",
      agentTimeoutMs: 5_000,
      stageStore: inner,
    });
    running = server;
    const link = await dialAgent(base);

    // Seed a stored stage via a first quick turn (no browser stream needed — the
    // turn persists to the store regardless).
    await postEvent(base, "v", { kind: "message", text: "seed" });
    const seedEvt = await link.nextEvent();
    const seed: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { direction: "col" }, children: ["t1"] },
        t1: { id: "t1", type: "text", value: "seeded" },
      },
    };
    await control(base, seedEvt.requestId, [
      { kind: "patch", patches: [{ op: "replace", path: "", value: seed }] },
    ]);
    await waitFor(async () => (await inner.get("a", "v"))?.stage.nodes["t1"] !== undefined);

    // Start a slow turn that the agent will NOT answer within the window.
    await postEvent(base, "v", { kind: "message", text: "slow" });
    await link.nextEvent(); // agent received it but sits on it

    // A brand-new token-less tab connects: it must get reset+snapshot promptly,
    // NOT block behind the mid-flight slow turn (rehydrate runs outside the lane).
    const started = Date.now();
    const fresh = await fetch(`${base}/stream?visitorId=v`);
    const frames = await readEvents(fresh, 2);
    expect(Date.now() - started).toBeLessThan(1_000); // well before the slow turn resolves
    expect(frames[0]?.data).toEqual({ kind: "reset" });
    expect((frames[1]?.data as { kind?: string }).kind).toBe("patch");
    await link.close();
  });

  it("replays a frame delivered during the rehydrate read (loss-free window)", async () => {
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

    await postEvent(base, "v", { kind: "message", text: "seed" });
    await waitFor(async () => (await inner.get("a", "v"))?.stage.nodes["t1"] !== undefined);

    // Open the (re)connecting visitor, then fire a bump whose frame is delivered
    // DURING the delayed rehydrate read — it must be replayed before live flow.
    const stream = await fetch(`${base}/stream?visitorId=v`);
    await postEvent(base, "v", { kind: "message", text: "bump" });

    const frames = (await collectFrames(stream, 600)) as {
      kind?: string;
      patches?: { path?: string }[];
    }[];
    const fullIdx = frames.findIndex((f) => f.kind === "patch" && f.patches?.[0]?.path === "");
    const liveIdx = frames.findIndex(
      (f) => f.kind === "patch" && f.patches?.[0]?.path === "/nodes/t1/value",
    );
    expect(fullIdx).toBeGreaterThanOrEqual(0); // the full-replace rehydrate arrived
    expect(liveIdx).toBeGreaterThanOrEqual(0); // the bump was NOT lost in the window
    expect(fullIdx).toBeLessThan(liveIdx); // …and arrived before the live patch
  });
});

describe("agent handshake (DC-009)", () => {
  it("rejects a bad agent token with 403 on stream and control", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent, agentToken: "s3cret" });
    running = server;
    const badStream = await fetch(`${base}/agent/stream`, { headers: { "x-facet-token": "nope" } });
    expect(badStream.status).toBe(403);
    await badStream.body?.cancel();
    const badControl = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-facet-token": "nope" },
      body: JSON.stringify({ requestId: 1, messages: [] }),
    });
    expect(badControl.status).toBe(403);
  });

  it("rejects a non-positive or non-integer agentStaleMs at construction", () => {
    // 0/negative would make the reaper interval fire on ~0ms ticks and reap healthy
    // agents; fail fast at construction (no server is started, so nothing leaks).
    expect(() => createFacetServer({ port: 0, agentId: "a", agentStaleMs: 0 })).toThrow();
    expect(() => createFacetServer({ port: 0, agentId: "a", agentStaleMs: -5 })).toThrow();
    expect(() => createFacetServer({ port: 0, agentId: "a", agentStaleMs: 1.5 })).toThrow();
  });

  it("rejects a second agent with 409", async () => {
    const { server, base } = await start({ agentId: "a" });
    running = server;
    const first = await dialAgent(base);
    const second = await fetch(`${base}/agent/stream`);
    expect(second.status).toBe(409);
    await second.body?.cancel();
    await first.close();
  });

  it("keeps the agent slot alive while heartbeats arrive", async () => {
    const { server, base } = await start({ agentId: "a", agentStaleMs: 300 });
    running = server;
    const link = await dialAgent(base);
    for (let i = 0; i < 6; i += 1) {
      await new Promise((r) => setTimeout(r, 80));
      await fetch(`${base}/agent/heartbeat`, { method: "POST" });
    }
    // Slot still held: a second dial is refused, health still reports remote.
    const second = await fetch(`${base}/agent/stream`);
    expect(second.status).toBe(409);
    await second.body?.cancel();
    expect(await (await fetch(`${base}/health`)).text()).toBe("ok agent=remote");
    await link.close();
  });

  it("reaps a stale agent and accepts a new dial", async () => {
    const { server, base } = await start({ agentId: "a", agentStaleMs: 200 });
    running = server;
    const link = await dialAgent(base);
    // Stop heartbeating; the reaper (interval min(10s, staleMs)) drops the slot.
    await waitFor(
      async () => (await (await fetch(`${base}/health`)).text()) === "ok agent=local",
      3_000,
    );
    // The freed slot accepts a new dial.
    const redial = await fetch(`${base}/agent/stream`);
    expect(redial.status).toBe(200);
    await redial.body?.cancel();
    await link.close();
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
      postEvent(base, "v", { kind: "message", text });

    // Seed a stored stage to rehydrate FROM (no stream connected yet — just persist).
    await post("seed");
    await waitFor(async () => (await inner.get("a", "v"))?.stage.nodes["t1"] !== undefined);

    // Open the (re)connecting visitor, then immediately fire a newer live patch. The
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
    // would silently roll the visitor back).
    expect(liveIdx === -1 || fullIdx < liveIdx).toBe(true);
  });

  it("ends the stream when rehydrate fails, so the visitor can reconnect", async () => {
    const stageStore = new FailOnceGetStore(new MemoryStageStore());
    const { server, base } = await start({ agentId: "a", agent: sayAgent, stageStore });
    running = server;

    // First connect: the rehydrate `get` throws — the response must END rather than
    // stay open forever (a frozen visitor the server never pings or reconnects).
    const first = await fetch(`${base}/stream?visitorId=v`);
    expect(first.status).toBe(200);
    expect(await streamEnded(first, 1_000)).toBe(true);

    // Reconnect (no resume token): the second `get` succeeds, so the stream stays
    // open — and it performs a FULL rehydrate (leading reset), never a false resume.
    const second = await fetch(`${base}/stream?visitorId=v`);
    expect(second.status).toBe(200);
    const frames = await readEvents(second, 1);
    expect(frames[0]?.data).toEqual({ kind: "reset" });
  });

  it("rejects an /event action payload that is an array", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "tap", action: { name: "buy", payload: ["a", "b"] } },
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
        event: { kind: "tap", action: { name: "buy", payload: { nested: { deep: 1 } } } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an action event whose fields value exceeds the cap", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await postEvent(base, "v", {
      kind: "tap",
      action: { name: "submit" },
      fields: { note: "x".repeat(MAX_FIELD_VALUE_CHARS + 1) },
    });
    expect(response.status).toBe(400);
  });

  it("rejects an action event with a non-string fields value", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await postEvent(base, "v", {
      kind: "tap",
      action: { name: "submit" },
      fields: { count: 7 },
    });
    expect(response.status).toBe(400);
  });

  it("rejects an action event whose fields is an array", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await postEvent(base, "v", {
      kind: "tap",
      action: { name: "submit" },
      fields: ["a", "b"],
    });
    expect(response.status).toBe(400);
  });

  it("rejects an action event with a nested-object fields value", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await postEvent(base, "v", {
      kind: "tap",
      action: { name: "submit" },
      fields: { name: { deep: "nested" } },
    });
    expect(response.status).toBe(400);
  });

  it("accepts a valid fields record and delivers it to the agent verbatim", async () => {
    const captured: ClientEvent[] = [];
    const capturingAgent: FacetAgent = (event) => {
      captured.push(event);
      return [];
    };
    const { server, base } = await start({ agentId: "a", agent: capturingAgent });
    running = server;
    // A value at exactly the cap is valid — the boundary is inclusive.
    const fields = { name: "Ada", note: "y".repeat(MAX_FIELD_VALUE_CHARS) };
    const response = await postEvent(base, "v", {
      kind: "tap",
      action: { name: "submit", payload: { screen: "form" } },
      fields,
    });
    expect(response.status).toBe(202);
    await waitFor(async () => captured.length === 1);
    const event = captured[0];
    expect(event?.kind).toBe("tap");
    expect(event?.kind === "tap" ? event.fields : undefined).toEqual(fields);
  });

  it("accepts an action without fields exactly as before", async () => {
    const captured: ClientEvent[] = [];
    const capturingAgent: FacetAgent = (event) => {
      captured.push(event);
      return [];
    };
    const { server, base } = await start({ agentId: "a", agent: capturingAgent });
    running = server;
    const response = await postEvent(base, "v", {
      kind: "tap",
      action: { name: "buy", payload: { sku: "s1" } },
    });
    expect(response.status).toBe(202);
    await waitFor(async () => captured.length === 1);
    const event = captured[0];
    expect(event?.kind).toBe("tap");
    expect(event?.kind === "tap" ? event.fields : undefined).toBeUndefined();
  });

  it("rejects an action event with an ill-typed collect", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const response = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "tap", action: { name: "submit", collect: { nested: "obj" } } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an action event with too many field keys", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const fields: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) fields[`k${String(i)}`] = "v";
    const response = await postEvent(base, "v", {
      kind: "tap",
      action: { name: "submit" },
      fields,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a spoofed navigate/toggle action on the transport", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // navigate/toggle are client-local and never sent by the renderer; only an
    // "agent" (or bare-name) action is legal on /event.
    const response = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "tap", action: { kind: "navigate", name: "x", to: "about" } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("does not crash on a malformed request-target — returns 400 and stays up", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const port = Number(new URL(base).port);
    // `new URL("//[")` throws; an unguarded handler throw would crash the process.
    const firstLine = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write("GET //[ HTTP/1.1\r\nHost: x\r\n\r\n");
      });
      let buf = "";
      socket.on("data", (d) => {
        buf += d.toString();
      });
      socket.on("end", () => resolve(buf.split("\r\n")[0] ?? ""));
      socket.on("error", reject);
      setTimeout(() => socket.end(), 300);
    });
    expect(firstLine).toContain("400");
    // The server is still alive and serving after the malformed request.
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
  });

  it("accepts a host bind option and serves /health on loopback", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent, host: "127.0.0.1" });
    running = server;
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok agent=local");
  });

  it("rejects an /agent/control patch message over the op-count cap with 400", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // A well-shaped control body whose patch carries more than MAX_PATCH_OPS ops:
    // without the wire cap it would reach the runtime and stall the fold path.
    const patches = Array.from({ length: MAX_PATCH_OPS + 1 }, () => ({
      op: "add" as const,
      path: "/nodes/x",
      value: { id: "x", type: "text" as const, value: "x" },
    }));
    const response = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: 1, messages: [{ kind: "patch", patches }] }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an /agent/control frame whose patch messages AGGREGATE over the op-count cap with 400", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // Two individually-valid patch messages (600 ops each) that coalesce to 1200 >
    // MAX_PATCH_OPS at the runtime fold. The per-frame aggregate cap must 400 them
    // at the boundary the agent can observe — not 202 then silently drop every edit.
    const mkPatch = (): { kind: "patch"; patches: unknown[] } => ({
      kind: "patch",
      patches: Array.from({ length: 600 }, () => ({
        op: "add" as const,
        path: "/nodes/x",
        value: { id: "x", type: "text" as const, value: "x" },
      })),
    });
    const response = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: 1, messages: [mkPatch(), mkPatch()] }),
    });
    expect(response.status).toBe(400);
  });

  it("accepts an /agent/control patch message exactly AT the op-count cap", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    const patches = Array.from({ length: MAX_PATCH_OPS }, () => ({
      op: "add" as const,
      path: "/nodes/x",
      value: { id: "x", type: "text" as const, value: "x" },
    }));
    const response = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: 999, messages: [{ kind: "patch", patches }] }),
    });
    // Shape is valid → 202 (an unknown requestId is a bounded no-op, still 202).
    expect(response.status).toBe(202);
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

describe("record channel (WU-5)", () => {
  it("POST /record persists a collected tap without invoking the agent and rejects malformed bodies", async () => {
    const sink = new MemorySink();
    let agentCalls = 0;
    const countingAgent: FacetAgent = () => {
      agentCalls += 1;
      return [];
    };
    const { server, base } = await start({ agentId: "a", agent: countingAgent, sink });
    running = server;

    // A valid collected local tap (a renderer-resolved navigate) persists to the Sink…
    const ok = await postRecord(base, "v", {
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
    });
    expect(ok.status).toBe(202);
    await waitFor(async () => (await sink.history("a", "v")).length >= 1);
    const history = await sink.history("a", "v");
    expect(history).toHaveLength(1);
    expect(history[0]?.event.kind).toBe("tap");
    expect(history[0]?.event.kind === "tap" ? history[0]?.event.effect : undefined).toEqual({
      navigate: "about",
    });
    // …with NO agent turn and NO stage patch (a local tap never reaches the brain — DC-005).
    expect(history[0]?.messages).toEqual([]);
    expect(agentCalls).toBe(0);

    // A malformed /record body → 400 with no Sink write (DC-007).
    const bad = await postRecord(base, "v", { kind: "nope" });
    expect(bad.status).toBe(400);
    // Give any (erroneous) lane task a chance to run, then assert history is unchanged.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(1);
    expect(agentCalls).toBe(0);
  });

  it("400-rejects a /event tap whose action.kind is not agent (RISK-INV-4)", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // A spoofed local-effect tap must never reach the agent over the forward /event
    // channel — only an "agent" (or bare-name) action is legal there.
    const response = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "tap", action: { kind: "toggle", name: "x", node: "n" } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("appends interleaved /event, /record, /event in send order (DC-002)", async () => {
    const sink = new MemorySink();
    let release = (): void => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // The first message turn (A) parks on the gate so B(/record) and C(/event)
    // enqueue behind it on the SAME per-visitor lane.
    const slowAgent: FacetAgent = async (event) => {
      if (event.kind === "message" && event.text === "A") {
        await gate;
        return [{ kind: "say", text: "A-done" }];
      }
      return [];
    };
    const { server, base } = await start({ agentId: "a", agent: slowAgent, sink });
    running = server;

    // Await each 202 so its lane enqueue has committed (the handler enqueues
    // synchronously right after res.end()) before the next request is sent.
    expect((await postEvent(base, "v", { kind: "message", text: "A" })).status).toBe(202);
    expect(
      (await postRecord(base, "v", { kind: "tap", target: "t", effect: { toggle: "n" } })).status,
    ).toBe(202);
    expect((await postEvent(base, "v", { kind: "message", text: "C" })).status).toBe(202);

    release();
    await waitFor(async () => (await sink.history("a", "v")).length >= 3);
    const history = await sink.history("a", "v");
    // Append order == send order, independent of async sink latency or `at`.
    expect(history.map((e) => e.event.kind)).toEqual(["message", "tap", "message"]);
    expect(history[0]?.event.kind === "message" ? history[0]?.event.text : undefined).toBe("A");
    expect(history[2]?.event.kind === "message" ? history[2]?.event.text : undefined).toBe("C");
  });
});

describe("record validation hardening", () => {
  it("POST /record rejects a non-number seq and an over-long effect/target string", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A non-number `seq` must be rejected: the guard narrows the body to a
    // CollectedEvent whose `seq?: number`, so a `"x"` (or `{}`) would be
    // persisted as a non-number while TS believes it's `number | undefined`.
    const badSeq = await postRecord(base, "v", {
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
      seq: "x",
    });
    expect(badSeq.status).toBe(400);

    // An over-long navigate string (past the shared field cap) must be rejected
    // so a ~5 MiB effect can't be persisted into the unbounded Sink.
    const longNav = await postRecord(base, "v", {
      kind: "tap",
      effect: { navigate: "x".repeat(MAX_FIELD_VALUE_CHARS + 1) },
    });
    expect(longNav.status).toBe(400);

    // An over-long `target` string must be rejected too (same cap as fields).
    const longTarget = await postRecord(base, "v", {
      kind: "tap",
      target: "t".repeat(MAX_FIELD_VALUE_CHARS + 1),
      effect: { toggle: "n" },
    });
    expect(longTarget.status).toBe(400);

    // No Sink write for any rejected body.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);

    // A valid small effect (with a numeric seq) still 202s and persists.
    const ok = await postRecord(base, "v", {
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
      seq: 3,
    });
    expect(ok.status).toBe(202);
    await waitFor(async () => (await sink.history("a", "v")).length >= 1);
  });

  it("isTapEffect rejects malformed /record effects", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // effect present but not an object → rejected.
    expect((await postRecord(base, "v", { kind: "tap", effect: "nope" })).status).toBe(400);
    // navigate present but not a string → rejected.
    expect((await postRecord(base, "v", { kind: "tap", effect: { navigate: 7 } })).status).toBe(
      400,
    );
    // toggle present but not a string → rejected.
    expect((await postRecord(base, "v", { kind: "tap", effect: { toggle: {} } })).status).toBe(400);
    // neither key present → isTapEffect defines this invalid.
    expect((await postRecord(base, "v", { kind: "tap", effect: {} })).status).toBe(400);

    // None of these wrote to the Sink.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);
  });

  it("POST /record rejects a semantically-empty tap (no effect or target)", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A bare `{kind:"tap"}` carries no actionable local-tap payload: no effect and
    // no target. The renderer ALWAYS attaches a navigate/toggle effect (+ target) to
    // a local tap, so an effect/target-less tap can only be a hand-crafted body. It
    // must 400 so no inert no-content StoredEvent is persisted (which would later
    // replay as an `(unknown event)` prompt line).
    const empty = await postRecord(base, "v", { kind: "tap" });
    expect(empty.status).toBe(400);

    // Fields-only (still no effect and no target) is just as inert → rejected.
    const fieldsOnly = await postRecord(base, "v", { kind: "tap", fields: { a: "b" } });
    expect(fieldsOnly.status).toBe(400);

    // Neither wrote to the Sink.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);

    // A valid tap that carries a target + effect still 202s and persists.
    const ok = await postRecord(base, "v", {
      kind: "tap",
      target: "box1",
      effect: { navigate: "pricing" },
    });
    expect(ok.status).toBe(202);
    await waitFor(async () => (await sink.history("a", "v")).length >= 1);
    expect(await sink.history("a", "v")).toHaveLength(1);
  });

  it("POST /record rejects a target-only tap with no renderable effect", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A hand-crafted `{kind:"tap", target:"x"}` carries a `target` but NO renderable
    // payload: `describeEvent` renders a tap from its `effect` (or `action`), never
    // from `target`, so this would replay as the very `(unknown event)` prompt line
    // the drop guard exists to prevent. `action` is already rejected on /record, so a
    // local tap can only render via `effect` — a target-only tap must 400.
    const targetOnly = await postRecord(base, "v", { kind: "tap", target: "x" });
    expect(targetOnly.status).toBe(400);

    // No Sink write for the rejected body.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);
  });
});

/** A Sink whose `record` for a collected LOCAL tap (kind "tap", no messages) hangs
 * until `release()` — modelling a slow/hung durable Sink under load. Message/agent
 * turns record through untouched. Used to prove /record's write is fire-and-forget
 * on the shared per-visitor lane and can't wedge a later /event turn. */
class GatedSink implements Sink {
  private readonly inner = new MemorySink();
  gateTapRecord = false;
  private releaseHeld: () => void = () => {};
  private readonly held = new Promise<void>((r) => {
    this.releaseHeld = r;
  });
  release(): void {
    this.releaseHeld();
  }
  async record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void> {
    if (this.gateTapRecord && entry.event.kind === "tap" && entry.messages.length === 0) {
      await this.held;
    }
    return this.inner.record(agentId, visitorId, entry);
  }
  history(agentId: string, visitorId: string): Promise<readonly StoredEvent[]> {
    return this.inner.history(agentId, visitorId);
  }
}

describe("record + event validation hardening (round 2)", () => {
  const postRawEvent = (base: string, event: unknown): Promise<Response> =>
    fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: { visitorId: "v" }, event }),
    });

  it("POST /record rejects a tap carrying an action (null or object)", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A local navigate/toggle tap only ever carries `effect` — never `action`. An
    // `action` (even null) must 400 at the boundary so it can't be persisted verbatim
    // to the Sink (poisoning the durable log / bypassing the field cap).
    expect((await postRecord(base, "v", { kind: "tap", action: null })).status).toBe(400);
    expect(
      (await postRecord(base, "v", { kind: "tap", action: { kind: "agent", name: "x" } })).status,
    ).toBe(400);

    // No Sink write for either rejected body.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);
  });

  it("POST /record does not block a later /event on a slow sink", async () => {
    const sink = new GatedSink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;
    const stream = await fetch(`${base}/stream?visitorId=v`);

    // The /record's Sink write hangs. On the shared per-visitor lane an `await`ed
    // record would wedge the visitor's later /event (head-of-line blocking). With
    // fire-and-forget, the lane frees after the synchronous slot reservation.
    sink.gateTapRecord = true;
    expect(
      (await postRecord(base, "v", { kind: "tap", target: "t", effect: { toggle: "n" } })).status,
    ).toBe(202);
    expect((await postEvent(base, "v", { kind: "message", text: "hi" })).status).toBe(202);

    // The /event turn's say must arrive WITHOUT the hung sink write ever settling.
    const frames = await collectEvents(stream, 800);
    expect(sayText(frames)).toContain("hello from agent");
    sink.release(); // let the parked writes drain so close() doesn't hang
  });

  it("POST /event rejects a tap carrying effect or target", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // effect/target are LOCAL-tap fields; an /event agent tap carries `action` only.
    expect(
      (await postRawEvent(base, { kind: "tap", action: { name: "x" }, effect: { navigate: "a" } }))
        .status,
    ).toBe(400);
    expect(
      (await postRawEvent(base, { kind: "tap", action: { name: "x" }, target: "cta" })).status,
    ).toBe(400);
  });

  it("POST /event rejects a non-number seq", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // `seq` narrows to `number | undefined`; a non-number must 400 (not persist unsoundly).
    expect((await postRawEvent(base, { kind: "message", text: "hi", seq: "x" })).status).toBe(400);
    expect(
      (await postRawEvent(base, { kind: "tap", action: { name: "x" }, seq: "x" })).status,
    ).toBe(400);
  });
});
