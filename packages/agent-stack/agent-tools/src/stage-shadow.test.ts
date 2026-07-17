import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE,
  MAX_PATCH_OPS,
  type FacetTree,
  type JsonPatchOperation,
  type ServerMessage,
} from "@facet/core";
import { foldStageShadow, summarizeStageTree } from "./stage-shadow.js";

const ROOT_BOX: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: [] },
  },
};

describe("foldStageShadow", () => {
  it("stores no document Theme", () => {
    const legacyTree = { ...ROOT_BOX, theme: "legacy-brand" } as FacetTree & {
      readonly theme: string;
    };

    expect(summarizeStageTree(legacyTree)).toEqual({
      root: "root",
      nodeCount: 1,
      screenCount: 0,
    });
  });

  it("folds patch messages through foldPatchIntoStage", () => {
    const patches: JsonPatchOperation[] = [
      {
        op: "replace",
        path: "",
        value: {
          root: "root",
          nodes: {
            root: { id: "root", type: "text", value: "not a valid stage root" },
          },
        },
      },
    ];

    const result = foldStageShadow(ROOT_BOX, [{ kind: "patch", patches }]);

    expect(result.shadow).toEqual(EMPTY_TREE);
    expect(result.issues.some((issue) => issue.includes("root node must be a container"))).toBe(
      true,
    );
    expect(result.patches).toEqual(patches);
    expect(result.patchCount).toBe(1);
    expect(result.changedNodeIds).toEqual(["root"]);
    expect(result.summary).toContain("1 patch op");
  });

  it("ignores non-patch messages", () => {
    const messages: ServerMessage[] = [{ kind: "say", text: "hello" }, { kind: "reset" }];

    const result = foldStageShadow(ROOT_BOX, messages);

    expect(result.shadow).toEqual(ROOT_BOX);
    expect(result.patches).toEqual([]);
    expect(result.patchCount).toBe(0);
    expect(result.changedNodeIds).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.summary).toBe("no stage changes");
  });

  it("summarizes changed node ids and tree shape", () => {
    const patches: JsonPatchOperation[] = [
      { op: "add", path: "/nodes/greeting", value: { id: "greeting", type: "text", value: "Hi" } },
      { op: "add", path: "/nodes/root/children/-", value: "greeting" },
    ];

    const result = foldStageShadow(ROOT_BOX, [{ kind: "patch", patches }]);

    expect(result.shadow.nodes["greeting"]).toMatchObject({ type: "text", value: "Hi" });
    expect(result.changedNodeIds).toEqual(["greeting", "root"]);
    expect(result.summary).toContain("2 patch ops");
    expect(result.summary).toContain("changed 2 nodes: greeting, root");
    expect(summarizeStageTree(result.shadow)).toEqual({
      root: "root",
      nodeCount: 2,
      screenCount: 0,
    });
  });

  it("does not spread huge patch batches before the fold cap", () => {
    const patches: JsonPatchOperation[] = Array.from({ length: MAX_PATCH_OPS + 100_000 }, () => ({
      op: "add",
      path: "/nodes/root/children/-",
      value: "x",
    }));

    const result = foldStageShadow(ROOT_BOX, [{ kind: "patch", patches }]);

    expect(result.shadow).toEqual(ROOT_BOX);
    expect(result.patches).toEqual([]);
    expect(result.patchCount).toBe(0);
    expect(result.issues.some((issue) => issue.includes("cap"))).toBe(true);
    expect(result.summary).toContain("fold issue");
  });
});
