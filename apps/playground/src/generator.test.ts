import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
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

describe("generator renderability", () => {
  it("describes generation with final bricks and optional references", () => {
    const source = readFileSync(new URL("./gen.ts", import.meta.url), "utf8");
    const copy = source.replace(/\s*\n\s*\*\s*/g, " ");

    expect(copy).toMatch(/closed brick vocabulary/i);
    expect(copy).toMatch(/optionally informed[^.]*reference datasets/i);
    expect(copy).not.toMatch(/component\s*(?:→|->)\s*primitive/i);
  });

  it("accepts a renderable native box root without retrying", async () => {
    mockClaudeResponse(renderableBoxTree("Ready"));
    mockClaudeResponse(renderableBoxTree("fallback"));

    const result = await generatePage("make a dashboard");

    expect(result.tree.nodes[result.tree.root]).toMatchObject({ type: "box" });
    expect(result.tree.nodes["text"]).toMatchObject({ type: "text", value: "Ready" });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["text", { id: "root", type: "text", value: "Loose copy" }],
    ["loading", { id: "root", type: "loading", label: "Loading" }],
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
  ])("keeps retrying when a non-container brick %s is the root", async (_type, root) => {
    mockClaudeResponse({ root: "root", nodes: { root } });
    mockClaudeResponse(renderableBoxTree("fallback"));

    const result = await generatePage("make a dashboard");

    expect(result.tree.nodes[result.tree.root]).toMatchObject({ type: "box" });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
