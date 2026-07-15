// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DataWarehouse, FacetNode, FacetTree, NodeId } from "@facet/core";
import { foldPatchIntoStage } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
}

const box = (id: NodeId, children: readonly NodeId[], maxWidth?: "narrow"): FacetNode => ({
  id,
  type: "box",
  children,
  ...(maxWidth === undefined ? {} : { style: { maxWidth } }),
});
const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const stale = (id: NodeId, type: string, children: readonly NodeId[] = []): FacetNode =>
  ({ id, type, children }) as unknown as FacetNode;

const RETIRED_RENDERERS = {
  layout: ["renderButton", "renderTabs", "renderNav"],
  inputs: ["renderForm", "renderFilterBar"],
  data: ["renderMetric", "renderStat"],
} as const;
const RETIRED_TYPES = ["button", "tabs", "nav", "form", "filterBar", "metric", "stat"] as const;

describe("StageRenderer brick layout contract", () => {
  it("exports no retired renderer and skips every stale subtree", async () => {
    const [layoutRenderers, inputRenderers, dataRenderers] = await Promise.all([
      import("./brick-renderer-layout.js"),
      import("./brick-renderer-inputs.js"),
      import("./brick-renderer-data.js"),
    ]);

    for (const name of RETIRED_RENDERERS.layout) expect(layoutRenderers).not.toHaveProperty(name);
    for (const name of RETIRED_RENDERERS.inputs) expect(inputRenderers).not.toHaveProperty(name);
    for (const name of RETIRED_RENDERERS.data) expect(dataRenderers).not.toHaveProperty(name);

    for (const type of RETIRED_TYPES) {
      const staleRoot = render(
        tree(
          {
            stale: stale("stale", type, ["secret"]),
            secret: text("secret", `secret root ${type}`),
          },
          "stale",
        ),
      );
      expect(staleRoot).not.toContain(`secret root ${type}`);

      const staleChild = render(
        tree({
          root: box("root", ["before", "stale", "after"]),
          before: text("before", "before safe"),
          stale: stale("stale", type, ["secret"]),
          secret: text("secret", `secret child ${type}`),
          after: text("after", "after safe"),
        }),
      );
      expect(staleChild).toContain("before safe");
      expect(staleChild).toContain("after safe");
      expect(staleChild).not.toContain(`secret child ${type}`);
    }

    const staleScreen = render({
      root: "fallback",
      screens: { home: "form" },
      entry: "home",
      nodes: {
        fallback: text("fallback", "fallback copy"),
        form: stale("form", "form", ["screenSecret"]),
        screenSecret: text("screenSecret", "secret screen/form descendant"),
      },
    });
    expect(staleScreen).not.toContain("secret screen/form descendant");
  });

  it("renders every survivor with bounded roots and no retired copy", () => {
    const out = render(
      tree({
        root: box("root", ["input", "table", "chart", "details", "progress", "list", "loading"]),
        input: {
          id: "input",
          type: "input",
          name: "email",
          input: "email",
          label: "Email",
          placeholder: "you@example.com",
        },
        table: {
          id: "table",
          type: "table",
          caption: "Accounts",
          columns: [{ key: "name", label: "Name" }],
          rows: [{ name: "Acme" }],
        },
        chart: {
          id: "chart",
          type: "chart",
          title: "Revenue",
          kind: "bar",
          series: [{ label: "ARR", values: [10, 20] }],
        },
        details: {
          id: "details",
          type: "keyValue",
          items: [{ label: "Owner", value: "Design", tone: "success" }],
        },
        progress: { id: "progress", type: "progress", label: "Migration", value: 72 },
        list: {
          id: "list",
          type: "list",
          items: [{ title: "Next", body: "Call customer" }],
        },
        loading: { id: "loading", type: "loading", label: "Loading accounts" },
      }),
    );

    for (const copy of [
      "Email",
      "Accounts",
      "Acme",
      "Revenue",
      "Owner",
      "Design",
      "Migration",
      "Next",
      "Call customer",
      "Loading accounts",
    ]) {
      expect(out).toContain(copy);
    }
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('role="status"');
    expect(out.match(/box-sizing:border-box/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/min-width:0/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/max-width:100%/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/overflow-wrap:anywhere/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/overflow-x:auto/g)).toHaveLength(1);
    expect(out).not.toContain("Legacy ARR");
  });

  it("keeps long survivor labels inside a narrow normal-flow container", () => {
    const long = `Long-${"label".repeat(30)}`;
    const out = render(
      tree({
        root: box("root", ["input", "table", "details", "progress", "list", "loading"], "narrow"),
        input: { id: "input", type: "input", label: long, name: "query" },
        table: {
          id: "table",
          type: "table",
          columns: [{ key: "value", label: long }],
          rows: [{ value: long }],
        },
        details: { id: "details", type: "keyValue", items: [{ label: long, value: long }] },
        progress: { id: "progress", type: "progress", label: long, value: 50 },
        list: { id: "list", type: "list", items: [{ title: long, body: long }] },
        loading: { id: "loading", type: "loading", label: long },
      }),
    );

    expect(out).toContain("max-width:640px");
    expect(out).toContain(long);
    expect(out.match(/overflow-wrap:anywhere/g)?.length ?? 0).toBeGreaterThan(10);
    expect(out).not.toContain("position:absolute");
  });

  it("keeps hostile raw survivor data fail-safe and non-injecting", () => {
    const hostile = tree({
      root: box("root", ["input", "table", "details", "progress", "list", "loading", "safe"]),
      input: { id: "input", type: "input", label: { nope: true } } as unknown as FacetNode,
      table: { id: "table", type: "table", columns: "bad", rows: "bad" } as unknown as FacetNode,
      details: {
        id: "details",
        type: "keyValue",
        items: [
          { label: "Owner", value: { nope: true } },
          { label: "Plan", value: "Team" },
        ],
      } as unknown as FacetNode,
      progress: {
        id: "progress",
        type: "progress",
        label: { nope: true },
        value: Infinity,
      } as unknown as FacetNode,
      list: {
        id: "list",
        type: "list",
        items: [{ title: { nope: true } }, "Safe item"],
      } as unknown as FacetNode,
      loading: { id: "loading", type: "loading", label: { nope: true } } as unknown as FacetNode,
      safe: text("safe", "safe child"),
    });

    expect(() => render(hostile)).not.toThrow();
    const out = render(hostile);
    expect(out).toContain("safe child");
    expect(out).toContain("Team");
    expect(out).toContain("Safe item");
    expect(out).not.toContain("[object Object]");
    expect(out).not.toContain("<script");
  });
});

describe("StageRenderer table data bindings", () => {
  const SALES: DataWarehouse = {
    sales: [
      { region: "West", revenue: 50 },
      { region: "East", revenue: 100 },
    ],
  };

  it("renders a from:'sales' table's dataset rows via its own columns[].key", () => {
    const app: FacetTree = {
      root: "root",
      nodes: {
        root: box("root", ["table"]),
        table: {
          id: "table",
          type: "table",
          columns: [
            { key: "region", label: "Region" },
            { key: "revenue", label: "Revenue" },
          ],
          rows: [],
          from: "sales",
        },
      },
      data: SALES,
    };

    const out = render(app);
    expect(out).toContain(">West<");
    expect(out).toContain(">East<");
    expect(out).toContain(">50<");
    expect(out).toContain(">100<");
  });

  it("reflects one /data patch in both a from-bound table and chart", () => {
    const base: FacetTree = {
      root: "root",
      nodes: {
        root: box("root", ["table", "chart"]),
        table: {
          id: "table",
          type: "table",
          columns: [
            { key: "region", label: "Region" },
            { key: "revenue", label: "Revenue" },
          ],
          rows: [],
          from: "sales",
        },
        chart: { id: "chart", type: "chart", kind: "bar", series: [], from: "sales" },
      },
      data: SALES,
    };

    const before = render(base);
    expect(before).toContain(">100<");
    expect(before).toContain('height="50"');

    const { tree: updated } = foldPatchIntoStage(base, [
      { op: "replace", path: "/data/sales/1/revenue", value: 200 },
    ]);

    const after = render(updated);
    expect(after).toContain(">200<");
    expect(after).not.toContain(">100<");
    expect(after).toContain('height="25"');
    expect(after).not.toContain('height="50"');
  });
});
