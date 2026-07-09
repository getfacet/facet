import { describe, expect, it } from "vitest";
import { MAX_PATCH_OPS, type FacetCatalog, type FacetStamp, type FacetTree } from "@facet/core";
import { createStageToolBuffer } from "./buffer.js";
import { parseAgentToolObservation } from "./observation.js";

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

const CATALOG_POLICY: FacetCatalog = {
  name: "buffer-policy-test",
  theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
  bricks: [
    { type: "section", variants: ["surface"] },
    { type: "card", variants: ["plain"] },
  ],
  stamps: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: ["stamp", "brick", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
  },
};

function stampWithPatchCount(name: string, patchCount: number): FacetStamp {
  const nodeCount = patchCount - 1;
  const children = Array.from({ length: nodeCount - 1 }, (_, index) => `child-${String(index)}`);
  return {
    name,
    root: "stamp-root",
    nodes: {
      "stamp-root": { id: "stamp-root", type: "box", children },
      ...Object.fromEntries(children.map((id) => [id, { id, type: "text" as const, value: id }])),
    },
  };
}

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

  it("buffers forward-referenced high-level section and card edits until child nodes exist", () => {
    const buffer = createStageToolBuffer(ROOT_TREE);

    const queuedSection = buffer.run({
      id: "call-section",
      name: "set_node",
      input: { node: { id: "section", type: "section", children: ["card"] } },
    });
    expect(queuedSection.observation).toContain("queued");
    expect(queuedSection.messages).toEqual([]);

    const queuedCard = buffer.run({
      id: "call-card",
      name: "set_node",
      input: { node: { id: "card", type: "card", children: ["stat"] } },
    });
    expect(queuedCard.observation).toContain("queued");
    expect(queuedCard.messages).toEqual([]);

    const stat = buffer.run({
      id: "call-stat",
      name: "set_node",
      input: { node: { id: "stat", type: "stat", label: "Revenue", value: "$12k" } },
    });

    const patchMessages = stat.messages.filter((message) => message.kind === "patch");
    expect(patchMessages).toHaveLength(3);
    expect(stat.shadow.nodes["section"]).toMatchObject({
      type: "section",
      children: ["card"],
    });
    expect(stat.shadow.nodes["card"]).toMatchObject({ type: "card", children: ["stat"] });
    expect(stat.shadow.nodes["stat"]).toMatchObject({
      type: "stat",
      label: "Revenue",
      value: "$12k",
    });
  });

  it("buffers appended high-level card containers under existing high-level section parents", () => {
    const buffer = createStageToolBuffer({
      root: "section",
      nodes: {
        section: { id: "section", type: "section", children: [] },
      },
    });

    const queuedCard = buffer.run({
      id: "append-card",
      name: "append_node",
      input: {
        parentId: "section",
        node: { id: "card", type: "card", children: ["badge"] },
      },
    });

    expect(queuedCard.observation).toContain("queued");
    expect(queuedCard.messages).toEqual([]);

    const badge = buffer.run({
      id: "set-badge",
      name: "set_node",
      input: { node: { id: "badge", type: "badge", label: "Live" } },
    });

    const patchMessages = badge.messages.filter((message) => message.kind === "patch");
    expect(patchMessages).toHaveLength(2);
    expect(badge.shadow.nodes["section"]).toMatchObject({ children: ["card"] });
    expect(badge.shadow.nodes["card"]).toMatchObject({ type: "card", children: ["badge"] });
    expect(badge.shadow.nodes["badge"]).toMatchObject({ type: "badge", label: "Live" });
  });

  it("reports pending when a buffered box waits for missing children", () => {
    const buffer = createStageToolBuffer(ROOT_TREE);

    const queued = buffer.run({
      id: "call-parent",
      name: "set_node",
      input: { node: { id: "card", type: "box", children: ["title"] } },
    });

    expect(queued.messages).toEqual([]);
    expect(parseAgentToolObservation(queued.observation)).toMatchObject({
      tool: "set_node",
      status: "pending",
      outcome: "pending",
      applied: false,
      stage_changed: false,
      visible_to_visitor: false,
      next_action: "Define the missing child node(s), then continue the edit.",
    });
  });

  it("rejects catalog-invalid forward-referenced containers instead of buffering them", () => {
    const buffer = createStageToolBuffer(ROOT_TREE, { catalog: CATALOG_POLICY });

    const queued = buffer.run({
      id: "call-card",
      name: "set_node",
      input: { node: { id: "card", type: "card", variant: "danger", children: ["title"] } },
    });

    expect(parseAgentToolObservation(queued.observation)).toMatchObject({
      tool: "set_node",
      status: "error",
      outcome: "rejected",
      patch_count: 0,
    });
    expect(queued.observation).toContain("catalog policy");
    expect(queued.messages).toEqual([]);

    const child = buffer.run({
      id: "call-child",
      name: "set_node",
      input: { node: { id: "title", type: "text", value: "Hello" } },
    });

    expect(child.messages.filter((message) => message.kind === "patch")).toHaveLength(1);
    expect(child.shadow.nodes["card"]).toBeUndefined();
    expect(buffer.drainUnresolved()).toEqual([]);
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

  it("normalizes the next provider step to the runtime-folded stage", () => {
    const buffer = createStageToolBuffer(ROOT_TREE);

    const orphan = buffer.run({
      id: "set-title",
      name: "set_node",
      input: { node: { id: "title", type: "text", value: "Title" } },
    });

    expect(orphan.messages.some((message) => message.kind === "patch")).toBe(true);
    expect(buffer.shadow.nodes["title"]).toMatchObject({ value: "Title", style: {} });

    buffer.resetEmittedPatchOps();

    expect(buffer.shadow.nodes["title"]).toMatchObject({ style: {} });
    const appended = buffer.run({
      id: "append-panel",
      name: "append_node",
      input: {
        parentId: "root",
        node: { id: "panel", type: "box", children: ["title"] },
      },
    });

    expect(parseAgentToolObservation(appended.observation)).toMatchObject({
      tool: "append_node",
      status: "ok",
      outcome: "applied_visible",
    });
    expect(appended.messages.some((message) => message.kind === "patch")).toBe(true);
  });

  it("rejects a tool call before the streamed batch exceeds the aggregate patch cap", () => {
    const buffer = createStageToolBuffer(ROOT_TREE, {
      stamps: [stampWithPatchCount("cap-fill", MAX_PATCH_OPS)],
    });

    const filled = buffer.run({
      id: "fill-cap",
      name: "use_stamp",
      input: { name: "cap-fill", params: {}, at: { parent: "root" } },
    });
    expect(parseAgentToolObservation(filled.observation)).toMatchObject({
      tool: "use_stamp",
      status: "ok",
      outcome: "applied_visible",
      patch_count: MAX_PATCH_OPS,
    });

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
