import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 4,
    minWorkers: 1,
    include: [
      "packages/**/src/**/*.test.ts",
      "packages/**/src/**/*.test.tsx",
      "packages/tools/quickstart/e2e/journey/verdict.test.ts",
    ],
  },
});
