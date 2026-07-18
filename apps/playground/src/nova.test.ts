import { describe, expect, it } from "vitest";
import { validateTree, type ServerMessage } from "@facet/core";
import { FacetRuntime } from "@facet/runtime";
import { nova } from "./nova.js";

const says = (messages: readonly ServerMessage[]): readonly string[] =>
  messages.flatMap((message) => (message.kind === "say" ? [message.text] : []));

const textValues = (nodes: Readonly<Record<string, unknown>>): readonly string[] =>
  Object.values(nodes).flatMap((node) => {
    if (typeof node !== "object" || node === null) return [];
    const value = (node as Record<string, unknown>)["value"];
    return typeof value === "string" ? [value] : [];
  });

describe("Nova playground agent", () => {
  it("personalizes visits per visitor and emits valid trees", async () => {
    const runtime = new FacetRuntime({ agentId: "nova", agent: nova });
    await runtime.handle(
      { visitorId: "twitter" },
      { kind: "visit", visitor: { visitorId: "twitter", referrer: "https://twitter.com/facet" } },
    );
    await runtime.handle(
      { visitorId: "direct" },
      { kind: "visit", visitor: { visitorId: "direct" } },
    );

    const twitter = await runtime.stageFor("twitter");
    const direct = await runtime.stageFor("direct");
    expect(twitter).toBeDefined();
    expect(direct).toBeDefined();
    expect(textValues(twitter!.nodes)).toContain(
      "Saw you came from Twitter — here's the short version.",
    );
    expect(textValues(direct!.nodes)).toContain(
      "Ask me anything, and this page rebuilds itself for you.",
    );
    expect(validateTree(twitter).issues.filter((issue) => issue.includes("dropped"))).toEqual([]);
    expect(validateTree(direct).issues.filter((issue) => issue.includes("dropped"))).toEqual([]);
  });

  it("handles pricing, ordinary messages, and taps", async () => {
    const runtime = new FacetRuntime({ agentId: "nova", agent: nova });
    const visitor = { visitorId: "visitor" };
    await runtime.handle(visitor, { kind: "visit", visitor });

    const pricing = await runtime.handle(visitor, { kind: "message", text: "가격 알려줘" });
    expect(says(pricing.messages)).toEqual(["Added the pricing card below 👇"]);
    const stage = await runtime.stageFor(visitor.visitorId);
    expect(textValues(stage!.nodes)).toEqual(
      expect.arrayContaining(["Pro", "$20/mo — everything, no limits."]),
    );

    const ordinary = await runtime.handle(visitor, { kind: "message", text: "hello" });
    expect(says(ordinary.messages)).toEqual(['You said: "hello". Try asking about "pricing".']);

    const tap = await runtime.handle(visitor, {
      kind: "tap",
      action: { kind: "agent", name: "view_pricing" },
    });
    expect(says(tap.messages)).toEqual(["(you pressed: view_pricing)"]);
  });
});
