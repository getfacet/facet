import { describe, expect, it } from "vitest";
import { normalizeEventBody, normalizeRecordBody } from "./server-validation.js";

describe("server event envelopes", () => {
  it("normalizes the visitor and client event at the /event boundary", () => {
    expect(
      normalizeEventBody({
        visitor: { visitorId: "v1", locale: "ko-KR", ignored: true },
        event: {
          kind: "message",
          text: "hello",
          ignored: true,
          view: { screen: "home", viewport: "invalid" },
        },
        ignored: true,
      }),
    ).toEqual({
      visitor: { visitorId: "v1", locale: "ko-KR" },
      event: { kind: "message", text: "hello", view: { screen: "home" } },
    });
  });

  it("rejects malformed /event envelopes", () => {
    expect(normalizeEventBody(null)).toBeUndefined();
    expect(
      normalizeEventBody({ visitor: { visitorId: 1 }, event: { kind: "message", text: "hi" } }),
    ).toBeUndefined();
    expect(
      normalizeEventBody({ visitor: { visitorId: "v1" }, event: { kind: "tap" } }),
    ).toBeUndefined();
  });

  it("normalizes only local collected taps at the /record boundary", () => {
    expect(
      normalizeRecordBody({
        visitor: { visitorId: "v1", ignored: true },
        event: {
          kind: "tap",
          target: "cta",
          effect: { toggle: "details" },
          ignored: true,
        },
      }),
    ).toEqual({
      visitor: { visitorId: "v1" },
      event: { kind: "tap", target: "cta", effect: { toggle: "details" } },
    });
    expect(
      normalizeRecordBody({
        visitor: { visitorId: "v1" },
        event: { kind: "tap", action: { name: "agent" } },
      }),
    ).toBeUndefined();
  });
});
