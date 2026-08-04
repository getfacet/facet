import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createStubAgent } from "@facet/reference-agent";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { screenPatterns } from "./page/screen-gallery-fixtures.js";
import { startQuickstart } from "./server.js";
import type { QuickstartServerOptions, RunningQuickstart } from "./server.js";

const execFileAsync = promisify(execFile);
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC_DIR, "../../../..");
const BUNDLE_PATH = join(REPO_ROOT, "packages/tools/quickstart/dist/page/app.js");
const RUN_VISUAL = process.env.FACET_QUICKSTART_VISUAL === "1";
const visualDescribe = RUN_VISUAL ? describe : describe.skip;

let browser: Browser | undefined;
let page: Page | undefined;
let running: RunningQuickstart | undefined;
let outputDir: string | undefined;

async function buildQuickstartPage(): Promise<void> {
  await execFileAsync("pnpm", ["--filter", "@facet/quickstart", "build"], {
    cwd: REPO_ROOT,
    timeout: 120_000,
  });
}

async function boot(overrides: Partial<QuickstartServerOptions> = {}): Promise<RunningQuickstart> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    try {
      return await startQuickstart({
        port,
        agentId: "quickstart-visual",
        agent: createStubAgent(),
        pageBundlePath: BUNDLE_PATH,
        ...overrides,
      });
    } catch {
      continue;
    }
  }
  throw new Error("could not boot startQuickstart on a free port");
}

function escapedRegExp(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");
}

function activePage(): Page {
  if (page === undefined) throw new Error("visual test page is not ready");
  return page;
}

function activeRunning(): RunningQuickstart {
  if (running === undefined) throw new Error("visual test server is not ready");
  return running;
}

function activeOutputDir(): string {
  if (outputDir === undefined) throw new Error("visual test output dir is not ready");
  return outputDir;
}

async function openAssets(): Promise<void> {
  const current = activePage();
  await current.goto(activeRunning().url, { waitUntil: "domcontentloaded" });
  await current.getByRole("button", { name: "Assets" }).click();
  await current.locator("[data-facet-asset-explorer]").waitFor();
  await current.locator('[data-facet-asset-tab="screens"]').click();
  await current.locator("[data-facet-screen-gallery]").waitFor();
}

async function viewportOverflow(): Promise<number> {
  return activePage().evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return scrollWidth - viewportWidth;
  });
}

async function visiblePreviewTextLength(): Promise<number> {
  return activePage()
    .locator("[data-facet-screen-preview-frame]")
    .evaluate((node) => {
      return (node.textContent ?? "").trim().length;
    });
}

async function navInsetIssues(): Promise<readonly string[]> {
  return activePage()
    .locator("[data-facet-screen-preview-frame] [data-facet-component='Nav']")
    .evaluateAll((navs) => {
      return navs.flatMap((nav, index) => {
        const rect = nav.getBoundingClientRect();
        const brand = nav.firstElementChild?.getBoundingClientRect();
        const actionRects = [...nav.querySelectorAll("button, [role='button']")]
          .map((node) => node.getBoundingClientRect())
          .filter((candidate) => candidate.width > 0 && candidate.height > 0);
        const rightmost = actionRects.reduce<DOMRect | undefined>(
          (best, candidate) =>
            best === undefined || candidate.right > best.right ? candidate : best,
          undefined,
        );
        if (brand === undefined || rightmost === undefined) {
          return [];
        }

        const leftInset = brand.left - rect.left;
        const rightInset = rect.right - rightmost.right;
        const delta = Math.abs(leftInset - rightInset);
        if (leftInset < 28 || rightInset < 28 || delta > 4) {
          return [
            `nav ${index}: left ${leftInset.toFixed(1)}, right ${rightInset.toFixed(1)}, delta ${delta.toFixed(1)}`,
          ];
        }
        return [];
      });
    });
}

async function sameRowHeightDrifts(component: "Card" | "VisualPanel"): Promise<readonly number[]> {
  return activePage()
    .locator("[data-facet-screen-preview-frame] [data-facet-component='Grid']")
    .evaluateAll((grids, component) => {
      const drifts: number[] = [];
      for (const grid of grids) {
        const rects = [...grid.querySelectorAll(`[data-facet-component='${component}']`)]
          .filter((node) => node.closest("[data-facet-component='Grid']") === grid)
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({ top: rect.top, height: rect.height }))
          .sort((a, b) => a.top - b.top);
        const rows: { top: number; heights: number[] }[] = [];
        for (const rect of rects) {
          const row = rows.find((candidate) => Math.abs(candidate.top - rect.top) <= 4);
          if (row === undefined) {
            rows.push({ top: rect.top, heights: [rect.height] });
          } else {
            row.heights.push(rect.height);
          }
        }
        drifts.push(
          ...rows
            .filter((row) => row.heights.length > 1)
            .map((row) => Math.max(...row.heights) - Math.min(...row.heights)),
        );
      }
      return drifts;
    }, component);
}

async function galleryPanelHeightDrifts(): Promise<readonly number[]> {
  return activePage()
    .locator("[data-facet-screen-preview-frame] [data-facet-component='Gallery']")
    .evaluateAll((galleries) => {
      const drifts: number[] = [];
      for (const gallery of galleries) {
        const rects = [...gallery.querySelectorAll("[data-facet-component='VisualPanel']")]
          .filter((node) => node.closest("[data-facet-component='Gallery']") === gallery)
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({ top: rect.top, height: rect.height }))
          .sort((a, b) => a.top - b.top);
        const rows: { top: number; heights: number[] }[] = [];
        for (const rect of rects) {
          const row = rows.find((candidate) => Math.abs(candidate.top - rect.top) <= 4);
          if (row === undefined) {
            rows.push({ top: rect.top, heights: [rect.height] });
          } else {
            row.heights.push(rect.height);
          }
        }
        drifts.push(
          ...rows
            .filter((row) => row.heights.length > 1)
            .map((row) => Math.max(...row.heights) - Math.min(...row.heights)),
        );
      }
      return drifts;
    });
}

visualDescribe("quickstart visual assets gallery", () => {
  beforeAll(async () => {
    outputDir = await mkdtemp(join(tmpdir(), "facet-quickstart-visual-"));
    await buildQuickstartPage();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    running = await boot();
  }, 180_000);

  afterAll(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await running?.close().catch(() => undefined);
  }, 30_000);

  it("renders every service surface example without blank or overflow", async () => {
    await openAssets();

    for (const example of screenPatterns()) {
      await activePage()
        .getByRole("button", { name: escapedRegExp(example.label) })
        .click();
      await activePage()
        .locator("[data-facet-screen-preview-frame] [data-facet-component='Screen']")
        .waitFor();

      expect(await visiblePreviewTextLength(), example.id).toBeGreaterThan(80);
      expect(await viewportOverflow(), example.id).toBeLessThanOrEqual(2);
      expect(await navInsetIssues(), example.id).toEqual([]);
      const drifts = [
        ...(await sameRowHeightDrifts("Card")),
        ...(await sameRowHeightDrifts("VisualPanel")),
        ...(await galleryPanelHeightDrifts()),
      ];
      expect(
        drifts.filter((drift) => drift > 6),
        example.id,
      ).toEqual([]);

      await activePage().screenshot({
        path: join(activeOutputDir(), `${example.id}.png`),
        fullPage: true,
      });
    }
  }, 180_000);
});
