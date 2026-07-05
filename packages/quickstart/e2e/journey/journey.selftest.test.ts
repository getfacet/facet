/**
 * WU-3 (Decision C) self-test — the headless-stub red_check for the fixed
 * Playwright journey. Runs ONLY under the e2e vitest config (the root glob never
 * touches `e2e/`), no key, no network beyond the local stub server.
 *
 * The stub does NOT respond to arbitrary chat like a real LLM, but it DOES
 * append/update an `echo:` text node in the STAGE on each message — so this
 * asserts MECHANICS that hold under the stub, NOT LLM-driven content (that is
 * WU-4's real-tier + vision-judge job):
 * - `runJourney` captures ≥4 screenshots (files exist, non-empty).
 * - `settleDom` RUNS within its bounded timeout and NEVER throws for every
 *   post-action step (returns `{changed, timedOut}` booleans).
 * - the chat steps CHANGED the stage (the stub's echo node) — this exercises the
 *   stage-scoped, change-gated settle (a ChatDock-only change would NOT count).
 * - the click step dispatched (the stub's submit press `say`s to the dock, so its
 *   stage effect is not asserted here — real-LLM click effects are WU-4's job).
 * - `runJourney({ fixture: 'broken' })` captures the broken page WITHOUT throwing.
 *
 * Needs (shared preflight): `pnpm install` (playwright devDep) +
 * `pnpm exec playwright install chromium` + `pnpm --filter @facet/quickstart
 * build` (the journey loads the REAL `dist/page/app.js`).
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { createStubAgent, type RunningQuickstart } from "../../src/index.js";
import { bootJourney } from "./harness.js";
import { runJourney, settleDom } from "./journey.js";

describe("journey self-test (stub, headless chromium)", () => {
  let running: RunningQuickstart;
  let browser: Browser;
  const outDirs: string[] = [];

  beforeAll(async () => {
    running = await bootJourney({ agent: createStubAgent(), agentId: "journey-selftest" });
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await running?.close();
    for (const dir of outDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** A fresh temp screenshot dir, cleaned up in `afterAll`. */
  async function freshOut(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "facet-journey-"));
    outDirs.push(dir);
    return dir;
  }

  it("runs the fixed journey against the stub and captures at least four screenshots", async () => {
    const outDir = await freshOut();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      // Short bounded settle: the stub renders/echoes instantly, so a real change
      // is seen in well under a second; the small timeout keeps the stub click
      // step (which only `say`s, no stage change) from waiting the full default.
      const result = await runJourney(page, {
        url: running.url,
        outDir,
        settle: { timeoutMs: 5000, quietMs: 300 },
      });

      // ≥4 screenshots, every file present + non-empty (no secrets: the page
      // never renders the key; the stub needs none).
      expect(result.screenshots.length).toBeGreaterThanOrEqual(4);
      for (const shot of result.screenshots) {
        const info = await stat(shot);
        expect(info.size).toBeGreaterThan(0);
      }

      // Every post-action step ran a bounded settle that never threw (steps 2-4).
      const settled = result.steps.filter((step) => step.settle !== undefined);
      expect(settled.length).toBeGreaterThanOrEqual(3);
      for (const step of settled) {
        expect(typeof step.settle?.changed).toBe("boolean");
        expect(typeof step.settle?.timedOut).toBe("boolean");
      }

      // The chat steps CHANGED the stage (the stub appends/updates its echo node
      // in the stage root). Paired with the dock-only click case below, this
      // shows the change-gated settle tracks STAGE edits specifically.
      const chatSteps = result.steps.filter(
        (s) => s.label === "add-section" || s.label === "restyle",
      );
      expect(chatSteps.length).toBe(2);
      for (const step of chatSteps) expect(step.settle?.changed).toBe(true);

      // The click step dispatched. The stub's submit press only `say`s to the
      // ChatDock (no stage-root node), so the STAGE does NOT change: with the
      // [data-facet-stage]-scoped fingerprint `changed` is FALSE. This is the
      // DISCRIMINATING test for the marker — if domFingerprint regressed to the
      // #root fallback, the dock `say` would flip `changed` to true and fail here.
      const click = result.steps[result.steps.length - 1];
      expect(click?.clicked).toBe(true);
      expect(click?.settle?.changed).toBe(false);
    } finally {
      await context.close();
    }
  });

  it("captures the broken fixture as a shot without throwing", async () => {
    const outDir = await freshOut();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const result = await runJourney(page, { fixture: "broken", outDir });
      expect(result.fixture).toBe("broken");
      expect(result.screenshots.length).toBeGreaterThanOrEqual(1);
      const info = await stat(result.screenshots[0] ?? "");
      expect(info.size).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  it("settleDom returns a bounded {changed,timedOut} result and never throws", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(running.url, { waitUntil: "domcontentloaded" });
      const result = await settleDom(page, { quietMs: 200, timeoutMs: 3000, pollMs: 50 });
      expect(typeof result.changed).toBe("boolean");
      expect(typeof result.timedOut).toBe("boolean");
    } finally {
      await context.close();
    }
  });
});
