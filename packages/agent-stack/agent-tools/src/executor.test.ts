import { describe, expect, it } from "vitest";
import type { FacetStamp, FacetTree, JsonPatchOperation } from "@facet/core";
import { executeStageTool } from "./executor.js";

const ROOT_TREE: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: [] },
  },
};

const TREE_WITH_TEXT: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["title"] },
    title: { id: "title", type: "text", value: "Title" },
  },
};

describe("executeStageTool", () => {
  it("valid append returns an ok observation patch metadata and updated shadow", () => {
    const result = executeStageTool(
      {
        id: "call-1",
        name: "append_node",
        input: {
          parentId: "root",
          ["node"]: { id: "greeting", type: "text", value: "Hello" },
        },
      },
      { shadow: ROOT_TREE },
    );

    const expectedPatches: readonly JsonPatchOperation[] = [
      {
        op: "add",
        path: "/nodes/greeting",
        value: { id: "greeting", type: "text", value: "Hello" },
      },
      { op: "add", path: "/nodes/root/children/-", value: "greeting" },
    ];
    expect(result.status).toBe("ok");
    expect(result.observation).toEqual({
      status: "ok",
      text: 'ok: appended "greeting" under "root"',
    });
    expect(result.messages).toEqual([{ kind: "patch", patches: expectedPatches }]);
    expect(result.patches).toEqual(expectedPatches);
    expect(result.changedNodeIds).toEqual(["greeting", "root"]);
    expect(result.patchCount).toBe(2);
    expect(result.summary).toContain("2 patch ops");
    expect(result.summary).toContain("changed 2 nodes: greeting, root");
    expect(result.shadow.nodes["greeting"]).toEqual({
      id: "greeting",
      type: "text",
      value: "Hello",
      style: {},
    });
    expect(result.shadow.nodes["root"]).toEqual({
      id: "root",
      type: "box",
      style: {},
      children: ["greeting"],
    });
    expect(result.issues).toEqual([]);
  });

  it("returns typed no-patch errors for malformed unknown and invalid inputs", () => {
    const malformed = executeStageTool(null, { shadow: ROOT_TREE });
    expect(malformed.status).toBe("error");
    if (malformed.status === "error") expect(malformed.code).toBe("invalid_input");
    expect(malformed.messages).toEqual([]);
    expect(malformed.patches).toEqual([]);
    expect(malformed.patchCount).toBe(0);
    expect(malformed.shadow).toBe(ROOT_TREE);

    const unknown = executeStageTool(
      { id: "call-2", name: "frobnicate", input: {} },
      { shadow: ROOT_TREE },
    );
    expect(unknown.status).toBe("error");
    if (unknown.status === "error") expect(unknown.code).toBe("unknown_tool");
    expect(unknown.observation.text).toContain("unknown tool");
    expect(unknown.patches).toEqual([]);
    expect(unknown.shadow).toBe(ROOT_TREE);

    const invalidParent = executeStageTool(
      {
        id: "call-3",
        name: "append_node",
        input: { parentId: "ghost", ["node"]: { id: "n", type: "text", value: "x" } },
      },
      { shadow: ROOT_TREE },
    );
    expect(invalidParent.status).toBe("error");
    if (invalidParent.status === "error") expect(invalidParent.code).toBe("invalid_parent");
    expect(invalidParent.patches).toEqual([]);
    expect(invalidParent.shadow).toBe(ROOT_TREE);

    const nonBoxParent = executeStageTool(
      {
        id: "call-4",
        name: "append_node",
        input: { parentId: "title", ["node"]: { id: "n", type: "text", value: "x" } },
      },
      { shadow: TREE_WITH_TEXT },
    );
    expect(nonBoxParent.status).toBe("error");
    if (nonBoxParent.status === "error") expect(nonBoxParent.code).toBe("invalid_parent");
    expect(nonBoxParent.patches).toEqual([]);
    expect(nonBoxParent.shadow).toBe(TREE_WITH_TEXT);
  });

  it("rejects root-breaking missing and forbidden-id mutations without patches", () => {
    const setRoot = executeStageTool(
      {
        id: "call-root-set",
        name: "set_node",
        input: { ["node"]: { id: "root", type: "text", value: "oops" } },
      },
      { shadow: TREE_WITH_TEXT },
    );
    expect(setRoot.status).toBe("error");
    expect(setRoot.patches).toEqual([]);
    expect(setRoot.shadow).toBe(TREE_WITH_TEXT);
    expect(setRoot.observation.text).toContain("cannot replace the stage root");

    const removeRoot = executeStageTool(
      { id: "call-root-remove", name: "remove_node", input: { nodeId: "root" } },
      { shadow: TREE_WITH_TEXT },
    );
    expect(removeRoot.status).toBe("error");
    expect(removeRoot.patches).toEqual([]);
    expect(removeRoot.shadow).toBe(TREE_WITH_TEXT);
    expect(removeRoot.observation.text).toContain("cannot remove the stage root");

    const missing = executeStageTool(
      { id: "call-missing-remove", name: "remove_node", input: { nodeId: "ghost" } },
      { shadow: TREE_WITH_TEXT },
    );
    expect(missing.status).toBe("error");
    expect(missing.patches).toEqual([]);
    expect(missing.shadow).toBe(TREE_WITH_TEXT);
    expect(missing.observation.text).toContain('node "ghost" does not exist');

    const forbidden = executeStageTool(
      {
        id: "call-forbidden",
        name: "set_node",
        input: { ["node"]: { id: "__proto__", type: "text", value: "x" } },
      },
      { shadow: TREE_WITH_TEXT },
    );
    expect(forbidden.status).toBe("error");
    expect(forbidden.patches).toEqual([]);
    expect(forbidden.shadow).toBe(TREE_WITH_TEXT);
    expect(forbidden.observation.text).toContain("forbidden");
  });

  it("render_page validates folds a full tree and rejects an unrenderable tree", () => {
    const result = executeStageTool(
      {
        id: "call-5",
        name: "render_page",
        input: {
          tree: {
            root: "root",
            nodes: {
              root: { id: "root", type: "box", children: ["ok", "bad"] },
              ok: { id: "ok", type: "text", value: "OK" },
              bad: { id: "bad", type: "text" },
            },
          },
        },
      },
      { shadow: ROOT_TREE },
    );

    expect(result.status).toBe("ok");
    expect(result.patchCount).toBe(1);
    expect(result.shadow.nodes["ok"]).toEqual({ id: "ok", type: "text", value: "OK", style: {} });
    expect(result.shadow.nodes["bad"]).toBeUndefined();
    expect(result.observation.text).toContain("note:");
    expect(result.issues.some((issue) => issue.includes("text has no string value"))).toBe(true);

    const empty = executeStageTool(
      {
        id: "call-6",
        name: "render_page",
        input: { tree: { root: "root", nodes: { root: { id: "root", type: "box" } } } },
      },
      { shadow: ROOT_TREE },
    );
    expect(empty.status).toBe("error");
    if (empty.status === "error") expect(empty.code).toBe("invalid_tree");
    expect(empty.patches).toEqual([]);
    expect(empty.shadow).toBe(ROOT_TREE);
  });

  it("use_stamp expands a known stamp with fresh ids and appends it under the parent", () => {
    const stamp: FacetStamp = {
      name: "card",
      slots: { title: "Fallback" },
      root: "card",
      nodes: {
        card: { id: "card", type: "box", children: ["title"] },
        title: { id: "title", type: "text", value: "{{title}}" },
      },
    };

    const result = executeStageTool(
      {
        id: "call-7",
        name: "use_stamp",
        input: { name: "card", params: { title: "Hello" }, at: { parent: "root" } },
      },
      { shadow: ROOT_TREE, assets: { stamps: [stamp] } },
    );

    expect(result.status).toBe("ok");
    expect(result.patchCount).toBe(3);
    expect(result.observation.text).toContain('ok: used stamp "card"');
    const rootChildren =
      result.shadow.nodes["root"]?.type === "box" ? result.shadow.nodes["root"].children : [];
    const cardId = rootChildren[0];
    expect(cardId).toBeDefined();
    expect(cardId).not.toBe("card");
    const card = cardId === undefined ? undefined : result.shadow.nodes[cardId];
    expect(card?.type).toBe("box");
    const titleId = card?.type === "box" ? card.children[0] : undefined;
    expect(titleId).toBeDefined();
    expect(titleId).not.toBe("title");
    expect(titleId === undefined ? undefined : result.shadow.nodes[titleId]).toMatchObject({
      type: "text",
      value: "Hello",
    });
  });

  it("set_node remove_node say and set_theme emit existing stage tool messages", () => {
    const set = executeStageTool(
      {
        id: "call-8",
        name: "set_node",
        input: { ["node"]: { id: "title", type: "text", value: "T" } },
      },
      { shadow: ROOT_TREE },
    );
    expect(set.status).toBe("ok");
    expect(set.patches).toEqual([
      { op: "add", path: "/nodes/title", value: { id: "title", type: "text", value: "T" } },
    ]);

    const removed = executeStageTool(
      { id: "call-9", name: "remove_node", input: { nodeId: "title" } },
      { shadow: TREE_WITH_TEXT },
    );
    expect(removed.status).toBe("ok");
    expect(removed.patches).toEqual([{ op: "remove", path: "/nodes/title" }]);
    expect(removed.shadow.nodes["title"]).toBeUndefined();

    const say = executeStageTool(
      { id: "call-10", name: "say", input: { text: "Done" } },
      { shadow: ROOT_TREE },
    );
    expect(say.status).toBe("ok");
    expect(say.messages).toEqual([{ kind: "say", text: "Done" }]);
    expect(say.patches).toEqual([]);
    expect(say.shadow).toBe(ROOT_TREE);

    const theme = executeStageTool(
      { id: "call-11", name: "set_theme", input: { name: "midnight" } },
      { shadow: ROOT_TREE },
    );
    expect(theme.status).toBe("ok");
    expect(theme.patches).toEqual([{ op: "add", path: "/theme", value: "midnight" }]);
    expect(theme.shadow.theme).toBe("midnight");

    const invalidTheme = executeStageTool(
      { id: "call-12", name: "set_theme", input: { name: "Ocean Breeze" } },
      { shadow: ROOT_TREE },
    );
    expect(invalidTheme.status).toBe("error");
    if (invalidTheme.status === "error") expect(invalidTheme.code).toBe("invalid_input");
    expect(invalidTheme.patches).toEqual([]);
    expect(invalidTheme.shadow).toBe(ROOT_TREE);
  });

  it("escapes slash and tilde node ids in JSON Patch paths", () => {
    const result = executeStageTool(
      {
        id: "call-escaped-id",
        name: "set_node",
        input: { ["node"]: { id: "a/b~c", type: "text", value: "escaped" } },
      },
      { shadow: ROOT_TREE },
    );

    expect(result.status).toBe("ok");
    expect(result.patches).toEqual([
      { op: "add", path: "/nodes/a~1b~0c", value: { id: "a/b~c", type: "text", value: "escaped" } },
    ]);
    expect(result.shadow.nodes["a/b~c"]).toMatchObject({ type: "text", value: "escaped" });
  });

  it("inspect_stage and inspect_node are bounded no-patch observations", () => {
    const nodes: FacetTree["nodes"] = {
      root: { id: "root", type: "box", children: ["a", "b", "c", "d"] },
      a: { id: "a", type: "box", children: ["aa"] },
      aa: { id: "aa", type: "text", value: "nested" },
      b: { id: "b", type: "text", value: "B" },
      c: { id: "c", type: "text", value: "C" },
      d: { id: "d", type: "text", value: "D" },
    };
    const tree: FacetTree = { root: "root", nodes };

    const stage = executeStageTool(
      { id: "call-13", name: "inspect_stage", input: { maxNodes: 3 } },
      { shadow: tree },
    );
    expect(stage.status).toBe("ok");
    expect(stage.messages).toEqual([]);
    expect(stage.patches).toEqual([]);
    expect(stage.patchCount).toBe(0);
    expect(stage.shadow).toBe(tree);
    expect(stage.observation.text).toContain("showing 3/6 nodes");
    expect(stage.observation.text).toContain("root");
    expect(stage.observation.text).not.toContain("d text");

    const node = executeStageTool(
      { id: "call-14", name: "inspect_node", input: { nodeId: "root", depth: 1 } },
      { shadow: tree },
    );
    expect(node.status).toBe("ok");
    expect(node.patches).toEqual([]);
    expect(node.shadow).toBe(tree);
    expect(node.observation.text).toContain("root box");
    expect(node.observation.text).toContain("a box");
    expect(node.observation.text).not.toContain("aa text");
  });

  it("bounds high-fanout inspect_node and missing-child observations", () => {
    const children = Array.from({ length: 6000 }, (_, index) => `child-${String(index)}`);
    const tree: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children },
        ...Object.fromEntries(children.map((id) => [id, { id, type: "text" as const, value: id }])),
      },
    };

    const inspect = executeStageTool(
      { id: "call-inspect-wide", name: "inspect_node", input: { nodeId: "root", depth: 1 } },
      { shadow: tree },
    );
    expect(inspect.status).toBe("ok");
    expect(inspect.patches).toEqual([]);
    expect(inspect.observation.text).toContain("showing 200 node(s) (truncated)");
    expect(inspect.observation.text).not.toContain("child-5999");
    expect(inspect.observation.text.length).toBeLessThan(10000);

    const missingChildren = executeStageTool(
      {
        id: "call-missing-children",
        name: "set_node",
        input: { ["node"]: { id: "wide", type: "box", children } },
      },
      { shadow: ROOT_TREE },
    );
    expect(missingChildren.status).toBe("error");
    expect(missingChildren.patches).toEqual([]);
    expect(missingChildren.observation.text).toContain("+5980 more");
    expect(missingChildren.observation.text).not.toContain("child-5999");
    expect(missingChildren.observation.text.length).toBeLessThan(1000);
  });
});
