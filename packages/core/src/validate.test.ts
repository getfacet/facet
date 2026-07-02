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

  it("breaks a self-referencing cycle (root child = root)", () => {
    const input = {
      root: "root",
      nodes: { root: { id: "root", type: "box", children: ["root"] } },
    };
    const root = validateTree(input).tree.nodes["root"] as unknown as { children: string[] };
    expect(root.children).toEqual([]);
  });

  it("breaks an indirect cycle without infinite recursion", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["a"] },
        a: { id: "a", type: "box", children: ["root"] },
      },
    };
    const { tree, issues } = validateTree(input);
    const a = tree.nodes["a"] as unknown as { children: string[] };
    expect(a.children).toEqual([]); // the back-edge a -> root is removed
    expect(issues.some((i) => i.includes("cyclic"))).toBe(true);
  });

  it("drops an image with an unsafe src scheme, keeps safe ones", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["bad", "ok"] },
        bad: { id: "bad", type: "image", src: "javascript:alert(1)", alt: "x" },
        ok: { id: "ok", type: "image", src: "https://picsum.photos/seed/x/600/400", alt: "y" },
      },
    };
    const { tree } = validateTree(input);
    expect(tree.nodes["bad"]).toBeUndefined();
    expect(tree.nodes["ok"]).toBeDefined();
  });

  it("does not throw or overflow on a pathologically deep tree", () => {
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: ["n0"] },
    };
    for (let i = 0; i < 5000; i += 1) {
      nodes[`n${String(i)}`] = {
        id: `n${String(i)}`,
        type: "box",
        children: i < 4999 ? [`n${String(i + 1)}`] : [],
      };
    }
    expect(() => validateTree({ root: "root", nodes })).not.toThrow();
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
    expect(issues).toHaveLength(0); // the legacy stamp is silent normalization
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

describe("validateTree hidden", () => {
  it("keeps a literal boolean hidden", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["panel"] },
        panel: { id: "panel", type: "box", hidden: true, children: [] },
      },
    };
    const panel = validateTree(input).tree.nodes["panel"] as unknown as { hidden?: unknown };
    expect(panel.hidden).toBe(true);
  });

  it("strips a non-boolean hidden", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", hidden: "yes", children: [] },
      },
    };
    const root = validateTree(input).tree.nodes["root"] as unknown as { hidden?: unknown };
    expect(root.hidden).toBeUndefined();
  });
});

describe("validateTree screens", () => {
  it("keeps screens whose targets are existing boxes, with a valid entry", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: [] },
        about: { id: "about", type: "box", children: [] },
      },
      screens: { home: "root", about: "about" },
      entry: "about",
    };
    const { tree, issues } = validateTree(input);
    expect(tree.screens).toEqual({ home: "root", about: "about" });
    expect(tree.entry).toBe("about");
    expect(issues).toHaveLength(0);
  });

  it("drops dangling, non-box, and non-string screen targets", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "text", value: "hi" },
      },
      screens: { home: "root", ghost: "nope", words: "t", bad: 42 },
      entry: "home",
    };
    const { tree, issues } = validateTree(input);
    expect(tree.screens).toEqual({ home: "root" });
    expect(tree.entry).toBe("home");
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it("omits screens and entry when no screen entries survive", () => {
    const input = {
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
      screens: { ghost: "nope" },
      entry: "ghost",
    };
    const { tree, issues } = validateTree(input);
    expect(tree.screens).toBeUndefined();
    expect(tree.entry).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("drops a non-object screens value with an issue", () => {
    const input = {
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
      screens: "junk",
    };
    const { tree, issues } = validateTree(input);
    expect(tree.screens).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("falls back entry to the first kept screen and logs an issue", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: [] },
        b: { id: "b", type: "box", children: [] },
      },
      screens: { first: "root", second: "b" },
      entry: "missing",
    };
    const { tree, issues } = validateTree(input);
    expect(tree.entry).toBe("first");
    expect(issues.some((issue) => issue.includes("entry"))).toBe(true);
  });

  it("breaks a cycle inside a non-entry screen without throwing", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: [] },
        s1: { id: "s1", type: "box", children: ["s2"] },
        s2: { id: "s2", type: "box", children: ["s1"] },
      },
      screens: { home: "root", extra: "s1" },
      entry: "home",
    };
    const { tree, issues } = validateTree(input);
    const s2 = tree.nodes["s2"] as unknown as { children: string[] };
    expect(s2.children).toEqual([]); // the back-edge s2 -> s1 is removed
    expect(issues.some((issue) => issue.includes("cyclic"))).toBe(true);
  });

  it("does not throw or overflow on a deep chain inside a non-entry screen", () => {
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: [] },
    };
    for (let i = 0; i < 5000; i += 1) {
      nodes[`n${String(i)}`] = {
        id: `n${String(i)}`,
        type: "box",
        children: i < 4999 ? [`n${String(i + 1)}`] : [],
      };
    }
    const input = { root: "root", nodes, screens: { home: "root", deep: "n0" }, entry: "home" };
    expect(() => validateTree(input)).not.toThrow();
  });
});

describe("validateTree legacy pass-through", () => {
  it("passes a screenless action-free tree through unchanged", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { gap: "md" }, children: ["t"] },
        t: { id: "t", type: "text", value: "hi", style: {} },
      },
    };
    const { tree, issues } = validateTree(input);
    expect(issues).toHaveLength(0);
    expect(tree).toEqual(input); // no screens/entry materialized, nothing rewritten
    expect("screens" in tree).toBe(false);
    expect("entry" in tree).toBe(false);
  });

  it("passes a bare-onPress tree through identical except the silent kind stamp", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: {}, onPress: { name: "go" }, children: ["t"] },
        t: { id: "t", type: "text", value: "hi", style: {} },
      },
    };
    const { tree, issues } = validateTree(input);
    expect(issues).toHaveLength(0);
    expect(tree).toEqual({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          style: {},
          onPress: { kind: "agent", name: "go" },
          children: ["t"],
        },
        t: { id: "t", type: "text", value: "hi", style: {} },
      },
    });
  });
});

describe("validateTree field style", () => {
  it("keeps a valid field style instead of stripping it", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["f"] },
        f: { id: "f", type: "field", name: "email", style: { width: "full" } },
      },
    };
    const { tree } = validateTree(input);
    expect(tree.nodes["f"]).toMatchObject({ style: { width: "full" } });
  });

  it("strips an invalid field style token but keeps the field", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["f"] },
        f: { id: "f", type: "field", name: "q", style: { width: "97vw" } },
      },
    };
    const { tree } = validateTree(input);
    const field = tree.nodes["f"] as unknown as { style?: unknown };
    expect(field).toBeDefined();
    expect(field.style).toBeUndefined();
  });
});

describe("validateTree prototype-key safety", () => {
  it("drops a node keyed __proto__ (with an issue) instead of flipping the map prototype", () => {
    const input = JSON.parse(
      '{"root":"root","nodes":{"root":{"id":"root","type":"box","children":["value"]},"__proto__":{"id":"__proto__","type":"text","value":"x"}}}',
    ) as unknown;
    const { tree, issues } = validateTree(input);
    expect(Object.keys(tree.nodes)).toEqual(["root"]);
    expect(issues.some((issue) => issue.includes("forbidden node id"))).toBe(true);
    // the dangling "value" child (only resolvable via prototype-chain leak) is gone
    const root = tree.nodes["root"] as unknown as { children: string[] };
    expect(root.children).toEqual([]);
  });
});
