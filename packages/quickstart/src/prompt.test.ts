import { describe, expect, it } from "vitest";
import { EMPTY_TREE, STAGE_SPEC } from "@facet/core";
import type { ClientEvent, FacetSession, ServerMessage } from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import { DEFAULT_GUIDE, HISTORY_TURNS, buildSystem, buildTurnMessages } from "./prompt.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "v1" },
  stage: EMPTY_TREE,
};

function stored(text: string, messages: readonly ServerMessage[]): StoredEvent {
  return { at: 0, event: { kind: "message", text }, messages };
}

describe("buildSystem", () => {
  it("contains STAGE_SPEC verbatim, the output contract, and the guide under PAGE BRIEF", () => {
    const guide = "# My shop\n\nSell exactly one teapot.";
    const system = buildSystem(guide);
    expect(system).toContain(STAGE_SPEC);
    expect(system).toContain(guide);
    expect(system).toContain("PAGE BRIEF");
    // the fixed output contract
    expect(system).toContain('{"say"');
    expect(system).toContain("ONE JSON object");
    expect(system).toMatch(/reuse .*node ids/i);
    expect(system).toMatch(/collect/);
  });

  it("exports a non-empty DEFAULT_GUIDE and HISTORY_TURNS = 20", () => {
    expect(DEFAULT_GUIDE.length).toBeGreaterThan(0);
    expect(HISTORY_TURNS).toBe(20);
  });
});

describe("buildTurnMessages", () => {
  it("caps history at HISTORY_TURNS, dropping the oldest", () => {
    const history: StoredEvent[] = [];
    for (let i = 0; i < 25; i += 1) {
      history.push(stored(`m${i}`, [{ kind: "say", text: `r${i}` }]));
    }
    const event: ClientEvent = { kind: "message", text: "now" };
    const messages = buildTurnMessages(event, SESSION, history);

    // 20 history turns × (user + assistant) + the final user message
    expect(messages.length).toBe(HISTORY_TURNS * 2 + 1);
    const all = messages.map((m) => m.content).join("\n");
    expect(all).not.toContain("m4");
    expect(all).toContain("m5");
    expect(all).toContain("m24");
    expect(all).toContain("r24");
  });

  it("alternates user/assistant lines and marks patches as (page updated)", () => {
    const history = [
      stored("hello", [
        { kind: "say", text: "hi back" },
        { kind: "patch", patches: [] },
      ]),
    ];
    const event: ClientEvent = { kind: "message", text: "now" };
    const messages = buildTurnMessages(event, SESSION, history);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain("hello");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toContain("hi back");
    expect(messages[1]?.content).toContain("(page updated)");
    expect(messages[2]?.role).toBe("user");
  });

  it("renders an action event's name, payload, and fields into the final user message", () => {
    const event: ClientEvent = {
      kind: "action",
      action: { kind: "agent", name: "submit", payload: { plan: "pro" }, collect: "signup" },
      fields: { name: "Hoon", email: "hoon@example.com" },
    };
    const messages = buildTurnMessages(event, SESSION, []);
    const final = messages[messages.length - 1];
    expect(final?.role).toBe("user");
    expect(final?.content).toContain("submit");
    expect(final?.content).toContain("pro");
    expect(final?.content).toContain("Hoon");
    expect(final?.content).toContain("hoon@example.com");
  });

  it("appends the current stage JSON to the final user message", () => {
    const event: ClientEvent = { kind: "message", text: "make it blue" };
    const messages = buildTurnMessages(event, SESSION, []);
    const final = messages[messages.length - 1];
    expect(final?.content).toContain(`CURRENT STAGE: ${JSON.stringify(SESSION.stage)}`);
  });

  it("renders a visit event with the visitor context", () => {
    const event: ClientEvent = {
      kind: "visit",
      visitor: { visitorId: "v1", referrer: "news.ycombinator.com" },
    };
    const messages = buildTurnMessages(event, SESSION, []);
    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain("visit");
    expect(messages[0]?.content).toContain("v1");
    expect(messages[0]?.content).toContain("news.ycombinator.com");
  });

  it("renders a message event as its text", () => {
    const event: ClientEvent = { kind: "message", text: "show me the menu" };
    const messages = buildTurnMessages(event, SESSION, []);
    expect(messages[0]?.content).toContain("show me the menu");
  });
});
