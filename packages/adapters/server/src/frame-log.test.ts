import { describe, expect, it } from "vitest";
import type { ConversationMessage, PatchFrame } from "@facet/core";
import { conversation } from "./server.test-support.js";
import { FRAME_LOG_LIMIT, createFrameLogStore } from "./frame-log.js";

function patch(stageRevision: number): PatchFrame {
  return {
    kind: "patch",
    stageRevision,
    ops: [{ op: "replace", path: "/data/count", value: stageRevision }],
  };
}

describe("FrameLogStore", () => {
  it("re-serializes runtime outbox frames using the outbox seq", () => {
    const log = createFrameLogStore();
    const first = log.append("s1", { seq: 7, frame: patch(1) });
    const second = log.append("s1", { seq: 8, frame: conversation("event1", "assistant", "ok") });

    expect(first.id).toMatch(/:7$/u);
    expect(second.id).toMatch(/:8$/u);
    const era = first.id.slice(0, first.id.indexOf(":"));
    expect(
      log
        .replay("s1", era, 7)
        ?.map((frame) => JSON.parse(frame.json) as PatchFrame | ConversationMessage),
    ).toEqual([conversation("event1", "assistant", "ok")]);
  });

  it("does not collapse by messageId in the server log", () => {
    const log = createFrameLogStore();
    const first = conversation("event1", "assistant", "first");
    const replacement = { ...first, text: "replacement" };
    const stamped = log.append("s1", { seq: 1, frame: first });
    log.append("s1", { seq: 2, frame: replacement });
    const era = stamped.id.slice(0, stamped.id.indexOf(":"));

    expect(log.replay("s1", era, 0)).toHaveLength(2);
  });

  it("returns undefined when the requested seq fell out of the bounded ring", () => {
    const log = createFrameLogStore();
    let era = "";
    for (let seq = 1; seq <= FRAME_LOG_LIMIT + 2; seq += 1) {
      const stamped = log.append("s1", { seq, frame: patch(seq) });
      era = stamped.id.slice(0, stamped.id.indexOf(":"));
    }

    expect(log.replay("s1", era, 0)).toBeUndefined();
    expect(log.replay("s1", era, FRAME_LOG_LIMIT + 1)).toHaveLength(1);
  });
});
