import { describe, expect, it } from "vitest";
import type { FacetSession, ServerMessage } from "@facet/core";
import { EMPTY_TREE } from "@facet/core";
import { foldTurnIntoSession } from "./turn-fold.js";

const session: FacetSession = {
  agentId: "agent",
  visitor: { visitorId: "visitor" },
  stage: EMPTY_TREE,
};

describe("foldTurnIntoSession", () => {
  it("leaves a patch-free turn untouched", () => {
    const messages: readonly ServerMessage[] = [{ kind: "say", text: "hello" }];

    expect(foldTurnIntoSession(session, messages)).toEqual({
      session,
      issues: [],
      messages,
      recordMessages: messages,
      mutated: false,
    });
  });

  it("coalesces patch messages once while preserving surrounding says", () => {
    const firstPatch: ServerMessage = {
      kind: "patch",
      patches: [{ op: "add", path: "/nodes/one", value: { id: "one", type: "text", value: "1" } }],
    };
    const secondPatch: ServerMessage = {
      kind: "patch",
      patches: [{ op: "add", path: "/nodes/two", value: { id: "two", type: "text", value: "2" } }],
    };
    const messages: readonly ServerMessage[] = [
      { kind: "say", text: "before" },
      firstPatch,
      { kind: "say", text: "between" },
      secondPatch,
    ];

    const result = foldTurnIntoSession(session, messages);

    expect(result.messages).toEqual([
      { kind: "say", text: "before" },
      { kind: "patch", patches: [...firstPatch.patches, ...secondPatch.patches] },
      { kind: "say", text: "between" },
    ]);
    expect(result.recordMessages).toBe(messages);
    expect(result.session.stage.nodes["one"]).toBeDefined();
    expect(result.session.stage.nodes["two"]).toBeDefined();
    expect(result.mutated).toBe(true);
  });
});
