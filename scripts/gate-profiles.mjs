export const VERIFY_COMMANDS = Object.freeze([
  "pnpm typecheck",
  "pnpm test",
  "pnpm lint",
  "pnpm format:check",
  "pnpm build",
  "node --test scripts/check-docs.test.mjs",
  "node scripts/check-docs.mjs",
  "node --test scripts/check-package-layout.test.mjs",
  "node scripts/check-package-layout.mjs",
  "node --test scripts/check-component-hard-cut.test.mjs",
  "node scripts/check-component-hard-cut.mjs",
  "node --test scripts/package-smoke.test.mjs",
  "node --test scripts/gate-profiles.test.mjs",
  "node scripts/check-source-nuls.mjs",
]);

export const FEATURE_HARD_GATE = Object.freeze([
  "/update-tests",
  "/verify",
  "/code-review",
  "/live-test",
  "/update-docs",
]);

export const REFACTOR_HARD_GATE = Object.freeze([
  "/update-tests",
  "/verify",
  "/code-review",
  "/update-docs",
]);

export const LIVE_LINK_SURFACES = Object.freeze([
  "packages/tools/quickstart",
  "packages/adapters/server",
  "packages/adapters/client",
  "packages/adapters/agent-client",
  "packages/core/runtime",
  "packages/renderers/react",
  "packages/core/core",
]);
