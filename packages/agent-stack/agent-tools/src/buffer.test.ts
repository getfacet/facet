import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_PATCH_OPS,
  type FacetCatalog,
  type FacetComposition,
  type FacetNode,
  type FacetTree,
} from "@facet/core";
import { createStageToolBuffer } from "./buffer.js";
import { parseAgentToolObservation } from "./observation.js";

// Built at runtime so the legacy token never appears as a source literal
// (same idiom as theme.test.ts).
const legacyNaming = new RegExp(["st", "amp"].join(""), "i");

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
  compositions: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: ["composition", "component", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
  },
};

function compositionWithPatchCount(name: string, patchCount: number): FacetComposition {
  const nodeCount = patchCount - 1;
  const children = Array.from({ length: nodeCount - 1 }, (_, index) => `child-${String(index)}`);
  return {
    name,
    root: "composition-root",
    nodes: {
      "composition-root": { id: "composition-root", type: "box", children },
      ...Object.fromEntries(children.map((id) => [id, { id, type: "text" as const, value: id }])),
    },
  };
}

const CARD_COMPOSITION: FacetComposition = {
  name: "card",
  slots: { title: "Fallback" },
  root: "card",
  nodes: {
    card: { id: "card", type: "box", children: ["title"] },
    title: { id: "title", type: "text", value: "{{title}}" },
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

  it("buffers forward-referenced component section and card edits until child nodes exist", () => {
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

  it("buffers appended component card containers under existing component section parents", () => {
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
      input: { node: { id: "badge", type: "text", value: "Live" } },
    });

    const patchMessages = badge.messages.filter((message) => message.kind === "patch");
    expect(patchMessages).toHaveLength(2);
    expect(badge.shadow.nodes["section"]).toMatchObject({ children: ["card"] });
    expect(badge.shadow.nodes["card"]).toMatchObject({ type: "card", children: ["badge"] });
    expect(badge.shadow.nodes["badge"]).toMatchObject({ type: "text", value: "Live" });
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

  it("rejects a tool call before the streamed batch exceeds the aggregate patch cap", () => {
    const buffer = createStageToolBuffer(ROOT_TREE, {
      compositions: [compositionWithPatchCount("cap-fill", MAX_PATCH_OPS)],
    });

    const filled = buffer.run({
      id: "fill-cap",
      name: "use_composition",
      input: { name: "cap-fill", params: {}, at: { parent: "root" } },
    });
    expect(parseAgentToolObservation(filled.observation)).toMatchObject({
      tool: "use_composition",
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

  describe("use_composition", () => {
    it("use_composition is the canonical buffered branch with no old-tool compatibility path", () => {
      const source = readFileSync(new URL("./buffer.ts", import.meta.url), "utf8");

      expect(source).toContain('case "use_composition"');
      expect(source).toContain("use_composition — parent");
      expect(source).not.toMatch(legacyNaming);
    });

    it("use_composition reports pending against a buffered parent and emits no message ops", () => {
      const buffer = createStageToolBuffer(ROOT_TREE, { compositions: [CARD_COMPOSITION] });

      const queued = buffer.run({
        id: "queue-panel",
        name: "set_node",
        input: { node: { id: "panel", type: "box", children: ["leaf"] } },
      });
      expect(queued.observation).toContain("queued");

      const pending = buffer.run({
        id: "comp-pending",
        name: "use_composition",
        input: { name: "card", params: { title: "Hi" }, at: { parent: "panel" } },
      });

      expect(pending.messages).toEqual([]);
      expect(pending.mutated).toBe(false);
      expect(pending.said).toBe(false);
      expect(pending.shadow).toBe(queued.shadow);
      const parsed = parseAgentToolObservation(pending.observation);
      expect(parsed).toMatchObject({
        tool: "use_composition",
        status: "pending",
        outcome: "pending",
        code: "pending",
        applied: false,
        stage_changed: false,
        visible_to_visitor: false,
        patch_count: 0,
        next_action: "Define the parent node's missing child node(s), then use the composition.",
      });
      expect(parsed?.message).toContain(
        'use_composition — parent "panel" was created this turn but is still waiting for child node(s): leaf',
      );
    });

    it("use_composition over the cumulative patch cap emits the canonical expanded message and preserves state", () => {
      const buffer = createStageToolBuffer(ROOT_TREE, {
        compositions: [
          compositionWithPatchCount("cap-fill", MAX_PATCH_OPS),
          compositionWithPatchCount("over-cap", 3),
        ],
      });

      const filled = buffer.run({
        id: "fill-cap",
        name: "use_composition",
        input: { name: "cap-fill", params: {}, at: { parent: "root" } },
      });

      const capped = buffer.run({
        id: "comp-over-cap",
        name: "use_composition",
        input: { name: "over-cap", params: {}, at: { parent: "root" } },
      });

      const parsed = parseAgentToolObservation(capped.observation);
      expect(parsed).toMatchObject({
        tool: "use_composition",
        status: "error",
        outcome: "rejected",
        code: "patch_limit",
        patch_count: 0,
      });
      expect(parsed?.message).toBe(
        `error: use_composition — expanded "over-cap" would exceed the patch op cap (${String(
          MAX_PATCH_OPS,
        )}) for this streamed batch`,
      );
      expect(capped.messages).toEqual([]);
      expect(capped.mutated).toBe(false);
      expect(capped.said).toBe(false);
      expect(capped.shadow).toBe(filled.shadow);
    });

    it("hostile use_composition expansion is a bounded no-op that does not poison the buffer", () => {
      const sentinel = new Error("boom");
      Object.defineProperty(sentinel, "message", {
        get(): string {
          throw new Error("SENTINEL_LEAK");
        },
      });
      const hostileComposition = {
        name: "hostile",
        root: "r",
        get nodes(): Readonly<Record<string, FacetNode>> {
          throw sentinel;
        },
      } as unknown as FacetComposition;
      const buffer = createStageToolBuffer(ROOT_TREE, {
        compositions: [hostileComposition, CARD_COMPOSITION],
      });

      const queued = buffer.run({
        id: "queue-panel",
        name: "set_node",
        input: { node: { id: "panel", type: "box", children: ["leaf"] } },
      });
      expect(queued.observation).toContain("queued");

      const hostile = buffer.run({
        id: "comp-hostile",
        name: "use_composition",
        input: { name: "hostile", params: {}, at: { parent: "root" } },
      });

      expect(hostile.messages).toEqual([]);
      expect(hostile.mutated).toBe(false);
      expect(hostile.said).toBe(false);
      expect(hostile.shadow).toBe(queued.shadow);
      expect(parseAgentToolObservation(hostile.observation)).toMatchObject({
        tool: "use_composition",
        status: "error",
        outcome: "rejected",
        code: "invalid_composition",
        patch_count: 0,
      });
      expect(hostile.observation).not.toContain("SENTINEL_LEAK");
      expect(hostile.observation).not.toContain("boom");
      expect(hostile.observation).not.toMatch(
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/,
      );

      const followUp = buffer.run({
        id: "comp-follow",
        name: "use_composition",
        input: { name: "card", params: { title: "Recovered" }, at: { parent: "root" } },
      });
      expect(parseAgentToolObservation(followUp.observation)).toMatchObject({
        tool: "use_composition",
        status: "ok",
        outcome: "applied_visible",
      });
      expect(followUp.mutated).toBe(true);

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
});
