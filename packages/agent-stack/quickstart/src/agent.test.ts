import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FacetAgent } from "@facet/core";
import type { ReferenceAgentOptions, ReferenceProvider } from "@facet/reference-agent";
import { MemorySink, MemorySummaryStore, type SummaryStore } from "@facet/runtime";

const { createReferenceAgentSpy } = vi.hoisted(() => ({
  createReferenceAgentSpy: vi.fn<(options: ReferenceAgentOptions) => FacetAgent>(),
}));

vi.mock("@facet/reference-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facet/reference-agent")>();
  createReferenceAgentSpy.mockImplementation(actual.createReferenceAgent);
  return { ...actual, createReferenceAgent: createReferenceAgentSpy };
});

import { composeQuickstartAgent } from "./agent.js";

const provider: ReferenceProvider = {
  name: "openai",
  model: "mock",
  run: () => Promise.resolve({ text: "", toolCalls: [] }),
};

function options(): Omit<ReferenceAgentOptions, "summaryStore"> {
  return { provider, sink: new MemorySink(), agentId: "quickstart" };
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
});
