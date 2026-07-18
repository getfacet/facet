import AxeBuilder from "@axe-core/playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";

import { bootLabHarness, runDeterministicJourney, type LabHarness } from "./lab-harness.js";

async function expectNoBlockingAxeViolations(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter(
    ({ impact }) => impact === "critical" || impact === "serious",
  );
  expect(
    blocking.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.flatMap(({ target }) => target),
    })),
    label,
  ).toEqual([]);
}

describe("Facet Lab accessible inspection controls", () => {
  let harness: LabHarness;
  let firstRunId: string;

  beforeAll(async () => {
    harness = await bootLabHarness();
    const firstPage = await harness.newPage();
    const first = await runDeterministicJourney(harness, firstPage, {
      scenarioId: "landing-marketing",
    });
    firstRunId = first.runId;
    await firstPage.close();
    const secondPage = await harness.newPage();
    await runDeterministicJourney(harness, secondPage, {
      scenarioId: "documentation-content",
    });
    await secondPage.close();
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("supports skip, named-area, catalog, trace, replay, compare, and sandbox keyboard paths", async () => {
    const page = await harness.newPage();
    await page.goto(`${harness.url}/catalog`, { waitUntil: "networkidle" });

    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(
      "Skip to workbench content",
    );
    await page.keyboard.press("Enter");
    expect(
      await page.locator("#lab-main").evaluate((element) => element === document.activeElement),
    ).toBe(true);

    const catalogArea = page.getByRole("link", { name: /Catalog Inspect/u });
    await catalogArea.focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain("Generate");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/generate");
    expect(
      await page.getByRole("heading", { name: "Generate", exact: true }).last().isVisible(),
    ).toBe(true);

    await page.goto(`${harness.url}/catalog`, { waitUntil: "networkidle" });
    const patterns = page.getByRole("button", { name: "Patterns (17/17)" });
    await patterns.focus();
    await page.keyboard.press("Enter");
    const firstPattern = page
      .locator('section[aria-labelledby="catalog-results-title"] li > button')
      .first();
    await firstPattern.focus();
    await page.keyboard.press("Enter");
    expect(await page.locator("[data-catalog-item]").isVisible()).toBe(true);

    await page.goto(`${harness.url}/runs/${firstRunId}`, { waitUntil: "networkidle" });
    const promptSummary = page.getByText("Inspect prompt");
    await promptSummary.focus();
    await page.keyboard.press("Enter");
    expect(
      await promptSummary.evaluate((element) => element.parentElement?.hasAttribute("open")),
    ).toBe(true);
    const traceSummary = page.locator('ol[aria-label="Run trace timeline"] summary').first();
    await traceSummary.focus();
    await page.keyboard.press("Enter");
    expect(
      await traceSummary.evaluate((element) => element.parentElement?.hasAttribute("open")),
    ).toBe(true);

    await page.goto(`${harness.url}/replay/${firstRunId}`, { waitUntil: "networkidle" });
    const scrubber = page.locator("#replay-scrubber");
    await scrubber.focus();
    const before = await scrubber.inputValue();
    await page.keyboard.press("ArrowLeft");
    expect(Number(await scrubber.inputValue())).toBeLessThan(Number(before));

    await page.goto(`${harness.url}/compare`, { waitUntil: "networkidle" });
    const comparison = page.getByLabel("Scrollable run comparison table");
    await comparison.focus();
    expect(await comparison.evaluate((element) => element === document.activeElement)).toBe(true);

    await page.goto(`${harness.url}/sandbox`, { waitUntil: "networkidle" });
    const create = page.getByRole("button", { name: "Create from safe tree" });
    await create.focus();
    await page.keyboard.press("Enter");
    expect(await page.getByRole("heading", { name: "Last safe preview" }).isVisible()).toBe(true);
    await page.close();
  }, 60_000);

  it("has no critical or serious axe violations across every official workbench view", async () => {
    const page = await harness.newPage();
    const paths = [
      "/catalog",
      "/generate",
      "/scenarios",
      "/runs",
      `/runs/${firstRunId}`,
      `/replay/${firstRunId}`,
      "/compare",
      "/sandbox",
      "/settings",
    ] as const;
    for (const path of paths) {
      await page.goto(`${harness.url}${path}`, { waitUntil: "networkidle" });
      await page.locator("#lab-main").waitFor();
      await expectNoBlockingAxeViolations(page, path);
    }
    expect(harness.pageErrors).toEqual([]);
    await page.close();
  }, 90_000);
});
