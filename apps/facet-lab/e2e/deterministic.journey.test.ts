import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

/**
 * DC-009a real-viewport evidence: the five named benchmark structures, each captured at a REAL
 * 390x844 mobile viewport (not the CSS-width preview canvas — RISK-INV-7) and a 1440x900 desktop
 * viewport, with element-level horizontal-containment probes measured on the CONTAINING box.
 */
// `paneScrolls` marks the collapse structures whose bounded viewport pane demonstrably overflows at
// 1440x900. The AMA2 messages inbox is dense enough to prove real internal scrolling; the Supabase
// table editor faithfully renders an EMPTY data grid (matching the reference), so its pane content
// fits inside the 100svh cap and does not overflow — the pane-not-page invariant (overflow-y:auto
// on the pane + a contained, non-scrolling canvas) is still asserted for both.
const FIVE_STRUCTURES = [
  {
    id: "supabase-table-editor",
    name: "Supabase table editor",
    structure: "collapse",
    paneScrolls: false,
  },
  { id: "ama2-public-landing", name: "AMA2 public landing", structure: "grid", paneScrolls: false },
  { id: "ama2-messages-app", name: "AMA2 messages app", structure: "collapse", paneScrolls: true },
  {
    id: "coupang-product-listing",
    name: "Coupang product listing",
    structure: "grid",
    paneScrolls: false,
  },
  {
    id: "linktree-selena-gomez",
    name: "Linktree Selena Gomez",
    structure: "shelf",
    paneScrolls: false,
  },
] as const;

const EVIDENCE_VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1_440, height: 900 },
] as const;

interface OverflowProbe {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly contained: boolean;
}

interface PaneScrollProbe {
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly contained: boolean;
}

interface StructureProbe {
  readonly frame: OverflowProbe;
  readonly canvas: OverflowProbe;
  readonly document: OverflowProbe;
  readonly flexDirection: string | null;
  readonly gridDisplay: string | null;
  readonly gridTemplateColumns: string | null;
  readonly gridTrackCount: number | null;
  readonly overflowX: string | null;
  readonly shelfFirstChildFlexShrink: string | null;
  readonly paneOverflowY: string | null;
  readonly paneScrollHeight: number | null;
  readonly paneClientHeight: number | null;
  readonly canvasScrollHeight: number;
  readonly canvasClientHeight: number;
}

interface EvidenceRecord {
  readonly benchmarkId: string;
  readonly viewport: string;
  readonly file: string;
  readonly flexDirection?: string;
  readonly gridTemplateColumns?: string;
  readonly overflowX?: string;
  readonly layoutFrameOverflow: OverflowProbe;
  readonly layoutCanvasOverflow: OverflowProbe;
  readonly layoutDocumentOverflow: OverflowProbe;
  readonly layoutPaneScroll?: PaneScrollProbe;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Flushes two animation frames so a fresh setViewportSize has fully re-laid out before probing. */
async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Runs entirely in the browser: measures horizontal containment on the CONTAINING box
 * (`.catalog-preview-frame` + `.catalog-preview-canvas`), never on `document` alone, plus the
 * per-structure computed style. The `columns:"auto"` grid is tagged on the first (mobile) pass and
 * re-read on the desktop pass, since setViewportSize never re-mounts the persisted stage DOM.
 */
function probeStructure({ id, structure }: { id: string; structure: string }): StructureProbe {
  const frameEl = document.querySelector(
    `[data-reference-benchmark='${id}'] .catalog-preview-frame`,
  );
  const canvasEl = document.querySelector(
    `[data-reference-benchmark='${id}'] .catalog-preview-canvas`,
  );
  const scrollingEl = document.scrollingElement ?? document.documentElement;
  if (frameEl === null || canvasEl === null) {
    throw new Error(`Missing preview frame/canvas for benchmark ${id}`);
  }

  const overflow = (element: Element): OverflowProbe => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    contained: element.scrollWidth <= element.clientWidth,
  });

  const trackCount = (element: Element): number =>
    getComputedStyle(element)
      .gridTemplateColumns.trim()
      .split(/\s+/u)
      .filter((token) => token.length > 0 && token !== "none").length;

  let flexDirection: string | null = null;
  let paneOverflowY: string | null = null;
  let paneScrollHeight: number | null = null;
  let paneClientHeight: number | null = null;
  if (structure === "collapse") {
    const row = canvasEl.querySelector(".facet-collapse");
    flexDirection = row === null ? null : getComputedStyle(row).flexDirection;
    // The bounded viewport pane: grow + scroll:"vertical" + maxHeight:"screen" (100svh, ~viewport
    // height), distinguished from the private 20rem (~320px) SCROLL_MAX_HEIGHT default by its cap.
    const scrollers = [...canvasEl.querySelectorAll("*")].filter(
      (element) => getComputedStyle(element).overflowY === "auto",
    );
    let pane: Element | null = null;
    let paneCap = 640;
    for (const element of scrollers) {
      const cap = Number.parseFloat(getComputedStyle(element).maxHeight);
      if (Number.isFinite(cap) && cap > paneCap) {
        pane = element;
        paneCap = cap;
      }
    }
    if (pane !== null) {
      paneOverflowY = getComputedStyle(pane).overflowY;
      paneScrollHeight = pane.scrollHeight;
      paneClientHeight = pane.clientHeight;
    }
  }

  let gridDisplay: string | null = null;
  let gridTemplateColumns: string | null = null;
  let gridTrackCount: number | null = null;
  if (structure === "grid") {
    let gridEl = canvasEl.querySelector("[data-box-layout-auto-grid]");
    if (gridEl === null) {
      // The columns:"auto" box is a `box` brick; exclude the `list` brick's internal grid
      // (data-facet-list-content), which is also display:grid but is not this feature's auto grid.
      const grids = [...canvasEl.querySelectorAll("*")].filter(
        (element) =>
          getComputedStyle(element).display === "grid" &&
          element.closest("[data-facet-list-content]") === null,
      );
      gridEl = grids.find((element) => trackCount(element) === 1) ?? grids[0] ?? null;
      if (gridEl !== null) gridEl.setAttribute("data-box-layout-auto-grid", "1");
    }
    if (gridEl !== null) {
      const computed = getComputedStyle(gridEl);
      gridDisplay = computed.display;
      gridTemplateColumns = computed.gridTemplateColumns;
      gridTrackCount = trackCount(gridEl);
    }
  }

  let overflowX: string | null = null;
  let shelfFirstChildFlexShrink: string | null = null;
  if (structure === "shelf") {
    const scrollers = [...canvasEl.querySelectorAll("*")].filter(
      (element) => getComputedStyle(element).overflowX === "auto",
    );
    const shelf =
      scrollers.find((element) => {
        const child = element.firstElementChild;
        return child !== null && getComputedStyle(child).flexShrink === "0";
      }) ??
      scrollers[0] ??
      null;
    if (shelf !== null) {
      overflowX = getComputedStyle(shelf).overflowX;
      const child = shelf.firstElementChild;
      shelfFirstChildFlexShrink = child === null ? null : getComputedStyle(child).flexShrink;
    }
  }

  return {
    frame: overflow(frameEl),
    canvas: overflow(canvasEl),
    document: overflow(scrollingEl),
    flexDirection,
    gridDisplay,
    gridTemplateColumns,
    gridTrackCount,
    overflowX,
    shelfFirstChildFlexShrink,
    paneOverflowY,
    paneScrollHeight,
    paneClientHeight,
    canvasScrollHeight: canvasEl.scrollHeight,
    canvasClientHeight: canvasEl.clientHeight,
  };
}

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
    await scenarioPage.getByRole("button", { name: /Google Search Console performance/u }).click();
    await scenarioPage.locator("#reference-benchmark-viewport").selectOption("desktop");
    await scenarioPage.getByRole("button", { name: "Open visual comparison" }).click();
    await visible(scenarioPage.locator("[data-testid='reference-comparison']"));
    await visible(
      scenarioPage.locator("[data-reference-comparison-panel='reference'] img").first(),
    );
    await visible(scenarioPage.locator("[data-reference-comparison-facet-surface='true']"));
    expect(
      await scenarioPage.locator("[data-testid='reference-comparison'] .lab-topbar").count(),
    ).toBe(0);
    expect(
      await scenarioPage.locator("[data-testid='reference-comparison'] .lab-primary-nav").count(),
    ).toBe(0);
    await scenarioPage.locator("#reference-comparison-classification").selectOption("major-drift");
    await visible(scenarioPage.locator("[data-reference-comparison-classification='major-drift']"));
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
    await visible(catalogPage.getByRole("button", { name: "Presets (44/44)" }));
    await visible(catalogPage.getByRole("button", { name: "Patterns (21/21)" }));
    await inspectEveryItem(catalogPage, "Bricks", 11);
    await inspectEveryItem(catalogPage, "Presets", 44);
    await inspectEveryItem(catalogPage, "Patterns", 21);

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

  it("captures DC-009a real-viewport box-layout evidence across the five benchmark structures", async () => {
    // BOX_LAYOUT_EVIDENCE_DIR = harness.artifactDirectory, overridable via FACET_LAB_ARTIFACTS_DIR
    // (mirrors live-provider.journey.test.ts's artifact-writing precedent). DC-009b reviews files.
    const evidenceDir = process.env.FACET_LAB_ARTIFACTS_DIR?.trim() || harness.artifactDirectory;
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });

    const page = await harness.newPage();
    await page.goto(`${harness.url}/scenarios`, { waitUntil: "networkidle" });
    await visible(page.getByRole("heading", { name: "Reference benchmarks" }));

    const records: EvidenceRecord[] = [];
    const writtenFiles: string[] = [];

    for (const benchmark of FIVE_STRUCTURES) {
      await page
        .getByRole("button", { name: new RegExp(escapeRegExp(benchmark.name), "u") })
        .first()
        .click();
      const article = page.locator(`[data-reference-benchmark='${benchmark.id}']`);
      await visible(article);
      const frame = article.locator(".catalog-preview-frame");
      await visible(frame);

      for (const viewport of EVIDENCE_VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await settleLayout(page);
        const probe = await page.evaluate(probeStructure, {
          id: benchmark.id,
          structure: benchmark.structure,
        });

        // DC-004 / R4: horizontal containment measured on the CONTAINING box, never on document
        // alone — .catalog-preview-frame is itself overflow:auto, so a document probe is vacuous.
        expect(
          probe.frame.contained,
          `${benchmark.id} @${viewport.name} frame horizontal containment`,
        ).toBe(true);
        expect(
          probe.canvas.contained,
          `${benchmark.id} @${viewport.name} canvas horizontal containment`,
        ).toBe(true);
        // Secondary check only.
        expect(
          probe.document.contained,
          `${benchmark.id} @${viewport.name} document horizontal containment`,
        ).toBe(true);

        if (benchmark.structure === "collapse") {
          // DC-001 narrow half: the collapse:"stack" row stacks below the breakpoint (real @media).
          expect(
            probe.flexDirection,
            `${benchmark.id} @${viewport.name} collapse row flex-direction`,
          ).toBe(viewport.name === "mobile" ? "column" : "row");
        } else if (benchmark.structure === "grid") {
          // DC-003 / R4: columns:"auto" is a grid at both widths, clamped to a single track at 390
          // (min(itemWidth,100%)) and expanded to more than one track at desktop.
          expect(probe.gridDisplay, `${benchmark.id} @${viewport.name} auto grid display`).toBe(
            "grid",
          );
          if (viewport.name === "mobile") {
            expect(
              probe.gridTrackCount,
              `${benchmark.id} @mobile auto grid single-track clamp`,
            ).toBe(1);
          } else {
            expect(
              probe.gridTrackCount ?? 0,
              `${benchmark.id} @desktop auto grid multi-track`,
            ).toBeGreaterThan(1);
          }
        } else {
          // DC-004: the shelf row scrolls horizontally and its first child holds its intrinsic
          // width (flex-shrink:0) at both widths.
          expect(probe.overflowX, `${benchmark.id} @${viewport.name} shelf overflow-x`).toBe(
            "auto",
          );
          expect(
            probe.shelfFirstChildFlexShrink,
            `${benchmark.id} @${viewport.name} shelf first-child flex-shrink`,
          ).toBe("0");
        }

        let paneScroll: PaneScrollProbe | undefined;
        if (benchmark.structure === "collapse" && viewport.name === "desktop") {
          // DC-002 pane-not-page (real geometry, not emitted strings): the bounded viewport pane
          // (grow + scroll:"vertical" + maxHeight:"screen") is the scroll container, and its
          // .catalog-preview-canvas ancestor does NOT scroll (the pane, not the page).
          expect(
            probe.paneOverflowY,
            `${benchmark.id} @desktop pane is the scroll container (overflow-y:auto)`,
          ).toBe("auto");
          expect(
            probe.canvasScrollHeight,
            `${benchmark.id} @desktop canvas does not scroll (pane-not-page)`,
          ).toBeLessThanOrEqual(probe.canvasClientHeight);
          if (benchmark.paneScrolls) {
            // Dense inbox content overflows the 100svh cap, proving real internal scrolling.
            expect(
              probe.paneScrollHeight ?? 0,
              `${benchmark.id} @desktop pane scrolls its overflow internally`,
            ).toBeGreaterThan(probe.paneClientHeight ?? 0);
          }
          paneScroll = {
            scrollHeight: probe.paneScrollHeight ?? 0,
            clientHeight: probe.paneClientHeight ?? 0,
            contained: probe.canvasScrollHeight <= probe.canvasClientHeight,
          };
        }

        const file = `box-layout-${benchmark.id}-${viewport.name}.png`;
        await frame.screenshot({ path: join(evidenceDir, file) });
        writtenFiles.push(file);

        records.push({
          benchmarkId: benchmark.id,
          viewport: viewport.name,
          file,
          ...(benchmark.structure === "collapse" && probe.flexDirection !== null
            ? { flexDirection: probe.flexDirection }
            : {}),
          ...(benchmark.structure === "grid" && probe.gridTemplateColumns !== null
            ? { gridTemplateColumns: probe.gridTemplateColumns }
            : {}),
          ...(benchmark.structure === "shelf" && probe.overflowX !== null
            ? { overflowX: probe.overflowX }
            : {}),
          layoutFrameOverflow: probe.frame,
          layoutCanvasOverflow: probe.canvas,
          layoutDocumentOverflow: probe.document,
          ...(paneScroll === undefined ? {} : { layoutPaneScroll: paneScroll }),
        });
      }
    }

    // Concrete DC-009a/DC-009b bundle: exactly five ids x two viewports, 10 screenshots + manifest.
    await writeFile(
      join(evidenceDir, "box-layout-evidence.json"),
      `${JSON.stringify(records, null, 2)}\n`,
    );

    expect(records).toHaveLength(FIVE_STRUCTURES.length * EVIDENCE_VIEWPORTS.length);
    expect(new Set(records.map(({ benchmarkId }) => benchmarkId)).size).toBe(
      FIVE_STRUCTURES.length,
    );
    for (const benchmark of FIVE_STRUCTURES) {
      expect(
        records
          .filter(({ benchmarkId }) => benchmarkId === benchmark.id)
          .map(({ viewport }) => viewport),
      ).toEqual(["mobile", "desktop"]);
    }

    expect(writtenFiles).toHaveLength(10);
    for (const file of writtenFiles) {
      expect(await fileExists(join(evidenceDir, file)), `${file} written`).toBe(true);
    }
    expect(
      await fileExists(join(evidenceDir, "box-layout-evidence.json")),
      "box-layout-evidence.json written",
    ).toBe(true);

    expect(harness.pageErrors).toEqual([]);
    await page.close();
  }, 180_000);
});
