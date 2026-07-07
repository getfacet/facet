/**
 * WU-2 (Decision B) — the journey harness the /live-test "Live Journey" tier
 * builds on: a shared server boot/teardown and a `node dist/cli.js --stub` bin
 * smoke. It consumes quickstart's server wrapper (`startQuickstart`) and the
 * reference-agent provider surface (`resolveProvider`) — no `src/` change.
 *
 * - `bootJourney({ agent, agentId })` boots the quickstart wrapper on a random
 *   loopback port, retrying on `EADDRINUSE` (the `smoke.test.ts` bind-retry
 *   pattern), and returns the `RunningQuickstart` handle. The real tier passes
 *   the built-in agent; the self-test passes `createStubAgent()` — one boot
 *   helper, two agents. Every boot MUST be paired with `.close()` (teardown).
 * - `runBinSmoke()` spawns the built bin under `--stub`, polls `/health`, always
 *   kills the child (in a `finally`), and reports `{ ok, detail, stderr }`
 *   (DC-005). It is "runs + reports a result", NOT `ok===true`: in the dev
 *   monorepo the documented `@facet/* → src/*.ts` resolution gap makes the child
 *   crash (`ok:false`, error in `detail`/`stderr`). Needs a prior
 *   `pnpm --filter @facet/quickstart build`.
 * - `resolveJourneyProvider(env)` is a thin wrapper over `resolveProvider`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FacetAgent } from "@facet/core";
import { resolveProvider, type QuickstartProvider } from "@facet/reference-agent";
import { startQuickstart, type RunningQuickstart } from "../../src/index.js";

/** Options for {@link bootJourney}. */
export interface BootJourneyOptions {
  readonly agent: FacetAgent;
  /** Defaults to `"journey"`. */
  readonly agentId?: string;
  /**
   * Explicit candidate ports tried in order before falling back to random high
   * ports — a test seam so the `EADDRINUSE` retry path can be exercised
   * deterministically. Production callers omit it (pure random).
   */
  readonly candidatePorts?: readonly number[];
}

/** The reported outcome of {@link runBinSmoke} (DC-005). */
export interface BinSmokeResult {
  /** True iff `/health` returned 200 before the child died / the deadline. */
  readonly ok: boolean;
  /** Human-readable summary — always non-empty (the health body, or the reason). */
  readonly detail: string;
  /** Everything the child wrote to stderr (captured for DC-005 evidence). */
  readonly stderr: string;
}

/** A random high loopback port (20000–39999), matching the smoke suite. */
function randomHighPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

/**
 * Boot the quickstart wrapper on a free loopback port, retrying on bind
 * collisions. Returns the running handle — the CALLER owns teardown and MUST
 * call `.close()` (pair it in a `finally`).
 */
export async function bootJourney(options: BootJourneyOptions): Promise<RunningQuickstart> {
  const agentId = options.agentId ?? "journey";
  const attempts = 10;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = options.candidatePorts?.[attempt] ?? randomHighPort();
    try {
      return await startQuickstart({ port, agentId, agent: options.agent });
    } catch {
      // EADDRINUSE (or any bind error) — try another port.
    }
  }
  throw new Error("bootJourney: could not bind the quickstart wrapper to a free loopback port");
}

/** Per-attempt bin-smoke health deadline (bounded; the child is killed after). */
const BIN_SMOKE_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 200;

/** The built bin this smoke spawns — `packages/agent-stack/quickstart/dist/cli.js`. */
function binPath(): string {
  return fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn `node dist/cli.js --stub --port <random>`, poll `GET /health` until 200
 * (or the child dies / the deadline passes), then ALWAYS kill the child. Reports
 * `{ ok, detail, stderr }`. DC-005: this RUNS + REPORTS a result — `ok` is not
 * asserted (the dev-monorepo resolution gap makes it `false`).
 */
export async function runBinSmoke(): Promise<BinSmokeResult> {
  const port = randomHighPort();
  const child = spawn(process.execPath, [binPath(), "--stub", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

  let exited = false;
  let exitInfo = "";
  child.once("exit", (code, signal) => {
    exited = true;
    exitInfo = `exit code=${String(code)} signal=${String(signal)}`;
  });
  // A spawn-level failure (e.g. node missing) — surface it, don't hang.
  let spawnError = "";
  child.once("error", (error) => {
    exited = true;
    spawnError = error instanceof Error ? error.message : String(error);
  });

  try {
    const deadline = Date.now() + BIN_SMOKE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) break; // child crashed before becoming healthy
      try {
        const res = await fetch(`http://127.0.0.1:${String(port)}/health`);
        if (res.status === 200) {
          const body = (await res.text()).trim();
          return {
            ok: true,
            detail: `GET /health → 200 (${body || "ok"})`,
            stderr,
          };
        }
      } catch {
        // Connection refused while the server is still coming up — keep polling.
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }

    const reason = spawnError
      ? `spawn failed: ${spawnError}`
      : exited
        ? `child exited before /health became healthy (${exitInfo})`
        : `/health did not return 200 within ${String(BIN_SMOKE_TIMEOUT_MS)}ms`;
    const trail = (stderr || stdout).trim();
    return {
      ok: false,
      detail: `${reason}${trail ? ` — ${trail}` : ""}`,
      stderr,
    };
  } finally {
    // DC-006: the child is ALWAYS killed, never orphaned.
    if (!exited) child.kill("SIGKILL");
  }
}

/**
 * Thin wrapper over `resolveProvider` — resolves a provider purely from env
 * (no flags), returning `null` when no key is present. Lets the live-journey
 * tier decide SKIP-with-reason vs. run without re-implementing the rule.
 */
export function resolveJourneyProvider(
  env: Readonly<Record<string, string | undefined>>,
): QuickstartProvider | null {
  return resolveProvider({}, env);
}
