import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";

import type { RunEvidenceV1 } from "../shared/run-contract.js";
import { compareRuns } from "./compare.js";

function makeEvidence(
  runId: string,
  overrides: {
    readonly importedFromRunId?: string;
    readonly finalTree?: null;
    readonly inputTokens?: number;
  } = {},
): RunEvidenceV1 {
  const tree = {
    root: "root",
    nodes: { root: { id: "root", type: "box", children: [] } },
  } as const;
  return {
    schemaVersion: 1,
    run: {
      runId,
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: `visitor-${runId.slice(0, 4)}`,
      generation: 1,
      status: "complete",
      createdAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:01.000Z",
      completedAt: "2026-07-19T00:00:02.000Z",
      mode: "deterministic",
      provider: "openai",
      model: "fixture-v1",
      scenarioId: "free-form",
      prompt: "Compare this run",
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
      assetDigest: "sha256:assets",
      assetSource: "default",
      importedFromRunId: overrides.importedFromRunId ?? null,
    },
    assets: { digest: "sha256:assets", source: "default", theme: DEFAULT_THEME, patterns: [] },
    initialTree: tree,
    finalTree: overrides.finalTree === null ? null : tree,
    records: [],
    frames: [],
    checkpoints: [],
    viewCheckpoints: [],
    providerUsage:
      overrides.inputTokens === undefined ? null : { inputTokens: overrides.inputTokens },
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [],
  };
}

describe("immutable run comparison", () => {
  it("replays without a provider and preserves comparison provenance", () => {
    const originalRunId = "11111111-1111-4111-8111-111111111111";
    const importedRunId = "33333333-3333-4333-8333-333333333333";
    const first = makeEvidence(originalRunId, { inputTokens: 42 });
    const imported = makeEvidence(importedRunId, {
      importedFromRunId: originalRunId,
      finalTree: null,
    });
    const inputs = [first, imported] as const;
    const before = JSON.stringify(inputs);

    const result = compareRuns(inputs);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.comparison.runIds).toEqual([originalRunId, importedRunId]);
    expect(result.comparison.dimensions.importedFromRunId).toEqual([
      { availability: "unavailable", reason: "not-recorded" },
      { availability: "available", value: originalRunId },
    ]);
    expect(result.comparison.dimensions.finalTreeDigest).toEqual([
      { availability: "available", value: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) },
      { availability: "unavailable", reason: "not-recorded" },
    ]);
    expect(result.comparison.dimensions.inputTokens).toEqual([
      { availability: "available", value: 42 },
      { availability: "unavailable", reason: "not-recorded" },
    ]);
    expect(JSON.stringify(inputs)).toBe(before);
    expect(Object.isFrozen(result.comparison)).toBe(true);

    expect(compareRuns([first])).toMatchObject({ ok: false, error: { code: "run-count" } });
    expect(compareRuns([first, imported, first])).toMatchObject({ ok: true });
    expect(compareRuns([first, imported, first, imported])).toMatchObject({ ok: true });
    expect(compareRuns([first, imported, first, imported, first])).toMatchObject({
      ok: false,
      error: { code: "run-count" },
    });
  });
});
