import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import {
  deriveMessageId,
  truncateConversationText,
  validateVisitorText,
  type ConversationMessage,
} from "./conversation.js";

/** B-25, read from the table — never re-typed as a literal here. */
const BOUND = BOUNDS.conversationMessageChars;

/**
 * The visible marker a truncated message ends with. It is written out here
 * rather than imported so the test pins the delivered bytes independently of
 * whatever constant the module happens to hold.
 */
const MARKER = "…";

/** Inputs that are not strings at all — every function must stay total on them. */
const NON_STRINGS: readonly unknown[] = [
  undefined,
  null,
  0,
  42,
  NaN,
  true,
  false,
  {},
  [],
  ["hello"],
  Symbol("hello"),
  () => "hello",
  new Date(0),
  Object.create(null),
  { toString: () => "hello" },
];

/**
 * Values whose every observation throws. A fail-safe boundary must reject these
 * without ever invoking the trap, so no property may be read and no coercion
 * attempted before the `typeof` check.
 */
const HOSTILE: readonly unknown[] = [
  {
    get length(): number {
      throw new Error("length trap");
    },
  },
  {
    toString(): string {
      throw new Error("toString trap");
    },
  },
  {
    [Symbol.toPrimitive](): string {
      throw new Error("toPrimitive trap");
    },
  },
  new Proxy(
    {},
    {
      get(): never {
        throw new Error("proxy trap");
      },
    },
  ),
];

/** Passes an off-contract value to a `string`-typed parameter, as an untyped caller can. */
function offContract(value: unknown): string {
  return value as string;
}

/** The same, for the closed role union — what a wire payload can actually carry. */
function offContractRole(value: unknown): "visitor" | "assistant" {
  return value as "visitor" | "assistant";
}

describe("ConversationMessage — the one declared frame (D-01)", () => {
  const message: ConversationMessage = {
    kind: "conversation",
    messageId: deriveMessageId("turn-1", "assistant"),
    turnId: "turn-1",
    role: "assistant",
    text: "Here is the revised dashboard.",
    at: 1_700_000_000_000,
  };

  it("carries exactly the six declared fields", () => {
    expect(Object.keys(message).sort()).toEqual([
      "at",
      "kind",
      "messageId",
      "role",
      "text",
      "turnId",
    ]);
  });

  it("is discriminated by the literal kind 'conversation'", () => {
    expect(message.kind).toBe("conversation");
  });

  it("carries a messageId derived from its own turn and role", () => {
    expect(message.messageId).toBe(deriveMessageId(message.turnId, message.role));
    expect(message.messageId).toBe("turn-1:assistant");
  });

  it("admits exactly the two directions", () => {
    const roles: ReadonlyArray<ConversationMessage["role"]> = ["visitor", "assistant"];
    expect(roles).toEqual(["visitor", "assistant"]);
  });
});

describe("deriveMessageId — stability", () => {
  it("returns the same id for the same turn and role, every time", () => {
    const first = deriveMessageId("01J8Z0X0000000000000000000", "assistant");
    const second = deriveMessageId("01J8Z0X0000000000000000000", "assistant");
    const third = deriveMessageId("01J8Z0X0000000000000000000", "assistant");
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("derives the id from the turn and role alone — no counter, clock or random source", () => {
    expect(deriveMessageId("turn-7", "visitor")).toBe("turn-7:visitor");
    expect(deriveMessageId("v-01J8Z0X000", "visitor")).toBe("v-01J8Z0X000:visitor");
    expect(deriveMessageId("evt-42", "assistant")).toBe("evt-42:assistant");
  });
});

describe("deriveMessageId — distinctness", () => {
  it("distinguishes the two directions of one turn", () => {
    expect(deriveMessageId("turn-1", "visitor")).not.toBe(deriveMessageId("turn-1", "assistant"));
  });

  it("distinguishes two turns in the same direction", () => {
    expect(deriveMessageId("turn-1", "assistant")).not.toBe(deriveMessageId("turn-2", "assistant"));
    expect(deriveMessageId("turn-1", "visitor")).not.toBe(deriveMessageId("turn-2", "visitor"));
  });

  it("is injective across a turn/direction matrix — no two pairs collide", () => {
    const turns = Array.from({ length: 64 }, (_, index) => `turn-${String(index)}`);
    const ids = turns.flatMap((turnId) => [
      deriveMessageId(turnId, "visitor"),
      deriveMessageId(turnId, "assistant"),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(turns.length * 2);
  });

  it("cannot be confused by a turn id that itself contains the separator", () => {
    // The role half is a closed two-member union, so no turn id can shift the
    // split point and impersonate another turn's message.
    expect(deriveMessageId("turn-1:visitor", "assistant")).toBe("turn-1:visitor:assistant");
    expect(deriveMessageId("turn-1:visitor", "assistant")).not.toBe(
      deriveMessageId("turn-1", "visitor"),
    );
  });
});

describe("deriveMessageId — totality", () => {
  it("returns the empty string rather than throwing on an off-contract turn id", () => {
    for (const input of [...NON_STRINGS, ...HOSTILE]) {
      expect(() => deriveMessageId(offContract(input), "assistant")).not.toThrow();
      expect(deriveMessageId(offContract(input), "assistant")).toBe("");
    }
  });

  it("returns the empty string rather than throwing on an off-contract role", () => {
    for (const input of [...NON_STRINGS, ...HOSTILE, "Visitor", "system", ""]) {
      expect(() => deriveMessageId("turn-1", offContractRole(input))).not.toThrow();
      expect(deriveMessageId("turn-1", offContractRole(input))).toBe("");
    }
  });

  it("never derives the empty string for an on-contract pair, so the rejection cannot collide", () => {
    expect(deriveMessageId("", "visitor")).toBe(":visitor");
    expect(deriveMessageId("", "assistant")).toBe(":assistant");
  });

  it("is total on a pathologically long turn id", () => {
    const huge = "z".repeat(1_000_000);
    expect(() => deriveMessageId(huge, "visitor")).not.toThrow();
    expect(deriveMessageId(huge, "visitor")).toBe(`${huge}:visitor`);
  });
});

describe("validateVisitorText — B-25, the rejecting direction", () => {
  it("accepts a message of exactly B-25 characters", () => {
    expect(validateVisitorText("a".repeat(BOUND))).toBe(true);
  });

  it("rejects a message one character past B-25", () => {
    expect(validateVisitorText("a".repeat(BOUND + 1))).toBe(false);
  });

  it("reads the limit from BOUNDS rather than a local copy", () => {
    const atLimit = "a".repeat(BOUNDS.conversationMessageChars);
    expect(validateVisitorText(atLimit)).toBe(true);
    expect(validateVisitorText(`${atLimit}a`)).toBe(false);
  });

  it("accepts ordinary visitor text", () => {
    expect(validateVisitorText("show me last quarter's revenue")).toBe(true);
    expect(validateVisitorText("")).toBe(true);
    expect(validateVisitorText("線\n\ttab")).toBe(true);
  });

  it("is total — returns false rather than throwing on non-string input", () => {
    for (const input of NON_STRINGS) {
      expect(() => validateVisitorText(input)).not.toThrow();
      expect(validateVisitorText(input)).toBe(false);
    }
  });

  it("is total on values whose every observation throws", () => {
    for (const input of HOSTILE) {
      expect(() => validateVisitorText(input)).not.toThrow();
      expect(validateVisitorText(input)).toBe(false);
    }
  });

  it("is total on a pathologically long input", () => {
    expect(() => validateVisitorText("z".repeat(1_000_000))).not.toThrow();
    expect(validateVisitorText("z".repeat(1_000_000))).toBe(false);
  });

  it("does not truncate — the visitor direction rejects, it never rewrites the question", () => {
    const over = "a".repeat(BOUND + 1);
    expect(validateVisitorText(over)).toBe(false);
    expect(over).toHaveLength(BOUND + 1);
  });
});

describe("truncateConversationText — B-25, the truncating direction", () => {
  it("returns a message of exactly B-25 characters unchanged, with no marker", () => {
    const atLimit = "a".repeat(BOUND);
    const out = truncateConversationText(atLimit);
    expect(out).toBe(atLimit);
    expect(out).toHaveLength(BOUND);
    expect(out.endsWith(MARKER)).toBe(false);
  });

  it("truncates a message one character past B-25 to exactly B-25, marker included", () => {
    const out = truncateConversationText("a".repeat(BOUND + 1));
    expect(out).toBe(`${"a".repeat(BOUND - MARKER.length)}${MARKER}`);
    expect(out).toHaveLength(BOUND);
  });

  it("counts the marker inside the bound — output never exceeds B-25", () => {
    for (const length of [BOUND - 1, BOUND, BOUND + 1, BOUND + 2, BOUND * 3, BOUND * 10]) {
      const out = truncateConversationText("b".repeat(length));
      expect(out.length).toBeLessThanOrEqual(BOUND);
    }
  });

  it("reads the limit from BOUNDS rather than a local copy", () => {
    const atLimit = "c".repeat(BOUNDS.conversationMessageChars);
    expect(truncateConversationText(atLimit)).toBe(atLimit);
    expect(truncateConversationText(`${atLimit}c`)).toHaveLength(BOUNDS.conversationMessageChars);
  });

  it("leaves an under-bound message byte-identical", () => {
    const text = "Here is the revised dashboard.\n\nAsk me to change any panel.";
    expect(truncateConversationText(text)).toBe(text);
    expect(truncateConversationText("")).toBe("");
  });
});

describe("truncateConversationText — determinism", () => {
  /**
   * Each entry pins the exact delivered output, not merely that repeated runs
   * agree with each other: self-agreement alone is satisfied by a constant
   * function. The expected values are built independently of the module.
   */
  const CORPUS: ReadonlyArray<{
    readonly why: string;
    readonly input: string;
    readonly expected: string;
  }> = [
    {
      why: "under the bound — returned whole",
      input: "short answer",
      expected: "short answer",
    },
    {
      why: "one under the bound — returned whole",
      input: "d".repeat(BOUND - 1),
      expected: "d".repeat(BOUND - 1),
    },
    {
      why: "exactly at the bound — returned whole, no marker",
      input: "e".repeat(BOUND),
      expected: "e".repeat(BOUND),
    },
    {
      why: "one past the bound — cut to make room for the marker",
      input: "f".repeat(BOUND + 1),
      expected: `${"f".repeat(BOUND - 1)}${MARKER}`,
    },
    {
      why: "far past the bound — same cut, same marker",
      input: "g".repeat(BOUND * 4),
      expected: `${"g".repeat(BOUND - 1)}${MARKER}`,
    },
    {
      why: "mixed content past the bound — cut by code unit, not by word",
      input: `${"h".repeat(BOUND - 4)}日本語テキスト`,
      expected: `${"h".repeat(BOUND - 4)}日本語${MARKER}`,
    },
    {
      why: "a surrogate pair fully inside the cut is preserved",
      input: `${"i".repeat(BOUND - 3)}😀${"j".repeat(16)}`,
      expected: `${"i".repeat(BOUND - 3)}😀${MARKER}`,
    },
    {
      why: "a surrogate pair straddling the cut is dropped whole — never a lone surrogate",
      input: `${"k".repeat(BOUND - 2)}😀${"l".repeat(16)}`,
      expected: `${"k".repeat(BOUND - 2)}${MARKER}`,
    },
  ];

  it.each(CORPUS)("pins the delivered text — $why", ({ input, expected }) => {
    expect(truncateConversationText(input)).toBe(expected);
    expect(expected.length).toBeLessThanOrEqual(BOUND);
  });

  it("is byte-identical across repeat runs, interleaved with other inputs", () => {
    const firstPass = CORPUS.map(({ input }) => truncateConversationText(input));
    for (const { input } of [...CORPUS].reverse()) {
      truncateConversationText(input);
    }
    const secondPass = CORPUS.map(({ input }) => truncateConversationText(input));
    expect(secondPass).toEqual(firstPass);
    expect(firstPass).toEqual(CORPUS.map(({ expected }) => expected));
  });

  it("is idempotent — truncating a truncated message changes nothing", () => {
    for (const { input } of CORPUS) {
      const once = truncateConversationText(input);
      expect(truncateConversationText(once)).toBe(once);
    }
  });

  it("never emits a lone surrogate at the cut", () => {
    for (const { input } of CORPUS) {
      const out = truncateConversationText(input);
      const body = out.endsWith(MARKER) ? out.slice(0, -MARKER.length) : out;
      const lastUnit = body.length === 0 ? 0 : body.charCodeAt(body.length - 1);
      expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff).toBe(false);
    }
  });
});

describe("truncateConversationText — totality", () => {
  it("returns the empty string rather than throwing on non-string input", () => {
    for (const input of NON_STRINGS) {
      expect(() => truncateConversationText(offContract(input))).not.toThrow();
      expect(truncateConversationText(offContract(input))).toBe("");
    }
  });

  it("is total on values whose every observation throws", () => {
    for (const input of HOSTILE) {
      expect(() => truncateConversationText(offContract(input))).not.toThrow();
      expect(truncateConversationText(offContract(input))).toBe("");
    }
  });

  it("is total on a pathologically long input and still respects the bound", () => {
    const huge = "z".repeat(2_000_000);
    expect(() => truncateConversationText(huge)).not.toThrow();
    expect(truncateConversationText(huge)).toHaveLength(BOUND);
  });
});

describe("the two directions of B-25 fail differently on purpose", () => {
  it("rejects the over-bound visitor message and truncates the over-bound assistant message", () => {
    const over = "m".repeat(BOUND + 1);
    expect(validateVisitorText(over)).toBe(false);
    expect(truncateConversationText(over)).toHaveLength(BOUND);
  });

  it("agrees at the limit: the same at-bound text is accepted and passes through whole", () => {
    const atLimit = "n".repeat(BOUND);
    expect(validateVisitorText(atLimit)).toBe(true);
    expect(truncateConversationText(atLimit)).toBe(atLimit);
  });

  it("produces a deliverable frame in both directions", () => {
    const visitorText = "o".repeat(BOUND);
    expect(validateVisitorText(visitorText)).toBe(true);
    const visitor: ConversationMessage = {
      kind: "conversation",
      messageId: deriveMessageId("v-01J8Z0X000", "visitor"),
      turnId: "v-01J8Z0X000",
      role: "visitor",
      text: visitorText,
      at: 0,
    };
    const assistant: ConversationMessage = {
      kind: "conversation",
      messageId: deriveMessageId("v-01J8Z0X000", "assistant"),
      turnId: "v-01J8Z0X000",
      role: "assistant",
      text: truncateConversationText("p".repeat(BOUND + 1)),
      at: 1,
    };
    expect(visitor.messageId).not.toBe(assistant.messageId);
    expect(visitor.text.length).toBeLessThanOrEqual(BOUND);
    expect(assistant.text.length).toBeLessThanOrEqual(BOUND);
  });
});
