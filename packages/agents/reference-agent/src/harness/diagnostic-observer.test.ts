import { describe, expect, it } from "vitest";
import type { TurnOutcome } from "@facet/core";

import {
  createReferenceAgentDiagnosticEmitter,
  type ReferenceAgentDiagnosticEvent,
} from "./diagnostic-observer.js";

describe("reference-agent diagnostic observer", () => {
  it("captures bounded tool diagnostics without leaking secrets or retired conversation tool names", () => {
    const captured: ReferenceAgentDiagnosticEvent[] = [];
    const emit = createReferenceAgentDiagnosticEmitter((event) => captured.push(event));
    const messages: readonly TurnOutcome[] = [
      {
        stageRevision: 1,
        patches: [],
        conversation: {
          kind: "conversation",
          messageId: "turn1:assistant",
          turnId: "turn1",
          role: "assistant",
          text: "Bearer result-secret",
          at: 0,
        },
      },
    ];

    emit({
      kind: "tool-call",
      callId: "call-1",
      name: "render_page",
      input: { apiKey: "sk-secret", prompt: "safe" },
      truncated: false,
    });
    emit({
      kind: "tool-result",
      callId: "call-1",
      observation: { ok: true, token: "sk-observation" },
      messages,
      mutated: false,
      conversationDelivered: true,
      truncated: false,
    });

    expect(captured.map((event) => event.kind)).toEqual(["tool-call", "tool-result"]);
    expect(captured[1]).toMatchObject({
      kind: "tool-result",
      callId: "call-1",
      mutated: false,
      conversationDelivered: true,
      truncated: false,
    });
    expect(JSON.stringify(captured)).not.toContain("sk-secret");
    expect(JSON.stringify(captured)).not.toContain("sk-observation");
    expect(JSON.stringify(captured)).not.toContain("result-secret");
    expect(JSON.stringify(captured)).not.toContain('"say"');
    expect(Object.isFrozen(captured[0])).toBe(true);
  });

  it("delivers one explicit overflow event and ignores observer failures", () => {
    const captured: ReferenceAgentDiagnosticEvent[] = [];
    const emit = createReferenceAgentDiagnosticEmitter((event) => captured.push(event));

    for (let index = 0; index < 10_005; index += 1) {
      emit({ kind: "provider-attempt", attempt: index });
    }

    expect(captured).toHaveLength(10_001);
    expect(captured.at(-1)).toEqual({ kind: "overflow", dropped: 1 });

    const throwing = createReferenceAgentDiagnosticEmitter(() => {
      throw new Error("observer failed");
    });
    expect(() => throwing({ kind: "stop", reason: "complete" })).not.toThrow();
  });
});
