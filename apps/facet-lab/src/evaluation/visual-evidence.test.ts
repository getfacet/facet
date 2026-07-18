import { describe, expect, it } from "vitest";

import {
  MAX_VISUAL_ARTIFACT_IDS,
  MAX_VISUAL_EVALUATION_VERSIONS,
  MAX_VISUAL_SUMMARY_CODE_UNITS,
  appendVisualEvaluation,
} from "./visual-evidence.js";

describe("appendVisualEvaluation", () => {
  it("keeps advisory visual evidence out of the contract verdict", () => {
    const contractResult = Object.freeze({ verdict: "pass" as const });
    const originalHistory = Object.freeze([]);
    const available = appendVisualEvaluation(originalHistory, {
      id: "visual-1",
      evaluator: "human",
      status: "available",
      verdict: "fail",
      summary: "The hierarchy needs revision.",
      artifactIds: ["desktop-light"],
      createdAt: "2026-07-19T00:00:00.000Z",
    });

    expect(available).toMatchObject({
      ok: true,
      version: 1,
      record: { advisory: true, status: "available", verdict: "fail" },
    });
    expect(contractResult.verdict).toBe("pass");
    expect(originalHistory).toEqual([]);

    if (!available.ok) throw new Error("Expected available evidence.");
    const unavailable = appendVisualEvaluation(available.history, {
      id: "visual-2",
      evaluator: "vision",
      status: "unavailable",
      reason: "judge-unavailable",
      artifactIds: [],
      createdAt: "2026-07-19T00:01:00.000Z",
    });
    if (!unavailable.ok) throw new Error("Expected unavailable evidence.");
    expect(unavailable).toMatchObject({
      version: 2,
      record: {
        advisory: true,
        status: "unavailable",
        verdict: null,
        summary: "Visual judge was unavailable.",
      },
    });

    const failed = appendVisualEvaluation(unavailable.history, {
      id: "visual-3",
      evaluator: "vision",
      status: "failed",
      reason: "judge-failed",
      artifactIds: ["desktop-dark"],
      createdAt: "2026-07-19T00:02:00.000Z",
    });
    expect(failed).toMatchObject({
      ok: true,
      version: 3,
      record: {
        advisory: true,
        status: "failed",
        verdict: null,
        summary: "Visual judge failed before producing a verdict.",
      },
    });
    expect(contractResult.verdict).toBe("pass");
    expect(available.history).toHaveLength(1);
    expect(unavailable.history).toHaveLength(2);
    if (failed.ok) expect(failed.history).toHaveLength(3);
  });

  it("rejects malformed or oversized records without changing prior versions", () => {
    const history = Object.freeze([]);
    const missingVerdict = appendVisualEvaluation(history, {
      id: "missing-verdict",
      evaluator: "vision",
      status: "available",
      summary: "No verdict",
      artifactIds: [],
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    const oversizedSummary = appendVisualEvaluation(history, {
      id: "oversized",
      evaluator: "human",
      status: "available",
      verdict: "pass",
      summary: "x".repeat(MAX_VISUAL_SUMMARY_CODE_UNITS + 1),
      artifactIds: [],
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    const tooManyArtifacts = appendVisualEvaluation(history, {
      id: "too-many-artifacts",
      evaluator: "human",
      status: "available",
      verdict: "pass",
      summary: "Bounded",
      artifactIds: Array.from(
        { length: MAX_VISUAL_ARTIFACT_IDS + 1 },
        (_, index) => `artifact-${String(index)}`,
      ),
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    const overVersionCap = appendVisualEvaluation(
      Array.from({ length: MAX_VISUAL_EVALUATION_VERSIONS }, (_, index) => ({
        schemaVersion: 1 as const,
        id: `existing-${String(index)}`,
        evaluator: "human" as const,
        status: "unavailable" as const,
        verdict: null,
        advisory: true as const,
        summary: "Visual evidence was not requested.",
        artifactIds: [],
        createdAt: "2026-07-19T00:00:00.000Z",
      })),
      {
        id: "one-too-many",
        evaluator: "human",
        status: "unavailable",
        reason: "not-requested",
        artifactIds: [],
        createdAt: "2026-07-19T00:00:00.000Z",
      },
    );

    expect(missingVerdict).toMatchObject({ ok: false, error: { code: "invalid-record" } });
    expect(oversizedSummary).toMatchObject({ ok: false, error: { code: "too-large" } });
    expect(tooManyArtifacts).toMatchObject({ ok: false, error: { code: "too-large" } });
    expect(overVersionCap).toMatchObject({ ok: false, error: { code: "version-limit" } });
    expect(history).toEqual([]);
  });
});
