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
import { readdirSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type {
  FacetAgent,
  FacetCatalog,
  FacetComposition,
  FacetTheme,
  FacetTree,
} from "@facet/core";
import { createQuickstartAgent, resolveProvider } from "@facet/reference-agent";
import { MemoryAssets, MemorySink, loadAssets, type AssetsStore } from "@facet/runtime";
import { FileAssets } from "@facet/runtime/node";
import { QUICKSTART_INITIAL_STAGE, QUICKSTART_PAGE_BRIEF } from "./guide.js";
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
  /** Called with the assets resolved through `loadAssets` (default library +
   * any `--assets` docs), just before they reach the agent + shell — the
   * observable seam tests use to assert the defaults seed on every boot. */
  readonly onResolvedAssets?: (assets: {
    readonly themes: readonly FacetTheme[];
    readonly compositions: readonly FacetComposition[];
    readonly catalog: FacetCatalog;
  }) => void;
}

const DEFAULT_PORT = 5292;
const DEFAULT_AGENT_ID = "quickstart";
const DEFAULT_GUIDE_PATH = "./facet.md";

const NO_KEY_MESSAGE = "No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.";

const USAGE =
  "Usage: facet-quickstart [--guide <path>] [--port <n>] [--provider openai|anthropic] [--agent-id <id>] [--assets <dir>]";

interface CliFlags {
  readonly guide?: string;
  readonly port: number;
  readonly provider?: string;
  readonly agentId: string;
  readonly assets?: string;
}

/** Parse argv into flags; throws with a user-facing message on bad input. */
function parseFlags(argv: readonly string[]): CliFlags {
  let guide: string | undefined;
  let port = DEFAULT_PORT;
  let provider: string | undefined;
  let agentId = DEFAULT_AGENT_ID;
  let assets: string | undefined;

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
      case "--assets":
        assets = takeValue("--assets", argv[++i]);
        break;
      default:
        throw new Error(`Unknown flag "${String(arg)}"\n${USAGE}`);
    }
  }

  return {
    ...(guide !== undefined ? { guide } : {}),
    port,
    ...(provider !== undefined ? { provider } : {}),
    agentId,
    ...(assets !== undefined ? { assets } : {}),
  };
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

  // Assets registry (Decision 8): resolve through `loadAssets` on EVERY boot so
  // the `@facet/assets` default theme + composition library seeds even with no
  // --assets (an empty MemoryAssets still yields the defaults through the same
  // validation gate — WU-6). An EXPLICIT --assets path must exist (the --guide
  // precedent) and adds the operator's docs on top of the defaults.
  // Documents are validated once here at boot; each issue is one concise warn
  // line (never a document value). Themes go to the agent (names in prompt ②)
  // AND the server (the shell map); compositions to the agent only — expanded
  // server-side, never shipped to the browser; a seedable initial tree to the
  // server (which wraps the stage store).
  let store: AssetsStore;
  if (flags.assets !== undefined) {
    // An EXPLICIT --assets must be a READABLE DIRECTORY (the --guide hard-fail
    // precedent). existsSync passes for a regular file or a permission-denied
    // dir; FileAssets would then warn-and-continue with zero assets and boot at
    // exit 0 — an explicit registry silently doing nothing. Probe for real.
    try {
      if (!statSync(flags.assets).isDirectory()) {
        error(`Assets path is not a directory: ${flags.assets}`);
        return 1;
      }
      readdirSync(flags.assets);
    } catch (cause) {
      error(`Assets directory not readable: ${flags.assets} (${String(cause)})`);
      return 1;
    }
    store = new FileAssets(flags.assets);
  } else {
    // No --assets: an empty document set still seeds the default base layer.
    store = new MemoryAssets({ themes: [], compositions: [] });
  }
  const loaded = await loadAssets(store, flags.agentId);
  const themes: readonly FacetTheme[] = loaded.themes;
  const compositions: readonly FacetComposition[] = loaded.compositions;
  const catalog: FacetCatalog = loaded.catalog;
  const initialStage: FacetTree | undefined =
    loaded.initialTree ?? (usingQuickstartPageBrief ? QUICKSTART_INITIAL_STAGE : undefined);
  for (const issue of loaded.issues) error(`[facet-quickstart] ${issue}`);
  hooks.onResolvedAssets?.({ themes, compositions, catalog });

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
    error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
  if (provider === null) {
    error(NO_KEY_MESSAGE);
    return 1;
  }
  const agent: FacetAgent = createQuickstartAgent({
    provider,
    guide,
    sink,
    agentId: flags.agentId,
    themes,
    compositions,
    catalog,
  });
  const brain = `${provider.name} (${provider.model})`;

  let running: RunningQuickstart;
  try {
    running = await startQuickstart({
      port: flags.port,
      agentId: flags.agentId,
      agent,
      sink,
      themes,
      ...(initialStage !== undefined ? { initialStage } : {}),
    });
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }

  log(`Facet quickstart running at ${running.url}`);
  log(`Brain: ${brain}`);
  hooks.onStarted?.(running);
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
  const code = await runCli(process.argv.slice(2), process.env);
  // Success keeps the process alive on the listening server; only failure exits.
  if (code !== 0) process.exitCode = code;
}

if (isDirectRun()) {
  void main();
}
