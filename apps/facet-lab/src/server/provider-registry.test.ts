import type { ProviderTurn, ToolSpec } from "@facet/reference-agent";
import { DEFAULT_ANTHROPIC_MODEL } from "@facet/reference-agent";
import { describe, expect, it } from "vitest";

import { MAX_CAPABILITY_MODELS } from "../shared/run-contract.js";
import { DETERMINISTIC_MODEL } from "./deterministic-provider.js";
import { DEFAULT_FACET_LAB_OPENAI_MODELS, createProviderRegistry } from "./provider-registry.js";

const EMPTY_TURN: ProviderTurn = { system: "system", messages: [{ role: "user", content: "hi" }] };
const NO_TOOLS: readonly ToolSpec[] = [];

describe("provider registry", () => {
  it("uses the reference loop path without exposing provider secrets", async () => {
    const openAiKey = "sk-openai-provider-registry-canary";
    const anthropicKey = "sk-ant-provider-registry-canary";
    let fetchCalls = 0;
    let observedAuthorization: string | null = null;
    let observedAnthropicKey: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      fetchCalls += 1;
      const headers = new Headers(init?.headers);
      if (headers.has("authorization")) {
        observedAuthorization = headers.get("authorization");
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      observedAnthropicKey = headers.get("x-api-key");
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), {
        headers: { "content-type": "application/json" },
      });
    };

    const registry = createProviderRegistry({
      environment: {
        OPENAI_API_KEY: openAiKey,
        ANTHROPIC_API_KEY: anthropicKey,
        FACET_LAB_OPENAI_MODELS: "gpt-lab-primary, gpt-lab-secondary",
        FACET_LAB_ANTHROPIC_MODELS: "claude-lab-primary",
      },
      fetchImpl,
    });

    expect(registry.capabilities).toEqual({
      deterministic: {
        available: true,
        defaultModel: DETERMINISTIC_MODEL,
        models: [DETERMINISTIC_MODEL],
        mode: "deterministic",
        provider: "openai",
      },
      providers: {
        openai: {
          available: true,
          defaultModel: "gpt-lab-primary",
          models: ["gpt-lab-primary", "gpt-lab-secondary"],
          provider: "openai",
        },
        anthropic: {
          available: true,
          defaultModel: "claude-lab-primary",
          models: ["claude-lab-primary"],
          provider: "anthropic",
        },
      },
    });
    expect(Object.isFrozen(registry.capabilities)).toBe(true);
    expect(JSON.stringify(registry)).not.toContain(openAiKey);
    expect(JSON.stringify(registry)).not.toContain(anthropicKey);

    expect(() => registry.createProvider("openai", "not-allowlisted")).toThrow(/not allowlisted/i);
    expect(fetchCalls).toBe(0);

    const openAi = registry.createProvider("openai", "gpt-lab-secondary");
    expect(openAi.name).toBe("openai");
    expect(openAi.model).toBe("gpt-lab-secondary");
    await openAi.run(EMPTY_TURN, NO_TOOLS);
    expect(fetchCalls).toBe(1);
    expect(observedAuthorization).toBe(`Bearer ${openAiKey}`);

    const anthropic = registry.createProvider("anthropic", "claude-lab-primary");
    expect(anthropic.name).toBe("anthropic");
    expect(anthropic.model).toBe("claude-lab-primary");
    await anthropic.run(EMPTY_TURN, NO_TOOLS);
    expect(fetchCalls).toBe(2);
    expect(observedAnthropicKey).toBe(anthropicKey);

    const unavailable = createProviderRegistry({
      environment: {},
      fetchImpl,
    });
    expect(unavailable.capabilities.providers).toEqual({
      openai: {
        available: false,
        defaultModel: "gpt-5.6-sol",
        models: DEFAULT_FACET_LAB_OPENAI_MODELS,
        provider: "openai",
      },
      anthropic: {
        available: false,
        defaultModel: DEFAULT_ANTHROPIC_MODEL,
        models: [DEFAULT_ANTHROPIC_MODEL],
        provider: "anthropic",
      },
    });
    expect(() => unavailable.createProvider("anthropic", DEFAULT_ANTHROPIC_MODEL)).toThrow(
      /unavailable/i,
    );
    expect(fetchCalls).toBe(2);

    expect(() =>
      createProviderRegistry({
        environment: { FACET_LAB_OPENAI_MODELS: "valid,,also-valid" },
      }),
    ).toThrow(/model allowlist/i);

    expect(() =>
      createProviderRegistry({
        environment: {
          FACET_LAB_OPENAI_MODELS: Array.from(
            { length: MAX_CAPABILITY_MODELS + 1 },
            (_, index) => `gpt-boundary-${String(index)}`,
          ).join(","),
        },
      }),
    ).toThrow(/at most 100/iu);
  });
});
