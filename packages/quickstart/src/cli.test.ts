/**
 * DC-005 CLI contract tests (spec Decision 9), driven in-process — `runCli` is
 * called directly (no child spawn) so exit codes and messages are deterministic.
 * Output is captured through the injectable hooks (`log`/`error`, defaulting to
 * console in production); boot tests receive the running server via `onStarted`
 * and close it immediately.
 */
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli.js";
import { startQuickstart, type RunningQuickstart } from "./server.js";
import { createStubAgent } from "./stub.js";

const NO_KEY_MESSAGE =
  "No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or run with --stub for a keyless look around.";

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

/** Drive `runCli` onto a random free port, retrying on collisions (the
 * server.test.ts bind-retry pattern, one level up). */
async function bootCli(
  extraArgs: readonly string[] = [],
): Promise<{ captured: Captured; running: RunningQuickstart }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const captured = capture();
    let running: RunningQuickstart | undefined;
    const code = await runCli(
      ["--stub", "--port", String(port), ...extraArgs],
      {},
      {
        log: captured.log,
        error: captured.error,
        onStarted: (handle) => {
          running = handle;
        },
      },
    );
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
  it("exits non-zero naming both env vars and --stub when no key is set", async () => {
    const captured = capture();
    const code = await runCli([], {}, { log: captured.log, error: captured.error });
    expect(code).toBe(1);
    const text = [...captured.err, ...captured.out].join("\n");
    expect(text).toContain("OPENAI_API_KEY");
    expect(text).toContain("ANTHROPIC_API_KEY");
    expect(text).toContain("--stub");
    expect(text).toContain(NO_KEY_MESSAGE);
  });
});

describe("runCli — guide resolution (DC-005)", () => {
  it("exits non-zero naming the path when an explicit --guide file is missing", async () => {
    const captured = capture();
    const code = await runCli(
      ["--guide", "./nope.md", "--stub"],
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

describe("runCli — --stub boot (DC-004)", () => {
  it("boots keyless with --stub, prints the link and the stub brain line", async () => {
    const { captured, running } = await bootCli();
    try {
      const text = captured.out.join("\n");
      expect(text).toContain(running.url);
      expect(text).toContain("stub");
    } finally {
      await running.close();
    }
  });

  it("rejects a busy public port naming the port and --port", async () => {
    const { running } = await bootCli();
    try {
      const port = new URL(running.url).port;
      const captured = capture();
      const code = await runCli(
        ["--stub", "--port", port],
        {},
        {
          log: captured.log,
          error: captured.error,
        },
      );
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
      expect(shellBody).toContain("/app.js");

      const bundle = await fetch(`${running.url}/app.js`);
      expect(bundle.status).toBe(200);
      expect(await bundle.text()).toContain("pnpm --filter @facet/quickstart build");

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
