import { describe, expect, it } from "vitest";
import type { ClientEvent, CollectedEvent, ViewSnapshot } from "@facet/core";
import { withView } from "./event-view.js";

const SNAPSHOT: ViewSnapshot = {
  screen: "pricing",
  toggled: { faq: "shown" },
  viewport: "narrow",
  colorMode: "dark",
};

describe("withView", () => {
  it("infers a natural event literal while preserving its discriminant and view", () => {
    const result = withView({ kind: "message", text: "hi" }, SNAPSHOT);

    expect(result.kind).toBe("message");
    expect(result.view).toBe(SNAPSHOT);
  });

  it("decorates forwarded events without mutating them", () => {
    const event: ClientEvent = Object.freeze({
      kind: "tap",
      action: { name: "buy" },
      fields: { email: "a@b.c" },
    });
    const result = withView(event, SNAPSHOT);

    expect(result).toEqual({ ...event, view: SNAPSHOT });
    expect(result).not.toBe(event);
    expect("view" in event).toBe(false);
  });

  it("decorates locally recorded events through the same helper", () => {
    const event: CollectedEvent = {
      kind: "tap",
      target: "cta",
      effect: { navigate: "pricing" },
    };
    expect(withView(event, SNAPSHOT)).toEqual({ ...event, view: SNAPSHOT });
  });

  it("preserves identity for absent, empty, or hostile snapshots", () => {
    const event: ClientEvent = { kind: "message", text: "hi" };
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile snapshot");
        },
      },
    ) as ViewSnapshot;

    expect(withView(event)).toBe(event);
    expect(withView(event, {})).toBe(event);
    expect(() => withView(event, hostile)).not.toThrow();
    expect(withView(event, hostile)).toBe(event);
  });
});
