import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";

import type { RunEvidenceV1 } from "../shared/run-contract.js";
import { presentRunDetail, presentRunHistory } from "./run-presenter.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function makeEvidence(): RunEvidenceV1 {
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
      mode: "provider",
      provider: "openai",
      model: "allowed-model",
      scenarioId: "analytics-dashboard",
      prompt: "Build [REDACTED] analytics",
      constraint: "pattern:dashboard-summary",
      viewport: "desktop",
      colorMode: "dark",
      assetDigest: "sha256:assets",
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: { digest: "sha256:assets", source: "default", theme: DEFAULT_THEME, patterns: [] },
    initialTree: tree,
    finalTree: tree,
    records: [
      {
        kind: "ui-in",
        runId: RUN_ID,
        turnId: "turn-1",
        generation: 1,
        ordinal: 0,
        timestamp: "2026-07-19T00:00:01.000Z",
        source: "browser",
        truncated: false,
        overflow: false,
        data: { kind: "message", text: "not projected verbatim" },
      },
      {
        kind: "diagnostic",
        runId: RUN_ID,
        turnId: "turn-1",
        generation: 1,
        ordinal: 1,
        timestamp: "2026-07-19T00:00:01.100Z",
        source: "agent",
        truncated: false,
        overflow: false,
        data: {
          kind: "tool-call",
          callId: "asset-1",
          name: "get_pattern",
          input: { name: "dashboard-summary", secret: "must-not-project" },
          truncated: false,
        },
      },
      {
        kind: "diagnostic",
        runId: RUN_ID,
        turnId: "turn-1",
        generation: 1,
        ordinal: 2,
        timestamp: "2026-07-19T00:00:01.200Z",
        source: "agent",
        truncated: false,
        overflow: false,
        data: {
          kind: "tool-result",
          callId: "asset-1",
          observation: { status: "ok", raw: "must-not-project" },
          messages: [],
          mutated: false,
          said: false,
          truncated: false,
        },
      },
      {
        kind: "diagnostic",
        runId: RUN_ID,
        turnId: "turn-1",
        generation: 1,
        ordinal: 3,
        timestamp: "2026-07-19T00:00:01.300Z",
        source: "agent",
        truncated: false,
        overflow: false,
        data: { kind: "batch", callIds: ["asset-1"], usage: { inputTokens: 14, outputTokens: 7 } },
      },
    ],
    frames: [
      {
        runId: RUN_ID,
        turnId: "turn-1",
        generation: 1,
        ordinal: 4,
        timestamp: "2026-07-19T00:00:01.400Z",
        source: "live",
        stageVersion: 1,
        patches: [{ op: "replace", path: "", value: tree }],
        says: ["Done"],
        disposition: "applied",
        postFoldTreeDigest: "sha256:tree",
      },
    ],
    checkpoints: [{ ordinal: 4, stageVersion: 1, treeDigest: "sha256:tree", tree }],
    viewCheckpoints: [],
    providerUsage: { inputTokens: 14, outputTokens: 7 },
    warnings: [],
    checks: [
      {
        id: "stage-validity",
        label: "Stage validity",
        status: "pass",
        blocking: true,
        details: null,
      },
      {
        id: "view-provenance",
        label: "View provenance",
        status: "unavailable",
        blocking: false,
        details: "No view",
      },
    ],
    visualEvaluations: [
      {
        schemaVersion: 1,
        id: "visual-1",
        evaluator: "vision",
        status: "available",
        verdict: "fail",
        advisory: true,
        summary: "Hierarchy needs revision.",
        artifactIds: ["desktop-dark"],
        createdAt: "2026-07-19T00:00:03.000Z",
      },
    ],
    artifacts: [
      {
        id: "desktop-dark",
        kind: "screenshot",
        mediaType: "image/png",
        bytes: 100,
        digest: "sha256:image",
        capture: { viewport: "desktop", colorMode: "dark", stageVersion: 1, ordinal: 4 },
      },
    ],
  };
}

describe("run presenter", () => {
  it("correlates complete trace and separates contract from visual verdicts", () => {
    const evidence = makeEvidence();
    const detail = presentRunDetail(evidence);

    expect(detail.contract).toMatchObject({ verdict: "pass", blockingFailureCount: 0 });
    expect(detail.visual).toMatchObject({
      state: "available",
      latestVerdict: "fail",
      advisory: true,
    });
    expect(detail.contract.verdict).not.toBe(detail.visual.latestVerdict);
    expect(detail.states).toEqual({
      completion: "complete",
      usage: "available",
      visual: "available",
      redaction: "present",
      overflow: "none",
    });

    expect(detail.trace.items.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["prompt", "ui-in", "asset", "tool", "usage", "patch", "stage"]),
    );
    const correlated = detail.trace.items.filter(
      ({ correlationId }) => correlationId === "asset-1",
    );
    expect(correlated).toHaveLength(2);
    expect(correlated.map(({ phase }) => phase)).toEqual(["call", "result"]);
    expect(JSON.stringify(detail)).not.toContain("must-not-project");
    expect(detail.trace.usage).toEqual({ state: "available", inputTokens: 14, outputTokens: 7 });
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.trace.items)).toBe(true);

    const degraded = presentRunDetail({
      ...evidence,
      run: { ...evidence.run, status: "incomplete" },
      providerUsage: null,
      records: [
        ...evidence.records,
        {
          kind: "overflow",
          runId: RUN_ID,
          turnId: "turn-1",
          generation: 1,
          ordinal: 5,
          timestamp: "2026-07-19T00:00:01.500Z",
          source: "lab",
          truncated: true,
          overflow: true,
          data: { code: "item-limit" },
        },
      ],
      visualEvaluations: [
        {
          schemaVersion: 1,
          id: "visual-unavailable",
          evaluator: "vision",
          status: "unavailable",
          verdict: null,
          advisory: true,
          summary: "Visual judge was unavailable.",
          artifactIds: [],
          createdAt: "2026-07-19T00:00:04.000Z",
        },
      ],
    });
    expect(degraded.states).toMatchObject({
      completion: "incomplete",
      usage: "missing",
      visual: "unavailable",
      overflow: "present",
    });
    expect(degraded.trace.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "overflow", state: "overflow" })]),
    );

    const mixedBlocking = presentRunDetail({
      ...evidence,
      checks: [
        {
          id: "failed",
          label: "Failed blocking check",
          status: "fail",
          blocking: true,
          details: null,
        },
        {
          id: "unavailable",
          label: "Unavailable blocking check",
          status: "unavailable",
          blocking: true,
          details: null,
        },
      ],
      visualEvaluations: [],
    });
    expect(mixedBlocking.contract.verdict).toBe("fail");
    expect(mixedBlocking.visual.state).toBe("missing");
    expect(mixedBlocking.visual.state).not.toBe(degraded.visual.state);

    const older = {
      ...evidence,
      run: {
        ...evidence.run,
        runId: "older",
        createdAt: "2025-01-01T00:00:00.000Z",
        status: "running" as const,
      },
    };
    const history = presentRunHistory([older, evidence], { status: "complete" });
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({
      runId: RUN_ID,
      status: "complete",
      actions: ["inspect", "export", "capture", "evaluate"],
    });
    expect(Object.isFrozen(history.rows)).toBe(true);
  });
});
