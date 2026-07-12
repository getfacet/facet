import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "packages/**/src/**/*.test.tsx",
      "packages/agent-stack/quickstart/e2e/journey/verdict.test.ts",
      "apps/**/src/**/*.test.ts",
    ],
  },
});
