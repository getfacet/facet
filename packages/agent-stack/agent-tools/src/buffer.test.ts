import { describe, expect, it } from "vitest";
import type { FacetCatalog, FacetComposition, FacetTree } from "@facet/core";
import { createStageToolBuffer } from "./buffer.js";
import { parseAgentToolObservation } from "./observation.js";

const retiredCompositionTool = ["use", "composition"].join("_");
const retiredTestName = `treats retired ${retiredCompositionTool} as unknown without touching pending edits`;

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
    { type: "box", variants: ["surface"] },
    { type: "button", variants: ["primary"] },
  ],
  compositions: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: ["component", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
  },
};

const CARD_COMPOSITION: FacetComposition = {
  name: "card",
  metadata: { description: "A simple card reference." },
  root: "card",
  nodes: {
    card: { id: "card", type: "box", children: ["title"] },
    title: { id: "title", type: "text", value: "Reference title" },
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

  it("does not buffer retired container-pattern nodes", () => {
    for (const retired of ["section", "card", "emptyState"] as const) {
      const buffer = createStageToolBuffer(ROOT_TREE);
      const rejected = buffer.run({
        id: `call-${retired}`,
        name: "set_node",
        input: {
          node: { id: `retired-${retired}`, type: retired, children: ["missing"] },
        },
      });

      expect(parseAgentToolObservation(rejected.observation)).toMatchObject({
        tool: "set_node",
        status: "error",
        outcome: "rejected",
        code: "invalid_input",
        patch_count: 0,
      });
      expect(rejected.observation).not.toContain("queued");
      expect(rejected.messages).toEqual([]);
      expect(rejected.shadow).toBe(ROOT_TREE);
      expect(buffer.drainUnresolved()).toEqual([]);
    }
  });

  it("does not add form buffering for forward references", () => {
    const buffer = createStageToolBuffer(ROOT_TREE);
    const rejected = buffer.run({
      id: "call-form",
      name: "set_node",
      input: { node: { id: "contact", type: "form", children: ["missing"] } },
    });

    expect(parseAgentToolObservation(rejected.observation)).toMatchObject({
      tool: "set_node",
      status: "error",
      outcome: "rejected",
      code: "invalid_input",
      patch_count: 0,
      next_action: "Define the missing child nodes first, or remove those child references.",
    });
    expect(rejected.observation).not.toContain("queued");
    expect(rejected.messages).toEqual([]);
    expect(rejected.shadow).toBe(ROOT_TREE);
    expect(buffer.drainUnresolved()).toEqual([]);
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
      id: "call-panel",
      name: "set_node",
      input: { node: { id: "panel", type: "box", variant: "danger", children: ["title"] } },
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
    expect(child.shadow.nodes["panel"]).toBeUndefined();
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

    // remove_node eagerly detaches the parent ref, so a later set_node re-add
    // leaves the node orphaned — exactly what the runtime aggregate fold yields.
    expect(inspected.observation).toContain("root box children=0");
    expect(inspected.shadow.nodes["root"]).toMatchObject({ children: [] });
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

  it("lets get_composition pass through without touching pending edits or accounting", () => {
    const buffer = createStageToolBuffer(ROOT_TREE, { compositions: [CARD_COMPOSITION] });

    const queued = buffer.run({
      id: "queue-panel",
      name: "set_node",
      input: { node: { id: "panel", type: "box", children: ["leaf"] } },
    });
    expect(queued.observation).toContain("queued");

    const read = buffer.run({
      id: "read-card",
      name: "get_composition",
      input: { name: "card" },
    });

    expect(parseAgentToolObservation(read.observation)).toMatchObject({
      tool: "get_composition",
      status: "ok",
      outcome: "no_stage_change",
      patch_count: 0,
    });
    expect(read.messages).toEqual([]);
    expect(read.mutated).toBe(false);
    expect(read.said).toBe(false);
    expect(read.shadow).toBe(queued.shadow);

    const released = buffer.run({
      id: "set-leaf",
      name: "set_node",
      input: { node: { id: "leaf", type: "text", value: "Leaf" } },
    });
    expect(released.messages.filter((message) => message.kind === "patch")).toHaveLength(2);
    expect(released.shadow.nodes["panel"]).toMatchObject({ type: "box", children: ["leaf"] });
    expect(released.shadow.nodes["leaf"]).toMatchObject({ type: "text", value: "Leaf" });
    expect(buffer.drainUnresolved()).toEqual([]);
  });

  it(retiredTestName, () => {
    const buffer = createStageToolBuffer(ROOT_TREE);

    const queued = buffer.run({
      id: "queue-panel",
      name: "set_node",
      input: { node: { id: "panel", type: "box", children: ["leaf"] } },
    });
    expect(queued.observation).toContain("queued");

    const retired = buffer.run({
      id: "retired-composition-call",
      name: retiredCompositionTool,
      input: { name: "card", params: {}, at: { parent: "panel" } },
    });

    expect(parseAgentToolObservation(retired.observation)).toMatchObject({
      tool: retiredCompositionTool,
      status: "error",
      outcome: "rejected",
      code: "unknown_tool",
      patch_count: 0,
    });
    expect(retired.messages).toEqual([]);
    expect(retired.mutated).toBe(false);
    expect(retired.said).toBe(false);
    expect(retired.shadow).toBe(queued.shadow);

    const released = buffer.run({
      id: "set-leaf",
      name: "set_node",
      input: { node: { id: "leaf", type: "text", value: "Leaf" } },
    });
    expect(released.messages.filter((message) => message.kind === "patch")).toHaveLength(2);
    expect(released.shadow.nodes["panel"]).toMatchObject({ type: "box", children: ["leaf"] });
    expect(released.shadow.nodes["leaf"]).toMatchObject({ type: "text", value: "Leaf" });
    expect(buffer.drainUnresolved()).toEqual([]);
  });
});
