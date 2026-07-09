/**
 * DC-005 CLI contract tests (spec Decision 9), driven in-process — `runCli` is
 * called directly (no child spawn) so exit codes and messages are deterministic.
 * Output is captured through the injectable hooks (`log`/`error`, defaulting to
 * console in production); boot tests receive the running server via `onStarted`
 * and close it immediately.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FacetCatalog } from "@facet/core";
import * as referenceAgent from "@facet/reference-agent";
import * as quickstartBarrel from "./index.js";
import { runCli, type RunCliHooks } from "./cli.js";
import { QUICKSTART_INITIAL_STAGE } from "./guide.js";
import { startQuickstart, type RunningQuickstart } from "./server.js";
import { createStubAgent } from "./stub.js";

const NO_KEY_MESSAGE = "No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.";

const TEST_PROVIDER_ENV = { OPENAI_API_KEY: "sk-test" } as const;

const CATALOG_FIXTURE: FacetCatalog = {
  name: "quickstart-catalog",
  description: "Quickstart catalog policy",
  theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
  bricks: [
    { type: "section", variants: ["surface"] },
    { type: "button", variants: ["primary"] },
  ],
  stamps: { mode: "allow", names: ["pricing"] },
  primitiveFallback: "allowed",
  policy: {
    order: ["stamp", "brick", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
    maxScreenSections: 3,
  },
};

describe("@facet/quickstart barrel", () => {
  it("quickstart barrel exposes reference-agent aliases", () => {
    expect(quickstartBarrel.startQuickstart).toBe(startQuickstart);
    expect(quickstartBarrel.createQuickstartAgent).toBe(referenceAgent.createQuickstartAgent);
    expect(quickstartBarrel.createReferenceAgent).toBe(referenceAgent.createReferenceAgent);
    expect(quickstartBarrel.resolveProvider).toBe(referenceAgent.resolveProvider);
    expect(quickstartBarrel.createStubAgent).toBe(referenceAgent.createStubAgent);
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
  __FACET_THEMES__?: unknown;
  __FACET_INITIAL_STAGE__?: unknown;
}

function readShellGlobals(body: string): ShellGlobals {
  const bootTag =
    (body.match(/<script>[\s\S]*?<\/script>/g) ?? []).find((tag) =>
      tag.includes("__FACET_INITIAL_STAGE__"),
    ) ?? "";
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

describe("runCli — --assets (DC-009)", () => {
  it("exits 1 when an explicit assets path does not exist", async () => {
    const missing = join(
      tmpdir(),
      `facet-assets-missing-${String(Date.now())}-${String(Math.random())}`,
    );
    const captured = capture();
    const code = await runCli(["--assets", missing], TEST_PROVIDER_ENV, {
      log: captured.log,
      error: captured.error,
    });
    expect(code).toBe(1);
    expect([...captured.err, ...captured.out].join("\n")).toContain(missing);
  });

  it("exits 1 when an explicit --assets path is a regular file, not a directory", async () => {
    // existsSync passes for a regular file; without a directory probe the server
    // would boot with zero assets and exit 0 — an explicit config silently doing
    // nothing. An explicit --assets that isn't a readable directory must hard-fail.
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    let running: RunningQuickstart | undefined;
    try {
      const file = join(dir, "not-a-dir.txt");
      writeFileSync(file, "hello");
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      const captured = capture();
      const code = await runCli(["--port", String(port), "--assets", file], TEST_PROVIDER_ENV, {
        log: captured.log,
        error: captured.error,
        // Defensive: if the guard failed to fire and the server booted, close it
        // so the listening handle can't leak past this test.
        onStarted: (handle) => {
          running = handle;
        },
      });
      expect(code).toBe(1);
      expect([...captured.err, ...captured.out].join("\n")).toContain(file);
    } finally {
      await running?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("boots on a valid dir, logs issues, wires only the valid theme and no seed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    try {
      // One valid theme, one invalid theme (non-string name ⇒ skipped), and an
      // initial tree that validateTree reduces to EMPTY_TREE (empty root box ⇒
      // not seedable ⇒ DC-009 model-first fallback, no seed wired).
      writeFileSync(
        join(dir, "midnight.theme.json"),
        JSON.stringify({ name: "midnight", color: { bg: "#000000", fg: "#ffffff" } }),
      );
      writeFileSync(join(dir, "broken.theme.json"), JSON.stringify({ name: 7 }));
      writeFileSync(join(dir, "initial.tree.json"), JSON.stringify({ root: "root", nodes: {} }));

      const { captured, running } = await bootCli(["--assets", dir]);
      try {
        // Issues surfaced, one concise line each, prefixed and never a value.
        const issues = captured.err.join("\n");
        expect(issues).toContain("[facet-quickstart]");
        expect(issues).toContain("theme document skipped");
        expect(issues).toContain("not seedable");

        // The valid theme is injected into the shell; the skipped one is absent.
        const shell = await (await fetch(`${running.url}/`)).text();
        expect(shell).toContain("window.__FACET_THEMES__");
        expect(shell).toContain("midnight");
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("default asset library reaches the agent with no --assets", async () => {
    // WU-7: with no --assets the CLI still resolves through `loadAssets` (an
    // empty `MemoryAssets`), so the `@facet/assets` default theme + stamp
    // library seeds and reaches BOTH the agent and the shell on every boot.
    // `onResolvedAssets` is the observable seam for what was handed downstream.
    let resolvedThemes = 0;
    let resolvedStamps = 0;
    let resolvedCatalog: FacetCatalog | undefined;
    const { running } = await bootCli([], {
      onResolvedAssets: ({ themes, stamps, catalog }) => {
        resolvedThemes = themes.length;
        resolvedStamps = stamps.length;
        resolvedCatalog = catalog;
      },
    });
    try {
      expect(resolvedThemes).toBeGreaterThan(0);
      expect(resolvedStamps).toBeGreaterThan(0);
      expect(resolvedCatalog?.name).toBe("default");
      expect(resolvedCatalog?.theme.switchPolicy).toBe("locked");
    } finally {
      await running.close();
    }
  });

  it("catalog.json reaches the resolved assets hook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    try {
      writeFileSync(join(dir, "catalog.json"), JSON.stringify(CATALOG_FIXTURE));
      let resolvedCatalog: FacetCatalog | undefined;
      const { running } = await bootCli(["--assets", dir], {
        onResolvedAssets: ({ catalog }) => {
          resolvedCatalog = catalog;
        },
      });
      try {
        expect(resolvedCatalog).toMatchObject({
          name: "quickstart-catalog",
          description: "Quickstart catalog policy",
          theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
          stamps: { mode: "allow", names: ["pricing"] },
          primitiveFallback: "allowed",
        });
        expect(resolvedCatalog?.bricks.map((brick) => brick.type)).toEqual(["section", "button"]);
        expect(resolvedCatalog?.policy.maxScreenSections).toBe(3);
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("malformed catalog.json falls back to the default catalog with a concise issue", async () => {
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    try {
      writeFileSync(
        join(dir, "catalog.json"),
        JSON.stringify({
          name: 7,
          theme: { switchPolicy: "sometimes" },
          bricks: [{ type: "unknown-brick" }],
        }),
      );
      let resolvedCatalog: FacetCatalog | undefined;
      const { captured, running } = await bootCli(["--assets", dir], {
        onResolvedAssets: ({ catalog }) => {
          resolvedCatalog = catalog;
        },
      });
      try {
        expect(resolvedCatalog?.name).toBe("default");
        expect(resolvedCatalog?.theme.switchPolicy).toBe("locked");
        expect(resolvedCatalog?.bricks.length).toBeGreaterThan(2);
        const issues = captured.err.join("\n");
        expect(issues).toContain("[facet-quickstart]");
        expect(issues).toContain("catalog:");
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects the default theme library and logs nothing when --assets is absent", async () => {
    // WU-7: the default library now seeds on every boot, so the shell carries
    // the default theme global even with no --assets; the defaults are valid, so
    // nothing is logged.
    const { captured, running } = await bootCli();
    try {
      expect(captured.err).toEqual([]);
      const shell = await (await fetch(`${running.url}/`)).text();
      expect(shell).toContain("window.__FACET_THEMES__");
    } finally {
      await running.close();
    }
  });
});

describe("runCli — quickstart polished default", () => {
  it("quickstart polished default CLI inlines the seeded first paint on the built-in guide path", async () => {
    const { captured, running } = await bootCli();
    try {
      expect(captured.err).toEqual([]);
      const shell = await (await fetch(`${running.url}/`)).text();
      const globals = readShellGlobals(shell);
      const seedText = JSON.stringify(globals.__FACET_INITIAL_STAGE__);

      expect(globals.__FACET_INITIAL_STAGE__).toEqual(QUICKSTART_INITIAL_STAGE);
      expect(seedText).toContain("Facet Live Lab");
      for (const type of [
        "section",
        "card",
        "tabs",
        "table",
        "chart",
        "field",
        "button",
        "stat",
        "badge",
        "progress",
        "alert",
        "list",
        "divider",
      ]) {
        expect(seedText).toContain(`"type":"${type}"`);
      }
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
