import { describe, expect, it } from "vitest";

import type { ToolCall, TurnMessage } from "../provider.js";
import {
  compactHistoryMessages,
  estimateMessagesChars,
  groupTranscriptSteps,
  splitStepGroups,
} from "./compaction.js";

function turn(index: number, extra = ""): readonly TurnMessage[] {
  return [
    { role: "user", content: `visitor ${index} ${extra}` },
    { role: "assistant", content: `agent ${index} ${extra}` },
  ];
}

describe("compactHistoryMessages", () => {
  it("keeps the newest turns deterministically and emits an explicit compaction note", () => {
    const messages: TurnMessage[] = [
      ...turn(0, "oldest"),
      ...turn(1, "middle"),
      ...turn(2, "newest"),
    ];

    const first = compactHistoryMessages(messages, {
      maxChars: 140,
      droppedTurnCount: 2,
    });
    const second = compactHistoryMessages(messages, {
      maxChars: 140,
      droppedTurnCount: 2,
    });

    expect(first).toEqual(second);
    expect(first.compacted).toBe(true);
    expect(first.charCount).toBeLessThanOrEqual(140);
    expect(first.droppedTurnCount).toBeGreaterThan(2);
    const note = first.messages[0]!;
    expect(note).toMatchObject({ role: "user" });
    expect("content" in note ? note.content : "").toMatch(
      /^\[history compacted: dropped \d+ older turn\(s\); \d+ chars omitted\]$/,
    );

    const content = first.messages.map((message) => messageContent(message)).join("\n");
    expect(content).toContain("visitor 2 newest");
    expect(content).toContain("agent 2 newest");
    expect(content).not.toContain("visitor 0 oldest");
    expect(content).not.toContain("agent 0 oldest");
  });

  it("truncates an oversized newest turn with a deterministic marker instead of overflowing", () => {
    const messages: TurnMessage[] = [
      ...turn(0, "old"),
      {
        role: "user",
        content: `visitor latest ${"x".repeat(500)}`,
      },
      {
        role: "assistant",
        content: `agent latest ${"y".repeat(500)}`,
      },
    ];

    const compacted = compactHistoryMessages(messages, { maxChars: 180 });
    const content = compacted.messages.map((message) => messageContent(message)).join("\n");

    expect(compacted.compacted).toBe(true);
    expect(compacted.charCount).toBeLessThanOrEqual(180);
    expect(content).toContain("visitor latest");
    expect(content).toContain("[truncated:");
    expect(content).toContain("chars omitted]");
    expect(content).not.toContain("visitor 0 old");
  });

  it("leaves already bounded history unchanged", () => {
    const messages: TurnMessage[] = [...turn(0), ...turn(1)];
    const compacted = compactHistoryMessages(messages, { maxChars: 1_000 });

    expect(compacted.messages).toEqual(messages);
    expect(compacted.compacted).toBe(false);
    expect(compacted.charCount).toBe(estimateMessagesChars(messages));
    expect(compacted.droppedTurnCount).toBe(0);
    expect(compacted.omittedCharCount).toBe(0);
  });
});

function messageContent(message: TurnMessage): string {
  return "content" in message ? message.content : message.text;
}

function toolCall(id: string, name = "inspect_stage"): ToolCall {
  return { id, name, input: {} };
}

/** Every `tool_result` must be preceded (within its group) by an `assistant_tools`. */
function assertPairIntegrity(messages: readonly TurnMessage[]): void {
  let openToolUse = false;
  for (const message of messages) {
    if (message.role === "assistant_tools") {
      openToolUse = true;
    } else if (message.role === "tool_result") {
      expect(openToolUse).toBe(true);
    } else {
      openToolUse = false;
    }
  }
}

describe("step groups", () => {
  const seq: readonly TurnMessage[] = [
    { role: "user", content: "u0" },
    { role: "assistant", content: "a0" },
    { role: "assistant_tools", text: "step 1", toolCalls: [toolCall("c1")] },
    { role: "tool_result", callId: "c1", content: "r1" },
    { role: "tool_result", callId: "c2", content: "r2" },
    { role: "assistant_tools", text: "step 2", toolCalls: [toolCall("c3")] },
    { role: "tool_result", callId: "c3", content: "r3" },
  ];

  it("absorbs every immediately-following tool_result into the assistant_tools group", () => {
    const groups = groupTranscriptSteps(seq);

    expect(groups.map((group) => group.length)).toEqual([1, 1, 3, 2]);
    expect(groups[2]?.[0]).toMatchObject({ role: "assistant_tools", text: "step 1" });
    expect(groups[2]?.slice(1).every((message) => message.role === "tool_result")).toBe(true);
    expect(groups[3]?.[0]).toMatchObject({ role: "assistant_tools", text: "step 2" });
  });

  it("gives a leading orphan tool_result its own group without swallowing later pairs", () => {
    const orphan: readonly TurnMessage[] = [
      { role: "tool_result", callId: "x0", content: "orphan" },
      { role: "assistant_tools", text: "step", toolCalls: [toolCall("c1")] },
      { role: "tool_result", callId: "c1", content: "r1" },
    ];

    const groups = groupTranscriptSteps(orphan);

    expect(groups.map((group) => group.length)).toEqual([1, 2]);
    expect(groups[0]?.[0]).toMatchObject({ role: "tool_result", callId: "x0" });
  });

  it("never orphans a pair across any split position and preserves order", () => {
    const groupCount = groupTranscriptSteps(seq).length;
    for (let keep = 0; keep <= groupCount + 2; keep += 1) {
      const { compactable, verbatim } = splitStepGroups(seq, keep);

      // Order + totality: concatenating the two slices reproduces the input.
      expect([...compactable, ...verbatim]).toEqual(seq);
      // The verbatim slice never opens on a dangling tool_result.
      if (verbatim.length > 0) {
        expect(verbatim[0]?.role).not.toBe("tool_result");
      }
      // Both slices are pair-safe wire shapes on their own.
      assertPairIntegrity(compactable);
      assertPairIntegrity(verbatim);
    }
  });

  it("keeps the last N groups verbatim and compacts the older ones", () => {
    const { compactable, verbatim } = splitStepGroups(seq, 2);

    // Last two groups (the two tool steps) stay verbatim.
    expect(verbatim).toEqual(seq.slice(2));
    // The two leading lone messages are compactable.
    expect(compactable).toEqual(seq.slice(0, 2));
  });
});
