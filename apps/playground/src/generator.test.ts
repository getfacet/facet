import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { extractJson, generatePage } from "./generator.js";

const tree = { root: "root", nodes: { root: { id: "root", type: "box", children: [] } } };

function mockClaudeResponse(output: unknown): void {
  spawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    Object.assign(child, { stdout, stderr });
    queueMicrotask(() => {
      stdout.emit("data", JSON.stringify(output));
      child.emit("close", 0);
    });
    return child;
  });
}

function renderableBoxTree(label: string): unknown {
  return {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["text"] },
      text: { id: "text", type: "text", value: label },
    },
  };
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("extractJson", () => {
  it("parses a clean tree", () => {
    expect(extractJson(JSON.stringify(tree))).toEqual(tree);
  });

  it("ignores a trailing sentence after the tree", () => {
    expect(extractJson(`${JSON.stringify(tree)}\n\nHere's your page!`)).toEqual(tree);
  });

  it("ignores prose before the tree", () => {
    expect(extractJson(`Sure, here you go:\n${JSON.stringify(tree)}`)).toEqual(tree);
  });

  it("strips markdown code fences", () => {
    expect(extractJson("```json\n" + JSON.stringify(tree) + "\n```")).toEqual(tree);
  });

  it("picks the stage tree over a leading preamble object", () => {
    // The regression: a small non-tree object emitted before the real tree made
    // the first-object extractor pick the wrong one, yielding an empty page.
    expect(extractJson(`{"thinking":"a coffee page"}\n${JSON.stringify(tree)}`)).toEqual(tree);
  });

  it("is not fooled by a brace inside a string value", () => {
    const withBrace = {
      root: "root",
      nodes: { root: { id: "root", type: "text", value: "a } b" } },
    };
    expect(extractJson(JSON.stringify(withBrace))).toEqual(withBrace);
  });

  it("throws when there is no object at all", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("high-level generator renderability", () => {
  it.each(["section", "card"] as const)(
    "accepts a renderable %s root without retrying",
    async (type) => {
      mockClaudeResponse({
        root: "root",
        nodes: {
          root: { id: "root", type, title: "Overview", children: ["body"] },
          body: { id: "body", type: "text", value: "Ready" },
        },
      });
      mockClaudeResponse(renderableBoxTree("fallback"));

      const result = await generatePage("make a dashboard");

      expect(result.tree.nodes[result.tree.root]).toMatchObject({ type });
      expect(spawnMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["button", { id: "root", type: "button", label: "Open" }],
    ["stat", { id: "root", type: "stat", label: "MRR", value: "$42k" }],
    [
      "table",
      {
        id: "root",
        type: "table",
        caption: "Accounts",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Ada" }],
      },
    ],
  ])("keeps retrying when a non-container high-level %s is the root", async (_type, root) => {
    mockClaudeResponse({ root: "root", nodes: { root } });
    mockClaudeResponse(renderableBoxTree("fallback"));

    const result = await generatePage("make a dashboard");

    expect(result.tree.nodes[result.tree.root]).toMatchObject({ type: "box" });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
