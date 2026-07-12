import { describe, expect, it } from "vitest";
import type { ClientEvent, ViewSnapshot } from "@facet/core";
import { withView } from "./view-attach.js";

const SNAP: ViewSnapshot = {
  screen: "pricing",
  toggled: { faq: "shown" },
  viewport: "narrow",
  scheme: "dark",
};

describe("withView", () => {
  it("composes view onto the event when a snapshot is present", () => {
    const event: ClientEvent = { kind: "message", text: "hi" };
    const out = withView(event, SNAP);
    expect(out).toEqual({ kind: "message", text: "hi", view: SNAP });
  });

  it("rides beside fields on a tap event, like fields does", () => {
    const event: ClientEvent = {
      kind: "tap",
      action: { name: "buy" },
      fields: { email: "a@b.c" },
    };
    const out = withView(event, SNAP);
    expect(out).toEqual({
      kind: "tap",
      action: { name: "buy" },
      fields: { email: "a@b.c" },
      view: SNAP,
    });
  });

  it("returns the event unchanged when the snapshot is undefined", () => {
    const event: ClientEvent = { kind: "message", text: "hi" };
    const out = withView(event, undefined);
    expect(out).toBe(event);
    expect("view" in out).toBe(false);
  });

  it("returns the event unchanged when the snapshot is empty", () => {
    const event: ClientEvent = { kind: "visit", visitor: { visitorId: "v1" } };
    const out = withView(event, {});
    expect(out).toBe(event);
    expect("view" in out).toBe(false);
  });

  it("does not mutate the input event", () => {
    const event: ClientEvent = Object.freeze({ kind: "message", text: "hi" });
    const out = withView(event, SNAP);
    expect(out).not.toBe(event);
    expect(event).toEqual({ kind: "message", text: "hi" });
    expect("view" in event).toBe(false);
    expect(out.view).toBe(SNAP);
  });
});
