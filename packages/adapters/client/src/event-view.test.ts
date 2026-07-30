import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@facet/core";

import { withEventView } from "./event-view.js";

describe("withEventView", () => {
  it("stamps eventId and stageRevision and emits only the AgentEvent fields", () => {
    const event = withEventView(
      {
        eventName: "submit",
        sourceNodeId: "n1",
        arg: "monthly",
        collect: {
          email: { kind: "value", value: "a@b.c" },
        },
      },
      {
        eventId: "event1",
        screen: "pricing",
        stageRevision: 7,
        toggled: { faq: "shown" },
        sort: { table: "asc" },
        viewport: "wide",
        colorMode: "dark",
      },
    );

    expect(event satisfies AgentEvent).toEqual({
      eventId: "event1",
      eventName: "submit",
      sourceNodeId: "n1",
      screen: "pricing",
      stageRevision: 7,
      arg: "monthly",
      collect: {
        email: { kind: "value", value: "a@b.c" },
      },
    });
    expect(Object.keys(event).sort()).toEqual([
      "arg",
      "collect",
      "eventId",
      "eventName",
      "screen",
      "sourceNodeId",
      "stageRevision",
    ]);
  });

  it("omits arg when absent and never copies retired view fields", () => {
    const event = withEventView(
      {
        eventName: "open",
        sourceNodeId: "n2",
        collect: {},
      },
      {
        eventId: "event2",
        screen: "home",
        stageRevision: 0,
        toggled: { drawer: "open" },
        viewport: "narrow",
        colorMode: "light",
      },
    );

    expect(event).toEqual({
      eventId: "event2",
      eventName: "open",
      sourceNodeId: "n2",
      screen: "home",
      stageRevision: 0,
      collect: {},
    });
    expect("arg" in event).toBe(false);
    expect("view" in event).toBe(false);
    expect("toggled" in event).toBe(false);
    expect("sort" in event).toBe(false);
    expect("viewport" in event).toBe(false);
    expect("colorMode" in event).toBe(false);
  });
});
