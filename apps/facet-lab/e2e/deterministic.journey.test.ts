import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright";

import {
  bootLabHarness,
  normalizeEvidence,
  requestJson,
  runDeterministicJourney,
  waitForEvidence,
  type LabHarness,
} from "./lab-harness.js";
import { REFERENCE_BENCHMARK_IDS } from "../src/scenarios/reference-benchmarks.js";

interface CaptureResponse {
  readonly persisted: boolean;
  readonly outcomes: readonly {
    readonly condition: { readonly id: string };
    readonly status: "available" | "unavailable" | "failed";
    readonly artifactId: string | null;
  }[];
}

function postJson<T>(harness: LabHarness, path: string, body: unknown): Promise<T> {
  return requestJson<T>(harness, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function appendVisual(harness: LabHarness, runId: string, record: unknown): Promise<void> {
  const response = await postJson<{ readonly accepted: boolean }>(
    harness,
    `/api/runs/${runId}/evaluations`,
    { kind: "advisory", record },
  );
  expect(response.accepted).toBe(true);
}

async function inspectEveryItem(page: Page, category: string, total: number): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${category} \\(`, "u") }).click();
  const items = page.locator('section[aria-labelledby="catalog-results-title"] li > button');
  await expect.poll(() => items.count()).toBe(total);
  for (let index = 0; index < total; index += 1) {
    await items.nth(index).click();
    await visible(page.locator("[data-catalog-item]"));
    expect(await page.locator("[data-catalog-item]").getAttribute("data-catalog-item")).toMatch(
      /.+/u,
    );
  }
}

async function visible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible" });
  expect(await locator.isVisible()).toBe(true);
}

describe("Facet Lab deterministic built-bundle journey", () => {
  let harness: LabHarness;

  beforeAll(async () => {
    harness = await bootLabHarness({ screenshotMode: "real" });
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("shows reference benchmark previews without turning them into official scenario runs", async () => {
    const scenarioPage = await harness.newPage();
    await scenarioPage.goto(`${harness.url}/scenarios`, { waitUntil: "networkidle" });

    await visible(scenarioPage.getByRole("heading", { name: "Reference benchmarks" }));
    expect(
      await scenarioPage.getByLabel("Official scenario catalog").locator("article").count(),
    ).toBe(8);
    expect(
      await scenarioPage.getByLabel("Reference benchmark catalog").locator("button").count(),
    ).toBe(REFERENCE_BENCHMARK_IDS.length);

    await scenarioPage.getByRole("button", { name: /Commerce product and checkout/u }).click();
    await visible(scenarioPage.locator("[data-reference-benchmark='commerce-product-checkout']"));
    await visible(scenarioPage.getByLabel(/Commerce product and checkout benchmark preview/u));
    await scenarioPage.locator("#reference-benchmark-viewport").selectOption("mobile");
    await scenarioPage.locator("#reference-benchmark-color").selectOption("dark");
    await visible(scenarioPage.locator("[data-reference-preview-viewport='mobile']"));
    await visible(scenarioPage.locator("[data-reference-preview-color-mode='dark']"));
    expect(await scenarioPage.locator("#generate-scenario").innerText()).not.toContain(
      "Commerce product and checkout",
    );
    await scenarioPage.close();
  }, 120_000);

  it("accounts for package assets and runs the same live path twice through replay, compare, capture, and hybrid evaluation", async () => {
    const catalogPage = await harness.newPage();
    await catalogPage.goto(`${harness.url}/catalog`, { waitUntil: "networkidle" });
    await visible(catalogPage.getByRole("heading", { name: "Catalog", exact: true }).last());
    await visible(catalogPage.getByRole("button", { name: "Bricks (11/11)" }));
    await visible(catalogPage.getByRole("button", { name: "Presets (43/43)" }));
    await visible(catalogPage.getByRole("button", { name: "Patterns (17/17)" }));
    await inspectEveryItem(catalogPage, "Bricks", 11);
    await inspectEveryItem(catalogPage, "Presets", 43);
    await inspectEveryItem(catalogPage, "Patterns", 17);

    await catalogPage.getByRole("button", { name: /^Presets \(/u }).click();
    await catalogPage.getByRole("button", { name: /^Inspect Preset primaryAction$/u }).click();
    await visible(catalogPage.locator("[data-catalog-item='preset:box:primaryAction']"));
    await visible(catalogPage.locator(".catalog-preview-canvas [role='button']").first());
    await catalogPage
      .getByRole("button", { name: /^Inspect Preset badge$/u })
      .first()
      .click();
    await visible(catalogPage.locator("[data-catalog-item='preset:box:badge']"));
    await visible(catalogPage.locator(".catalog-preview-canvas [style*='width: fit-content']"));

    await catalogPage.getByRole("button", { name: /^Bricks \(/u }).click();
    await catalogPage.getByRole("button", { name: /^Inspect Brick chart$/u }).click();
    await visible(catalogPage.locator(".catalog-preview-canvas [data-facet-chart-axis='x']"));
    await visible(catalogPage.locator(".catalog-preview-canvas [data-facet-chart-legend='true']"));
    await catalogPage.getByRole("button", { name: /^Inspect Brick list$/u }).click();
    await visible(
      catalogPage.locator(".catalog-preview-canvas [data-facet-list-content='true']").first(),
    );
    await catalogPage.getByRole("button", { name: /^Inspect Brick progress$/u }).click();
    await visible(catalogPage.locator(".catalog-preview-canvas").getByText("62%"));

    await catalogPage.locator("#catalog-preview-viewport").selectOption("mobile");
    await catalogPage.locator("#catalog-preview-color").selectOption("dark");
    await visible(catalogPage.locator("[data-preview-viewport='mobile']"));
    await visible(catalogPage.locator("[data-preview-color-mode='dark']"));
    await catalogPage.close();

    const scenarioPage = await harness.newPage();
    await scenarioPage.goto(`${harness.url}/scenarios`, { waitUntil: "networkidle" });
    expect(
      await scenarioPage.getByLabel("Official scenario catalog").locator("article").count(),
    ).toBe(8);
    expect(await scenarioPage.locator("#scenario-constraint").innerText()).toContain("Brick");
    await scenarioPage.close();

    const firstPage = await harness.newPage();
    const first = await runDeterministicJourney(harness, firstPage, {
      scenarioId: "landing-marketing",
      constraint: "brick:text",
      viewport: "desktop",
      colorMode: "light",
    });
    expect(first.stageTexts).toHaveLength(3);
    expect(new Set(first.stageTexts).size).toBe(3);
    expect(first.evidence.frames.length).toBeGreaterThanOrEqual(3);
    const stageVersions = first.evidence.frames.map(({ stageVersion }) => stageVersion);
    expect(
      stageVersions.every(
        (version, index) => index === 0 || version >= (stageVersions[index - 1] ?? 0),
      ),
    ).toBe(true);
    expect(
      first.evidence.frames.filter(({ disposition }) => disposition === "applied").length,
    ).toBeGreaterThanOrEqual(3);
    expect(first.evidence.records.some(({ kind }) => kind === "ui-in")).toBe(true);
    expect(first.evidence.records.some(({ kind }) => kind === "diagnostic")).toBe(true);

    const firstEvaluation = await postJson<{ readonly accepted: boolean }>(
      harness,
      `/api/runs/${first.runId}/evaluations`,
      { kind: "recalculate" },
    );
    expect(firstEvaluation.accepted).toBe(true);
    const firstEvaluated = await waitForEvidence(
      harness,
      first.runId,
      ({ checks }) => checks.length > 0,
    );
    const blockingChecks = structuredClone(firstEvaluated.checks);
    expect(blockingChecks.filter(({ status }) => status !== "pass")).toEqual([]);

    const captured = await postJson<CaptureResponse>(
      harness,
      `/api/runs/${first.runId}/captures`,
      {},
    );
    expect(captured.persisted).toBe(true);
    expect(captured.outcomes).toHaveLength(6);
    expect(captured.outcomes.map(({ condition }) => condition.id)).toEqual([
      "mobile-light",
      "mobile-dark",
      "tablet-light",
      "tablet-dark",
      "desktop-light",
      "desktop-dark",
    ]);
    expect(
      captured.outcomes.every(
        ({ status, artifactId }) => status === "available" && artifactId !== null,
      ),
    ).toBe(true);

    const createdAt = new Date().toISOString();
    await appendVisual(harness, first.runId, {
      id: "vision-available",
      evaluator: "vision",
      status: "available",
      verdict: "pass",
      summary: "The six-condition matrix is visually coherent.",
      artifactIds: [],
      createdAt,
    });
    await appendVisual(harness, first.runId, {
      id: "vision-unavailable",
      evaluator: "vision",
      status: "unavailable",
      reason: "judge-unavailable",
      artifactIds: [],
      createdAt,
    });
    await appendVisual(harness, first.runId, {
      id: "vision-failed",
      evaluator: "vision",
      status: "failed",
      reason: "judge-failed",
      artifactIds: [],
      createdAt,
    });
    const visualEvidence = await waitForEvidence(
      harness,
      first.runId,
      ({ visualEvaluations }) => visualEvaluations.length === 3,
    );
    expect(visualEvidence.visualEvaluations.map(({ status }) => status)).toEqual([
      "available",
      "unavailable",
      "failed",
    ]);
    expect(visualEvidence.checks).toEqual(blockingChecks);
    expect(visualEvidence.artifacts).toHaveLength(6);
    await firstPage.close();

    const secondPage = await harness.newPage();
    const second = await runDeterministicJourney(harness, secondPage, {
      scenarioId: "landing-marketing",
      constraint: "brick:text",
      viewport: "desktop",
      colorMode: "light",
    });
    await postJson(harness, `/api/runs/${second.runId}/evaluations`, { kind: "recalculate" });
    const secondEvaluated = await waitForEvidence(
      harness,
      second.runId,
      ({ checks }) => checks.length > 0,
    );
    expect(normalizeEvidence(secondEvaluated)).toEqual(
      normalizeEvidence({
        ...firstEvaluated,
        checks: secondEvaluated.checks,
      }),
    );
    expect(secondEvaluated.finalTree).toEqual(firstEvaluated.finalTree);
    expect(
      secondEvaluated.frames.map(({ patches, disposition }) => ({ patches, disposition })),
    ).toEqual(firstEvaluated.frames.map(({ patches, disposition }) => ({ patches, disposition })));
    await secondPage.close();

    const replayPage = await harness.newPage();
    await replayPage.goto(`${harness.url}/replay/${first.runId}`, { waitUntil: "networkidle" });
    await visible(replayPage.getByRole("heading", { name: "Provider-free replay" }));
    await visible(replayPage.getByLabel(/Replay stage at checkpoint/u));
    await visible(replayPage.getByText("Final tree match: verified"));
    const replayScrubber = replayPage.locator("#replay-scrubber");
    const lastCheckpoint = Number(await replayScrubber.inputValue());
    await replayPage.getByRole("button", { name: "Previous checkpoint" }).click();
    expect(Number(await replayScrubber.inputValue())).toBe(lastCheckpoint - 1);
    await replayPage.close();

    const comparePage = await harness.newPage();
    await comparePage.goto(`${harness.url}/compare`, { waitUntil: "networkidle" });
    await visible(comparePage.getByRole("heading", { name: "Immutable run comparison" }));
    await visible(comparePage.locator("[data-comparison-columns='2']"));
    await visible(comparePage.getByLabel("Scrollable run comparison table"));
    await comparePage.close();

    expect(harness.pageErrors).toEqual([]);
  }, 180_000);
});
