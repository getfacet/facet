import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MAX_CHART_POINTS, MAX_PATCH_OPS, MAX_TABLE_ROWS } from "@facet/core";
import type {
  FacetCatalog,
  FacetComposition,
  FacetNode,
  FacetTree,
  JsonPatchOperation,
} from "@facet/core";
import { executeStageTool } from "./executor.js";
import { foldStageShadow } from "./stage-shadow.js";
import { parseAgentToolObservation } from "./observation.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacyNaming = new RegExp(["st", "amp"].join(""), "i");
const legacyTool = ["use_", "st", "amp"].join("");

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

const CATALOG_POLICY: FacetCatalog = {
  name: "catalog-policy-test",
  theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
  bricks: [
    { type: "section", variants: ["surface"] },
    { type: "button", variants: ["primary"] },
  ],
  compositions: { mode: "allow", names: ["approved"] },
  primitiveFallback: "allowed",
  policy: {
    order: ["composition", "component", "primitive"],
    editBeforeAppend: true,
    compactScreens: true,
  },
};

const CARD_COMPOSITION: FacetComposition = {
  name: "card",
  slots: { title: "Fallback" },
  root: "card",
  nodes: {
    card: { id: "card", type: "box", children: ["title"] },
    title: { id: "title", type: "text", value: "{{title}}" },
  },
};

function boxWithLeaves(nodeCount: number): FacetComposition {
  const children = Array.from({ length: nodeCount - 1 }, (_, index) => `leaf-${String(index)}`);
  const nodes: Record<string, FacetNode> = {
    big: { id: "big", type: "box", children },
  };
  for (const id of children) nodes[id] = { id, type: "text", value: id };
  return { name: "big", root: "big", nodes };
}

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
        value: { id: "greeting", type: "text", value: "Hello", style: {} },
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

  it("sanitizes direct node tool payloads before returning messages and patches", () => {
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

    expect(append.status).toBe("ok");
    expect(append.patches[0]).toEqual({
      op: "add",
      path: "/nodes/unsafe",
      value: { id: "unsafe", type: "text", value: "Hello", style: { color: "fg" } },
    });
    expect(append.shadow.nodes["unsafe"]).toEqual({
      id: "unsafe",
      type: "text",
      value: "Hello",
      style: { color: "fg" },
    });
    const appendMessages = JSON.stringify(append.messages);
    expect(appendMessages).not.toContain("dangerouslySetInnerHTML");
    expect(appendMessages).not.toContain("onclick");
    expect(appendMessages).not.toContain("backgroundImage");

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

    expect(table.status).toBe("ok");
    const tablePatch = table.patches[0];
    expect(tablePatch?.op).toBe("add");
    if (tablePatch?.op === "add") {
      const value = tablePatch.value as { rows?: readonly unknown[]; rawRows?: unknown };
      expect(value.rows).toHaveLength(MAX_TABLE_ROWS);
      expect(value.rawRows).toBeUndefined();
    }
    expect(JSON.stringify(table.messages)).not.toContain("rawRows");
    expect(table.issues.some((issue) => issue.includes("rows exceeded"))).toBe(true);

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

    expect(chart.status).toBe("ok");
    const chartPatch = chart.patches[0];
    expect(chartPatch?.op).toBe("add");
    if (chartPatch?.op === "add") {
      const value = chartPatch.value as {
        series?: readonly { readonly values?: readonly unknown[] }[];
      };
      expect(value.series?.[0]?.values).toHaveLength(MAX_CHART_POINTS);
    }
    expect(chart.issues.some((issue) => issue.includes("points exceeded"))).toBe(true);
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

  it("render_page rejects roots whose only descendants are non-rendering data bricks", () => {
    for (const node of [
      { id: "data", type: "table", columns: [], rows: [] },
      { id: "data", type: "chart", kind: "bar", series: [] },
      { id: "data", type: "tabs", items: [] },
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

  it("render_page preserves the current theme when locked catalog has no active theme", () => {
    const result = executeStageTool(
      {
        id: "call-locked-current-theme",
        name: "render_page",
        input: { tree: TREE_WITH_TEXT },
      },
      {
        shadow: { ...ROOT_TREE, theme: "brand" },
        assets: {
          catalog: {
            ...CATALOG_POLICY,
            theme: { switchPolicy: "locked" },
          },
        },
      },
    );

    expect(result.status).toBe("ok");
    expect(result.shadow.theme).toBe("brand");
  });

  describe("use_composition", () => {
    it("use_composition is the canonical executor surface with no old-tool compatibility branch", () => {
      const source = ["./executor.ts", "./executor-page.ts"]
        .map((file) => readFileSync(new URL(file, import.meta.url), "utf8"))
        .join("\n");

      expect(source).toContain('"use_composition"');
      expect(source).toContain("expandComposition");
      expect(source).toContain("invalid_composition");
      expect(source).not.toMatch(legacyNaming);
    });

    it("use_composition expands a known composition with fresh ids and appends it under the parent", () => {
      const result = executeStageTool(
        {
          id: "call-7",
          name: "use_composition",
          input: { name: "card", params: { title: "Hello" }, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
      );

      expect(result.status).toBe("ok");
      expect(result.patchCount).toBe(3);
      expect(parseAgentToolObservation(result.observation.text)).toMatchObject({
        tool: "use_composition",
        status: "ok",
        outcome: "applied_visible",
        visible_to_visitor: true,
        patch_count: 3,
      });
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

    it("use_composition emits minted ids as valid JSON in data, not embedded in the human message", () => {
      const slotCount = 12;
      const slots: Record<string, string> = {};
      const nodes: Record<string, FacetNode> = {
        panel: {
          id: "panel",
          type: "box",
          children: Array.from({ length: slotCount }, (_, i) => `line-${String(i)}`),
        },
      };
      for (let i = 0; i < slotCount; i += 1) {
        slots[`line-${String(i)}`] = `Default copy for slot number ${String(i)}`;
        nodes[`line-${String(i)}`] = {
          id: `line-${String(i)}`,
          type: "text",
          value: `{{line-${String(i)}}}`,
        };
      }
      const composition: FacetComposition = { name: "wide", slots, root: "panel", nodes };

      const result = executeStageTool(
        {
          id: "call-wide",
          name: "use_composition",
          input: { name: "wide", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [composition] } },
      );

      expect(result.status).toBe("ok");
      const observation = parseAgentToolObservation(result.observation.text);
      expect(observation?.message).toBe('Used composition "wide".');
      expect(observation?.message).not.toContain("{");
      expect(observation?.data).toBeDefined();
      const meta = JSON.parse(observation?.data ?? "") as {
        readonly root: string;
        readonly slots: Readonly<Record<string, string>>;
        readonly ids: Readonly<Record<string, string>>;
      };
      expect(typeof meta.root).toBe("string");
      expect(meta.ids["panel"]).toBe(meta.root);
      expect(Object.keys(meta.slots)).toHaveLength(slotCount);
      for (const slotName of Object.keys(slots)) {
        expect(typeof meta.slots[slotName]).toBe("string");
      }
    });

    it("use_composition keeps composition metadata valid JSON when the ids map overflows the cap", () => {
      const nodeCount = 90;
      const nodes: Record<string, FacetNode> = {
        "overflow-root-container": {
          id: "overflow-root-container",
          type: "box",
          children: Array.from(
            { length: nodeCount },
            (_, i) => `overflow-child-node-number-${String(i)}`,
          ),
        },
      };
      for (let i = 0; i < nodeCount; i += 1) {
        const id = `overflow-child-node-number-${String(i)}`;
        nodes[id] = { id, type: "text", value: `Row ${String(i)}` };
      }
      const composition: FacetComposition = {
        name: "overflow",
        root: "overflow-root-container",
        nodes,
      };

      const result = executeStageTool(
        {
          id: "call-overflow",
          name: "use_composition",
          input: { name: "overflow", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [composition] } },
      );

      expect(result.status).toBe("ok");
      const observation = parseAgentToolObservation(result.observation.text);
      expect(observation?.data).toBeDefined();
      const raw = observation?.data ?? "";
      expect(raw.length).toBeLessThanOrEqual(2048);
      const meta = JSON.parse(raw) as {
        readonly root: string;
        readonly ids: Readonly<Record<string, string>>;
        readonly idsOmitted?: number;
      };
      expect(typeof meta.root).toBe("string");
      expect(meta.idsOmitted).toBeGreaterThan(0);
      expect(Object.keys(meta.ids).length + (meta.idsOmitted ?? 0)).toBe(nodeCount + 1);
    });

    it("use_composition keeps a slots-dominated composition's metadata valid JSON under the cap", () => {
      const slotCount = 60;
      const slots: Record<string, string> = {};
      const nodes: Record<string, FacetNode> = {
        "slots-heavy-root-container-node": {
          id: "slots-heavy-root-container-node",
          type: "box",
          children: Array.from(
            { length: slotCount },
            (_, i) => `slots-heavy-source-text-node-number-${String(i)}`,
          ),
        },
      };
      for (let i = 0; i < slotCount; i += 1) {
        const id = `slots-heavy-source-text-node-number-${String(i)}`;
        const slotName = `descriptive-slot-marker-placeholder-name-number-${String(i)}`;
        slots[slotName] = `Default copy for ${slotName}`;
        nodes[id] = { id, type: "text", value: `{{${slotName}}}` };
      }
      const composition: FacetComposition = {
        name: "slots-heavy",
        root: "slots-heavy-root-container-node",
        slots,
        nodes,
      };

      const result = executeStageTool(
        {
          id: "call-slots-heavy",
          name: "use_composition",
          input: { name: "slots-heavy", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [composition] } },
      );

      expect(result.status).toBe("ok");
      const observation = parseAgentToolObservation(result.observation.text);
      expect(observation?.data).toBeDefined();
      const raw = observation?.data ?? "";
      expect(raw).not.toBe('{"truncated":true}');
      expect(raw.length).toBeLessThanOrEqual(2048);
      const meta = JSON.parse(raw) as {
        readonly root: string;
        readonly slots: Readonly<Record<string, string>>;
        readonly ids: Readonly<Record<string, string>>;
        readonly slotsOmitted?: number;
        readonly idsOmitted?: number;
      };
      expect(typeof meta.root).toBe("string");
      expect(meta.slotsOmitted).toBeGreaterThan(0);
      expect(Object.keys(meta.slots).length + (meta.slotsOmitted ?? 0)).toBe(slotCount);
    });

    it("use_composition drops even the first ids entry when preceding metadata fills the cap", () => {
      const slotCount = 44;
      const slots: Record<string, string> = {};
      const nodes: Record<string, FacetNode> = {
        "budget-filling-root-container-node-with-a-long-identifier": {
          id: "budget-filling-root-container-node-with-a-long-identifier",
          type: "box",
          children: Array.from(
            { length: slotCount },
            (_, i) => `budget-filling-slot-source-text-node-with-long-id-number-${String(i)}`,
          ),
        },
      };
      for (let i = 0; i < slotCount; i += 1) {
        const id = `budget-filling-slot-source-text-node-with-long-id-number-${String(i)}`;
        const slotName = `budget-filling-descriptive-slot-marker-name-number-${String(i)}`;
        slots[slotName] = `Default copy for ${slotName}`;
        nodes[id] = { id, type: "text", value: `{{${slotName}}}` };
      }
      const composition: FacetComposition = {
        name: "budget-filling",
        root: "budget-filling-root-container-node-with-a-long-identifier",
        slots,
        nodes,
      };

      const result = executeStageTool(
        {
          id: "call-budget-filling",
          name: "use_composition",
          input: { name: "budget-filling", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [composition] } },
      );

      expect(result.status).toBe("ok");
      const observation = parseAgentToolObservation(result.observation.text);
      expect(observation?.data).toBeDefined();
      const raw = observation?.data ?? "";
      expect(raw).not.toBe('{"truncated":true}');
      expect(raw.length).toBeLessThanOrEqual(2048);
      const meta = JSON.parse(raw) as {
        readonly root: string;
        readonly ids: Readonly<Record<string, string>>;
        readonly idsOmitted?: number;
      };
      expect(typeof meta.root).toBe("string");
      // The slots map alone fills the budget, so not even the first ids entry
      // fits: the old `> 1` escape hatch would have force-kept it.
      expect(Object.keys(meta.ids)).toHaveLength(0);
      expect(meta.idsOmitted).toBe(slotCount + 1);
    });

    it("use_composition rejects malformed name and at inputs with zero patch ops and an unchanged shadow", () => {
      const missingName = executeStageTool(
        {
          id: "comp-no-name",
          name: "use_composition",
          input: { params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
      );
      expect(missingName.status).toBe("error");
      if (missingName.status === "error") expect(missingName.code).toBe("invalid_input");
      expect(missingName.messages).toEqual([]);
      expect(missingName.patches).toEqual([]);
      expect(missingName.patchCount).toBe(0);
      expect(missingName.shadow).toBe(ROOT_TREE);

      const missingAt = executeStageTool(
        { id: "comp-no-at", name: "use_composition", input: { name: "card", params: {} } },
        { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
      );
      expect(missingAt.status).toBe("error");
      if (missingAt.status === "error") expect(missingAt.code).toBe("invalid_input");
      expect(missingAt.messages).toEqual([]);
      expect(missingAt.patches).toEqual([]);
      expect(missingAt.patchCount).toBe(0);
      expect(missingAt.shadow).toBe(ROOT_TREE);
    });

    it("use_composition rejects a missing or non-container parent without patches", () => {
      const ghostParent = executeStageTool(
        {
          id: "comp-ghost-parent",
          name: "use_composition",
          input: { name: "card", params: {}, at: { parent: "ghost" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
      );
      expect(ghostParent.status).toBe("error");
      if (ghostParent.status === "error") expect(ghostParent.code).toBe("invalid_parent");
      expect(ghostParent.messages).toEqual([]);
      expect(ghostParent.patches).toEqual([]);
      expect(ghostParent.patchCount).toBe(0);
      expect(ghostParent.shadow).toBe(ROOT_TREE);

      const nonContainer = executeStageTool(
        {
          id: "comp-text-parent",
          name: "use_composition",
          input: { name: "card", params: {}, at: { parent: "title" } },
        },
        { shadow: TREE_WITH_TEXT, assets: { compositions: [CARD_COMPOSITION] } },
      );
      expect(nonContainer.status).toBe("error");
      if (nonContainer.status === "error") expect(nonContainer.code).toBe("invalid_parent");
      expect(nonContainer.messages).toEqual([]);
      expect(nonContainer.patches).toEqual([]);
      expect(nonContainer.patchCount).toBe(0);
      expect(nonContainer.shadow).toBe(TREE_WITH_TEXT);
    });

    it("use_composition rejects an unknown composition name with invalid_composition and no patches", () => {
      const result = executeStageTool(
        {
          id: "comp-unknown",
          name: "use_composition",
          input: { name: "missing", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
      );

      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_composition");
      expect(result.messages).toEqual([]);
      expect(result.patches).toEqual([]);
      expect(result.patchCount).toBe(0);
      expect(result.shadow).toBe(ROOT_TREE);
      expect(result.observation.data).toMatchObject({
        tool: "use_composition",
        outcome: "rejected",
        patch_count: 0,
        code: "invalid_composition",
      });
      expect(result.observation.data?.message).toContain('unknown composition "missing"');
    });

    it("use_composition enforces the canonical catalog compositions allow-list", () => {
      const approved: FacetComposition = {
        name: "approved",
        root: "approved",
        nodes: {
          approved: { id: "approved", type: "section", title: "Approved", children: [] },
        },
      };
      const banned: FacetComposition = {
        name: "banned",
        root: "banned",
        nodes: {
          banned: { id: "banned", type: "section", title: "Banned", children: [] },
        },
      };

      const rejected = executeStageTool(
        {
          id: "comp-banned",
          name: "use_composition",
          input: { name: "banned", params: {}, at: { parent: "root" } },
        },
        {
          shadow: ROOT_TREE,
          assets: { catalog: CATALOG_POLICY, compositions: [approved, banned] },
        },
      );
      expect(rejected.status).toBe("error");
      if (rejected.status === "error") expect(rejected.code).toBe("invalid_composition");
      expect(rejected.messages).toEqual([]);
      expect(rejected.patches).toEqual([]);
      expect(rejected.patchCount).toBe(0);
      expect(rejected.shadow).toBe(ROOT_TREE);
      expect(rejected.observation.data).toMatchObject({
        outcome: "rejected",
        patch_count: 0,
        code: "invalid_composition",
      });
      expect(rejected.observation.data?.message).toContain("catalog policy");
      expect(rejected.observation.data?.message).toContain("banned");

      const allowed = executeStageTool(
        {
          id: "comp-approved",
          name: "use_composition",
          input: { name: "approved", params: {}, at: { parent: "root" } },
        },
        {
          shadow: ROOT_TREE,
          assets: { catalog: CATALOG_POLICY, compositions: [approved, banned] },
        },
      );
      expect(allowed.status).toBe("ok");
      expect(allowed.patches.length).toBeGreaterThan(0);
    });

    it("use_composition rejects allowed compositions whose expanded nodes violate catalog policy", () => {
      const allowedButInvalid: FacetComposition = {
        name: "approved",
        root: "chart",
        nodes: {
          chart: {
            id: "chart",
            type: "chart",
            kind: "bar",
            series: [{ label: "Usage", values: [3, 4] }],
          },
        },
      };

      const result = executeStageTool(
        {
          id: "comp-expanded-violation",
          name: "use_composition",
          input: { name: "approved", params: {}, at: { parent: "root" } },
        },
        {
          shadow: ROOT_TREE,
          assets: { catalog: CATALOG_POLICY, compositions: [allowedButInvalid] },
        },
      );

      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("invalid_composition");
      expect(result.messages).toEqual([]);
      expect(result.patches).toEqual([]);
      expect(result.patchCount).toBe(0);
      expect(result.shadow).toBe(ROOT_TREE);
      expect(result.observation.data?.message).toContain("catalog policy");
      expect(result.observation.data?.message).toContain("chart");
    });

    it("use_composition returns zero patch ops for an over-cap composition and expands at the cap boundary", () => {
      const overCap = executeStageTool(
        {
          id: "comp-over-cap",
          name: "use_composition",
          input: { name: "big", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [boxWithLeaves(MAX_PATCH_OPS)] } },
      );
      expect(overCap.status).toBe("error");
      if (overCap.status === "error") expect(overCap.code).toBe("invalid_composition");
      expect(overCap.messages).toEqual([]);
      expect(overCap.patches).toEqual([]);
      expect(overCap.patchCount).toBe(0);
      expect(overCap.shadow).toBe(ROOT_TREE);
      expect(overCap.issues.some((issue) => issue.includes("node cap"))).toBe(true);

      const atCap = executeStageTool(
        {
          id: "comp-at-cap",
          name: "use_composition",
          input: { name: "big", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [boxWithLeaves(MAX_PATCH_OPS - 1)] } },
      );
      expect(atCap.status).toBe("ok");
      expect(atCap.patchCount).toBe(MAX_PATCH_OPS);
    });

    it("use_composition normalizes a hostile caught detail into a bounded control-free no-op", () => {
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
      const assets = { compositions: [hostileComposition, CARD_COMPOSITION] };

      const hostile = executeStageTool(
        {
          id: "comp-hostile",
          name: "use_composition",
          input: { name: "hostile", params: {}, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets },
      );

      expect(hostile.status).toBe("error");
      if (hostile.status === "error") expect(hostile.code).toBe("invalid_composition");
      expect(hostile.messages).toEqual([]);
      expect(hostile.patches).toEqual([]);
      expect(hostile.patchCount).toBe(0);
      expect(hostile.shadow).toBe(ROOT_TREE);
      const serialized = JSON.stringify(hostile);
      expect(serialized).not.toContain("SENTINEL_LEAK");
      expect(serialized).not.toContain("boom");
      expect(hostile.observation.text.length).toBeLessThan(4000);
      expect(hostile.observation.text).not.toMatch(
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/,
      );

      const followUp = executeStageTool(
        {
          id: "comp-hostile-follow",
          name: "use_composition",
          input: { name: "card", params: { title: "Recovered" }, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets },
      );
      expect(followUp.status).toBe("ok");
      expect(followUp.patchCount).toBe(3);
    });

    it("use_composition treats a mint failure as a bounded no-op and a following valid call succeeds", () => {
      const mint = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
        const failure = new Error("mint boom");
        Object.defineProperty(failure, "message", {
          get(): string {
            throw new Error("SENTINEL_MINT");
          },
        });
        throw failure;
      });
      try {
        const result = executeStageTool(
          {
            id: "comp-mint-failure",
            name: "use_composition",
            input: { name: "card", params: { title: "Hello" }, at: { parent: "root" } },
          },
          { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
        );

        expect(result.status).toBe("error");
        if (result.status === "error") expect(result.code).toBe("invalid_composition");
        expect(result.messages).toEqual([]);
        expect(result.patches).toEqual([]);
        expect(result.patchCount).toBe(0);
        expect(result.shadow).toBe(ROOT_TREE);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain("SENTINEL_MINT");
        expect(serialized).not.toContain("mint boom");
        expect(result.issues.some((issue) => issue.includes("mintId failed"))).toBe(true);
      } finally {
        mint.mockRestore();
      }

      const followUp = executeStageTool(
        {
          id: "comp-mint-follow",
          name: "use_composition",
          input: { name: "card", params: { title: "Recovered" }, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
      );
      expect(followUp.status).toBe("ok");
      expect(followUp.patchCount).toBe(3);
    });

    it(`use_composition replaces the old tool: ${legacyTool} is unknown and never an alias`, () => {
      const result = executeStageTool(
        {
          id: "comp-old-tool",
          name: legacyTool,
          input: { name: "card", params: { title: "Hello" }, at: { parent: "root" } },
        },
        { shadow: ROOT_TREE, assets: { compositions: [CARD_COMPOSITION] } },
      );

      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.code).toBe("unknown_tool");
      expect(result.messages).toEqual([]);
      expect(result.patches).toEqual([]);
      expect(result.patchCount).toBe(0);
      expect(result.shadow).toBe(ROOT_TREE);
      const message = result.observation.data?.message ?? "";
      expect(message).toContain(`unknown tool "${legacyTool}"`);
      const availableTools = message.split("Available tools:")[1] ?? "";
      expect(availableTools).toContain("use_composition");
      expect(availableTools).not.toContain(legacyTool);
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
      {
        op: "add",
        path: "/nodes/title",
        value: { id: "title", type: "text", value: "T", style: {} },
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
        value: { id: "a/b~c", type: "text", value: "escaped", style: {} },
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

  describe("catalog policy", () => {
    it("catalog policy allows catalog-listed components and primitive fallback", () => {
      const section = executeStageTool(
        {
          id: "catalog-section",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: {
              id: "hero",
              type: "section",
              title: "Overview",
              variant: "surface",
              children: [],
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(section.status).toBe("ok");
      expect(section.patches).toEqual([
        {
          op: "add",
          path: "/nodes/hero",
          value: {
            id: "hero",
            type: "section",
            title: "Overview",
            variant: "surface",
            children: [],
          },
        },
        { op: "add", path: "/nodes/root/children/-", value: "hero" },
      ]);

      const button = executeStageTool(
        {
          id: "catalog-button",
          name: "append_node",
          input: {
            parentId: "hero",
            ["node"]: { id: "cta", type: "button", label: "Start", variant: "primary" },
          },
        },
        { shadow: section.shadow, assets: { catalog: CATALOG_POLICY } },
      );

      expect(button.status).toBe("ok");
      expect(button.patches).toEqual([
        {
          op: "add",
          path: "/nodes/cta",
          value: { id: "cta", type: "button", label: "Start", variant: "primary" },
        },
        { op: "add", path: "/nodes/hero/children/-", value: "cta" },
      ]);

      const primitive = executeStageTool(
        {
          id: "catalog-primitive",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: { id: "copy", type: "text", value: "Primitive fallback stays valid." },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(primitive.status).toBe("ok");
      expect(primitive.patches).toHaveLength(2);
    });

    it("catalog policy rejects disallowed component types and variants without patches", () => {
      const chart = executeStageTool(
        {
          id: "catalog-chart",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: {
              id: "chart",
              type: "chart",
              kind: "line",
              series: [{ label: "Revenue", values: [1, 2, 3] }],
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(chart.status).toBe("error");
      expect(chart.patches).toEqual([]);
      expect(chart.messages).toEqual([]);
      expect(chart.shadow).toBe(ROOT_TREE);
      expect(parseAgentToolObservation(chart.observation.text)).toMatchObject({
        outcome: "rejected",
        applied: false,
        stage_changed: false,
        patch_count: 0,
      });
      expect(chart.observation.text).toContain("catalog policy");
      expect(chart.observation.text).toContain("chart");

      const variant = executeStageTool(
        {
          id: "catalog-variant",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: { id: "danger", type: "button", label: "Delete", variant: "danger" },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(variant.status).toBe("error");
      expect(variant.patches).toEqual([]);
      expect(variant.messages).toEqual([]);
      expect(parseAgentToolObservation(variant.observation.text)).toMatchObject({
        outcome: "rejected",
        patch_count: 0,
      });
      expect(variant.observation.text).toContain("variant");
      expect(variant.observation.text).toContain("danger");
    });

    it("catalog policy enforces component aliases before divergent legacy bricks", () => {
      const catalog: FacetCatalog = {
        ...CATALOG_POLICY,
        bricks: [{ type: "button", variants: ["primary"] }],
        components: [{ type: "metric", variants: ["success"] }],
        compositions: { mode: "all" },
      };

      const metric = executeStageTool(
        {
          id: "catalog-component-metric",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: {
              id: "metric",
              type: "metric",
              label: "ARR",
              value: "$24k",
              variant: "success",
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog } },
      );

      expect(metric.status).toBe("ok");
      expect(metric.patches).toHaveLength(2);

      const legacyOnlyButton = executeStageTool(
        {
          id: "catalog-component-button",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: { id: "button", type: "button", label: "Legacy only", variant: "primary" },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog } },
      );

      expect(legacyOnlyButton.status).toBe("error");
      expect(legacyOnlyButton.patches).toEqual([]);
      expect(legacyOnlyButton.observation.text).toContain("metric");
      expect(legacyOnlyButton.observation.text).not.toContain("Allowed node types: button");
    });

    it("catalog policy falls a legacy stat node through to the bricks list when components omit it", () => {
      const catalog: FacetCatalog = {
        ...CATALOG_POLICY,
        bricks: [{ type: "stat" }],
        components: [{ type: "button", variants: ["primary"] }],
        compositions: { mode: "all" },
      };

      // (a) stat is a component type absent from `components`, but the legacy
      // carve-out lets it fall through to the bricks entry that permits it.
      const stat = executeStageTool(
        {
          id: "catalog-stat-fallthrough",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: { id: "kpi", type: "stat", label: "ARR", value: "$24k" },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog } },
      );
      expect(stat.status).toBe("ok");
      expect(stat.patches).toHaveLength(2);

      // (b) a different component type absent from `components` gets no carve-out.
      const metricNode = executeStageTool(
        {
          id: "catalog-metric-rejected",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: { id: "arr", type: "metric", label: "ARR", value: "$24k" },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog } },
      );
      expect(metricNode.status).toBe("error");
      expect(metricNode.patches).toEqual([]);

      // (c) the carve-out only reaches the bricks list; a bricks list that omits
      // stat still rejects it.
      const statNoBrick: FacetCatalog = {
        ...catalog,
        bricks: [{ type: "button", variants: ["primary"] }],
        primitiveFallback: "discouraged",
      };
      const statRejected = executeStageTool(
        {
          id: "catalog-stat-rejected",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: { id: "kpi", type: "stat", label: "ARR", value: "$24k" },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: statNoBrick } },
      );
      expect(statRejected.status).toBe("error");
      expect(statRejected.patches).toEqual([]);
    });

    it("catalog policy rejects tone-only recipe selectors not listed as variants", () => {
      const toneCatalog: FacetCatalog = {
        ...CATALOG_POLICY,
        bricks: [{ type: "badge", variants: ["neutral"] }],
      };

      const toneRejected = executeStageTool(
        {
          id: "catalog-tone",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: { id: "status", type: "badge", label: "Healthy", tone: "success" },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: toneCatalog } },
      );

      expect(toneRejected.status).toBe("error");
      expect(toneRejected.patches).toEqual([]);
      expect(toneRejected.messages).toEqual([]);
      expect(parseAgentToolObservation(toneRejected.observation.text)).toMatchObject({
        outcome: "rejected",
        patch_count: 0,
      });
      expect(toneRejected.observation.text).toContain("tone");
      expect(toneRejected.observation.text).toContain("success");

      const variantWins = executeStageTool(
        {
          id: "catalog-tone-with-variant",
          name: "append_node",
          input: {
            parentId: "root",
            ["node"]: {
              id: "status",
              type: "badge",
              label: "Healthy",
              variant: "neutral",
              tone: "success",
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: toneCatalog } },
      );

      expect(variantWins.status).toBe("ok");
    });

    it("catalog policy rejects disallowed set_node brick types and variants without patches", () => {
      const typeRejected = executeStageTool(
        {
          id: "catalog-set-chart",
          name: "set_node",
          input: {
            ["node"]: {
              id: "chart",
              type: "chart",
              kind: "bar",
              series: [{ label: "Usage", values: [3, 4] }],
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(typeRejected.status).toBe("error");
      expect(typeRejected.patches).toEqual([]);
      expect(typeRejected.messages).toEqual([]);
      expect(typeRejected.shadow).toBe(ROOT_TREE);
      expect(parseAgentToolObservation(typeRejected.observation.text)).toMatchObject({
        outcome: "rejected",
        patch_count: 0,
      });
      expect(typeRejected.observation.text).toContain("catalog policy");
      expect(typeRejected.observation.text).toContain("chart");

      const variantRejected = executeStageTool(
        {
          id: "catalog-set-danger",
          name: "set_node",
          input: { ["node"]: { id: "danger", type: "button", label: "Delete", variant: "danger" } },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(variantRejected.status).toBe("error");
      expect(variantRejected.patches).toEqual([]);
      expect(variantRejected.messages).toEqual([]);
      expect(variantRejected.shadow).toBe(ROOT_TREE);
      expect(parseAgentToolObservation(variantRejected.observation.text)).toMatchObject({
        outcome: "rejected",
        patch_count: 0,
      });
      expect(variantRejected.observation.text).toContain("variant");
      expect(variantRejected.observation.text).toContain("danger");
    });

    it("catalog policy rejects disallowed render_page trees before patch emission", () => {
      const result = executeStageTool(
        {
          id: "catalog-render",
          name: "render_page",
          input: {
            tree: {
              root: "root",
              nodes: {
                root: { id: "root", type: "box", children: ["chart"] },
                chart: {
                  id: "chart",
                  type: "chart",
                  kind: "bar",
                  series: [{ label: "Usage", values: [3, 4] }],
                },
              },
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(result.status).toBe("error");
      expect(result.patches).toEqual([]);
      expect(result.messages).toEqual([]);
      expect(result.shadow).toBe(ROOT_TREE);
      expect(parseAgentToolObservation(result.observation.text)).toMatchObject({
        outcome: "rejected",
        patch_count: 0,
      });
      expect(result.observation.text).toContain("catalog policy");
      expect(result.observation.text).toContain("chart");
    });

    it("catalog policy rejects locked theme changes without patches", () => {
      const result = executeStageTool(
        { id: "catalog-theme", name: "set_theme", input: { name: "midnight" } },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(result.status).toBe("error");
      expect(result.patches).toEqual([]);
      expect(result.messages).toEqual([]);
      expect(result.shadow).toBe(ROOT_TREE);
      expect(parseAgentToolObservation(result.observation.text)).toMatchObject({
        outcome: "rejected",
        patch_count: 0,
      });
      expect(result.observation.text).toContain("catalog policy");
      expect(result.observation.text).toContain("locked");
    });

    it("render_page preserves the active locked catalog theme when omitted", () => {
      const result = executeStageTool(
        {
          id: "catalog-render-theme",
          name: "render_page",
          input: {
            tree: {
              root: "root",
              nodes: {
                root: { id: "root", type: "box", children: ["copy"] },
                copy: { id: "copy", type: "text", value: "Themed" },
              },
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: CATALOG_POLICY } },
      );

      expect(result.status).toBe("ok");
      expect(result.shadow.theme).toBe("default");
      expect(result.patches).toEqual([
        {
          op: "replace",
          path: "",
          value: {
            root: "root",
            theme: "default",
            nodes: {
              root: { id: "root", type: "box", children: ["copy"], style: {} },
              copy: { id: "copy", type: "text", value: "Themed", style: {} },
            },
          },
        },
      ]);
    });

    it("render_page does not preserve a stale shadow theme without a locked catalog", () => {
      const themedShadow: FacetTree = { ...ROOT_TREE, theme: "midnight" };
      const result = executeStageTool(
        {
          id: "catalog-render-no-policy",
          name: "render_page",
          input: {
            tree: {
              root: "root",
              nodes: {
                root: { id: "root", type: "box", children: ["copy"] },
                copy: { id: "copy", type: "text", value: "Plain" },
              },
            },
          },
        },
        { shadow: themedShadow },
      );

      expect(result.status).toBe("ok");
      expect(result.shadow).not.toHaveProperty("theme");
      expect(result.patches[0]).toMatchObject({
        op: "replace",
        path: "",
      });
      expect((result.patches[0] as { value?: FacetTree }).value).not.toHaveProperty("theme");
    });

    it("render_page leaves theme omitted when the catalog allows switching", () => {
      const allowedCatalog: FacetCatalog = {
        ...CATALOG_POLICY,
        theme: { active: "default", switchPolicy: "allowed", allowed: ["default", "midnight"] },
      };
      const result = executeStageTool(
        {
          id: "catalog-render-allowed-theme",
          name: "render_page",
          input: {
            tree: {
              root: "root",
              nodes: {
                root: { id: "root", type: "box", children: ["copy"] },
                copy: { id: "copy", type: "text", value: "Allowed" },
              },
            },
          },
        },
        { shadow: ROOT_TREE, assets: { catalog: allowedCatalog } },
      );

      expect(result.status).toBe("ok");
      expect(result.shadow).not.toHaveProperty("theme");
      expect((result.patches[0] as { value?: FacetTree }).value).not.toHaveProperty("theme");
    });
  });
});
