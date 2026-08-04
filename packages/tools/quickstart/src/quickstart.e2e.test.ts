/**
 * /live-test Tier 1b (spec Decision 7, DC-001 + DC-008) — deterministic
 * quickstart E2E over the real wrapper + internal Facet server path.
 *
 * This test intentionally speaks the post-cut protocol: sessionKey, stage-rooted
 * PatchFrame, ConversationMessage, initialMarkup, and no retired reset/say,
 * visitorId, FacetTree, Pattern, or --assets surfaces. // component-hard-cut: allowed-negative
 */
import { createHash } from "node:crypto";
import { connect } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineAgent } from "@facet/agent";
import { DEFAULT_THEME } from "@facet/assets";
import type {
  VisitorEvent,
  ComponentDocument,
  ComponentNode,
  ConversationMessage,
  FacetStage,
  FacetTheme,
  ServerFrame,
} from "@facet/core";
import { MemorySink } from "@facet/runtime";
import { createStubAgent } from "@facet/reference-agent";
import { runCli, type RunCliHooks } from "./cli.js";
import { QUICKSTART_INITIAL_STAGE } from "./guide.js";
import { startQuickstart, type QuickstartServerOptions, type RunningQuickstart } from "./server.js";

const FIXTURE_BUNDLE = `console.log("facet quickstart fixture bundle");\n`;
const TEST_PROVIDER_ENV = { OPENAI_API_KEY: "sk-test" } as const;

const SEED_MARKUP = `<Facet entry="home">
  <Screen name="home" title="Seeded">
    <Stack gap="md">
      <Text value="Seeded skeleton" />
    </Stack>
  </Screen>
</Facet>`;

const HOSTILE_SEED_MARKUP = `<Facet entry="home">
  <Screen name="home" title="Seeded">
    <Text value="</script><script>alert(1)</script>" />
  </Screen>
</Facet>`;

const EXPECTED_QUICKSTART_BARREL_TYPE_EXPORTS = [
  "ConversationSummary",
  "QuickstartAgentOptions",
  "QuickstartServerOptions",
  "ReferenceAgentBudget",
  "ReferenceAgentBudgetOptions",
  "ReferenceAgentBudgetOverrides",
  "ReferenceAgentBudgetPreset",
  "ReferenceAgentDiagnosticEvent",
  "ReferenceAgentDiagnosticObserver",
  "ReferenceAgentOptions",
  "ReferenceAgentTrace",
  "ReferenceAgentTraceEvent",
  "ReferenceProvider",
  "RunningQuickstart",
  "Summarizer",
  "SummarizerRequest",
] as const;

interface SseFrame {
  readonly id?: string;
  readonly data: ServerFrame;
}

interface Captured {
  readonly out: string[];
  readonly err: string[];
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (line) => out.push(line), error: (line) => err.push(line) };
}

function parseBlock(block: string): SseFrame | undefined {
  let id: string | undefined;
  let dataLine: string | undefined;
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) id = line.slice(4);
    else if (line.startsWith("data: ")) dataLine = line.slice(6);
  }
  if (dataLine === undefined) return undefined;
  return id === undefined
    ? { data: JSON.parse(dataLine) as ServerFrame }
    : { id, data: JSON.parse(dataLine) as ServerFrame };
}

function drainFrames(buffer: string): {
  readonly blocks: readonly string[];
  readonly rest: string;
} {
  const blocks: string[] = [];
  let rest = buffer;
  let index = rest.indexOf("\n\n");
  while (index !== -1) {
    blocks.push(rest.slice(0, index));
    rest = rest.slice(index + 2);
    index = rest.indexOf("\n\n");
  }
  return { blocks, rest };
}

async function readEvents(response: Response, count: number): Promise<readonly SseFrame[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  try {
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
    return frames;
  } finally {
    await reader.cancel();
  }
}

interface StreamReader {
  next(count: number): Promise<readonly SseFrame[]>;
  close(): Promise<void>;
}

async function openStream(base: string, sessionKey: string): Promise<StreamReader> {
  const response = await fetch(`${base}/stream?sessionKey=${encodeURIComponent(sessionKey)}`);
  if (response.status !== 200) throw new Error(`stream connect failed: ${response.status}`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const pending: SseFrame[] = [];
  let buffer = "";
  return {
    next: async (count: number): Promise<readonly SseFrame[]> => {
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

const kindOf = (frame: SseFrame | undefined): ServerFrame["kind"] | undefined => frame?.data.kind;

function conversationTexts(frames: readonly SseFrame[]): readonly string[] {
  return frames
    .map((frame) => frame.data)
    .filter((frame): frame is ConversationMessage => frame.kind === "conversation")
    .map((frame) => frame.text);
}

function rootStage(frame: SseFrame | undefined): FacetStage {
  if (frame?.data.kind !== "patch") throw new Error("expected patch frame");
  const op = frame.data.ops[0];
  if (op?.op !== "replace" || op.path !== "") throw new Error("expected root replace");
  return op.value as FacetStage;
}

function documentFromPatch(frame: SseFrame | undefined): ComponentDocument {
  if (frame?.data.kind !== "patch") throw new Error("expected patch frame");
  const op = frame.data.ops.find((candidate) => candidate.op === "replace");
  if (op?.op !== "replace") throw new Error("expected replace op");
  const value = op.path === "/document" ? op.value : (op.value as FacetStage).document;
  if (value === null || typeof value !== "object") throw new Error("expected document");
  return value as ComponentDocument;
}

function scalarProp(node: ComponentNode | undefined, name: string): string | undefined {
  const prop = node?.props[name];
  return prop?.kind === "scalar" ? prop.value : undefined;
}

function textValues(document: ComponentDocument): readonly string[] {
  return Object.values(document.nodes)
    .filter((node) => node.tag === "Text")
    .map((node) => scalarProp(node, "value") ?? "");
}

function visitorEvent(
  eventId: string,
  eventName = "visit",
  collect: VisitorEvent["collect"] = {},
  arg?: string,
): VisitorEvent {
  return {
    eventId,
    eventName,
    sourceNodeId: "quickstart-test",
    screen: "home",
    stageRevision: 0,
    ...(arg === undefined ? {} : { arg }),
    collect,
  };
}

function postEvent(base: string, sessionKey: string, event: VisitorEvent): Promise<Response> {
  return fetch(`${base}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, event }),
  });
}

function postMessage(
  base: string,
  sessionKey: string,
  messageId: string,
  text: string,
): Promise<Response> {
  return fetch(`${base}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, messageId, text, screen: "home", stageRevision: 0 }),
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

function bootGlobals(shell: string): Record<string, unknown> {
  const scripts = shell.match(/<script>[\s\S]*?<\/script>/g) ?? [];
  const bootScript = scripts.find((script) => script.includes("__FACET_"));
  if (bootScript === undefined) return {};
  const fakeWindow: Record<string, unknown> = {};
  new Function("window", bootScript.slice("<script>".length, -"</script>".length))(fakeWindow);
  return fakeWindow;
}

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
      // EADDRINUSE or invalid override for that attempt.
    }
  }
  throw new Error("could not boot startQuickstart on a free port");
}

async function bootCli(
  extraArgs: readonly string[],
  extraHooks: Partial<RunCliHooks> = {},
): Promise<{ readonly captured: Captured; readonly running: RunningQuickstart }> {
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
  it("GET / returns the HTML shell and default theme boot seam", async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain('<div id="root">');
    expect(body).toContain("https://fonts.googleapis.com/css2?family=Nunito");
    expect(body).toContain('src="/app.js"');
    expect(bootGlobals(body).__FACET_THEME__).toEqual(DEFAULT_THEME);
    expect(bootGlobals(body).__FACET_INITIAL_STAGE__).toBeUndefined();
  });

  it("GET /app.js serves the injected fixture bundle", async () => {
    const response = await fetch(`${base}/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toBe(FIXTURE_BUNDLE);
  });

  it("proxies health but refuses the external agent channel", async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toContain("ok agent=local");

    const agentStream = await fetch(`${base}/agent/stream`);
    expect(agentStream.status).toBe(404);
    await agentStream.text();
  });

  it("refuses a cross-origin POST /event but allows same-origin sessionKey events", async () => {
    const body = JSON.stringify({ sessionKey: "csrf", event: visitorEvent("csrf-event") });
    const cross = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body,
    });
    expect(cross.status).toBe(403);
    await cross.text();

    const sameOrigin = new URL(base).host;
    const same = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `http://${sameOrigin}` },
      body,
    });
    expect(same.status).toBe(202);
    await same.text();
  });

  it("refuses a non-loopback Host on GET / and leaks no boot data", async () => {
    const seeded = await boot({ initialMarkup: SEED_MARKUP });
    try {
      const port = Number(new URL(seeded.url).port);
      const raw = await new Promise<string>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1", () => {
          socket.write(`GET / HTTP/1.1\r\nHost: attacker.example:${String(port)}\r\n\r\n`);
        });
        let buf = "";
        socket.on("data", (chunk) => {
          buf += chunk.toString();
        });
        socket.on("end", () => resolve(buf));
        socket.on("error", reject);
        setTimeout(() => socket.end(), 300);
      });
      expect(raw.split("\r\n")[0]).toContain("403");
      expect(raw).not.toContain("__FACET_INITIAL_STAGE__");
      expect(raw).not.toContain("Seeded skeleton");
    } finally {
      await seeded.close();
    }
  });
});

describe("quickstart E2E — stub flow through the proxy", () => {
  it("stub run sends a document patch and one ConversationMessage", async () => {
    const sessionKey = "e2e-flow";
    const stream = await openStream(base, sessionKey);
    try {
      const [rehydrate] = await stream.next(1);
      expect(kindOf(rehydrate)).toBe("patch");
      expect(rootStage(rehydrate).document).toBeNull();

      const post = await postEvent(
        base,
        sessionKey,
        visitorEvent("submit-turn", "submit", {
          name: { kind: "value", value: "Ada" },
          email: { kind: "value", value: "a@b.c" },
        }),
      );
      expect(post.status).toBe(202);

      const frames = await stream.next(2);
      expect(frames.map(kindOf)).toEqual(["patch", "conversation"]);
      const document = documentFromPatch(frames[0]);
      expect(textValues(document)).toContain("Facet quickstart — stub stage");
      expect(textValues(document)).toContain("Tell us who should receive the launch plan.");
      expect(conversationTexts(frames)).toEqual(["submit: email=a@b.c name=Ada"]);
    } finally {
      await stream.close();
    }
  });

  it("records visitor messages into the sink and returns runtime-owned conversation frames", async () => {
    const sink = new MemorySink();
    const logged = await boot({ sink });
    try {
      const sessionKey = "e2e-message";
      const stream = await openStream(logged.url, sessionKey);
      try {
        await stream.next(1); // initial resync
        const post = await postMessage(logged.url, sessionKey, "msg-1", "hello");
        expect(post.status).toBe(202);
        const frames = await stream.next(2);
        expect(frames.map(kindOf)).toEqual(["patch", "conversation"]);
        expect(conversationTexts(frames)).toEqual(["stub: message"]);
      } finally {
        await stream.close();
      }

      await waitFor(async () => (await sink.history(sessionKey, 10)).length >= 2);
      const history = await sink.history(sessionKey, 10);
      expect(history.map((message) => message.role)).toEqual(["visitor", "assistant"]);
      expect(history.map((message) => message.text)).toEqual(["hello", "stub: message"]);
      expect(JSON.stringify(history)).not.toContain('"patch"');
    } finally {
      await logged.close();
    }
  });

  it("resumes through Last-Event-ID without a reset frame or full replay", async () => {
    const sessionKey = "e2e-resume";
    const stream1 = await openStream(base, sessionKey);
    let lastId: string;
    let lastSeq: number;
    let era: string;
    try {
      await stream1.next(1); // initial rehydrate
      await postEvent(base, sessionKey, visitorEvent("resume-one", "refresh"));
      const firstTurn = await stream1.next(2); // first event seeds the document, then replies
      const stamped = firstTurn.filter((frame) => frame.id !== undefined);
      lastId = stamped[stamped.length - 1]?.id ?? "";
      expect(lastId).not.toBe("");
      era = lastId.slice(0, lastId.indexOf(":"));
      lastSeq = Number(lastId.slice(lastId.indexOf(":") + 1));
    } finally {
      await stream1.close();
    }

    await postEvent(base, sessionKey, {
      ...visitorEvent("resume-two", "refresh"),
      stageRevision: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const resumed = await readEvents(
      await fetch(`${base}/stream?sessionKey=${sessionKey}`, {
        headers: { "Last-Event-ID": `${era}:${String(lastSeq)}` },
      }),
      1,
    );
    expect(resumed.map(kindOf)).toEqual(["conversation"]);
    expect(conversationTexts(resumed)).toEqual(["stub: refresh"]);
    expect(Number(resumed[0]!.id!.slice(resumed[0]!.id!.indexOf(":") + 1))).toBe(lastSeq + 1);
  });

  it("isolates two sessionKey stage snapshots and replies through the proxy", async () => {
    const alpha = await openStream(base, "e2e-alpha");
    const beta = await openStream(base, "e2e-beta");
    try {
      await alpha.next(1);
      await beta.next(1);
      await postEvent(base, "e2e-alpha", visitorEvent("alpha-turn", "refresh", {}, "north"));
      await postEvent(base, "e2e-beta", visitorEvent("beta-turn", "refresh", {}, "south"));
      expect(conversationTexts(await alpha.next(2))).toEqual(["stub: refresh north"]);
      expect(conversationTexts(await beta.next(2))).toEqual(["stub: refresh south"]);
    } finally {
      await alpha.close();
      await beta.close();
    }

    const alphaSnapshot = await readEvents(await fetch(`${base}/stream?sessionKey=e2e-alpha`), 2);
    const betaSnapshot = await readEvents(await fetch(`${base}/stream?sessionKey=e2e-beta`), 2);
    expect(JSON.stringify(alphaSnapshot)).toContain("stub: refresh north");
    expect(JSON.stringify(alphaSnapshot)).not.toContain("stub: refresh south");
    expect(JSON.stringify(betaSnapshot)).toContain("stub: refresh south");
    expect(JSON.stringify(betaSnapshot)).not.toContain("stub: refresh north");
  });

  it("keeps the retired local /record route deleted", async () => {
    const response = await fetch(`${base}/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: "record-retired", event: visitorEvent("record") }),
    });
    expect(response.status).toBe(404);
    await response.text();
  });
});

describe("quickstart E2E — initialMarkup seeding", () => {
  it("inlines valid initialMarkup and rehydrates the same ComponentDocument", async () => {
    const seeded = await boot({ initialMarkup: SEED_MARKUP });
    try {
      const shell = await (await fetch(`${seeded.url}/`)).text();
      const inline = bootGlobals(shell).__FACET_INITIAL_STAGE__ as ComponentDocument | undefined;
      expect(inline).toBeDefined();
      expect(textValues(inline!)).toContain("Seeded skeleton");

      const [rehydrate] = await readEvents(await fetch(`${seeded.url}/stream?sessionKey=seed`), 1);
      expect(rootStage(rehydrate).document).toEqual(inline);
    } finally {
      await seeded.close();
    }
  });

  it("escapes hostile seed markup in the inline first-paint script", async () => {
    const seeded = await boot({ initialMarkup: HOSTILE_SEED_MARKUP });
    try {
      const body = await (await fetch(`${seeded.url}/`)).text();
      expect(body).toContain("window.__FACET_INITIAL_STAGE__ = ");
      expect(body).toContain("\\u003c/script>\\u003cscript>alert(1)");
      expect(body).not.toContain("<script>alert(1)");
    } finally {
      await seeded.close();
    }
  });

  it("inlines theme and initialMarkup in one executable script", async () => {
    const theme: FacetTheme = {
      ...DEFAULT_THEME,
      semantic: {
        ...DEFAULT_THEME.semantic,
        action: { ...DEFAULT_THEME.semantic.action, primaryBg: "#123456" },
      },
    };
    const seeded = await boot({ theme, initialMarkup: SEED_MARKUP });
    try {
      const body = await (await fetch(`${seeded.url}/`)).text();
      const inlineMatches = body.match(/<script>[\s\S]*?<\/script>/g) ?? [];
      const bootTags = inlineMatches.filter((tag) => tag.includes("__FACET_"));
      expect(bootTags).toHaveLength(1);
      expect(body.indexOf(bootTags[0]!)).toBeLessThan(body.indexOf('src="/app.js"'));
      const globals = bootGlobals(body);
      expect(globals.__FACET_THEME__).toEqual(theme);
      expect(textValues(globals.__FACET_INITIAL_STAGE__ as ComponentDocument)).toContain(
        "Seeded skeleton",
      );
    } finally {
      await seeded.close();
    }
  });

  it("passes the bootstrapped initial document to the first agent turn", async () => {
    const seen: (ComponentDocument | null)[] = [];
    const recording = defineAgent(({ session, stage }) => {
      seen.push(session.document);
      stage.message("noop");
    });
    const seeded = await boot({ agent: recording, initialMarkup: SEED_MARKUP });
    try {
      const stream = await openStream(seeded.url, "seed-visible");
      try {
        await stream.next(1);
        const post = await postEvent(seeded.url, "seed-visible", visitorEvent("seed-turn"));
        expect(post.status).toBe(202);
        expect(conversationTexts(await stream.next(1))).toEqual(["noop"]);
      } finally {
        await stream.close();
      }
      expect(seen).toHaveLength(1);
      expect(textValues(seen[0]!)).toContain("Seeded skeleton");
    } finally {
      await seeded.close();
    }
  });
});

describe("quickstart E2E — CLI default seed and barrel surface", () => {
  it("quickstart CLI ships the exact 84-node component seed before provider output", async () => {
    const booted = await bootCli([]);
    try {
      const shell = await (await fetch(`${booted.running.url}/`)).text();
      const inline = bootGlobals(shell).__FACET_INITIAL_STAGE__;
      expect(inline).toEqual(QUICKSTART_INITIAL_STAGE);
      expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toHaveLength(84);

      const seedText = JSON.stringify(inline);
      expect(seedText).toHaveLength(12_495);
      expect(createHash("sha256").update(seedText).digest("hex")).toBe(
        "fb8786b4bc321b6c0e40b5e0e9493913cd9c890134a96860a64e70672c5f9bd2",
      );
      for (const tag of [
        "Screen",
        "Stack",
        "Row",
        "Grid",
        "Card",
        "Text",
        "Badge",
        "Field",
        "Button",
        "Modal",
        "Empty",
      ]) {
        expect(seedText).toContain(`"tag":"${tag}"`);
      }
      expect(booted.captured.out.join("\n")).toContain("openai");
    } finally {
      await booted.running.close();
    }
  });

  it("exposes only the explicit quickstart barrel contract", async () => {
    const quickstart = await import("./index.js");
    expect(Object.keys(quickstart).sort()).toEqual([
      "QUICKSTART_INITIAL_STAGE",
      "createQuickstartAgent",
      "startQuickstart",
    ]);

    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toContain("export *");
    expect(source).toContain("export { QUICKSTART_INITIAL_STAGE }");
    expect(source).toContain("export { createQuickstartAgent }");
    expect(source).toContain("export { startQuickstart }");
    for (const name of EXPECTED_QUICKSTART_BARREL_TYPE_EXPORTS) {
      expect(source).toContain(name);
    }
    expect(source).not.toContain("QUICKSTART_PAGE_BRIEF");
    expect(source).not.toContain("QUICKSTART_INITIAL_MARKUP");
    expect(source).not.toContain("MemorySummaryStore");
    expect(source).not.toContain("SummaryStore");
  });
});
