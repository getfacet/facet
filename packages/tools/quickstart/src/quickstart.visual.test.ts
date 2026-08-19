import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createStubAgent } from "@facet/reference-agent";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildQuickstartDesignPageBundle } from "./design-page-bundle.js";
import { resolveQuickstartDesignOverlay } from "./design-overlay.js";
import type { QuickstartDesignOverlay } from "./design-overlay.js";
import { screenPatterns } from "./page/screen-gallery-fixtures.js";
import { startQuickstart } from "./server.js";
import type { QuickstartServerOptions, RunningQuickstart } from "./server.js";

const execFileAsync = promisify(execFile);
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC_DIR, "../../../..");
const BUNDLE_PATH = join(REPO_ROOT, "packages/tools/quickstart/dist/page/app.js");
const PAGE_MAIN_BUNDLE_PATH = join(REPO_ROOT, "packages/tools/quickstart/dist/page/main.js");
const DESIGN_OVERLAY_TYPE_IMPORT = join(SRC_DIR, "design-overlay.js").replaceAll(sep, "/");
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

function VisualPromoBanner(): null {
  return null;
}

const ACTIVE_VISUAL_OVERLAY: QuickstartDesignOverlay = Object.freeze({
  theme: Object.freeze({
    foundation: Object.freeze({
      palette: Object.freeze({
        brand500: "#6741d9",
      }),
    }),
  }),
  components: Object.freeze([
    Object.freeze({
      tag: "PromoBanner",
      whenToUse: "Use for an active design visual promo.",
      props: Object.freeze({}),
      content: { mode: "none" as const },
    }),
  ]),
  registry: Object.freeze({ PromoBanner: VisualPromoBanner }),
  examples: Object.freeze([
    Object.freeze({
      id: "visual-promo-screen",
      kind: "screen",
      label: "Visual promo screen",
      description: "Active visual design screen example.",
      tags: Object.freeze(["Screen", "PromoBanner"]),
      markup: `<Facet entry="preview">
  <Screen name="preview">
    <PromoBanner />
  </Screen>
</Facet>`,
    }),
  ]),
  notes: Object.freeze([
    Object.freeze({
      id: "visual-overlay",
      title: "Visual overlay",
      body: "The visual Assets tab is using the active design module.",
    }),
  ]),
});

async function makeActiveDesignVisualBundle() {
  const root = await mkdtemp(join(tmpdir(), "facet-quickstart-active-design-"));
  const overlayPath = join(root, "facet-design.tsx");
  await writeFile(
    overlayPath,
    [
      `import type { QuickstartDesignOverlay } from "${DESIGN_OVERLAY_TYPE_IMPORT}";`,
      "",
      "function PromoBanner() {",
      '  return <section data-facet-visual-promo="PromoBanner">Visual overlay promo</section>;',
      "}",
      "",
      "export default {",
      "  theme: {",
      "    foundation: {",
      "      palette: {",
      '        brand500: "#6741d9",',
      "      },",
      "    },",
      "  },",
      "  components: [",
      "    {",
      '      tag: "PromoBanner",',
      '      whenToUse: "Use for an active design visual promo.",',
      "      props: {},",
      '      content: { mode: "none" },',
      "    },",
      "  ],",
      "  registry: { PromoBanner },",
      "  examples: [",
      "    {",
      '      id: "visual-promo-screen",',
      '      kind: "screen",',
      '      label: "Visual promo screen",',
      '      description: "Active visual design screen example.",',
      '      tags: ["Screen", "PromoBanner"],',
      '      markup: `<Facet entry="preview">',
      '  <Screen name="preview">',
      "    <PromoBanner />",
      "  </Screen>",
      "</Facet>`,",
      "    },",
      "  ],",
      "  notes: [",
      "    {",
      '      id: "visual-overlay",',
      '      title: "Visual overlay",',
      '      body: "The visual Assets tab is using the active design module.",',
      "    },",
      "  ],",
      "} satisfies QuickstartDesignOverlay;",
      "",
    ].join("\n"),
    "utf8",
  );
  const resolved = resolveQuickstartDesignOverlay(ACTIVE_VISUAL_OVERLAY);
  if (!resolved.ok) {
    await rm(root, { force: true, recursive: true });
    throw new Error(`${resolved.error.code}: ${resolved.error.detail}`);
  }
  const bundle = await buildQuickstartDesignPageBundle({
    overlayModulePath: overlayPath,
    pageMountModulePath: PAGE_MAIN_BUNDLE_PATH,
    temporaryParentDirectory: join(root, "bundles"),
    resolvedDesign: resolved.design,
  });
  return Object.freeze({
    design: resolved.design,
    bundle,
    async cleanup(): Promise<void> {
      await bundle.cleanup();
      await rm(root, { force: true, recursive: true });
    },
  });
}

async function openAssets(): Promise<void> {
  await openAssetsAt(activeRunning());
}

async function openAssetsAt(target: RunningQuickstart): Promise<void> {
  const current = activePage();
  await current.goto(target.url, { waitUntil: "domcontentloaded" });
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

async function navigationInsetIssues(): Promise<readonly string[]> {
  return activePage()
    .locator("[data-facet-screen-preview-frame] [data-facet-component='Navigation']")
    .evaluateAll((navs) => {
      return navs.flatMap((nav, index) => {
        if (nav.getAttribute("data-facet-navigation-orientation") === "vertical") {
          return [];
        }
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

async function sameRowHeightDrifts(component: "Card" | "ItemCard"): Promise<readonly number[]> {
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

async function collectionItemHeightDrifts(): Promise<readonly number[]> {
  return activePage()
    .locator("[data-facet-screen-preview-frame] [data-facet-component='Collection']")
    .evaluateAll((collections) => {
      const drifts: number[] = [];
      for (const collection of collections) {
        const rects = [...collection.querySelectorAll("[data-facet-component='ItemCard']")]
          .filter((node) => node.closest("[data-facet-component='Collection']") === collection)
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

    for (const viewport of [
      { id: "desktop", width: 1440, height: 960 },
      { id: "mobile", width: 390, height: 844 },
    ] as const) {
      await activePage().setViewportSize(viewport);
      for (const example of screenPatterns()) {
        const caseId = `${example.id}-${viewport.id}`;
        await activePage()
          .getByRole("button", { name: escapedRegExp(example.label) })
          .click();
        await activePage()
          .locator("[data-facet-screen-preview-frame] [data-facet-component='Screen']")
          .waitFor();

        expect(await visiblePreviewTextLength(), caseId).toBeGreaterThan(80);
        expect(await viewportOverflow(), caseId).toBeLessThanOrEqual(2);
        if (viewport.id === "desktop") {
          expect(await navigationInsetIssues(), caseId).toEqual([]);
        }
        const drifts = [
          ...(await sameRowHeightDrifts("Card")),
          ...(await sameRowHeightDrifts("ItemCard")),
          ...(await collectionItemHeightDrifts()),
        ];
        expect(
          drifts.filter((drift) => drift > 6),
          caseId,
        ).toEqual([]);

        await activePage().screenshot({
          path: join(activeOutputDir(), `${caseId}.png`),
          fullPage: true,
        });
      }
    }
  }, 180_000);

  it("captures the active design Assets tab", async () => {
    const fixture = await makeActiveDesignVisualBundle();
    const customRunning = await boot({
      catalog: fixture.design.catalog,
      pageBundlePath: fixture.bundle.bundlePath,
      theme: fixture.design.theme,
      themeExtensions: fixture.design.themeExtensions,
    });

    try {
      await openAssetsAt(customRunning);

      expect(await activePage().locator("[data-facet-active-design-mode]").textContent()).toBe(
        "Custom design",
      );
      expect(
        await activePage().locator("[data-facet-active-design-custom-tags]").textContent(),
      ).toContain("PromoBanner");
      await activePage().locator('[data-screen-pattern-option="visual-promo-screen"]').waitFor();

      await activePage().locator('[data-facet-asset-tab="components"]').click();
      await activePage().locator('[data-component-option="PromoBanner"]').waitFor();

      await activePage().screenshot({
        path: join(activeOutputDir(), "active-design-assets.png"),
        fullPage: true,
      });
    } finally {
      await customRunning.close().catch(() => undefined);
      await fixture.cleanup();
    }
  }, 180_000);
});
