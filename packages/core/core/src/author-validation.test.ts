import { describe, expect, it } from "vitest";
import type { FacetTheme } from "./theme-types.js";
import { MAX_AUTHOR_ISSUES, validateAuthorNode, validateAuthorTree } from "./author-validation.js";

const theme = {
  name: "test",
  presets: {
    progress: {
      meter: {
        description: "Standard progress meter.",
        useWhen: "Use for ordinary completion.",
        style: {},
      },
    },
    input: {
      field: {
        description: "Standard field.",
        useWhen: "Use for ordinary inputs.",
        style: {},
      },
    },
  },
} as unknown as FacetTheme;

describe("strict author validation", () => {
  it("rejects invalid authoring atomically with structured paths", () => {
    const result = validateAuthorNode(
      {
        id: "status",
        type: "progress",
        value: 62,
        style: {
          preset: "missing-preset",
          track: { height: "4px" },
          fill: { background: "magenta" },
        },
      },
      theme,
    );

    expect(result.value).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/style/preset",
          message: expect.any(String),
          allowed: ["meter"],
        }),
        expect.objectContaining({
          path: "/style/track/height",
          message: expect.any(String),
          allowed: ["sm", "md", "lg"],
        }),
        expect.objectContaining({
          path: "/style/fill/background",
          message: expect.any(String),
        }),
      ]),
    );
    expect(result.issues).toHaveLength(3);
    expect(result.omittedErrorCount).toBe(0);
  });

  it("accepts a complete node without changing its authored data", () => {
    const node = {
      id: "status",
      type: "progress",
      value: 62,
      style: { preset: "meter", width: "full", track: { height: "md" } },
    } as const;

    const result = validateAuthorNode(node, theme);

    expect(result.issues).toEqual([]);
    expect(result.omittedErrorCount).toBe(0);
    expect(result.value).toEqual(node);
  });

  it("reports media variant-specific author paths", () => {
    const icon = validateAuthorNode(
      { id: "search", type: "media", kind: "icon", icon: "search" },
      theme,
    );
    expect(icon.value).toMatchObject({ type: "media", kind: "icon", icon: "search" });
    expect(icon.issues).toEqual([]);

    const missingSrc = validateAuthorNode({ id: "hero", type: "media", kind: "image" }, theme);
    expect(missingSrc.value).toBeUndefined();
    expect(missingSrc.issues.map(({ path }) => path)).toContain("/src");

    const unsafeSrc = validateAuthorNode(
      { id: "clip", type: "media", kind: "video", src: "javascript:alert(1)" },
      theme,
    );
    expect(unsafeSrc.value).toBeUndefined();
    expect(unsafeSrc.issues.map(({ path }) => path)).toContain("/src");

    const unknownIcon = validateAuthorNode(
      { id: "sparkles", type: "media", kind: "icon", icon: "sparkles" },
      theme,
    );
    expect(unknownIcon.value).toBeUndefined();
    expect(unknownIcon.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/icon",
          allowed: expect.arrayContaining(["search", "check", "settings"]),
        }),
      ]),
    );
  });

  it("rejects unknown fields, targets, and input-kind-inapplicable targets", () => {
    const result = validateAuthorNode(
      {
        id: "email",
        type: "input",
        name: "email",
        input: "email",
        rogue: true,
        style: {
          preset: "field",
          indicator: { color: "fg" },
          control: { position: "absolute" },
        },
      },
      theme,
    );

    expect(result.value).toBeUndefined();
    expect(result.issues.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["/rogue", "/style/indicator", "/style/control/position"]),
    );
  });

  it("bounds errors and never echoes hostile raw values", () => {
    const style = Object.fromEntries(
      Array.from({ length: MAX_AUTHOR_ISSUES + 5 }, (_, index) => [
        `unknown-${String(index)}`,
        `\u001b${"x".repeat(10_000)}`,
      ]),
    );
    const result = validateAuthorNode({ id: "status", type: "progress", value: 1, style }, theme);

    expect(result.value).toBeUndefined();
    expect(result.issues).toHaveLength(MAX_AUTHOR_ISSUES);
    expect(result.omittedErrorCount).toBe(5);
    expect(JSON.stringify(result.issues)).not.toContain("x".repeat(100));
    expect(JSON.stringify(result.issues)).not.toContain("\u001b");
  });

  it("is total for revoked proxies, cycles, and an over-deep tree", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => validateAuthorNode(revoked.proxy, theme)).not.toThrow();
    expect(validateAuthorNode(revoked.proxy, theme).value).toBeUndefined();

    const cyclicStyle: Record<string, unknown> = {};
    cyclicStyle.active = cyclicStyle;
    expect(() =>
      validateAuthorNode({ id: "copy", type: "text", value: "Hello", style: cyclicStyle }, theme),
    ).not.toThrow();

    const nodes: Record<string, unknown> = {};
    for (let index = 0; index < 105; index += 1) {
      const id = `box-${String(index)}`;
      nodes[id] = {
        id,
        type: "box",
        children: index === 104 ? [] : [`box-${String(index + 1)}`],
      };
    }
    const deep = validateAuthorTree({ root: "box-0", nodes }, theme);
    expect(deep.value).toBeUndefined();
    expect(deep.issues.length).toBeGreaterThan(0);
  });

  it("rejects a whole tree when any one node is invalid", () => {
    const result = validateAuthorTree(
      {
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["good", "bad"] },
          good: { id: "good", type: "text", value: "Keep me" },
          bad: {
            id: "bad",
            type: "progress",
            value: 20,
            style: { track: { height: "4px" } },
          },
        },
      },
      theme,
    );

    expect(result.value).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/nodes/bad/style/track/height" })]),
    );
  });
});

describe("analytics-data-surface: strict author boundary for width/axis/emptyLabel/table style", () => {
  it("rejects a per-column width with an exact JSON-pointer path", () => {
    const result = validateAuthorNode(
      {
        id: "grid",
        type: "table",
        columns: [{ key: "name", label: "Name", width: "250px" }],
        rows: [{ name: "Facet" }],
      },
      theme,
    );
    expect(result.value).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/columns/0/width" })]),
    );
  });

  it("rejects a chart series axis with an exact JSON-pointer path", () => {
    const result = validateAuthorNode(
      {
        id: "trend",
        type: "chart",
        kind: "line",
        series: [{ label: "Revenue", values: [1, 2], axis: "top" }],
      },
      theme,
    );
    expect(result.value).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/series/0/axis" })]),
    );
  });

  it("rejects an overlong emptyLabel at its own path (caption precedent)", () => {
    const result = validateAuthorNode(
      {
        id: "grid",
        type: "table",
        columns: [{ key: "name", label: "Name" }],
        rows: [],
        emptyLabel: "x".repeat(201),
      },
      theme,
    );
    expect(result.value).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/emptyLabel" })]),
    );
  });

  it("still rejects an unknown table-root style property", () => {
    const result = validateAuthorNode(
      {
        id: "grid",
        type: "table",
        columns: [{ key: "name", label: "Name" }],
        rows: [],
        style: { dividers: "grid", bogus: "x" },
      },
      theme,
    );
    expect(result.value).toBeUndefined();
    expect(result.issues.map(({ path }) => path)).toContain("/style/bogus");
  });

  it("accepts valid width/axis/emptyLabel/dividers/stickyHeader without a false reject", () => {
    const table = validateAuthorNode(
      {
        id: "grid",
        type: "table",
        columns: [
          { key: "name", label: "Name", width: "narrow" },
          { key: "total", label: "Total", width: "wide" },
        ],
        rows: [{ name: "Facet", total: "10" }],
        emptyLabel: "No rows yet",
        style: { dividers: "grid", stickyHeader: true },
      },
      theme,
    );
    expect(table.issues).toEqual([]);
    expect(table.value).toBeDefined();

    const chart = validateAuthorNode(
      {
        id: "trend",
        type: "chart",
        kind: "line",
        series: [
          { label: "Revenue", values: [1, 2], axis: "primary" },
          { label: "Margin", values: [3, 4], axis: "secondary" },
        ],
      },
      theme,
    );
    expect(chart.issues).toEqual([]);
    expect(chart.value).toBeDefined();
  });
});

describe("box layout foundation: strict author boundary", () => {
  const boxNode = (style: Record<string, unknown>) => ({
    id: "shell",
    type: "box",
    children: [],
    style,
  });

  it("rejects each unknown box layout value with its path and exact allowed list", () => {
    const result = validateAuthorNode(
      boxNode({
        basis: "huge",
        itemWidth: "enormous",
        maxHeight: "tall",
        collapse: "maybe",
        columns: "five",
      }),
      theme,
    );

    expect(result.value).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/style/basis", allowed: ["xs", "sm", "md", "lg"] }),
        expect.objectContaining({ path: "/style/itemWidth", allowed: ["xs", "sm", "md", "lg"] }),
        expect.objectContaining({ path: "/style/maxHeight", allowed: ["none", "half", "screen"] }),
        expect.objectContaining({ path: "/style/collapse", allowed: ["none", "stack"] }),
        expect.objectContaining({
          path: "/style/columns",
          allowed: ["none", "2", "3", "4", "auto"],
        }),
      ]),
    );
  });

  it("accepts every valid box layout value including columns 2|3|4|auto", () => {
    for (const columns of [2, 3, 4, "auto"] as const) {
      const result = validateAuthorNode(
        boxNode({ basis: "sm", itemWidth: "md", maxHeight: "screen", collapse: "stack", columns }),
        theme,
      );
      expect(result.issues).toEqual([]);
      expect(result.value).toBeDefined();
    }
  });
});
