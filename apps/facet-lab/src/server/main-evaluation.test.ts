import { EMPTY_TREE } from "@facet/core";
import { describe, expect, it } from "vitest";

import type { EvidenceRecordV1, JsonValue, RunEvidenceV1 } from "../shared/run-contract.js";
import { createDefaultAssetSnapshot } from "./asset-snapshot.js";
import { usedInventory } from "./main.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function diagnostic(
  ordinal: number,
  data: JsonValue,
  turnId: string | null = "turn-1",
): EvidenceRecordV1 {
  return {
    kind: "diagnostic",
    runId: RUN_ID,
    turnId,
    generation: 1,
    ordinal,
    timestamp: "2026-07-19T00:00:01.000Z",
    source: "agent",
    truncated: false,
    overflow: false,
    data,
  };
}

function evidence(records: readonly EvidenceRecordV1[]): RunEvidenceV1 {
  const assets = createDefaultAssetSnapshot();
  return {
    schemaVersion: 1,
    run: {
      runId: RUN_ID,
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: "visitor-1",
      generation: 1,
      status: "complete",
      createdAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:00.000Z",
      completedAt: "2026-07-19T00:00:02.000Z",
      mode: "deterministic",
      provider: "openai",
      model: "fixture",
      scenarioId: "landing-marketing",
      prompt: "test",
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
      assetDigest: assets.digest,
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: {
      digest: assets.digest,
      source: "default",
      theme: assets.theme,
      patterns: assets.patterns,
    },
    initialTree: EMPTY_TREE,
    finalTree: EMPTY_TREE,
    records,
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

describe("Lab evidence asset usage", () => {
  it("counts only Pattern reads with a matching successful tool result", () => {
    const inventory = usedInventory(
      evidence([
        diagnostic(0, {
          kind: "tool-call",
          callId: "missing-result",
          name: "get_pattern",
          input: { name: "hero" },
          truncated: false,
        }),
        diagnostic(1, {
          kind: "tool-call",
          callId: "rejected-result",
          name: "get_pattern",
          input: { name: "feature-grid" },
          truncated: false,
        }),
        diagnostic(2, {
          kind: "tool-result",
          callId: "rejected-result",
          observation: JSON.stringify({
            tool: "get_pattern",
            status: "error",
            code: "not_available",
          }),
          messages: [],
          mutated: false,
          said: false,
          truncated: false,
        }),
        diagnostic(
          3,
          {
            kind: "tool-result",
            callId: "rejected-result",
            observation: JSON.stringify({ tool: "get_pattern", status: "ok" }),
            messages: [],
            mutated: false,
            said: false,
            truncated: false,
          },
          "turn-2",
        ),
        diagnostic(4, {
          kind: "tool-call",
          callId: "successful-result",
          name: "get_pattern",
          input: { name: "card-grid" },
          truncated: false,
        }),
        diagnostic(5, {
          kind: "tool-result",
          callId: "successful-result",
          observation: JSON.stringify({ tool: "get_pattern", status: "ok" }),
          messages: [],
          mutated: false,
          said: false,
          truncated: false,
        }),
      ]),
    );

    expect(inventory.patterns).toEqual(["card-grid"]);
  });
});
