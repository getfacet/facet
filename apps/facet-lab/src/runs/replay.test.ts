import { createHash } from "node:crypto";

import { DEFAULT_THEME } from "@facet/assets";
import { foldPatchIntoStage, type FacetTree } from "@facet/core";
import { describe, expect, it } from "vitest";

import type { RunEvidenceV1 } from "../shared/run-contract.js";
import { replayRun } from "./replay.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

function digest(tree: FacetTree): string {
  return `sha256:${createHash("sha256").update(stableJson(tree)).digest("hex")}`;
}

function makeEvidence(): RunEvidenceV1 {
  const initialTree: FacetTree = {
    root: "root",
    nodes: { root: { id: "root", type: "box", children: [] } },
  };
  const firstPatches = [
    { op: "add", path: "/nodes/title", value: { id: "title", type: "text", value: "Draft" } },
    { op: "replace", path: "/nodes/root/children", value: ["title"] },
  ] as const;
  const firstTree = foldPatchIntoStage(initialTree, firstPatches).tree;
  const finalPatches = [{ op: "replace", path: "/nodes/title/value", value: "Final" }] as const;
  const finalTree = foldPatchIntoStage(firstTree, finalPatches).tree;
  return {
    schemaVersion: 1,
    run: {
      runId: RUN_ID,
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: "visitor-replay",
      generation: 1,
      status: "complete",
      createdAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:01.000Z",
      completedAt: "2026-07-19T00:00:04.000Z",
      mode: "deterministic",
      provider: "openai",
      model: "fixture-v1",
      scenarioId: "stateful-interaction",
      prompt: "Build a replayable view",
      constraint: null,
      viewport: "desktop",
      colorMode: "dark",
      assetDigest: "sha256:assets",
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: { digest: "sha256:assets", source: "default", theme: DEFAULT_THEME, patterns: [] },
    initialTree,
    finalTree,
    records: [],
    frames: [
      {
        runId: RUN_ID,
        turnId: "turn-1",
        generation: 1,
        ordinal: 1,
        timestamp: "2026-07-19T00:00:01.000Z",
        source: "live",
        stageVersion: 1,
        patches: firstPatches,
        says: ["Drafted"],
        disposition: "applied",
        postFoldTreeDigest: digest(firstTree),
      },
      {
        runId: RUN_ID,
        turnId: "turn-stale",
        generation: 1,
        ordinal: 2,
        timestamp: "2026-07-19T00:00:02.000Z",
        source: "late",
        stageVersion: 1,
        patches: [{ op: "replace", path: "/nodes/title/value", value: "STALE" }],
        says: ["Late note"],
        disposition: "say-only-stale",
        postFoldTreeDigest: digest(firstTree),
      },
      {
        runId: RUN_ID,
        turnId: "turn-2",
        generation: 1,
        ordinal: 3,
        timestamp: "2026-07-19T00:00:03.000Z",
        source: "live",
        stageVersion: 2,
        patches: finalPatches,
        says: ["Finished"],
        disposition: "applied",
        postFoldTreeDigest: digest(finalTree),
      },
    ],
    checkpoints: [
      { ordinal: 1, stageVersion: 1, treeDigest: digest(firstTree), tree: firstTree },
      { ordinal: 3, stageVersion: 2, treeDigest: digest(finalTree), tree: finalTree },
    ],
    viewCheckpoints: [
      {
        ordinal: 2,
        viewport: "desktop",
        colorMode: "dark",
        view: { screen: "details", toggled: { panel: "shown" } },
      },
    ],
    providerUsage: null,
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [],
  };
}

describe("provider-free replay", () => {
  it("replays without a provider and preserves comparison provenance", () => {
    const evidence = makeEvidence();
    const before = JSON.stringify(evidence);
    const replay = replayRun(evidence);

    expect(replay.providerFree).toBe(true);
    expect(replay.snapshots).toHaveLength(4);
    expect(replay.snapshots[2]?.tree).toEqual(replay.snapshots[1]?.tree);
    expect(replay.finalTree).toEqual(evidence.finalTree);
    expect(replay.finalTreeMatchesEvidence).toBe(true);
    expect(replay.issues).toEqual([]);
    expect(replay.viewCheckpoints).toEqual([
      {
        ordinal: 2,
        viewport: "desktop",
        colorMode: "dark",
        initialView: { screen: "details", toggled: { panel: "shown" } },
      },
    ]);
    expect(JSON.stringify(evidence)).toBe(before);
    expect(Object.isFrozen(evidence.initialTree)).toBe(false);
    expect(Object.isFrozen(evidence.finalTree)).toBe(false);
    const callerRoot = evidence.initialTree.nodes.root;
    if (callerRoot?.type !== "box") throw new Error("expected root box");
    const callerChildren = callerRoot.children;
    (callerChildren as string[]).push("caller-only-change");
    expect(replay.snapshots[0]?.tree).toEqual({
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
    });
    (callerChildren as string[]).pop();

    const outOfOrder = replayRun({ ...evidence, frames: [...evidence.frames].reverse() });
    expect(outOfOrder.issues.map(({ code }) => code)).toContain("frame-order");
    expect(outOfOrder.finalTreeMatchesEvidence).toBe(true);

    const mismatched = replayRun({
      ...evidence,
      finalTree: evidence.initialTree,
      frames: [
        { ...evidence.frames[0]!, postFoldTreeDigest: "sha256:wrong-frame" },
        ...evidence.frames.slice(1),
      ],
      checkpoints: [
        { ...evidence.checkpoints[0]!, treeDigest: "sha256:wrong-checkpoint" },
        ...evidence.checkpoints.slice(1),
      ],
    });
    expect(mismatched.issues.map(({ code }) => code)).toEqual([
      "frame-digest-mismatch",
      "checkpoint-digest-mismatch",
      "final-tree-mismatch",
    ]);
    expect(mismatched.finalTreeMatchesEvidence).toBe(false);

    const malformed = {
      ...evidence,
      finalTree: evidence.initialTree,
      frames: [
        {
          ...evidence.frames[0]!,
          stageVersion: 3,
          patches: [{ op: "replace", path: "/nodes/missing/value", value: "ignored" } as const],
          postFoldTreeDigest: digest(evidence.initialTree),
        },
      ],
      checkpoints: [],
    };
    expect(() => replayRun(malformed)).not.toThrow();
    expect(replayRun(malformed).issues.map(({ code }) => code)).toEqual([
      "stage-version-gap",
      "patch-fold",
    ]);
  });
});
