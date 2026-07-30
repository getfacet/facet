import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InProcessFacetAgent } from "@facet/agent";
import type { ReferenceAgentOptions, ReferenceProvider } from "@facet/reference-agent";
import { MemorySink, MemorySummaryStore, type SummaryStore } from "@facet/runtime";

const { createReferenceAgentSpy } = vi.hoisted(() => ({
  createReferenceAgentSpy: vi.fn<(options: ReferenceAgentOptions) => InProcessFacetAgent>(),
}));

vi.mock("@facet/reference-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facet/reference-agent")>();
  createReferenceAgentSpy.mockImplementation(actual.createReferenceAgent);
  return { ...actual, createReferenceAgent: createReferenceAgentSpy };
});

import { createQuickstartAgent, type QuickstartAgentOptions } from "./agent.js";

const provider: ReferenceProvider = {
  name: "openai",
  model: "mock",
  run: () => Promise.resolve({ text: "", toolCalls: [] }),
};

function options(): Omit<QuickstartAgentOptions, "summaryStore"> {
  return {
    provider,
    sink: new MemorySink(),
    agentId: "quickstart",
  };
}

describe("createQuickstartAgent", () => {
  beforeEach(() => {
    createReferenceAgentSpy.mockClear();
  });

  it("enables cross-turn compaction with a fresh MemorySummaryStore by default", () => {
    createQuickstartAgent(options());

    expect(createReferenceAgentSpy).toHaveBeenCalledTimes(1);
    expect(createReferenceAgentSpy.mock.calls[0]?.[0].summaryStore).toBeInstanceOf(
      MemorySummaryStore,
    );
  });

  it("passes a caller-supplied summary store through unchanged", () => {
    const store: SummaryStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve({ ok: true }),
    };

    createQuickstartAgent({ ...options(), summaryStore: store });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0].summaryStore).toBe(store);
  });

  it("treats summaryStore null as an explicit compaction opt-out", () => {
    createQuickstartAgent({ ...options(), summaryStore: null });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0]).not.toHaveProperty("summaryStore");
  });

  it("adds seeded progressive context defaults to the quickstart composition", () => {
    createQuickstartAgent(options());
    expect(createReferenceAgentSpy.mock.calls[0]?.[0].budget).toEqual({
      maxContextChars: 160_000,
      contextWindowCharsDefault: 160_000,
      maxSummarizerInputChars: 80_000,
    });

    createQuickstartAgent({ ...options(), budgetPreset: "quickstart" });
    expect(createReferenceAgentSpy.mock.calls[1]?.[0].budget).toEqual({
      maxContextChars: 160_000,
      contextWindowCharsDefault: 160_000,
      maxSummarizerInputChars: 80_000,
    });
  });

  it("derives missing context window and summarizer caps from a custom quickstart char cap", () => {
    createQuickstartAgent({
      ...options(),
      budget: { maxContextChars: 120_004, maxSteps: 7, maxProviderRetries: 0 },
    });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0].budget).toEqual({
      maxContextChars: 120_004,
      contextWindowCharsDefault: 120_004,
      maxSummarizerInputChars: 60_002,
      maxSteps: 7,
      maxProviderRetries: 0,
    });
  });

  it("preserves explicit quickstart context caps and unrelated budget fields", () => {
    const budget = {
      maxContextChars: 120_000,
      contextWindowCharsDefault: 68_000,
      maxSummarizerInputChars: 55_000,
      maxSteps: 9,
      maxObservationChars: 2_000,
    };

    createQuickstartAgent({ ...options(), budget });

    expect(createReferenceAgentSpy.mock.calls[0]?.[0].budget).toEqual(budget);
  });

  it("leaves explicit hosted and local-dev preset budgets unchanged", () => {
    for (const budgetPreset of ["hosted", "local-dev"] as const) {
      createQuickstartAgent({ ...options(), budgetPreset });
      const presetOnly = createReferenceAgentSpy.mock.calls.at(-1)?.[0];
      expect(presetOnly?.budgetPreset).toBe(budgetPreset);
      expect(presetOnly).not.toHaveProperty("budget");

      const budget = { maxContextChars: 123_456, maxSteps: 5 };
      createQuickstartAgent({ ...options(), budgetPreset, budget });
      expect(createReferenceAgentSpy.mock.calls.at(-1)?.[0].budget).toBe(budget);
    }
  });

  it("does not pass retired assets or theme/pattern snapshots into the reference agent", () => {
    createQuickstartAgent(options());

    const referenceOptions = createReferenceAgentSpy.mock.calls[0]?.[0];
    expect(referenceOptions).not.toHaveProperty("assets");
    expect(referenceOptions).not.toHaveProperty("theme");
    expect(referenceOptions).not.toHaveProperty("patterns");
    expect(referenceOptions).not.toHaveProperty("themes");
    expect(referenceOptions).not.toHaveProperty("compositions");
    expect(referenceOptions).not.toHaveProperty("catalog");
  });
});
