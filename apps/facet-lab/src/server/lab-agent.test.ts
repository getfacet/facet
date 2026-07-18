import { collectMessages, EMPTY_TREE, type ClientEvent } from "@facet/core";
import type { ProviderTurn, ReferenceProvider } from "@facet/reference-agent";
import { MemorySink } from "@facet/runtime";
import { describe, expect, it } from "vitest";

import { OFFICIAL_SCENARIOS } from "../scenarios/scenarios.js";
import { createDefaultAssetSnapshot, createRunAssetSnapshot } from "./asset-snapshot.js";
import { DETERMINISTIC_MODEL } from "./deterministic-provider.js";
import { createLabAgent } from "./lab-agent.js";
import { buildRunGuide } from "./run-guide.js";

describe("Lab reference-agent assembly", () => {
  it("seals cancelled generations and isolates restart from late completion", async () => {
    const scenario = OFFICIAL_SCENARIOS[0];
    if (scenario === undefined) throw new Error("Expected an official scenario");
    const assets = createRunAssetSnapshot(createDefaultAssetSnapshot());
    const guide = buildRunGuide({ scenario, prompt: "Assemble this run.", constraint: null });

    const deterministic = createLabAgent({
      agentId: "deterministic-run",
      assets,
      configuration: {
        mode: "deterministic",
        provider: "openai",
        model: DETERMINISTIC_MODEL,
      },
      guide,
      scenario,
      sink: new MemorySink(),
    });
    expect(deterministic.assets).toBe(assets);
    expect(deterministic.provider.model).toBe(DETERMINISTIC_MODEL);
    expect(deterministic.provenance).toEqual({
      mode: "deterministic",
      provider: "openai",
      model: DETERMINISTIC_MODEL,
    });

    const turns: ProviderTurn[] = [];
    const provider: ReferenceProvider = {
      name: "anthropic",
      model: "claude-lab-test",
      async run(turn) {
        turns.push(turn);
        return { text: "done", toolCalls: [] };
      },
    };
    const real = createLabAgent({
      agentId: "real-run",
      assets,
      configuration: {
        mode: "provider",
        provider: "anthropic",
        model: "claude-lab-test",
      },
      guide,
      providerRegistry: {
        createProvider(name, model) {
          expect({ name, model }).toEqual({
            name: "anthropic",
            model: "claude-lab-test",
          });
          return provider;
        },
      },
      scenario,
      sink: new MemorySink(),
    });
    expect(real.assets).toBe(assets);
    expect(real.provider).toBe(provider);

    const visitor = { visitorId: "same-run-visitor" };
    const events: readonly ClientEvent[] = [
      { kind: "visit", visitor },
      { kind: "message", text: "second turn" },
    ];
    for (const event of events) {
      await collectMessages(real.agent(event, { agentId: "real-run", visitor, stage: EMPTY_TREE }));
    }
    expect(turns).toHaveLength(2);
    expect(turns[0]?.system).toBe(turns[1]?.system);
    expect(turns[0]?.system).toContain(assets.theme.name);
    expect(Object.isFrozen(real.assets.theme.tokens)).toBe(true);
  });
});
