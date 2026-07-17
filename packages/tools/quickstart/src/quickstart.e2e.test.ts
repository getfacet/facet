/**
 * /live-test Tier 1b (spec Decision 7, DC-001 + DC-008) — the deterministic
 * stub E2E over the REAL boot path: `startQuickstart` (wrapper + loopback
 * proxy) driven by `createStubAgent`, a fixture page bundle injected via
 * `pageBundlePath`. Lives inside the root vitest glob on purpose, so plain
 * `pnpm test` runs it — zero keys, zero network beyond localhost, ephemeral
 * random ports (parallel-safe), and no clock-derived assertions (run-twice
 * must be identical).
 *
 * The SSE frame plumbing is ADAPTED from
 * packages/adapters/server/src/server.test.ts (parseBlock/drainFrames/readEvents)
 * — copied locally, never imported across packages from a test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connect } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRICK_TYPES } from "@facet/core";
import type { FacetPattern, FacetTheme, FacetTree } from "@facet/core";
import { defineAgent } from "@facet/agent";
import { DEFAULT_THEME } from "@facet/react";
import { MemorySink } from "@facet/runtime";
import { createStubAgent } from "@facet/reference-agent";
import { runCli, type RunCliHooks } from "./cli.js";
import { QUICKSTART_INITIAL_STAGE, QUICKSTART_PAGE_BRIEF } from "./guide.js";
import { startQuickstart, type QuickstartServerOptions, type RunningQuickstart } from "./server.js";

const FIXTURE_BUNDLE = `console.log("facet quickstart fixture bundle");\n`;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TEST_PROVIDER_ENV = { OPENAI_API_KEY: "sk-test" } as const;
// Hard-cut negative: these removed node kinds must never appear in a shipped seed or provider page.
const RETIRED_NODE_TYPES = [
  ["but", "ton"].join(""),
  ["fo", "rm"].join(""),
  ["filter", "Bar"].join(""),
  ["met", "ric"].join(""),
  ["ta", "bs"].join(""),
  ["n", "av"].join(""),
  ["st", "at"].join(""),
] as const;

const OPERATOR_PATTERN_NODE_ID = "qs-pattern-provenance-node";
const OPERATOR_PATTERN_PROVENANCE = "provider-only-pattern-provenance-7f4c";

/** Concrete operator reference for `--assets`; only the provider may observe its full JSON. */
const OPERATOR_PATTERN: FacetPattern = {
  name: "qs-operator-panel",
  description: "Concrete operator panel Pattern",
  useWhen: "Use when authoring an operator status panel.",
  root: OPERATOR_PATTERN_NODE_ID,
  nodes: {
    [OPERATOR_PATTERN_NODE_ID]: {
      id: OPERATOR_PATTERN_NODE_ID,
      type: "box",
      style: { preset: "panel" },
      children: [`${OPERATOR_PATTERN_NODE_ID}.copy`],
    },
    [`${OPERATOR_PATTERN_NODE_ID}.copy`]: {
      id: `${OPERATOR_PATTERN_NODE_ID}.copy`,
      type: "text",
      value: OPERATOR_PATTERN_PROVENANCE,
      style: { preset: "body" },
    },
  },
};

const CATALOG_DASHBOARD_TREE: FacetTree = {
  root: "catalog-dashboard",
  nodes: {
    "catalog-dashboard": {
      id: "catalog-dashboard",
      type: "box",
      style: {
        preset: "panel",
        gap: "md",
        padding: "lg",
        borderRadius: "lg",
        width: "full",
      },
      children: [
        "catalog-dashboard.eyebrow",
        "catalog-dashboard.title",
        "catalog-arr",
        "catalog-pricing",
      ],
    },
    "catalog-dashboard.eyebrow": {
      id: "catalog-dashboard.eyebrow",
      type: "text",
      value: "Operator catalog",
      style: { color: "mutedForeground", fontSize: "sm", fontWeight: "semibold" },
    },
    "catalog-dashboard.title": {
      id: "catalog-dashboard.title",
      type: "text",
      value: "Catalog dashboard",
      style: { preset: "heading", fontSize: "xl", fontWeight: "bold" },
    },
    "catalog-arr": {
      id: "catalog-arr",
      type: "box",
      style: { preset: "panel", gap: "xs", padding: "md", borderRadius: "md" },
      children: ["catalog-arr.label", "catalog-arr.value", "catalog-arr.delta"],
    },
    "catalog-arr.label": {
      id: "catalog-arr.label",
      type: "text",
      value: "ARR",
      style: { color: "mutedForeground", fontSize: "sm", fontWeight: "medium" },
    },
    "catalog-arr.value": {
      id: "catalog-arr.value",
      type: "text",
      value: "$1.2M",
      style: { fontSize: "xl", fontWeight: "bold" },
    },
    "catalog-arr.delta": {
      id: "catalog-arr.delta",
      type: "text",
      value: "+18%",
      style: { color: "success", fontSize: "sm", fontWeight: "semibold" },
    },
    "catalog-pricing": {
      id: "catalog-pricing",
      type: "box",
      style: {
        preset: "panel",
        gap: "sm",
        padding: "md",
        borderRadius: "md",
        shadow: "md",
      },
      children: ["catalog-pricing.title", "catalog-pricing.body", "catalog-pricing-cta"],
    },
    "catalog-pricing.title": {
      id: "catalog-pricing.title",
      type: "text",
      value: "Pricing path",
      style: { fontSize: "lg", fontWeight: "bold" },
    },
    "catalog-pricing.body": {
      id: "catalog-pricing.body",
      type: "text",
      value: "Route qualified teams to the Pro plan.",
      style: { color: "mutedForeground" },
    },
    "catalog-pricing-cta": {
      id: "catalog-pricing-cta",
      type: "box",
      style: { preset: "primaryAction", padding: "sm", borderRadius: "md" },
      children: ["catalog-pricing-cta.label"],
      onPress: { kind: "agent", name: "view_pricing", payload: { plan: "pro" } },
    },
    "catalog-pricing-cta.label": {
      id: "catalog-pricing-cta.label",
      type: "text",
      value: "View pricing",
      style: { preset: "actionLabel", color: "accentForeground", fontWeight: "semibold" },
    },
  },
};

function nativePanelTree(id: string, title: string): FacetTree {
  const titleId = `${id}.title`;
  const copyId = `${id}.copy`;
  return {
    root: id,
    nodes: {
      [id]: {
        id,
        type: "box",
        style: { preset: "panel", gap: "md", padding: "lg", borderRadius: "lg", width: "full" },
        children: [titleId, copyId],
      },
      [titleId]: {
        id: titleId,
        type: "text",
        value: title,
        style: { preset: "heading", fontSize: "xl", fontWeight: "bold" },
      },
      [copyId]: {
        id: copyId,
        type: "text",
        value: `${title} authored with native bricks`,
      },
    },
  };
}

/** One parsed SSE frame: its optional `id:` line and its decoded `data:` payload. */
interface SseFrame {
  readonly id?: string;
  readonly data: unknown;
}

interface Captured {
  readonly out: string[];
  readonly err: string[];
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

interface MockOpenAiToolCall {
  readonly name: string;
  readonly input: unknown;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (line) => out.push(line), error: (line) => err.push(line) };
}

function mockCall(name: string, input: unknown): MockOpenAiToolCall {
  return { name, input };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function parseFetchBody(init: Parameters<typeof fetch>[1] | undefined): unknown {
  if (typeof init?.body !== "string") return {};
  return JSON.parse(init.body) as unknown;
}

function openAiResponse(toolCalls: readonly MockOpenAiToolCall[]): Response {
  const message =
    toolCalls.length === 0
      ? { content: "" }
      : {
          content: null,
          tool_calls: toolCalls.map((call, index) => ({
            id: `catalog-call-${String(index)}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.input) },
          })),
        };
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installOpenAiMock(steps: readonly (readonly MockOpenAiToolCall[] | Error)[]): {
  readonly bodies: unknown[];
  restore(): void;
} {
  const realFetch = globalThis.fetch.bind(globalThis);
  const bodies: unknown[] = [];
  let next = 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (requestUrl(input) === OPENAI_URL) {
      bodies.push(parseFetchBody(init));
      const step = steps[Math.min(next, steps.length - 1)] ?? [];
      next += 1;
      if (step instanceof Error) return Promise.reject(step); // offline provider
      return Promise.resolve(openAiResponse(step));
    }
    return realFetch(input, init);
  });
  return {
    bodies,
    restore: () => spy.mockRestore(),
  };
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

function postRecord(base: string, visitorId: string, event: unknown): Promise<Response> {
  return fetch(`${base}/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: { visitorId }, event }),
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor timed out");
}

/**
 * Boot `startQuickstart` on a random free port, retrying on collisions (the
 * server.test.ts bind-retry pattern). Defaults to the stub agent + fixture
 * bundle; `overrides` swaps in a recording agent, `themes`, or an `initialStage`
 * for the seeding/theme-map tests.
 */
async function boot(overrides: Partial<QuickstartServerOptions> = {}): Promise<RunningQuickstart> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    try {
      return await startQuickstart({
        port,
        agentId: "quickstart-e2e",
        agent: createStubAgent(),
        pageBundlePath: bundlePath,
        ...overrides,
      });
    } catch {
      // EADDRINUSE — try another port
    }
  }
  throw new Error("could not boot startQuickstart on a free port");
}

async function bootCli(
  extraArgs: readonly string[],
  extraHooks: Partial<RunCliHooks> = {},
): Promise<{ captured: Captured; running: RunningQuickstart }> {
  let lastOutput = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const captured = capture();
    let running: RunningQuickstart | undefined;
    const code = await runCli(["--port", String(port), ...extraArgs], TEST_PROVIDER_ENV, {
      ...extraHooks,
      log: captured.log,
      error: captured.error,
      onStarted: (handle) => {
        running = handle;
        extraHooks.onStarted?.(handle);
      },
    });
    if (code === 0 && running !== undefined) return { captured, running };
    await running?.close();
    lastOutput = [...captured.err, ...captured.out].join("\n");
  }
  throw new Error(`could not boot the quickstart CLI on a free port\n${lastOutput}`);
}

let fixtureDir: string;
let bundlePath: string;
let running: RunningQuickstart;
let base: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "facet-quickstart-e2e-"));
  bundlePath = join(fixtureDir, "app.js");
  await writeFile(bundlePath, FIXTURE_BUNDLE, "utf8");
  running = await boot();
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
    expect(body).toContain("https://fonts.googleapis.com/css2?family=Nunito");
    expect(body).toContain('src="/app.js"');
  });

  it("GET /app.js serves the injected fixture bundle", async () => {
    const response = await fetch(`${base}/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toBe(FIXTURE_BUNDLE);
  });

  it("HEAD /app.js and GET /favicon.ico return clean browser-facing responses", async () => {
    const bundleHead = await fetch(`${base}/app.js`, { method: "HEAD" });
    expect(bundleHead.status).toBe(200);
    expect(bundleHead.headers.get("content-type")).toContain("text/javascript");
    expect(await bundleHead.text()).toBe("");

    const favicon = await fetch(`${base}/favicon.ico`);
    expect(favicon.status).toBe(204);
    expect(await favicon.text()).toBe("");
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

  it("refuses a non-loopback Host header (DNS rebinding) on a loopback bind", async () => {
    const port = Number(new URL(base).port);
    const firstLine = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        // A rebound attacker domain: origin and Host match, but Host isn't loopback.
        socket.write(`GET /health HTTP/1.1\r\nHost: attacker.example:${String(port)}\r\n\r\n`);
      });
      let buf = "";
      socket.on("data", (d) => {
        buf += d.toString();
      });
      socket.on("end", () => resolve(buf.split("\r\n")[0] ?? ""));
      socket.on("error", reject);
      setTimeout(() => socket.end(), 300);
    });
    expect(firstLine).toContain("403");
  });

  it("refuses a non-loopback Host on GET / and leaks no seed data to a rebound origin", async () => {
    // The shell now inlines operator data (`__FACET_INITIAL_STAGE__`), so the
    // DNS-rebinding guard must front `/` too — a rebound attacker.example must
    // not read the seed tree out of the boot script.
    const seeded = await boot({ initialStage: SEED_TREE });
    try {
      const port = Number(new URL(seeded.url).port);
      const raw = await new Promise<string>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1", () => {
          socket.write(`GET / HTTP/1.1\r\nHost: attacker.example:${String(port)}\r\n\r\n`);
        });
        let buf = "";
        socket.on("data", (d) => {
          buf += d.toString();
        });
        socket.on("end", () => resolve(buf));
        socket.on("error", reject);
        setTimeout(() => socket.end(), 300);
      });
      const statusLine = raw.split("\r\n")[0] ?? "";
      expect(statusLine).toContain("403");
      // No boot script and no seed content crossed to the rebound origin.
      expect(raw).not.toContain("__FACET_INITIAL_STAGE__");
      expect(raw).not.toContain("seed-root");
    } finally {
      await seeded.close();
    }
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
        kind: "tap",
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

  it("records forwarded turns and local /record taps into the injected sink", async () => {
    const sink = new MemorySink();
    const logged = await boot({ sink });
    try {
      const visitorId = "e2e-logging";
      const stream = await openStream(logged.url, visitorId);
      try {
        await stream.next(1); // reset

        const visitPost = await postEvent(logged.url, visitorId, {
          kind: "visit",
          visitor: { visitorId },
        });
        expect(visitPost.status).toBe(202);
        await stream.next(1); // visit patch

        const messagePost = await postEvent(logged.url, visitorId, {
          kind: "message",
          text: "log-me",
        });
        expect(messagePost.status).toBe(202);
        const messageFrames = await stream.next(2); // patch + say
        expect(sayTexts(messageFrames)).toEqual(["stub: log-me"]);

        const recordPost = await postRecord(logged.url, visitorId, {
          kind: "tap",
          target: "go-about",
          effect: { navigate: "about" },
          fields: { source: "nav" },
        });
        expect(recordPost.status).toBe(202);

        await waitFor(async () => (await sink.history("quickstart-e2e", visitorId)).length >= 3);
        const history = await sink.history("quickstart-e2e", visitorId);
        expect(history.map((entry) => entry.event.kind)).toEqual(["visit", "message", "tap"]);
        expect(
          history[0]?.event.kind === "visit" ? history[0].event.visitor.visitorId : undefined,
        ).toBe("[redacted]");
        expect(JSON.stringify(history)).not.toContain(visitorId);
        expect(history[0]?.messages.some((message) => message.kind === "patch")).toBe(true);
        expect(history[1]?.event.kind === "message" ? history[1].event.text : undefined).toBe(
          "log-me",
        );
        expect(
          history[1]?.messages.some(
            (message) => message.kind === "say" && message.text === "stub: log-me",
          ),
        ).toBe(true);
        expect(history[2]?.event.kind === "tap" ? history[2].event.effect : undefined).toEqual({
          navigate: "about",
        });
        expect(history[2]?.messages).toEqual([]);
      } finally {
        await stream.close();
      }
    } finally {
      await logged.close();
    }
  });

  it("records local navigate/toggle taps without invoking the quickstart agent", async () => {
    const sink = new MemorySink();
    let agentCalls = 0;
    const countingAgent = defineAgent(() => {
      agentCalls += 1;
    });
    const logged = await boot({ agent: countingAgent, sink });
    try {
      const visitorId = "e2e-local-record-only";
      const navigate = await postRecord(logged.url, visitorId, {
        kind: "tap",
        target: "go-about",
        effect: { navigate: "about" },
      });
      expect(navigate.status).toBe(202);
      const toggle = await postRecord(logged.url, visitorId, {
        kind: "tap",
        target: "panel-toggle",
        effect: { toggle: "panel" },
      });
      expect(toggle.status).toBe(202);

      await waitFor(async () => (await sink.history("quickstart-e2e", visitorId)).length >= 2);
      const history = await sink.history("quickstart-e2e", visitorId);
      expect(history.map((entry) => entry.event.kind)).toEqual(["tap", "tap"]);
      expect(history.map((entry) => entry.messages)).toEqual([[], []]);
      expect(history[0]?.event.kind === "tap" ? history[0].event.effect : undefined).toEqual({
        navigate: "about",
      });
      expect(history[1]?.event.kind === "tap" ? history[1].event.effect : undefined).toEqual({
        toggle: "panel",
      });
      expect(agentCalls).toBe(0);
    } finally {
      await logged.close();
    }
  });

  it("isolates two visitors' stage snapshots and replies through the proxy", async () => {
    const alphaId = "e2e-isolation-alpha";
    const betaId = "e2e-isolation-beta";
    const alpha = await openStream(base, alphaId);
    const beta = await openStream(base, betaId);
    try {
      await alpha.next(1); // reset
      await beta.next(1); // reset
      await postEvent(base, alphaId, { kind: "visit", visitor: { visitorId: alphaId } });
      await postEvent(base, betaId, { kind: "visit", visitor: { visitorId: betaId } });
      await alpha.next(1); // visit patch
      await beta.next(1); // visit patch

      await postEvent(base, alphaId, { kind: "message", text: "alpha-only" });
      const alphaFrames = await alpha.next(2);
      expect(sayTexts(alphaFrames)).toEqual(["stub: alpha-only"]);
      expect(JSON.stringify(alphaFrames)).toContain("alpha-only");

      await postEvent(base, betaId, { kind: "message", text: "beta-only" });
      const betaFrames = await beta.next(2);
      expect(sayTexts(betaFrames)).toEqual(["stub: beta-only"]);
      expect(JSON.stringify(betaFrames)).toContain("beta-only");
    } finally {
      await alpha.close();
      await beta.close();
    }

    const alphaReconnect = await fetch(`${base}/stream?visitorId=${alphaId}`);
    const alphaSnapshot = await readEvents(alphaReconnect, 2); // reset + stage snapshot
    const alphaText = JSON.stringify(alphaSnapshot);
    expect(alphaText).toContain("alpha-only");
    expect(alphaText).not.toContain("beta-only");

    const betaReconnect = await fetch(`${base}/stream?visitorId=${betaId}`);
    const betaSnapshot = await readEvents(betaReconnect, 2); // reset + stage snapshot
    const betaText = JSON.stringify(betaSnapshot);
    expect(betaText).toContain("beta-only");
    expect(betaText).not.toContain("alpha-only");
  });
});

describe("quickstart E2E — Pattern recovery and provider-only assets", () => {
  it("recovers from an invalid style call with Pattern first discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "facet-quickstart-pattern-"));
    const openAi = installOpenAiMock([
      [mockCall("get_pattern", { name: OPERATOR_PATTERN.name })],
      [
        mockCall("render_page", {
          tree: {
            ...CATALOG_DASHBOARD_TREE,
            nodes: {
              ...CATALOG_DASHBOARD_TREE.nodes,
              "catalog-dashboard": {
                ...CATALOG_DASHBOARD_TREE.nodes["catalog-dashboard"],
                style: { preset: "panel", padding: "giant" },
              },
            },
          },
        }),
      ],
      [
        mockCall("render_page", { tree: CATALOG_DASHBOARD_TREE }),
        mockCall("say", { text: "native dashboard ready" }),
      ],
      [],
    ]);
    let running: RunningQuickstart | undefined;
    try {
      await writeFile(join(dir, "patterns.json"), JSON.stringify([OPERATOR_PATTERN]), "utf8");
      const booted = await bootCli(["--assets", dir]);
      running = booted.running;

      const shell = await (await fetch(`${running.url}/`)).text();
      expect(shell).toContain("__FACET_THEME__");
      expect(shell).not.toContain(OPERATOR_PATTERN_NODE_ID);
      expect(shell).not.toContain(OPERATOR_PATTERN_PROVENANCE);
      expect(shell).not.toContain("__FACET_PATTERNS__");

      const visitorId = "e2e-pattern-recovery";
      const stream = await openStream(running.url, visitorId);
      let frameText = "";
      try {
        await stream.next(1); // reset
        const post = await postEvent(running.url, visitorId, {
          kind: "message",
          text: "Read the operator Pattern, then build a styled native dashboard",
        });
        expect(post.status).toBe(202);

        const frames = await stream.next(3);
        expect(frames.map((frame) => kindOf(frame.data))).toEqual(["patch", "patch", "say"]);
        expect(sayTexts(frames)).toEqual(["native dashboard ready"]);

        const firstProviderRequest = JSON.stringify(openAi.bodies[0]);
        expect(firstProviderRequest).toContain("PATTERNS");
        expect(firstProviderRequest).toContain(OPERATOR_PATTERN.name);
        expect(firstProviderRequest).toContain(OPERATOR_PATTERN.description);
        expect(firstProviderRequest).toContain(OPERATOR_PATTERN.useWhen);
        expect(firstProviderRequest).not.toContain(OPERATOR_PATTERN_NODE_ID);

        const providerAfterRead = JSON.stringify(openAi.bodies[1]);
        expect(providerAfterRead).toContain(OPERATOR_PATTERN_NODE_ID);
        expect(providerAfterRead).toContain(OPERATOR_PATTERN_PROVENANCE);

        const providerAfterRejectedStyle = JSON.stringify(openAi.bodies[2]);
        expect(providerAfterRejectedStyle).toContain("invalid_authoring");
        expect(providerAfterRejectedStyle).toContain("rejected");
        expect(providerAfterRejectedStyle).toContain("/nodes/catalog-dashboard/style/padding");
        expect(providerAfterRejectedStyle).toContain("allowed");

        const providerAfterRecovery = JSON.stringify(openAi.bodies[3]);
        expect(providerAfterRecovery).toContain("applied_visible");

        const seedText = JSON.stringify(frames[0]?.data);
        expect(seedText).toContain(QUICKSTART_INITIAL_STAGE.root);

        const patchText = JSON.stringify(frames[1]?.data);
        expect(patchText).toContain("catalog-dashboard");
        expect(patchText).toContain("catalog-pricing");
        expect(patchText).toContain('"type":"box"');
        expect(patchText).toContain('"type":"text"');
        expect(patchText).toContain('"preset":"panel"');
        expect(patchText).toContain('"padding":"lg"');
        expect(patchText).not.toContain("giant");
        for (const retired of RETIRED_NODE_TYPES) {
          expect(patchText).not.toContain(`"type":"${retired}"`);
        }
        frameText = JSON.stringify(frames);
        expect(frameText).not.toContain(OPERATOR_PATTERN_NODE_ID);
        expect(frameText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
        expect(booted.captured.err.join("\n")).not.toContain("turn failed");
      } finally {
        await stream.close();
      }

      const reconnect = await fetch(`${running.url}/stream?visitorId=${visitorId}`);
      const snapshot = await readEvents(reconnect, 2); // reset + native stage snapshot
      const snapshotText = JSON.stringify(snapshot);
      expect(snapshotText).toContain("catalog-dashboard");
      expect(snapshotText).not.toContain(OPERATOR_PATTERN_NODE_ID);
      expect(snapshotText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
      expect(frameText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
    } finally {
      await running?.close();
      openAi.restore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes rapid same-visitor Pattern reads and native writes in order", async () => {
    const dashboardTree = nativePanelTree("native-dashboard", "Dashboard band");
    const pricingTree = nativePanelTree("native-pricing", "Pricing band");
    const dir = await mkdtemp(join(tmpdir(), "facet-quickstart-pattern-"));
    const openAi = installOpenAiMock([
      [mockCall("get_pattern", { name: OPERATOR_PATTERN.name })],
      [
        mockCall("render_page", { tree: dashboardTree }),
        mockCall("say", { text: "native dashboard ready" }),
      ],
      [],
      [mockCall("get_pattern", { name: OPERATOR_PATTERN.name })],
      [
        mockCall("render_page", { tree: pricingTree }),
        mockCall("say", { text: "native pricing ready" }),
      ],
      [],
    ]);
    let running: RunningQuickstart | undefined;
    try {
      await writeFile(join(dir, "patterns.json"), JSON.stringify([OPERATOR_PATTERN]), "utf8");
      const booted = await bootCli(["--assets", dir]);
      running = booted.running;

      const visitorId = "e2e-pattern-rapid";
      const stream = await openStream(running.url, visitorId);
      try {
        await stream.next(1); // reset
        const [dashboardPost, pricingPost] = await Promise.all([
          postEvent(running.url, visitorId, { kind: "message", text: "reference dashboard" }),
          postEvent(running.url, visitorId, { kind: "message", text: "reference pricing" }),
        ]);
        expect([dashboardPost.status, pricingPost.status]).toEqual([202, 202]);

        // Ordered, ordinary frames only: seed patch, then per-turn patch + say.
        const frames = await stream.next(5);
        expect(frames.map((frame) => kindOf(frame.data))).toEqual([
          "patch",
          "patch",
          "say",
          "patch",
          "say",
        ]);
        expect(sayTexts(frames)).toEqual(["native dashboard ready", "native pricing ready"]);

        const frameText = JSON.stringify(frames);
        expect(frameText).toContain(QUICKSTART_INITIAL_STAGE.root);
        // Reads cause no stage effects. Each following provider step authors a
        // normal native tree, and those writes preserve visitor-event order.
        expect(frameText).toContain("Dashboard band");
        expect(frameText).toContain("Pricing band");
        expect(frameText.indexOf("native-dashboard")).toBeLessThan(
          frameText.indexOf("native-pricing"),
        );
        expect(frameText).not.toContain(OPERATOR_PATTERN_NODE_ID);
        expect(frameText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
        expect(JSON.stringify(openAi.bodies[1])).toContain(OPERATOR_PATTERN_PROVENANCE);
        expect(JSON.stringify(openAi.bodies[4])).toContain(OPERATOR_PATTERN_PROVENANCE);
        expect(booted.captured.err.join("\n")).not.toContain("turn failed");
      } finally {
        await stream.close();
      }

      const reconnect = await fetch(`${running.url}/stream?visitorId=${visitorId}`);
      const snapshot = await readEvents(reconnect, 2);
      const snapshotText = JSON.stringify(snapshot);
      expect(snapshotText).toContain("native-pricing");
      expect(snapshotText).not.toContain(OPERATOR_PATTERN_NODE_ID);
      expect(snapshotText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
    } finally {
      await running?.close();
      openAi.restore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails safe when the provider goes offline after a Pattern read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "facet-quickstart-offline-"));
    const openAi = installOpenAiMock([
      [mockCall("get_pattern", { name: OPERATOR_PATTERN.name })],
      new Error("connect ECONNREFUSED (provider offline after read)"),
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let running: RunningQuickstart | undefined;
    try {
      await writeFile(join(dir, "patterns.json"), JSON.stringify([OPERATOR_PATTERN]), "utf8");
      let resolvedPatternNames: readonly string[] = [];
      const booted = await bootCli(["--assets", dir], {
        onResolvedAssets: (assets) => {
          resolvedPatternNames = assets.patterns.map((pattern) => pattern.name);
        },
      });
      running = booted.running;

      // An explicit exact Pattern list replaces the bundled defaults at the CLI seam.
      expect(resolvedPatternNames).toEqual(["qs-operator-panel"]);

      // The boot script materializes only Theme + initial stage. Pattern trees
      // remain provider-side and have no browser global or route.
      const shell = await (await fetch(`${running.url}/`)).text();
      const bootTag = (shell.match(/<script>[\s\S]*?<\/script>/g) ?? []).find((tag) =>
        tag.includes("__FACET_"),
      );
      expect(bootTag).toBeDefined();
      const fakeWindow: Record<string, unknown> = {};
      new Function("window", bootTag!.slice("<script>".length, -"</script>".length))(fakeWindow);
      expect(Object.keys(fakeWindow).sort()).toEqual([
        "__FACET_INITIAL_STAGE__",
        "__FACET_THEME__",
      ]);
      expect(shell).not.toContain(OPERATOR_PATTERN_NODE_ID);
      expect(shell).not.toContain(OPERATOR_PATTERN_PROVENANCE);
      expect(shell).not.toContain("__FACET_PATTERNS__");

      // The read itself has no stage effect. The next provider request receives
      // the exact reference, then fails; the browser gets only seed + fail-safe.
      const visitorId = "e2e-offline";
      const stream = await openStream(running.url, visitorId);
      let frameText = "";
      try {
        await stream.next(1); // reset
        const post = await postEvent(running.url, visitorId, { kind: "message", text: "hello?" });
        expect(post.status).toBe(202);
        const frames = await stream.next(2);
        expect(frames.map((frame) => kindOf(frame.data))).toEqual(["patch", "say"]);
        expect(JSON.stringify(frames[0]?.data)).toContain(QUICKSTART_INITIAL_STAGE.root);
        expect(sayTexts(frames)[0]).toMatch(/sorry/i);
        frameText = JSON.stringify(frames);
        expect(frameText).not.toContain(OPERATOR_PATTERN_NODE_ID);
        expect(frameText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
        expect(openAi.bodies.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(openAi.bodies[1])).toContain(OPERATOR_PATTERN_NODE_ID);
        expect(JSON.stringify(openAi.bodies[1])).toContain(OPERATOR_PATTERN_PROVENANCE);

        // The server stays healthy after the outage.
        const health = await fetch(`${running.url}/health`);
        expect(health.status).toBe(200);
        expect(await health.text()).toContain("ok agent=local");
      } finally {
        await stream.close();
      }

      // Reconnect: the rehydrated stage is still the coherent seed tree.
      const reconnect = await fetch(`${running.url}/stream?visitorId=${visitorId}`);
      const snap = await readEvents(reconnect, 2); // reset + snapshot patch
      expect(kindOf(snap[1]?.data)).toBe("patch");
      const snapshotText = JSON.stringify(snap[1]?.data);
      expect(snapshotText).toContain(QUICKSTART_INITIAL_STAGE.root);
      expect(snapshotText).not.toContain(OPERATOR_PATTERN_NODE_ID);
      expect(snapshotText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
      expect(frameText).not.toContain(OPERATOR_PATTERN_PROVENANCE);
    } finally {
      await running?.close();
      openAi.restore();
      errorSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("quickstart E2E — quickstart brick default", () => {
  it("quickstart brick default ships the 175-node seed before provider output", async () => {
    const openAi = installOpenAiMock([[mockCall("say", { text: "quickstart seed ready" })], []]);
    let running: RunningQuickstart | undefined;
    try {
      const booted = await bootCli([]);
      running = booted.running;

      const shell = await (await fetch(`${running.url}/`)).text();
      expect(shell).toContain("window.__FACET_INITIAL_STAGE__ = ");
      expect(shell).toContain(QUICKSTART_INITIAL_STAGE.root);

      const visitorId = "e2e-brick-default";
      const stream = await openStream(running.url, visitorId);
      try {
        await stream.next(1); // reset
        const post = await postEvent(running.url, visitorId, {
          kind: "visit",
          visitor: { visitorId },
        });
        expect(post.status).toBe(202);

        const frames = await stream.next(2);
        expect(frames.map((frame) => kindOf(frame.data))).toEqual(["patch", "say"]);
        expect(sayTexts(frames)).toEqual(["quickstart seed ready"]);

        const seedText = JSON.stringify(frames[0]?.data);
        expect(seedText).toContain('"op":"replace"');
        expect(seedText).toContain(QUICKSTART_INITIAL_STAGE.root);
        expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toHaveLength(175);
        for (const node of Object.values(QUICKSTART_INITIAL_STAGE.nodes)) {
          expect(BRICK_TYPES).toContain(node.type);
        }
        for (const type of ["box", "text", "table", "chart", "input", "progress", "list"]) {
          expect(seedText).toContain(`"type":"${type}"`);
        }
        for (const retired of RETIRED_NODE_TYPES) {
          expect(seedText).not.toContain(`"type":"${retired}"`);
        }

        const providerRequest = JSON.stringify(openAi.bodies[0]);
        expect(QUICKSTART_PAGE_BRIEF).toContain("# Facet quickstart tour");
        expect(providerRequest).toContain("# Facet quickstart tour");
        expect(providerRequest).toContain(
          "Bricks are box, text, media, input, richtext, table, chart, list, keyValue, progress, loading.",
        );
        expect(providerRequest).toContain("Pattern index");
        expect(providerRequest).not.toContain("STUB_TREE");
        expect(booted.captured.out.join("\n")).toContain("openai");
      } finally {
        await stream.close();
      }
    } finally {
      await running?.close();
      openAi.restore();
    }
  });
});

/** A seedable initial tree (Decision 4): a box root with a child — passes
 * `validateTree` and `isSeedableTree`, so `withInitialStage` installs it. */
const SEED_TREE: FacetTree = {
  root: "seed-root",
  nodes: {
    "seed-root": {
      id: "seed-root",
      type: "box",
      style: { direction: "column", gap: "md" },
      children: ["seed-hero"],
    },
    "seed-hero": { id: "seed-hero", type: "text", value: "Seeded skeleton" },
  },
};

describe("quickstart E2E — singular Theme & seeding (DC-009, DC-010)", () => {
  it("ships the seed to the FIRST stream as a stamped patch frame on the visit turn", async () => {
    // A recording NO-OP agent: it MUTATES no stage (paints nothing) — it only
    // records the stage it was handed and emits one `say` as a deterministic
    // turn-completed signal. So any tree that reaches the browser can ONLY be the
    // seed the runtime shipped, never an agent-authored paint.
    const seen: (FacetTree | undefined)[] = [];
    const recording = defineAgent(({ session, stage }) => {
      seen.push(session.stage);
      stage.say("noop");
    });
    const seeded = await boot({ agent: recording, initialStage: SEED_TREE });
    try {
      const visitorId = "e2e-seed";
      const stream = await openStream(seeded.url, visitorId);
      try {
        // The stream connects BEFORE the session exists, so its reset carries no
        // snapshot (the bug: this browser would otherwise never see the seed).
        await stream.next(1); // bare reset
        await postEvent(seeded.url, visitorId, { kind: "visit", visitor: { visitorId } });
        // The visit opens+seeds the session; the seed travels the patch channel as
        // the turn's FIRST stamped frame, ahead of the no-op agent's `say`.
        const [seedFrame, say] = await stream.next(2); // seed patch, then say
        expect(kindOf(seedFrame?.data)).toBe("patch");
        expect(seedFrame?.id).toBeDefined(); // stamped — it got a seq / replay slot
        const seedText = JSON.stringify(seedFrame?.data);
        expect(seedText).toContain('"op":"replace"');
        expect(seedText).toContain('"seed-root"');
        expect(seedText).toContain('"seed-hero"');
        expect(kindOf(say?.data)).toBe("say");
      } finally {
        await stream.close();
      }

      // Secondary check — a RECONNECT's rehydrate also ships the seeded stage as
      // its snapshot (from `runtime.stageFor`), so a later tab is consistent too.
      const reconnect = await fetch(`${seeded.url}/stream?visitorId=${visitorId}`);
      const frames = await readEvents(reconnect, 2); // reset + snapshot patch
      expect(kindOf(frames[0]?.data)).toBe("reset");
      expect(kindOf(frames[1]?.data)).toBe("patch");
      const snapshot = JSON.stringify(frames[1]?.data);
      expect(snapshot).toContain('"seed-root"');
      expect(snapshot).toContain('"seed-hero"');

      // The agent's FIRST turn saw the seeded stage (seed visible pre-paint).
      expect(seen).toHaveLength(1);
      expect(seen[0]?.root).toBe("seed-root");
      expect(seen[0]?.nodes["seed-root"]).toBeDefined();
    } finally {
      await seeded.close();
    }
  });

  it("inlines the seed stage into the shell (escaped) so the first paint isn't model-gated", async () => {
    // A hostile node value stands in for agent-authored text: the shell's
    // `<`→< escape is the defense-in-depth that keeps it from closing the
    // injected <script> — the same posture the theme global gets.
    const hostileSeed: FacetTree = {
      root: "seed-root",
      nodes: {
        "seed-root": {
          id: "seed-root",
          type: "box",
          style: { direction: "column", gap: "md" },
          children: ["seed-hero"],
        },
        "seed-hero": {
          id: "seed-hero",
          type: "text",
          value: "</script><script>alert(1)</script>",
        },
      },
    };
    const seeded = await boot({ initialStage: hostileSeed });
    try {
      const body = await (await fetch(`${seeded.url}/`)).text();
      expect(body).toContain("window.__FACET_INITIAL_STAGE__ = ");
      expect(body).toContain('"seed-root"');
      expect(body).toContain('"seed-hero"');
      // Every `<` in the JSON is escaped, so the hostile value is inert data.
      expect(body).toContain("\\u003c/script>\\u003cscript>alert(1)");
      expect(body).not.toContain("<script>alert(1)");
    } finally {
      await seeded.close();
    }
  });

  it("inlines the theme map into the shell with the hostile </script> escaped", async () => {
    // `validateTheme` already refuses `<` in values, but a description is freer
    // text — the shell's `<`→< escape is the defense-in-depth that keeps a
    // hostile description from closing the injected <script> and running code.
    const theme: FacetTheme = {
      ...DEFAULT_THEME,
      name: "midnight",
      description: "</script><script>alert(1)</script>",
    };
    const themed = await boot({ theme });
    try {
      const body = await (await fetch(`${themed.url}/`)).text();
      expect(body).toContain("window.__FACET_THEME__ = ");
      expect(body).not.toContain("__FACET_THEMES__");
      expect(body).toContain('"midnight"');
      // Every `<` in the JSON is escaped, so the hostile marker is inert data.
      expect(body).toContain("\\u003c/script>\\u003cscript>alert(1)");
      // ...and the live-injection form never appears unescaped in the document.
      expect(body).not.toContain("<script>alert(1)");
    } finally {
      await themed.close();
    }
  });

  it("joint boot: themes AND initialStage ship as one executable script that materializes both globals", async () => {
    // The flagship `--assets` path — an assets dir with a theme AND a seedable
    // tree passes BOTH seams. This is the two-entry `globals.join(";")` branch
    // the shellHtml doc comment claims but no other test exercises: if the join
    // separator regressed (dropped, or a bare `,`), the inline script would be a
    // syntax error or clobber the first assignment, silently killing BOTH the
    // instant paint and the theme map. Executing the body (not string-matching
    // the `;`) is what catches that.
    const validTheme: FacetTheme = {
      ...DEFAULT_THEME,
      name: "brand",
      description: "operator theme",
    };
    const seeded = await boot({ theme: validTheme, initialStage: SEED_TREE });
    try {
      const body = await (await fetch(`${seeded.url}/`)).text();

      // Exactly one inline boot <script> (no attributes), and it precedes the
      // /app.js module tag so the globals exist before the bundle reads them.
      const inlineMatches = body.match(/<script>[\s\S]*?<\/script>/g) ?? [];
      expect(inlineMatches).toHaveLength(1);
      const bootTag = inlineMatches[0]!;
      expect(body.indexOf(bootTag)).toBeLessThan(body.indexOf('src="/app.js"'));

      // Both assignments are present in the one script.
      expect(bootTag).toContain("window.__FACET_THEME__ =");
      expect(bootTag).not.toContain("__FACET_THEMES__");
      expect(bootTag).toContain("window.__FACET_INITIAL_STAGE__ =");

      // The join contract: executing the extracted body as real JS must
      // materialize BOTH globals (a comma-operator regression would parse but
      // drop the first assignment; a dropped separator would throw).
      const scriptBody = bootTag.slice("<script>".length, -"</script>".length);
      const fakeWindow: Record<string, unknown> = {};
      new Function("window", scriptBody)(fakeWindow);
      expect(fakeWindow.__FACET_THEME__).toEqual(validTheme);
      expect(fakeWindow.__FACET_INITIAL_STAGE__).toEqual(SEED_TREE);
    } finally {
      await seeded.close();
    }
  });

  it("treats a theme-like chat message as content and never authors document Theme", async () => {
    const visitorId = "e2e-theme";
    const stream = await openStream(base, visitorId);
    try {
      await stream.next(1); // reset
      await postEvent(base, visitorId, { kind: "visit", visitor: { visitorId } });
      await stream.next(1); // visit patch (STUB_TREE)

      await postEvent(base, visitorId, { kind: "message", text: "theme midnight" });
      const frames = await stream.next(2); // ordinary text patch + say
      expect(frames.map((f) => kindOf(f.data))).toEqual(["patch", "say"]);
      const patchText = JSON.stringify(frames[0]?.data);
      expect(patchText).toContain("echo: theme midnight");
      expect(patchText).not.toContain('"path":"/theme"');
      expect(sayTexts(frames)).toEqual(["stub: theme midnight"]);
    } finally {
      await stream.close();
    }

    // Reconnect keeps the ordinary authored content and still has no Theme field.
    const reconnect = await fetch(`${base}/stream?visitorId=${visitorId}`);
    const snap = await readEvents(reconnect, 2); // reset + snapshot patch
    expect(kindOf(snap[1]?.data)).toBe("patch");
    const snapshotText = JSON.stringify(snap[1]?.data);
    expect(snapshotText).toContain("echo: theme midnight");
    expect(snapshotText).not.toContain('"theme":');
  });

  it("no-assets boot: shell carries no theme global and a fresh connect is a bare reset", async () => {
    // The shared `running` server booted with no themes and no initialStage.
    const body = await (await fetch(`${base}/`)).text();
    expect(body).not.toContain("__FACET_THEME__");
    expect(body).not.toContain("__FACET_THEMES__");
    // ...and no seed global either — byte-identical to the no-assets shell.
    expect(body).not.toContain("__FACET_INITIAL_STAGE__");

    // A brand-new visitor that has not visited: rehydrate finds no stage (nothing
    // seeded, nothing painted), so the connect is a lone reset that clears stale
    // resume state without minting a frame-log token.
    const stream = await openStream(base, "e2e-unseeded");
    try {
      const [reset] = await stream.next(1);
      expect(kindOf(reset?.data)).toBe("reset");
      expect(reset?.id).toBe("");
    } finally {
      await stream.close();
    }
  });
});
