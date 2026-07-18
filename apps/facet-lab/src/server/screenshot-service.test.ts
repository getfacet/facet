import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it, vi } from "vitest";

import { CAPTURE_MATRIX } from "../evaluation/capture-matrix.js";
import { MAX_EVIDENCE_BUNDLE_BYTES, type RunEvidenceV1 } from "../shared/run-contract.js";
import { exportEvidenceBundle, type EvidenceArtifact } from "./evidence-bundle.js";
import { createScreenshotService, type ScreenshotDriver } from "./screenshot-service.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function evidence(): RunEvidenceV1 {
  const tree = {
    root: "root",
    nodes: { root: { id: "root", type: "box", children: [] } },
  } as const;
  return {
    schemaVersion: 1,
    run: {
      runId: RUN_ID,
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: "visitor-capture",
      generation: 1,
      status: "complete",
      createdAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:01.000Z",
      completedAt: "2026-07-19T00:00:02.000Z",
      mode: "deterministic",
      provider: "openai",
      model: "fixture-v1",
      scenarioId: "analytics-dashboard",
      prompt: "Capture every condition",
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
      assetDigest: "sha256:assets",
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: { digest: "sha256:assets", source: "default", theme: DEFAULT_THEME, patterns: [] },
    initialTree: tree,
    finalTree: tree,
    records: [],
    frames: [],
    checkpoints: [],
    viewCheckpoints: [],
    providerUsage: null,
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [],
  };
}

describe("screenshot service", () => {
  it("captures or explicitly marks all six conditions unavailable", async () => {
    const saved: { evidence: RunEvidenceV1; artifacts: readonly EvidenceArtifact[] }[] = [];
    const store = {
      save: vi.fn(async (candidate: unknown, artifacts: readonly EvidenceArtifact[]) => {
        saved.push({ evidence: candidate as RunEvidenceV1, artifacts });
        return { accepted: true as const, evidence: candidate as RunEvidenceV1, artifacts };
      }),
    };
    const requests: Parameters<ScreenshotDriver["capture"]>[0][] = [];
    const driver: ScreenshotDriver = {
      async capture(request) {
        requests.push(request);
        if (request.condition.id === "tablet-dark") throw new Error("isolated failure");
        return new Uint8Array([137, 80, 78, 71, request.condition.width % 251]);
      },
    };
    const service = createScreenshotService({
      driver,
      store,
      replayUrlForRun: (runId) => `http://127.0.0.1:5293/replay/${runId}`,
    });
    const result = await service.capture({
      evidence: evidence(),
      existingArtifacts: [],
      evaluationId: "visual-1",
      stageVersion: 3,
      ordinal: 10,
    });

    expect(result.outcomes).toHaveLength(6);
    expect(result.outcomes.filter(({ status }) => status === "available")).toHaveLength(5);
    expect(result.outcomes).toContainEqual({
      condition: CAPTURE_MATRIX[3],
      status: "failed",
      artifactId: null,
      reason: "capture-failed",
    });
    expect(result.persisted).toBe(true);
    expect(requests).toHaveLength(6);
    expect(
      requests.every(({ url, condition }) => {
        const parsed = new URL(url);
        return (
          parsed.pathname === `/replay/${RUN_ID}` &&
          parsed.searchParams.get("capture") === "1" &&
          parsed.searchParams.get("viewport") === condition.viewport &&
          parsed.searchParams.get("colorMode") === condition.colorMode
        );
      }),
    ).toBe(true);
    expect(saved).toHaveLength(1);
    expect(result.evidence.artifacts).toHaveLength(5);
    expect(result.artifacts).toHaveLength(5);
    expect(result.evidence.artifacts[0]).toMatchObject({
      id: "visual-1-mobile-light",
      kind: "screenshot",
      mediaType: "image/png",
      capture: { viewport: "mobile", colorMode: "light", stageVersion: 3, ordinal: 10 },
    });
    expect(exportEvidenceBundle(result.evidence, result.artifacts)).toMatchObject({ ok: true });

    const unavailableStore = { save: vi.fn(store.save) };
    const unavailable = await createScreenshotService({
      store: unavailableStore,
      replayUrlForRun: (runId) => `http://127.0.0.1:5293/replay/${runId}`,
    }).capture({
      evidence: evidence(),
      existingArtifacts: [],
      evaluationId: "visual-2",
      stageVersion: null,
      ordinal: 20,
    });
    expect(unavailable.persisted).toBe(false);
    expect(unavailable.outcomes).toHaveLength(6);
    expect(unavailable.outcomes.every(({ status }) => status === "unavailable")).toBe(true);
    expect(unavailable.outcomes.every(({ reason }) => reason === "browser-unavailable")).toBe(true);
    expect(unavailableStore.save).not.toHaveBeenCalled();

    const externalDriver = { capture: vi.fn(driver.capture) };
    const external = await createScreenshotService({
      driver: externalDriver,
      store,
      replayUrlForRun: (runId) => `http://example.com/replay/${runId}`,
    }).capture({
      evidence: evidence(),
      existingArtifacts: [],
      evaluationId: "visual-external",
      stageVersion: 3,
      ordinal: 30,
    });
    expect(external.persisted).toBe(false);
    expect(external.outcomes.every(({ reason }) => reason === "invalid-replay-url")).toBe(true);
    expect(externalDriver.capture).not.toHaveBeenCalled();

    const originalEvidence = evidence();
    const rejectingStore = {
      save: vi.fn(async () => {
        throw new Error("storage offline");
      }),
    };
    const rejected = await createScreenshotService({
      driver: { capture: async () => new Uint8Array([137, 80, 78, 71]) },
      store: rejectingStore,
      replayUrlForRun: (runId) => `http://[::1]:5293/replay/${runId}`,
    }).capture({
      evidence: originalEvidence,
      existingArtifacts: [],
      evaluationId: "visual-rejected",
      stageVersion: 3,
      ordinal: 40,
    });
    expect(rejected.persisted).toBe(false);
    expect(rejected.evidence).toBe(originalEvidence);
    expect(rejected.artifacts).toEqual([]);
    expect(rejected.outcomes.every(({ status }) => status === "failed")).toBe(true);
    expect(rejected.outcomes.every(({ reason }) => reason === "persistence-failed")).toBe(true);

    const oversizedBytes = new Uint8Array(MAX_EVIDENCE_BUNDLE_BYTES);
    const oversizedStore = { save: vi.fn(store.save) };
    const oversized = await createScreenshotService({
      driver: {
        async capture({ condition }) {
          if (condition.id === "mobile-light") return oversizedBytes;
          throw new Error("no other capture");
        },
      },
      store: oversizedStore,
      replayUrlForRun: (runId) => `http://127.0.0.1:5293/replay/${runId}`,
    }).capture({
      evidence: evidence(),
      existingArtifacts: [],
      evaluationId: "visual-oversized",
      stageVersion: 3,
      ordinal: 50,
    });
    expect(oversized.outcomes[0]).toMatchObject({ status: "failed", reason: "bundle-bound" });
    expect(oversized.persisted).toBe(false);
    expect(oversizedStore.save).not.toHaveBeenCalled();
  });
});
