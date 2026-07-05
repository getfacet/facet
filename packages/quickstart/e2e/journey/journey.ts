/**
 * WU-3 (Decision C) — the FIXED Playwright journey the /live-test "Live Journey"
 * tier drives against a booted quickstart server, plus the DOM-settle wait
 * (OQ-1), the `--fixture broken` negative mode, and a `main()` CLI the workflow's
 * visitor agents run via shell.
 *
 * The journey is 4 fixed steps capturing ≥4 screenshots into `opts.outDir`:
 *   1. load               → screenshot.
 *   2. chat "add Pricing"  → settle → screenshot.
 *   3. chat "restyle cat"  → settle → screenshot.
 *   4. click the most prominent pressable → settle → screenshot.
 * The step messages are configurable via `opts.messages` (defaults = the real
 * prompts a real LLM answers in WU-4). Each run seeds a FRESH `visitorId` so
 * three visitors are isolated (per-visitor).
 *
 * OQ-1 — DOM-settle, NOT a fixed sleep: after each send/click, `settleDom` polls
 * the agent-drawn STAGE fingerprint (not `#root`, which includes the ChatDock)
 * and resolves when it is unchanged across a quiet window (default 800ms) AFTER a
 * real change, OR a bounded max timeout (default 45s, a real LLM paint takes
 * seconds) elapses. A timeout is NOT a harness failure: the shot is captured
 * anyway and the `{changed, timedOut}` result is recorded — a visitor whose UI
 * never updated is a judge signal, never a throw.
 *
 * No-secrets: screenshots capture the rendered page only; the page never renders
 * the provider key, and the ephemeral `visitorId` is the only identifier.
 *
 * Only exercised under the e2e vitest config / the workflow — never the root
 * `pnpm test` glob (which is `packages/**\/src/**`).
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";

/** The visitor-facing localStorage key the served page reads its id from. */
const VISITOR_STORAGE_KEY = "facet:visitor";

/** Chat prompts for steps 2 and 3 — overridable, defaulting to the real prompts. */
export interface JourneyMessages {
  /** Step 2 — add a section. */
  readonly addSection: string;
  /** Step 3 — restyle the whole page. */
  readonly restyle: string;
}

/** The real prompts WU-4's workflow sends to a real LLM. */
export const DEFAULT_MESSAGES: JourneyMessages = {
  addSection: "Add a section titled Pricing with three simple plan cards",
  restyle: "Now restyle the whole page with a playful, cat-themed look",
};

/** Quiet-window + bounded-timeout knobs for {@link settleDom} (OQ-1). */
export interface SettleOptions {
  /** No stage change for this long ⇒ settled. Default 800ms. */
  readonly quietMs?: number;
  /** Hard upper bound; on elapse capture + flag, never throw. Default 45000ms
   * (a real LLM first paint / edit takes seconds). */
  readonly timeoutMs?: number;
  /** Poll cadence. Default 50ms. */
  readonly pollMs?: number;
  /**
   * Fingerprint captured BEFORE the action, so a change that lands before the
   * first poll is still detected. Omit to baseline at the first poll.
   */
  readonly baseline?: string;
  /**
   * When true (default), the quiet window only ends the wait AFTER a real stage
   * change is observed — so a still-blank stage keeps waiting for the agent's
   * paint until the timeout, instead of settling on emptiness. Set false to
   * settle on any quiet window (e.g. a page expected not to change).
   */
  readonly requireChange?: boolean;
}

/** The recorded outcome of a settle wait — never a thrown error. */
export interface SettleResult {
  /** True iff the stage fingerprint differed from the baseline at any poll. */
  readonly changed: boolean;
  /** True iff the bounded timeout elapsed before a quiet window was observed. */
  readonly timedOut: boolean;
}

/** Options for {@link runJourney}. */
export interface JourneyOptions {
  /** The booted server origin (required in normal mode; ignored for `broken`). */
  readonly url?: string;
  /** Directory the screenshots are written into (created if absent). */
  readonly outDir: string;
  /** A fresh id per run (per-visitor isolation); auto-generated when omitted. */
  readonly visitorId?: string;
  /** `"broken"` loads the committed negative fixture instead of the server. */
  readonly fixture?: "broken";
  /** Overrides for the step 2/3 chat prompts. */
  readonly messages?: Partial<JourneyMessages>;
  /** Settle-wait tuning shared by every post-action step. */
  readonly settle?: SettleOptions;
}

/** One journey step's recorded result. */
export interface JourneyStepResult {
  /** 1-based step index. */
  readonly index: number;
  /** Short label (also the screenshot basename stem). */
  readonly label: string;
  /** Absolute path to the captured screenshot. */
  readonly screenshot: string;
  /** The settle outcome for a post-action step; absent for the pure load step. */
  readonly settle?: SettleResult;
  /** For the click step: whether a pressable was found + clicked. */
  readonly clicked?: boolean;
  /** True iff the initial page load / stage mount timed out (visitor degraded). */
  readonly loadFailed?: boolean;
}

/** The full journey outcome. */
export interface JourneyResult {
  /** The fresh visitor id this run used. */
  readonly visitorId: string;
  /** Absolute screenshot paths, in capture order (≥4 in normal mode). */
  readonly screenshots: readonly string[];
  /** Per-step results. */
  readonly steps: readonly JourneyStepResult[];
  /** Set to `"broken"` when the negative fixture was captured. */
  readonly fixture?: "broken";
}

const DEFAULT_QUIET_MS = 800;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_MS = 50;
/** Bounded wait for the press target — no pressable is recorded, not thrown. */
const CLICK_TIMEOUT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A cheap, stable fingerprint of the rendered STAGE subtree: `innerHTML` length +
 * total element count. Two different renders almost always differ in one of the
 * two; identical fingerprints mean "no visible stage change", which is all the
 * quiet-window needs.
 */
function domFingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Fingerprint the agent-drawn STAGE (not #root) so a ChatDock change — the
    // echoed "You: …" line — is NOT mistaken for a page render. An empty or
    // not-yet-mounted stage ⇒ "0:0", so the shell mounting an empty stage is not
    // a "change"; only a real paint/edit is. Fall back to #root if the marker is
    // absent (older bundle).
    const stage = document.querySelector("[data-facet-stage]") ?? document.getElementById("root");
    if (stage === null) return "0:0";
    return `${String(stage.innerHTML.length)}:${String(stage.querySelectorAll("*").length)}`;
  });
}

/**
 * Poll the stage fingerprint until it is unchanged across a quiet window (only
 * AFTER a real change, when `requireChange`) OR a bounded timeout elapses (OQ-1).
 * NEVER throws: a timeout returns `{ changed, timedOut: true }` so the caller
 * still captures the shot and a dead/frozen UI becomes a judge signal, not a
 * crash. The poll cadence is the settle MECHANISM, not a fixed "wait N ms then
 * screenshot" sleep.
 */
export async function settleDom(page: Page, options: SettleOptions = {}): Promise<SettleResult> {
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const requireChange = options.requireChange ?? true;

  let last = options.baseline ?? (await domFingerprint(page));
  let changed = false;
  let lastActivity = Date.now();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let current: string;
    try {
      current = await domFingerprint(page);
    } catch {
      // The page navigated / the context closed mid-poll — treat as quiet and
      // return what we have rather than throwing out of a settle wait.
      return { changed, timedOut: false };
    }
    if (current !== last) {
      changed = true;
      last = current;
      lastActivity = Date.now();
    } else if ((changed || !requireChange) && Date.now() - lastActivity >= quietMs) {
      // Under requireChange (default), a quiet window ends the wait only after a
      // real stage change — so a blank stage keeps waiting for the agent's paint
      // until the (generous) timeout, rather than settling on emptiness.
      return { changed, timedOut: false };
    }
  }
  return { changed, timedOut: true };
}

/** Ensure `outDir` exists, then screenshot to `NN-label.png`; return its path. */
async function capture(page: Page, outDir: string, index: number, label: string): Promise<string> {
  const path = join(outDir, `${String(index).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

/** Type a message into the ChatDock and send it. */
async function sendChat(page: Page, message: string): Promise<void> {
  // The ChatDock input is the only input WITHOUT a data-facet-field-id stamp
  // (stage fields carry that attribute); the Send button is the page's only
  // native <button> (stage pressables are <div role="button">).
  await page.locator("input:not([data-facet-field-id])").first().fill(message);
  await page.locator("button").first().click();
}

/**
 * Fire a chat message, settle, and screenshot. `changed` is recorded but not
 * required — under a real LLM the chat changes the page; under the stub the
 * change is deterministic but the self-test only pins that settle RAN bounded.
 */
async function chatStep(
  page: Page,
  index: number,
  label: string,
  message: string,
  outDir: string,
  settle: SettleOptions,
): Promise<JourneyStepResult> {
  const baseline = await domFingerprint(page);
  await sendChat(page, message);
  const settleResult = await settleDom(page, { ...settle, baseline });
  const screenshot = await capture(page, outDir, index, label);
  return { index, label, screenshot, settle: settleResult };
}

/**
 * Click the most prominent pressable (the first `<div role="button">` in
 * document order — a stage pressable, never the ChatDock's native Send button),
 * settle, and screenshot. A missing/undispatched press is RECORDED
 * (`clicked:false`), never thrown — a page with no pressable is a judge signal.
 */
async function clickStep(
  page: Page,
  index: number,
  label: string,
  outDir: string,
  settle: SettleOptions,
): Promise<JourneyStepResult> {
  const baseline = await domFingerprint(page);
  let clicked = false;
  try {
    await page.locator('div[role="button"]').first().click({ timeout: CLICK_TIMEOUT_MS });
    clicked = true;
  } catch {
    // No pressable, off-screen, or not clickable within the bound — record it.
  }
  const settleResult = await settleDom(page, { ...settle, baseline });
  const screenshot = await capture(page, outDir, index, label);
  return { index, label, screenshot, settle: settleResult, clicked };
}

/** Resolve the committed negative fixture as a `file://` URL. */
function brokenFixtureUrl(): string {
  return pathToFileURL(fileURLToPath(new URL("./fixtures/broken.html", import.meta.url))).href;
}

/**
 * Drive the FIXED journey against `opts.url` (or the broken fixture) with a
 * fresh visitor, capturing ≥4 screenshots. The caller owns the `page`'s
 * browser context (a fresh context per run is what makes visitors isolated).
 */
export async function runJourney(page: Page, opts: JourneyOptions): Promise<JourneyResult> {
  await mkdir(opts.outDir, { recursive: true });
  const settle = opts.settle ?? {};
  const visitorId =
    opts.visitorId ?? `journey-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;

  // Seed the visitor id BEFORE any page script runs so the served page adopts it
  // (fresh per run ⇒ per-visitor isolation). Storage can be blocked; ignore.
  await page.addInitScript(
    (seed: { key: string; id: string }) => {
      try {
        localStorage.setItem(seed.key, seed.id);
      } catch {
        // Storage unavailable — the page falls back to its own random id.
      }
    },
    { key: VISITOR_STORAGE_KEY, id: visitorId },
  );

  // Negative mode (DC-002): capture the deterministic known-bad page for the
  // safety judge; no server, no chat/click steps (the fixture has neither).
  if (opts.fixture === "broken") {
    await page.goto(brokenFixtureUrl(), { waitUntil: "load" });
    const screenshot = await capture(page, opts.outDir, 1, "broken");
    return {
      visitorId,
      screenshots: [screenshot],
      steps: [{ index: 1, label: "broken", screenshot }],
      fixture: "broken",
    };
  }

  const url = opts.url;
  if (url === undefined || url === "") {
    throw new Error("runJourney: opts.url is required in normal mode");
  }
  const messages: JourneyMessages = { ...DEFAULT_MESSAGES, ...opts.messages };

  const steps: JourneyStepResult[] = [];

  // Step 1 — load. Wait (bounded) for React to mount SOMETHING into #root, then
  // settle so the first-visit render lands before the shot; a mount timeout
  // degrades that visitor (flagged) instead of throwing.
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Baseline the (still-empty) stage BEFORE the visit render lands, then wait for
  // the agent's FIRST PAINT — the stage going non-empty — to settle before the
  // shot. A real LLM first paint takes seconds; requireChange means we wait for
  // it (bounded) rather than screenshot the blank shell. No paint within the
  // timeout ⇒ that visitor is flagged (loadFailed), never thrown.
  const loadBaseline = await domFingerprint(page);
  const loadSettle = await settleDom(page, { ...settle, baseline: loadBaseline });
  const loadFailed = !loadSettle.changed;
  const loadShot = await capture(page, opts.outDir, 1, "load");
  steps.push(
    loadFailed
      ? { index: 1, label: "load", screenshot: loadShot, loadFailed: true }
      : { index: 1, label: "load", screenshot: loadShot },
  );

  // Steps 2 + 3 — chat, settle, shot.
  steps.push(await chatStep(page, 2, "add-section", messages.addSection, opts.outDir, settle));
  steps.push(await chatStep(page, 3, "restyle", messages.restyle, opts.outDir, settle));

  // Step 4 — click the most prominent pressable, settle, shot.
  steps.push(await clickStep(page, 4, "click", opts.outDir, settle));

  return { visitorId, screenshots: steps.map((step) => step.screenshot), steps };
}

/** Parse `--flag value` pairs (and the bare `--fixture broken` form). */
function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

/**
 * CLI entry (`node journey.js --url <url> --visitor <id> --out <dir>
 * [--fixture broken]`) — launches its OWN headless chromium + a fresh context
 * (per-visitor isolation), runs the journey, prints the result JSON, and exits
 * 0 on success / 1 on failure. This is the ONLY I/O beyond the page drive;
 * importing the module runs nothing (guarded below).
 */
async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const outDir = args["out"] ?? args["outDir"];
  if (outDir === undefined) {
    process.stderr.write("journey: --out <dir> is required\n");
    process.exit(1);
    return;
  }
  const fixture = args["fixture"] === "broken" ? ("broken" as const) : undefined;
  if (fixture === undefined && (args["url"] === undefined || args["url"] === "")) {
    process.stderr.write("journey: --url <url> is required in normal mode\n");
    process.exit(1);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const opts: JourneyOptions = {
        outDir,
        ...(args["url"] !== undefined ? { url: args["url"] } : {}),
        ...(args["visitor"] !== undefined ? { visitorId: args["visitor"] } : {}),
        ...(fixture !== undefined ? { fixture } : {}),
      };
      const result = await runJourney(page, opts);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(0);
    } finally {
      await context.close();
    }
  } catch (error) {
    process.stderr.write(`journey: failed (${String(error)})\n`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Run main() only when executed directly (node journey.js …), never on import.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main(process.argv.slice(2));
}
