// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render as mountClient, screen } from "@testing-library/react";
import {
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_LIST_ITEMS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TABS_ITEMS,
  type FacetNode,
  type FacetTheme,
  type FacetTree,
  type NodeId,
  type ViewSnapshot,
} from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import * as stageRendererExports from "./StageRenderer.js";
import { MOTION_CLASS_NAMES } from "./motion.js";

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
}

function renderThemed(tree: FacetTree, themes: readonly FacetTheme[]): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree, themes }));
}

function renderWithTransition(tree: FacetTree): string {
  return renderToStaticMarkup(
    createElement(StageRenderer, { tree, transition: { revision: 0, rootReplaced: false } }),
  );
}

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({ id, type: "box", children });

describe("StageRenderer module boundary", () => {
  it("keeps the exact runtime export surface", () => {
    expect(Object.keys(stageRendererExports).sort()).toEqual(["StageRenderer"]);
  });
});

// The renderer is the fail-safe boundary (invariant #2): the live patch path
// reaches it WITHOUT passing validateTree, so every malformed shape below must
// render as "plain" or nothing — never throw.
describe("StageRenderer fail-safe boundary", () => {
  it("renders nothing for a null tree (unvalidated CLI path)", () => {
    expect(render(null as unknown as FacetTree)).toBe("");
  });

  it("renders nothing for a non-object tree", () => {
    expect(render("not a tree" as unknown as FacetTree)).toBe("");
    expect(render(42 as unknown as FacetTree)).toBe("");
  });

  it("renders nothing when the root id does not resolve", () => {
    expect(render(tree({ a: text("a", "orphan") }, "missing"))).toBe("");
  });

  it("renders nothing when nodes is not a map", () => {
    expect(render({ root: "root", nodes: null } as unknown as FacetTree)).toBe("");
  });

  it("renders nothing when raw tree root or nodes access throws", () => {
    const rootThrows = Object.defineProperties(
      {},
      {
        root: {
          get() {
            throw new Error("root boom");
          },
        },
        nodes: { value: {} },
      },
    ) as FacetTree;
    const nodesThrows = Object.defineProperties(
      {},
      {
        root: { value: "root" },
        nodes: {
          get() {
            throw new Error("nodes boom");
          },
        },
      },
    ) as FacetTree;

    expect(() => render(rootThrows)).not.toThrow();
    expect(() => render(nodesThrows)).not.toThrow();
    expect(render(rootThrows)).toBe("");
    expect(render(nodesThrows)).toBe("");
  });

  it("falls back safely when raw screen maps throw during resolution", () => {
    const screens = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("screens boom");
        },
      },
    );
    const out = render({
      root: "root",
      nodes: {
        root: box("root", ["copy"]),
        copy: text("copy", "Safe root"),
      },
      screens,
      entry: "home",
    } as unknown as FacetTree);

    expect(out).toContain("Safe root");
  });

  it("skips a dangling child reference and renders the rest", () => {
    const out = render(tree({ root: box("root", ["a", "gone"]), a: text("a", "kept") }));
    expect(out).toContain("kept");
    expect(out.match(/<p/g)).toHaveLength(1); // only the resolvable child rendered
  });

  it("skips a node of unknown type instead of throwing", () => {
    const alien = { id: "x", type: "script", code: "evil()" } as unknown as FacetNode;
    const out = render(tree({ root: box("root", ["x", "a"]), x: alien, a: text("a", "safe") }));
    expect(out).toContain("safe");
    expect(out.match(/<p/g)).toHaveLength(1); // the alien node produced no output
  });

  // A raw patch can replace any node FIELD with arbitrary JSON — these exact
  // shapes made the renderer throw before the guards existed.
  it("renders a box whose children were patched to a non-array as empty", () => {
    const broken = { id: "root", type: "box", children: "oops" } as unknown as FacetNode;
    expect(() => render(tree({ root: broken }))).not.toThrow();
    expect(render(tree({ root: broken }))).toBe(
      '<div style="display:flex;flex-direction:column;box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere"></div>',
    );
  });

  it("skips a text node whose value was patched to an object", () => {
    const broken = { id: "t", type: "text", value: { evil: true } } as unknown as FacetNode;
    const out = render(
      tree({ root: box("root", ["t", "a"]), t: broken, a: text("a", "still up") }),
    );
    expect(out).toContain("still up");
    expect(out.match(/<p/g)).toHaveLength(1);
  });

  it("skips media whose src was patched to a non-string", () => {
    const broken = {
      id: "i",
      type: "media",
      kind: "image",
      src: 42,
      alt: "x",
    } as unknown as FacetNode;
    const out = render(
      tree({ root: box("root", ["i", "a"]), i: broken, a: text("a", "still up") }),
    );
    expect(out).toContain("still up");
    expect(out).not.toContain("<img");
  });

  it("skips a node patched to JSON null (root and child)", () => {
    const rootNull = { root: "root", nodes: { root: null } } as unknown as FacetTree;
    expect(() => render(rootNull)).not.toThrow();
    expect(render(rootNull)).toBe("");

    const childNull = tree({
      root: box("root", ["gone", "a"]),
      gone: null as unknown as FacetNode,
      a: text("a", "still up"),
    });
    expect(() => render(childNull)).not.toThrow();
    expect(render(childNull)).toContain("still up");
  });

  it("survives a style patched to null on any node", () => {
    const noisy = {
      root: { id: "root", type: "box", style: null, children: ["t", "f"] },
      t: { id: "t", type: "text", value: "ok", style: null },
      f: { id: "f", type: "field", name: "n", label: { bad: 1 }, style: null },
    } as unknown as Record<string, FacetNode>;
    expect(() => render(tree(noisy))).not.toThrow();
    const out = render(tree(noisy));
    expect(out).toContain("ok");
    expect(out).toContain("<input"); // field renders, its non-string label skipped
    expect(out).not.toContain("<span");
  });

  it("breaks a direct cycle (child pointing back at its parent)", () => {
    const out = render(
      tree({ root: box("root", ["a"]), a: box("a", ["root", "t"]), t: text("t", "once") }),
    );
    expect(out).toContain("once");
  });

  it("keeps transition bookkeeping fail-safe for null and cyclic raw trees", () => {
    expect(renderWithTransition(null as unknown as FacetTree)).toBe("");

    const cyclic = tree({
      root: box("root", ["a"]),
      a: box("a", ["root", "t"]),
      t: text("t", "once"),
    });
    const out = renderWithTransition(cyclic);
    expect(out).toContain("once");
    expect(out).not.toContain(MOTION_CLASS_NAMES.brickEnter);
    expect(out).not.toContain(MOTION_CLASS_NAMES.brickExit);
    expect(out).not.toContain(MOTION_CLASS_NAMES.stageCrossfade);
  });

  it("breaks a self-cycle (node listing itself as a child)", () => {
    const out = render(tree({ root: box("root", ["root", "t"]), t: text("t", "still here") }));
    expect(out).toContain("still here");
  });

  it("truncates beyond the depth cap instead of blowing the stack", () => {
    const nodes: Record<NodeId, FacetNode> = { deep: text("deep", "too deep") };
    // A chain of 120 nested boxes puts the leaf past MAX_DEPTH (100).
    for (let i = 0; i < 120; i += 1) {
      nodes[`b${i}`] = box(`b${i}`, [i === 119 ? "deep" : `b${i + 1}`]);
    }
    const out = render(tree(nodes, "b0"));
    expect(out).not.toContain("too deep");
  });

  it("drops media with an unsafe URL scheme", () => {
    const out = render(
      tree({
        root: box("root", ["i"]),
        i: { id: "i", type: "media", kind: "image", src: "javascript:alert(1)", alt: "x" },
      }),
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
  });
});

describe("StageRenderer brick-vocab v1", () => {
  it("renders media image/video and native form controls", () => {
    const out = render(
      tree({
        root: box("root", ["hero", "clip", "plan", "agree", "size", "alerts"]),
        hero: {
          id: "hero",
          type: "media",
          kind: "image",
          src: "https://example.com/hero.png",
          alt: "Hero",
        },
        clip: {
          id: "clip",
          type: "media",
          kind: "video",
          src: "https://example.com/clip.mp4",
          poster: "/poster.png",
          controls: true,
        },
        plan: {
          id: "plan",
          type: "field",
          name: "plan",
          input: "select",
          options: ["Free", "Pro"],
        },
        agree: { id: "agree", type: "field", name: "agree", input: "checkbox" },
        size: { id: "size", type: "field", name: "size", input: "radio", options: ["S", "M"] },
        alerts: { id: "alerts", type: "field", name: "alerts", input: "switch" },
      }),
    );

    expect(out).toContain("<img");
    expect(out).toContain('src="https://example.com/hero.png"');
    expect(out).toContain("<video");
    expect(out).toContain('src="https://example.com/clip.mp4"');
    expect(out).toContain('poster="/poster.png"');
    expect(out).toContain("controls");
    expect(out).toContain("<select");
    expect(out).toContain("<option");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('type="radio"');
    expect(out).toContain('role="switch"');
  });

  it("skips malformed media and keeps a raw legacy image alias", () => {
    const legacy = {
      id: "legacy",
      type: "image",
      src: "https://example.com/legacy.png",
      alt: "Legacy",
    } as unknown as FacetNode;
    const out = render(
      tree({
        root: box("root", ["missing", "unknown", "unsafe", "legacy", "t"]),
        missing: { id: "missing", type: "media", kind: "image" } as unknown as FacetNode,
        unknown: {
          id: "unknown",
          type: "media",
          kind: "gif3d",
          src: "https://example.com/unknown.gif",
        } as unknown as FacetNode,
        unsafe: {
          id: "unsafe",
          type: "media",
          kind: "video",
          src: "javascript:alert(1)",
        } as unknown as FacetNode,
        legacy,
        t: text("t", "still here"),
      }),
    );

    expect(out).toContain("still here");
    expect(out).toContain('src="https://example.com/legacy.png"');
    expect(out).not.toContain("unknown.gif");
    expect(out).not.toContain("javascript:");
  });

  it("renders columns and scroll-axis styles while raw junk stays plain", () => {
    const out = render(
      tree({
        root: box("root", ["grid", "x", "y", "junk"]),
        grid: { id: "grid", type: "box", style: { columns: 3 }, children: [] },
        x: { id: "x", type: "box", style: { scroll: "x" }, children: [] },
        y: { id: "y", type: "box", style: { scroll: true }, children: [] },
        junk: {
          id: "junk",
          type: "box",
          style: { columns: "lots", scroll: "sideways" },
          children: [],
        } as unknown as FacetNode,
      }),
    );

    expect(out).toContain("display:grid");
    expect(out).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(out).toContain("overflow-x:auto");
    expect(out).toContain("max-width:100%");
    expect(out).toContain("overflow-y:auto");
    expect(out).toContain("max-height:20rem");
  });
});

describe("StageRenderer component renderer (static)", () => {
  const catalogTheme: FacetTheme = {
    name: "catalog",
    color: {
      accent: "#123456",
      "accent-fg": "#ffffff",
      surface: "#f3f4f6",
      "surface-2": "#e5e7eb",
      success: "#15803d",
      warning: "#b45309",
    },
    space: { md: "20px" },
    radius: { lg: "18px", full: "9999px" },
    shadow: { md: "0 14px 36px rgba(0, 0, 0, 0.18)" },
    recipes: {
      section: {
        dashboard: {
          box: { bg: "surface", pad: "md", radius: "lg" },
          text: { color: "fg-muted", weight: "semibold" },
        },
      },
      card: {
        elevated: {
          box: { bg: "bg", border: true, radius: "lg", shadow: "md", pad: "md" },
        },
      },
      button: {
        primary: {
          box: { bg: "accent", pad: "md", radius: "full" },
          text: { color: "accent-fg", weight: "bold" },
        },
      },
      badge: {
        success: {
          box: { bg: "success", pad: "xs", radius: "full" },
          text: { color: "accent-fg" },
        },
      },
    },
  };

  it("renders component layout, action, data, and feedback nodes with recipes", () => {
    const out = renderThemed(
      {
        root: "root",
        theme: "catalog",
        nodes: {
          root: {
            id: "root",
            type: "section",
            title: "Dashboard",
            eyebrow: "Q3",
            body: "Live operating view",
            variant: "dashboard",
            children: [
              "card",
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
            body: "Current quarter",
            variant: "elevated",
            children: ["button"],
          },
          button: {
            id: "button",
            type: "button",
            label: "Refresh",
            variant: "primary",
            onPress: { kind: "agent", name: "refresh" },
          },
          table: {
            id: "table",
            type: "table",
            caption: "Pipeline",
            columns: [
              { key: "name", label: "Name" },
              { key: "value", label: "Value", align: "end" },
            ],
            rows: [{ name: "Acme", value: 42 }],
          },
          chart: {
            id: "chart",
            type: "chart",
            title: "Trend",
            kind: "bar",
            labels: ["Jan", "Feb"],
            series: [{ label: "ARR", values: [10, 20] }],
          },
          stat: { id: "stat", type: "stat", label: "ARR", value: "$24k", delta: "+12%" },
          badge: { id: "badge", type: "badge", label: "Healthy", tone: "success" },
          progress: { id: "progress", type: "progress", label: "Quota", value: 72 },
          alert: { id: "alert", type: "alert", title: "Heads up", body: "Review pricing." },
          list: {
            id: "list",
            type: "list",
            items: [{ title: "Next", body: "Call customer" }],
          },
          divider: { id: "divider", type: "divider", label: "Details" },
        },
      },
      [catalogTheme],
    );

    expect(out).toContain("<section");
    expect(out).toContain("Dashboard");
    expect(out).toContain("Live operating view");
    expect(out).toContain("box-shadow:0 14px 36px rgba(0, 0, 0, 0.18)");
    expect(out).toContain('role="button"');
    expect(out).toContain("Refresh");
    expect(out).toContain("background:#123456");
    expect(out).toContain("<table");
    expect(out).toMatch(/<caption[^>]*>Pipeline<\/caption>/);
    expect(out).toContain("<svg");
    expect(out).toContain("Trend");
    expect(out).toContain("$24k");
    expect(out).toContain("Healthy");
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('role="alert"');
    expect(out).toContain("Call customer");
    expect(out).toContain("<hr");
  });

  it("renders component recipe parts", () => {
    const partsTheme: FacetTheme = {
      name: "parts",
      color: {
        fg: "#111827",
        "fg-muted": "#475569",
        surface: "#f8fafc",
        "surface-2": "#eef2ff",
        accent: "#0f766e",
        "accent-fg": "#ffffff",
        border: "#64748b",
        danger: "#dc2626",
        warning: "#b45309",
        info: "#2563eb",
      },
      space: { xs: "3px", sm: "7px", md: "13px" },
      radius: { sm: "5px", lg: "17px", full: "999px" },
      recipes: {
        section: {
          default: {
            parts: {
              title: { text: { color: "danger", weight: "bold" } },
              body: { text: { color: "warning" } },
            },
          },
        },
        card: {
          default: {
            parts: {
              header: { box: { bg: "surface-2", pad: "xs", radius: "sm" } },
              title: { text: { color: "danger", weight: "bold" } },
              body: { text: { color: "warning" } },
            },
          },
        },
        button: {
          default: {
            parts: {
              label: { text: { color: "warning", weight: "bold" } },
            },
          },
        },
        tabs: {
          default: {
            parts: {
              tab: {
                box: { bg: "surface-2", pad: "xs", radius: "full" },
                text: { color: "danger", weight: "bold" },
              },
              activeTab: {
                box: { bg: "accent", pad: "xs", radius: "full" },
                text: { color: "accent-fg", weight: "bold" },
              },
            },
          },
        },
        table: {
          default: {
            parts: {
              headerCell: { text: { color: "info", weight: "bold" } },
              cell: { text: { color: "warning" } },
            },
          },
        },
        chart: {
          default: {
            parts: {
              title: { text: { color: "danger", weight: "bold" } },
              plot: { box: { bg: "surface-2", radius: "lg" } },
            },
          },
        },
        progress: {
          default: {
            parts: {
              label: { text: { color: "danger", weight: "bold" } },
              track: { box: { bg: "surface-2", radius: "full" } },
              fill: { box: { bg: "accent", radius: "full" } },
            },
          },
        },
        stat: {
          default: {
            parts: {
              label: { text: { color: "info", weight: "bold" } },
              value: { text: { color: "danger", weight: "bold" } },
              trend: { text: { color: "warning", weight: "medium" } },
            },
          },
        },
        alert: {
          default: {
            parts: {
              title: { text: { color: "danger", weight: "bold" } },
              body: { text: { color: "warning" } },
            },
          },
        },
        list: {
          default: {
            parts: {
              item: { box: { bg: "surface-2", pad: "xs", radius: "sm" } },
              itemTitle: { text: { color: "danger", weight: "bold" } },
              itemText: { text: { color: "warning" } },
            },
          },
        },
        divider: {
          default: {
            parts: {
              label: { text: { color: "info", weight: "bold" } },
              rule: { box: { bg: "danger", width: "full" } },
            },
          },
        },
        field: {
          default: {
            parts: {
              label: { text: { color: "danger", weight: "bold" } },
              control: { field: { width: "full" } },
            },
          },
        },
      },
    };
    const out = renderThemed(
      {
        root: "root",
        theme: "parts",
        screens: { pipeline: "root", accounts: "accountsRoot" },
        entry: "pipeline",
        nodes: {
          root: {
            id: "root",
            type: "section",
            title: "Overview",
            body: "Part-driven internals",
            children: [
              "card",
              "tabs",
              "table",
              "chart",
              "stat",
              "progress",
              "alert",
              "list",
              "divider",
              "email",
            ],
          },
          card: {
            id: "card",
            type: "card",
            title: "Revenue",
            body: "Current quarter",
            children: ["button"],
          },
          button: { id: "button", type: "button", label: "Refresh" },
          tabs: {
            id: "tabs",
            type: "tabs",
            items: [
              { label: "Pipeline", to: "pipeline" },
              { label: "Accounts", to: "accounts" },
            ],
          },
          accountsRoot: {
            id: "accountsRoot",
            type: "section",
            title: "Accounts",
            children: [],
          },
          table: {
            id: "table",
            type: "table",
            columns: [
              { key: "name", label: "Name" },
              { key: "value", label: "Value", align: "end" },
            ],
            rows: [{ name: "Acme", value: 42 }],
          },
          chart: {
            id: "chart",
            type: "chart",
            title: "Trend",
            kind: "bar",
            series: [{ label: "ARR", values: [10, 20] }],
          },
          progress: { id: "progress", type: "progress", label: "Completion", value: 72 },
          stat: { id: "stat", type: "stat", label: "ARR", value: "$24k", delta: "+12%" },
          alert: { id: "alert", type: "alert", title: "Heads up", body: "Review pricing." },
          list: {
            id: "list",
            type: "list",
            items: [{ title: "Next", body: "Call customer" }],
          },
          divider: { id: "divider", type: "divider", label: "Details" },
          email: {
            id: "email",
            type: "field",
            name: "email",
            input: "email",
            label: "Email",
            placeholder: "you@example.com",
          },
        },
      },
      [partsTheme],
    );

    expect(out).toMatch(/<h2 style="[^"]*font-weight:700[^"]*color:#dc2626[^"]*">Overview/);
    expect(out).toMatch(/<p style="[^"]*color:#b45309[^"]*">Part-driven internals/);
    expect(out).toMatch(
      /<div style="(?=[^"]*background:#eef2ff)(?=[^"]*padding:3px)(?=[^"]*border-radius:5px)[^"]*"><h3/,
    );
    expect(out).toMatch(/<span style="[^"]*font-weight:700[^"]*color:#b45309[^"]*">Refresh/);
    expect(out).toMatch(
      /role="tab" aria-selected="true"[^>]*style="(?=[^"]*background:#0f766e)(?=[^"]*border-radius:999px)(?=[^"]*color:#ffffff)[^"]*">Pipeline/,
    );
    expect(out).toMatch(
      /role="tab" aria-selected="false"[^>]*style="(?=[^"]*background:#eef2ff)(?=[^"]*border-radius:999px)(?=[^"]*color:#dc2626)[^"]*">Accounts/,
    );
    expect(out).toMatch(/<th style="[^"]*color:#2563eb[^"]*font-weight:700[^"]*">Name/);
    expect(out).toMatch(/<td style="[^"]*color:#b45309[^"]*">Acme/);
    expect(out).not.toMatch(/<th[^>]*style="[^"]*display:flex/);
    expect(out).not.toMatch(/<td[^>]*style="[^"]*display:flex/);
    expect(out).toMatch(/<figcaption style="[^"]*font-weight:700[^"]*color:#dc2626[^"]*">Trend/);
    expect(out).toMatch(/<figure[^>]*style="(?=[^"]*margin:0)(?=[^"]*max-width:100%)[^"]*">/);
    expect(out).toMatch(
      /<svg[^>]*style="(?=[^"]*background:#eef2ff)(?=[^"]*border-radius:17px)(?=[^"]*display:block)[^"]*"/,
    );
    expect(out).not.toMatch(/<svg[^>]*style="[^"]*display:flex/);
    expect(out).toMatch(/<span style="[^"]*font-weight:700[^"]*color:#dc2626[^"]*">Completion/);
    expect(out).toMatch(
      /role="progressbar" aria-valuenow="72" aria-valuemin="0" aria-valuemax="100"[^>]*style="(?=[^"]*width:100%)(?=[^"]*background:#eef2ff)[^"]*"><div style="[^"]*width:72%/,
    );
    expect(out).not.toMatch(/<label[^>]*style="[^"]*background:/);
    expect(out).not.toContain("<progress");
    expect(out).toMatch(/<p style="(?=[^"]*font-weight:700)(?=[^"]*color:#2563eb)[^"]*">ARR/);
    expect(out).toMatch(/<p style="(?=[^"]*font-weight:700)(?=[^"]*color:#dc2626)[^"]*">\$24k/);
    expect(out).toMatch(/<p style="(?=[^"]*font-weight:500)(?=[^"]*color:#b45309)[^"]*">\+12%/);
    expect(out).toMatch(
      /role="alert"[^>]*><p style="(?=[^"]*font-weight:700)(?=[^"]*color:#dc2626)/,
    );
    expect(out).toMatch(/<p style="[^"]*color:#b45309[^"]*">Review pricing\./);
    expect(out).toMatch(
      /<li style="(?=[^"]*background:#eef2ff)(?=[^"]*padding:3px)(?=[^"]*border-radius:5px)[^"]*"><span style="[^"]*color:#dc2626[^"]*">Next/,
    );
    expect(out).toMatch(/<p style="[^"]*color:#b45309[^"]*">Call customer/);
    expect(out).toMatch(/<hr style="[^"]*background:#dc2626[^"]*width:100%/);
    expect(out).toMatch(/<span style="[^"]*font-weight:700[^"]*color:#2563eb[^"]*">Details/);
    expect(out).toMatch(/<span style="[^"]*font-weight:700[^"]*color:#dc2626[^"]*">Email/);
    expect(out).toMatch(/<input[^>]*data-facet-field-id="email"[^>]*style="[^"]*width:100%/);
    expect(out).toMatch(
      /<input[^>]*data-facet-field-id="email"[^>]*style="[^"]*background:#ffffff/,
    );
    expect(out).toMatch(
      /<input[^>]*data-facet-field-id="email"[^>]*style="[^"]*border:1px solid #64748b/,
    );
  });

  it("keeps component raw-path malformed data fail-safe", () => {
    const noisy = {
      root: {
        id: "root",
        type: "section",
        title: 42,
        body: "still renders",
        children: ["button", "table", "chart", "list", "text"],
      },
      button: { id: "button", type: "button", label: { bad: true }, onPress: 99 },
      table: { id: "table", type: "table", columns: "bad", rows: [{ value: { nope: true } }] },
      chart: { id: "chart", type: "chart", kind: "space", series: "bad", title: "Bad chart" },
      list: { id: "list", type: "list", items: ["Plain item", { title: 9, body: "bad title" }] },
      text: text("text", "safe child"),
    } as unknown as Record<NodeId, FacetNode>;

    expect(() => render(tree(noisy))).not.toThrow();
    const out = render(tree(noisy));
    expect(out).toContain("still renders");
    expect(out).toContain("Plain item");
    expect(out).toContain("safe child");
    expect(out).not.toContain("[object Object]");
    expect(out).not.toContain("Bad chart");
  });

  it("caps raw-path table, chart, tabs, and list collections at the core validator limits", () => {
    const columns = Array.from({ length: MAX_TABLE_COLUMNS + 8 }, (_, index) => ({
      key: `c${String(index)}`,
      label: `Column ${String(index)}`,
    }));
    const rows = Array.from({ length: MAX_TABLE_ROWS + 20 }, (_, rowIndex) =>
      Object.fromEntries(columns.map((column) => [column.key, `r${String(rowIndex)}`])),
    );
    const series = Array.from({ length: MAX_CHART_SERIES + 4 }, (_, seriesIndex) => ({
      label: `Series ${String(seriesIndex)}`,
      values: Array.from({ length: MAX_CHART_POINTS + 25 }, (_, valueIndex) => valueIndex),
    }));
    const longLabel = "x".repeat(MAX_NODE_LABEL_CHARS + 25);
    const out = render(
      tree({
        root: box("root", ["table", "chart", "tabs", "list"]),
        table: { id: "table", type: "table", columns, rows } as unknown as FacetNode,
        chart: { id: "chart", type: "chart", kind: "bar", series } as unknown as FacetNode,
        tabs: {
          id: "tabs",
          type: "tabs",
          items: Array.from({ length: MAX_TABS_ITEMS + 4 }, (_, index) => ({
            label: `${longLabel}-${String(index)}`,
            to: `screen-${String(index)}`,
          })),
        } as unknown as FacetNode,
        list: {
          id: "list",
          type: "list",
          items: Array.from({ length: MAX_LIST_ITEMS + 4 }, () => longLabel),
        } as unknown as FacetNode,
      }),
    );

    expect(out.match(/<th\b/g)).toHaveLength(MAX_TABLE_COLUMNS);
    expect(out.match(/<tr/g)).toHaveLength(MAX_TABLE_ROWS + 1);
    expect(out.match(/<rect/g)).toHaveLength(MAX_CHART_SERIES * MAX_CHART_POINTS);
    expect(out.match(/role="tab"/g)).toHaveLength(MAX_TABS_ITEMS);
    expect(out.match(/<li/g)).toHaveLength(MAX_LIST_ITEMS);
    expect(out).not.toContain(longLabel);
  });

  it("does not read raw-path collection entries beyond the render caps", () => {
    const readPastCap = new Set<string>();
    const defineThrowingPastCap = <T>(values: T[], index: number, label: string): T[] => {
      values.length = index + 1;
      Object.defineProperty(values, String(index), {
        get() {
          readPastCap.add(label);
          throw new Error(`read past ${label} cap`);
        },
        configurable: true,
      });
      return values;
    };

    const columns = defineThrowingPastCap(
      Array.from({ length: MAX_TABLE_COLUMNS }, (_, index) => ({
        key: `c${String(index)}`,
        label: `Column ${String(index)}`,
      })),
      MAX_TABLE_COLUMNS,
      "columns",
    );
    const longCell = "x".repeat(MAX_TABLE_CELL_CHARS + 20);
    const rows = defineThrowingPastCap(
      Array.from({ length: MAX_TABLE_ROWS }, (_, rowIndex) => ({
        c0: rowIndex === 0 ? longCell : `r${String(rowIndex)}`,
      })),
      MAX_TABLE_ROWS,
      "rows",
    );
    const values = defineThrowingPastCap(
      Array.from({ length: MAX_CHART_POINTS }, (_, index) => index + 1),
      MAX_CHART_POINTS,
      "chart points",
    );
    const series = defineThrowingPastCap(
      Array.from({ length: MAX_CHART_SERIES }, (_, index) => ({
        label: `Series ${String(index)}`,
        values,
      })),
      MAX_CHART_SERIES,
      "chart series",
    );
    const tabs = defineThrowingPastCap(
      Array.from({ length: MAX_TABS_ITEMS }, (_, index) => ({
        label: `Tab ${String(index)}`,
        to: `screen-${String(index)}`,
      })),
      MAX_TABS_ITEMS,
      "tabs",
    );
    const listItems = defineThrowingPastCap(
      Array.from({ length: MAX_LIST_ITEMS }, (_, index) => `Item ${String(index)}`),
      MAX_LIST_ITEMS,
      "list",
    );

    let out = "";
    expect(() => {
      out = render(
        tree({
          root: box("root", ["table", "chart", "tabs", "list"]),
          table: { id: "table", type: "table", columns, rows } as unknown as FacetNode,
          chart: { id: "chart", type: "chart", kind: "bar", series } as unknown as FacetNode,
          tabs: { id: "tabs", type: "tabs", items: tabs } as unknown as FacetNode,
          list: { id: "list", type: "list", items: listItems } as unknown as FacetNode,
        }),
      );
    }).not.toThrow();

    expect(readPastCap.size).toBe(0);
    expect(out.match(/<th\b/g)).toHaveLength(MAX_TABLE_COLUMNS);
    expect(out.match(/<tr/g)).toHaveLength(MAX_TABLE_ROWS + 1);
    expect(out.match(/<rect/g)).toHaveLength(MAX_CHART_SERIES * MAX_CHART_POINTS);
    expect(out.match(/role="tab"/g)).toHaveLength(MAX_TABS_ITEMS);
    expect(out.match(/<li/g)).toHaveLength(MAX_LIST_ITEMS);
    expect(out).toContain("x".repeat(MAX_TABLE_CELL_CHARS));
    expect(out).not.toContain(longCell);
  });

  it("renders line and donut charts as distinct chart primitives, not bars", () => {
    const line = render(
      tree({
        root: box("root", ["chart"]),
        chart: {
          id: "chart",
          type: "chart",
          title: "Line",
          kind: "line",
          series: [{ label: "Revenue", values: [1, 3, 2] }],
        },
      }),
    );
    expect(line).toContain("<polyline");
    expect(line).not.toContain("<rect");

    const donut = render(
      tree({
        root: box("root", ["chart"]),
        chart: {
          id: "chart",
          type: "chart",
          title: "Donut",
          kind: "donut",
          series: [{ label: "Mix", values: [2, 3, 5] }],
        },
      }),
    );
    expect(donut).toContain("<circle");
    expect(donut).not.toContain("<rect");
  });
});

// The live patch path can produce a box whose children list repeats an id
// (validateTree dedupes siblings; the raw path does not). React needs unique
// keys, so the renderer keeps only the first occurrence.
describe("StageRenderer sibling dedupe", () => {
  it("renders a duplicated sibling id only once", () => {
    const out = render(
      tree({ root: box("root", ["a", "a", "b"]), a: text("a", "dup"), b: text("b", "other") }),
    );
    expect(out.match(/dup/g)).toHaveLength(1);
    expect(out).toContain("other");
  });
});

// The raw live-patch path can put arbitrary JSON in a field's name/placeholder/
// input. name/placeholder coerce to strings (omitted otherwise) and input is
// constrained to the FIELD_INPUTS token set (else "text"), mirroring core.
describe("StageRenderer field coercion", () => {
  const field = (extra: Record<string, unknown>): FacetTree =>
    tree({
      root: box("root", ["f"]),
      f: { id: "f", type: "field", ...extra } as unknown as FacetNode,
    });

  it("falls back to type=text for a junk input value", () => {
    const out = render(field({ input: 999 }));
    expect(out).toContain('type="text"');
  });

  it("falls back to type=text for an unknown input token", () => {
    const out = render(field({ input: "color" }));
    expect(out).toContain('type="text"');
  });

  it("keeps a valid input token (email)", () => {
    const out = render(field({ input: "email" }));
    expect(out).toContain('type="email"');
  });

  it("omits a non-string name and placeholder", () => {
    const out = render(field({ name: 42, placeholder: { bad: 1 } }));
    expect(out).not.toContain("name=");
    expect(out).not.toContain("placeholder=");
  });

  it("keeps string name and placeholder", () => {
    const out = render(field({ name: "email", placeholder: "you@x.com" }));
    expect(out).toContain('name="email"');
    expect(out).toContain('placeholder="you@x.com"');
  });
});

describe("StageRenderer happy path", () => {
  it("renders primitive box/text variants through default theme recipes", () => {
    const out = render(
      tree({
        root: { id: "root", type: "box", variant: "panel", children: ["title"] },
        title: { id: "title", type: "text", value: "Welcome", variant: "heading" },
      }),
    );

    expect(out).toContain("background:#f6f7f9");
    expect(out).toContain("border:1px solid #e2e5ea");
    expect(out).toContain("box-shadow:0 1px 2px rgba(15, 23, 42, 0.08)");
    expect(out).toContain("font-size:36px");
    expect(out).toContain("font-weight:700");
  });

  it("renders primitive media and field variants through default theme recipes", () => {
    const out = render(
      tree({
        root: box("root", ["hero", "email"]),
        hero: {
          id: "hero",
          type: "media",
          kind: "image",
          variant: "hero",
          src: "https://example.com/hero.png",
          alt: "Hero",
        },
        email: {
          id: "email",
          type: "field",
          name: "email",
          input: "email",
          variant: "default",
          label: "Email",
        },
      }),
    );

    expect(out).toContain("aspect-ratio:16 / 9");
    expect(out).toContain("border-radius:16px");
    expect(out).toContain("width:100%");
  });

  it("renders default text and select fields with token-resolved control chrome", () => {
    const out = render(
      tree({
        root: box("root", ["email", "surface"]),
        email: {
          id: "email",
          type: "field",
          name: "email",
          input: "email",
          label: "Email",
        },
        surface: {
          id: "surface",
          type: "field",
          name: "surface",
          input: "select",
          options: ["Dashboard", "Pricing"],
          label: "Surface",
        },
      }),
    );

    expect(out).toMatch(/<input[^>]*style="[^"]*background:#ffffff/);
    expect(out).toMatch(/<input[^>]*style="[^"]*border:1px solid #e2e5ea/);
    expect(out).toMatch(/<input[^>]*style="[^"]*border-radius:6px/);
    expect(out).toMatch(/<input[^>]*style="[^"]*padding:8px/);
    expect(out).toMatch(/<select[^>]*style="[^"]*background:#ffffff/);
    expect(out).toMatch(/<select[^>]*style="[^"]*border:1px solid #e2e5ea/);
    expect(out).not.toMatch(/<input[^>]*style="[^"]*display:flex/);
    expect(out).not.toMatch(/<select[^>]*style="[^"]*display:flex/);
  });

  it("renders all four bricks", () => {
    const out = render(
      tree({
        root: box("root", ["t", "i", "f"]),
        t: text("t", "hello"),
        i: {
          id: "i",
          type: "media",
          kind: "image",
          src: "https://example.com/a.png",
          alt: "pic",
        },
        f: { id: "f", type: "field", name: "email", input: "email", label: "Email" },
      }),
    );
    expect(out).toContain("hello");
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('name="email"');
    expect(out).toContain("Email");
  });

  it("caps raw component and primitive strings before rendering", () => {
    const longLabel = "L".repeat(MAX_NODE_LABEL_CHARS + 10);
    const longBody = "B".repeat(MAX_NODE_BODY_CHARS + 10);
    const out = render(
      tree({
        root: box("root", [
          "section",
          "card",
          "button",
          "table",
          "chart",
          "stat",
          "badge",
          "progress",
          "alert",
          "divider",
          "text",
          "media",
          "field",
        ]),
        section: {
          id: "section",
          type: "section",
          eyebrow: longLabel,
          title: longLabel,
          body: longBody,
          children: [],
        },
        card: { id: "card", type: "card", title: longLabel, body: longBody, children: [] },
        button: { id: "button", type: "button", label: longLabel },
        table: {
          id: "table",
          type: "table",
          caption: longLabel,
          columns: [{ key: "name", label: longLabel }],
          rows: [{ name: longLabel }],
        },
        chart: {
          id: "chart",
          type: "chart",
          title: longLabel,
          kind: "bar",
          series: [{ label: "A", values: [1] }],
        },
        stat: { id: "stat", type: "stat", label: longLabel, value: longLabel, delta: longLabel },
        badge: { id: "badge", type: "badge", label: longLabel },
        progress: { id: "progress", type: "progress", value: 50, label: longLabel },
        alert: { id: "alert", type: "alert", title: longLabel, body: longBody },
        divider: { id: "divider", type: "divider", label: longLabel },
        text: { id: "text", type: "text", value: longBody },
        media: {
          id: "media",
          type: "media",
          kind: "image",
          src: "https://example.com/a.png",
          alt: longLabel,
        },
        field: {
          id: "field",
          type: "field",
          name: "field-name",
          label: longLabel,
          placeholder: longLabel,
        },
      } as Record<NodeId, FacetNode>),
    );

    expect(out).not.toContain(longLabel);
    expect(out).not.toContain(longBody);
    expect(out).toContain("L".repeat(MAX_NODE_LABEL_CHARS));
    expect(out).toContain("B".repeat(MAX_NODE_BODY_CHARS));
  });

  it("renders a pressable box as a button", () => {
    const out = render(
      tree({
        root: { id: "root", type: "box", onPress: { name: "go" }, children: ["t"] },
        t: text("t", "press me"),
      }),
    );
    expect(out).toContain('role="button"');
    expect(out).toContain("press me");
  });
});

// onRecord (WU-4, RISK-API-3): the record-only channel is an INTERACTION channel
// — it never fires during render, so supplying or omitting it must not change a
// single byte of the rendered markup. This pins the "handler-less output stays
// byte-identical" invariant and confirms the agent-tap path is untouched.
describe("StageRenderer onRecord is render-inert (static)", () => {
  const navToggleTree = (): FacetTree =>
    tree({
      root: box("root", ["go", "toggleBtn", "agentBtn"]),
      go: { id: "go", type: "box", onPress: { kind: "navigate", to: "about" }, children: ["gt"] },
      gt: text("gt", "Go"),
      toggleBtn: {
        id: "toggleBtn",
        type: "box",
        onPress: { kind: "toggle", target: "go" },
        children: ["tt"],
      },
      tt: text("tt", "Toggle"),
      agentBtn: {
        id: "agentBtn",
        type: "box",
        onPress: { kind: "agent", name: "go" },
        children: ["at"],
      },
      at: text("at", "Agent"),
    });

  it("markup is byte-identical whether onRecord is omitted or supplied", () => {
    const without = renderToStaticMarkup(createElement(StageRenderer, { tree: navToggleTree() }));
    const withRecord = renderToStaticMarkup(
      createElement(StageRenderer, { tree: navToggleTree(), onRecord: () => {} }),
    );
    expect(withRecord).toBe(without);
    // The agent-tap box still renders exactly as before (a button) — onRecord
    // does not touch the agent-routed path.
    expect(withRecord).toContain('role="button"');
    expect(withRecord).toContain("Agent");
  });
});

// Screens are named roots into the same flat nodes map; a screenless tree is the
// single-screen form. The raw live-patch path bypasses validateTree, so garbage
// screens/entry/hidden must degrade to a plain render — never throw.
describe("StageRenderer screens + hidden (static)", () => {
  it("renders ONLY the entry screen's content for a screens tree", () => {
    const out = render({
      root: "root",
      nodes: {
        root: box("root", ["rt"]),
        rt: text("rt", "plain root content"),
        home: box("home", ["h"]),
        h: text("h", "home content"),
        about: box("about", ["a"]),
        a: text("a", "about content"),
      },
      screens: { home: "home", about: "about" },
      entry: "home",
    });
    expect(out).toContain("home content");
    expect(out).not.toContain("about content");
    expect(out).not.toContain("plain root content");
  });

  it("renders a screenless tree from root exactly as before", () => {
    const plain = tree({ root: box("root", ["t"]), t: text("t", "single screen") });
    expect(render(plain)).toContain("single screen");
  });

  it("omits a hidden: true box from the output", () => {
    const out = render(
      tree({
        root: box("root", ["shown", "menu"]),
        shown: text("shown", "visible line"),
        menu: { id: "menu", type: "box", hidden: true, children: ["m"] },
        m: text("m", "secret menu"),
      }),
    );
    expect(out).toContain("visible line");
    expect(out).not.toContain("secret menu");
  });

  it("only literal true hides — a hidden patched to a non-boolean stays visible", () => {
    const noisy = {
      root: box("root", ["p"]),
      p: { id: "p", type: "box", hidden: "yes", children: ["t"] },
      t: text("t", "still shown"),
    } as unknown as Record<NodeId, FacetNode>;
    expect(render(tree(noisy))).toContain("still shown");
  });

  it("never throws on garbage screens/entry on the raw path (falls back to root)", () => {
    const nodes = { root: box("root", ["t"]), t: text("t", "root fallback") };
    const junkTrees = [
      { root: "root", nodes, screens: "not an object", entry: "x" },
      { root: "root", nodes, screens: 42 },
      { root: "root", nodes, screens: null },
      { root: "root", nodes, screens: { a: 99, b: null, c: {} }, entry: "a" },
      { root: "root", nodes, screens: { a: "missingNode" }, entry: 7 },
      { root: "root", nodes, screens: {}, entry: "a" },
    ] as unknown as FacetTree[];
    for (const junk of junkTrees) {
      expect(() => render(junk)).not.toThrow();
      expect(render(junk)).toContain("root fallback");
    }
  });
});

// Appear (DC-001/DC-005): a classifiable appear token maps to a class name and
// gates ONE per-stage <style> element (detected during the budget-bounded render
// walk — reachable nodes only); token-free trees carry no style element or class
// attribute beyond the renderer's containment guard, and raw-path junk —
// including cyclic trees and null/scalar node VALUES in the nodes record —
// renders plain, never throws or hangs.
describe("StageRenderer appear (static)", () => {
  it("renders the appear class and a single style element for appear tokens", () => {
    const out = render(
      tree({
        root: { id: "root", type: "box", style: { appear: "fade" }, children: ["s", "t"] },
        s: { id: "s", type: "box", style: { appear: "slide" }, children: [] },
        t: text("t", "animated"),
      }),
    );
    expect(out).toContain('class="facet-appear-fade"');
    expect(out).toContain('class="facet-appear-slide"');
    expect(out).toContain("@keyframes facet-appear-fade");
    // Once per stage, no matter how many nodes use appear.
    expect(out.match(/<style/g)).toHaveLength(1);
  });

  it("renders the appear class on a pressable (role=button) box", () => {
    // FIX-B: the press-only branch must thread className exactly like the
    // plain branch — an appear token on an interactive box must not vanish.
    const out = render(
      tree({
        root: {
          id: "root",
          type: "box",
          style: { appear: "slide" },
          onPress: { kind: "agent", name: "go" },
          children: ["t"],
        },
        t: text("t", "press me"),
      }),
    );
    expect(out).toContain('role="button"');
    expect(out).toContain('class="facet-appear-slide"');
    expect(out.match(/<style/g)).toHaveLength(1);
  });

  it("renders an explicit appear:'none' with no class and no style element", () => {
    const out = render(
      tree({
        root: { id: "root", type: "box", style: { appear: "none" }, children: ["t"] },
        t: text("t", "instant"),
      }),
    );
    expect(out).toContain("instant");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("<style");
  });

  it("keeps a token-free tree free of appear CSS while retaining containment", () => {
    const plain = tree({
      root: { id: "root", type: "box", children: ["t", "f"] },
      t: text("t", "hello"),
      f: { id: "f", type: "field", name: "email", label: "Email" },
    });
    const out = render(plain);
    expect(out).not.toContain("<style");
    expect(out).not.toContain("class=");
    // The exact-markup pin for a plain box — className={undefined} must add
    // nothing, while root containment remains part of the renderer contract.
    expect(render(tree({ root: { id: "root", type: "box", children: [] } }))).toBe(
      '<div style="display:flex;flex-direction:column;box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere"></div>',
    );
  });

  it("renders raw-path junk (appear:'explode', onHold:42, scroll:'sideways') plain, never throws", () => {
    const junkRoot = {
      id: "root",
      type: "box",
      style: { appear: "explode", scroll: "sideways" },
      onHold: 42,
      children: ["t"],
    } as unknown as FacetNode;
    const junkTree = tree({ root: junkRoot, t: text("t", "still up") });
    expect(() => render(junkTree)).not.toThrow();
    const out = render(junkTree);
    expect(out).toContain("still up");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("<style");
    expect(out).not.toContain('role="button"'); // junk onHold never makes a button
  });

  it("server-renders a valid onHold box (HoldableBox) without touching window", () => {
    // The static suite is the SSR contract: HoldableBox's render body must stay
    // free of window/document access (the interceptor arms only inside the
    // hold-timer callback), or every server render of an onHold tree throws.
    const held = tree({
      root: { id: "root", type: "box", children: ["h"] },
      h: { id: "h", type: "box", onHold: { kind: "agent", name: "peek" }, children: ["t"] },
      t: text("t", "hold me"),
    });
    expect(() => render(held)).not.toThrow();
    const out = render(held);
    expect(out).toContain("hold me");
    expect(out).toContain('role="button"'); // holdable ⇒ interactive markup
    // iOS long-press affordances: a holdable box disables text selection and
    // the native long-press callout so the gesture runs the hold, not a
    // selection / share sheet (review r6). Press-only and plain boxes must NOT
    // carry these (asserted below).
    expect(out).toContain("user-select:none");
    expect(out).toContain("-webkit-touch-callout:none");
  });

  it("does not add hold-only CSS to press-only or plain boxes", () => {
    const pressOnly = tree({
      root: { id: "root", type: "box", children: ["b"] },
      b: { id: "b", type: "box", onPress: { kind: "agent", name: "open" }, children: ["t"] },
      t: text("t", "press me"),
    });
    const pressOut = render(pressOnly);
    expect(pressOut).toContain('role="button"');
    expect(pressOut).not.toContain("user-select:none");
    expect(pressOut).not.toContain("-webkit-touch-callout");
    // A plain box carries no interactivity CSS at all.
    const plain = render(tree({ root: { id: "root", type: "box", children: [] } }));
    expect(plain).toBe(
      '<div style="display:flex;flex-direction:column;box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere"></div>',
    );
  });

  it("renders a CYCLIC raw tree containing an appear token without hanging or throwing", () => {
    const cyclic = tree({
      root: box("root", ["a"]),
      a: { id: "a", type: "box", style: { appear: "slide" }, children: ["root", "t"] },
      t: text("t", "cycled once"),
    });
    expect(() => render(cyclic)).not.toThrow();
    const out = render(cyclic);
    expect(out).toContain("cycled once");
    expect(out).toContain('class="facet-appear-slide"');
    expect(out.match(/<style/g)).toHaveLength(1);
  });

  it("ignores appear on raw-path text/media/field styles (appear is BoxStyle-only)", () => {
    // validateTree strips appear from non-box styles, so the raw unvalidated
    // path must render identically: no class on <p>/<img>/<label> and no
    // appear <style> element for a tree whose only appear tokens sit on
    // non-box nodes.
    const noisy = {
      root: box("root", ["t", "i", "f"]),
      t: { id: "t", type: "text", value: "plain text", style: { appear: "fade" } },
      i: {
        id: "i",
        type: "media",
        kind: "image",
        src: "https://example.com/a.png",
        alt: "pic",
        style: { appear: "fade" },
      },
      f: { id: "f", type: "field", name: "n", placeholder: "p", style: { appear: "fade" } },
    } as unknown as Record<NodeId, FacetNode>;
    const out = render(tree(noisy));
    expect(out).toContain("plain text");
    expect(out).toContain("<img");
    expect(out).toContain("<input");
    expect(out).not.toContain("facet-appear");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("<style");

    // Positive control: the same token on a BOX still gets class + stylesheet.
    const withBox = render(
      tree({
        root: { id: "root", type: "box", style: { appear: "fade" }, children: [] },
      }),
    );
    expect(withBox).toContain('class="facet-appear-fade"');
    expect(withBox.match(/<style/g)).toHaveLength(1);
  });

  it("renders a raw tree with NULL and SCALAR node values alongside an appear node without throwing", () => {
    // Legal on the live path: a patch can set any node value to JSON null (or a
    // scalar) — isTreeShaped only checks that `nodes` is an object. renderNode's
    // own `node == null` / unknown-type guards skip the junk values; the
    // reachable appear box still emits the stylesheet.
    const noisy = tree({
      root: box("root", ["x", "n", "s"]),
      x: { id: "x", type: "box", style: { appear: "fade" }, children: ["t"] },
      t: text("t", "guarded"),
      n: null as unknown as FacetNode,
      s: 42 as unknown as FacetNode,
    });
    expect(() => render(noisy)).not.toThrow();
    const out = render(noisy);
    expect(out).toContain("guarded");
    expect(out).toContain('class="facet-appear-fade"');
    expect(out.match(/<style/g)).toHaveLength(1);
  });

  it("does not emit the appear stylesheet for an UNREACHABLE appear node (review r7)", () => {
    // Appear detection rides the budget-bounded render walk, not a scan of the
    // whole node map: an appear token on a node that root never reaches renders
    // nothing and must NOT force a <style> (also the fail-safe against a huge
    // map of unreachable/dangling nodes re-triggering an O(N) per-render scan).
    const out = render(
      tree({
        root: box("root", ["shown"]),
        shown: text("shown", "visible"),
        orphan: { id: "orphan", type: "box", style: { appear: "fade" }, children: [] },
      }),
    );
    expect(out).toContain("visible");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("facet-appear");
  });
});

// onViewSnapshot (WU-3, DC-001): the renderer publishes its live view snapshot
// read-only via the optional callback, sampled after commit. A navigate press
// updates `screen`; a toggle press updates `toggled` — both surface through the
// callback without lifting the renderer's private state. Needs the client
// render path (effects), so these use @testing-library/react, not the static
// string renderer above.
describe("StageRenderer onViewSnapshot (jsdom)", () => {
  afterEach(cleanup);

  const screensTree = (): FacetTree => ({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["rootText"] },
      rootText: { id: "rootText", type: "text", value: "plain root content" },
      home: { id: "home", type: "box", children: ["homeText", "goAbout"] },
      homeText: { id: "homeText", type: "text", value: "home content" },
      goAbout: {
        id: "goAbout",
        type: "box",
        onPress: { kind: "navigate", to: "about" },
        children: [],
      },
      about: { id: "about", type: "box", children: ["aboutText"] },
      aboutText: { id: "aboutText", type: "text", value: "about content" },
    },
    screens: { home: "home", about: "about" },
    entry: "home",
  });

  const lastSnapshot = (onViewSnapshot: ReturnType<typeof vi.fn>): ViewSnapshot =>
    onViewSnapshot.mock.calls.at(-1)?.[0] as ViewSnapshot;

  it("publishes the updated screen after a navigate press", () => {
    const onViewSnapshot = vi.fn();
    mountClient(createElement(StageRenderer, { tree: screensTree(), onViewSnapshot }));

    // Fires once on mount with the initial (entry) snapshot.
    expect(onViewSnapshot).toHaveBeenCalled();
    onViewSnapshot.mockClear();

    fireEvent.click(screen.getByRole("button"));

    expect(onViewSnapshot).toHaveBeenCalled();
    expect(lastSnapshot(onViewSnapshot).screen).toBe("about");
  });

  it("publishes the updated toggled record after a toggle press", () => {
    const onViewSnapshot = vi.fn();
    mountClient(
      createElement(StageRenderer, {
        onViewSnapshot,
        tree: tree({
          root: box("root", ["btn", "panel"]),
          btn: { id: "btn", type: "box", onPress: { kind: "toggle", target: "panel" }, children: [] },
          panel: box("panel", ["p"]),
          p: text("p", "panel content"),
        }),
      }),
    );
    onViewSnapshot.mockClear();

    fireEvent.click(screen.getByRole("button"));

    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ panel: "hidden" });
  });
});

// DC-005 structural fence: the only stage-write setters live inside handlePress.
// No ServerMessage/patch path may write view state, so `setCurrentScreen(` and
// `setVisibilityOverrides(` must appear ONLY within the handlePress body — read
// the source as text and prove no call site exists outside it.
describe("StageRenderer view-state setter fence (DC-005)", () => {
  it("setCurrentScreen/setVisibilityOverrides are called only within handlePress", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "StageRenderer.tsx"),
      "utf8",
    );
    const start = src.indexOf("const handlePress");
    const end = src.indexOf("const appearSeen", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const body = src.slice(start, end);
    const outside = src.slice(0, start) + src.slice(end);
    for (const setter of ["setCurrentScreen(", "setVisibilityOverrides("]) {
      expect(body).toContain(setter);
      expect(outside).not.toContain(setter);
    }
  });
});
