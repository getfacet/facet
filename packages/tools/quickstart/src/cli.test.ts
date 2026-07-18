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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRICK_TYPES, type FacetPattern, type FacetTheme } from "@facet/core";
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
  it("owns its Quickstart factory while forwarding canonical reference exports", () => {
    expect(quickstartBarrel.startQuickstart).toBe(startQuickstart);
    expect(quickstartBarrel.createQuickstartAgent).toBe(quickstartSpy);
    expect(referenceAgent).not.toHaveProperty("createQuickstartAgent");
    expect(quickstartBarrel.createReferenceAgent).toBe(referenceAgent.createReferenceAgent);
    expect(quickstartBarrel.resolveProvider).toBe(referenceAgent.resolveProvider);
    expect(quickstartBarrel.createStubAgent).toBe(referenceAgent.createStubAgent);
  });
});

describe("quickstart guide brief", () => {
  it("does not advertise retired container node types", () => {
    const retiredContainerTerms = /\b(?:sections?|cards?|emptyStates?)\b/i; // style-hard-cut: allowed-negative

    expect(QUICKSTART_PAGE_BRIEF).not.toMatch(retiredContainerTerms);
    expect(QUICKSTART_PAGE_BRIEF).toContain(
      "optional named Patterns as concrete read-only references",
    );
    expect(QUICKSTART_PAGE_BRIEF).toContain("ordinary native Bricks");
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
  it("wires one Theme and exact Patterns", async () => {
    quickstartSpy.mockClear();
    let resolved: { readonly theme: FacetTheme; readonly patterns: readonly FacetPattern[] };
    const { running } = await bootCli([], {
      onResolvedAssets: (assets) => {
        resolved = assets;
      },
    });
    try {
      expect(resolved!.theme.name).toBe("default");
      expect(resolved!.patterns.map((pattern) => pattern.name)).toEqual(
        expect.arrayContaining(["hero", "card", "pricing-section"]),
      );
      const options = quickstartSpy.mock.calls[0]?.[0] as
        { readonly theme?: FacetTheme; readonly patterns?: readonly FacetPattern[] } | undefined;
      expect(options?.theme).toBe(resolved!.theme);
      expect(options?.patterns).toBe(resolved!.patterns);

      const shell = await (await fetch(`${running.url}/`)).text();
      expect(shell).toContain("window.__FACET_THEME__");
      expect(shell).not.toContain("__FACET_THEMES__");
      expect(shell).not.toContain("__FACET_PATTERNS__");
      expect(readShellGlobals(shell).__FACET_THEME__).toEqual(resolved!.theme);
      expect(await fetch(`${running.url}/patterns`)).toMatchObject({ status: 404 });
      expect(await fetch(`${running.url}/assets`)).toMatchObject({ status: 404 });
    } finally {
      await running.close();
    }
  });

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

  it("loads exact current asset files and keeps Patterns out of the browser", async () => {
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    try {
      const theme: FacetTheme = { ...DEFAULT_THEME, name: "midnight" };
      const patterns: readonly FacetPattern[] = [
        {
          name: "operator-panel",
          description: "An operator-owned panel Pattern.",
          useWhen: "A concise operator panel is needed.",
          root: "operator-panel.root",
          nodes: {
            "operator-panel.root": {
              id: "operator-panel.root",
              type: "box",
              style: { preset: "panel" },
              children: ["operator-panel.copy"],
            },
            "operator-panel.copy": {
              id: "operator-panel.copy",
              type: "text",
              value: "private-pattern-marker",
              style: { preset: "body" },
            },
          },
        },
      ];
      writeFileSync(join(dir, "theme.json"), JSON.stringify(theme));
      writeFileSync(join(dir, "patterns.json"), JSON.stringify(patterns));
      writeFileSync(join(dir, "initial.tree.json"), JSON.stringify({ root: "root", nodes: {} }));

      let resolved: { readonly theme: FacetTheme; readonly patterns: readonly FacetPattern[] };
      const { captured, running } = await bootCli(["--assets", dir], {
        onResolvedAssets: (assets) => {
          resolved = assets;
        },
      });
      try {
        const issues = captured.err.join("\n");
        expect(issues).toContain("[facet-quickstart]");
        expect(issues).toContain("initial tree: no valid root node");
        expect(resolved!.theme.name).toBe("midnight");
        expect(resolved!.patterns.map((pattern) => pattern.name)).toEqual(["operator-panel"]);

        const shell = await (await fetch(`${running.url}/`)).text();
        expect(shell).toContain("window.__FACET_THEME__");
        expect(shell).toContain("midnight");
        expect(shell).not.toContain("private-pattern-marker");
        expect(shell).not.toContain("__FACET_PATTERNS__");
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports retired asset files without interpreting their contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    try {
      writeFileSync(join(dir, "legacy.theme.json"), '"private-retired-theme"');
      writeFileSync(join(dir, "legacy.composition.json"), '"private-retired-pattern"');
      writeFileSync(join(dir, "catalog.json"), '"private-retired-catalog"');
      const { captured, running } = await bootCli(["--assets", dir]);
      try {
        const issues = captured.err.join("\n");
        expect(issues).toContain("legacy.theme.json");
        expect(issues).toContain("legacy.composition.json");
        expect(issues).toContain("catalog.json");
        expect(issues).not.toContain("private-retired");
        const shell = await (await fetch(`${running.url}/`)).text();
        expect(shell).not.toContain("private-retired");
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back as a whole from an incomplete Theme and exposes no invalid Patterns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "facet-assets-"));
    try {
      writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "incomplete-secret" }));
      writeFileSync(join(dir, "patterns.json"), JSON.stringify([{ name: "invalid-secret" }]));
      let resolved: { readonly theme: FacetTheme; readonly patterns: readonly FacetPattern[] };
      const { captured, running } = await bootCli(["--assets", dir], {
        onResolvedAssets: (assets) => {
          resolved = assets;
        },
      });
      try {
        expect(resolved!.theme.name).toBe("default");
        expect(resolved!.patterns).toEqual([]);
        const issues = captured.err.join("\n");
        expect(issues).toContain("theme:");
        expect(issues).toContain("pattern");
        const shell = await (await fetch(`${running.url}/`)).text();
        expect(shell).not.toContain("incomplete-secret");
        expect(shell).not.toContain("invalid-secret");
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects the default singular Theme and logs nothing when --assets is absent", async () => {
    const { captured, running } = await bootCli();
    try {
      expect(captured.err).toEqual([]);
      const shell = await (await fetch(`${running.url}/`)).text();
      expect(shell).toContain("window.__FACET_THEME__");
      expect(shell).not.toContain("__FACET_THEMES__");
    } finally {
      await running.close();
    }
  });
});

describe("runCli — quickstart brick default", () => {
  it("inlines the exact post-migration seeded first paint on the built-in guide path", async () => {
    const { captured, running } = await bootCli();
    try {
      expect(captured.err).toEqual([]);
      const shell = await (await fetch(`${running.url}/`)).text();
      const globals = readShellGlobals(shell);
      const seedText = JSON.stringify(globals.__FACET_INITIAL_STAGE__);

      expect(globals.__FACET_INITIAL_STAGE__).toEqual(QUICKSTART_INITIAL_STAGE);
      expect(seedText).toContain("What is Facet?");
      expect(seedText).toContain("Core Structure");
      expect(seedText).toContain("Design System");
      expect(seedText).toContain("Use Cases");
      expect(Object.keys(QUICKSTART_INITIAL_STAGE.nodes)).toHaveLength(175);
      expect(
        Object.values(QUICKSTART_INITIAL_STAGE.nodes).every((node) =>
          (BRICK_TYPES as readonly string[]).includes(node.type),
        ),
      ).toBe(true);
      expect(seedText).toHaveLength(36_977);
      expect(createHash("sha256").update(seedText).digest("hex")).toBe(
        "f94cf14cb65ea41d3e151c066367094da0afd2cd02b2b53ff091b88317868f81",
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
    let resolved: { readonly theme: FacetTheme; readonly patterns: readonly FacetPattern[] };
    const { running } = await bootCli([], {
      onResolvedAssets: (assets) => {
        resolved = assets;
      },
    });
    try {
      // The CLI must compose via createQuickstartAgent (default MemorySummaryStore),
      // not the bare createReferenceAgent whose default is compaction OFF.
      expect(quickstartSpy).toHaveBeenCalledTimes(1);
      const options = quickstartSpy.mock.calls[0]?.[0] as
        | {
            readonly summaryStore?: unknown;
            readonly theme?: FacetTheme;
            readonly patterns?: readonly FacetPattern[];
          }
        | undefined;
      // No explicit opt-out slipped in: the default (undefined) wires the store.
      expect(options?.summaryStore).not.toBeNull();
      expect(options?.theme).toBe(resolved!.theme);
      expect(options?.patterns).toBe(resolved!.patterns);
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
