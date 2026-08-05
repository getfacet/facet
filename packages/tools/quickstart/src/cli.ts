#!/usr/bin/env node
/**
 * `facet-quickstart` — one command from a provider key to a live Facet page
 * owned by the built-in reference agent.
 *
 * The bin is a thin `main()`; all arg-parse/key-resolution/boot logic lives in
 * the exported `runCli(argv, env, hooks?)` so cli.test.ts drives DC-005
 * in-process with deterministic exit codes and captured messages. Keys are read
 * from env only and never logged (error messages name the VAR, never a value).
 */
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { InProcessFacetAgent } from "@facet/agent";
import { DEFAULT_THEME } from "@facet/assets";
import { resolveProvider } from "@facet/reference-agent";
import { MemorySink } from "@facet/runtime";
import { createQuickstartAgent } from "./agent.js";
import { loadQuickstartDesignOverlay } from "./design-overlay-node.js";
import type { LoadedQuickstartDesignOverlay } from "./design-overlay-node.js";
import { QUICKSTART_INITIAL_MARKUP, QUICKSTART_PAGE_BRIEF } from "./guide.js";
import { startQuickstart, type RunningQuickstart } from "./server.js";

export interface RunCliHooks {
  /** Info output (default: console.log). */
  readonly log?: (line: string) => void;
  /** Error output (default: console.error). */
  readonly error?: (line: string) => void;
  /** Called with the running server after a successful boot — tests use it to
   * close the server (main() ignores it; the listening server keeps the
   * process alive). */
  readonly onStarted?: (running: RunningQuickstart) => void;
}

const DEFAULT_PORT = 5292;
const DEFAULT_AGENT_ID = "quickstart";
const DEFAULT_GUIDE_PATH = "./facet.md";

const NO_KEY_MESSAGE = "No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.";

const USAGE =
  "Usage: facet-quickstart [--guide <path>] [--design <path>] [--port <n>] [--provider openai|anthropic] [--agent-id <id>]";

interface CliFlags {
  readonly guide?: string;
  readonly design?: string;
  readonly port: number;
  readonly provider?: string;
  readonly agentId: string;
}

/** Parse argv into flags; throws with a user-facing message on bad input. */
function parseFlags(argv: readonly string[]): CliFlags {
  let guide: string | undefined;
  let design: string | undefined;
  let port = DEFAULT_PORT;
  let provider: string | undefined;
  let agentId = DEFAULT_AGENT_ID;

  const takeValue = (flag: string, value: string | undefined): string => {
    if (value === undefined) throw new Error(`${flag} requires a value\n${USAGE}`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--guide":
        guide = takeValue("--guide", argv[++i]);
        break;
      case "--design":
        design = takeValue("--design", argv[++i]);
        break;
      case "--port": {
        const raw = takeValue("--port", argv[++i]);
        const parsed = Number.parseInt(raw, 10);
        // Reject 0 too: the CLI prints http://localhost:<port>, and port 0 binds
        // an OS-chosen ephemeral port the deployer would never learn.
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535 || String(parsed) !== raw) {
          throw new Error(`--port expects a port number 1-65535, got "${raw}"`);
        }
        port = parsed;
        break;
      }
      case "--provider":
        provider = takeValue("--provider", argv[++i]);
        break;
      case "--agent-id":
        agentId = takeValue("--agent-id", argv[++i]);
        break;
      default:
        throw new Error(`Unknown flag "${String(arg)}"\n${USAGE}`);
    }
  }

  return {
    ...(guide !== undefined ? { guide } : {}),
    ...(design !== undefined ? { design } : {}),
    port,
    ...(provider !== undefined ? { provider } : {}),
    agentId,
  };
}

async function cleanupLoadedDesign(
  activeDesign: LoadedQuickstartDesignOverlay | undefined,
): Promise<void> {
  try {
    await activeDesign?.cleanup();
  } catch {
    // Temporary bundle cleanup is best-effort; keep reporting the primary
    // startup or shutdown result.
  }
}

function withDesignCleanup(
  running: RunningQuickstart,
  activeDesign: LoadedQuickstartDesignOverlay | undefined,
): RunningQuickstart {
  if (activeDesign === undefined) return running;
  return {
    url: running.url,
    close: async () => {
      try {
        await running.close();
      } finally {
        await cleanupLoadedDesign(activeDesign);
      }
    },
  };
}

const SIGNAL_EXIT_CODES = Object.freeze({
  SIGINT: 130,
  SIGTERM: 143,
});

function installShutdownHandlers(getRunning: () => RunningQuickstart | undefined): void {
  let shuttingDown = false;
  for (const signal of Object.keys(SIGNAL_EXIT_CODES) as (keyof typeof SIGNAL_EXIT_CODES)[]) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.exitCode = SIGNAL_EXIT_CODES[signal];
      const running = getRunning();
      const close = running === undefined ? Promise.resolve() : running.close().catch(() => {});
      void close.finally(() => {
        process.exit();
      });
    });
  }
}

export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  hooks: RunCliHooks = {},
): Promise<number> {
  const log = hooks.log ?? ((line: string): void => console.log(line));
  const error = hooks.error ?? ((line: string): void => console.error(line));

  let flags: CliFlags;
  try {
    flags = parseFlags(argv);
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }

  // Guide resolution (Decision 9): an EXPLICIT path must exist; the DEFAULT
  // path falls back to the quickstart-owned built-in guide silently.
  let guide: string;
  let usingQuickstartPageBrief = false;
  if (flags.guide !== undefined) {
    try {
      guide = await readFile(flags.guide, "utf8");
    } catch {
      error(`Guide file not found: ${flags.guide}`);
      return 1;
    }
  } else {
    try {
      guide = await readFile(DEFAULT_GUIDE_PATH, "utf8");
    } catch {
      guide = QUICKSTART_PAGE_BRIEF;
      usingQuickstartPageBrief = true;
    }
  }

  // Zero-setup bootstrap is fixed to the framework defaults. The retired
  // `--assets` flag and file-backed asset registry are gone; custom components
  // are a host integration concern, not a quickstart CLI branch.
  const theme = DEFAULT_THEME;
  const initialMarkup = usingQuickstartPageBrief ? QUICKSTART_INITIAL_MARKUP : undefined;
  let activeDesign: LoadedQuickstartDesignOverlay | undefined;
  if (flags.design !== undefined) {
    try {
      activeDesign = await loadQuickstartDesignOverlay({ designPath: flags.design });
    } catch (cause) {
      error(cause instanceof Error ? cause.message : String(cause));
      return 1;
    }
  }

  // One MemorySink shared by the agent (prompt layer ③ reads history) and the
  // facet server (which records into it) — the same conversation, both sides.
  const sink = new MemorySink();

  let provider;
  try {
    provider = resolveProvider(
      flags.provider !== undefined ? { provider: flags.provider } : {},
      env,
    );
  } catch (cause) {
    await cleanupLoadedDesign(activeDesign);
    error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
  if (provider === null) {
    await cleanupLoadedDesign(activeDesign);
    error(NO_KEY_MESSAGE);
    return 1;
  }
  // Compaction ON by default: createQuickstartAgent seeds a fresh
  // MemorySummaryStore so a long local conversation compacts instead of
  // replaying in full. The summary store lives entirely inside the agent
  // closure (background lane + Sink history), so the server boot needs no
  // summary parameter — it only forwards events to this agent.
  const agent: InProcessFacetAgent = createQuickstartAgent({
    provider,
    guide,
    sink,
    agentId: flags.agentId,
  });
  const brain = `${provider.name} (${provider.model})`;

  let running: RunningQuickstart;
  try {
    running = await startQuickstart({
      port: flags.port,
      agentId: flags.agentId,
      agent,
      sink,
      ...(activeDesign === undefined
        ? { theme }
        : {
            catalog: activeDesign.design.catalog,
            theme: activeDesign.design.theme,
            themeExtensions: activeDesign.design.themeExtensions,
            pageBundlePath: activeDesign.pageBundlePath,
          }),
      ...(initialMarkup !== undefined ? { initialMarkup } : {}),
    });
  } catch (cause) {
    await cleanupLoadedDesign(activeDesign);
    error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }

  log(`Facet quickstart running at ${running.url}`);
  log(`Brain: ${brain}`);
  if (activeDesign !== undefined) {
    log(`Design module: ${activeDesign.overlayPath} (trusted local code)`);
  }
  hooks.onStarted?.(withDesignCleanup(running, activeDesign));
  return 0;
}

/** True only when this module is the executed bin (never when imported by tests).
 * argv[1] is realpath'd so the npx/bin symlink still matches this module's URL. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let running: RunningQuickstart | undefined;
  installShutdownHandlers(() => running);
  const code = await runCli(process.argv.slice(2), process.env, {
    onStarted: (handle) => {
      running = handle;
    },
  });
  // Success keeps the process alive on the listening server; only failure exits.
  if (code !== 0) process.exitCode = code;
}

if (isDirectRun()) {
  void main();
}
