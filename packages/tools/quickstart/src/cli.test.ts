/**
 * DC-005 CLI contract tests (spec Decision 9), driven in-process — `runCli` is
 * called directly (no child spawn) so exit codes and messages are deterministic.
 * Output is captured through the injectable hooks (`log`/`error`, defaulting to
 * console in production); boot tests receive the running server via `onStarted`
 * and close it immediately.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Spy on the compaction-enabled wiring so a regression back to the bare
// createReferenceAgent (compaction OFF) fails a test instead of shipping.
const { quickstartSpy } = vi.hoisted(() => ({ quickstartSpy: vi.fn() }));
vi.mock("./agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent.js")>();
  quickstartSpy.mockImplementation(actual.createQuickstartAgent as (...args: unknown[]) => unknown);
  return { ...actual, createQuickstartAgent: quickstartSpy };
});
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_THEME } from "@facet/assets";
import * as referenceAgent from "@facet/reference-agent";
import * as quickstartBarrel from "./index.js";
import { runCli, type RunCliHooks } from "./cli.js";
import { QUICKSTART_INITIAL_STAGE, QUICKSTART_PAGE_BRIEF } from "./guide.js";
import { startQuickstart, type RunningQuickstart } from "./server.js";
import { createStubAgent } from "@facet/reference-agent";

const NO_KEY_MESSAGE = "No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.";

const TEST_PROVIDER_ENV = { OPENAI_API_KEY: "sk-test" } as const;

describe("@facet/quickstart barrel", () => {
  it("owns its Quickstart factory without forwarding runtime reference exports", () => {
    expect(quickstartBarrel.startQuickstart).toBe(startQuickstart);
    expect(quickstartBarrel.createQuickstartAgent).toBe(quickstartSpy);
    expect(referenceAgent).not.toHaveProperty("createQuickstartAgent");
    expect(quickstartBarrel).not.toHaveProperty("createReferenceAgent");
    expect(quickstartBarrel).not.toHaveProperty("resolveProvider");
    expect(quickstartBarrel).not.toHaveProperty("createStubAgent");
  });
});

describe("quickstart guide brief", () => {
  it("does not advertise retired container node types", () => {
    const retiredContainerTerms = /\b(?:bricks?|patterns?|presets?|emptyStates?)\b/i; // component-hard-cut: allowed-negative

    expect(QUICKSTART_PAGE_BRIEF).not.toMatch(retiredContainerTerms);
    expect(QUICKSTART_PAGE_BRIEF).toMatch(/safe declarative\s+component markup/);
    expect(QUICKSTART_PAGE_BRIEF).toContain("Screen, AppShell, Stack, Row, Split, Grid, Modal");
    expect(QUICKSTART_PAGE_BRIEF).toContain("ProfileHeader");
    expect(QUICKSTART_PAGE_BRIEF).toContain("ProductShowcase");
    expect(QUICKSTART_PAGE_BRIEF).toContain("StatStrip, Gallery");
    expect(QUICKSTART_PAGE_BRIEF).toContain("Testimonial, Timeline");
    expect(QUICKSTART_PAGE_BRIEF).toContain("Table, Button, and Field");
  });
});

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

interface ShellGlobals {
  __FACET_THEME__?: unknown;
  __FACET_INITIAL_STAGE__?: unknown;
  __FACET_POST_TIMEOUT_MS__?: unknown;
}

function readShellGlobals(body: string): ShellGlobals {
  const bootTag =
    (body.match(/<script>[\s\S]*?<\/script>/g) ?? []).find((tag) => tag.includes("__FACET_")) ?? "";
  expect(bootTag).not.toBe("");
  const scriptBody = bootTag.slice("<script>".length, -"</script>".length);
  const fakeWindow: ShellGlobals = {};
  new Function("window", scriptBody)(fakeWindow);
  return fakeWindow;
}

/** Drive `runCli` onto a random free port, retrying on collisions (the
 * server.test.ts bind-retry pattern, one level up). */
async function bootCli(
  extraArgs: readonly string[] = [],
  extraHooks: Partial<RunCliHooks> = {},
): Promise<{ captured: Captured; running: RunningQuickstart }> {
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
      },
    });
    if (code === 0 && running !== undefined) return { captured, running };
  }
  throw new Error("could not boot the quickstart CLI on a free port");
}

/** Boot `startQuickstart` directly on a random free port. */
async function bootServer(pageBundlePath?: string): Promise<RunningQuickstart> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    try {
      return await startQuickstart({
        port,
        agentId: "quickstart",
        agent: createStubAgent(),
        ...(pageBundlePath !== undefined ? { pageBundlePath } : {}),
      });
    } catch {
      // EADDRINUSE — try another port
    }
  }
  throw new Error("could not boot startQuickstart on a free port");
}

describe("runCli — key resolution (DC-005)", () => {
  it("exits non-zero naming both env vars when no key is set", async () => {
    const captured = capture();
    const code = await runCli([], {}, { log: captured.log, error: captured.error });
    expect(code).toBe(1);
    const text = [...captured.err, ...captured.out].join("\n");
    expect(text).toContain("OPENAI_API_KEY");
    expect(text).toContain("ANTHROPIC_API_KEY");
    expect(text).toContain(NO_KEY_MESSAGE);
  });

  it("does not echo present provider key values on key-resolution errors", async () => {
    const secret = "sk-cli-secret";
    const captured = capture();
    const code = await runCli(
      ["--provider", "anthropic"],
      { OPENAI_API_KEY: secret },
      { log: captured.log, error: captured.error },
    );

    expect(code).toBe(1);
    const text = [...captured.err, ...captured.out].join("\n");
    expect(text).toContain("ANTHROPIC_API_KEY");
    expect(text).not.toContain(secret);
  });
});

describe("runCli — flag parsing", () => {
  async function expectExit1(argv: readonly string[]): Promise<string> {
    const captured = capture();
    const code = await runCli(argv, TEST_PROVIDER_ENV, {
      log: captured.log,
      error: captured.error,
    });
    expect(code).toBe(1);
    return [...captured.err, ...captured.out].join("\n");
  }

  it("exits 1 on an unknown flag", async () => {
    expect(await expectExit1(["--bogus"])).toContain('Unknown flag "--bogus"');
  });

  it("rejects the retired --stub flag", async () => {
    expect(await expectExit1(["--stub"])).toContain('Unknown flag "--stub"');
  });

  it("rejects the retired --assets flag and omits it from usage", async () => {
    const text = await expectExit1(["--assets", "./custom"]);
    expect(text).toContain('Unknown flag "--assets"');
    expect(text).not.toContain("--assets <dir>");
  });

  it("exits 1 when a value-taking flag has no value", async () => {
    expect(await expectExit1(["--port"])).toContain("--port requires a value");
  });

  it("exits 1 on invalid --port values (range, non-numeric, port 0, leading zero)", async () => {
    for (const bad of ["70000", "8080abc", "0x10", "0", "080", "-1"]) {
      expect(await expectExit1(["--port", bad])).toMatch(/--port expects a port number/);
    }
  });
});

describe("runCli — guide resolution (DC-005)", () => {
  it("exits non-zero naming the path when an explicit --guide file is missing", async () => {
    const captured = capture();
    const code = await runCli(
      ["--guide", "./nope.md"],
      {},
      {
        log: captured.log,
        error: captured.error,
      },
    );
    expect(code).toBe(1);
    expect([...captured.err, ...captured.out].join("\n")).toContain("./nope.md");
  });

  it("falls back to DEFAULT_GUIDE silently when the DEFAULT guide path is absent", async () => {
    // The repo root (vitest cwd) has no ./facet.md — the default path is absent,
    // so the CLI must boot on the built-in guide instead of exiting 1.
    const { captured, running } = await bootCli();
    await running.close();
    expect(captured.err).toEqual([]);
  });
});

describe("runCli — default bootstrap (DC-009)", () => {
  it("injects the framework default Theme and no retired asset seams", async () => {
    const { captured, running } = await bootCli();
    try {
      expect(captured.err).toEqual([]);
      const shell = await (await fetch(`${running.url}/`)).text();
      expect(shell).toContain("window.__FACET_THEME__");
      expect(shell).not.toContain("__FACET_THEMES__");
      expect(shell).not.toContain("__FACET_PATTERNS__");
      const globals = readShellGlobals(shell);
      expect(globals.__FACET_THEME__).toEqual(DEFAULT_THEME);
      expect(globals.__FACET_POST_TIMEOUT_MS__).toBe(130_250);
      expect(await fetch(`${running.url}/patterns`)).toMatchObject({ status: 404 });
      expect(await fetch(`${running.url}/assets`)).toMatchObject({ status: 404 });
    } finally {
      await running.close();
    }
  });
});

describe("runCli — quickstart built-in default", () => {
  it("inlines the exact post-migration seeded first paint on the built-in guide path", async () => {
    const { captured, running } = await bootCli();
    try {
      expect(captured.err).toEqual([]);
      const shell = await (await fetch(`${running.url}/`)).text();
      const globals = readShellGlobals(shell);
      const seedText = JSON.stringify(globals.__FACET_INITIAL_STAGE__);

      expect(globals.__FACET_INITIAL_STAGE__).toEqual(QUICKSTART_INITIAL_STAGE);
      expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toHaveLength(121);
      expect(seedText).toHaveLength(24_685);
      expect(createHash("sha256").update(seedText).digest("hex")).toBe(
        "418a30dcbd952311f962ff717f64949bfea1ef5d01c261a1e6d11f4b789aa7de",
      );
    } finally {
      await running.close();
    }
  });
});

describe("runCli — provider-backed boot (DC-004)", () => {
  it("boots with a provider key, prints the link and the provider brain line", async () => {
    const { captured, running } = await bootCli();
    try {
      const text = captured.out.join("\n");
      expect(text).toContain(running.url);
      expect(text).toContain("openai");
      expect(text).not.toContain(TEST_PROVIDER_ENV.OPENAI_API_KEY);
      expect(captured.err.join("\n")).not.toContain(TEST_PROVIDER_ENV.OPENAI_API_KEY);
    } finally {
      await running.close();
    }
  });

  it("keeps the compaction-enabled provider boot on the resolved static snapshot", async () => {
    quickstartSpy.mockClear();
    const { running } = await bootCli();
    try {
      // The CLI must compose via createQuickstartAgent (default MemorySummaryStore),
      // not the bare createReferenceAgent whose default is compaction OFF.
      expect(quickstartSpy).toHaveBeenCalledTimes(1);
      const options = quickstartSpy.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      // No explicit opt-out slipped in: the default (undefined) wires the store.
      expect(options?.summaryStore).not.toBeNull();
      expect(options).not.toHaveProperty("theme");
      expect(options).not.toHaveProperty("patterns");
    } finally {
      await running.close();
    }
  });

  it("rejects a busy public port naming the port and --port", async () => {
    const { running } = await bootCli();
    try {
      const port = new URL(running.url).port;
      const captured = capture();
      const code = await runCli(["--port", port], TEST_PROVIDER_ENV, {
        log: captured.log,
        error: captured.error,
      });
      expect(code).toBe(1);
      const text = [...captured.err, ...captured.out].join("\n");
      expect(text).toContain(port);
      expect(text).toContain("--port");
    } finally {
      await running.close();
    }
  });
});

describe("startQuickstart — page serving + agent blocking", () => {
  it("serves the shell, the missing-bundle fallback, a proxied /health, and 404s /agent/*", async () => {
    // A deliberately nonexistent bundle path pins the fallback branch
    // deterministically (the default dist/page/app.js resolution flips once a
    // build has run, which would make this test order-dependent).
    const missing = join(tmpdir(), `facet-quickstart-missing-${String(Date.now())}.js`);
    const running = await bootServer(missing);
    try {
      const shell = await fetch(`${running.url}/`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-type")).toContain("text/html");
      const shellBody = await shell.text();
      expect(shellBody).toContain('<div id="root">');
      expect(shellBody).toContain("https://fonts.googleapis.com/css2?family=Nunito");
      expect(shellBody).toContain("/app.js");

      const bundle = await fetch(`${running.url}/app.js`);
      expect(bundle.status).toBe(200);
      expect(await bundle.text()).toContain("pnpm --filter @facet/quickstart build");

      const bundleHead = await fetch(`${running.url}/app.js`, { method: "HEAD" });
      expect(bundleHead.status).toBe(200);
      expect(bundleHead.headers.get("content-type")).toContain("text/javascript");
      expect(await bundleHead.text()).toBe("");

      const favicon = await fetch(`${running.url}/favicon.ico`);
      expect(favicon.status).toBe(204);
      expect(await favicon.text()).toBe("");

      const health = await fetch(`${running.url}/health`);
      expect(health.status).toBe(200);
      expect(await health.text()).toContain("ok agent=local");

      const agentStream = await fetch(`${running.url}/agent/stream`);
      expect(agentStream.status).toBe(404);
      await agentStream.text();
    } finally {
      await running.close();
    }
  });
});
