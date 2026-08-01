import { afterEach, describe, expect, it } from "vitest";
import type { ConversationRecord, Sink } from "@facet/runtime";
import type { FacetServerObservation } from "./observer.js";
import { visitorEvent, postEvent, start } from "./server.test-support.js";

class FailingSink implements Sink {
  async record(): Promise<{
    readonly ok: false;
    readonly code: "sink_down";
    readonly detail: "sink refused";
  }> {
    return { ok: false, code: "sink_down", detail: "sink refused" };
  }

  async history(): Promise<readonly ConversationRecord[]> {
    return [];
  }
}

let active: { readonly close: () => Promise<void> } | undefined;

afterEach(async () => {
  await active?.close();
  active = undefined;
});

describe("FacetServerObserver", () => {
  it("observes accepted frames and Sink failure diagnostics without controlling the turn", async () => {
    const seen: FacetServerObservation[] = [];
    const { server, base } = await start({
      sink: new FailingSink(),
      observer: (event) => {
        seen.push(event);
      },
      agent: { run: async () => ({ text: "visible" }) },
    });
    active = server;

    const response = await postEvent(base, "s1", visitorEvent());

    expect(response.status).toBe(202);
    expect(seen.map((event) => event.kind)).toContain("accepted-frame");
    expect(seen).toContainEqual({
      kind: "diagnostic",
      sessionKey: "s1",
      code: "sink_down",
      detail: "sink refused",
    });
  });

  it("observes busy diagnostics for a distinct concurrent trigger", async () => {
    const seen: FacetServerObservation[] = [];
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { server, base } = await start({
      observer: (event) => {
        seen.push(event);
      },
      agent: {
        run: async () => {
          await hold;
          return { text: "done" };
        },
      },
    });
    active = server;

    const first = postEvent(base, "s1", visitorEvent({ eventId: "event1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await postEvent(base, "s1", visitorEvent({ eventId: "event2" }));
    release();
    await first;

    expect(second.status).toBe(409);
    expect(seen).toContainEqual({ kind: "busy", sessionKey: "s1", eventId: "event2" });
  });
});
