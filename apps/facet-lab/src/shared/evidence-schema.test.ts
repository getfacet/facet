import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@facet/assets";

import {
  DEFAULT_RETAINED_RUNS,
  EVIDENCE_SCHEMA_VERSION,
  MAX_ASSET_BUNDLE_BYTES,
  MAX_ASSET_DOCUMENT_BYTES,
  MAX_COMPARISON_RUNS,
  MAX_DIAGNOSTIC_ITEM_BYTES,
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_EVIDENCE_ITEMS_PER_RUN,
  MAX_MODEL_CODE_UNITS,
  MAX_PROMPT_CODE_UNITS,
  MAX_RETAINED_RUNS,
  MAX_RUN_GUIDE_CODE_UNITS,
  MIN_COMPARISON_RUNS,
  MIN_RUN_EVIDENCE_RESERVE_BYTES,
  MIN_RETAINED_RUNS,
  RUN_STATUSES,
  type RunEvidenceV1,
} from "./run-contract.js";
import {
  parseRunEvidenceJson,
  retainTrustedEvidence,
  validateRunEvidence,
} from "./evidence-schema.js";

function makeEvidence(): RunEvidenceV1 {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    run: {
      runId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: "visitor-1",
      generation: 1,
      status: "complete",
      createdAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:01.000Z",
      completedAt: "2026-07-19T00:00:02.000Z",
      mode: "deterministic",
      provider: "openai",
      model: "facet-lab-deterministic-v1",
      scenarioId: "free-form",
      prompt: "Build a small dashboard",
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
      assetDigest: "sha256:assets",
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: {
      digest: "sha256:assets",
      source: "default",
      theme: DEFAULT_THEME,
      patterns: [],
    },
    initialTree: {
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
    },
    finalTree: {
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
    },
    records: [
      {
        kind: "ui-in",
        runId: "11111111-1111-4111-8111-111111111111",
        turnId: "turn-1",
        generation: 1,
        ordinal: 1,
        timestamp: "2026-07-19T00:00:01.000Z",
        source: "browser",
        truncated: false,
        overflow: false,
        data: { kind: "message", text: "hello" },
      },
    ],
    frames: [
      {
        runId: "11111111-1111-4111-8111-111111111111",
        turnId: "turn-1",
        generation: 1,
        ordinal: 2,
        timestamp: "2026-07-19T00:00:02.000Z",
        source: "live",
        stageVersion: 1,
        patches: [],
        says: ["Done"],
        disposition: "applied",
        postFoldTreeDigest: "sha256:tree",
      },
    ],
    checkpoints: [
      {
        ordinal: 2,
        stageVersion: 1,
        treeDigest: "sha256:tree",
        tree: {
          root: "root",
          nodes: { root: { id: "root", type: "box", children: [] } },
        },
      },
    ],
    viewCheckpoints: [
      {
        ordinal: 2,
        viewport: "desktop",
        colorMode: "light",
        view: { selectedTab: "overview" },
      },
    ],
    providerUsage: { inputTokens: 10, outputTokens: 5 },
    warnings: [],
    checks: [
      {
        id: "valid-tree",
        label: "Valid tree",
        status: "pass",
        blocking: true,
        details: null,
      },
    ],
    visualEvaluations: [
      {
        schemaVersion: 1,
        id: "visual-1",
        evaluator: "vision",
        status: "unavailable",
        verdict: null,
        advisory: true,
        summary: "No vision key configured",
        artifactIds: [],
        createdAt: "2026-07-19T00:00:03.000Z",
      },
    ],
    artifacts: [
      {
        id: "capture-1",
        kind: "screenshot",
        mediaType: "image/png",
        bytes: 1024,
        digest: "sha256:capture",
        capture: {
          viewport: "desktop",
          colorMode: "light",
          stageVersion: 1,
          ordinal: 2,
        },
      },
    ],
  };
}

function nest(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

describe("RunEvidenceV1 validation", () => {
  it("pins the v1 statuses and product safety bounds", () => {
    expect(EVIDENCE_SCHEMA_VERSION).toBe(1);
    expect(RUN_STATUSES).toEqual([
      "queued",
      "running",
      "complete",
      "failed",
      "cancelled",
      "incomplete",
    ]);
    expect({
      prompt: MAX_PROMPT_CODE_UNITS,
      model: MAX_MODEL_CODE_UNITS,
      guide: MAX_RUN_GUIDE_CODE_UNITS,
      bundle: MAX_EVIDENCE_BUNDLE_BYTES,
      assetBundle: MAX_ASSET_BUNDLE_BYTES,
      evidenceReserve: MIN_RUN_EVIDENCE_RESERVE_BYTES,
      asset: MAX_ASSET_DOCUMENT_BYTES,
      diagnostic: MAX_DIAGNOSTIC_ITEM_BYTES,
      items: MAX_EVIDENCE_ITEMS_PER_RUN,
      retained: [MIN_RETAINED_RUNS, DEFAULT_RETAINED_RUNS, MAX_RETAINED_RUNS],
      comparison: [MIN_COMPARISON_RUNS, MAX_COMPARISON_RUNS],
    }).toEqual({
      prompt: 20_000,
      model: 200,
      guide: 20_000,
      bundle: 32 * 1024 * 1024,
      assetBundle: 24 * 1024 * 1024,
      evidenceReserve: 8 * 1024 * 1024,
      asset: 1024 * 1024,
      diagnostic: 1024 * 1024,
      items: 10_000,
      retained: [1, 500, 5_000],
      comparison: [2, 4],
    });
  });

  it("rejects oversized evidence and redacts secret canaries", () => {
    const oversized = {
      ...makeEvidence(),
      artifacts: [
        {
          ...makeEvidence().artifacts[0],
          bytes: MAX_EVIDENCE_BUNDLE_BYTES,
        },
      ],
    };

    expect(validateRunEvidence(oversized)).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });

  it("accepts the exact v1 allowlist as a detached projection", () => {
    const candidate = makeEvidence();
    const result = validateRunEvidence(candidate);

    expect(result).toMatchObject({ ok: true, bytes: expect.any(Number) });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual(candidate);
    expect(result.value).not.toBe(candidate);
    expect(result.value.run).not.toBe(candidate.run);
    expect(result.value.assets.theme).not.toBe(candidate.assets.theme);
    expect(result.value.schemaVersion).toBe(1);
  });

  it.each([
    ["null", null, "invalid-root"],
    ["empty object", {}, "missing-field"],
    ["array", [], "invalid-root"],
    ["unsupported version", { ...makeEvidence(), schemaVersion: 2 }, "unsupported-version"],
    ["unknown field", { ...makeEvidence(), rawProviderBody: "unsafe" }, "unknown-field"],
    [
      "empty identity",
      { ...makeEvidence(), run: { ...makeEvidence().run, runId: "" } },
      "invalid-field",
    ],
    [
      "malformed status",
      { ...makeEvidence(), run: { ...makeEvidence().run, status: "done" } },
      "invalid-field",
    ],
  ])("rejects %s without throwing", (_label, candidate, code) => {
    expect(validateRunEvidence(candidate)).toMatchObject({ ok: false, error: { code } });
  });

  it("documents empty collections as valid but rejects cyclic and deep values", () => {
    const emptyCollections: RunEvidenceV1 = {
      ...makeEvidence(),
      records: [],
      frames: [],
      checkpoints: [],
      viewCheckpoints: [],
      warnings: [],
      checks: [],
      visualEvaluations: [],
      artifacts: [],
    };
    expect(validateRunEvidence(emptyCollections).ok).toBe(true);

    const cyclic: Record<string, unknown> = { ...makeEvidence() };
    cyclic.self = cyclic;
    expect(validateRunEvidence(cyclic)).toMatchObject({
      ok: false,
      error: { code: "cyclic" },
    });

    const deep = makeEvidence();
    const deepCandidate = { ...deep, assets: { ...deep.assets, theme: nest(40) } };
    expect(validateRunEvidence(deepCandidate)).toMatchObject({
      ok: false,
      error: { code: "too-deep" },
    });
  });

  it("classifies empty and malformed JSON before schema validation", () => {
    expect(parseRunEvidenceJson("   ")).toMatchObject({
      ok: false,
      error: { code: "empty-input" },
    });
    expect(parseRunEvidenceJson('{"schemaVersion":')).toMatchObject({
      ok: false,
      error: { code: "malformed-json" },
    });
  });

  it("preserves the trusted value by identity when a candidate is rejected", () => {
    const trustedResult = validateRunEvidence(makeEvidence());
    if (!trustedResult.ok) throw new Error(trustedResult.error.message);

    const rejected = retainTrustedEvidence(trustedResult.value, {
      ...makeEvidence(),
      schemaVersion: 9,
    });

    expect(rejected.accepted).toBe(false);
    expect(rejected.value).toBe(trustedResult.value);
    expect(rejected.validation).toMatchObject({
      ok: false,
      error: { code: "unsupported-version" },
    });
  });
});
