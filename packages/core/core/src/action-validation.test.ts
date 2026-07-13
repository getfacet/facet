import { describe, expect, it } from "vitest";
import {
  isPrimitiveRecord,
  normalizeFacetAction,
  sanitizeActionPayload,
} from "./action-validation.js";
import { validateTree } from "./validate.js";

describe("normalizeFacetAction", () => {
  it("uses the same bounded diagnostics for every component family", () => {
    const issues: string[] = [];
    expect(
      normalizeFacetAction({ kind: "navigate", to: 42 }, "cta", "onPress", issues),
    ).toBeUndefined();
    expect(issues).toEqual(['node "cta": onPress navigate action needs a string "to"']);
  });
});

describe("validateTree action normalization", () => {
  const pressBox = (onPress: unknown): unknown => ({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", onPress, children: [] },
    },
  });
  const rootPress = (input: unknown): Record<string, unknown> | undefined =>
    (validateTree(input).tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> })
      .onPress;

  it("normalizes a legacy onPress action to kind agent", () => {
    const { tree, issues } = validateTree(pressBox({ name: "go", payload: { id: 7 } }));
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toEqual({ kind: "agent", name: "go", payload: { id: 7 } });
    expect(issues).toHaveLength(0); // the legacy action is silent normalization
  });

  it("keeps an explicit kind agent action", () => {
    const { tree, issues } = validateTree(pressBox({ kind: "agent", name: "go" }));
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toEqual({ kind: "agent", name: "go" });
    expect(issues).toHaveLength(0);
  });

  it("keeps navigate and toggle actions", () => {
    expect(rootPress(pressBox({ kind: "navigate", to: "about" }))).toEqual({
      kind: "navigate",
      to: "about",
    });
    expect(rootPress(pressBox({ kind: "toggle", target: "menu" }))).toEqual({
      kind: "toggle",
      target: "menu",
    });
  });

  it("keeps a string collect id on an agent action", () => {
    const { tree, issues } = validateTree(
      pressBox({ kind: "agent", name: "submit", collect: "signup" }),
    );
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toEqual({ kind: "agent", name: "submit", collect: "signup" });
    expect(issues).toHaveLength(0);
  });

  it("keeps collect on a legacy bare {name} action alongside the kind discriminator", () => {
    const { tree, issues } = validateTree(pressBox({ name: "submit", collect: "signup" }));
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toEqual({ kind: "agent", name: "submit", collect: "signup" });
    expect(issues).toHaveLength(0);
  });

  it("drops a non-string collect with an issue while name and payload survive", () => {
    for (const collect of [42, { box: "signup" }, null]) {
      const { tree, issues } = validateTree(
        pressBox({ kind: "agent", name: "submit", payload: { plan: "pro" }, collect }),
      );
      const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
      expect(root.onPress).toEqual({ kind: "agent", name: "submit", payload: { plan: "pro" } });
      expect(root.onPress).not.toHaveProperty("collect");
      expect(issues.some((issue) => issue.includes("collect"))).toBe(true);
    }
  });

  it("leaves a collect-free agent action without a collect property", () => {
    const { tree, issues } = validateTree(pressBox({ name: "go", payload: { id: 7 } }));
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toEqual({ kind: "agent", name: "go", payload: { id: 7 } });
    expect(root.onPress).not.toHaveProperty("collect");
    expect(issues).toHaveLength(0);
  });

  it("strips an unknown action kind with an issue", () => {
    const { tree, issues } = validateTree(pressBox({ kind: "fetch", url: "https://x" }));
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toBeUndefined(); // box renders non-pressable
    expect(issues.length).toBeGreaterThan(0);
  });

  it("strips a navigate action with a malformed to", () => {
    const { tree, issues } = validateTree(pressBox({ kind: "navigate", to: 42 }));
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("strips a toggle action with a malformed target", () => {
    const { tree, issues } = validateTree(pressBox({ kind: "toggle" }));
    const root = tree.nodes["root"] as unknown as { onPress?: Record<string, unknown> };
    expect(root.onPress).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("sanitizeActionPayload", () => {
  it("keeps only primitive-valued entries", () => {
    expect(sanitizeActionPayload({ a: "x", n: 1, b: true, obj: {}, arr: [], nul: null })).toEqual({
      a: "x",
      n: 1,
      b: true,
    });
  });

  it("returns an empty object for a primitive-free object", () => {
    expect(sanitizeActionPayload({ obj: {}, arr: [1] })).toEqual({});
  });

  it("returns undefined for non-plain-object input", () => {
    expect(sanitizeActionPayload(undefined)).toBeUndefined();
    expect(sanitizeActionPayload(null)).toBeUndefined();
    expect(sanitizeActionPayload([1, 2])).toBeUndefined();
    expect(sanitizeActionPayload("x")).toBeUndefined();
  });

  it("is what validateTree uses to filter agent-action payloads", () => {
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          children: [],
          onPress: { kind: "agent", name: "go", payload: { keep: "yes", drop: { nested: 1 } } },
        },
      },
    });
    const root = tree.nodes["root"] as unknown as { onPress?: { payload?: unknown } };
    expect(root.onPress?.payload).toEqual({ keep: "yes" });
  });
});

describe("isPrimitiveRecord", () => {
  it("is true only for a plain object whose every value is primitive", () => {
    expect(isPrimitiveRecord({ a: "x", n: 1, b: false })).toBe(true);
    expect(isPrimitiveRecord({})).toBe(true);
  });

  it("is false when any value is non-primitive or the input is not a plain object", () => {
    expect(isPrimitiveRecord({ a: 1, bad: {} })).toBe(false);
    expect(isPrimitiveRecord({ a: [1] })).toBe(false);
    expect(isPrimitiveRecord(null)).toBe(false);
    expect(isPrimitiveRecord([1, 2])).toBe(false);
    expect(isPrimitiveRecord("x")).toBe(false);
  });
});
