import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientEvent, FacetSession, FacetTree, ServerMessage } from "@facet/core";

/**
 * These tests exercise `createPersistentDriver` against a FAKE Agent SDK. The
 * real `query`/`tool`/`createSdkMcpServer` are replaced by a controllable stub:
 * - `tool(...)` just captures each handler by name so tests can invoke the
 *   in-process `facet_*` handlers directly (they write to the current turn's Stage);
 * - `createSdkMcpServer(...)` collects those handlers;
 * - `query(...)` hands control to a per-test `Controller` that lets the test pull
 *   the driver's streaming prompt one turn at a time, emit SDK output messages
 *   (notably `result`), and end/error the stream on demand — all deterministically,
 *   with no timers or real subprocess.
 */

const h = vi.hoisted(() => {
  type ToolHandler = (
    args: Record<string, unknown>,
  ) => Promise<{ content: { type: string; text: string }[] }>;

  interface Controller {
    /** Called by the mocked `query`; wires up the driver's streaming prompt. */
    run(args: { prompt: AsyncIterable<unknown>; options: unknown }): AsyncGenerator<unknown>;
    /** Await the next user message the driver yields for a serial turn. */
    pull(): Promise<unknown>;
    /** Emit one SDK output message into the driver's `run` loop. */
    emit(message: unknown): void;
    /** End the SDK stream (the driver's finally-block runs). */
    end(): void;
    /** The options object the driver passed to `query`. */
    options: unknown;
  }

  const toolHandlers = new Map<string, ToolHandler>();

  const makeController = (): Controller => {
    let promptIter: AsyncIterator<unknown> | undefined;
    const out: unknown[] = [];
    let outWake: (() => void) | undefined;
    let ended = false;
    // Yielded prompts the driver has produced, buffered for the test to `pull`.
    const prompts: unknown[] = [];
    let promptWake: (() => void) | undefined;

    const controller: Controller = {
      options: undefined,
      run(args) {
        promptIter = args.prompt[Symbol.asyncIterator]();
        controller.options = args.options;
        // Mirror the real SDK: keep pulling the streaming prompt one-ahead so the
        // driver's `input()` generator reaches its `await turnDone` and can be
        // released by a `result` message. Buffer each yielded prompt for tests.
        void (async () => {
          for (;;) {
            const next = await promptIter!.next();
            if (next.done === true) return;
            prompts.push(next.value);
            promptWake?.();
            promptWake = undefined;
          }
        })().catch(() => undefined);
        return (async function* (): AsyncGenerator<unknown> {
          for (;;) {
            while (out.length === 0 && !ended) {
              await new Promise<void>((resolve) => (outWake = resolve));
            }
            if (out.length > 0) {
              yield out.shift();
              continue;
            }
            return;
          }
        })();
      },
      async pull() {
        while (prompts.length === 0) {
          await new Promise<void>((resolve) => (promptWake = resolve));
        }
        return prompts.shift();
      },
      emit(message) {
        out.push(message);
        outWake?.();
        outWake = undefined;
      },
      end() {
        ended = true;
        outWake?.();
        outWake = undefined;
        // Unstick the prompt pump so the background `input()` generator can finish.
        void promptIter?.return?.(undefined);
      },
    };
    return controller;
  };

  return {
    toolHandlers,
    makeController,
    active: undefined as Controller | undefined,
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (
    name: string,
    _description: string,
    _schema: Record<string, unknown>,
    handler: (
      args: Record<string, unknown>,
    ) => Promise<{ content: { type: string; text: string }[] }>,
  ) => ({ name, handler }),
  createSdkMcpServer: (config: {
    name: string;
    version: string;
    tools: {
      name: string;
      handler: (
        args: Record<string, unknown>,
      ) => Promise<{ content: { type: string; text: string }[] }>;
    }[];
  }) => {
    h.toolHandlers.clear();
    for (const t of config.tools) h.toolHandlers.set(t.name, t.handler);
    return { name: config.name };
  },
  query: (args: { prompt: AsyncIterable<unknown>; options: unknown }) => h.active!.run(args),
}));

// Import AFTER vi.mock so the driver binds to the fake SDK.
const { createPersistentDriver } = await import("./persistent.js");

const SESSION: FacetSession = {
  agentId: "live",
  visitor: { visitorId: "v1" },
  stage: { root: "root", nodes: { root: { id: "root", type: "box", children: [] } } },
};

const visit: ClientEvent = { kind: "visit", visitor: { visitorId: "v1" } };
const message = (text: string): ClientEvent => ({ kind: "message", text });

/** Drive one `result`-completed turn, invoking a tool to leave Stage output. */
async function say(text: string): Promise<void> {
  await h.toolHandlers.get("say")!({ text });
}

async function theme(name: string): Promise<{ content: { type: string; text: string }[] }> {
  return h.toolHandlers.get("theme")!({ name });
}

afterEach(() => {
  // Release any background `run()` loop still awaiting SDK output.
  h.active?.end();
  h.active = undefined;
  vi.restoreAllMocks();
});

describe("createPersistentDriver", () => {
  it("processes two concurrent events as two serial turns, in order", async () => {
    const ctrl = h.makeController();
    h.active = ctrl;
    const driver = createPersistentDriver();

    // Two events arrive back-to-back; both are queued.
    const first = driver.agent(message("one"), SESSION);
    const second = driver.agent(message("two"), SESSION);

    const resolved: string[] = [];
    // `agent` is typed as sync-or-Promise; the live path returns a Promise.
    void Promise.resolve(first).then(() => resolved.push("first"));
    void Promise.resolve(second).then(() => resolved.push("second"));

    // Turn 1: the driver yields the FIRST event's prompt.
    const prompt1 = (await ctrl.pull()) as { message: { content: string } };
    expect(prompt1.message.content).toContain("one");
    expect(prompt1.message.content).not.toContain("two");
    await say("reply-one");
    ctrl.emit({ type: "result" });
    await expect(first).resolves.toEqual([{ kind: "say", text: "reply-one" }]);

    // Turn 2 only begins after turn 1 completed.
    const prompt2 = (await ctrl.pull()) as { message: { content: string } };
    expect(prompt2.message.content).toContain("two");
    await say("reply-two");
    ctrl.emit({ type: "result" });
    await expect(second).resolves.toEqual([{ kind: "say", text: "reply-two" }]);

    expect(resolved).toEqual(["first", "second"]);
    driver.close();
  });

  it("resolves the current turn with the Stage flush when a result arrives", async () => {
    const ctrl = h.makeController();
    h.active = ctrl;
    const driver = createPersistentDriver();

    const handle = driver.agent(visit, SESSION);
    await ctrl.pull();

    // The brain drives the page: render a tree, then say a reply.
    const tree: FacetTree = {
      root: "root",
      nodes: { root: { id: "root", type: "box", style: { direction: "col" }, children: [] } },
    };
    await h.toolHandlers.get("render")!({ tree });
    await say("welcome");

    ctrl.emit({ type: "result" });

    const messages = (await handle) as ServerMessage[];
    // Stage.flush orders coalesced patch edits before the say.
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ kind: "patch" });
    const patch = messages[0] as { kind: "patch"; patches: { op: string; path: string }[] };
    expect(patch.patches[0]).toMatchObject({ op: "replace", path: "" });
    expect(messages[1]).toEqual({ kind: "say", text: "welcome" });

    driver.close();
  });

  it("theme tool records a /theme patch for valid names and rejects invalid names", async () => {
    const ctrl = h.makeController();
    h.active = ctrl;
    const driver = createPersistentDriver();

    const handle = driver.agent(message("go dark"), SESSION);
    await ctrl.pull();

    const bad = await theme("Dark Mode!");
    expect(bad.content[0]?.text).toMatch(/invalid theme name/);

    const good = await theme("midnight");
    expect(good.content[0]?.text).toContain("midnight");

    ctrl.emit({ type: "result" });

    const messages = (await handle) as ServerMessage[];
    expect(messages).toEqual([
      { kind: "patch", patches: [{ op: "add", path: "/theme", value: "midnight" }] },
    ]);
    driver.close();
  });

  it("settles waiting and current events when the stream ends, then dead-guards later calls", async () => {
    const ctrl = h.makeController();
    h.active = ctrl;
    const driver = createPersistentDriver();

    const current = driver.agent(message("live"), SESSION);
    const waiting = driver.agent(message("queued"), SESSION);
    await ctrl.pull(); // promote the first turn to `current`; the second stays pending

    ctrl.end(); // stream ends -> finally -> settleAll

    const offline = [{ kind: "say", text: "(this page's agent went offline — check back soon)" }];
    await expect(current).resolves.toEqual(offline);
    await expect(waiting).resolves.toEqual(offline);

    // Later calls short-circuit through the dead-guard (no queueing).
    await expect(driver.agent(message("after"), SESSION)).resolves.toEqual([
      { kind: "say", text: "(this page's agent is offline)" },
    ]);
  });

  it("settles a malformed action event alone without killing the session", async () => {
    const ctrl = h.makeController();
    h.active = ctrl;
    const driver = createPersistentDriver();

    // An `action` event whose `action` accessor throws when read.
    const malformed = { kind: "tap" } as ClientEvent;
    Object.defineProperty(malformed, "action", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });

    // The pump drives input(); the malformed turn is caught and settled alone.
    const bad = driver.agent(malformed, SESSION);
    await expect(bad).resolves.toEqual([
      { kind: "say", text: "(could not process that interaction)" },
    ]);

    // The session survived: a subsequent normal event is processed as a turn.
    const good = driver.agent(message("still alive"), SESSION);
    const prompt = (await ctrl.pull()) as { message: { content: string } };
    expect(prompt.message.content).toContain("still alive");
    await say("ok");
    ctrl.emit({ type: "result" });
    await expect(good).resolves.toEqual([{ kind: "say", text: "ok" }]);

    driver.close();
  });

  it("settles all pending events when close() is called", async () => {
    const ctrl = h.makeController();
    h.active = ctrl;
    const driver = createPersistentDriver();

    const a = driver.agent(message("a"), SESSION);
    const b = driver.agent(message("b"), SESSION);

    driver.close();

    const offline = [{ kind: "say", text: "(this page's agent is offline)" }];
    await expect(a).resolves.toEqual(offline);
    await expect(b).resolves.toEqual(offline);

    // Post-close calls also short-circuit.
    await expect(driver.agent(message("c"), SESSION)).resolves.toEqual(offline);
  });

  it("passes an empty built-in tool set and the facet allowlist to query", async () => {
    const ctrl = h.makeController();
    h.active = ctrl;
    const driver = createPersistentDriver({ model: "claude-test" });

    const handle = driver.agent(visit, SESSION);
    await ctrl.pull();

    const options = ctrl.options as {
      tools: unknown[];
      allowedTools: string[];
      permissionMode: string;
      model?: string;
    };
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toContain("mcp__facet__render");
    expect(options.allowedTools).toContain("mcp__facet__say");
    expect(options.allowedTools).toContain("mcp__facet__theme");
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.model).toBe("claude-test");

    ctrl.emit({ type: "result" });
    await handle;
    driver.close();
  });
});
