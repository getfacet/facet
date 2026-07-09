import { describe, expect, it } from "vitest";

import { EMPTY_TREE, isTreeShaped, treeHasContent } from "./tree.js";
import type { FacetTree } from "./tree.js";

describe("isTreeShaped", () => {
  it("accepts a well-formed tree (including EMPTY_TREE)", () => {
    expect(isTreeShaped(EMPTY_TREE)).toBe(true);
    expect(isTreeShaped({ root: "root", nodes: {} })).toBe(true);
  });

  it("rejects non-objects and arrays", () => {
    expect(isTreeShaped(undefined)).toBe(false);
    expect(isTreeShaped(null)).toBe(false);
    expect(isTreeShaped("x")).toBe(false);
    expect(isTreeShaped([{ root: "root", nodes: {} }])).toBe(false);
  });

  it("requires a string root", () => {
    expect(isTreeShaped({ nodes: {} })).toBe(false);
    expect(isTreeShaped({ root: 1, nodes: {} })).toBe(false);
  });

  it("requires nodes to be a non-null, non-array object", () => {
    expect(isTreeShaped({ root: "root" })).toBe(false);
    expect(isTreeShaped({ root: "root", nodes: null })).toBe(false);
    expect(isTreeShaped({ root: "root", nodes: [] })).toBe(false);
    expect(isTreeShaped({ root: "root", nodes: "x" })).toBe(false);
  });

  it("stays shallow: does not require root to name an existing node", () => {
    // The stricter layers (root-node existence, box-ness, child resolution)
    // belong to callers — this base guard only checks the outer shape.
    expect(isTreeShaped({ root: "missing", nodes: {} })).toBe(true);
  });
});

describe("treeHasContent", () => {
  const tree = (nodes: unknown, screens?: unknown): FacetTree =>
    ({ root: "r", nodes, ...(screens !== undefined ? { screens } : {}) }) as unknown as FacetTree;

  it("true when the root box has a renderable child", () => {
    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["a"] },
          a: { id: "a", type: "text", value: "A" },
        }),
      ),
    ).toBe(true);
  });

  it("false for an empty children array", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "box", children: [] } }))).toBe(false);
  });

  it("false — and does NOT throw — for a foreign box root with no children field", () => {
    // Exactly the shape FileStageStore's isTreeShaped admits; must fail safe.
    const t = tree({ r: { id: "r", type: "box" } });
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });

  it("false — and does NOT throw — for a foreign box root with non-array children", () => {
    const t = tree({ r: { id: "r", type: "box", children: "not-array" } });
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });

  it("false for a non-container (text) root", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "text", value: "x" } }))).toBe(false);
  });

  it("false when the root node is missing", () => {
    expect(treeHasContent(tree({}))).toBe(false);
  });

  it("false when screens is non-empty but points only at blank roots", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "box", children: [] } }, { home: "r" }))).toBe(
      false,
    );
  });

  it("true when a screen root has renderable content", () => {
    expect(
      treeHasContent(
        tree(
          {
            r: { id: "r", type: "box", children: [] },
            screen: { id: "screen", type: "box", children: ["copy"] },
            copy: { id: "copy", type: "text", value: "Copy" },
          },
          { home: "screen" },
        ),
      ),
    ).toBe(true);
  });

  it("false when the entry screen is blank even if another screen has content", () => {
    expect(
      treeHasContent({
        root: "shell",
        nodes: {
          shell: { id: "shell", type: "box", children: [] },
          home: { id: "home", type: "box", children: [] },
          about: { id: "about", type: "box", children: ["copy"] },
          copy: { id: "copy", type: "text", value: "About" },
        },
        screens: { home: "home", about: "about" },
        entry: "home",
      } satisfies FacetTree),
    ).toBe(false);
  });

  it("falls back to the first live screen when entry is missing or invalid", () => {
    expect(
      treeHasContent({
        root: "shell",
        nodes: {
          shell: { id: "shell", type: "box", children: [] },
          about: { id: "about", type: "box", children: ["copy"] },
          copy: { id: "copy", type: "text", value: "About" },
        },
        screens: { about: "about" },
        entry: "missing",
      } satisfies FacetTree),
    ).toBe(true);
  });

  it("false — and does NOT throw — when a foreign tree has null screens", () => {
    const t = tree({ r: { id: "r", type: "box", children: [] } }, null);
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });

  it("false for non-object screens on a foreign tree", () => {
    expect(treeHasContent(tree({ r: { id: "r", type: "box", children: [] } }, "home"))).toBe(false);
  });

  it("false — and does NOT throw — for array-valued screens on a foreign tree", () => {
    const t = tree({ r: { id: "r", type: "box", children: [] } }, ["home"]);
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(false);
  });

  it("false for high-level data bricks with no renderable data", () => {
    for (const child of [
      { id: "child", type: "table", columns: [], rows: [] },
      { id: "child", type: "chart", kind: "bar", series: [] },
      { id: "child", type: "tabs", items: [] },
      { id: "child", type: "list", items: [] },
    ]) {
      expect(
        treeHasContent(
          tree({
            r: { id: "r", type: "box", children: ["child"] },
            child,
          }),
        ),
      ).toBe(false);
    }
  });

  it("true for high-level data bricks with renderable data", () => {
    for (const child of [
      { id: "child", type: "table", columns: [{ key: "name", label: "Name" }], rows: [] },
      { id: "child", type: "chart", kind: "bar", series: [{ label: "A", values: [1] }] },
      { id: "child", type: "tabs", items: [{ label: "Home", to: "home" }] },
      { id: "child", type: "list", items: [{ title: "Item" }] },
    ]) {
      expect(
        treeHasContent(
          tree({
            r: { id: "r", type: "box", children: ["child"] },
            child,
          }),
        ),
      ).toBe(true);
    }
  });

  it("true for metric and legacy stat nodes with renderable values", () => {
    for (const child of [
      { id: "child", type: "metric", label: "ARR", value: "$24k" },
      { id: "child", type: "stat", label: "ARR", value: "$24k" },
    ]) {
      expect(
        treeHasContent(
          tree({
            r: { id: "r", type: "box", children: ["child"] },
            child,
          }),
        ),
      ).toBe(true);
    }
  });

  it("true for nav, keyValue, emptyState, and loading intrinsic components with content", () => {
    for (const child of [
      { id: "child", type: "nav", items: [{ label: "Home", to: "home" }] },
      { id: "child", type: "keyValue", items: [{ label: "Owner", value: "Design" }] },
      { id: "child", type: "emptyState", title: "No projects yet" },
      { id: "child", type: "loading" },
    ]) {
      expect(
        treeHasContent(
          tree({
            r: { id: "r", type: "box", children: ["child"] },
            child,
          }),
        ),
      ).toBe(true);
    }
  });

  it("false for hostile empty intrinsic component payloads", () => {
    for (const child of [
      { id: "child", type: "metric", label: "ARR" },
      { id: "child", type: "nav", items: [] },
      { id: "child", type: "keyValue", items: [] },
      { id: "child", type: "emptyState" },
      { id: "child", type: "form", children: [] },
      { id: "child", type: "search" },
      { id: "child", type: "filterBar", filters: [] },
    ]) {
      const t = tree({
        r: { id: "r", type: "box", children: ["child"] },
        child,
      });
      expect(() => treeHasContent(t)).not.toThrow();
      expect(treeHasContent(t)).toBe(false);
    }
  });

  it("does not count malformed media kind as renderable content", () => {
    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["media"] },
          media: { id: "media", type: "media", kind: "gif", src: "https://example.com/a.gif" },
        }),
      ),
    ).toBe(false);
    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["image"] },
          image: { id: "image", type: "image", src: "https://example.com/a.png" },
        }),
      ),
    ).toBe(true);
  });

  it("does not count an empty radio group as renderable content", () => {
    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["choice"] },
          choice: { id: "choice", type: "field", name: "plan", input: "radio", options: [] },
        }),
      ),
    ).toBe(false);

    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["choice"] },
          choice: {
            id: "choice",
            type: "field",
            name: "plan",
            input: "radio",
            options: ["pro"],
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not read container children beyond the renderability budget", () => {
    const children: unknown[] = [];
    children.length = 6_000;
    Object.defineProperty(children, "4999", {
      get() {
        throw new Error("budget over-read");
      },
    });

    expect(() =>
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children },
        }),
      ),
    ).not.toThrow();
    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children },
        }),
      ),
    ).toBe(false);
  });

  it("finds renderable content before the budget cap without reading past it", () => {
    const children: unknown[] = ["copy"];
    children.length = 6_000;
    Object.defineProperty(children, "4999", {
      get() {
        throw new Error("budget over-read");
      },
    });

    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children },
          copy: { id: "copy", type: "text", value: "Copy" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects content that exists only beyond the renderability depth cap", () => {
    const nodes: Record<string, unknown> = {
      r: { id: "r", type: "box", children: ["n0"] },
    };
    for (let i = 0; i < 105; i += 1) {
      nodes[`n${String(i)}`] = {
        id: `n${String(i)}`,
        type: "box",
        children: [i === 104 ? "copy" : `n${String(i + 1)}`],
      };
    }
    nodes["copy"] = { id: "copy", type: "text", value: "Too deep" };

    expect(treeHasContent(tree(nodes))).toBe(false);
  });

  it("does not read high-level table, tabs, or list data beyond their caps", () => {
    const columns: unknown[] = [{ key: "name", label: "Name" }];
    columns.length = 20;
    Object.defineProperty(columns, "12", {
      get() {
        throw new Error("table cap over-read");
      },
    });
    const tabs: unknown[] = [{ label: "Home", to: "home" }];
    tabs.length = 20;
    Object.defineProperty(tabs, "12", {
      get() {
        throw new Error("tabs cap over-read");
      },
    });
    const listItems: unknown[] = [{ title: "Item" }];
    listItems.length = 80;
    Object.defineProperty(listItems, "50", {
      get() {
        throw new Error("list cap over-read");
      },
    });

    for (const child of [
      { id: "child", type: "table", columns, rows: [] },
      { id: "child", type: "tabs", items: tabs },
      { id: "child", type: "list", items: listItems },
    ]) {
      expect(() =>
        treeHasContent(
          tree({
            r: { id: "r", type: "box", children: ["child"] },
            child,
          }),
        ),
      ).not.toThrow();
      expect(
        treeHasContent(
          tree({
            r: { id: "r", type: "box", children: ["child"] },
            child,
          }),
        ),
      ).toBe(true);
    }
  });

  it("does not read high-level chart data beyond its caps", () => {
    const values: unknown[] = [1];
    values.length = 250;
    Object.defineProperty(values, "200", {
      get() {
        throw new Error("value cap over-read");
      },
    });
    const series: unknown[] = [{ label: "A", values }];
    series.length = 20;
    Object.defineProperty(series, "8", {
      get() {
        throw new Error("series cap over-read");
      },
    });

    expect(() =>
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["chart"] },
          chart: { id: "chart", type: "chart", kind: "bar", series },
        }),
      ),
    ).not.toThrow();
    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["chart"] },
          chart: { id: "chart", type: "chart", kind: "bar", series },
        }),
      ),
    ).toBe(true);
  });
});
