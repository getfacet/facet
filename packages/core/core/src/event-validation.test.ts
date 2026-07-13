import { describe, expect, it } from "vitest";
import { MAX_FIELD_VALUE_CHARS, MAX_VIEW_TOGGLED_KEYS } from "./index.js";
import {
  normalizeClientEvent,
  normalizeLocalCollectedEvent,
  normalizeVisitorContext,
} from "./event-validation.js";

describe("event normalization", () => {
  it("normalizes visitors and drops unknown keys", () => {
    expect(
      normalizeVisitorContext({
        visitorId: "v1",
        locale: "ko-KR",
        relationship: "returning",
        ignored: { nested: true },
      }),
    ).toEqual({ visitorId: "v1", locale: "ko-KR", relationship: "returning" });
    expect(normalizeVisitorContext({ visitorId: 1 })).toBeUndefined();
  });

  it("normalizes messages and clamps view through the core view contract", () => {
    const toggled: Record<string, "shown"> = {};
    for (let index = 0; index < MAX_VIEW_TOGGLED_KEYS + 5; index += 1) {
      toggled[`node-${index}`] = "shown";
    }

    expect(
      normalizeClientEvent({
        kind: "message",
        text: "hello",
        ignored: true,
        view: {
          screen: "x".repeat(MAX_FIELD_VALUE_CHARS + 1),
          viewport: "wide",
          scheme: "invalid",
          toggled,
        },
      }),
    ).toEqual({
      kind: "message",
      text: "hello",
      view: {
        viewport: "wide",
        toggled: Object.fromEntries(Object.entries(toggled).slice(-MAX_VIEW_TOGGLED_KEYS)),
      },
    });
  });

  it("accepts only bounded agent taps and returns their closed shape", () => {
    expect(
      normalizeClientEvent({
        kind: "tap",
        action: {
          kind: "agent",
          name: "submit",
          collect: "form",
          payload: { count: 2, enabled: true },
          ignored: "value",
        },
        fields: { name: "Ada", subscribed: true },
        ignored: true,
      }),
    ).toEqual({
      kind: "tap",
      action: {
        kind: "agent",
        name: "submit",
        collect: "form",
        payload: { count: 2, enabled: true },
      },
      fields: { name: "Ada", subscribed: true },
    });

    expect(
      normalizeClientEvent({ kind: "tap", action: { name: "bad", payload: { nested: {} } } }),
    ).toBeUndefined();
    expect(
      normalizeClientEvent({ kind: "tap", action: { name: "bad", payload: { n: Infinity } } }),
    ).toBeUndefined();
    expect(
      normalizeClientEvent({
        kind: "tap",
        action: { name: "bad" },
        effect: { navigate: "other" },
      }),
    ).toBeUndefined();
  });

  it("accepts only renderable local taps and drops unknown keys", () => {
    expect(
      normalizeLocalCollectedEvent({
        kind: "tap",
        target: "cta",
        effect: { navigate: "pricing" },
        fields: { plan: "pro" },
        ignored: true,
      }),
    ).toEqual({
      kind: "tap",
      target: "cta",
      effect: { navigate: "pricing" },
      fields: { plan: "pro" },
    });

    expect(normalizeLocalCollectedEvent({ kind: "tap", target: "cta" })).toBeUndefined();
    expect(
      normalizeLocalCollectedEvent({
        kind: "tap",
        effect: { toggle: "menu" },
        action: { name: "smuggled" },
      }),
    ).toBeUndefined();
    expect(
      normalizeLocalCollectedEvent({ kind: "tap", effect: { navigate: "a", toggle: "b" } }),
    ).toBeUndefined();
  });

  it("never throws for hostile objects", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile getter");
        },
      },
    );
    expect(() => normalizeVisitorContext(hostile)).not.toThrow();
    expect(() => normalizeClientEvent(hostile)).not.toThrow();
    expect(() => normalizeLocalCollectedEvent(hostile)).not.toThrow();
    expect(normalizeClientEvent(hostile)).toBeUndefined();
  });
});
