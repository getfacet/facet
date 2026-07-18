import { describe, expect, it } from "vitest";

import {
  EMPTY_TREE,
  isTreeShaped,
  resolveTreeScreen,
  treeHasContent,
  treeRenderableNodeIds,
} from "./tree.js";
import type { FacetTree } from "./tree.js";
import { validateTree } from "./tree-validation.js";

describe("isTreeShaped", () => {
  it("accepts a well-formed tree (including EMPTY_TREE)", () => {
    expect(isTreeShaped(EMPTY_TREE)).toBe(true);
    expect(isTreeShaped({ root: "root", nodes: {} })).toBe(true);
  });

  it("uses the current closed direction token in EMPTY_TREE", () => {
    expect(EMPTY_TREE.nodes["root"]).toMatchObject({
      type: "box",
      style: { direction: "column", gap: "md" },
    });
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

describe("FacetTree document appearance hard cut", () => {
  it("never retains a document-authored theme", () => {
    const { tree } = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
      theme: "legacy-brand",
    });

    expect(tree).not.toHaveProperty("theme");
  });
});

describe("resolveTreeScreen", () => {
  const tree: FacetTree = {
    root: "shell",
    nodes: {
      shell: { id: "shell", type: "box", children: [] },
      home: { id: "home", type: "box", children: [] },
      about: { id: "about", type: "box", children: [] },
      copy: { id: "copy", type: "text", value: "not a screen root" },
    },
    screens: { bad: "copy", home: "home", about: "about" },
    entry: "home",
  };

  it("uses preferred, entry, first-live, then plain root in that order", () => {
    expect(resolveTreeScreen(tree, "about")).toEqual({ rootId: "about", activeScreen: "about" });
    expect(resolveTreeScreen(tree, "missing")).toEqual({ rootId: "home", activeScreen: "home" });
    expect(resolveTreeScreen({ ...tree, entry: "missing" })).toEqual({
      rootId: "home",
      activeScreen: "home",
    });
    expect(resolveTreeScreen({ root: "shell", nodes: tree.nodes })).toEqual({
      rootId: "shell",
      activeScreen: null,
    });
  });

  it("never throws on hostile accessors and falls back safely", () => {
    const hostile = Object.defineProperty({ root: "shell", nodes: tree.nodes }, "screens", {
      enumerable: true,
      get() {
        throw new Error("hostile screens");
      },
    }) as FacetTree;
    expect(() => resolveTreeScreen(hostile, "home")).not.toThrow();
    expect(resolveTreeScreen(hostile, "home")).toEqual({ rootId: "shell", activeScreen: null });
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

  it("true for a richtext child carrying a non-empty run, false when every run is empty", () => {
    const withText = tree({
      r: { id: "r", type: "box", children: ["rt"] },
      rt: { id: "rt", type: "richtext", blocks: [{ type: "paragraph", runs: [{ text: "hi" }] }] },
    });
    expect(treeHasContent(withText)).toBe(true);

    // An all-empty-run richtext renders only invisible elements → must count as
    // no-content so a composition falls back to its empty presentation.
    const allEmpty = tree({
      r: { id: "r", type: "box", children: ["rt"] },
      rt: { id: "rt", type: "richtext", blocks: [{ type: "paragraph", runs: [{ text: "" }] }] },
    });
    expect(treeHasContent(allEmpty)).toBe(false);
  });

  it("keeps the valid siblings when a node's type is an Object.prototype member name", () => {
    // "constructor" indexes the plain BRICK_REGISTRY to an inherited FUNCTION;
    // pre-fix `nodeRendersItself` called `.rendersSelf` on it, threw, and the
    // `treeRenderableNodeIds` catch WIPED the whole set (content collapsed to
    // false / no renderable ids). The junk node must simply be non-renderable
    // without taking its valid siblings down with it.
    const t = tree({
      r: { id: "r", type: "box", children: ["a", "junk"] },
      a: { id: "a", type: "text", value: "A" },
      junk: { id: "junk", type: "constructor", value: "evil" },
    });
    expect(() => treeHasContent(t)).not.toThrow();
    expect(treeHasContent(t)).toBe(true);
    const ids = treeRenderableNodeIds(t);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("r")).toBe(true);
    expect(ids.has("junk")).toBe(false);
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

  it("false for final bricks with no renderable payload", () => {
    for (const child of [
      { id: "child", type: "table", columns: [], rows: [] },
      { id: "child", type: "chart", kind: "bar", series: [] },
      { id: "child", type: "list", items: [] },
      { id: "child", type: "keyValue", items: [] },
      { id: "child", type: "text", value: "" },
      { id: "child", type: "input" },
      { id: "child", type: "richtext", blocks: [] },
      { id: "child", type: "progress", value: Number.POSITIVE_INFINITY },
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

  it("true for every final leaf brick with renderable content", () => {
    for (const child of [
      { id: "child", type: "text", value: "Copy" },
      { id: "child", type: "media", kind: "image", src: "/hero.png" },
      { id: "child", type: "input", name: "query" },
      {
        id: "child",
        type: "richtext",
        blocks: [{ type: "paragraph", runs: [{ text: "Rich copy" }] }],
      },
      { id: "child", type: "table", columns: [{ key: "name", label: "Name" }], rows: [] },
      { id: "child", type: "chart", kind: "bar", series: [{ label: "A", values: [1] }] },
      { id: "child", type: "list", items: [{ title: "Item" }] },
      { id: "child", type: "keyValue", items: [{ label: "Owner", value: "Design" }] },
      { id: "child", type: "progress", value: 0 },
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

  it("fails safe for hostile unknown payloads without hiding valid siblings", () => {
    for (const child of [
      { id: "child", type: "search" },
      { id: "child", type: "constructor", value: "hostile" },
      { id: "child", type: null },
    ]) {
      const t = tree({
        r: { id: "r", type: "box", children: ["child", "safe"] },
        child,
        safe: { id: "safe", type: "text", value: "kept" },
      });
      expect(() => treeHasContent(t)).not.toThrow();
      expect(treeHasContent(t)).toBe(true);
      const ids = treeRenderableNodeIds(t);
      expect(ids.has("child")).toBe(false);
      expect(ids.has("safe")).toBe(true);
    }
  });

  it("does not count retired container patterns as renderable content", () => {
    const retiredTypes = ["section", "card", "emptyState"] as const; // style-hard-cut: allowed-negative
    for (const type of retiredTypes) {
      const t = tree({
        r: { id: "r", type: "box", children: ["child"] },
        child: { id: "child", type, title: "stale", children: [] },
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
          choice: { id: "choice", type: "input", name: "plan", input: "radio", options: [] },
        }),
      ),
    ).toBe(false);

    expect(
      treeHasContent(
        tree({
          r: { id: "r", type: "box", children: ["choice"] },
          choice: {
            id: "choice",
            type: "input",
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

  it("does not read table or list data beyond their caps", () => {
    const columns: unknown[] = [{ key: "name", label: "Name" }];
    columns.length = 20;
    Object.defineProperty(columns, "12", {
      get() {
        throw new Error("table cap over-read");
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

  // ---- DC-003: from-bound content is judged via the resolved warehouse ----

  const boundTree = (child: unknown, data?: unknown): FacetTree =>
    ({
      root: "r",
      nodes: { r: { id: "r", type: "box", children: ["child"] }, child },
      ...(data !== undefined ? { data } : {}),
    }) as unknown as FacetTree;

  // Nodes that render NOTHING when their dataset is empty/absent (chart bar/line,
  // list, keyValue, text) — so a dangling `from` is genuinely non-content.
  // The table is excluded: it renders a header from its columns regardless of
  // rows, so its content follows columns, asserted separately below.
  const boundChildren = [
    { id: "child", type: "chart", kind: "bar", series: [], from: "sales" },
    { id: "child", type: "list", items: [], from: "sales" },
    { id: "child", type: "keyValue", items: [], from: "sales" },
    { id: "child", type: "text", value: "", from: "sales", column: "month" },
  ];

  const boundTable = (data?: unknown, columns: unknown = [{ key: "month", label: "Month" }]) =>
    boundTree({ id: "child", type: "table", columns, rows: [], from: "sales" }, data);

  it("populated from counts as content", () => {
    const data = { sales: [{ month: "Jan", revenue: 100 }] };
    for (const child of boundChildren) {
      expect(treeHasContent(boundTree(child, data))).toBe(true);
    }
  });

  it("dangling from (names an absent dataset) is non-content", () => {
    const data = { other: [{ a: 1 }] };
    for (const child of boundChildren) {
      expect(treeHasContent(boundTree(child, data))).toBe(false);
    }
  });

  it("absent data with a from node is non-content", () => {
    for (const child of boundChildren) {
      expect(() => treeHasContent(boundTree(child))).not.toThrow();
      expect(treeHasContent(boundTree(child))).toBe(false);
    }
  });

  it("empty from dataset is non-content", () => {
    const data = { sales: [] };
    for (const child of boundChildren) {
      expect(treeHasContent(boundTree(child, data))).toBe(false);
    }
  });

  it("from-bound table content follows its columns, matching the renderer (RISK-INV-5)", () => {
    // The renderer shows a header table whenever columns exist, even while the
    // bound dataset is still loading — so the gate must agree (columns = content).
    expect(treeHasContent(boundTable({ sales: [{ month: "Jan" }] }))).toBe(true); // populated
    expect(treeHasContent(boundTable({ other: [{ a: 1 }] }))).toBe(true); // dangling, header still shows
    expect(treeHasContent(boundTable())).toBe(true); // absent data, header still shows
    expect(treeHasContent(boundTable({ sales: [] }))).toBe(true); // empty dataset, header still shows
    // A from-bound table with NO renderable columns renders nothing → non-content.
    expect(treeHasContent(boundTable({ sales: [{ month: "Jan" }] }, []))).toBe(false);
  });

  it("from-bound donut chart with only non-positive values is non-content, matching the renderer", () => {
    // renderChartDonut drops non-positive slices → renders null; the gate must
    // apply the same donut rule to the RESOLVED series, not a generic count.
    const donut = { id: "child", type: "chart", kind: "donut", series: [], from: "share" };
    expect(treeHasContent(boundTree(donut, { share: [{ share: 0 }, { share: 0 }] }))).toBe(false);
    // A positive value makes the donut render → content.
    expect(treeHasContent(boundTree(donut, { share: [{ share: 3 }, { share: 0 }] }))).toBe(true);
  });

  // ---- DC-002/DC-008: from-bound text content via the resolved cell ----

  it("from-bound text with a resolving cell counts as content (DC-002)", () => {
    const data = { labels: [{ headline: "Live" }] };
    // Empty inline value — content must come from the store cell.
    const child = { id: "child", type: "text", value: "", from: "labels", column: "headline" };
    expect(treeHasContent(boundTree(child, data))).toBe(true);
  });

  it("from-bound text with dangling from / empty cell is non-content, never throws (DC-002)", () => {
    const child = { id: "child", type: "text", value: "", from: "labels", column: "headline" };
    expect(() => treeHasContent(boundTree(child, { other: [{ a: 1 }] }))).not.toThrow();
    expect(treeHasContent(boundTree(child, { other: [{ a: 1 }] }))).toBe(false); // dangling dataset
    expect(treeHasContent(boundTree(child))).toBe(false); // absent data entirely
    expect(treeHasContent(boundTree(child, { labels: [{ headline: "" }] }))).toBe(false); // empty cell
  });

  it("plain text without from is unchanged: inline value drives content (DC-008)", () => {
    expect(treeHasContent(boundTree({ id: "child", type: "text", value: "shown" }))).toBe(true);
    expect(treeHasContent(boundTree({ id: "child", type: "text", value: "" }))).toBe(false);
  });

  it("does not read chart data beyond its caps", () => {
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
