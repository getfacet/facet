import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FacetAgent } from "@facet/core";
import type { ReferenceAgentOptions, ReferenceProvider } from "@facet/reference-agent";
import {
  loadAssets,
  MemoryAssets,
  MemorySink,
  MemorySummaryStore,
  type LoadedAssets,
  type SummaryStore,
} from "@facet/runtime";

const { createReferenceAgentSpy } = vi.hoisted(() => ({
  createReferenceAgentSpy: vi.fn<(options: ReferenceAgentOptions) => FacetAgent>(),
}));

vi.mock("@facet/reference-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facet/reference-agent")>();
  createReferenceAgentSpy.mockImplementation(actual.createReferenceAgent);
  return { ...actual, createReferenceAgent: createReferenceAgentSpy };
});

import { composeQuickstartAgent, type ComposeQuickstartAgentOptions } from "./agent.js";

const provider: ReferenceProvider = {
  name: "openai",
  model: "mock",
  run: () => Promise.resolve({ text: "", toolCalls: [] }),
};

let defaultAssets: LoadedAssets;

beforeAll(async () => {
  defaultAssets = await loadAssets(new MemoryAssets({}), "quickstart");
});

function options(): Omit<ComposeQuickstartAgentOptions, "summaryStore"> {
  return {
    provider,
    sink: new MemorySink(),
    agentId: "quickstart",
    theme: defaultAssets.theme,
    patterns: defaultAssets.patterns,
  };
}

describe("composeQuickstartAgent", () => {
  beforeEach(() => {
    createReferenceAgentSpy.mockClear();
  });

  it("enables cross-turn compaction with a fresh MemorySummaryStore by default", () => {
    composeQuickstartAgent(options());

    expect(createReferenceAgentSpy).toHaveBeenCalledTimes(1);
    expect(createReferenceAgentSpy.mock.calls[0]?.[0].summaryStore).toBeInstanceOf(
      MemorySummaryStore,
    );
  });

  it("passes a caller-supplied summary store through unchanged", () => {
    const store: SummaryStore = {
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(true),
      delete: () => Promise.resolve(),
    };

    composeQuickstartAgent({ ...options(), summaryStore: store });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0].summaryStore).toBe(store);
  });

  it("treats summaryStore null as an explicit compaction opt-out", () => {
    composeQuickstartAgent({ ...options(), summaryStore: null });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0]).not.toHaveProperty("summaryStore");
  });

  it("adds seeded progressive context defaults to the quickstart composition", () => {
    composeQuickstartAgent(options());
    expect(createReferenceAgentSpy.mock.calls[0]?.[0].budget).toEqual({
      maxContextChars: 160_000,
      maxContextTokens: 40_000,
      maxSummarizerInputChars: 80_000,
    });

    composeQuickstartAgent({ ...options(), budgetPreset: "quickstart" });
    expect(createReferenceAgentSpy.mock.calls[1]?.[0].budget).toEqual({
      maxContextChars: 160_000,
      maxContextTokens: 40_000,
      maxSummarizerInputChars: 80_000,
    });
  });

  it("derives missing token and summarizer caps from a custom quickstart char cap", () => {
    composeQuickstartAgent({
      ...options(),
      budget: { maxContextChars: 120_004, maxSteps: 7, maxProviderRetries: 0 },
    });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0].budget).toEqual({
      maxContextChars: 120_004,
      maxContextTokens: 30_001,
      maxSummarizerInputChars: 60_002,
      maxSteps: 7,
      maxProviderRetries: 0,
    });
  });

  it("preserves explicit quickstart context caps and unrelated budget fields", () => {
    const budget = {
      maxContextChars: 120_000,
      maxContextTokens: 17_000,
      maxSummarizerInputChars: 55_000,
      maxSteps: 9,
      maxObservationChars: 2_000,
    };

    composeQuickstartAgent({ ...options(), budget });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0].budget).toEqual(budget);
  });

  it("leaves explicit hosted and local-dev preset budgets unchanged", () => {
    for (const budgetPreset of ["hosted", "local-dev"] as const) {
      composeQuickstartAgent({ ...options(), budgetPreset });
      const presetOnly = createReferenceAgentSpy.mock.calls.at(-1)?.[0];
      expect(presetOnly?.budgetPreset).toBe(budgetPreset);
      expect(presetOnly).not.toHaveProperty("budget");

      const budget = { maxContextChars: 123_456, maxSteps: 5 };
      composeQuickstartAgent({ ...options(), budgetPreset, budget });
      expect(createReferenceAgentSpy.mock.calls.at(-1)?.[0].budget).toBe(budget);
    }
  });

  it("uses one immutable Theme and Pattern snapshot", () => {
    composeQuickstartAgent({
      ...options(),
      theme: defaultAssets.theme,
      patterns: defaultAssets.patterns,
    });

    const referenceOptions = createReferenceAgentSpy.mock.calls[0]?.[0];
    expect(referenceOptions).not.toHaveProperty("theme");
    expect(referenceOptions).not.toHaveProperty("patterns");
    expect(referenceOptions).not.toHaveProperty("themes");
    expect(referenceOptions).not.toHaveProperty("compositions");
    expect(referenceOptions).not.toHaveProperty("catalog");
    expect(referenceOptions?.assets).toEqual({
      theme: defaultAssets.theme,
      patterns: defaultAssets.patterns,
    });
    expect(Object.isFrozen(referenceOptions?.assets)).toBe(true);
    expect(referenceOptions?.assets).toMatchObject({
      theme: defaultAssets.theme,
      patterns: defaultAssets.patterns,
    });
  });
});
