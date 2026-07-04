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
import { connect } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FacetTheme, FacetTree } from "@facet/core";
import { defineAgent } from "@facet/agent";
import { startQuickstart, type QuickstartServerOptions, type RunningQuickstart } from "./server.js";
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

/** A seedable initial tree (Decision 4): a box root with a child — passes
 * `validateTree` and `isSeedableTree`, so `withInitialStage` installs it. */
const SEED_TREE: FacetTree = {
  root: "seed-root",
  nodes: {
    "seed-root": {
      id: "seed-root",
      type: "box",
      style: { direction: "col", gap: "md" },
      children: ["seed-hero"],
    },
    "seed-hero": { id: "seed-hero", type: "text", value: "Seeded skeleton" },
  },
};

describe("quickstart E2E — themes & seeding (DC-009, DC-010)", () => {
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
          style: { direction: "col", gap: "md" },
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
    const themes: readonly FacetTheme[] = [
      { name: "midnight", description: "</script><script>alert(1)</script>" },
    ];
    const themed = await boot({ themes });
    try {
      const body = await (await fetch(`${themed.url}/`)).text();
      expect(body).toContain("window.__FACET_THEMES__ = ");
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
    const validTheme: FacetTheme = { name: "brand", description: "operator theme" };
    const themes: readonly FacetTheme[] = [validTheme];
    const seeded = await boot({ themes, initialStage: SEED_TREE });
    try {
      const body = await (await fetch(`${seeded.url}/`)).text();

      // Exactly one inline boot <script> (no attributes), and it precedes the
      // /app.js module tag so the globals exist before the bundle reads them.
      const inlineMatches = body.match(/<script>[\s\S]*?<\/script>/g) ?? [];
      expect(inlineMatches).toHaveLength(1);
      const bootTag = inlineMatches[0]!;
      expect(body.indexOf(bootTag)).toBeLessThan(body.indexOf('src="/app.js"'));

      // Both assignments are present in the one script.
      expect(bootTag).toContain("window.__FACET_THEMES__ =");
      expect(bootTag).toContain("window.__FACET_INITIAL_STAGE__ =");

      // The join contract: executing the extracted body as real JS must
      // materialize BOTH globals (a comma-operator regression would parse but
      // drop the first assignment; a dropped separator would throw).
      const scriptBody = bootTag.slice("<script>".length, -"</script>".length);
      const fakeWindow: Record<string, unknown> = {};
      new Function("window", scriptBody)(fakeWindow);
      expect(fakeWindow.__FACET_THEMES__).toEqual(themes);
      expect(fakeWindow.__FACET_INITIAL_STAGE__).toEqual(SEED_TREE);
    } finally {
      await seeded.close();
    }
  });

  it("stub theme switch: emits the /theme add-op and persists theme on reconnect", async () => {
    const visitorId = "e2e-theme";
    const stream = await openStream(base, visitorId);
    try {
      await stream.next(1); // reset
      await postEvent(base, visitorId, { kind: "visit", visitor: { visitorId } });
      await stream.next(1); // visit patch (STUB_TREE)

      // "theme <name>" ⇒ the stub runs `stage.theme(name)` + a say (DC-010).
      await postEvent(base, visitorId, { kind: "message", text: "theme midnight" });
      const frames = await stream.next(2); // theme patch + say
      expect(frames.map((f) => kindOf(f.data))).toEqual(["patch", "say"]);
      const patchText = JSON.stringify(frames[0]?.data);
      expect(patchText).toContain('"op":"add"');
      expect(patchText).toContain('"path":"/theme"');
      expect(patchText).toContain('"value":"midnight"');
      expect(sayTexts(frames)).toEqual(["stub: theme midnight"]);
    } finally {
      await stream.close();
    }

    // Reconnect: the rehydrate snapshot carries the persisted `theme`, proving a
    // string `theme` survived the runtime's save-time `validateTree` (WU-2's
    // keep-if-string — else `runtime.ts` would strip the name on first save).
    const reconnect = await fetch(`${base}/stream?visitorId=${visitorId}`);
    const snap = await readEvents(reconnect, 2); // reset + snapshot patch
    expect(kindOf(snap[1]?.data)).toBe("patch");
    expect(JSON.stringify(snap[1]?.data)).toContain('"theme":"midnight"');
  });

  it("no-assets boot: shell carries no theme global and a fresh connect is a bare reset", async () => {
    // The shared `running` server booted with no themes and no initialStage.
    const body = await (await fetch(`${base}/`)).text();
    expect(body).not.toContain("__FACET_THEMES__");
    // ...and no seed global either — byte-identical to the no-assets shell.
    expect(body).not.toContain("__FACET_INITIAL_STAGE__");

    // A brand-new visitor that has not visited: rehydrate finds no stage (nothing
    // seeded, nothing painted), so the connect is a lone unstamped reset —
    // today's EMPTY_TREE / model-first posture, unchanged.
    const stream = await openStream(base, "e2e-unseeded");
    try {
      const [reset] = await stream.next(1);
      expect(kindOf(reset?.data)).toBe("reset");
      expect(reset?.id).toBeUndefined();
    } finally {
      await stream.close();
    }
  });
});
