import { describe, expect, it, vi } from "vitest";
import { validateTree, type FacetTree, type ServerMessage } from "@facet/core";
import { FacetRuntime } from "@facet/runtime";

const { generatePageMock } = vi.hoisted(() => ({ generatePageMock: vi.fn() }));
vi.mock("./generator.js", () => ({ generatePage: generatePageMock }));

import { makeLiveAgent } from "./live-agent.js";

const visitor = { visitorId: "visitor" };
const generated: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["copy"] },
    copy: { id: "copy", type: "text", value: "Generated" },
  },
};

const says = (messages: readonly ServerMessage[]): readonly string[] =>
  messages.flatMap((message) => (message.kind === "say" ? [message.text] : []));

describe("playground live agent", () => {
  it("renders the welcome, echoes without an LLM, and handles taps", async () => {
    const runtime = new FacetRuntime({
      agentId: "live",
      agent: makeLiveAgent({ useLlm: false, welcomeSubtitle: "Welcome subtitle" }),
    });
    await runtime.handle(visitor, { kind: "visit", visitor });
    const stage = await runtime.stageFor(visitor.visitorId);
    expect(
      Object.values(stage!.nodes).some(
        (node) => node.type === "text" && node.value === "Welcome subtitle",
      ),
    ).toBe(true);

    const echo = await runtime.handle(visitor, { kind: "message", text: "hello" });
    expect(says(echo.messages)[0]).toMatch(/^echo: hello \(current page: \d+ nodes\)$/);
    const tap = await runtime.handle(visitor, {
      kind: "tap",
      action: { kind: "agent", name: "choose" },
    });
    expect(says(tap.messages)).toEqual(["(you pressed: choose)"]);
    expect(generatePageMock).not.toHaveBeenCalled();
  });

  it("renders clean and repaired LLM results", async () => {
    generatePageMock
      .mockResolvedValueOnce({ tree: generated, issues: [] })
      .mockResolvedValueOnce({ tree: generated, issues: ["one", "two"] });
    const runtime = new FacetRuntime({
      agentId: "live",
      agent: makeLiveAgent({ useLlm: true, welcomeSubtitle: "Welcome" }),
    });

    const clean = await runtime.handle(visitor, { kind: "message", text: "build" });
    expect(says(clean.messages)).toEqual(["Here's your page."]);
    expect(validateTree(await runtime.stageFor(visitor.visitorId)).tree).toEqual(generated);

    const repaired = await runtime.handle(visitor, { kind: "message", text: "repair" });
    expect(says(repaired.messages)).toEqual(["Built (repaired 2 issue(s))."]);
  });

  it("turns generator failures into bounded chat feedback", async () => {
    generatePageMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const runtime = new FacetRuntime({
      agentId: "live",
      agent: makeLiveAgent({ useLlm: true, welcomeSubtitle: "Welcome" }),
    });

    const failed = await runtime.handle(visitor, { kind: "message", text: "build" });
    expect(says(failed.messages)).toEqual(["Sorry — generation failed: provider unavailable"]);
  });
});
