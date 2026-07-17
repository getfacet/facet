import { describe, expect, it } from "vitest";
import type { FacetTheme } from "./theme-types.js";
import {
  MAX_PATTERN_NODES,
  MAX_PATTERNS,
  validatePattern,
  validatePatternList,
} from "./pattern-validation.js";

const theme = {
  name: "test",
  presets: {
    box: {
      panel: {
        description: "Standard panel.",
        useWhen: "Use for grouped content.",
        style: {},
      },
    },
    text: {
      heading: {
        description: "Standard heading.",
        useWhen: "Use for section headings.",
        style: {},
      },
    },
  },
} as unknown as FacetTheme;

function pattern(name = "account-summary"): Record<string, unknown> {
  return {
    name,
    description: "Account overview with a heading and status.",
    useWhen: "Use when summarizing one account.",
    avoidWhen: "Avoid for editing workflows.",
    root: "root",
    nodes: {
      root: {
        id: "root",
        type: "box",
        children: ["heading"],
        style: { preset: "panel", gap: "md" },
      },
      heading: {
        id: "heading",
        type: "text",
        value: "Account",
        style: { preset: "heading", color: "foreground" },
      },
    },
  };
}

describe("Pattern validation", () => {
  it("accepts an exact ordinary Facet tree with required usage metadata", () => {
    const input = {
      ...pattern(),
      screens: { overview: "root" },
      entry: "overview",
      data: { balances: [{ amount: 42 }] },
    };

    const result = validatePattern(input, theme);

    expect(result.issues).toEqual([]);
    expect(result.pattern).toEqual(input);
  });

  it("rejects hostile or incompatible Patterns whole", () => {
    const incompatible = pattern();
    const nodes = incompatible.nodes as Record<string, Record<string, unknown>>;
    nodes.heading = {
      id: "heading",
      type: "text",
      value: "Account",
      style: { preset: "missing" },
    };
    const missingPreset = validatePattern(incompatible, theme);
    expect(missingPreset.pattern).toBeUndefined();
    expect(missingPreset.issues.join(" ")).toContain("Preset");

    const invalidStyle = pattern("invalid-style");
    (invalidStyle.nodes as Record<string, Record<string, unknown>>).heading = {
      id: "heading",
      type: "text",
      value: "Account",
      style: { fontSize: "12px" },
    };
    expect(validatePattern(invalidStyle, theme).pattern).toBeUndefined();

    const cyclic = pattern("cyclic");
    (cyclic.nodes as Record<string, Record<string, unknown>>).root = {
      id: "root",
      type: "box",
      children: ["root"],
    };
    expect(validatePattern(cyclic, theme).pattern).toBeUndefined();

    const deepNodes: Record<string, unknown> = {};
    for (let index = 0; index < 105; index += 1) {
      const id = `box-${String(index)}`;
      deepNodes[id] = {
        id,
        type: "box",
        children: index === 104 ? [] : [`box-${String(index + 1)}`],
      };
    }
    const deep = {
      ...pattern("deep"),
      root: "box-0",
      nodes: deepNodes,
    };
    expect(validatePattern(deep, theme).pattern).toBeUndefined();

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => validatePattern(revoked.proxy, theme)).not.toThrow();
    expect(validatePattern(revoked.proxy, theme).pattern).toBeUndefined();

    const throwing = pattern("throwing");
    Object.defineProperty(throwing, "nodes", {
      enumerable: true,
      get() {
        throw new Error("untrusted getter");
      },
    });
    expect(() => validatePattern(throwing, theme)).not.toThrow();
    expect(validatePattern(throwing, theme).pattern).toBeUndefined();
  });

  it("rejects Pattern syntax, parameters, provenance, and a Pattern node kind", () => {
    for (const forbidden of [
      "theme",
      "params",
      "placeholders",
      "pattern",
      "patternRef",
      "provenance",
    ]) {
      const input = pattern(`forbidden-${forbidden.toLowerCase()}`);
      input[forbidden] = {};
      expect(validatePattern(input, theme).pattern).toBeUndefined();
    }

    const runtimeKind = pattern("runtime-kind");
    (runtimeKind.nodes as Record<string, Record<string, unknown>>).heading = {
      id: "heading",
      type: "pattern",
      pattern: "other-pattern",
    };
    expect(validatePattern(runtimeKind, theme).pattern).toBeUndefined();

    const nodeProvenance = pattern("node-provenance");
    (nodeProvenance.nodes as Record<string, Record<string, unknown>>).heading = {
      id: "heading",
      type: "text",
      value: "Account",
      pattern: "source-pattern",
    };
    expect(validatePattern(nodeProvenance, theme).pattern).toBeUndefined();
  });

  it("rejects malformed metadata instead of trimming or repairing it", () => {
    for (const [field, value] of [
      ["description", ""],
      ["useWhen", " padded "],
      ["avoidWhen", "contains\u001bcontrol"],
      ["description", "x".repeat(201)],
    ] as const) {
      const input = pattern(`bad-${field.toLowerCase()}`);
      input[field] = value;
      expect(validatePattern(input, theme).pattern).toBeUndefined();
    }
  });

  it("accepts at most 64 Patterns and rejects an over-limit list without truncation", () => {
    const exact = Array.from({ length: MAX_PATTERNS }, (_, index) => pattern(`pattern-${index}`));
    const accepted = validatePatternList(exact, theme);
    expect(accepted.patterns).toHaveLength(MAX_PATTERNS);
    expect(accepted.issues).toEqual([]);

    const overLimit = validatePatternList([...exact, pattern("pattern-over-limit")], theme);
    expect(overLimit.patterns).toEqual([]);
    expect(overLimit.issues.join(" ")).toContain("64");
  });

  it("accepts 1023 raw nodes and rejects 1024 before traversing unreachable nodes", () => {
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: [] },
    };
    for (let index = 1; index < MAX_PATTERN_NODES; index += 1) {
      const id = `unreachable-${String(index)}`;
      nodes[id] = { id, type: "text", value: "Unused reference node" };
    }

    const accepted = validatePattern({ ...pattern("bounded"), nodes }, theme);
    expect(accepted.issues).toEqual([]);
    expect(Object.keys(accepted.pattern?.nodes ?? {})).toHaveLength(MAX_PATTERN_NODES);

    const sentinel = "oversized-node-value-must-not-be-read-or-echoed";
    Object.defineProperty(nodes, "unreachable-overflow", {
      enumerable: true,
      get() {
        throw new Error(sentinel);
      },
    });
    const rejected = validatePattern({ ...pattern("oversized"), nodes }, theme);
    expect(rejected).toEqual({
      issues: [`pattern nodes exceeded the ${String(MAX_PATTERN_NODES)}-node cap; refused`],
    });
    expect(rejected.issues.join(" ")).not.toContain(sentinel);
  });

  it("snapshots bounded node keys and values once before strict traversal", () => {
    const extraIds = Array.from(
      { length: MAX_PATTERN_NODES + 1 },
      (_, index) => `late-${String(index)}`,
    );
    let ownKeysCalls = 0;
    let rootReads = 0;
    let lateReads = 0;
    const nodes = new Proxy<Record<string, unknown>>(
      {},
      {
        ownKeys() {
          ownKeysCalls += 1;
          return ownKeysCalls === 1 ? ["root"] : ["root", ...extraIds];
        },
        getOwnPropertyDescriptor(_target, key) {
          if (key === "root" || (typeof key === "string" && key.startsWith("late-"))) {
            return { configurable: true, enumerable: true };
          }
          return undefined;
        },
        get(_target, key) {
          if (key === "root") {
            rootReads += 1;
            if (rootReads > 1) throw new Error("root node was read twice");
            return { id: "root", type: "box", children: [] };
          }
          if (typeof key === "string" && key.startsWith("late-")) {
            lateReads += 1;
            return { id: key, type: "text", value: "Must stay unread" };
          }
          return undefined;
        },
      },
    );

    const result = validatePattern({ ...pattern("changing-keys"), nodes }, theme);

    expect(result.issues).toEqual([]);
    expect(Object.keys(result.pattern?.nodes ?? {})).toEqual(["root"]);
    expect(ownKeysCalls).toBe(1);
    expect(rootReads).toBe(1);
    expect(lateReads).toBe(0);
  });

  it("exports the Pattern node cap through the public validation facade", async () => {
    const validation = await import("./validate.js");
    expect(validation.MAX_PATTERN_NODES).toBe(1023);
  });
});
