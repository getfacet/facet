import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";

import type { RunEvidenceV1 } from "../src/shared/run-contract.js";
import {
  bootLabHarness,
  requestJson,
  requestText,
  scanBuiltBundleForCanary,
  scanFilesForCanary,
  scanNetworkForCanary,
  waitFor,
  waitForEvidence,
  type LabHarness,
} from "./lab-harness.js";

const SECRET_CANARY = "facet-lab-arbitrary-provider-credential-never-expose";
const PROVIDER_MODEL = "facet-lab-offline-fixture";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function completedTurns(evidence: RunEvidenceV1): number {
  return evidence.records.filter(
    ({ data }) => isRecord(data) && data["kind"] === "stop" && data["reason"] === "complete",
  ).length;
}

function openAiToolResponse(): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: "offline-initial-render",
              type: "function",
              function: {
                name: "render_page",
                arguments: JSON.stringify({
                  tree: {
                    root: "offline-root",
                    nodes: {
                      "offline-root": {
                        id: "offline-root",
                        type: "box",
                        children: ["offline-title", "offline-action"],
                      },
                      "offline-title": {
                        id: "offline-title",
                        type: "text",
                        value: "Last valid provider stage",
                        style: { preset: "heading" },
                      },
                      "offline-action": {
                        id: "offline-action",
                        type: "box",
                        children: ["offline-action-label"],
                        onPress: { kind: "agent", name: "explore_marketing" },
                        style: { preset: "primaryAction" },
                      },
                      "offline-action-label": {
                        id: "offline-action-label",
                        type: "text",
                        value: "Continue",
                        style: { preset: "actionLabel" },
                      },
                    },
                  },
                }),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

function offlineAfterInitialStageFetch(): typeof fetch {
  let providerCalls = 0;
  return async (input, init) => {
    const requestBody =
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "";
    if (requestBody.includes("Continue while the provider is offline")) {
      throw new Error("injected provider offline boundary");
    }
    providerCalls += 1;
    if (providerCalls % 2 === 1) return openAiToolResponse();
    return Response.json({
      choices: [{ message: { content: `Initial provider stage is ready. ${SECRET_CANARY}` } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    });
  };
}

function postJson<T>(harness: LabHarness, path: string, body: unknown): Promise<T> {
  return requestJson<T>(harness, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function startProviderRun(page: Page, harness: LabHarness): Promise<string> {
  await page.goto(`${harness.url}/generate`, { waitUntil: "networkidle" });
  await page.locator("#generate-provider").selectOption("openai");
  await page.locator("#generate-model").selectOption(PROVIDER_MODEL);
  await page.getByRole("button", { name: "Start new run" }).click();
  const stage = page.getByLabel("Live Facet stage");
  await stage.waitFor();
  const runId = await stage.getAttribute("data-run-id");
  if (runId === null) throw new Error("provider run did not expose its run id");
  await waitForEvidence(harness, runId, (evidence) => completedTurns(evidence) >= 1);
  return runId;
}

async function countRuns(harness: LabHarness): Promise<number> {
  return (await requestJson<readonly RunEvidenceV1[]>(harness, "/api/runs?limit=100")).length;
}

describe("Facet Lab boundary and recovery journey", () => {
  let harness: LabHarness;

  beforeAll(async () => {
    harness = await bootLabHarness({
      screenshotMode: "real",
      environment: {
        OPENAI_API_KEY: SECRET_CANARY,
        FACET_LAB_OPENAI_MODELS: PROVIDER_MODEL,
      },
      providerFetch: offlineAfterInitialStageFetch(),
    });
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("recovers package asset prerequisites from both Catalog and Generate", async () => {
    for (const path of ["/catalog", "/generate"] as const) {
      const page = await harness.newPage();
      let assetRequests = 0;
      let catalogRequests = 0;
      let rejectAssetRequests = true;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/catalog") catalogRequests += 1;
      });
      await page.route("**/api/assets", async (route) => {
        assetRequests += 1;
        if (rejectAssetRequests) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "injected asset outage" }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto(`${harness.url}${path}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Package assets could not be loaded." }).waitFor();
      const assetRequestsBeforeRetry = assetRequests;
      const catalogRequestsBeforeRetry = catalogRequests;
      rejectAssetRequests = false;
      await page.getByRole("button", { name: "Retry" }).click();
      await page
        .getByRole("heading", { name: path === "/catalog" ? "Catalog" : "Generate", level: 1 })
        .waitFor();
      await waitFor(
        async () => ({ assetRequests, catalogRequests }),
        (requests) =>
          requests.assetRequests > assetRequestsBeforeRetry &&
          requests.catalogRequests > catalogRequestsBeforeRetry,
      );
      await page.close();
    }
  }, 30_000);

  it("keeps the last valid stage through provider failure, cancellation, restart, and rapid activation", async () => {
    const providerPage = await harness.newPage();
    const providerRunId = await startProviderRun(providerPage, harness);
    const validStage = await providerPage.getByLabel("Live Facet stage").innerText();
    expect(validStage).toContain("Last valid provider stage");
    const beforeOffline = await requestJson<RunEvidenceV1>(harness, `/api/runs/${providerRunId}`);

    await providerPage
      .locator("#generate-follow-up")
      .fill("Continue while the provider is offline");
    await providerPage.getByRole("button", { name: "Send follow-up through UI-IN" }).click();
    const afterOffline = await waitForEvidence(
      harness,
      providerRunId,
      ({ records, run }) =>
        records.length > beforeOffline.records.length && run.status === "failed",
    );
    expect(afterOffline.frames.filter(({ patches }) => patches.length > 0)).toEqual(
      beforeOffline.frames.filter(({ patches }) => patches.length > 0),
    );
    expect(afterOffline.finalTree).toEqual(beforeOffline.finalTree);
    expect(afterOffline.frames.at(-1)?.says.join(" ")).toContain("left it as it was");
    expect(await providerPage.getByLabel("Live Facet stage").innerText()).toContain(
      "Last valid provider stage",
    );
    expect(JSON.stringify(afterOffline.records)).not.toContain(SECRET_CANARY);

    await providerPage.close();

    const beforeRapid = await countRuns(harness);
    const rapidPage = await harness.newPage();
    await rapidPage.goto(`${harness.url}/generate`, { waitUntil: "networkidle" });
    await rapidPage.getByRole("button", { name: "Start new run" }).evaluate((button) => {
      if (button instanceof HTMLButtonElement) {
        button.click();
        button.click();
      }
    });
    const rapidStage = rapidPage.getByLabel("Live Facet stage");
    await rapidStage.waitFor();
    const rapidRunId = await rapidStage.getAttribute("data-run-id");
    if (rapidRunId === null) throw new Error("rapid run did not expose its run id");
    await waitFor(
      () => countRuns(harness),
      (count) => count === beforeRapid + 1,
    );
    await waitForEvidence(harness, rapidRunId, ({ frames }) => frames.length >= 1);
    await rapidPage.getByRole("button", { name: "Cancel run" }).click();
    await waitForEvidence(harness, rapidRunId, ({ run }) => run.status === "cancelled");
    await rapidPage.close();

    const restartPage = await harness.newPage();
    await restartPage.goto(`${harness.url}/generate`, { waitUntil: "networkidle" });
    await restartPage.getByRole("button", { name: "Start new run" }).click();
    const restartedStage = restartPage.getByLabel("Live Facet stage");
    await restartedStage.waitFor();
    const restartedRunId = await restartedStage.getAttribute("data-run-id");
    expect(restartedRunId).not.toBeNull();
    expect(restartedRunId).not.toBe(rapidRunId);
    if (restartedRunId === null) throw new Error("restart run did not expose its run id");
    await waitForEvidence(harness, restartedRunId, ({ frames }) => frames.length >= 1);
    await restartPage.getByRole("button", { name: "Cancel run" }).click();
    await waitForEvidence(harness, restartedRunId, ({ run }) => run.status === "cancelled");
    await restartPage.close();
  }, 90_000);

  it("rejects retired asset mutations, invalid bundles, trees, patches, stale writers, and hostile origins without changing trusted state", async () => {
    const defaultAssets = await requestJson<{
      readonly source: string;
      readonly digest: string;
    }>(harness, "/api/assets");
    expect(defaultAssets.source).toBe("default");
    for (const path of ["/api/assets/default", "/api/assets/import"] as const) {
      const response = await fetch(`${harness.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status, path).toBe(404);
    }
    expect(await requestJson(harness, "/api/assets")).toMatchObject(defaultAssets);

    const history = await requestJson<readonly RunEvidenceV1[]>(harness, "/api/runs?limit=100");
    const source = history[0];
    if (source === undefined) throw new Error("boundary journey expected a saved run");
    const sourceBefore = structuredClone(source.finalTree);
    const exported = await requestText(harness, `/api/runs/${source.run.runId}/export`);
    const bundlePath = join(harness.rootDirectory, "valid-run-bundle.json");
    const corruptBundlePath = join(harness.rootDirectory, "corrupt-run-bundle.json");
    await writeFile(bundlePath, exported);
    await writeFile(
      corruptBundlePath,
      exported.replace(/"digest":"[^"]+"/u, '"digest":"sha256:corrupt"'),
    );
    const runsPage = await harness.newPage();
    await runsPage.goto(`${harness.url}/runs`, { waitUntil: "networkidle" });
    await runsPage.locator("#run-import-file").setInputFiles(bundlePath);
    await runsPage.getByRole("button", { name: "Import run" }).click();
    await runsPage.getByText("Run bundle imported under a new local identity.").waitFor();
    const importedEvidence = await requestJson<readonly RunEvidenceV1[]>(
      harness,
      "/api/runs?limit=100",
    );
    const importedRun = importedEvidence.find(
      ({ run }) => run.importedFromRunId === source.run.runId,
    );
    expect(importedRun?.run.runId).not.toBe(source.run.runId);

    await runsPage.locator("#run-import-file").setInputFiles(corruptBundlePath);
    await runsPage.getByRole("button", { name: "Import run" }).click();
    await runsPage
      .getByText("Run import failed safely. Trusted history was not changed.")
      .waitFor();
    expect(await countRuns(harness)).toBe(history.length + 1);
    await runsPage.close();

    await writeFile(
      join(harness.dataDirectory, "00000000-0000-4000-8000-000000000000.json"),
      "{corrupt",
    );
    expect(await countRuns(harness)).toBe(history.length + 1);

    const sandboxPage = await harness.newPage();
    await sandboxPage.goto(`${harness.url}/sandbox`, { waitUntil: "networkidle" });
    await sandboxPage.getByRole("button", { name: "Create from safe tree" }).click();
    await sandboxPage.getByRole("heading", { name: "Last safe preview" }).waitFor();
    const sandboxPreview = sandboxPage.locator('section[aria-labelledby="sandbox-preview-title"]');
    expect(await sandboxPreview.getByText("Safe sandbox", { exact: true }).isVisible()).toBe(true);

    await sandboxPage
      .locator("#sandbox-patches")
      .fill('[{ "op": "replace", "path": "/nodes/message/value", "value": "Edited safely" }]');
    await sandboxPage.getByRole("button", { name: "Apply patches with revision check" }).click();
    expect(await sandboxPreview.getByText("Edited safely", { exact: true }).isVisible()).toBe(true);

    await sandboxPage.locator("#sandbox-expected-revision").fill("0");
    await sandboxPage.getByRole("button", { name: "Apply patches with revision check" }).click();
    await sandboxPage.getByRole("heading", { name: "Sandbox diagnostic" }).waitFor();
    expect(await sandboxPreview.getByText("Edited safely", { exact: true }).isVisible()).toBe(true);

    await sandboxPage.locator("#sandbox-tree").fill(
      JSON.stringify({
        root: "root",
        nodes: {
          root: {
            id: "root",
            type: "text",
            value: "<script>globalThis.compromised=true</script>",
            style: { backgroundImage: "url(https://evil.invalid)" },
          },
        },
      }),
    );
    await sandboxPage.getByRole("button", { name: "Create from safe tree" }).click();
    await sandboxPage.getByRole("heading", { name: "Sandbox diagnostic" }).waitFor();
    expect(await sandboxPreview.getByText("Edited safely", { exact: true }).isVisible()).toBe(true);
    expect(
      await sandboxPage.evaluate(() => Reflect.get(globalThis, "compromised")),
    ).toBeUndefined();

    await sandboxPage.locator("#sandbox-source-run").fill(source.run.runId);
    await sandboxPage.getByRole("button", { name: "Clone into sandbox" }).click();
    await waitFor(
      () => sandboxPage.locator("#sandbox-patches").isEnabled(),
      (enabled) => enabled,
    );
    const originalAfterClone = await requestJson<RunEvidenceV1>(
      harness,
      `/api/runs/${source.run.runId}`,
    );
    expect(originalAfterClone.finalTree).toEqual(sourceBefore);
    await sandboxPage.close();

    const hostile = await fetch(`${harness.url}/api/catalog`, {
      headers: { origin: "https://hostile.invalid" },
    });
    expect(hostile.status).toBe(403);
    expect(await hostile.text()).not.toContain(SECRET_CANARY);

    const invalidCases = await Promise.all([
      fetch(`${harness.url}/api/runs/not-a-run`),
      fetch(`${harness.url}/api/catalog?unknown=1`),
      fetch(`${harness.url}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
    ]);
    expect(invalidCases.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(harness.pageErrors).toEqual([]);
  }, 90_000);

  it("keeps provider keys out of the built bundle, browser network, evidence, exports, and screenshot artifacts", async () => {
    const evidence = await requestJson<readonly RunEvidenceV1[]>(harness, "/api/runs?limit=100");
    const target = evidence.find(({ run }) => run.mode === "deterministic");
    if (target !== undefined) {
      const [evaluation, capture] = await Promise.all([
        postJson<{ readonly accepted: boolean }>(
          harness,
          `/api/runs/${target.run.runId}/evaluations`,
          { kind: "recalculate" },
        ),
        postJson<{ readonly outcomes: readonly { readonly status: string }[] }>(
          harness,
          `/api/runs/${target.run.runId}/captures`,
          {},
        ),
      ]);
      expect(evaluation.accepted).toBe(true);
      expect(capture.outcomes).toHaveLength(6);
      const merged = await waitForEvidence(
        harness,
        target.run.runId,
        ({ checks, artifacts }) => checks.length > 0 && artifacts.length === 6,
      );
      expect(merged.run.status).toBe(target.run.status);
    }
    await harness.flushNetwork();
    expect(await scanBuiltBundleForCanary(SECRET_CANARY)).toEqual([]);
    expect(scanNetworkForCanary(harness.network, SECRET_CANARY)).toEqual([]);
    expect(await scanFilesForCanary(harness.dataDirectory, SECRET_CANARY)).toEqual([]);
    expect(await scanFilesForCanary(harness.rootDirectory, SECRET_CANARY)).toEqual([]);
    expect(JSON.stringify(evidence)).not.toContain(SECRET_CANARY);
  }, 60_000);

  it("rejects active-run enrichment and keeps concurrent cancellation idempotent", async () => {
    const capabilities = await requestJson<{
      readonly deterministic: { readonly provider: "openai"; readonly defaultModel: string };
    }>(harness, "/api/capabilities");
    const configuration = {
      mode: "deterministic",
      provider: capabilities.deterministic.provider,
      model: capabilities.deterministic.defaultModel,
      scenarioId: "landing-marketing",
      prompt: "Keep this run active until cancellation.",
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
    } as const;
    const created = await postJson<{ readonly runId: string }>(harness, "/api/runs", configuration);

    const [evaluation, capture] = await Promise.all([
      postJson<{ readonly accepted: boolean; readonly reason: string }>(
        harness,
        `/api/runs/${created.runId}/evaluations`,
        { kind: "recalculate" },
      ),
      postJson<{ readonly accepted: boolean; readonly reason: string }>(
        harness,
        `/api/runs/${created.runId}/captures`,
        {},
      ),
    ]);
    expect(evaluation).toMatchObject({ accepted: false, reason: "run-active" });
    expect(capture).toMatchObject({ accepted: false, reason: "run-active" });

    const cancellations = await Promise.all([
      postJson<{ readonly ok: boolean; readonly changed: boolean }>(
        harness,
        `/api/runs/${created.runId}/cancel`,
        {},
      ),
      postJson<{ readonly ok: boolean; readonly changed: boolean }>(
        harness,
        `/api/runs/${created.runId}/cancel`,
        {},
      ),
    ]);
    expect(cancellations.every(({ ok }) => ok)).toBe(true);
    expect(cancellations.map(({ changed }) => changed).sort()).toEqual([false, true]);

    for (let index = 0; index <= 100; index += 1) {
      const extra = await postJson<{ readonly runId: string }>(harness, "/api/runs", {
        ...configuration,
        prompt: `Evict bounded cancel tombstone ${String(index)}.`,
      });
      const cancelled = await postJson<{ readonly ok: boolean }>(
        harness,
        `/api/runs/${extra.runId}/cancel`,
        {},
      );
      expect(cancelled.ok).toBe(true);
    }
    const afterTombstoneEviction = await postJson<{
      readonly ok: boolean;
      readonly changed: boolean;
    }>(harness, `/api/runs/${created.runId}/cancel`, {});
    expect(afterTombstoneEviction).toEqual(expect.objectContaining({ ok: true, changed: false }));
  }, 60_000);
});
