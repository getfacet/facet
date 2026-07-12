import { describe, expect, it } from "vitest";
import {
  MAX_FIELD_VALUE_CHARS,
  MAX_VIEW_TOGGLED_KEYS,
  type ClientEvent,
  type CollectedEvent,
} from "@facet/core";
import { sanitizeEventView } from "./server-validation.js";

/**
 * WU-2 (DC-003, DC-007): the untrusted `/event` boundary clamps `view` via core
 * `sanitizeView` and NEVER rejects an event for view reasons. These tests assert
 * the pure `sanitizeEventView` returns a NEW event whose `view` is cleaned (or
 * omitted), leaving every other field untouched, and never throwing.
 */
describe("sanitizeEventView — view boundary clamp", () => {
  it("drops a wholly hostile view while the event passes through unchanged (DC-003)", () => {
    const event = {
      kind: "message",
      text: "hello",
      seq: 3,
      // Every field is the wrong type / not in the closed enum, plus a nested object.
      view: {
        screen: 42,
        viewport: "gigantic",
        scheme: "sepia",
        toggled: { a: "maybe", b: { nested: true } },
        junk: { deeply: { nested: [1, 2, 3] } },
      },
    } as unknown as ClientEvent;

    const result = sanitizeEventView(event);

    // Nothing valid survived → `view` omitted entirely (key absent, not undefined).
    expect("view" in result).toBe(false);
    // The rest of the event is byte-for-byte the same.
    expect(result).toEqual({ kind: "message", text: "hello", seq: 3 });
  });

  it("keeps the valid parts of a partially-bad view and drops the bad ones (DC-003)", () => {
    const event = {
      kind: "message",
      text: "hi",
      view: {
        screen: "home", // valid → kept
        viewport: "wide", // valid enum → kept
        scheme: "aubergine", // invalid enum → dropped
        toggled: { menu: "shown", bogus: "perhaps" }, // one valid, one invalid value
      },
    } as unknown as ClientEvent;

    const result = sanitizeEventView(event);

    expect(result.view).toEqual({
      screen: "home",
      viewport: "wide",
      toggled: { menu: "shown" },
    });
    // Non-view fields untouched.
    expect(result.kind).toBe("message");
    expect((result as { text: string }).text).toBe("hi");
  });

  it("clamps an oversized screen and an over-cap toggled map without throwing (DC-003)", () => {
    const bigToggled: Record<string, "shown"> = {};
    for (let i = 0; i < MAX_VIEW_TOGGLED_KEYS + 50; i += 1) {
      bigToggled[`node-${i}`] = "shown";
    }
    const event = {
      kind: "tap",
      action: { name: "buy" },
      view: {
        screen: "x".repeat(MAX_FIELD_VALUE_CHARS + 100), // over the char cap → dropped
        toggled: bigToggled, // over the entry cap → clamped to the cap
      },
    } as unknown as ClientEvent;

    let result: ClientEvent | undefined;
    expect(() => {
      result = sanitizeEventView(event);
    }).not.toThrow();

    const view = result?.view;
    // Oversized screen dropped.
    expect(view?.screen).toBeUndefined();
    // Toggled clamped to the cap (oldest dropped, most recent kept).
    expect(Object.keys(view?.toggled ?? {}).length).toBe(MAX_VIEW_TOGGLED_KEYS);
  });

  it("drops a null view and never throws (DC-003)", () => {
    const event = {
      kind: "message",
      text: "yo",
      view: null,
    } as unknown as ClientEvent;

    const result = sanitizeEventView(event);
    expect("view" in result).toBe(false);
    expect(result).toEqual({ kind: "message", text: "yo" });
  });

  it("returns an event WITHOUT view structurally unchanged (DC-007)", () => {
    const event: ClientEvent = { kind: "message", text: "no view here", seq: 7 };
    const result = sanitizeEventView(event);
    expect(result).toEqual(event);
  });

  it("returns a NEW object and does not mutate the input", () => {
    const original = {
      kind: "message",
      text: "immutable",
      view: { screen: "home", scheme: "bogus" },
    } as unknown as ClientEvent;
    const snapshot = JSON.parse(JSON.stringify(original));

    const result = sanitizeEventView(original);

    // New top-level object.
    expect(result).not.toBe(original);
    // Input untouched (the bad `scheme` still present on the original).
    expect(original).toEqual(snapshot);
  });

  it("clamps view on a CollectedEvent (the /record path) too (DC-003)", () => {
    const event = {
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
      view: { screen: "pricing", toggled: { a: "shown", b: "sideways" }, viewport: "bogus" },
    } as unknown as CollectedEvent;

    const result = sanitizeEventView(event);

    expect(result).toEqual({
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
      view: { screen: "pricing", toggled: { a: "shown" } },
    });
  });
});
