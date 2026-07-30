import { describe, expect, it } from "vitest";

import { deriveMessageId } from "@facet/core";
import type { ConversationMessage, PatchFrame } from "@facet/core";

import { ConversationOutbox } from "./outbox.js";
import { TurnGate } from "./turn-gate.js";

function message(turnId: string, text: string): ConversationMessage {
  return {
    kind: "conversation",
    messageId: deriveMessageId(turnId, "assistant"),
    turnId,
    role: "assistant",
    text,
    at: 1,
  };
}

function patch(stageRevision: number): PatchFrame {
  return {
    kind: "patch",
    stageRevision,
    ops: [{ op: "replace", path: "/data/status", value: stageRevision }],
  };
}

let nextTriggerId = 0;

function admitted(gate: TurnGate): ReturnType<TurnGate["admit"]> & {
  readonly outcome: "admitted";
} {
  nextTriggerId += 1;
  const result = gate.admit(`event-${nextTriggerId}`);
  if (result.outcome !== "admitted") {
    throw new Error(`expected admitted, got ${result.outcome}`);
  }
  return result;
}

describe("ConversationOutbox", () => {
  it("rejects a fenced authority before appending anything", () => {
    const gate = new TurnGate();
    const outbox = new ConversationOutbox(gate);
    const token = admitted(gate).token;

    gate.fence({ kind: "turn", token });

    expect(outbox.append(message("turn-1", "late"), { kind: "turn", token })).toEqual({
      ok: false,
      code: "outbox_authority_rejected",
      detail: "The write authority is not active.",
    });
    expect(outbox.replay(0)).toEqual([]);
  });

  it("retains a duplicate messageId exactly once", () => {
    const gate = new TurnGate();
    const outbox = new ConversationOutbox(gate);
    const token = admitted(gate).token;
    const first = message("turn-1", "first");
    const replacement = { ...first, text: "replacement" };

    expect(outbox.append(first, { kind: "turn", token })).toMatchObject({
      ok: true,
      emitted: true,
    });
    expect(outbox.append(replacement, { kind: "turn", token })).toMatchObject({
      ok: true,
      emitted: false,
    });

    expect(outbox.replay(0).map((entry) => entry.frame)).toEqual([replacement]);
  });

  it("replays only frames after the caller's last seen seq", () => {
    const gate = new TurnGate();
    const outbox = new ConversationOutbox(gate);
    const token = admitted(gate).token;
    const first = outbox.append(patch(1), { kind: "turn", token });
    outbox.append(message("turn-1", "hello"), { kind: "turn", token });

    if (!first.ok) {
      throw new Error("expected append acceptance");
    }

    expect(outbox.replay(first.entry.seq).map((entry) => entry.frame.kind)).toEqual([
      "conversation",
    ]);
  });

  it("assigns one monotonic seq across patch and conversation frames", () => {
    const gate = new TurnGate();
    const outbox = new ConversationOutbox(gate);
    const token = admitted(gate).token;

    outbox.append(patch(1), { kind: "turn", token });
    outbox.append(message("turn-1", "one"), { kind: "turn", token });
    outbox.append(patch(2), { kind: "turn", token });

    expect(outbox.replay(0).map((entry) => [entry.seq, entry.frame.kind])).toEqual([
      [1, "patch"],
      [2, "conversation"],
      [3, "patch"],
    ]);
  });

  it("bounds in-session retention", () => {
    const gate = new TurnGate();
    const outbox = new ConversationOutbox(gate, { retentionLimit: 2 });
    const token = admitted(gate).token;

    outbox.append(patch(1), { kind: "turn", token });
    outbox.append(message("turn-1", "one"), { kind: "turn", token });
    outbox.append(message("turn-2", "two"), { kind: "turn", token });

    expect(outbox.replay(0).map((entry) => entry.seq)).toEqual([2, 3]);
    expect(outbox.replay(1).map((entry) => entry.seq)).toEqual([2, 3]);
  });
});

describe("ConversationOutbox authority type", () => {
  it("keeps authority as a required second append parameter", () => {
    expect(ConversationOutbox.prototype.append).toHaveLength(2);
  });
});
