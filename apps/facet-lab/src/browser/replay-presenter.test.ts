import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";

import { digestReplayTree } from "../runs/replay.js";
import type { RunEvidenceV1 } from "../shared/run-contract.js";
import { presentComparison, presentReplay } from "./replay-presenter.js";

const TREE = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["title"] },
    title: { id: "title", type: "text", value: "Replay" },
  },
} as const;

function evidence(runId: string, options: { readonly missing?: boolean } = {}): RunEvidenceV1 {
  return {
    schemaVersion: 1,
    run: {
      runId,
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: `visitor-${runId.slice(0, 4)}`,
      generation: 1,
      status: options.missing === true ? "incomplete" : "complete",
      createdAt: "2026-07-19T00:00:00.000Z",
      startedAt: options.missing === true ? null : "2026-07-19T00:00:01.000Z",
      completedAt: options.missing === true ? null : "2026-07-19T00:00:02.000Z",
      mode: "deterministic",
      provider: "openai",
      model: "fixture-v1",
      scenarioId: "lifecycle-states",
      prompt: "Replay this run",
      constraint: null,
      viewport: "desktop",
      colorMode: "dark",
      assetDigest: "sha256:assets",
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: { digest: "sha256:assets", source: "default", theme: DEFAULT_THEME, patterns: [] },
    initialTree: TREE,
    finalTree: options.missing === true ? null : TREE,
    records: [],
    frames:
      options.missing === true
        ? []
        : [
            {
              runId,
              turnId: "turn-1",
              generation: 1,
              ordinal: 1,
              timestamp: "2026-07-19T00:00:01.000Z",
              source: "live",
              stageVersion: 0,
              patches: [],
              says: ["Recorded"],
              disposition: "applied",
              postFoldTreeDigest: digestReplayTree(TREE),
            },
          ],
    checkpoints: [],
    viewCheckpoints:
      options.missing === true
        ? []
        : [
            {
              ordinal: 1,
              viewport: "desktop",
              colorMode: "dark",
              view: { screen: "details", toggled: { panel: "shown" } },
            },
          ],
    providerUsage: options.missing === true ? null : { inputTokens: 9, outputTokens: 4 },
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [],
  };
}

describe("replay presenter", () => {
  it("projects provider-free replay and explicit comparison gaps", () => {
    const first = evidence("11111111-1111-4111-8111-111111111111");
    const second = evidence("33333333-3333-4333-8333-333333333333", { missing: true });
    const before = JSON.stringify([first, second]);

    const replay = presentReplay(first, 1);
    expect(replay).toMatchObject({
      state: "ready",
      providerFree: true,
      allowedActions: ["scrub"],
      selected: {
        index: 1,
        initialView: { screen: "details", toggled: { panel: "shown" } },
      },
    });
    expect(replay.selected?.rendererKey).toContain(first.run.runId);

    const comparison = presentComparison([first, second]);
    expect(comparison).toMatchObject({
      state: "ready",
      providerFree: true,
      immutable: true,
      allowedActions: [],
    });
    expect(comparison.columns).toHaveLength(2);
    expect(comparison.columns[1]?.gaps.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["render", "evidence", "provenance"]),
    );
    expect(
      comparison.rows.some(({ cells }) =>
        cells.some(({ availability }) => availability === "unavailable"),
      ),
    ).toBe(true);
    expect(JSON.stringify([first, second])).toBe(before);
  });
});
