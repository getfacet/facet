import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { OFFICIAL_SCENARIOS } from "../scenarios/scenarios.js";
import type { RunConfiguration } from "../shared/run-contract.js";
import type { BrowserCreatedRun } from "./api-client.js";
import {
  createGenerateDraft,
  createRunActivationGate,
  projectGenerateReadiness,
} from "./generate-presenter.js";
import type { LabCapabilities } from "./run-config.js";

const CAPABILITIES: LabCapabilities = {
  deterministic: {
    mode: "deterministic",
    provider: "openai",
    available: true,
    models: ["facet-deterministic"],
    defaultModel: "facet-deterministic",
  },
  providers: {
    openai: {
      provider: "openai",
      available: true,
      models: ["gpt-live"],
      defaultModel: "gpt-live",
    },
    anthropic: {
      provider: "anthropic",
      available: false,
      models: ["claude-live"],
      defaultModel: "claude-live",
    },
  },
};

function configuration(overrides: Partial<RunConfiguration> = {}): RunConfiguration {
  return {
    mode: "deterministic",
    provider: "openai",
    model: "facet-deterministic",
    scenarioId: "analytics-dashboard",
    prompt: "Build the analytics scenario.",
    constraint: null,
    viewport: "desktop",
    colorMode: "light",
    ...overrides,
  };
}

function createdRun(runId: string): BrowserCreatedRun {
  return {
    runId,
    sessionId: "22222222-2222-4222-8222-222222222222",
    visitorId: "33333333-3333-4333-8333-333333333333",
    generation: 1,
    status: "queued",
    streamUrl: "/stream?visitorId=33333333-3333-4333-8333-333333333333",
    evidenceUrl: `/api/runs/${runId}/evidence`,
  };
}

describe("generate presenter", () => {
  it("explains unavailable providers and unmet constraints before run", () => {
    const unavailable = projectGenerateReadiness(
      configuration({
        mode: "provider",
        provider: "anthropic",
        model: "claude-live",
        scenarioId: "landing-marketing",
        constraint: "brick:table",
      }),
      CAPABILITIES,
    );

    expect(unavailable.ready).toBe(false);
    expect(unavailable.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider-unavailable",
          field: "provider",
          message: expect.stringMatching(/not configured|unavailable/iu),
        }),
        expect.objectContaining({
          code: "constraint-unmet",
          field: "constraint",
          message: expect.stringMatching(/table.*landing|landing.*table/iu),
        }),
      ]),
    );
    expect(unavailable.constraintOutcome).toBe("unmet");
    expect(unavailable.configuration).toBeNull();

    const unknown = projectGenerateReadiness(
      configuration({
        scenarioId: "documentation-content",
        constraint: "pattern:not-a-shipped-pattern",
      }),
      CAPABILITIES,
    );
    expect(unknown.ready).toBe(false);
    expect(unknown.constraintOutcome).toBe("unknown");
    expect(unknown.issues).toContainEqual(
      expect.objectContaining({
        code: "constraint-unavailable",
        message: expect.stringMatching(/not available/iu),
      }),
    );
  });

  it("requires a bounded prompt and configured provider model", () => {
    const readiness = projectGenerateReadiness(
      configuration({ mode: "provider", model: "missing-model", prompt: "" }),
      CAPABILITIES,
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["prompt-required", "model-unavailable"]),
    );
  });

  it("supports official and free-form autonomous drafts across display modes", () => {
    const official = createGenerateDraft(CAPABILITIES, OFFICIAL_SCENARIOS[1]!);
    expect(official).toMatchObject({
      mode: "deterministic",
      scenarioId: "analytics-dashboard",
      prompt: OFFICIAL_SCENARIOS[1]!.prompt,
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
    });
    expect(projectGenerateReadiness(official, CAPABILITIES)).toMatchObject({
      ready: true,
      constraintOutcome: "autonomous",
      scenarioKind: "official",
    });

    const freeForm = createGenerateDraft(CAPABILITIES, "free-form");
    expect(
      projectGenerateReadiness(
        { ...freeForm, prompt: "Design a compact status page." },
        CAPABILITIES,
      ),
    ).toMatchObject({
      ready: true,
      scenarioKind: "free-form",
      constraintOutcome: "autonomous",
    });
  });

  it("deduplicates one in-flight activation and requires distinct explicit run identities", async () => {
    const resolvers: Array<(run: BrowserCreatedRun) => void> = [];
    const starts: RunConfiguration[] = [];
    const gate = createRunActivationGate((candidate) => {
      starts.push(candidate);
      return new Promise((resolve) => resolvers.push(resolve));
    });

    const first = gate.start(configuration());
    const accidentalDoubleActivation = await gate.start(configuration());
    expect(accidentalDoubleActivation).toEqual({ ok: false, reason: "activation-in-flight" });
    expect(starts).toHaveLength(1);

    resolvers[0]!(createdRun("11111111-1111-4111-8111-111111111111"));
    await expect(first).resolves.toMatchObject({
      ok: true,
      activation: 1,
      run: { runId: "11111111-1111-4111-8111-111111111111" },
    });

    const second = gate.start(configuration({ colorMode: "dark" }));
    expect(starts).toHaveLength(2);
    resolvers[1]!(createdRun("44444444-4444-4444-8444-444444444444"));
    await expect(second).resolves.toMatchObject({
      ok: true,
      activation: 2,
      run: { runId: "44444444-4444-4444-8444-444444444444" },
    });

    const duplicateIdentity = gate.start(configuration());
    resolvers[2]!(createdRun("44444444-4444-4444-8444-444444444444"));
    await expect(duplicateIdentity).resolves.toEqual({
      ok: false,
      reason: "duplicate-run-identity",
    });
  });

  it("keeps browser pages on the same-origin client and UI-IN stage boundary", async () => {
    const sources = await Promise.all(
      ["GeneratePage.tsx", "ScenariosPage.tsx"].map((file) =>
        readFile(new URL(file, import.meta.url), "utf8"),
      ),
    );
    const source = sources.join("\n");

    expect(source).toContain('from "./api-client.js"');
    expect(source).toContain('from "./LiveStage.js"');
    expect(source).not.toMatch(
      /OPENAI_API_KEY|ANTHROPIC_API_KEY|api\.openai\.com|api\.anthropic\.com/u,
    );
    expect(source).not.toMatch(/from ["'][^"']*\/server\//u);
  });
});
