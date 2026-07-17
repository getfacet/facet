import { describe, expect, it } from "vitest";
import type { FacetNode, FacetTree } from "@facet/core";
import {
  formatAgentToolObservation,
  isVisitorVisibleStageChange,
  parseAgentToolObservation,
  visibleStageNodeIds,
} from "./observation.js";
import { formatAssetObservation } from "./asset-observation.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacyCode = ["invalid_", "compo", "sition"].join("");

const TREE: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["visible", "hidden"] },
    visible: { id: "visible", type: "text", value: "Visible" },
    hidden: { id: "hidden", type: "box", hidden: true, children: ["secret"] },
    secret: { id: "secret", type: "text", value: "Secret" },
  },
};

describe("agent tool observation contract", () => {
  it("serializes bounded structured author errors", () => {
    const observation = formatAgentToolObservation({
      tool: "render_page",
      status: "error",
      outcome: "rejected",
      code: "invalid_authoring",
      message: "Rejected invalid authoring.",
      errors: Array.from({ length: 20 }, (_, index) => ({
        path: `/nodes/node-${String(index)}/style/color`,
        message: `Choose an allowed color for node ${String(index)}.`,
        allowed: ["fg", "muted", "accent"],
      })),
      omittedErrorCount: 3,
    });

    const data = parseAgentToolObservation(observation.text);
    expect(data).toMatchObject({
      status: "error",
      outcome: "rejected",
      code: "invalid_authoring",
      applied: false,
      stage_changed: false,
      visible_to_visitor: false,
      patch_count: 0,
      omitted_error_count: 7,
    });
    expect(data?.errors).toHaveLength(16);
    expect(data?.errors?.[0]).toEqual({
      path: "/nodes/node-0/style/color",
      message: "Choose an allowed color for node 0.",
      allowed: ["fg", "muted", "accent"],
    });
  });

  it("formats a bounded JSON observation with required fields", () => {
    const observation = formatAgentToolObservation({
      tool: "append_node",
      status: "ok",
      outcome: "applied_visible",
      message: "Appended a node.",
      applied: true,
      stageChanged: true,
      visibleToVisitor: true,
      patchCount: 2,
      changedNodeIds: Array.from({ length: 25 }, (_, index) => `node-${String(index)}`),
      warnings: Array.from({ length: 7 }, (_, index) => `warning-${String(index)}`),
      summary: "2 patch ops",
    });

    const data = parseAgentToolObservation(observation.text);
    expect(data).toMatchObject({
      version: 1,
      tool: "append_node",
      status: "ok",
      outcome: "applied_visible",
      applied: true,
      stage_changed: true,
      visible_to_visitor: true,
      patch_count: 2,
      message: "Appended a node.",
      next_action: "",
      summary: "2 patch ops",
    });
    expect(data?.changed_node_ids).toHaveLength(12);
    expect(data?.omitted_changed_node_count).toBe(13);
    expect(data?.warnings).toHaveLength(3);
    expect(data?.omitted_warning_count).toBe(4);
  });

  it("omits changed node ids that are too long for the bounded transcript", () => {
    const longId = "x".repeat(120);
    const observation = formatAgentToolObservation({
      tool: "set_node",
      status: "ok",
      outcome: "applied_not_visible",
      message: "Set a node.",
      changedNodeIds: ["short", longId],
    });

    expect(parseAgentToolObservation(observation.text)).toMatchObject({
      changed_node_ids: ["short"],
      omitted_changed_node_count: 1,
    });
  });

  it("keeps a worst-case formatted observation under the quickstart transcript cap", () => {
    const observation = formatAgentToolObservation({
      tool: "render_page",
      status: "ok",
      outcome: "applied_with_warnings",
      message: "m".repeat(2_000),
      nextAction: "n".repeat(2_000),
      summary: "s".repeat(2_000),
      changedNodeIds: Array.from(
        { length: 50 },
        (_, index) => `node-${String(index).padStart(2, "0")}`,
      ),
      warnings: Array.from({ length: 10 }, () => "w".repeat(1_000)),
    });

    expect(observation.text.length).toBeLessThan(4_000);
    expect(parseAgentToolObservation(observation.text)).toBeDefined();
  });

  it("bounds tool names and non-finite patch counts", () => {
    const observation = formatAgentToolObservation({
      tool: "x".repeat(1_000),
      status: "ok",
      outcome: "applied_visible",
      message: "Applied.",
      patchCount: Infinity,
    });

    const data = parseAgentToolObservation(observation.text);
    expect(data?.tool.length).toBeLessThanOrEqual(80);
    expect(data?.tool.endsWith("...")).toBe(true);
    expect(data?.patch_count).toBe(0);
  });

  it("round-trips a bounded data payload and rejects non-string data", () => {
    const payload = JSON.stringify({ root: "r1", ids: { box: "r1" } });
    const observation = formatAgentToolObservation({
      tool: "inspect_stage",
      status: "ok",
      outcome: "no_stage_change",
      message: "Inspected the stage.",
      data: payload,
    });

    const parsed = parseAgentToolObservation(observation.text);
    expect(parsed?.data).toBe(payload);
    expect(JSON.parse(parsed?.data ?? "")).toMatchObject({ root: "r1", ids: { box: "r1" } });

    const withNonStringData = JSON.stringify({ ...parsed, data: { root: "r1" } });
    expect(parseAgentToolObservation(withNonStringData)).toBeUndefined();
  });

  it("keeps the public generic formatter capped with no asset bypass", () => {
    const observation = formatAgentToolObservation({
      tool: "get_pattern",
      status: "ok",
      outcome: "no_stage_change",
      message: "Read a Pattern reference.",
      data: `{"pad":"${"z".repeat(4_000)}"}`,
    });

    const parsed = parseAgentToolObservation(observation.text);
    expect(parsed?.data).toBe('{"truncated":true}');
    expect(JSON.parse(parsed?.data ?? "")).toEqual({ truncated: true });
  });

  it("preserves exact validated Pattern data above the generic cap", () => {
    const pattern = {
      name: "large-pattern",
      description: "A complete reference whose serialized data exceeds the generic cap.",
      useWhen: "Use for a complete large reference.",
      root: "reference-root",
      nodes: {
        "reference-root": {
          id: "reference-root",
          type: "box",
          children: ["reference-copy"],
        },
        "reference-copy": {
          id: "reference-copy",
          type: "text",
          value: "x".repeat(3_000),
        },
      },
    } as const;
    const serialized = JSON.stringify(pattern);
    expect(serialized.length).toBeGreaterThan(2_048);

    const observation = formatAssetObservation(
      {
        tool: "get_pattern",
        status: "ok",
        outcome: "no_stage_change",
        message: "Read one exact unresolved Pattern.",
      },
      serialized,
    );
    const parsed = parseAgentToolObservation(observation.text);

    expect(parsed?.data).toBe(serialized);
    expect(JSON.parse(parsed?.data ?? "null")).toEqual(pattern);
    expect(observation.data).toEqual(parsed);
  });

  it("omits the data field entirely when no payload is supplied", () => {
    const observation = formatAgentToolObservation({
      tool: "set_node",
      status: "ok",
      outcome: "applied_visible",
      message: "Set a node.",
    });

    expect(parseAgentToolObservation(observation.text)?.data).toBeUndefined();
    expect(observation.text).not.toContain('"data"');
  });

  it("defaults outcome facts coherently when callers omit booleans", () => {
    const observation = formatAgentToolObservation({
      tool: "append_node",
      status: "ok",
      outcome: "applied_visible",
      message: "Applied.",
    });

    expect(parseAgentToolObservation(observation.text)).toMatchObject({
      applied: true,
      stage_changed: true,
      visible_to_visitor: true,
    });
  });

  it("normalizes status and code from the outcome", () => {
    const rejected = formatAgentToolObservation({
      tool: "append_node",
      status: "ok",
      outcome: "rejected",
      code: "pending",
      message: "Rejected.",
      patchCount: 12,
    });
    const rejectedData = parseAgentToolObservation(rejected.text);
    expect(rejectedData).toMatchObject({
      status: "error",
      outcome: "rejected",
      patch_count: 0,
    });
    expect(rejectedData?.code).toBeUndefined();

    const pending = formatAgentToolObservation({
      tool: "append_node",
      status: "ok",
      outcome: "pending",
      message: "Pending.",
    });
    expect(parseAgentToolObservation(pending.text)).toMatchObject({
      status: "pending",
      outcome: "pending",
      code: "pending",
    });
  });

  it("defaults non-applied outcomes to unapplied", () => {
    const observation = formatAgentToolObservation({
      tool: "inspect_stage",
      status: "ok",
      outcome: "no_stage_change",
      message: "Inspected the current stage.",
    });

    expect(parseAgentToolObservation(observation.text)).toMatchObject({
      applied: false,
      stage_changed: false,
      visible_to_visitor: false,
    });
  });

  it(`accepts the canonical availability code and rejects ${legacyCode}`, () => {
    const rejected = formatAgentToolObservation({
      tool: "get_pattern",
      status: "error",
      outcome: "rejected",
      code: "not_available",
      message: "The requested Pattern is not available in this turn snapshot.",
    });

    const data = parseAgentToolObservation(rejected.text);
    expect(data).toMatchObject({
      tool: "get_pattern",
      status: "error",
      outcome: "rejected",
      code: "not_available",
      patch_count: 0,
    });
    if (data === undefined) throw new Error("expected canonical observation");

    expect(
      parseAgentToolObservation(JSON.stringify({ ...data, code: legacyCode })),
    ).toBeUndefined();
  });

  it("rejects malformed parsed observations", () => {
    const valid = formatAgentToolObservation({
      tool: "append_node",
      status: "error",
      outcome: "rejected",
      code: "invalid_input",
      message: "Bad input.",
    });
    const data = parseAgentToolObservation(valid.text);
    expect(data).toBeDefined();
    if (data === undefined) throw new Error("expected valid observation");

    expect(parseAgentToolObservation(JSON.stringify({ ...data, patch_count: -1 }))).toBeUndefined();
    expect(parseAgentToolObservation(JSON.stringify({ ...data, code: "nope" }))).toBeUndefined();
    expect(
      parseAgentToolObservation(
        JSON.stringify({ ...data, status: "ok", outcome: "rejected", code: undefined }),
      ),
    ).toBeUndefined();
    expect(
      parseAgentToolObservation(
        JSON.stringify({
          ...data,
          status: "ok",
          outcome: "applied_visible",
          applied: true,
          stage_changed: false,
          visible_to_visitor: true,
          code: undefined,
        }),
      ),
    ).toBeUndefined();
  });

  it("classifies visible stage reachability from the server stage shadow", () => {
    expect(Array.from(visibleStageNodeIds(TREE)).sort()).toEqual(["root", "visible"]);

    const afterVisible: FacetTree = {
      ...TREE,
      nodes: {
        ...TREE.nodes,
        visible: { id: "visible", type: "text", value: "Updated" },
      },
    };
    expect(isVisitorVisibleStageChange(TREE, afterVisible, ["visible"])).toBe(true);

    const afterOrphan: FacetTree = {
      ...TREE,
      nodes: {
        ...TREE.nodes,
        orphan: { id: "orphan", type: "text", value: "Not attached" },
      },
    };
    expect(isVisitorVisibleStageChange(TREE, afterOrphan, ["orphan"])).toBe(false);
  });

  it("classifies nested boxes and populated leaf bricks as visible while skipping blank data bricks", () => {
    const highLevelTree: FacetTree = {
      root: "shell",
      nodes: {
        shell: { id: "shell", type: "box", children: ["group"] },
        group: { id: "group", type: "box", children: ["summary", "table"] },
        summary: {
          id: "summary",
          type: "keyValue",
          items: [{ label: "Revenue", value: "$12k" }],
          children: ["ghost"],
        } as unknown as FacetNode,
        table: { id: "table", type: "table", columns: [], rows: [] },
        ghost: { id: "ghost", type: "text", value: "Not reachable through a leaf" },
      },
    };

    expect(Array.from(visibleStageNodeIds(highLevelTree)).sort()).toEqual([
      "group",
      "shell",
      "summary",
    ]);

    const afterSummary: FacetTree = {
      ...highLevelTree,
      nodes: {
        ...highLevelTree.nodes,
        summary: {
          id: "summary",
          type: "keyValue",
          items: [{ label: "Revenue", value: "$18k" }],
        },
      },
    };
    expect(isVisitorVisibleStageChange(highLevelTree, afterSummary, ["summary"])).toBe(true);

    const afterGhost: FacetTree = {
      ...highLevelTree,
      nodes: {
        ...highLevelTree.nodes,
        ghost: { id: "ghost", type: "text", value: "Still hidden" },
      },
    };
    expect(isVisitorVisibleStageChange(highLevelTree, afterGhost, ["ghost"])).toBe(false);
    expect(isVisitorVisibleStageChange(highLevelTree, highLevelTree, ["table"])).toBe(false);
  });

  it("does not classify non-entry screen changes as visible on the default render root", () => {
    const screenTree: FacetTree = {
      root: "shell",
      entry: "home",
      screens: { home: "home", about: "about" },
      nodes: {
        shell: { id: "shell", type: "box", children: [] },
        home: { id: "home", type: "box", children: ["home-copy"] },
        "home-copy": { id: "home-copy", type: "text", value: "Home" },
        about: { id: "about", type: "box", children: ["about-copy"] },
        "about-copy": { id: "about-copy", type: "text", value: "About" },
      },
    };
    const afterAbout: FacetTree = {
      ...screenTree,
      nodes: {
        ...screenTree.nodes,
        "about-copy": { id: "about-copy", type: "text", value: "Updated" },
      },
    };

    expect(Array.from(visibleStageNodeIds(screenTree)).sort()).toEqual(["home", "home-copy"]);
    expect(isVisitorVisibleStageChange(screenTree, afterAbout, ["about-copy"])).toBe(false);
  });

  it("treats stage metadata changes as visitor-visible", () => {
    expect(isVisitorVisibleStageChange(TREE, { ...TREE, root: "visible" }, [])).toBe(true);
  });
});
