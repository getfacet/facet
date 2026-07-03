import { describe, expect, it } from "vitest";
import { EMPTY_TREE, STAGE_SPEC } from "@facet/core";
import type { ClientEvent, FacetSession, ServerMessage } from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import {
  DEFAULT_GUIDE,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
} from "./prompt.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "v1" },
  stage: EMPTY_TREE,
};

function stored(text: string, messages: readonly ServerMessage[]): StoredEvent {
  return { at: 0, event: { kind: "message", text }, messages };
}

describe("buildSystem", () => {
  it("contains STAGE_SPEC verbatim, the tool workflow, and the guide under PAGE BRIEF", () => {
    const guide = "# My shop\n\nSell exactly one teapot.";
    const system = buildSystem(guide);
    expect(system).toContain(STAGE_SPEC);
    expect(system).toContain(guide);
    expect(system).toContain("PAGE BRIEF");
    // The workflow tells the model to build via tools, not prose.
    expect(system).toMatch(/render_page/);
    expect(system).toMatch(/append_node|set_node/);
    expect(system).toMatch(/reuse .*node ids/i);
  });

  it("exports a non-empty DEFAULT_GUIDE and HISTORY_TURNS = 20", () => {
    expect(DEFAULT_GUIDE.length).toBeGreaterThan(0);
    expect(HISTORY_TURNS).toBe(20);
  });
});

describe("TOOLS", () => {
  it("offers the five Stage-mapped tools with schemas", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(["append_node", "remove_node", "render_page", "say", "set_node"]);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters["type"]).toBe("object");
    }
  });
});

describe("buildInitialMessages", () => {
  it("caps history at the given limit, dropping the oldest", () => {
    const history: StoredEvent[] = [];
    for (let i = 0; i < 25; i += 1) {
      history.push(stored(`m${i}`, [{ kind: "say", text: `r${i}` }]));
    }
    const event: ClientEvent = { kind: "message", text: "now" };
    const messages = buildInitialMessages(event, SESSION, history, HISTORY_TURNS);

    // 20 history turns × (user + assistant) + the final user message
    expect(messages.length).toBe(HISTORY_TURNS * 2 + 1);
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).not.toContain("m4");
    expect(all).toContain("m5");
    expect(all).toContain("m24");
  });

  it("replays no history when the limit is 0 (or negative)", () => {
    const history = [stored("old", [{ kind: "say", text: "reply" }])];
    const event: ClientEvent = { kind: "message", text: "now" };
    for (const limit of [0, -5]) {
      const messages = buildInitialMessages(event, SESSION, history, limit);
      expect(messages.length).toBe(1);
      expect("content" in messages[0]! ? messages[0].content : "").not.toContain("old");
    }
  });

  it("renders an action event's name, payload, and fields into the final user message", () => {
    const event: ClientEvent = {
      kind: "action",
      action: { kind: "agent", name: "submit", payload: { plan: "pro" }, collect: "signup" },
      fields: { name: "Hoon", email: "hoon@example.com" },
    };
    const messages = buildInitialMessages(event, SESSION, [], HISTORY_TURNS);
    const final = messages[messages.length - 1]!;
    const content = "content" in final ? final.content : "";
    expect(content).toContain("submit");
    expect(content).toContain("pro");
    expect(content).toContain("Hoon");
    expect(content).toContain("hoon@example.com");
    expect(content).toContain(`CURRENT STAGE: ${JSON.stringify(SESSION.stage)}`);
  });

  it("renders navigate/toggle history events and marks patches as (page updated)", () => {
    const history: StoredEvent[] = [
      { at: 0, event: { kind: "action", action: { kind: "navigate", to: "about" } }, messages: [] },
      {
        at: 1,
        event: { kind: "action", action: { kind: "toggle", target: "menu" } },
        messages: [{ kind: "patch", patches: [] }],
      },
    ];
    const event: ClientEvent = { kind: "message", text: "now" };
    const messages = buildInitialMessages(event, SESSION, history, HISTORY_TURNS);
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).toContain("navigate to=about");
    expect(all).toContain("toggle target=menu");
    expect(all).toContain("(no reply)"); // navigate turn had no messages
    expect(all).toContain("(page updated)"); // toggle turn had a patch
  });

  it("renders a visit event's non-secret context but never the visitorId bearer key", () => {
    const event: ClientEvent = {
      kind: "visit",
      visitor: { visitorId: "secret-session-key-123", referrer: "news.ycombinator.com" },
    };
    const messages = buildInitialMessages(event, SESSION, [], HISTORY_TURNS);
    const content = "content" in messages[0]! ? messages[0].content : "";
    expect(content).toContain("visit");
    expect(content).toContain("news.ycombinator.com");
    expect(content).not.toContain("secret-session-key-123");
  });
});
