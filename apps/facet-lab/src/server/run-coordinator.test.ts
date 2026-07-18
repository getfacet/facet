import { EMPTY_TREE } from "@facet/core";
import { MemorySink } from "@facet/runtime";
import { describe, expect, it, vi } from "vitest";

import { OFFICIAL_SCENARIOS } from "../scenarios/scenarios.js";
import { digestReplayTree } from "../runs/replay.js";
import { MAX_EVIDENCE_ITEMS_PER_RUN, type RunStatus } from "../shared/run-contract.js";
import { createDefaultAssetSnapshot } from "./asset-snapshot.js";
import { DETERMINISTIC_MODEL } from "./deterministic-provider.js";
import { createRunCoordinator, type CreateCoordinatedRunInput } from "./run-coordinator.js";

function request(): CreateCoordinatedRunInput {
  const scenario = OFFICIAL_SCENARIOS[0];
  if (scenario === undefined) throw new Error("Expected an official scenario");
  return {
    assets: createDefaultAssetSnapshot(),
    configuration: {
      mode: "deterministic",
      provider: "openai",
      model: DETERMINISTIC_MODEL,
      scenarioId: scenario.id,
      prompt: "Build the isolated run.",
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
    },
    constraint: null,
    scenario,
    sink: new MemorySink(),
  };
}

describe("run coordinator", () => {
  it("seals cancelled generations and isolates restart from late completion", async () => {
    const persisted: string[] = [];
    const published: string[] = [];
    let tick = 0;
    const coordinator = createRunCoordinator({
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      persist: async (evidence) => {
        persisted.push(`${evidence.run.runId}:${String(evidence.run.generation)}`);
        return true;
      },
      publish: (evidence) => {
        published.push(`${evidence.run.runId}:${evidence.run.status}`);
      },
    });

    const first = coordinator.create(request());
    const parallel = coordinator.create(request());
    expect(first.runId).not.toBe(parallel.runId);

    const started = coordinator.start(first.runId);
    const parallelStarted = coordinator.start(parallel.runId);
    expect(started.ok).toBe(true);
    expect(parallelStarted.ok).toBe(true);
    expect(coordinator.start(first.runId)).toMatchObject({
      ok: false,
      reason: "already-running",
    });
    if (!started.ok) throw new Error("Expected first generation to start");

    const visitor = { visitorId: started.generation.identity.visitorId };
    started.generation.serverObserver({
      kind: "ui-in",
      source: "forwarded",
      turnId: "turn-1",
      visitor,
      event: { kind: "visit", visitor },
    });
    started.generation.diagnosticObserver({ kind: "provider-attempt", attempt: 1 });
    const reorderedEmptyTree = {
      nodes: structuredClone(EMPTY_TREE.nodes),
      root: EMPTY_TREE.root,
    };
    started.generation.serverObserver({
      kind: "accepted-frame",
      source: "live",
      turnId: "turn-1",
      visitor,
      event: { kind: "visit", visitor },
      messages: [{ kind: "say", text: "partial" }],
      stage: reorderedEmptyTree,
      agentMutated: false,
      disposition: "applied",
    });

    expect(coordinator.snapshot(first.runId)).toMatchObject({
      status: "running",
      generation: 1,
      records: [
        { kind: "ui-in", generation: 1, ordinal: 0, turnId: expect.any(String) },
        { kind: "diagnostic", generation: 1, ordinal: 1, turnId: expect.any(String) },
      ],
      frames: [
        {
          generation: 1,
          ordinal: 2,
          stageVersion: 0,
          says: ["partial"],
          postFoldTreeDigest: digestReplayTree(EMPTY_TREE),
        },
      ],
    });

    const firstCancel = await coordinator.cancel(first.runId);
    const secondCancel = await coordinator.cancel(first.runId);
    expect(firstCancel).toMatchObject({ ok: true, changed: true, generation: 1 });
    expect(secondCancel).toMatchObject({ ok: true, changed: false, generation: 1 });
    expect(started.generation.signal.aborted).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(published).toHaveLength(1);

    const sealedRecordCount = coordinator.snapshot(first.runId)?.records.length;
    started.generation.diagnosticObserver({ kind: "stop", reason: "complete" });
    expect(coordinator.snapshot(first.runId)?.records).toHaveLength(sealedRecordCount ?? -1);

    const restarted = coordinator.restart(first.runId);
    expect(restarted.ok).toBe(true);
    if (!restarted.ok) throw new Error("Expected restart generation to start");
    expect(restarted.generation.identity).toMatchObject({ generation: 2 });
    expect(restarted.generation.identity.runId).not.toBe(first.runId);
    expect(restarted.generation.assets.digest).toBe(started.generation.assets.digest);

    const stale = await coordinator.complete(first.runId, 1, {
      status: "complete",
      finalTree: EMPTY_TREE,
    });
    expect(stale).toMatchObject({ ok: false, reason: "sealed-generation" });
    expect(persisted).toHaveLength(1);
    expect(published).toHaveLength(1);

    expect(
      await coordinator.complete(restarted.generation.identity.runId, 2, {
        status: "complete",
        finalTree: EMPTY_TREE,
      }),
    ).toMatchObject({ ok: true, changed: true, generation: 2 });
    expect(persisted).toHaveLength(2);
    expect(published).toHaveLength(2);
    expect(coordinator.snapshot(first.runId)).toMatchObject({
      status: "cancelled",
      records: expect.arrayContaining([expect.objectContaining({ kind: "diagnostic" })]),
    });
  });

  it("aborts, seals, and persists immediately on one terminal overflow item", async () => {
    const persisted: RunStatus[] = [];
    const lifecycle: string[] = [];
    const coordinator = createRunCoordinator({
      persist: (evidence) => {
        persisted.push(evidence.run.status);
        return true;
      },
    });
    const created = coordinator.create({
      ...request(),
      onLifecycle: ({ phase, status }) => lifecycle.push(`${phase}:${status}`),
    });
    const started = coordinator.start(created.runId);
    if (!started.ok) throw new Error("Expected bounded generation to start");
    const visitor = { visitorId: started.generation.identity.visitorId };
    const acceptedFrame = {
      kind: "accepted-frame" as const,
      source: "live" as const,
      turnId: "turn-overflow",
      visitor,
      event: { kind: "visit" as const, visitor },
      messages: [],
      stage: EMPTY_TREE,
      agentMutated: false,
      disposition: "applied" as const,
    };

    for (let index = 0; index < MAX_EVIDENCE_ITEMS_PER_RUN + 10; index += 1) {
      started.generation.serverObserver(acceptedFrame);
    }

    const bounded = coordinator.snapshot(created.runId);
    if (bounded === undefined) throw new Error("Expected bounded run snapshot");
    expect(bounded.records.length + bounded.frames.length).toBe(MAX_EVIDENCE_ITEMS_PER_RUN);
    expect(bounded).toMatchObject({ status: "incomplete", sealed: true });
    expect(started.generation.signal.aborted).toBe(true);
    expect(bounded.frames).toHaveLength(MAX_EVIDENCE_ITEMS_PER_RUN - 1);
    expect(bounded.records).toEqual([
      expect.objectContaining({
        kind: "overflow",
        overflow: true,
        ordinal: MAX_EVIDENCE_ITEMS_PER_RUN - 1,
      }),
    ]);

    const recordsBefore = bounded.records;
    const framesBefore = bounded.frames;
    started.generation.diagnosticObserver({ kind: "provider-attempt", attempt: 2 });
    started.generation.serverObserver(acceptedFrame);
    expect(coordinator.snapshot(created.runId)).toMatchObject({
      records: recordsBefore,
      frames: framesBefore,
    });
    await vi.waitFor(() => {
      expect(persisted).toEqual(["incomplete"]);
      expect(lifecycle).toEqual(["sealed:incomplete", "persisted:incomplete"]);
    });
  });

  it("seals failed and incomplete diagnostic stops but keeps clean turns interactive", async () => {
    const persisted: RunStatus[] = [];
    const coordinator = createRunCoordinator({
      persist: (evidence) => {
        persisted.push(evidence.run.status);
        return true;
      },
    });
    const clean = coordinator.create(request());
    const cleanStarted = coordinator.start(clean.runId);
    if (!cleanStarted.ok) throw new Error("Expected clean generation to start");
    cleanStarted.generation.diagnosticObserver({ kind: "stop", reason: "complete" });
    expect(coordinator.snapshot(clean.runId)).toMatchObject({ status: "running", sealed: false });

    const failed = coordinator.create(request());
    const failedStarted = coordinator.start(failed.runId);
    if (!failedStarted.ok) throw new Error("Expected failed generation to start");
    failedStarted.generation.diagnosticObserver({ kind: "stop", reason: "provider-error" });
    expect(coordinator.snapshot(failed.runId)).toMatchObject({ status: "failed", sealed: true });
    expect(failedStarted.generation.signal.aborted).toBe(true);

    const bounded = coordinator.create(request());
    const boundedStarted = coordinator.start(bounded.runId);
    if (!boundedStarted.ok) throw new Error("Expected bounded generation to start");
    boundedStarted.generation.diagnosticObserver({ kind: "stop", reason: "budget" });
    expect(coordinator.snapshot(bounded.runId)).toMatchObject({
      status: "incomplete",
      sealed: true,
    });
    await vi.waitFor(() => expect(persisted).toEqual(["failed", "incomplete"]));
  });

  it("retries terminal persistence and publication without duplicating accepted work", async () => {
    let persistAttempts = 0;
    let publishAttempts = 0;
    const coordinator = createRunCoordinator({
      persist: () => {
        persistAttempts += 1;
        return persistAttempts > 1;
      },
      publish: () => {
        publishAttempts += 1;
        if (publishAttempts === 1) throw new Error("injected publish failure");
      },
    });
    const created = coordinator.create(request());
    expect(coordinator.start(created.runId).ok).toBe(true);

    expect(await coordinator.cancel(created.runId)).toMatchObject({
      ok: false,
      reason: "persistence-failed",
    });
    expect(await coordinator.cancel(created.runId)).toMatchObject({
      ok: false,
      reason: "persistence-failed",
    });
    expect(await coordinator.cancel(created.runId)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await coordinator.cancel(created.runId)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(persistAttempts).toBe(2);
    expect(publishAttempts).toBe(2);
  });
});
