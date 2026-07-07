/**
 * The /live-test e2e config (spec Decision 7) — Tier 1b (real-bundle jsdom
 * execution) and Tier 2/3 (key-gated provider smoke) run ONLY through this
 * config. The root vitest glob only includes test files under each package's
 * `src` directory, so plain `pnpm test` never touches `e2e/` — no build
 * artifact, no key, no network required there.
 *
 * `root` is pinned to the package directory so the include pattern resolves
 * identically whether vitest is invoked from the repo root
 * (`pnpm exec vitest run --config packages/quickstart/e2e/vitest.config.ts …`)
 * or from the package.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    include: ["e2e/**/*.test.ts"],
    // Real provider turns can be slow; Tier 1b is fast but shares the config.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
