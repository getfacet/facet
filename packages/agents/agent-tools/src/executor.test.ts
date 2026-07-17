import { describe, expect, it } from "vitest";
import { CHART_KINDS, MAX_CHART_POINTS, MAX_TABLE_ROWS } from "@facet/core";
import type { FacetTheme, FacetTree, JsonPatchOperation } from "@facet/core";
import { executeStageTool as executeStageToolRaw } from "./executor.js";
import * as nodeExecutors from "./executor-node.js";
import { executeAppendNode, executeSetNode } from "./executor-node.js";
import { executeRenderPage } from "./executor-page.js";
import { foldStageShadow } from "./stage-shadow.js";
import { parseAgentToolObservation } from "./observation.js";
import type { StageToolAssets, StageToolContext, StageToolResult } from "./types.js";

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

const AUTHOR_THEME = {
  name: "author-test",
  presets: {
    box: {
      panel: {
        description: "Panel treatment.",
        useWhen: "Use for grouped content.",
        style: { gap: "md", background: "surface" },
      },
    },
    text: {
      heading: {
        description: "Heading treatment.",
        useWhen: "Use for section headings.",
        style: { fontSize: "xl", fontWeight: "bold" },
      },
    },
  },
} as unknown as FacetTheme;

const AUTHOR_ASSETS: StageToolAssets = {
  theme: AUTHOR_THEME,
  patterns: [],
  brickIndex: [],
  presetIndex: [],
  patternIndex: [],
};

function executeStageTool(call: unknown, context: StageToolContext): StageToolResult {
  return executeStageToolRaw(call, {
    ...context,
    assets: context.assets ?? AUTHOR_ASSETS,
  });
}

describe("executeStageTool", () => {
  it("has no retired theme executor shim", () => {
    expect(nodeExecutors).not.toHaveProperty("executeSetTheme");
  });

  it("rejects mutation tools when the validated asset snapshot is unavailable", () => {
    const calls = [
      {
        id: "render-without-assets",
        name: "render_page",
        input: { tree: TREE_WITH_TEXT },
      },
      {
        id: "append-without-assets",
        name: "append_node",
        input: { parentId: "root", node: { id: "copy", type: "text", value: "Copy" } },
      },
      {
        id: "set-without-assets",
        name: "set_node",
        input: { node: { id: "copy", type: "text", value: "Copy" } },
      },
    ] as const;

    for (const call of calls) {
      const result = executeStageToolRaw(call, { shadow: ROOT_TREE });
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("not_available");
      expect(result.messages).toEqual([]);
      expect(result.patches).toEqual([]);
      expect(result.changedNodeIds).toEqual([]);
      expect(result.patchCount).toBe(0);
      expect(result.shadow).toBe(ROOT_TREE);
      expect(result.observation.text.length).toBeLessThan(2_000);
    }
  });

  it("dispatches local style-choice discovery through the public executor", () => {
    const result = executeStageTool(
      {
        id: "read-progress-height",
        name: "get_style_choices",
        input: { brick: "progress", target: "track", property: "height" },
      },
      { shadow: ROOT_TREE },
    );

    expect(result.status).toBe("ok");
    expect(JSON.parse(result.observation.data?.data ?? "null")).toMatchObject({
      brick: "progress",
      target: "track",
      property: "height",
      source: "token",
    });
    expect(result.patches).toEqual([]);
    expect(result.shadow).toBe(ROOT_TREE);
  });

  it("keeps non-authoring tools available without an asset snapshot", () => {
    const calls = [
      { id: "say-without-assets", name: "say", input: { text: "Done" } },
      { id: "remove-without-assets", name: "remove_node", input: { nodeId: "title" } },
      { id: "inspect-stage-without-assets", name: "inspect_stage", input: {} },
      { id: "inspect-node-without-assets", name: "inspect_node", input: { nodeId: "root" } },
    ] as const;

    for (const call of calls) {
      const result = executeStageToolRaw(call, { shadow: TREE_WITH_TEXT });
      expect(result.status).toBe("ok");
    }
  });

  it("rejects every invalid style call atomically", () => {
    const cases = [
      {
        expectedPath: "/nodes/copy/style/preset",
        result: executeRenderPage(
          {
            tree: {
              root: "page",
              nodes: {
                page: { id: "page", type: "box", children: ["copy"] },
                copy: {
                  id: "copy",
                  type: "text",
                  value: "Wrong Preset",
                  style: { preset: "panel" },
                },
              },
            },
          },
          ROOT_TREE,
          AUTHOR_THEME,
        ),
      },
      {
        expectedPath: "/style/track",
        result: executeSetNode(
          {
            node: {
              id: "copy",
              type: "text",
              value: "Wrong target",
              style: { track: { background: "surface" } },
            },
          },
          ROOT_TREE,
          AUTHOR_THEME,
        ),
      },
      {
        expectedPath: "/style/track/fontSize",
        result: executeSetNode(
          {
            node: {
              id: "meter",
              type: "progress",
              value: 50,
              style: { track: { fontSize: "md" } },
            },
          },
          ROOT_TREE,
          AUTHOR_THEME,
        ),
      },
      {
        expectedPath: "/style/track/height",
        result: executeAppendNode(
          {
            parentId: "root",
            node: {
              id: "meter",
              type: "progress",
              value: 50,
              style: { track: { height: "huge" } },
            },
          },
          ROOT_TREE,
          AUTHOR_THEME,
        ),
      },
      {
        expectedPath: "/style/indicator/hover",
        result: executeAppendNode(
          {
            parentId: "root",
            node: {
              id: "choice",
              type: "input",
              name: "choice",
              input: "checkbox",
              style: { indicator: { hover: { background: "accent" } } },
            },
          },
          ROOT_TREE,
          AUTHOR_THEME,
        ),
      },
      {
        expectedPath: "/style/placeholder",
        result: executeAppendNode(
          {
            parentId: "root",
            node: {
              id: "choice",
              type: "input",
              name: "choice",
              input: "checkbox",
              style: { placeholder: { color: "muted" } },
            },
          },
          ROOT_TREE,
          AUTHOR_THEME,
        ),
      },
    ];

    for (const { expectedPath, result } of cases) {
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_authoring");
      expect(result.messages).toEqual([]);
      expect(result.patches).toEqual([]);
      expect(result.changedNodeIds).toEqual([]);
      expect(result.patchCount).toBe(0);
      expect(result.summary).toBe("no stage changes");
      expect(result.shadow).toBe(ROOT_TREE);
      expect(result.observation.data).toMatchObject({
        status: "error",
        outcome: "rejected",
        applied: false,
        stage_changed: false,
        patch_count: 0,
        errors: expect.any(Array),
      });
      expect(result.observation.data?.errors?.length).toBeGreaterThan(0);
      expect(result.observation.data?.errors?.map(({ path }) => path)).toContain(expectedPath);
      expect(result.observation.data?.omitted_error_count).toBe(0);
    }
  });

  it("keeps valid strict style calls as RFC 6902 patches", () => {
    const rendered = executeRenderPage(
      {
        tree: {
          root: "page",
          nodes: {
            page: {
              id: "page",
              type: "box",
              children: ["copy"],
              style: { preset: "panel", padding: "lg" },
            },
            copy: {
              id: "copy",
              type: "text",
              value: "Styled",
              style: { preset: "heading", color: "accent" },
            },
          },
        },
      },
      ROOT_TREE,
      AUTHOR_THEME,
    );
    const set = executeSetNode(
      {
        node: {
          id: "copy",
          type: "text",
          value: "Strict",
          style: { preset: "heading", fontSize: "lg" },
        },
      },
      ROOT_TREE,
      AUTHOR_THEME,
    );
    const appended = executeAppendNode(
      {
        parentId: "root",
        node: {
          id: "meter",
          type: "progress",
          value: 50,
          style: { track: { height: "md" }, fill: { background: "success" } },
        },
      },
      ROOT_TREE,
      AUTHOR_THEME,
    );

    expect(rendered.status).toBe("ok");
    expect(rendered.patches).toMatchObject([{ op: "replace", path: "" }]);
    expect(set.status).toBe("ok");
    expect(set.patches).toMatchObject([{ op: "add", path: "/nodes/copy" }]);
    expect(appended.status).toBe("ok");
    expect(appended.patches).toMatchObject([
      { op: "add", path: "/nodes/meter" },
      { op: "add", path: "/nodes/root/children/-" },
    ]);
  });

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
    expect(parseAgentToolObservation(result.observation.text)).toMatchObject({
      tool: "append_node",
      status: "ok",
      outcome: "applied_visible",
      applied: true,
      stage_changed: true,
      visible_to_visitor: true,
      patch_count: 2,
      changed_node_ids: ["greeting", "root"],
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
    });
    expect(result.shadow.nodes["root"]).toEqual({
      id: "root",
      type: "box",
      children: ["greeting"],
    });
    expect(result.issues).toEqual([]);
  });

  it("append_node refuses to replace the stage root and refuses to overwrite an existing id", () => {
    const replaceRoot = executeStageTool(
      {
        id: "call-append-root",
        name: "append_node",
        input: { parentId: "root", node: { id: "root", type: "box", children: [] } },
      },
      { shadow: TREE_WITH_TEXT },
    );
    expect(replaceRoot.status).toBe("error");
    if (replaceRoot.status === "error") expect(replaceRoot.code).toBe("invalid_input");
    expect(replaceRoot.patches).toEqual([]);
    expect(replaceRoot.patchCount).toBe(0);
    expect(replaceRoot.shadow).toBe(TREE_WITH_TEXT);
    expect(replaceRoot.observation.text).toContain("cannot replace the stage root");

    const collision = executeStageTool(
      {
        id: "call-append-collision",
        name: "append_node",
        input: { parentId: "root", node: { id: "title", type: "text", value: "dup" } },
      },
      { shadow: TREE_WITH_TEXT },
    );
    expect(collision.status).toBe("error");
    if (collision.status === "error") expect(collision.code).toBe("invalid_input");
    expect(collision.patches).toEqual([]);
    expect(collision.patchCount).toBe(0);
    expect(collision.shadow).toBe(TREE_WITH_TEXT);
    expect(parseAgentToolObservation(collision.observation.text)).toMatchObject({
      tool: "append_node",
      status: "error",
      outcome: "rejected",
      message:
        'error: append_node — node "title" already exists. Use set_node to replace it or choose a new id.',
    });
  });

  it("rejects unsafe and oversized direct node payloads atomically", () => {
    const append = executeStageTool(
      {
        id: "call-sanitize-append",
        name: "append_node",
        input: {
          parentId: "root",
          node: {
            id: "unsafe",
            type: "text",
            value: "Hello",
            dangerouslySetInnerHTML: "<img src=x>",
            onclick: "steal()",
            style: { color: "fg", backgroundImage: "url(https://example.test/track)" },
          },
        },
      },
      { shadow: ROOT_TREE },
    );

    const rows = Array.from({ length: MAX_TABLE_ROWS + 10 }, (_, index) => ({
      name: `Row ${String(index)}`,
      leak: { nested: true },
    }));
    const table = executeStageTool(
      {
        id: "call-sanitize-table",
        name: "set_node",
        input: {
          node: {
            id: "table",
            type: "table",
            columns: [{ key: "name", label: "Name" }],
            rows,
            rawRows: rows,
          },
        },
      },
      { shadow: ROOT_TREE },
    );

    const chart = executeStageTool(
      {
        id: "call-sanitize-chart",
        name: "set_node",
        input: {
          node: {
            id: "chart",
            type: "chart",
            kind: "bar",
            series: [
              {
                label: "A",
                values: Array.from({ length: MAX_CHART_POINTS + 10 }, (_, index) => index),
              },
            ],
          },
        },
      },
      { shadow: ROOT_TREE },
    );

    for (const result of [append, table, chart]) {
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_authoring");
      expect(result.messages).toEqual([]);
      expect(result.patches).toEqual([]);
      expect(result.changedNodeIds).toEqual([]);
      expect(result.patchCount).toBe(0);
      expect(result.shadow).toBe(ROOT_TREE);
    }
  });

  it("returns typed no-patch errors for malformed unknown and invalid inputs", () => {
    const malformed = executeStageTool(null, { shadow: ROOT_TREE });
    expect(malformed.status).toBe("error");
    if (malformed.status === "error") expect(malformed.code).toBe("invalid_input");
    expect(malformed.messages).toEqual([]);
    expect(malformed.patches).toEqual([]);
    expect(malformed.patchCount).toBe(0);
    expect(malformed.shadow).toBe(ROOT_TREE);

    const hostile = executeStageTool(
      Object.defineProperty({}, "name", {
        get() {
          throw new Error("name boom");
        },
      }),
      { shadow: ROOT_TREE },
    );
    expect(hostile.status).toBe("error");
    if (hostile.status === "error") expect(hostile.code).toBe("invalid_input");
    expect(hostile.messages).toEqual([]);
    expect(hostile.patches).toEqual([]);
    expect(hostile.shadow).toBe(ROOT_TREE);

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
    expect(parseAgentToolObservation(invalidParent.observation.text)?.next_action).toBe(
      "Inspect the stage and append under an existing visible box, or create the parent first.",
    );

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
    expect(parseAgentToolObservation(nonBoxParent.observation.text)?.next_action).toBe(
      "Choose an existing box node as parentId.",
    );
  });

  it("returns structured invalid_input for revoked whole-call and nested-input proxies", () => {
    const revokedCall = Proxy.revocable<Record<string, unknown>>({}, {});
    revokedCall.revoke();
    const revokedInput = Proxy.revocable<Record<string, unknown>>({}, {});
    revokedInput.revoke();

    const attempts = [
      () => executeStageTool(revokedCall.proxy, { shadow: ROOT_TREE }),
      () =>
        executeStageTool(
          { id: "revoked-input", name: "get_brick_spec", input: revokedInput.proxy },
          { shadow: ROOT_TREE },
        ),
    ];

    for (const attempt of attempts) {
      expect(attempt).not.toThrow();
      const result = attempt();
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_input");
      expect(parseAgentToolObservation(result.observation.text)).toMatchObject({
        status: "error",
        outcome: "rejected",
        code: "invalid_input",
      });
      expect(result.messages).toEqual([]);
      expect(result.patches).toEqual([]);
      expect(result.patchCount).toBe(0);
      expect(result.shadow).toBe(ROOT_TREE);
    }
  });

  it("accepts every core chart kind and rejects values outside the shared set", () => {
    for (const kind of CHART_KINDS) {
      const result = executeStageTool(
        {
          id: `call-chart-${kind}`,
          name: "set_node",
          input: {
            node: { id: `chart-${kind}`, type: "chart", kind, series: [] },
          },
        },
        { shadow: ROOT_TREE },
      );

      expect(result.status).toBe("ok");
      expect(result.shadow.nodes[`chart-${kind}`]).toMatchObject({ type: "chart", kind });
    }

    const invalid = executeStageTool(
      {
        id: "call-chart-invalid",
        name: "set_node",
        input: {
          node: { id: "chart-invalid", type: "chart", kind: "radar", series: [] },
        },
      },
      { shadow: ROOT_TREE },
    );

    expect(invalid.status).toBe("error");
    if (invalid.status === "error") expect(invalid.code).toBe("invalid_authoring");
    expect(invalid.patches).toEqual([]);
    expect(invalid.shadow).toBe(ROOT_TREE);
    const observation = parseAgentToolObservation(invalid.observation.text);
    expect(observation).toMatchObject({ status: "error", code: "invalid_authoring" });
    if (observation === undefined) throw new Error("expected a structured chart observation");
    expect(observation.errors?.map(({ path }) => path)).toContain("/kind");
  });

  it("accepts a safe media node and lands it on the shadow", () => {
    const result = executeStageTool(
      {
        id: "call-media-ok",
        name: "append_node",
        input: {
          parentId: "root",
          node: {
            id: "hero",
            type: "media",
            kind: "image",
            src: "https://example.com/hero.png",
            alt: "Hero",
          },
        },
      },
      { shadow: ROOT_TREE },
    );

    expect(result.status).toBe("ok");
    expect(result.shadow.nodes["hero"]).toMatchObject({
      id: "hero",
      type: "media",
      kind: "image",
      src: "https://example.com/hero.png",
    });
  });

  it("rejects a media node with an unsafe src via the media-src safety branch", () => {
    const result = executeStageTool(
      {
        id: "call-media-unsafe",
        name: "append_node",
        input: {
          parentId: "root",
          node: { id: "bad", type: "media", kind: "image", src: "javascript:alert(1)" },
        },
      },
      { shadow: ROOT_TREE },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("invalid_authoring");
    expect(result.patches).toEqual([]);
    expect(result.patchCount).toBe(0);
    expect(result.shadow).toBe(ROOT_TREE);
    const observation = parseAgentToolObservation(result.observation.text);
    expect(observation).toMatchObject({
      tool: "append_node",
      status: "error",
      outcome: "rejected",
      code: "invalid_authoring",
    });
    expect(observation?.errors).toEqual([
      expect.objectContaining({
        path: "",
        message: expect.stringContaining("closed Brick contract"),
      }),
    ]);
  });

  it("clean-rejects retired and prototype types for repeated set/append calls", () => {
    const rejectedTypes = [
      ["but", "ton"].join(""),
      ["fo", "rm"].join(""),
      ["filter", "Bar"].join(""),
      ["met", "ric"].join(""),
      ["ta", "bs"].join(""),
      ["na", "v"].join(""),
      ["st", "at"].join(""),
      "constructor",
      "toString",
      "prototype",
    ] as const;

    for (const name of ["set_node", "append_node"] as const) {
      for (const type of rejectedTypes) {
        for (const attempt of [1, 2]) {
          const node = { id: `rejected-${name}-${type}-${String(attempt)}`, type };
          const result = executeStageTool(
            {
              id: `call-${name}-${type}-${String(attempt)}`,
              name,
              input: name === "set_node" ? { node } : { parentId: "root", node },
            },
            { shadow: ROOT_TREE },
          );

          expect(result.status).toBe("error");
          if (result.status === "error") expect(result.code).toBe("invalid_authoring");
          expect(result.messages).toEqual([]);
          expect(result.patches).toEqual([]);
          expect(result.patchCount).toBe(0);
          expect(result.shadow).toBe(ROOT_TREE);
          const observation = parseAgentToolObservation(result.observation.text);
          expect(observation).toMatchObject({
            tool: name,
            status: "error",
            outcome: "rejected",
            code: "invalid_authoring",
          });
          expect(observation?.errors?.map(({ path }) => path)).toContain("/type");
        }
      }
    }
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
    expect(parseAgentToolObservation(missing.observation.text)).toMatchObject({
      tool: "remove_node",
      status: "error",
      outcome: "rejected",
      message: 'error: remove_node — node "ghost" does not exist',
      next_action: "Inspect the stage and remove an existing non-root node.",
    });

    const forbidden = executeStageTool(
      {
        id: "call-forbidden",
        name: "set_node",
        input: { ["node"]: { id: "__proto__", type: "text", value: "x" } },
      },
      { shadow: TREE_WITH_TEXT },
    );
    expect(forbidden.status).toBe("error");
    if (forbidden.status === "error") expect(forbidden.code).toBe("invalid_authoring");
    expect(forbidden.patches).toEqual([]);
    expect(forbidden.shadow).toBe(TREE_WITH_TEXT);
    expect(parseAgentToolObservation(forbidden.observation.text)?.errors).toEqual([
      expect.objectContaining({ path: "/id" }),
    ]);
  });

  it("render_page rejects an invalid tree atomically and rejects an unrenderable tree", () => {
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

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("invalid_authoring");
    expect(result.patchCount).toBe(0);
    expect(result.patches).toEqual([]);
    expect(result.shadow).toBe(ROOT_TREE);
    expect(
      parseAgentToolObservation(result.observation.text)?.errors?.map(({ path }) => path),
    ).toContain("/nodes/bad/value");

    const empty = executeStageTool(
      {
        id: "call-6",
        name: "render_page",
        input: { tree: { root: "root", nodes: { root: { id: "root", type: "box" } } } },
      },
      { shadow: ROOT_TREE },
    );
    expect(empty.status).toBe("error");
    if (empty.status === "error") expect(empty.code).toBe("invalid_authoring");
    expect(empty.patches).toEqual([]);
    expect(empty.shadow).toBe(ROOT_TREE);
  });

  it("render_page rejects roots whose only descendants are non-rendering data bricks", () => {
    for (const node of [
      { id: "data", type: "table", columns: [], rows: [] },
      { id: "data", type: "chart", kind: "bar", series: [] },
      { id: "data", type: "keyValue", items: [] },
      { id: "data", type: "list", items: [] },
    ]) {
      const result = executeStageTool(
        {
          id: `call-blank-${node.type}`,
          name: "render_page",
          input: {
            tree: {
              root: "root",
              nodes: {
                root: { id: "root", type: "box", children: ["data"] },
                data: node,
              },
            },
          },
        },
        { shadow: ROOT_TREE },
      );

      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_tree");
      expect(result.patches).toEqual([]);
      expect(result.shadow).toBe(ROOT_TREE);
    }
  });

  it("render_page rejects a blank entry screen even when another screen has content", () => {
    const result = executeStageTool(
      {
        id: "call-blank-entry-screen",
        name: "render_page",
        input: {
          tree: {
            root: "shell",
            entry: "home",
            screens: { home: "home", about: "about" },
            nodes: {
              shell: { id: "shell", type: "box", children: [] },
              home: { id: "home", type: "box", children: [] },
              about: { id: "about", type: "box", children: ["copy"] },
              copy: { id: "copy", type: "text", value: "About" },
            },
          },
        },
      },
      { shadow: ROOT_TREE },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("invalid_tree");
    expect(result.patches).toEqual([]);
    expect(result.shadow).toBe(ROOT_TREE);
  });

  it("set_node remove_node and say emit existing stage tool messages", () => {
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
      {
        op: "add",
        path: "/nodes/title",
        value: { id: "title", type: "text", value: "T" },
      },
    ]);
    expect(parseAgentToolObservation(set.observation.text)).toMatchObject({
      outcome: "applied_not_visible",
      next_action:
        "Attach the changed node to a visible box with append_node, or inspect_stage to find a visible parent.",
    });

    const visibleSet = executeStageTool(
      {
        id: "call-8b",
        name: "set_node",
        input: { ["node"]: { id: "title", type: "text", value: "T2" } },
      },
      { shadow: TREE_WITH_TEXT },
    );
    expect(parseAgentToolObservation(visibleSet.observation.text)).toMatchObject({
      outcome: "applied_visible",
      next_action: "",
    });

    const removed = executeStageTool(
      { id: "call-9", name: "remove_node", input: { nodeId: "title" } },
      { shadow: TREE_WITH_TEXT },
    );
    expect(removed.status).toBe("ok");
    expect(removed.patches).toEqual([
      { op: "replace", path: "/nodes/root/children", value: [] },
      { op: "remove", path: "/nodes/title" },
    ]);
    expect(removed.shadow.nodes["title"]).toBeUndefined();

    const say = executeStageTool(
      { id: "call-10", name: "say", input: { text: "Done" } },
      { shadow: ROOT_TREE },
    );
    expect(say.status).toBe("ok");
    expect(say.messages).toEqual([{ kind: "say", text: "Done" }]);
    expect(say.patches).toEqual([]);
    expect(say.shadow).toBe(ROOT_TREE);
  });

  it("returns applied_not_visible when set_node creates an unattached node", () => {
    const result = executeStageTool(
      {
        id: "call-orphan",
        name: "set_node",
        input: { ["node"]: { id: "pricing", type: "text", value: "Pricing" } },
      },
      { shadow: ROOT_TREE },
    );

    expect(result.status).toBe("ok");
    const observation = parseAgentToolObservation(result.observation.text);
    expect(observation).toMatchObject({
      tool: "set_node",
      status: "ok",
      outcome: "applied_not_visible",
      applied: true,
      stage_changed: true,
      visible_to_visitor: false,
      next_action:
        "Attach the changed node to a visible box with append_node, or inspect_stage to find a visible parent.",
    });
  });

  it("remove_node detaches the parent child ref so a full removal reports no dangling warning", () => {
    const removed = executeStageTool(
      { id: "call-remove-parented", name: "remove_node", input: { nodeId: "title" } },
      { shadow: TREE_WITH_TEXT },
    );

    expect(removed.status).toBe("ok");
    expect(removed.patches).toEqual([
      { op: "replace", path: "/nodes/root/children", value: [] },
      { op: "remove", path: "/nodes/title" },
    ]);
    expect(removed.shadow.nodes["title"]).toBeUndefined();
    expect(removed.shadow.nodes["root"]).toMatchObject({ children: [] });
    expect(removed.issues).toEqual([]);
    expect(removed.observation.text).not.toContain("dangling");
    const observation = parseAgentToolObservation(removed.observation.text);
    expect(observation?.outcome).not.toBe("applied_with_warnings");
    expect(observation?.warnings).toEqual([]);
  });

  it("remove_node cleans the child ref from every parent that references the node", () => {
    const twoParents: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["p1", "p2"] },
        p1: { id: "p1", type: "box", children: ["shared", "keep"] },
        p2: { id: "p2", type: "box", children: ["shared"] },
        shared: { id: "shared", type: "text", value: "Shared" },
        keep: { id: "keep", type: "text", value: "Keep" },
      },
    };

    const removed = executeStageTool(
      { id: "call-remove-shared", name: "remove_node", input: { nodeId: "shared" } },
      { shadow: twoParents },
    );

    expect(removed.status).toBe("ok");
    expect(removed.patches).toEqual([
      { op: "replace", path: "/nodes/p1/children", value: ["keep"] },
      { op: "replace", path: "/nodes/p2/children", value: [] },
      { op: "remove", path: "/nodes/shared" },
    ]);
    expect(removed.shadow.nodes["shared"]).toBeUndefined();
    expect(removed.shadow.nodes["p1"]).toMatchObject({ children: ["keep"] });
    expect(removed.shadow.nodes["p2"]).toMatchObject({ children: [] });
    expect(removed.issues).toEqual([]);
    expect(removed.observation.text).not.toContain("dangling");
  });

  it("remove_node drops a non-entry screen whose root is the removed node, with no warning", () => {
    const withScreens: FacetTree = {
      root: "home",
      entry: "home",
      screens: { home: "home", about: "about" },
      nodes: {
        home: { id: "home", type: "box", children: ["homeCopy"] },
        homeCopy: { id: "homeCopy", type: "text", value: "Home" },
        about: { id: "about", type: "box", children: [] },
      },
    };

    const removed = executeStageTool(
      { id: "call-remove-screen-root", name: "remove_node", input: { nodeId: "about" } },
      { shadow: withScreens },
    );

    expect(removed.status).toBe("ok");
    expect(removed.patches).toEqual([
      { op: "remove", path: "/screens/about" },
      { op: "remove", path: "/nodes/about" },
    ]);
    expect(removed.shadow.screens).toEqual({ home: "home" });
    expect(removed.shadow.nodes["about"]).toBeUndefined();
    expect(removed.issues).toEqual([]);
    const observation = parseAgentToolObservation(removed.observation.text);
    expect(observation?.outcome).not.toBe("applied_with_warnings");
    expect(observation?.warnings).toEqual([]);
  });

  it("remove_node refuses to remove the entry screen's root", () => {
    // The entry screen root is distinct from the tree root here, so the refusal
    // comes from the entry-screen guard (not the stage-root guard).
    const withScreens: FacetTree = {
      root: "shell",
      entry: "home",
      screens: { home: "home", about: "about" },
      nodes: {
        shell: { id: "shell", type: "box", children: [] },
        home: { id: "home", type: "box", children: ["homeCopy"] },
        homeCopy: { id: "homeCopy", type: "text", value: "Home" },
        about: { id: "about", type: "box", children: ["aboutCopy"] },
        aboutCopy: { id: "aboutCopy", type: "text", value: "About" },
      },
    };

    const refused = executeStageTool(
      { id: "call-remove-entry-root", name: "remove_node", input: { nodeId: "home" } },
      { shadow: withScreens },
    );

    expect(refused.status).toBe("error");
    expect(refused.patches).toEqual([]);
    expect(refused.shadow).toBe(withScreens);
    expect(parseAgentToolObservation(refused.observation.text)).toMatchObject({
      tool: "remove_node",
      status: "error",
      outcome: "rejected",
      message:
        'error: remove_node — node "home" is the entry screen root; render a replacement screen first',
    });
  });

  it("set_node refuses a non-container replacement of the entry screen's root", () => {
    const withScreens: FacetTree = {
      root: "shell",
      entry: "home",
      screens: { home: "home" },
      nodes: {
        shell: { id: "shell", type: "box", children: [] },
        home: { id: "home", type: "box", children: ["homeCopy"] },
        homeCopy: { id: "homeCopy", type: "text", value: "Home" },
      },
    };

    const refused = executeStageTool(
      {
        id: "call-set-entry-root",
        name: "set_node",
        input: { ["node"]: { id: "home", type: "text", value: "boom" } },
      },
      { shadow: withScreens },
    );

    expect(refused.status).toBe("error");
    expect(refused.patches).toEqual([]);
    expect(refused.shadow).toBe(withScreens);
    expect(parseAgentToolObservation(refused.observation.text)).toMatchObject({
      tool: "set_node",
      status: "error",
      outcome: "rejected",
      message:
        'error: set_node — node "home" is the entry screen root and must stay a container; render a replacement screen first',
    });

    // Replacing the entry screen root with another container stays allowed.
    const replaced = executeStageTool(
      {
        id: "call-set-entry-root-box",
        name: "set_node",
        input: { ["node"]: { id: "home", type: "box", children: [] } },
      },
      { shadow: withScreens },
    );
    expect(replaced.status).toBe("ok");
  });

  it("append_node treats prototype-inherited ids as fresh, then rejects a real duplicate", () => {
    const first = executeStageTool(
      {
        id: "call-append-tostring",
        name: "append_node",
        input: { parentId: "root", ["node"]: { id: "toString", type: "text", value: "ok" } },
      },
      { shadow: ROOT_TREE },
    );
    expect(first.status).toBe("ok");

    const evolved = foldStageShadow(ROOT_TREE, [{ kind: "patch", patches: first.patches }]).shadow;
    expect(Object.hasOwn(evolved.nodes, "toString")).toBe(true);
    const duplicate = executeStageTool(
      {
        id: "call-append-tostring-again",
        name: "append_node",
        input: { parentId: "root", ["node"]: { id: "toString", type: "text", value: "again" } },
      },
      { shadow: evolved },
    );
    expect(duplicate.status).toBe("error");
    expect(duplicate.observation.text).toContain("already exists");
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
      {
        op: "add",
        path: "/nodes/a~1b~0c",
        value: { id: "a/b~c", type: "text", value: "escaped" },
      },
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
