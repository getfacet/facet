import { describe, expect, it } from "vitest";

import type { TurnMessage } from "../provider.js";
import { compactHistoryMessages, estimateMessagesChars } from "./compaction.js";

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
