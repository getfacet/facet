import { createHash } from "node:crypto";

import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";

import { MAX_EVIDENCE_BUNDLE_BYTES, type RunEvidenceV1 } from "../shared/run-contract.js";
import { projectRunEvidenceForCapture } from "../shared/evidence-schema.js";
import { computeAssetDigest } from "./asset-snapshot.js";
import {
  decodeEvidenceBundle,
  exportEvidenceBundle,
  importEvidenceBundle,
  type EvidenceArtifact,
} from "./evidence-bundle.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_DIGEST = computeAssetDigest(DEFAULT_THEME, [])!;

function digest(data: Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function makeEvidence(artifact: EvidenceArtifact, prompt: string): RunEvidenceV1 {
  const tree = {
    root: "root",
    nodes: { root: { id: "root", type: "box", children: [] } },
  } as const;
  return {
    schemaVersion: 1,
    run: {
      runId: RUN_ID,
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: "visitor-1",
      generation: 1,
      status: "complete",
      createdAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:01.000Z",
      completedAt: "2026-07-19T00:00:02.000Z",
      mode: "deterministic",
      provider: "openai",
      model: "fixture-v1",
      scenarioId: "analytics-dashboard",
      prompt,
      constraint: null,
      viewport: "desktop",
      colorMode: "dark",
      assetDigest: ASSET_DIGEST,
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: {
      digest: ASSET_DIGEST,
      source: "default",
      theme: DEFAULT_THEME,
      patterns: [],
    },
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
    artifacts: [
      {
        id: artifact.id,
        kind: "screenshot",
        mediaType: "image/png",
        bytes: artifact.data.byteLength,
        digest: digest(artifact.data),
        capture: { viewport: "desktop", colorMode: "dark", stageVersion: 0, ordinal: 0 },
      },
    ],
  };
}

describe("evidence bundles", () => {
  it("atomically round-trips redacted replay evidence", () => {
    const canary = "sk-facet-bundle-canary-0123456789";
    const artifact: EvidenceArtifact = {
      id: "capture-1",
      data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    };
    const evidence = makeEvidence(artifact, `Analyze this run with ${canary}`);
    const captured = projectRunEvidenceForCapture(evidence, { canaries: [canary] });
    if (!captured.ok) throw new Error(captured.error.message);
    const exportCandidate: RunEvidenceV1 = {
      ...captured.value,
      run: {
        ...captured.value.run,
        prompt: `${captured.value.run.prompt} late diagnostic ${canary}`,
      },
    };

    const exported = exportEvidenceBundle(exportCandidate, [artifact], { canaries: [canary] });
    if (!exported.ok) throw new Error(exported.error.message);
    expect(exported.ok).toBe(true);
    expect(exported.bytes).toBeLessThanOrEqual(MAX_EVIDENCE_BUNDLE_BYTES);
    expect(exported.json).not.toContain(canary);
    expect(exported.json).toContain("[REDACTED]");

    const decoded = decodeEvidenceBundle(exported.json, { canaries: [canary] });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.error.message);
    expect(decoded.evidence.run.runId).toBe(RUN_ID);
    expect(decoded.evidence.run.prompt).toContain("[REDACTED]");
    expect(decoded.artifacts).toHaveLength(1);
    expect(decoded.artifacts[0]?.data).toEqual(artifact.data);

    const imported = importEvidenceBundle(exported.json, { canaries: [canary] });
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.evidence.run.runId).not.toBe(RUN_ID);
    expect(imported.evidence.run.importedFromRunId).toBe(RUN_ID);
    expect(imported.evidence.run.mode).toBe("deterministic");
    expect(imported.evidence.frames).toEqual(decoded.evidence.frames);

    const forgedAssets = exportEvidenceBundle(
      {
        ...exportCandidate,
        run: { ...exportCandidate.run, assetDigest: "sha256:forged" },
        assets: { ...exportCandidate.assets, digest: "sha256:forged" },
      },
      [artifact],
    );
    if (!forgedAssets.ok) throw new Error(forgedAssets.error.message);
    expect(importEvidenceBundle(forgedAssets.json)).toMatchObject({
      ok: false,
      error: { code: "invalid-evidence" },
    });

    const activeBundle = exportEvidenceBundle(
      {
        ...exportCandidate,
        run: { ...exportCandidate.run, status: "running", completedAt: null },
      },
      [artifact],
    );
    if (!activeBundle.ok) throw new Error(activeBundle.error.message);
    const importedActive = importEvidenceBundle(activeBundle.json, {
      now: () => "2026-07-19T00:00:03.000Z",
    });
    expect(importedActive).toMatchObject({
      ok: true,
      evidence: {
        run: {
          status: "incomplete",
          importedFromRunId: RUN_ID,
          completedAt: "2026-07-19T00:00:03.000Z",
        },
      },
    });
    if (!importedActive.ok) throw new Error(importedActive.error.message);
    expect(importedActive.evidence.run.completedAt).not.toBeNull();
    expect(importedActive.evidence.run.completedAt! >= importedActive.evidence.run.startedAt!).toBe(
      true,
    );

    const corrupt = JSON.parse(exported.json) as Record<string, unknown>;
    corrupt.digest = "sha256:deadbeef";
    expect(decodeEvidenceBundle(JSON.stringify(corrupt))).toMatchObject({
      ok: false,
      error: { code: "digest-mismatch" },
    });

    const unsupported = JSON.parse(exported.json) as Record<string, unknown>;
    unsupported.schemaVersion = 2;
    expect(decodeEvidenceBundle(JSON.stringify(unsupported))).toMatchObject({
      ok: false,
      error: { code: "unsupported-version" },
    });

    expect(decodeEvidenceBundle(new Uint8Array(MAX_EVIDENCE_BUNDLE_BYTES + 1))).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });

    const textArtifact: EvidenceArtifact = {
      id: "capture-1",
      data: new TextEncoder().encode(`artifact contains ${canary}`),
    };
    const textEvidence = makeEvidence(textArtifact, "safe prompt");
    expect(
      exportEvidenceBundle(textEvidence, [textArtifact], { canaries: [canary] }),
    ).toMatchObject({
      ok: false,
      error: { code: "secret-artifact" },
    });
  });
});
