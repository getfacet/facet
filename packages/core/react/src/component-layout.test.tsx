// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderDom, screen } from "@testing-library/react";
import type { DataWarehouse, FacetNode, FacetTree, NodeId } from "@facet/core";
import { foldPatchIntoStage } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
}

const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({ id, type: "box", children });
const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });

describe("StageRenderer component layout contract", () => {
  it("renders every new intrinsic component plus legacy stat with bounded roots", () => {
    const out = render(
      tree({
        root: box("root", [
          "nav",
          "form",
          "filters",
          "details",
          "metric",
          "stat",
          "empty",
          "loading",
          "table",
        ]),
        nav: {
          id: "nav",
          type: "nav",
          items: [
            { label: "Overview", to: "home" },
            { label: "Reports", to: "reports" },
          ],
        },
        form: {
          id: "form",
          type: "form",
          title: "Contact",
          body: "Send a follow-up",
          submitLabel: "Send",
          onSubmit: { kind: "agent", name: "submit", collect: "form" },
          children: ["email"],
        },
        email: {
          id: "email",
          type: "input",
          name: "email",
          input: "email",
          label: "Email",
          placeholder: "you@example.com",
        },
        filters: {
          id: "filters",
          type: "filterBar",
          filters: [
            { name: "status", label: "Status", input: "select", options: ["Open", "Closed"] },
            { name: "urgent", label: "Urgent", input: "checkbox", value: true },
          ],
          onChange: { kind: "agent", name: "filter", collect: "filters" },
        },
        details: {
          id: "details",
          type: "keyValue",
          items: [
            { label: "Owner", value: "Design" },
            { label: "Plan", value: "Enterprise", tone: "success" },
          ],
        },
        metric: { id: "metric", type: "metric", label: "ARR", value: "$24k", delta: "+12%" },
        stat: { id: "stat", type: "stat", label: "Legacy ARR", value: "$22k", delta: "+8%" },
        empty: {
          id: "empty",
          type: "box",
          children: ["emptyTitle", "emptyBody", "emptyAction"],
        },
        emptyTitle: text("emptyTitle", "No results"),
        emptyBody: text("emptyBody", "Try a different filter."),
        emptyAction: {
          id: "emptyAction",
          type: "button",
          label: "Reset",
          onPress: { kind: "agent", name: "reset" },
        },
        loading: { id: "loading", type: "loading", label: "Loading accounts" },
        table: {
          id: "table",
          type: "table",
          columns: [{ key: "name", label: "Name" }],
          rows: [{ name: "Acme" }],
        },
      }),
    );

    expect(out).toContain("<nav");
    expect(out).toContain("Reports");
    expect(out).toContain("<form");
    expect(out).toContain("Contact");
    expect(out).toContain("Status");
    expect(out).toContain("Urgent");
    expect(out).toContain("Owner");
    expect(out).toContain("Design");
    expect(out).toContain("$24k");
    expect(out).toContain("Legacy ARR");
    expect(out).toContain("No results");
    expect(out).toContain('role="status"');
    expect(out).toContain("Loading accounts");
    expect(out.match(/box-sizing:border-box/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/min-width:0/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/max-width:100%/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/overflow-wrap:anywhere/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/overflow-x:auto/g)).toHaveLength(1);
  });

  it("routes new intrinsic interactions through existing local and agent channels", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    const app: FacetTree = {
      root: "root",
      screens: { home: "home", about: "about" },
      entry: "home",
      nodes: {
        root: box("root", ["rootText"]),
        rootText: text("rootText", "root fallback"),
        home: {
          id: "home",
          type: "box",
          children: ["nav", "form", "filters", "empty"],
        },
        about: { id: "about", type: "box", children: ["aboutText"] },
        aboutText: text("aboutText", "about content"),
        nav: { id: "nav", type: "nav", items: [{ label: "About", to: "about" }] },
        form: {
          id: "form",
          type: "form",
          title: "Contact",
          submitLabel: "Send",
          onSubmit: { kind: "agent", name: "submit", collect: "form" },
          children: ["email"],
        },
        email: { id: "email", type: "input", name: "email", placeholder: "email" },
        filters: {
          id: "filters",
          type: "filterBar",
          filters: [
            { name: "status", label: "Status", input: "select", options: ["Open", "Closed"] },
          ],
          onChange: { kind: "agent", name: "filter", collect: "filters" },
        },
        empty: {
          id: "empty",
          type: "box",
          children: ["emptyTitle", "emptyAction"],
        },
        emptyTitle: text("emptyTitle", "No rows"),
        emptyAction: {
          id: "emptyAction",
          type: "button",
          label: "Reload",
          onPress: { kind: "agent", name: "reload" },
        },
      },
    };

    renderDom(<StageRenderer onAction={onAction} onRecord={onRecord} tree={app} />);

    fireEvent.change(screen.getByPlaceholderText("email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { email: "ada@example.com" },
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "Closed" } });
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "filter" }, { status: "Closed" });

    onAction.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "reload" });

    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText("about content")).toBeTruthy();
    expect(onRecord).toHaveBeenCalledWith({
      kind: "tap",
      target: "nav",
      effect: { navigate: "about" },
    });
  });

  it("applies hidden/toggle visibility to new intrinsic component roots", () => {
    renderDom(
      <StageRenderer
        tree={tree({
          root: box("root", ["toggle", "empty"]),
          toggle: {
            id: "toggle",
            type: "box",
            onPress: { kind: "toggle", target: "empty" },
            children: ["toggleText"],
          },
          toggleText: text("toggleText", "Toggle"),
          empty: {
            id: "empty",
            type: "box",
            hidden: true,
            children: ["emptyText"],
          },
          emptyText: text("emptyText", "Hidden empty state"),
        })}
      />,
    );

    expect(screen.queryByText("Hidden empty state")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByText("Hidden empty state")).toBeTruthy();
  });

  it("keeps hostile raw-path component data fail-safe and non-injecting", () => {
    const hostile = tree({
      root: box("root", [
        "nav",
        "form",
        "filters",
        "details",
        "metric",
        "empty",
        "loading",
        "safe",
      ]),
      nav: { id: "nav", type: "nav", items: "bad" } as unknown as FacetNode,
      form: {
        id: "form",
        type: "form",
        title: { nope: true },
        children: "bad",
      } as unknown as FacetNode,
      filters: {
        id: "filters",
        type: "filterBar",
        filters: [{ name: "status", label: "Status", value: { nope: true } }],
      } as unknown as FacetNode,
      details: {
        id: "details",
        type: "keyValue",
        items: [
          { label: "Owner", value: { nope: true } },
          { label: "Plan", value: "Team" },
        ],
      } as unknown as FacetNode,
      metric: { id: "metric", type: "metric", label: "ARR" } as unknown as FacetNode,
      empty: {
        id: "empty",
        type: "box",
        children: ["emptyBody"],
      },
      emptyBody: text("emptyBody", "Still bounded"),
      loading: { id: "loading", type: "loading", label: { bad: true } } as unknown as FacetNode,
      safe: text("safe", "safe child"),
    });

    expect(() => render(hostile)).not.toThrow();
    const out = render(hostile);
    expect(out).toContain("safe child");
    expect(out).toContain("Still bounded");
    expect(out).toContain("Team");
    expect(out).not.toContain("[object Object]");
    expect(out).not.toContain("<script");
  });
});

describe("StageRenderer table data bindings", () => {
  // One dataset every bound view resolves against (author once, bind many).
  const SALES: DataWarehouse = {
    sales: [
      { region: "West", revenue: 50 },
      { region: "East", revenue: 100 },
    ],
  };

  // DC-001: a from-bound table projects the named dataset rows through its own
  // `columns[].key`, ignoring the (omitted/empty) inline `rows`.
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
    // Cells resolved from data.sales via the table's own column keys (anchored to
    // element text so a stray digit inside a style value can't satisfy it).
    expect(out).toContain(">West<");
    expect(out).toContain(">East<");
    expect(out).toContain(">50<");
    expect(out).toContain(">100<");
  });

  // DC-002: single source → many views. ONE `replace /data/sales/1/revenue` op,
  // folded through the SAME core `foldPatchIntoStage` both sides run, updates
  // BOTH a bound table cell and a bound chart series.
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

    // Baseline: table cell shows 100; chart series [50,100] → max 100, so row 0's
    // bar is scaled to height 50.
    const before = render(base);
    expect(before).toContain(">100<");
    expect(before).toContain('height="50"');

    // ONE cell update through the shared fold.
    const { tree: updated } = foldPatchIntoStage(base, [
      { op: "replace", path: "/data/sales/1/revenue", value: 200 },
    ]);

    const after = render(updated);
    // Table reflects the new cell value...
    expect(after).toContain(">200<");
    expect(after).not.toContain(">100<");
    // ...and the SAME dataset reshapes the chart: series is now [50,200] → max
    // 200, so row 0's bar rescales to height 25 (only possible if the chart read
    // the updated dataset, not the old one).
    expect(after).toContain('height="25"');
    expect(after).not.toContain('height="50"');
  });
});
