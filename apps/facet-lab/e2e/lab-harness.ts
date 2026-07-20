import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { RunEvidenceV1 } from "../src/shared/run-contract.js";
import { DETERMINISTIC_MODEL } from "../src/server/deterministic-provider.js";
import { startFacetLab, type RunningFacetLab } from "../src/server/main.js";
import {
  createPlaywrightScreenshotDriver,
  type ScreenshotDriver,
} from "../src/server/screenshot-service.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LAB_ROOT = join(REPOSITORY_ROOT, "apps/facet-lab");
const LAB_BUNDLE_ROOT = join(REPOSITORY_ROOT, "apps/facet-lab/dist/browser");
const BUILD_LOCK = join(LAB_ROOT, ".facet-lab-e2e-build-lock");
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_AUDITED_RESPONSE_BYTES = 2 * 1024 * 1024;

let buildPromise: Promise<void> | undefined;

export type ScreenshotMode = "real" | "failed" | "unavailable";

export interface NetworkAuditEntry {
  readonly direction: "request" | "response";
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly body: string;
}

export interface BootLabHarnessOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly screenshotMode?: ScreenshotMode;
  /** Installed only while the server captures its provider fetch implementation. */
  readonly providerFetch?: typeof fetch;
}

export interface LabHarness {
  readonly url: string;
  readonly rootDirectory: string;
  readonly dataDirectory: string;
  readonly artifactDirectory: string;
  readonly browser: Browser;
  readonly server: RunningFacetLab;
  readonly network: NetworkAuditEntry[];
  readonly pageErrors: string[];
  newPage(options?: { readonly colorScheme?: "light" | "dark" }): Promise<Page>;
  flushNetwork(): Promise<void>;
  close(): Promise<void>;
}

export interface DeterministicJourneyOptions {
  readonly scenarioId?: string;
  readonly constraint?: string | null;
  readonly viewport?: "mobile" | "tablet" | "desktop";
  readonly colorMode?: "light" | "dark";
  readonly followUps?: readonly string[];
}

export interface DeterministicJourneyResult {
  readonly runId: string;
  readonly evidence: RunEvidenceV1;
  readonly stageTexts: readonly string[];
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: REPOSITORY_ROOT }, (error, stdout, stderr) => {
      if (error === null) {
        resolve();
        return;
      }
      reject(
        new Error(
          [`${command} ${args.join(" ")} failed`, stdout.trim(), stderr.trim()]
            .filter((line) => line.length > 0)
            .join("\n"),
        ),
      );
    });
  });
}

/** E2E always consumes the production Vite output, never the dev transform path. */
export function ensureLabBundle(): Promise<void> {
  buildPromise ??= coordinatedBuild();
  return buildPromise;
}

async function bundleIsFresh(): Promise<boolean> {
  let bundleTime: number;
  try {
    bundleTime = (await stat(join(LAB_BUNDLE_ROOT, "index.html"))).mtimeMs;
  } catch {
    return false;
  }
  const inputs = [
    ...(await filesUnder(join(LAB_ROOT, "src"))),
    join(LAB_ROOT, "index.html"),
    join(LAB_ROOT, "vite.config.ts"),
  ];
  for (const input of inputs) {
    try {
      if ((await stat(input)).mtimeMs > bundleTime) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function coordinatedBuild(): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      await mkdir(BUILD_LOCK);
      break;
    } catch (error: unknown) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      if (await bundleIsFresh()) return;
      try {
        if (Date.now() - (await stat(BUILD_LOCK)).mtimeMs > 5 * 60_000) {
          await rm(BUILD_LOCK, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for the Facet Lab E2E build lock");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    if (!(await bundleIsFresh())) {
      await run("pnpm", ["--filter", "@facet/lab", "build"]);
    }
  } finally {
    await rm(BUILD_LOCK, { recursive: true, force: true });
  }
}

function failedScreenshotDriver(): ScreenshotDriver {
  return Object.freeze({
    capture: () => Promise.reject(new Error("injected screenshot failure")),
  });
}

function attachNetworkAudit(
  page: Page,
  entries: NetworkAuditEntry[],
  pending: Set<Promise<void>>,
): void {
  page.on("request", (request) => {
    entries.push({
      direction: "request",
      method: request.method(),
      url: request.url(),
      status: null,
      body: request.postData() ?? "",
    });
  });
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    const contentLength = Number(response.headers()["content-length"] ?? "0");
    if (
      contentType.startsWith("text/event-stream") ||
      (Number.isFinite(contentLength) && contentLength > MAX_AUDITED_RESPONSE_BYTES)
    ) {
      entries.push({
        direction: "response",
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        body: "",
      });
      return;
    }
    const audit = response
      .text()
      .then((body) => {
        entries.push({
          direction: "response",
          method: response.request().method(),
          url: response.url(),
          status: response.status(),
          body: body.slice(0, MAX_AUDITED_RESPONSE_BYTES),
        });
      })
      .catch(() => undefined)
      .then(() => undefined);
    pending.add(audit);
    void audit.finally(() => pending.delete(audit));
  });
}

export async function bootLabHarness(options: BootLabHarnessOptions = {}): Promise<LabHarness> {
  await ensureLabBundle();
  const rootDirectory = await mkdtemp(join(tmpdir(), "facet-lab-journey-"));
  const configuredDataDirectory = options.environment?.FACET_LAB_DATA_DIR?.trim();
  const configuredArtifactDirectory = options.environment?.FACET_LAB_ARTIFACTS_DIR?.trim();
  const dataDirectory = configuredDataDirectory || join(rootDirectory, "data");
  const artifactDirectory = configuredArtifactDirectory || join(rootDirectory, "artifacts");
  const browser = await chromium.launch({ headless: true });
  const screenshotMode = options.screenshotMode ?? "unavailable";
  const screenshotDriver =
    screenshotMode === "real"
      ? createPlaywrightScreenshotDriver(browser)
      : screenshotMode === "failed"
        ? failedScreenshotDriver()
        : undefined;

  const originalFetch = globalThis.fetch;
  if (options.providerFetch !== undefined) globalThis.fetch = options.providerFetch;
  let server: RunningFacetLab;
  try {
    server = await startFacetLab({
      port: 0,
      staticRoot: LAB_BUNDLE_ROOT,
      dataDirectory,
      environment: options.environment ?? {},
      ...(screenshotDriver === undefined ? {} : { screenshotDriver }),
    });
  } catch (error: unknown) {
    await browser.close().catch(() => undefined);
    await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
  }

  const contexts = new Set<BrowserContext>();
  const network: NetworkAuditEntry[] = [];
  const pageErrors: string[] = [];
  const pendingNetwork = new Set<Promise<void>>();

  return {
    url: server.url,
    rootDirectory,
    dataDirectory: server.dataDirectory,
    artifactDirectory,
    browser,
    server,
    network,
    pageErrors,
    async newPage(pageOptions = {}) {
      const context = await browser.newContext({
        colorScheme: pageOptions.colorScheme ?? "light",
        acceptDownloads: true,
      });
      contexts.add(context);
      context.on("close", () => contexts.delete(context));
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      attachNetworkAudit(page, network, pendingNetwork);
      return page;
    },
    async flushNetwork() {
      await Promise.allSettled([...pendingNetwork]);
    },
    async close() {
      await Promise.all([...contexts].map((context) => context.close().catch(() => undefined)));
      await server.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export async function requestJson<T>(
  harness: Pick<LabHarness, "url">,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${harness.url}${path}`, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} returned ${String(response.status)}: ${body}`,
    );
  }
  return JSON.parse(body) as T;
}

export async function requestText(
  harness: Pick<LabHarness, "url">,
  path: string,
  init?: RequestInit,
): Promise<string> {
  const response = await fetch(`${harness.url}${path}`, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} returned ${String(response.status)}: ${body}`,
    );
  }
  return body;
}

export async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition was not met within ${String(timeoutMs)}ms: ${JSON.stringify(last)}`);
}

export function waitForEvidence(
  harness: Pick<LabHarness, "url">,
  runId: string,
  accept: (evidence: RunEvidenceV1) => boolean,
  timeoutMs?: number,
): Promise<RunEvidenceV1> {
  return waitFor(
    () => requestJson<RunEvidenceV1>(harness, `/api/runs/${runId}`),
    accept,
    timeoutMs,
  );
}

async function liveStageText(page: Page): Promise<string> {
  return page.getByLabel("Live Facet stage").innerText();
}

async function installDeterministicGenerateAdapter(page: Page): Promise<void> {
  await page.route("**/api/capabilities", async (route) => {
    const response = await route.fetch();
    const capabilities = (await response.json()) as {
      readonly providers: Readonly<Record<string, unknown>>;
      readonly [key: string]: unknown;
    };
    await route.fulfill({
      response,
      json: {
        ...capabilities,
        providers: {
          ...capabilities.providers,
          openai: {
            provider: "openai",
            available: true,
            models: [DETERMINISTIC_MODEL],
            defaultModel: DETERMINISTIC_MODEL,
          },
        },
      },
    });
  });
  await page.route("**/api/runs", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const configuration = request.postDataJSON() as Readonly<Record<string, unknown>>;
    await route.continue({
      postData: JSON.stringify({
        ...configuration,
        mode: "deterministic",
        provider: "openai",
        model: DETERMINISTIC_MODEL,
      }),
    });
  });
}

/** Drives initial render + UI-IN follow-ups + terminal persistence through the browser UI. */
export async function runDeterministicJourney(
  harness: LabHarness,
  page: Page,
  options: DeterministicJourneyOptions = {},
): Promise<DeterministicJourneyResult> {
  const scenarioId = options.scenarioId ?? "landing-marketing";
  const followUps = options.followUps ?? ["Apply the follow-up state"];
  await installDeterministicGenerateAdapter(page);
  await page.goto(`${harness.url}/generate`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Generate", exact: true }).last().waitFor();
  await page.locator("#generate-scenario").selectOption(scenarioId);
  if (options.constraint !== undefined && options.constraint !== null) {
    await page.locator("#generate-asset-mode").selectOption("constrained");
    await page.locator("#generate-constraint").fill(options.constraint);
  }
  if (options.viewport !== undefined) {
    await page.locator("#generate-viewport").selectOption(options.viewport);
  }
  if (options.colorMode !== undefined) {
    await page.locator("#generate-color-mode").selectOption(options.colorMode);
  }
  await page.getByRole("button", { name: "Start new run" }).click();
  const stage = page.getByLabel("Live Facet stage");
  await stage.waitFor();
  const runId = await stage.getAttribute("data-run-id");
  if (runId === null) throw new Error("Live stage did not expose a run identity");

  const stageTexts: string[] = [];
  await waitForEvidence(harness, runId, (evidence) => evidence.frames.length >= 1);
  stageTexts.push(
    await waitFor(
      () => liveStageText(page),
      (text) => text.trim().length > 0,
    ),
  );
  const action = stage.locator('[role="button"]').first();
  await action.waitFor({ state: "visible" });
  await action.click();
  await waitForEvidence(harness, runId, (evidence) => evidence.frames.length >= 2);
  stageTexts.push(
    await waitFor(
      () => liveStageText(page),
      (text) => text !== stageTexts[0],
    ),
  );
  for (let index = 0; index < followUps.length; index += 1) {
    await page.locator("#generate-follow-up").fill(followUps[index] ?? "Continue");
    await page.getByRole("button", { name: "Send follow-up through UI-IN" }).click();
    await waitForEvidence(harness, runId, (evidence) => evidence.frames.length >= index + 3);
    const previous = stageTexts.at(-1) ?? "";
    stageTexts.push(
      await waitFor(
        () => liveStageText(page),
        (text) => text !== previous,
      ),
    );
  }

  await page.getByRole("button", { name: "Cancel run" }).click();
  const evidence = await waitForEvidence(
    harness,
    runId,
    (candidate) => candidate.run.status === "cancelled",
  );
  return { runId, evidence, stageTexts: Object.freeze(stageTexts) };
}

function normalizedRecord(record: RunEvidenceV1["records"][number]): unknown {
  return {
    kind: record.kind,
    source: record.source,
    truncated: record.truncated,
    overflow: record.overflow,
    data: normalizeDynamicValues(record.data),
  };
}

function normalizeDynamicValues(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^[a-z0-9]+:[0-9]+$/iu.test(value)) return "<turn>";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
      return "<uuid>";
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
      return "<timestamp>";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeDynamicValues);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeDynamicValues(child)]),
    );
  }
  return value;
}

/** Removes run-, clock-, and artifact-specific values while keeping behavioral evidence exact. */
export function normalizeEvidence(evidence: RunEvidenceV1): unknown {
  return {
    run: {
      status: evidence.run.status,
      mode: evidence.run.mode,
      provider: evidence.run.provider,
      model: evidence.run.model,
      scenarioId: evidence.run.scenarioId,
      prompt: evidence.run.prompt,
      constraint: evidence.run.constraint,
      viewport: evidence.run.viewport,
      colorMode: evidence.run.colorMode,
      assetDigest: evidence.run.assetDigest,
      assetSource: evidence.run.assetSource,
    },
    initialTree: evidence.initialTree,
    finalTree: evidence.finalTree,
    records: evidence.records.map(normalizedRecord),
    frames: evidence.frames.map((frame) => ({
      stageVersion: frame.stageVersion,
      patches: frame.patches,
      says: frame.says,
      disposition: frame.disposition,
      postFoldTreeDigest: frame.postFoldTreeDigest,
    })),
    checks: evidence.checks,
    warnings: evidence.warnings.map(({ classification, code, message }) => ({
      classification,
      code,
      message,
    })),
  };
}

async function filesUnder(root: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function scanFilesForCanary(root: string, canary: string): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const path of await filesUnder(root)) {
    const info = await stat(path);
    if (info.size > 32 * 1024 * 1024) continue;
    if ((await readFile(path)).includes(Buffer.from(canary))) matches.push(path);
  }
  return matches;
}

export function scanNetworkForCanary(
  entries: readonly NetworkAuditEntry[],
  canary: string,
): readonly NetworkAuditEntry[] {
  return entries.filter(({ url, body }) => url.includes(canary) || body.includes(canary));
}

export async function scanBuiltBundleForCanary(canary: string): Promise<readonly string[]> {
  return scanFilesForCanary(LAB_BUNDLE_ROOT, canary);
}
