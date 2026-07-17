/**
 * The /live-test e2e config (spec Decision 7) — Tier 1a (verdict policy), Tier
 * 1c (real-bundle jsdom), Tier 1d (journey harness), and Tier 2/3 (key-gated
 * provider smoke) use this config when invoked explicitly. The root suite also
 * discovers only the deterministic Tier 1a verdict test; it never discovers
 * build-, browser-, or key-dependent e2e tests.
 *
 * `root` is pinned to the package directory so the include pattern resolves
 * identically whether vitest is invoked from the repo root
 * (`pnpm exec vitest run --config packages/tools/quickstart/e2e/vitest.config.ts …`)
 * or from the package.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    include: ["e2e/**/*.test.ts"],
    // Real provider turns can be slow; the deterministic tiers share the config.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
