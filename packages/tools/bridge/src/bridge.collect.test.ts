import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_TREE, type ClientEvent, type FacetAgent, type FacetSession } from "@facet/core";
import type { Bridge } from "./bridge.js";

const hoisted = vi.hoisted(() => ({
  connectedAgent: undefined as FacetAgent | undefined,
  closeDriver: vi.fn(),
}));

vi.mock("@facet/agent-client", () => ({
  connectAgent: (opts: { agent: FacetAgent }) => {
    hoisted.connectedAgent = opts.agent;
    return { close: (): void => {} };
  },
}));

vi.mock("./persistent.js", () => ({
  createPersistentDriver: () => ({
    agent: async function* () {
      yield [{ kind: "say", text: "one" }];
      yield [{ kind: "say", text: "two" }];
    },
    close: hoisted.closeDriver,
  }),
}));

const { createBridge } = await import("./bridge.js");

const event: ClientEvent = { kind: "message", text: "hi" };
const session: FacetSession = {
  agentId: "live",
  visitor: { visitorId: "v" },
  stage: EMPTY_TREE,
};

const openBridges: Bridge[] = [];

afterEach(() => {
  for (const bridge of openBridges) bridge.close();
  openBridges.length = 0;
  hoisted.connectedAgent = undefined;
  hoisted.closeDriver.mockClear();
});

describe("createBridge persistent boundary", () => {
  it("collects an async iterable driver result before reporting change length", async () => {
    const events: Array<{ kind: string; visitorId: string; changes: number }> = [];
    const bridge = createBridge({
      runner: "persistent",
      onEvent: (kind, visitorId, changes) => events.push({ kind, visitorId, changes }),
    });
    openBridges.push(bridge);

    const result = await hoisted.connectedAgent!(event, session);

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) throw new Error("expected collected messages");
    expect(result).toEqual([
      { kind: "say", text: "one" },
      { kind: "say", text: "two" },
    ]);
    expect(events).toEqual([{ kind: "message", visitorId: "v", changes: 2 }]);
  });
});
