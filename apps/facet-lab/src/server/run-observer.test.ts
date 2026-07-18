import { describe, expect, it } from "vitest";

import type { FacetTree } from "@facet/core";

import { createRunObserver } from "./run-observer.js";

function tree(value: string): FacetTree {
  return {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["text"] },
      text: { id: "text", type: "text", value },
    },
  };
}

describe("run observer", () => {
  it("correlates turns and preserves bounded view, usage, stage, and redaction evidence", () => {
    const canary = "provider-key-without-a-generic-prefix";
    const observer = createRunObserver({
      runId: "11111111-1111-4111-8111-111111111111",
      generation: 1,
      canaries: [canary],
      viewport: "tablet",
      colorMode: "dark",
    });
    const visitor = { visitorId: "visitor" };
    observer.serverObserver({
      kind: "ui-in",
      source: "forwarded",
      turnId: "turn-a",
      visitor,
      event: {
        kind: "message",
        text: "start",
        view: { screen: "detail", colorMode: "dark", viewport: "medium" },
      },
    });
    observer.diagnosticObserver({
      kind: "batch",
      callIds: ["call-1"],
      usage: { inputTokens: 12, outputTokens: 5 },
    });
    observer.serverObserver({
      kind: "accepted-frame",
      source: "live",
      turnId: "turn-a",
      visitor,
      event: { kind: "message", text: "start" },
      messages: [
        { kind: "patch", patches: [{ op: "replace", path: "", value: tree(canary) }] },
        { kind: "say", text: `secret ${canary}` },
      ],
      stage: tree(canary),
      agentMutated: true,
      disposition: "applied",
    });
    observer.serverObserver({
      kind: "accepted-frame",
      source: "late",
      turnId: "turn-a",
      visitor,
      event: { kind: "message", text: "start" },
      messages: [{ kind: "say", text: "late answer" }],
      stage: tree("late safe stage"),
      agentMutated: false,
      disposition: "applied",
    });

    const snapshot = observer.snapshot();
    expect(snapshot.frames.map(({ turnId }) => turnId)).toEqual(["turn-a", "turn-a"]);
    expect(snapshot.frames.map(({ stageVersion }) => stageVersion)).toEqual([1, 1]);
    expect(snapshot.providerUsage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(snapshot.checkpoints).toHaveLength(1);
    expect(snapshot.viewCheckpoints).toEqual([
      expect.objectContaining({ ordinal: 0, viewport: "tablet", colorMode: "dark" }),
    ]);
    expect(snapshot.lastStage?.nodes["text"]).toMatchObject({
      type: "text",
      value: "late safe stage",
    });
    expect(JSON.stringify(snapshot)).not.toContain(canary);
    expect(JSON.stringify(snapshot)).toContain("[REDACTED]");

    observer.seal();
    observer.diagnosticObserver({
      kind: "batch",
      callIds: ["late-call"],
      usage: { inputTokens: 100, outputTokens: 100 },
    });
    expect(observer.snapshot().providerUsage).toEqual({ inputTokens: 12, outputTokens: 5 });
  });

  it("preserves the newly accepted full Stage when its frame crosses the evidence budget", () => {
    let overflows = 0;
    const observer = createRunObserver({
      runId: "11111111-1111-4111-8111-111111111111",
      generation: 1,
      maxTimelineBytes: 0,
      onOverflow: () => {
        overflows += 1;
      },
    });
    const visitor = { visitorId: "visitor" };
    observer.serverObserver({
      kind: "accepted-frame",
      source: "live",
      turnId: "turn-overflow",
      visitor,
      event: { kind: "message", text: "replace" },
      messages: [
        {
          kind: "patch",
          patches: [{ op: "replace", path: "", value: tree("accepted before overflow") }],
        },
      ],
      stage: tree("accepted before overflow"),
      agentMutated: true,
      disposition: "applied",
    });

    const snapshot = observer.snapshot();
    expect(overflows).toBe(1);
    expect(snapshot.frames).toEqual([]);
    expect(snapshot.records).toEqual([expect.objectContaining({ kind: "overflow" })]);
    expect(snapshot.stageVersion).toBe(1);
    expect(snapshot.lastStage?.nodes["text"]).toMatchObject({
      type: "text",
      value: "accepted before overflow",
    });
  });
});
