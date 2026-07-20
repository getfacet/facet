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
    expect(
      await page.getByRole("heading", { name: "Catalog", exact: true, level: 1 }).count(),
    ).toBe(1);

    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(
      "Skip to workbench content",
    );
    await page.keyboard.press("Enter");
    expect(
      await page.locator("#lab-main").evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await page.evaluate(() => window.history.replaceState({}, "", "/catalog"));

    const catalogArea = page.getByRole("link", { name: "Catalog", exact: true });
    await catalogArea.focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain("Generate");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/generate");
    const generateHeading = page.getByRole("heading", {
      name: "Generate",
      exact: true,
      level: 1,
    });
    expect(await generateHeading.count()).toBe(1);
    expect(await generateHeading.isVisible()).toBe(true);
    expect(await page.getByText("Advanced asset settings").count()).toBe(0);

    await page.getByLabel("Prompt", { exact: true }).focus();
    await page.evaluate(() => window.history.back());
    await page.waitForURL((url) => url.pathname === "/catalog");
    expect(
      await page.locator("#lab-main").evaluate((element) => element === document.activeElement),
    ).toBe(true);

    await page.goto(`${harness.url}/catalog`, { waitUntil: "networkidle" });
    expect(await page.getByText("Advanced asset settings").count()).toBe(0);
    const patterns = page.getByRole("button", { name: "Patterns (17/17)" });
    await patterns.focus();
    await page.keyboard.press("Enter");
    const firstPattern = page
      .locator('section[aria-labelledby="catalog-results-title"] li > button')
      .first();
    await firstPattern.focus();
    await page.keyboard.press("Enter");
    expect(await page.locator("[data-catalog-item]").isVisible()).toBe(true);
    const previewTab = page.getByRole("tab", { name: "Preview" });
    await previewTab.focus();
    await page.keyboard.press("ArrowRight");
    const documentTab = page.getByRole("tab", { name: "Facet document" });
    expect(await documentTab.getAttribute("aria-selected")).toBe("true");
    expect(await page.getByLabel("Facet document JSON").isVisible()).toBe(true);
    await page.keyboard.press("End");
    expect(
      await page.getByRole("tab", { name: "Package definition" }).getAttribute("aria-selected"),
    ).toBe("true");
    await page.keyboard.press("Home");
    expect(await previewTab.getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("ArrowLeft");
    expect(
      await page.getByRole("tab", { name: "Package definition" }).getAttribute("aria-selected"),
    ).toBe("true");

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
