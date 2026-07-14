import { describe, expect, it } from "vitest";
import * as validationModule from "./validate.js";
import {
  isSafeMediaSrc,
  MAX_CHART_POINTS,
  MAX_DEPTH,
  MAX_RENDER_NODES,
  MAX_SCREENS,
  MAX_TABS_ITEMS,
  validateComposition,
  validateTree,
} from "./validate.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { MAX_DESCRIPTION_LENGTH } from "./theme.js";

describe("canonical composition validation surface", () => {
  it("validates canonical compositions", () => {
    const exports = validationModule as Record<string, unknown>;
    const candidate = exports["validateComposition"];

    expect(typeof candidate).toBe("function");
    expect(exports).not.toHaveProperty(["validate", "Sta", "mp"].join(""));
    if (typeof candidate !== "function") return;

    const validateComposition = candidate as (input: unknown) => {
      readonly composition?: { readonly nodes: Readonly<Record<string, unknown>> };
      readonly issues: readonly string[];
    };
    const forbidden = validateComposition({
      name: "leadCapture",
      root: "form",
      nodes: {
        form: {
          id: "form",
          type: "form",
          children: [],
          html: "<form></form>",
          js: "alert(1)",
          css: ".lead { display: none }",
          dataSource: "leads",
          query: "select * from leads",
          endpoint: "https://api.example.test/leads",
        },
      },
    });
    expect(forbidden.composition).toBeUndefined();
    expect(
      forbidden.issues.filter((issue) => issue.includes("not allowed in compositions")),
    ).toHaveLength(6);

    const nodes = Object.fromEntries(
      Array.from({ length: 1024 }, (_, index) => {
        const id = index === 0 ? "root" : `n${String(index)}`;
        return [id, { id, type: "text", value: id }];
      }),
    );
    const oversized = validateComposition({ name: "oversized", root: "root", nodes });
    expect(oversized.composition).toBeUndefined();
    expect(oversized.issues.length).toBeLessThanOrEqual(65);
  });
});

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

  it("keeps valid primitive recipe variants and drops malformed ones", () => {
    const run = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", variant: "panel", children: ["t", "bad"] },
        t: { id: "t", type: "text", value: "Title", variant: "heading" },
        bad: { id: "bad", type: "text", value: "Bad", variant: "bad variant" },
      },
    });

    expect(run.tree.nodes["root"]).toMatchObject({ variant: "panel" });
    expect(run.tree.nodes["t"]).toMatchObject({ variant: "heading" });
    expect(run.tree.nodes["bad"]).not.toHaveProperty("variant");
    expect(run.issues.some((issue) => issue.includes("malformed variant dropped"))).toBe(true);
  });

  it("keeps valid font family tokens on text styles", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "text", value: "hi", style: { family: "mono" } },
      },
    };

    const text = validateTree(input).tree.nodes["t"] as unknown as {
      style?: Record<string, unknown>;
    };

    expect(text.style?.["family"]).toBe("mono");
  });

  it("strips invalid font family tokens from text styles", () => {
    const run = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["bad", "nonString"] },
        bad: { id: "bad", type: "text", value: "bad", style: { family: "display" } },
        nonString: { id: "nonString", type: "text", value: "bad", style: { family: 123 } },
      },
    });

    const bad = run.tree.nodes["bad"] as unknown as { style?: Record<string, unknown> };
    const nonString = run.tree.nodes["nonString"] as unknown as {
      style?: Record<string, unknown>;
    };

    expect(bad.style?.["family"]).toBeUndefined();
    expect(nonString.style?.["family"]).toBeUndefined();
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

  it("drops an empty-string node id and strips references to it", () => {
    const input = JSON.parse(
      '{"root":"root","nodes":{"root":{"id":"root","type":"box","children":["","t"]},"":{"id":"","type":"text","value":"x"},"t":{"id":"t","type":"text","value":"y"}}}',
    ) as unknown;
    const { tree, issues } = validateTree(input);
    expect(Object.keys(tree.nodes)).toEqual(["root", "t"]);
    expect(issues.filter((i) => i.includes("empty node id")).length).toBe(1);
    const root = tree.nodes["root"] as unknown as { children: string[] };
    expect(root.children).toEqual(["t"]);
  });

  it("dedupes duplicate sibling child ids", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["a", "a"] },
        a: { id: "a", type: "text", value: "x" },
      },
    };
    const { tree, issues } = validateTree(input);
    const root = tree.nodes["root"] as unknown as { children: string[] };
    expect(root.children).toEqual(["a"]);
    expect(issues.some((i) => i.includes("duplicate"))).toBe(true);
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

  it("never throws on a hostile nodes getter", () => {
    const run = validateTree({
      root: "root",
      get nodes(): unknown {
        throw new Error("boom");
      },
    });

    expect(run.tree.root).toBe("root");
    expect(run.issues).toContain("input could not be read safely; empty tree used");
  });

  it("reads a component type discriminator only once", () => {
    let reads = 0;
    const button: Record<string, unknown> = { id: "button", label: "Run" };
    Object.defineProperty(button, "type", {
      enumerable: true,
      get() {
        reads += 1;
        if (reads > 1) throw new Error("component type read twice");
        return "button";
      },
    });

    const run = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["button"] },
        button,
      },
    });

    expect(reads).toBe(1);
    expect(run.tree.nodes["button"]).toMatchObject({ type: "button", label: "Run" });
    expect(run.issues).toEqual([]);
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

  it("routes a richtext node through validateTree → validateRichText (deep sanitize wired)", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["rt"] },
        rt: {
          id: "rt",
          type: "richtext",
          blocks: [
            // Unknown block type degrades to paragraph; text-less run skipped;
            // unknown mark dropped (text kept); unsafe-href link mark dropped.
            {
              type: "totally-unknown",
              runs: [
                {},
                { text: "keep", marks: [{ kind: "sparkle" }] },
                {
                  text: "danger",
                  marks: [{ kind: "link", target: { href: "javascript:alert(1)" } }],
                },
              ],
            },
            // Heading level clamped into 1..3.
            { type: "heading", level: 99, runs: [{ text: "H" }] },
          ],
        },
      },
    };
    const { tree } = validateTree(input);
    const rt = tree.nodes["rt"] as unknown as {
      type: string;
      blocks: {
        type: string;
        level?: number;
        runs: { text: string; marks?: { kind: string }[] }[];
      }[];
    };
    expect(rt).toBeDefined();
    expect(rt.type).toBe("richtext");
    // Block 0: unknown type degraded to paragraph, text-less run skipped.
    expect(rt.blocks[0]?.type).toBe("paragraph");
    expect(rt.blocks[0]?.runs.map((r) => r.text)).toEqual(["keep", "danger"]);
    // Unknown mark "sparkle" dropped.
    expect(rt.blocks[0]?.runs[0]?.marks ?? []).toEqual([]);
    // Unsafe-href link mark dropped → the "danger" run carries no link mark.
    expect(rt.blocks[0]?.runs[1]?.marks ?? []).toEqual([]);
    // Heading level 99 clamped to 3 (the h3 ceiling).
    expect(rt.blocks[1]?.type).toBe("heading");
    expect(rt.blocks[1]?.level).toBe(3);
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

describe("validateTree component nodes", () => {
  it("keeps new intrinsic component nodes and legacy stat compatibility", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          children: [
            "metric",
            "stat",
            "keyValue",
            "nav",
            "form",
            "filterBar",
            "emptyState",
            "loading",
          ],
        },
        metric: { id: "metric", type: "metric", label: "ARR", value: "$24k", tone: "success" },
        stat: { id: "stat", type: "stat", label: "MRR", value: "$2k", tone: "info" },
        keyValue: {
          id: "keyValue",
          type: "keyValue",
          items: [{ label: "Plan", value: "Pro", tone: "accent" }],
        },
        nav: {
          id: "nav",
          type: "nav",
          items: [{ label: "Customers", to: "customers" }],
        },
        form: {
          id: "form",
          type: "form",
          title: "Update customer",
          submitLabel: "Save",
          onSubmit: { name: "save_customer", collect: "form" },
          children: [],
        },
        filterBar: {
          id: "filterBar",
          type: "filterBar",
          filters: [{ name: "status", label: "Status", options: ["Open"] }],
          onChange: { name: "filter_customers" },
        },
        emptyState: {
          id: "emptyState",
          type: "emptyState",
          title: "No customers",
          actionLabel: "Create customer",
          onPress: { name: "create_customer" },
        },
        loading: { id: "loading", type: "loading", label: "Loading customers" },
      },
    });

    expect(issues).toHaveLength(0);
    expect(tree.nodes["metric"]).toMatchObject({ type: "metric", label: "ARR", value: "$24k" });
    expect(tree.nodes["stat"]).toMatchObject({ type: "stat", label: "MRR", value: "$2k" });
    expect(tree.nodes["keyValue"]).toMatchObject({
      type: "keyValue",
      items: [{ label: "Plan", value: "Pro", tone: "accent" }],
    });
    expect(tree.nodes["nav"]).toMatchObject({
      type: "nav",
      items: [{ label: "Customers", to: "customers" }],
    });
    expect(tree.nodes["form"]).toMatchObject({
      type: "form",
      onSubmit: { kind: "agent", name: "save_customer", collect: "form" },
    });
    expect(tree.nodes["filterBar"]).toMatchObject({
      type: "filterBar",
      onChange: { kind: "agent", name: "filter_customers" },
    });
    expect(tree.nodes["emptyState"]).toMatchObject({
      type: "emptyState",
      onPress: { kind: "agent", name: "create_customer" },
    });
    expect(tree.nodes["loading"]).toMatchObject({ type: "loading", label: "Loading customers" });
  });

  it("skips malformed new intrinsic nodes and strips forbidden backend fields", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["form", "badMetric"] },
        form: {
          id: "form",
          type: "form",
          title: "Lead capture",
          endpoint: "https://api.example.test/leads",
          html: "<form></form>",
          css: ".lead { display: none }",
          children: [],
        },
        badMetric: { id: "badMetric", type: "metric", label: "ARR" },
      },
    });

    expect(tree.nodes["form"]).toMatchObject({ type: "form", title: "Lead capture" });
    expect(tree.nodes["form"]).not.toHaveProperty("endpoint");
    expect(tree.nodes["form"]).not.toHaveProperty("html");
    expect(tree.nodes["form"]).not.toHaveProperty("css");
    expect(tree.nodes["badMetric"]).toBeUndefined();
    expect((tree.nodes["root"] as unknown as { children: readonly string[] }).children).toEqual([
      "form",
    ]);
    expect(issues.filter((issue) => issue.includes("not allowed on component nodes"))).toHaveLength(
      3,
    );
    expect(issues.some((issue) => issue.includes("value must be a string"))).toBe(true);
  });

  it("keeps component leaf and container nodes with sanitized token fields", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "section",
          title: "Overview",
          eyebrow: "Live",
          variant: "dashboard",
          children: [
            "card",
            "tabs",
            "table",
            "chart",
            "stat",
            "badge",
            "progress",
            "alert",
            "list",
            "divider",
          ],
        },
        card: {
          id: "card",
          type: "card",
          title: "Revenue",
          body: "Pipeline summary",
          tone: "success",
          variant: "metric",
          children: ["button"],
        },
        button: {
          id: "button",
          type: "button",
          label: "Refresh",
          tone: "accent",
          variant: "primary",
          onPress: { kind: "agent", name: "refresh" },
        },
        tabs: { id: "tabs", type: "tabs", items: [{ label: "Home", to: "home" }] },
        table: {
          id: "table",
          type: "table",
          columns: [{ key: "plan", label: "Plan" }],
          rows: [{ plan: "Pro" }],
        },
        chart: {
          id: "chart",
          type: "chart",
          kind: "line",
          series: [{ label: "ARR", values: [1, 2, 3] }],
        },
        stat: { id: "stat", type: "stat", label: "ARR", value: "$24k", tone: "success" },
        badge: { id: "badge", type: "badge", label: "Healthy", tone: "success" },
        progress: { id: "progress", type: "progress", label: "Quota", value: 72 },
        alert: {
          id: "alert",
          type: "alert",
          title: "Heads up",
          body: "Review pricing.",
          tone: "warning",
        },
        list: { id: "list", type: "list", items: [{ title: "Next", body: "Call customer" }] },
        divider: { id: "divider", type: "divider", label: "Details" },
      },
      screens: { home: "root" },
      entry: "home",
    });

    expect(issues).toHaveLength(0);
    expect(tree.root).toBe("root");
    expect(tree.nodes["root"]).toMatchObject({ type: "section", title: "Overview" });
    expect(tree.nodes["card"]).toMatchObject({ type: "card", children: ["button"] });
    expect(tree.nodes["button"]).toMatchObject({ type: "button", label: "Refresh" });
    expect(tree.nodes["table"]).toMatchObject({ type: "table" });
    expect(tree.nodes["chart"]).toMatchObject({ type: "chart", kind: "line" });
    expect(tree.screens).toEqual({ home: "root" });
  });

  it("caps chart values before reading past the point limit", () => {
    let readPastCap = false;
    const values = new Array<number>(MAX_CHART_POINTS + 10).fill(1);
    Object.defineProperty(values, String(MAX_CHART_POINTS + 1), {
      get() {
        readPastCap = true;
        return 1;
      },
      configurable: true,
    });

    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["chart"] },
        chart: {
          id: "chart",
          type: "chart",
          kind: "bar",
          series: [{ label: "A", values }],
        },
      },
    });

    const chart = tree.nodes["chart"] as unknown as {
      series?: readonly { readonly values?: readonly number[] }[];
    };
    expect(readPastCap).toBe(false);
    expect(chart.series?.[0]?.values).toHaveLength(MAX_CHART_POINTS);
    expect(issues.some((issue) => issue.includes("points exceeded"))).toBe(true);
  });

  it("caps component table chart and list payloads fail-safely", () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ value: `row-${String(index)}` }));
    const values = Array.from({ length: 2000 }, (_, index) => index);
    const items = Array.from({ length: 200 }, (_, index) => `item-${String(index)}`);
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "section", children: ["table", "chart", "list"] },
        table: { id: "table", type: "table", columns: [{ key: "value", label: "Value" }], rows },
        chart: { id: "chart", type: "chart", kind: "bar", series: [{ label: "A", values }] },
        list: { id: "list", type: "list", items },
      },
    });

    expect((tree.nodes["table"] as { rows?: readonly unknown[] }).rows?.length).toBeLessThan(250);
    expect(
      (tree.nodes["chart"] as { series?: readonly { values: readonly unknown[] }[] }).series?.[0]
        ?.values.length,
    ).toBeLessThan(2000);
    expect((tree.nodes["list"] as { items?: readonly unknown[] }).items?.length).toBeLessThan(200);
    expect(issues.some((issue) => issue.includes("cap"))).toBe(true);
  });

  it("sanitizes malformed component tabs, progress, and required text fields", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "section",
          children: [
            "tabs",
            "lowProgress",
            "highProgress",
            "badStat",
            "badBadge",
            "badAlert",
            "good",
          ],
        },
        tabs: {
          id: "tabs",
          type: "tabs",
          variant: "bad variant",
          items: Array.from({ length: MAX_TABS_ITEMS + 5 }, (_, index) => ({
            label: `Tab ${String(index)}`,
            to: `screen-${String(index)}`,
          })),
        },
        lowProgress: { id: "lowProgress", type: "progress", value: -25 },
        highProgress: {
          id: "highProgress",
          type: "progress",
          value: 175,
          tone: "not-a-tone",
        },
        badStat: { id: "badStat", type: "stat", label: "ARR" },
        badBadge: { id: "badBadge", type: "badge", label: 42 },
        badAlert: { id: "badAlert", type: "alert", title: "Missing body" },
        good: { id: "good", type: "text", value: "kept" },
      },
    });

    expect(
      (tree.nodes["tabs"] as { items?: readonly unknown[]; variant?: unknown }).items,
    ).toHaveLength(MAX_TABS_ITEMS);
    expect((tree.nodes["tabs"] as { variant?: unknown }).variant).toBeUndefined();
    expect((tree.nodes["lowProgress"] as { value?: unknown }).value).toBe(0);
    expect((tree.nodes["highProgress"] as { value?: unknown; tone?: unknown }).value).toBe(100);
    expect((tree.nodes["highProgress"] as { tone?: unknown }).tone).toBeUndefined();
    expect(tree.nodes["badStat"]).toBeUndefined();
    expect(tree.nodes["badBadge"]).toBeUndefined();
    expect(tree.nodes["badAlert"]).toBeUndefined();
    expect(tree.nodes["good"]).toMatchObject({ type: "text", value: "kept" });
    expect(issues.some((issue) => issue.includes("items exceeded"))).toBe(true);
    expect(issues.some((issue) => issue.includes("progress value clamped to 0"))).toBe(true);
    expect(issues.some((issue) => issue.includes("progress value clamped to 100"))).toBe(true);
    expect(issues.some((issue) => issue.includes("stat needs string label and value"))).toBe(true);
    expect(issues.some((issue) => issue.includes("badge has no string label"))).toBe(true);
    expect(issues.some((issue) => issue.includes("alert has no string body"))).toBe(true);
  });
});

describe("validateTree theme", () => {
  const base = {
    root: "root",
    nodes: { root: { id: "root", type: "box", children: [] } },
  };

  it("keeps a string theme and drops a non-string theme", () => {
    const kept = validateTree({ ...base, theme: "brand" });
    expect((kept.tree as { theme?: unknown }).theme).toBe("brand");
    expect(kept.issues).toHaveLength(0);

    for (const bad of [42, {}, null]) {
      const { tree, issues } = validateTree({ ...base, theme: bad });
      expect((tree as { theme?: unknown }).theme).toBeUndefined();
      expect("theme" in tree).toBe(false);
      expect(issues.some((issue) => issue.includes("theme"))).toBe(true);
    }
  });

  it("drops a string theme that is not a valid theme name (unbounded / control chars)", () => {
    for (const bad of ["a".repeat(100_000), "brand\u0000ctl", "has space", "x".repeat(65)]) {
      const { tree, issues } = validateTree({ ...base, theme: bad });
      expect((tree as { theme?: unknown }).theme).toBeUndefined();
      expect("theme" in tree).toBe(false);
      expect(issues.some((issue) => issue.includes("theme is not a valid theme name"))).toBe(true);
    }
  });

  it("materializes no theme on garbage input (EMPTY_TREE carries none)", () => {
    for (const garbage of [null, 42, "nope", {}, { nodes: {} }]) {
      const { tree } = validateTree(garbage);
      expect("theme" in tree).toBe(false);
    }
  });
});

describe("validateComposition", () => {
  it("never throws on a hostile composition nodes getter", () => {
    const run = validateComposition({
      name: "bad",
      root: "root",
      get nodes(): unknown {
        throw new Error("boom");
      },
    });

    expect(run.composition).toBeUndefined();
    expect(run.issues).toContain("composition could not be read safely; refused");
  });

  it("keeps a valid fragment with a resolving root and one-line description", () => {
    const { composition, issues } = validateComposition({
      name: "hero",
      description: "a big hero",
      root: "h",
      nodes: {
        h: { id: "h", type: "box", style: { gap: "md" }, children: ["t"] },
        t: { id: "t", type: "text", value: "hi" },
      },
    });
    expect(issues).toHaveLength(0);
    expect(composition).toBeDefined();
    expect(composition?.name).toBe("hero");
    expect(composition?.description).toBe("a big hero");
    expect(composition?.root).toBe("h");
    expect(composition?.nodes["t"]).toMatchObject({ type: "text", value: "hi" });
    expect(Object.getPrototypeOf(composition?.nodes)).toBeNull();
  });

  it("normalizes safe intrinsic nodes and refuses unknown component names", () => {
    const safe = validateComposition({
      name: "customerSummaryCard",
      root: "card",
      nodes: {
        card: { id: "card", type: "card", title: "Summary", children: ["metric"] },
        metric: { id: "metric", type: "metric", label: "ARR", value: "$24k" },
      },
    });
    expect(safe.issues).toHaveLength(0);
    expect(safe.composition?.nodes["metric"]).toMatchObject({
      type: "metric",
      label: "ARR",
      value: "$24k",
    });

    const unknown = validateComposition({
      name: "badSummary",
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["custom"] },
        custom: { id: "custom", type: "customerSummaryCard", children: [] },
      },
    });
    expect(unknown.composition).toBeUndefined();
    expect(unknown.issues.some((issue) => issue.includes("unknown component type"))).toBe(true);
  });

  it("accepts 1023 raw nodes and rejects 1024 before sanitization", () => {
    const nodes: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 1023 }, (_, index) => {
        const id = index === 0 ? "root" : `n${String(index)}`;
        return [id, { id, type: "text", value: id }];
      }),
    );
    const accepted = validateComposition({ name: "bounded", root: "root", nodes });
    expect(accepted.composition).toBeDefined();
    expect(Object.keys(accepted.composition?.nodes ?? {})).toHaveLength(1023);

    nodes["overflow"] = { id: "overflow", type: "text", value: "overflow" };
    const rejected = validateComposition({ name: "oversized", root: "root", nodes });
    expect(rejected.composition).toBeUndefined();
    expect(rejected.issues).toContain("composition nodes exceeded the 1023-node cap; refused");
  });

  it("bounds issues while refusing hostile node vocabulary", () => {
    const nodes = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => {
        const id = index === 0 ? "root" : `n${String(index)}`;
        return [id, { id, type: `unknown-${String(index)}` }];
      }),
    );
    const run = validateComposition({ name: "hostile", root: "root", nodes });
    expect(run.composition).toBeUndefined();
    expect(run.issues).toHaveLength(65);
    expect(run.issues.at(-1)).toBe("...further issues suppressed");
  });

  it("refuses a fragment whose root does not resolve", () => {
    const { composition, issues } = validateComposition({
      name: "x",
      root: "ghost",
      nodes: { a: { id: "a", type: "box", children: [] } },
    });
    expect(composition).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a single text node as the root (the root need not be a box)", () => {
    const { composition, issues } = validateComposition({
      name: "label",
      root: "t",
      nodes: { t: { id: "t", type: "text", value: "solo" } },
    });
    expect(issues).toHaveLength(0);
    expect(composition?.root).toBe("t");
    expect(composition?.nodes["t"]).toMatchObject({ type: "text", value: "solo" });
  });

  it("refuses input with no string name", () => {
    for (const bad of [
      { root: "t", nodes: { t: { id: "t", type: "text", value: "x" } } },
      42,
      null,
    ]) {
      const { composition, issues } = validateComposition(bad);
      expect(composition).toBeUndefined();
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it("drops hostile node ids without flipping the map prototype", () => {
    const input = JSON.parse(
      '{"name":"h","root":"root","nodes":{"root":{"id":"root","type":"box","children":["value"]},"__proto__":{"id":"__proto__","type":"text","value":"x"}}}',
    ) as unknown;
    const { composition, issues } = validateComposition(input);
    expect(Object.keys(composition?.nodes ?? {})).toEqual(["root"]);
    expect(issues.some((issue) => issue.includes("forbidden node id"))).toBe(true);
    const root = composition?.nodes["root"] as unknown as { children: string[] };
    expect(root.children).toEqual([]);
  });

  it("sanitizes junk style tokens on composition nodes", () => {
    const { composition } = validateComposition({
      name: "s",
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { gap: "HUGE", pad: "md" }, children: [] },
      },
    });
    const root = composition?.nodes["root"] as unknown as { style?: Record<string, unknown> };
    expect(root.style?.["gap"]).toBeUndefined();
    expect(root.style?.["pad"]).toBe("md");
  });

  it("breaks a cyclic fragment a -> b -> a with an issue and no throw", () => {
    const run = (): ReturnType<typeof validateComposition> =>
      validateComposition({
        name: "cyc",
        root: "a",
        nodes: {
          a: { id: "a", type: "box", children: ["b"] },
          b: { id: "b", type: "box", children: ["a"] },
        },
      });
    expect(run).not.toThrow();
    const { composition, issues } = run();
    const b = composition?.nodes["b"] as unknown as { children: string[] };
    expect(b.children).toEqual([]); // the back-edge b -> a is removed
    expect(issues.some((issue) => issue.includes("cyclic"))).toBe(true);
  });

  it("clamps a fragment deeper than MAX_DEPTH with an issue and no throw", () => {
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: ["n0"] },
    };
    for (let i = 0; i < 150; i += 1) {
      nodes[`n${String(i)}`] = {
        id: `n${String(i)}`,
        type: "box",
        children: i < 149 ? [`n${String(i + 1)}`] : [],
      };
    }
    const run = (): ReturnType<typeof validateComposition> =>
      validateComposition({ name: "deep", root: "root", nodes });
    expect(run).not.toThrow();
    const { issues } = run();
    expect(issues.some((issue) => issue.includes("max depth"))).toBe(true);
  });

  it("keeps bounded prompt-safe composition metadata", () => {
    const { composition, issues } = validateComposition({
      name: "dashboard-summary",
      description: "Dashboard cards",
      metadata: {
        category: "dashboard",
        useWhen: "Summarizing KPIs",
        avoidWhen: "Long narrative content",
        variants: ["compact", "detailed"],
        tags: ["dashboard", "metrics"],
        repeatable: true,
        preferredParent: "section",
        composedOf: ["section", "card", "stat", "not-a-node"],
        dataRequirements: ["metric_label", "current_value"],
        followUpEdits: ["refresh_value"],
      },
      root: "card",
      nodes: { card: { id: "card", type: "card", title: "KPI", children: [] } },
    });

    expect(issues).toHaveLength(0);
    expect(composition?.metadata).toEqual({
      category: "dashboard",
      useWhen: "Summarizing KPIs",
      avoidWhen: "Long narrative content",
      variants: ["compact", "detailed"],
      tags: ["dashboard", "metrics"],
      repeatable: true,
      preferredParent: "section",
      composedOf: ["section", "card", "stat"],
      dataRequirements: ["metric_label", "current_value"],
      followUpEdits: ["refresh_value"],
    });
  });

  it("keeps every intrinsic component type in composedOf, not just the high-level shortlist", () => {
    const composedOf = [
      "metric",
      "nav",
      "keyValue",
      "form",
      "filterBar",
      "emptyState",
      "loading",
      "stat",
      "box",
      // Primitive bricks are admitted too — incl. richtext (allowlist derives
      // from PRIMITIVE_BRICK_TYPES, so a new primitive is not silently dropped).
      "richtext",
    ];
    const { composition, issues } = validateComposition({
      name: "component-heavy",
      metadata: { composedOf: [...composedOf, "not-a-node"] },
      root: "card",
      nodes: { card: { id: "card", type: "card", children: [] } },
    });

    expect(issues).toHaveLength(0);
    expect(composition?.metadata?.composedOf).toEqual(composedOf);
  });

  it("keeps sentence-like dataRequirements/followUpEdits as free text after bounded sanitation", () => {
    const longEntry = "x".repeat(MAX_DESCRIPTION_LENGTH + 50);
    const { composition, issues } = validateComposition({
      name: "free-text-metadata",
      metadata: {
        dataRequirements: [
          "The current account balance in USD.",
          "A list of recent transactions with dates.",
          "tab\tbedentry",
          longEntry,
          42,
          "   ",
        ],
        followUpEdits: ["Add a refresh button to reload the balance."],
      },
      root: "card",
      nodes: { card: { id: "card", type: "card", children: [] } },
    });

    const dataRequirements = composition?.metadata?.dataRequirements ?? [];
    expect(dataRequirements).toContain("The current account balance in USD.");
    expect(dataRequirements).toContain("A list of recent transactions with dates.");
    // C0/DEL/C1 control chars are stripped; the surviving text is kept.
    expect(dataRequirements).toContain("tabbedentry");
    // Over-long entry truncated to the description cap; whitespace-only dropped.
    expect(dataRequirements.some((entry) => entry.length === MAX_DESCRIPTION_LENGTH)).toBe(true);
    expect(dataRequirements).not.toContain(longEntry);
    expect(dataRequirements).not.toContain("   ");
    expect(composition?.metadata?.followUpEdits).toEqual([
      "Add a refresh button to reload the balance.",
    ]);
    expect(issues.some((issue) => issue.includes("truncated"))).toBe(true);
    expect(issues.some((issue) => issue.includes("is not a string"))).toBe(true);
  });
});

describe("validateTree shared-child DAG (single-parent per walk root)", () => {
  it("collapses a 2-boxes-per-level shared-child lattice to a single-parent tree", () => {
    // Both boxes at level i list both boxes at level i+1: acyclic, depth-bounded,
    // every child resolves — but the render-path count would be 2^depth. The
    // sanitized graph must be a true tree (no node kept under two parents), so
    // the renderer walks it in linear time.
    const LEVELS = 40;
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: ["L0_a", "L0_b"] },
    };
    for (let i = 0; i < LEVELS; i += 1) {
      const children = i < LEVELS - 1 ? [`L${String(i + 1)}_a`, `L${String(i + 1)}_b`] : [];
      nodes[`L${String(i)}_a`] = { id: `L${String(i)}_a`, type: "box", children };
      nodes[`L${String(i)}_b`] = { id: `L${String(i)}_b`, type: "box", children };
    }
    const { tree, issues } = validateTree({ root: "root", nodes });

    // No kept node is referenced as a child by more than one parent.
    const parentCount = new Map<string, number>();
    for (const node of Object.values(tree.nodes)) {
      if (node.type === "box") {
        for (const child of node.children) {
          parentCount.set(child, (parentCount.get(child) ?? 0) + 1);
        }
      }
    }
    for (const [id, count] of parentCount) {
      expect(count, `node "${id}" has ${String(count)} parents`).toBeLessThanOrEqual(1);
    }
    expect(issues.some((i) => i.includes("removed shared child"))).toBe(true);
  });

  it("keeps a node shared across two screens under BOTH (cross-screen sharing survives)", () => {
    // The legitimate pre-drawn-screens pattern: two screens reference the same
    // header/footer node. Single-parent is enforced PER WALK ROOT, so a fresh
    // claim set per screen keeps the shared node in each — it is not stripped
    // from the second screen.
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: [] },
        s1: { id: "s1", type: "box", children: ["shared"] },
        s2: { id: "s2", type: "box", children: ["shared"] },
        shared: { id: "shared", type: "box", children: ["leaf"] },
        leaf: { id: "leaf", type: "text", value: "hi" },
      },
      screens: { one: "s1", two: "s2" },
      entry: "one",
    };
    const { tree, issues } = validateTree(input);
    const s1 = tree.nodes["s1"] as unknown as { children: string[] };
    const s2 = tree.nodes["s2"] as unknown as { children: string[] };
    expect(s1.children).toContain("shared");
    expect(s2.children).toContain("shared");
    expect(tree.nodes["shared"]).toBeDefined();
    expect(tree.nodes["leaf"]).toBeDefined();
    // Nothing was dropped: each walk root sees "shared" under a single parent.
    expect(issues.some((i) => i.includes("removed shared child"))).toBe(false);
  });
});

describe("validateComposition caps (name + description)", () => {
  it("rejects a composition name that is not a valid theme-name (too long / bad chars)", () => {
    for (const bad of ["x".repeat(65), "has space", "-lead"]) {
      const { composition, issues } = validateComposition({
        name: bad,
        root: "t",
        nodes: { t: { id: "t", type: "text", value: "x" } },
      });
      expect(composition, bad).toBeUndefined();
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it("refuses a malformed name WITHOUT echoing its raw bytes into the issue string", () => {
    // The refusal branch must not embed the untrusted name — an unbounded or
    // terminal-escape name would otherwise inject into prompt/issue/log strings.
    const huge = "x".repeat(5_000_000);
    const escape = "\x1b[2Jwipe";
    for (const bad of [huge, escape]) {
      const { composition, issues } = validateComposition({
        name: bad,
        root: "t",
        nodes: { t: { id: "t", type: "text", value: "x" } },
      });
      expect(composition).toBeUndefined();
      const joined = issues.join("; ");
      // Contains neither the raw bytes nor a length anywhere near the input.
      expect(joined.includes(bad)).toBe(false);
      expect(joined.includes("\x1b")).toBe(false);
      expect(joined.length).toBeLessThan(200);
    }
  });

  it("truncates an over-long composition description to the shared 200-char cap with an issue", () => {
    const { composition, issues } = validateComposition({
      name: "hero",
      description: "d".repeat(5000),
      root: "t",
      nodes: { t: { id: "t", type: "text", value: "x" } },
    });
    expect(composition?.description).toHaveLength(200);
    expect(issues.some((i) => i.includes("description truncated"))).toBe(true);
  });
});

describe("MAX_DEPTH export", () => {
  it("is exported as the single source of truth with value 100", () => {
    expect(MAX_DEPTH).toBe(100);
  });
});

describe("validateTree screens prototype-key safety", () => {
  const base = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: [] },
      home: { id: "home", type: "box", children: [] },
    },
    screens: { home: "home" },
  };

  it("falls back an entry naming an Object.prototype member to the first kept screen", () => {
    for (const bad of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const { tree, issues } = validateTree({ ...base, entry: bad });
      expect(tree.entry).toBe("home"); // fell back, did not ship the prototype-member entry
      expect(issues.some((issue) => issue.includes("entry"))).toBe(true);
    }
  });

  it("drops a screen keyed __proto__ (JSON own-key) with exactly one issue and no pollution", () => {
    const input = JSON.parse(
      '{"root":"root","nodes":{"root":{"id":"root","type":"box","children":[]}},"screens":{"__proto__":"root"},"entry":"__proto__"}',
    ) as unknown;
    const { tree, issues } = validateTree(input);
    expect(tree.screens).toBeUndefined(); // the only screen was forbidden → none kept
    expect(issues.filter((i) => i.includes("forbidden screen name"))).toHaveLength(1);
    // No prototype pollution: a fresh object did not gain a polluted key.
    expect(({} as Record<string, unknown>)["root"]).toBeUndefined();
  });

  it("keeps valid screens alongside a dropped forbidden-named one", () => {
    const input = JSON.parse(
      '{"root":"root","nodes":{"root":{"id":"root","type":"box","children":[]},"home":{"id":"home","type":"box","children":[]}},"screens":{"home":"home","__proto__":"root"},"entry":"home"}',
    ) as unknown;
    const { tree, issues } = validateTree(input);
    expect(tree.screens).toEqual({ home: "home" });
    expect(tree.entry).toBe("home");
    expect(issues.some((i) => i.includes("forbidden screen name"))).toBe(true);
  });
});

describe("validateTree screens count cap (MAX_SCREENS)", () => {
  it("caps kept screens beyond MAX_SCREENS with an issue", () => {
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: [] },
    };
    const screens: Record<string, string> = {};
    for (let i = 0; i < MAX_SCREENS + 25; i += 1) screens[`s${String(i)}`] = "root";
    const { tree, issues } = validateTree({ root: "root", nodes, screens, entry: "s0" });
    expect(Object.keys(tree.screens ?? {})).toHaveLength(MAX_SCREENS);
    expect(issues.some((i) => i.includes("cap"))).toBe(true);
  });

  it("duplicate screen targets do not multiply the breakCycles walk (same tree out)", () => {
    // Two screen names targeting the SAME box must yield the same sanitized
    // nodes as one — the walk roots are deduped, so the shared box is walked once.
    const nodesFor = (screens: Record<string, string>): Record<string, unknown> =>
      validateTree({
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: [] },
          s: { id: "s", type: "box", children: ["a", "a"] }, // dup child collapses to ["a"]
          a: { id: "a", type: "text", value: "x" },
        },
        screens,
        entry: Object.keys(screens)[0],
      }).tree.nodes;
    expect(nodesFor({ one: "s", two: "s" })).toEqual(nodesFor({ one: "s" }));
  });
});

describe("validateTree node-count cap (MAX_RENDER_NODES)", () => {
  it("warns when a validated tree exceeds MAX_RENDER_NODES nodes", () => {
    const children: string[] = [];
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_RENDER_NODES; i += 1) {
      const id = `n${String(i)}`;
      children.push(id);
      nodes[id] = { id, type: "text", value: "x" };
    }
    nodes["root"] = { id: "root", type: "box", children };
    const { issues } = validateTree({ root: "root", nodes });
    expect(Object.keys(nodes).length).toBeGreaterThan(MAX_RENDER_NODES);
    expect(issues.some((i) => i.includes(String(MAX_RENDER_NODES)))).toBe(true);
  });

  it("does not warn for a tree at or under the cap", () => {
    const { issues } = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
    });
    expect(issues.some((i) => i.includes("truncate"))).toBe(false);
  });

  it("does not warn when each render root stays under the cap, even if the map total exceeds it", () => {
    // Three 2,000-node screens (6,000+ total nodes) each render fully — the
    // renderer's budget is per render pass, so no pass truncates. The whole-map
    // count would falsely warn here.
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: [] },
    };
    const screens: Record<string, string> = {};
    for (const name of ["a", "b", "c"]) {
      const children: string[] = [];
      for (let i = 0; i < 1999; i += 1) {
        const id = `${name}n${String(i)}`;
        children.push(id);
        nodes[id] = { id, type: "text", value: "x" };
      }
      const screenRoot = `${name}root`;
      nodes[screenRoot] = { id: screenRoot, type: "box", children };
      screens[name] = screenRoot;
    }
    const { issues } = validateTree({ root: "root", nodes, screens, entry: "a" });
    expect(Object.keys(nodes).length).toBeGreaterThan(MAX_RENDER_NODES);
    expect(issues.some((i) => i.includes("truncate"))).toBe(false);
  });

  it("warns and names the render root when one screen alone exceeds the cap", () => {
    const children: string[] = [];
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: [] },
    };
    for (let i = 0; i < MAX_RENDER_NODES; i += 1) {
      const id = `n${String(i)}`;
      children.push(id);
      nodes[id] = { id, type: "text", value: "x" };
    }
    nodes["big"] = { id: "big", type: "box", children }; // 1 + 5000 = 5001 reachable
    const { issues } = validateTree({
      root: "root",
      nodes,
      screens: { big: "big" },
      entry: "big",
    });
    expect(issues.some((i) => i.includes("truncate") && i.includes("big"))).toBe(true);
  });
});

describe("validate issue echo is bounded and never throws", () => {
  const rootBox = { id: "root", type: "box", children: [] };

  it("root-fallback issue never throws on a non-string / hostile root", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const throwingToJSON = {
      toJSON() {
        throw new Error("nope");
      },
    };
    for (const root of [cyclic, throwingToJSON, 42, null, "x".repeat(10_000_000)]) {
      const run = (): unknown => validateTree({ root, nodes: { root: rootBox } });
      expect(run).not.toThrow();
      const { issues } = validateTree({ root, nodes: { root: rootBox } });
      const joined = issues.join("\n");
      expect(joined.includes("fell back to")).toBe(true);
      expect(joined.length).toBeLessThan(300); // bounded, never a multi-MB echo
    }
  });

  it("unknown onPress kind issue never throws and is bounded for any value", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const pressBox = (kind: unknown): unknown => ({
      root: "root",
      nodes: { root: { id: "root", type: "box", onPress: { kind }, children: [] } },
    });
    for (const kind of [cyclic, {}, [1, 2], 42, null, "x".repeat(10_000_000)]) {
      const run = (): unknown => validateTree(pressBox(kind));
      expect(run).not.toThrow();
      const { tree, issues } = validateTree(pressBox(kind));
      const root = tree.nodes["root"] as unknown as { onPress?: unknown };
      expect(root.onPress).toBeUndefined(); // dropped → non-pressable box
      expect(issues.some((i) => i.includes("unknown onPress kind"))).toBe(true);
      expect(issues.join("\n").length).toBeLessThan(300);
    }
  });
});

describe("validateComposition description", () => {
  it("drops a non-string description WITH an issue (mirrors validateTheme)", () => {
    for (const bad of [123, {}, null, [1]]) {
      const { composition, issues } = validateComposition({
        name: "hero",
        description: bad,
        root: "t",
        nodes: { t: { id: "t", type: "text", value: "x" } },
      });
      expect(composition).toBeDefined();
      expect(composition?.description).toBeUndefined();
      expect(issues.some((i) => i.includes("description is not a string"))).toBe(true);
    }
  });
});

describe("validateComposition composition slots", () => {
  it("sanitizes optional composition slots with bounded string defaults", () => {
    const { composition, issues } = validateComposition({
      name: "hero",
      slots: {
        title: "Hello",
        empty: "",
        body: "b".repeat(MAX_FIELD_VALUE_CHARS + 5),
        bad: 42,
      },
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["title"] },
        title: { id: "title", type: "text", value: "{{title}}" },
      },
    });

    expect(composition?.slots).toEqual({
      title: "Hello",
      empty: "",
      body: "b".repeat(MAX_FIELD_VALUE_CHARS),
    });
    expect(issues.some((issue) => issue.includes("slot") && issue.includes("not a string"))).toBe(
      true,
    );
    expect(issues.some((issue) => issue.includes("slot") && issue.includes("truncated"))).toBe(
      true,
    );
  });

  it("accepts whole-value composition slot markers in composition string leaves only", () => {
    const { composition, issues } = validateComposition({
      name: "card",
      slots: {
        title: "Title",
        image: "https://example.com/card.png",
        poster: "https://example.com/poster.jpg",
        label: "Email",
      },
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["title", "image", "field"] },
        title: { id: "title", type: "text", value: "{{title}}" },
        image: {
          id: "image",
          type: "media",
          kind: "video",
          src: "{{image}}",
          alt: "{{title}}",
          poster: "{{poster}}",
        },
        field: {
          id: "field",
          type: "input",
          name: "email",
          label: "{{label}}",
          placeholder: "{{title}}",
        },
      },
    });

    expect(composition).toBeDefined();
    expect(composition?.nodes["title"]).toMatchObject({ type: "text", value: "{{title}}" });
    expect(composition?.nodes["image"]).toMatchObject({
      type: "media",
      src: "{{image}}",
      alt: "{{title}}",
      poster: "{{poster}}",
    });
    expect(composition?.nodes["field"]).toMatchObject({
      type: "input",
      label: "{{label}}",
      placeholder: "{{title}}",
    });
    expect(issues).toHaveLength(0);
  });
});

describe("validateComposition composition reference", () => {
  it("admits a bounded composition reference node inside a composition definition", () => {
    const { composition, issues } = validateComposition({
      name: "wrapper",
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["ref"] },
        ref: {
          use: "badge",
          slots: { label: "x", huge: "y".repeat(MAX_FIELD_VALUE_CHARS + 3) },
          // Extra keys must NOT survive — the reference is a closed { use, slots }.
          id: "ref",
          extra: "should-be-stripped",
          children: ["nope"],
        },
      },
    });

    expect(composition).toBeDefined();
    // Only { use, slots } survives; every other key is dropped, and the slot
    // values are bounded through the same slot-string path as slot defaults.
    expect(composition?.nodes["ref"]).toEqual({
      use: "badge",
      slots: { label: "x", huge: "y".repeat(MAX_FIELD_VALUE_CHARS) },
    });
    // The reference is a childless leaf, so the root's child ref is NOT dangling.
    expect(composition?.nodes["root"]).toMatchObject({ type: "box", children: ["ref"] });
    expect(issues.some((issue) => issue.includes("truncated"))).toBe(true);
  });

  it("refuses a composition whose reference carries a forbidden field", () => {
    const { composition, issues } = validateComposition({
      name: "wrapper",
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["ref"] },
        ref: { use: "badge", url: "https://evil.example/exfil" },
      },
    });

    expect(composition).toBeUndefined();
    expect(issues.some((issue) => issue.includes("url"))).toBe(true);
  });

  it("drops a composition reference node authored into the live stage tree", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["ref"] },
        ref: { use: "badge", slots: { label: "x" } },
      },
    });

    // A reference node is structurally impossible in the live stage: validateTree
    // never sets allowReference, so the { use, slots } node is dropped as unknown.
    expect(tree.nodes["ref"]).toBeUndefined();
    expect(tree.nodes["root"]).toBeDefined();
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("isSafeMediaSrc", () => {
  it("accepts data:image/ URLs", () => {
    expect(isSafeMediaSrc("data:image/png;base64,AAAA")).toBe(true);
  });

  it("rejects data:text/html URLs", () => {
    expect(isSafeMediaSrc("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("accepts protocol-relative //cdn URLs", () => {
    expect(isSafeMediaSrc("//cdn.example.com/x.png")).toBe(true);
  });

  it("accepts absolute /local paths", () => {
    expect(isSafeMediaSrc("/local/x.png")).toBe(true);
  });

  it("accepts http:// and https:// URLs", () => {
    expect(isSafeMediaSrc("https://example.com/x.png")).toBe(true);
    expect(isSafeMediaSrc("http://example.com/x.png")).toBe(true);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeMediaSrc("javascript:alert(1)")).toBe(false);
  });

  it("rejects a bare relative path (no leading slash or scheme)", () => {
    expect(isSafeMediaSrc("images/x.png")).toBe(false);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isSafeMediaSrc("  HTTPS://example.com/x.png  ")).toBe(true);
    expect(isSafeMediaSrc("  DATA:IMAGE/PNG;base64,AAAA")).toBe(true);
    expect(isSafeMediaSrc("  JavaScript:alert(1)")).toBe(false);
  });
});

describe("brick-vocab v1 core validation", () => {
  const rootWith = (nodes: Record<string, unknown>): unknown => ({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: Object.keys(nodes) },
      ...nodes,
    },
  });

  it("keeps media video nodes and normalizes legacy image nodes to media image", () => {
    const { tree, issues } = validateTree(
      rootWith({
        clip: {
          id: "clip",
          type: "media",
          kind: "video",
          src: "https://cdn.example.com/clip.mp4",
          variant: "hero",
          alt: "Launch",
          poster: "/posters/launch.png",
          controls: true,
          style: { radius: "md", width: "full", ratio: "wide" },
        },
        legacy: {
          id: "legacy",
          type: "image",
          src: "https://picsum.photos/seed/legacy/600/400",
          alt: "legacy",
        },
        legacyNoisy: {
          id: "legacyNoisy",
          type: "image",
          kind: "gif3d",
          src: "https://picsum.photos/seed/noisy/600/400",
          alt: "legacy noisy",
        },
      }),
    );

    expect(issues).toHaveLength(0);
    expect(tree.nodes["clip"]).toEqual({
      id: "clip",
      type: "media",
      kind: "video",
      src: "https://cdn.example.com/clip.mp4",
      variant: "hero",
      alt: "Launch",
      poster: "/posters/launch.png",
      controls: true,
      style: { radius: "md", width: "full", ratio: "wide" },
    });
    expect(tree.nodes["legacy"]).toMatchObject({
      id: "legacy",
      type: "media",
      kind: "image",
      src: "https://picsum.photos/seed/legacy/600/400",
      alt: "legacy",
    });
    expect(tree.nodes["legacyNoisy"]).toMatchObject({
      id: "legacyNoisy",
      type: "media",
      kind: "image",
      src: "https://picsum.photos/seed/noisy/600/400",
      alt: "legacy noisy",
    });
  });

  it("drops malformed media with bounded issues and gates src and poster schemes", () => {
    const { tree, issues } = validateTree(
      rootWith({
        missing: { id: "missing", type: "media", kind: "image", alt: "no src" },
        weird: {
          id: "weird",
          type: "media",
          kind: "gif3d",
          src: "https://cdn.example.com/weird.gif",
        },
        unsafe: {
          id: "unsafe",
          type: "media",
          kind: "video",
          src: "javascript:alert(1)",
        },
        poster: {
          id: "poster",
          type: "media",
          kind: "video",
          src: "https://cdn.example.com/movie.mp4",
          poster: "data:text/html,<script>alert(1)</script>",
        },
      }),
    );

    expect(tree.nodes["missing"]).toBeUndefined();
    expect(tree.nodes["weird"]).toBeUndefined();
    expect(tree.nodes["unsafe"]).toBeUndefined();
    expect(tree.nodes["poster"]).toMatchObject({ type: "media", kind: "video" });
    expect(tree.nodes["poster"]).not.toHaveProperty("poster");
    expect(issues.some((issue) => issue.includes("media") || issue.includes("src"))).toBe(true);
    expect(issues.join("\n").length).toBeLessThan(500);
  });

  it("sanitizes input inputs and options", () => {
    const long = "x".repeat(5000);
    const { tree, issues } = validateTree(
      rootWith({
        select: {
          id: "select",
          type: "input",
          name: "plan",
          variant: "default",
          input: "select",
          options: ["Free", 7, "Pro", long],
        },
        checkbox: { id: "checkbox", type: "input", name: "tos", input: "checkbox" },
        radio: { id: "radio", type: "input", name: "size", input: "radio", options: [] },
        emptySelect: { id: "emptySelect", type: "input", name: "empty", input: "select" },
        switcher: { id: "switcher", type: "input", name: "alerts", input: "switch" },
        unknown: { id: "unknown", type: "input", name: "mystery", input: "colorwheel" },
      }),
    );

    expect(issues).toEqual([
      'node "radio": "radio" input has no valid options — rendered control will be empty',
      'node "emptySelect": "select" input has no valid options — rendered control will be empty',
    ]);
    expect(tree.nodes["select"]).toMatchObject({
      type: "input",
      variant: "default",
      input: "select",
      options: ["Free", "Pro", "x".repeat(2000)],
    });
    expect(tree.nodes["checkbox"]).toMatchObject({ type: "input", input: "checkbox" });
    expect(tree.nodes["radio"]).not.toHaveProperty("options");
    expect(tree.nodes["emptySelect"]).toMatchObject({ type: "input", input: "select" });
    expect(tree.nodes["emptySelect"]).not.toHaveProperty("options");
    expect(tree.nodes["switcher"]).toMatchObject({ type: "input", input: "switch" });
    expect(tree.nodes["unknown"]).not.toHaveProperty("input");
  });

  it("drops malformed media and input variants", () => {
    const { tree, issues } = validateTree(
      rootWith({
        media: {
          id: "media",
          type: "media",
          kind: "image",
          src: "https://cdn.example.com/a.png",
          variant: "bad variant",
        },
        field: {
          id: "field",
          type: "input",
          name: "email",
          variant: "bad variant",
        },
      }),
    );

    expect(tree.nodes["media"]).not.toHaveProperty("variant");
    expect(tree.nodes["field"]).not.toHaveProperty("variant");
    expect(issues.filter((issue) => issue.includes("malformed variant dropped"))).toHaveLength(2);
  });

  it("keeps scroll axes and columns tokens while stripping unknown values with issues", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          children: ["x", "y", "legacy", "grid", "badScroll", "badColumns"],
        },
        x: { id: "x", type: "box", style: { scroll: "x" }, children: [] },
        y: { id: "y", type: "box", style: { scroll: "y" }, children: [] },
        legacy: { id: "legacy", type: "box", style: { scroll: true }, children: [] },
        grid: { id: "grid", type: "box", style: { columns: 3 }, children: [] },
        badScroll: { id: "badScroll", type: "box", style: { scroll: "sideways" }, children: [] },
        badColumns: { id: "badColumns", type: "box", style: { columns: 9 }, children: [] },
      },
    });

    const styleOf = (id: string): Record<string, unknown> | undefined =>
      (tree.nodes[id] as unknown as { style?: Record<string, unknown> }).style;
    expect(styleOf("x")?.["scroll"]).toBe("x");
    expect(styleOf("y")?.["scroll"]).toBe("y");
    expect(styleOf("legacy")?.["scroll"]).toBe("y");
    expect(styleOf("grid")?.["columns"]).toBe(3);
    expect(styleOf("badScroll")?.["scroll"]).toBeUndefined();
    expect(styleOf("badColumns")?.["columns"]).toBeUndefined();
    expect(issues.some((issue) => issue.includes("scroll"))).toBe(true);
    expect(issues.some((issue) => issue.includes("columns"))).toBe(true);
  });

  it("renames the URL gate to isSafeMediaSrc without relaxing unsafe schemes", () => {
    expect(isSafeMediaSrc("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeMediaSrc("https://example.com/video.mp4")).toBe(true);
    expect(isSafeMediaSrc("/static/movie.mp4")).toBe(true);
    expect(isSafeMediaSrc("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeMediaSrc("javascript:alert(1)")).toBe(false);
  });
});

describe("validateTree appear/scroll/onHold vocabulary", () => {
  it("strips unknown appear scroll tokens and malformed onHold", () => {
    // Valid new vocabulary is KEPT: appear token, scroll boolean, onHold action
    // with payload/collect intact — zero issues.
    const valid = {
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          style: { appear: "fade", scroll: true },
          onHold: { kind: "agent", name: "peek", payload: { id: 7 }, collect: "form" },
          children: [],
        },
      },
    };
    const keptRun = validateTree(valid);
    expect(keptRun.issues).toHaveLength(0);
    const keptRoot = keptRun.tree.nodes["root"] as unknown as {
      style?: Record<string, unknown>;
      onHold?: Record<string, unknown>;
    };
    expect(keptRoot.style?.["appear"]).toBe("fade");
    expect(keptRoot.style?.["scroll"]).toBe("y");
    expect(keptRoot.onHold).toEqual({
      kind: "agent",
      name: "peek",
      payload: { id: 7 },
      collect: "form",
    });

    // appear:"explode" is not in APPEARS → stripped WITH an issue recorded.
    const explodeRun = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", style: { appear: "explode" }, children: [] } },
    });
    const explodeRoot = explodeRun.tree.nodes["root"] as unknown as {
      style?: Record<string, unknown>;
    };
    expect(explodeRoot.style?.["appear"]).toBeUndefined();
    expect(explodeRun.issues.some((i) => i.includes("appear"))).toBe(true);

    // scroll junk — only axes or legacy true survive; other strings/numbers are stripped.
    for (const scroll of ["sideways", 1]) {
      const { tree, issues } = validateTree({
        root: "root",
        nodes: { root: { id: "root", type: "box", style: { scroll }, children: [] } },
      });
      const root = tree.nodes["root"] as unknown as { style?: Record<string, unknown> };
      expect(root.style?.["scroll"]).toBeUndefined();
      expect(issues.some((i) => i.includes("scroll"))).toBe(true);
    }

    // onHold:42 → stripped with an issue that names onHold, NEVER onPress.
    const holdJunk = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", onHold: 42, children: [] } },
    });
    const holdRoot = holdJunk.tree.nodes["root"] as unknown as { onHold?: unknown };
    expect(holdRoot.onHold).toBeUndefined();
    expect(holdJunk.issues.some((i) => i.includes("onHold"))).toBe(true);
    expect(holdJunk.issues.some((i) => i.includes("onPress"))).toBe(false);

    // Legacy bare {name} onHold gets the canonical kind:"agent" discriminator, silently
    // (same rule as onPress — it is the same action, not a mistake).
    const legacy = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", onHold: { name: "peek" }, children: [] } },
    });
    const legacyRoot = legacy.tree.nodes["root"] as unknown as { onHold?: unknown };
    expect(legacyRoot.onHold).toEqual({ kind: "agent", name: "peek" });
    expect(legacy.issues).toHaveLength(0);

    // validateComposition parity: the shared sanitizeNode strips the same junk.
    const { composition, issues: compositionIssues } = validateComposition({
      name: "junky",
      root: "b",
      nodes: {
        b: {
          id: "b",
          type: "box",
          style: { appear: "explode", scroll: "sideways" },
          onHold: 42,
          children: [],
        },
      },
    });
    const compositionRoot = composition?.nodes["b"] as unknown as {
      style?: Record<string, unknown>;
      onHold?: unknown;
    };
    expect(compositionRoot.style?.["appear"]).toBeUndefined();
    expect(compositionRoot.style?.["scroll"]).toBeUndefined();
    expect(compositionRoot.onHold).toBeUndefined();
    expect(compositionIssues.some((i) => i.includes("onHold"))).toBe(true);
    expect(compositionIssues.some((i) => i.includes("onPress"))).toBe(false);

    // A pre-D tree (none of the new fields) passes through byte-identical.
    const preD = {
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          style: { gap: "md" },
          onPress: { kind: "agent", name: "go" },
          children: ["t"],
        },
        t: { id: "t", type: "text", value: "hi", style: {} },
      },
    };
    const preDRun = validateTree(preD);
    expect(preDRun.issues).toHaveLength(0);
    expect(preDRun.tree).toEqual(preD);
  });

  it("strips appear/scroll from non-box styles — the new style tokens are BoxStyle-only", () => {
    // appear and scroll live on BoxStyle only; text/media/field styles never
    // carry them, so validateTree must drop them there (the renderer's
    // BoxStyle-only raw path then matches the validated path — no divergence).
    const run = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t", "f"] },
        t: {
          id: "t",
          type: "text",
          value: "hi",
          style: { appear: "fade", size: "lg" },
        },
        f: {
          id: "f",
          type: "input",
          name: "email",
          style: { scroll: true },
        },
      },
    });
    const t = run.tree.nodes["t"] as unknown as { style?: Record<string, unknown> };
    const f = run.tree.nodes["f"] as unknown as { style?: Record<string, unknown> };
    expect(t.style?.["appear"]).toBeUndefined(); // stripped from a text style
    expect(t.style?.["size"]).toBe("lg"); // a real text token survives
    expect(f.style?.["scroll"]).toBeUndefined(); // stripped from an input style
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

  it("normalizes an OMITTED entry to the first kept screen with ZERO issues", () => {
    // FacetTree declares `entry?` — a screens map with no entry is a legal shape,
    // not an operator mistake, so it must not produce a spurious fallback issue.
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: [] },
        home: { id: "home", type: "box", children: [] },
      },
      screens: { home: "home" },
    };
    const { tree, issues } = validateTree(input);
    expect(tree.entry).toBe("home");
    expect(tree.screens).toEqual({ home: "home" });
    expect(issues).toHaveLength(0);
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

  it("passes a bare-onPress tree through identical except the silent kind discriminator", () => {
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

describe("validateTree input style", () => {
  it("keeps a valid input style instead of stripping it", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["f"] },
        f: { id: "f", type: "input", name: "email", style: { width: "full" } },
      },
    };
    const { tree } = validateTree(input);
    expect(tree.nodes["f"]).toMatchObject({ style: { width: "full" } });
  });

  it("strips an invalid input style token but keeps the input", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["f"] },
        f: { id: "f", type: "input", name: "q", style: { width: "97vw" } },
      },
    };
    const { tree } = validateTree(input);
    const field = tree.nodes["f"] as unknown as { style?: unknown };
    expect(field).toBeDefined();
    expect(field.style).toBeUndefined();
  });
});

// WU-1 (field→input rename): the primitive input brick replaces the old field
// brick. `input` is the canonical node type (keeping the "search" input KIND);
// a stale `type:"field"` node is now an UNKNOWN type and fail-safe dropped.
describe("input primitive", () => {
  it("keeps an input node and its search input kind (field renamed to input)", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["q"] },
        q: { id: "q", type: "input", name: "query", input: "search", placeholder: "Search" },
      },
    });
    expect(tree.nodes["q"]).toMatchObject({
      type: "input",
      name: "query",
      input: "search",
      placeholder: "Search",
    });
    expect(issues).toHaveLength(0);
  });

  it('fail-safe drops a stale type:"field" node as an unknown type (hard cutover)', () => {
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["f"] },
        f: { id: "f", type: "field", name: "email" },
      },
    });
    expect(tree.nodes["f"]).toBeUndefined();
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

describe("validateTree issue hardening (shared printableKey + bounded list)", () => {
  it("caps the per-tree issues array so a junk node map cannot balloon it", () => {
    const nodes: Record<string, unknown> = {
      root: { id: "root", type: "box", children: [] },
    };
    // Each junk entry is not an object with a type → one issue apiece.
    for (let i = 0; i < 1000; i++) nodes[`junk${String(i)}`] = { id: `junk${String(i)}` };
    const { issues } = validateTree({ root: "root", nodes });
    // 64 real issues + a single suppression tail entry.
    expect(issues.length).toBeLessThanOrEqual(65);
    expect(issues[issues.length - 1]).toContain("further issues suppressed");
  });

  it("never echoes an over-long or control/escape node id verbatim into an issue string", () => {
    const bigId = "z".repeat(10_000_000);
    const escId = "\x1b[31mEVIL"; // C0 ESC introducer
    const c1Id = "\u009b31mEVIL"; // single-byte CSI (C1, 0x9b) - the widened guard must catch it
    const { issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: [] },
        // "not an object with a type" interpolates the id through printableKey.
        [bigId]: { id: bigId },
        [escId]: { id: escId },
        [c1Id]: { id: c1Id },
      },
    });
    const joined = issues.join("\n");
    expect(joined).toContain("<key too long>");
    expect(joined).toContain("<unprintable key>");
    expect(joined.includes(bigId)).toBe(false);
    expect(joined.includes(escId)).toBe(false);
    expect(joined.includes(c1Id)).toBe(false);
  });

  it("surfaces a dangling /root that fell back to the node keyed 'root' as an issue (not silent)", () => {
    const { tree, issues } = validateTree({
      root: "ghost",
      nodes: { root: { id: "root", type: "box", children: [] } },
    });
    expect(tree.root).toBe("root"); // salvaged
    expect(issues.some((i) => i.includes("fell back to"))).toBe(true);
  });
});

describe("landing-grade-vocab", () => {
  /** Validate a single box node with the given style, returning its sanitized shape + issues. */
  function runBox(style: Record<string, unknown>): {
    node: { style?: Record<string, unknown>; backdrop?: unknown };
    issues: readonly string[];
  } {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: { root: { id: "root", type: "box", style, children: [] } },
    });
    return {
      node: tree.nodes["root"] as unknown as {
        style?: Record<string, unknown>;
        backdrop?: unknown;
      },
      issues,
    };
  }

  /** Validate a single text node with the given style, returning its sanitized shape + issues. */
  function runText(style: Record<string, unknown>): {
    style: Record<string, unknown> | undefined;
    issues: readonly string[];
  } {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "text", value: "hi", style },
      },
    });
    return {
      style: (tree.nodes["t"] as unknown as { style?: Record<string, unknown> }).style,
      issues,
    };
  }

  // DC-002 — new BoxStyle tokens: accepted when valid.
  const boxTokenCases: ReadonlyArray<readonly [string, string]> = [
    ["minHeight", "screen"],
    ["maxWidth", "prose"],
    ["gradient", "dusk"],
    ["backdropScrim", "dark"],
    ["scheme", "dark"],
  ];
  for (const [key, valid] of boxTokenCases) {
    it(`DC-002 accepts a valid ${key} box token`, () => {
      const { node, issues } = runBox({ [key]: valid });
      expect(node.style?.[key]).toBe(valid);
      expect(issues).toHaveLength(0);
    });

    it(`DC-002 drops an unknown ${key} box token WITH an issue`, () => {
      const { node, issues } = runBox({ [key]: "NOPE" });
      expect(node.style?.[key]).toBeUndefined();
      expect(issues.some((i) => i.includes(key))).toBe(true);
    });
  }

  // DC-002 — sticky boolean flag.
  it("DC-002 accepts sticky:true and drops a non-boolean sticky WITH an issue", () => {
    const ok = runBox({ sticky: true });
    expect(ok.node.style?.["sticky"]).toBe(true);
    expect(ok.issues).toHaveLength(0);

    const bad = runBox({ sticky: "yes" });
    expect(bad.node.style?.["sticky"]).toBeUndefined();
    expect(bad.issues.some((i) => i.includes("sticky"))).toBe(true);
  });

  // DC-002 — new TextStyle tokens.
  const textTokenCases: ReadonlyArray<readonly [string, string]> = [
    ["tracking", "wide"],
    ["leading", "relaxed"],
    ["highlight", "band"],
  ];
  for (const [key, valid] of textTokenCases) {
    it(`DC-002 accepts a valid ${key} text token`, () => {
      const { style, issues } = runText({ [key]: valid });
      expect(style?.[key]).toBe(valid);
      expect(issues).toHaveLength(0);
    });

    it(`DC-002 drops an unknown ${key} text token WITH an issue`, () => {
      const { style, issues } = runText({ [key]: "NOPE" });
      expect(style?.[key]).toBeUndefined();
      expect(issues.some((i) => i.includes(key))).toBe(true);
    });
  }

  // DC-002 — extended FONT_SIZES accept the new display sizes.
  for (const size of ["4xl", "5xl", "6xl"] as const) {
    it(`DC-002 accepts extended font size ${size}`, () => {
      const { style, issues } = runText({ size });
      expect(style?.["size"]).toBe(size);
      expect(issues).toHaveLength(0);
    });
  }

  // DC-003 — backdrop is a node-id STRING passthrough (not token membership).
  it("DC-003 keeps a string backdrop and drops a non-string backdrop WITH an issue", () => {
    const kept = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", backdrop: "hero-media", children: [] },
      },
    });
    expect((kept.tree.nodes["root"] as unknown as { backdrop?: unknown }).backdrop).toBe(
      "hero-media",
    );

    const dropped = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", backdrop: { id: "x" }, children: [] },
      },
    });
    const node = dropped.tree.nodes["root"] as unknown as { backdrop?: unknown };
    expect(node.backdrop).toBeUndefined();
    expect(dropped.issues.some((i) => i.includes("backdrop"))).toBe(true);
  });

  // DC-003 — hostile / unknown token values never throw.
  it("DC-003 never throws on hostile unknown token values or a non-string backdrop", () => {
    const hostile: Record<string, unknown> = {
      minHeight: {
        toString() {
          throw new Error("boom");
        },
      },
      maxWidth: 42,
      gradient: [],
      backdropScrim: null,
      scheme: Symbol("x") as unknown,
      sticky: { nope: true },
    };
    expect(() =>
      validateTree({
        root: "root",
        nodes: {
          root: {
            id: "root",
            type: "box",
            style: hostile,
            backdrop: 123,
            children: [],
          },
        },
      }),
    ).not.toThrow();
    expect(() => runText({ tracking: 3, leading: false, highlight: [] })).not.toThrow();
  });

  // DC-006 — a tree with NO new tokens / no backdrop validates byte-identically.
  it("DC-006 back-compat: a box with only legacy vocabulary is byte-identical, no new keys injected", () => {
    const input = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", style: { gap: "md", pad: "lg" }, children: ["t"] },
        t: { id: "t", type: "text", value: "hi", style: { size: "xl", weight: "bold" } },
      },
    };
    const { tree, issues } = validateTree(input);
    expect(issues).toHaveLength(0);
    const box = tree.nodes["root"] as unknown as {
      style?: Record<string, unknown>;
      backdrop?: unknown;
    };
    const text = tree.nodes["t"] as unknown as { style?: Record<string, unknown> };
    // No backdrop own-property, and style keys are exactly the legacy set.
    expect(Object.prototype.hasOwnProperty.call(box, "backdrop")).toBe(false);
    expect(box.style).toEqual({ gap: "md", pad: "lg" });
    expect(text.style).toEqual({ size: "xl", weight: "bold" });
  });
});

describe("text from active", () => {
  // DC-002 — enabler A (store-bound text) + enabler B (active look) validation.
  it("DC-002: keeps valid from/column/row + activeVariant, drops a non-token activeStyle value and an unknown-kind active with issues", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: {
          id: "t",
          type: "text",
          value: "fallback",
          from: "kpis",
          column: "arr",
          row: 2,
          activeVariant: "highlighted",
          // color is a real text token (kept); tracking carries a non-token
          // value + boxShadow is a raw-CSS key — both must be rejected because
          // activeStyle routes through the SAME textStyle() sanitizer as style.
          activeStyle: { color: "accent", tracking: "ginormous", boxShadow: "0 0 5px red" },
          active: { totallyUnknownKind: "nope" },
        },
      },
    });
    const t = tree.nodes["t"] as unknown as {
      from?: string;
      column?: string;
      row?: number;
      activeVariant?: string;
      activeStyle?: Record<string, unknown>;
      active?: unknown;
    };
    expect(t.from).toBe("kpis");
    expect(t.column).toBe("arr");
    expect(t.row).toBe(2);
    expect(t.activeVariant).toBe("highlighted");
    // RISK-INV-4: activeStyle is token-only — a valid token survives, a non-token
    // value / raw-CSS key is dropped exactly like base style (no token bypass).
    expect(t.activeStyle?.["color"]).toBe("accent");
    expect(t.activeStyle).not.toHaveProperty("tracking");
    expect(t.activeStyle).not.toHaveProperty("boxShadow");
    expect(issues.some((issue) => issue.includes("unknown tracking token"))).toBe(true);
    // An unknown-kind predicate degrades to no predicate, dropped with an issue.
    expect(t.active).toBeUndefined();
    expect(issues.some((issue) => issue.includes("unknown active predicate"))).toBe(true);
  });

  it("DC-006: an unknown-kind active degrades while a valid closed predicate is kept (box + text)", () => {
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          active: { kind: "future-thing", foo: 1 },
          children: ["t"],
        },
        t: { id: "t", type: "text", value: "hi", active: { screen: "home" } },
      },
    });
    const root = tree.nodes["root"] as unknown as { active?: unknown };
    const t = tree.nodes["t"] as unknown as { active?: { screen?: string } };
    expect(root.active).toBeUndefined();
    expect(t.active).toEqual({ screen: "home" });
  });

  it("DC-008: a text without the new fields validates byte-identically (no keys injected)", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "text", value: "plain" },
      },
    });
    expect(issues).toHaveLength(0);
    const text = tree.nodes["t"] as object;
    expect(Object.keys(text).sort()).toEqual(["id", "style", "type", "value"]);
    expect(text).toEqual({ id: "t", type: "text", value: "plain", style: {} });
    expect(text).not.toHaveProperty("from");
    expect(text).not.toHaveProperty("active");
    expect(text).not.toHaveProperty("activeVariant");
    expect(text).not.toHaveProperty("activeStyle");
  });
});

describe("validateTree box overlay (WU-1)", () => {
  const runOverlay = (overlay: unknown) => {
    const { tree } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", overlay, children: [] },
      },
    });
    return tree.nodes["root"] as unknown as { overlay?: unknown };
  };

  // DC-003 / DC-004 — a valid closed kind survives as exactly { kind }.
  it("DC-004 overlay keeps a valid modal descriptor", () => {
    expect(runOverlay({ kind: "modal" }).overlay).toEqual({ kind: "modal" });
  });

  it("DC-004 overlay keeps a valid drawer descriptor", () => {
    expect(runOverlay({ kind: "drawer" }).overlay).toEqual({ kind: "drawer" });
  });

  // DC-003 — unknown/malformed overlay → descriptor dropped, never throws.
  it("DC-003 overlay drops an unknown kind (lightbox) WITH an issue", () => {
    const { tree, issues } = validateTree({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", overlay: { kind: "lightbox" }, children: [] },
      },
    });
    const node = tree.nodes["root"] as unknown as { overlay?: unknown };
    expect(node.overlay).toBeUndefined();
    expect(issues.some((i) => i.includes("overlay"))).toBe(true);
  });

  it("DC-003 overlay drops an empty descriptor {} (missing kind)", () => {
    expect(runOverlay({}).overlay).toBeUndefined();
  });

  it("DC-003 overlay drops a string 'modal' (wrong type)", () => {
    expect(runOverlay("modal").overlay).toBeUndefined();
  });

  it("DC-003 overlay drops a number 42 (wrong type)", () => {
    expect(runOverlay(42).overlay).toBeUndefined();
  });

  it("DC-003 overlay never throws on a hostile descriptor", () => {
    expect(() =>
      runOverlay({
        get kind() {
          throw new Error("boom");
        },
      }),
    ).not.toThrow();
  });

  // DC-004 — no author-positioning leak: only `kind` survives, extras stripped.
  it("DC-004 overlay strips extra author keys (z/top) — only kind survives", () => {
    expect(runOverlay({ kind: "modal", z: 999, top: 10 }).overlay).toEqual({ kind: "modal" });
  });
});
