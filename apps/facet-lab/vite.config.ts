import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5293,
    strictPort: true,
  },
  build: {
    outDir: "dist/browser",
    emptyOutDir: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.journey.test.ts"],
  },
});
