import { describe, expect, it } from "vitest";
import { validateTree } from "./validate.js";

describe("validateTree", () => {
  it("keeps a valid tree unchanged", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { gap: "md" }, children: ["t"] },
        t: { id: "t", type: "text", value: "hi" },
      },
    };
    const { tree, issues } = validateTree(input);
    expect(issues).toHaveLength(0);
    expect(tree.nodes["t"]).toMatchObject({ type: "text", value: "hi" });
  });

  it("drops unknown node types", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["x"] },
        x: { id: "x", type: "marquee" },
      },
    };
    const { tree, issues } = validateTree(input);
    expect(tree.nodes["x"]).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("strips invalid style tokens but keeps valid ones", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { gap: "HUGE", pad: "md" }, children: [] },
      },
    };
    const root = validateTree(input).tree.nodes["root"] as unknown as {
      style?: Record<string, unknown>;
    };
    expect(root.style?.["gap"]).toBeUndefined();
    expect(root.style?.["pad"]).toBe("md");
  });

  it("removes dangling child references", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["gone", "t"] },
        t: { id: "t", type: "text", value: "x" },
      },
    };
    const root = validateTree(input).tree.nodes["root"] as unknown as { children: string[] };
    expect(root.children).toEqual(["t"]);
  });

  it("drops a text node with no value", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "text" },
      },
    };
    const { tree, issues } = validateTree(input);
    expect(tree.nodes["t"]).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("returns an empty tree when there is no usable root", () => {
    const { tree, issues } = validateTree({ nodes: {} });
    expect(Object.keys(tree.nodes)).toEqual(["root"]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("never throws on garbage input", () => {
    expect(() => validateTree(null)).not.toThrow();
    expect(() => validateTree(42)).not.toThrow();
    expect(() => validateTree("nope")).not.toThrow();
    expect(validateTree(null).tree.root).toBe("root");
  });
});
