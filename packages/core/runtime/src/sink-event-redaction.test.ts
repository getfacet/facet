import { describe, expect, it } from "vitest";
import type { CollectedEvent } from "@facet/core";
import { sanitizeEventForSink } from "./sink-event-redaction.js";

describe("sanitizeEventForSink", () => {
  it("redacts a duplicate visitor id while preserving non-secret visit context", () => {
    const event: CollectedEvent = {
      kind: "visit",
      visitor: { visitorId: "secret-id", locale: "ko-KR", relationship: "returning" },
    };

    expect(sanitizeEventForSink(event)).toEqual({
      kind: "visit",
      visitor: { visitorId: "[redacted]", locale: "ko-KR", relationship: "returning" },
    });
  });

  it("redacts sensitive field names and values without changing safe fields", () => {
    const event: CollectedEvent = {
      kind: "tap",
      target: "submit",
      action: { kind: "agent", name: "submit" },
      fields: {
        email: "ada@example.com",
        password: "hunter2",
        note: "Bearer abc.123",
      },
    };

    expect(sanitizeEventForSink(event)).toEqual({
      ...event,
      fields: {
        email: "ada@example.com",
        password: "[redacted]",
        note: "[redacted]",
      },
    });
  });

  it("returns a shallow copy for events that carry no fields", () => {
    const event: CollectedEvent = { kind: "message", text: "hello" };
    const sanitized = sanitizeEventForSink(event);

    expect(sanitized).toEqual(event);
    expect(sanitized).not.toBe(event);
  });
});
