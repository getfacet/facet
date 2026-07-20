import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_PROMPT_CODE_UNITS } from "../shared/run-contract.js";
import { createLabApiClient } from "./api-client.js";
import { applyRunStreamEvent, createInitialRunStreamState, selectRunStream } from "./run-stream.js";
import { validateRunConfiguration, type LabCapabilities } from "./run-config.js";

const capabilities: LabCapabilities = {
  deterministic: {
    mode: "deterministic",
    provider: "openai",
    available: true,
    models: ["facet-lab-deterministic-v1"],
    defaultModel: "facet-lab-deterministic-v1",
  },
  providers: {
    openai: {
      provider: "openai",
      available: true,
      models: ["gpt-test"],
      defaultModel: "gpt-test",
    },
    anthropic: {
      provider: "anthropic",
      available: false,
      models: ["claude-test"],
      defaultModel: "claude-test",
    },
  },
};

describe("browser run foundation", () => {
  it("bounds run configuration and keeps live stage server-authoritative", async () => {
    const valid = validateRunConfiguration(
      {
        mode: "provider",
        provider: "openai",
        model: "gpt-test",
        scenarioId: "analytics-dashboard",
        prompt: "Build the dashboard.",
        constraint: "brick:chart",
        viewport: "desktop",
        colorMode: "dark",
      },
      capabilities,
    );
    expect(valid.ok).toBe(true);

    expect(
      validateRunConfiguration(
        {
          mode: "provider",
          provider: "anthropic",
          model: "claude-test",
          scenarioId: "analytics-dashboard",
          prompt: "x".repeat(MAX_PROMPT_CODE_UNITS + 1),
          constraint: null,
          viewport: "desktop",
          colorMode: "dark",
        },
        capabilities,
      ),
    ).toMatchObject({ ok: false });

    const first = {
      runId: "00000000-0000-4000-8000-000000000001",
      generation: 1,
    } as const;
    const second = {
      runId: "00000000-0000-4000-8000-000000000002",
      generation: 1,
    } as const;
    let state = selectRunStream(createInitialRunStreamState(), first);
    state = selectRunStream(state, second);
    const unchanged = applyRunStreamEvent(state, first, {
      type: "terminal",
      status: "complete",
      ordinal: 9,
    });
    expect(unchanged).toBe(state);
    expect(unchanged.selected).toEqual(second);

    const directory = dirname(fileURLToPath(import.meta.url));
    for (const file of ["api-client.ts", "run-stream.ts", "LiveStage.tsx", "run-config.ts"]) {
      const source = await readFile(join(directory, file), "utf8");
      expect(source).not.toMatch(/node:|\.\.\/server\/|@facet\/reference-agent|@facet\/server/u);
    }
    const liveStage = await readFile(join(directory, "LiveStage.tsx"), "utf8");
    expect(liveStage).toContain("SseTransport");
    expect(liveStage).toContain("useFacet");
    expect(liveStage).toContain("StageRenderer");
  });

  it("rejects an oversized chunked API response before reading its tail", async () => {
    let reads = 0;
    let cancelled = false;
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader: () => ({
          async read() {
            reads += 1;
            return reads === 1
              ? { done: false as const, value: new Uint8Array(2 * 1024 * 1024 + 1) }
              : { done: false as const, value: new Uint8Array(1) };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {},
        }),
      },
    } as unknown as Response;
    const client = createLabApiClient({
      fetchImpl: async () => response,
    });

    await expect(client.getCatalog()).rejects.toMatchObject({
      code: "response-too-large",
    });
    expect(cancelled).toBe(true);
    expect(reads).toBe(1);
  });
});
