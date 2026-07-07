import { describe, expect, it } from "vitest";
import { MAX_PATCH_OPS, type FacetTree } from "@facet/core";
import { createStageToolBuffer } from "./buffer.js";

const ROOT_TREE: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: [] },
  },
};

const TREE_WITH_CHILD: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["a"] },
    a: { id: "a", type: "text", value: "A" },
  },
};

describe("createStageToolBuffer", () => {
  it("buffers forward-referenced box edits until child nodes exist", () => {
    const buffer = createStageToolBuffer(ROOT_TREE);

    const queued = buffer.run({
      id: "call-parent",
      name: "set_node",
      input: { node: { id: "card", type: "box", children: ["title"] } },
    });
    expect(queued.observation).toContain("queued");
    expect(queued.messages).toEqual([]);

    const child = buffer.run({
      id: "call-child",
      name: "set_node",
      input: { node: { id: "title", type: "text", value: "Hello" } },
    });

    const patchMessages = child.messages.filter((message) => message.kind === "patch");
    expect(patchMessages).toHaveLength(2);
    expect(child.shadow.nodes["card"]).toMatchObject({ type: "box", children: ["title"] });
    expect(child.shadow.nodes["title"]).toMatchObject({ type: "text", value: "Hello" });
  });

  it("keeps local shadow aligned with runtime aggregate patch folding", () => {
    const buffer = createStageToolBuffer(TREE_WITH_CHILD);

    buffer.run({ id: "remove-a", name: "remove_node", input: { nodeId: "a" } });
    buffer.run({
      id: "set-a",
      name: "set_node",
      input: { node: { id: "a", type: "text", value: "A2" } },
    });
    const inspected = buffer.run({
      id: "inspect-root",
      name: "inspect_node",
      input: { nodeId: "root", depth: 1 },
    });

    expect(inspected.observation).toContain("root box children=1");
    expect(inspected.shadow.nodes["root"]).toMatchObject({ children: ["a"] });
    expect(inspected.shadow.nodes["a"]).toMatchObject({ value: "A2" });
  });

  it("rejects a tool call before the streamed batch exceeds the aggregate patch cap", () => {
    const buffer = createStageToolBuffer(ROOT_TREE);
    const okCalls = Math.floor(MAX_PATCH_OPS / 2);

    for (let index = 0; index < okCalls; index += 1) {
      const result = buffer.run({
        id: `ok-${String(index)}`,
        name: "append_node",
        input: {
          parentId: "root",
          node: { id: `n${String(index)}`, type: "text", value: String(index) },
        },
      });
      expect(result.observation).toContain("ok: appended");
    }

    const capped = buffer.run({
      id: "over-cap",
      name: "append_node",
      input: { parentId: "root", node: { id: "too-many", type: "text", value: "cap" } },
    });

    expect(capped.observation).toContain("would exceed the patch op cap");
    expect(capped.messages).toEqual([]);
    expect(capped.shadow.nodes["too-many"]).toBeUndefined();
  });
});
