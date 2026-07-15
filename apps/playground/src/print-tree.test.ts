import { describe, expect, it, vi } from "vitest";
import type { FacetTree } from "@facet/core";
import { printTree } from "./print-tree.js";

/** Runs printTree and captures each printed line. */
function lines(tree: FacetTree): readonly string[] {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    printTree(tree);
    return spy.mock.calls.map((call) => String(call[0]));
  } finally {
    spy.mockRestore();
  }
}

const tree: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      children: ["agent-btn", "legacy-btn", "nav-btn", "toggle-btn", "menu", "hold-btn"],
    },
    "agent-btn": {
      id: "agent-btn",
      type: "box",
      onPress: { kind: "agent", name: "view_pricing" },
      children: [],
    },
    "legacy-btn": {
      id: "legacy-btn",
      type: "box",
      onPress: { name: "legacy_action" },
      children: [],
    },
    "nav-btn": {
      id: "nav-btn",
      type: "box",
      onPress: { kind: "navigate", to: "about" },
      children: [],
    },
    "toggle-btn": {
      id: "toggle-btn",
      type: "box",
      onPress: { kind: "toggle", target: "menu" },
      children: [],
    },
    menu: { id: "menu", type: "box", hidden: true, children: [] },
    clip: {
      id: "clip",
      type: "media",
      kind: "video",
      src: "https://example.com/clip.mp4",
      controls: true,
    },
    "hold-btn": {
      id: "hold-btn",
      type: "box",
      onPress: { kind: "agent", name: "open_card" },
      onHold: { kind: "toggle", target: "menu" },
      children: [],
    },
  },
};

describe("printTree", () => {
  it("labels navigate and toggle presses by kind", () => {
    const out = lines(tree);
    expect(out).toContain("  box [→ screen:about]");
    expect(out).toContain("  box [⇄ menu]");
  });

  it("labels agent presses (explicit and legacy bare-name) with the action name", () => {
    const out = lines(tree);
    expect(out).toContain("  box [→ view_pricing]");
    expect(out).toContain("  box [→ legacy_action]");
  });

  it("marks hidden nodes", () => {
    const out = lines(tree);
    expect(out).toContain("  box (hidden)");
  });

  it("labels the onHold gesture alongside onPress", () => {
    const out = lines(tree);
    expect(out).toContain("  box [→ open_card] [hold ⇄ menu]");
  });

  it("prints an input node with its name", () => {
    const out = lines({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["q"] },
        q: { id: "q", type: "input", name: "email", placeholder: "you@example.com" },
      },
    });
    expect(out).toContain("  input: email");
  });

  it("prints media kind and src", () => {
    const out = lines({
      ...tree,
      nodes: {
        ...tree.nodes,
        root: { id: "root", type: "box", children: ["clip"] },
      },
    });
    expect(out).toContain("  media(video): https://example.com/clip.mp4");
  });

  it("does not special-case retired container node types", () => {
    for (const retired of ["section", "card", "emptyState"] as const) {
      const out = lines({
        root: "retired",
        nodes: {
          retired: {
            id: "retired",
            type: retired,
            eyebrow: "Legacy",
            title: "Retired pattern",
            body: "No longer native",
            actionLabel: "Act",
            children: ["child"],
            onPress: { name: "press_retired" },
            onHold: { name: "hold_retired" },
          },
          child: { id: "child", type: "text", value: "must not be walked" },
        },
      } as unknown as FacetTree);

      expect(out).toEqual([retired]);
    }
  });

  it("prints native boxes text and buttons plus surviving components", () => {
    const out = lines({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          children: [
            "heading",
            "summary",
            "button",
            "tabs",
            "nav",
            "table",
            "chart",
            "metric",
            "keyValue",
            "progress",
            "list",
            "form",
            "filterBar",
            "empty",
            "loading",
          ],
        },
        heading: { id: "heading", type: "text", value: "Catalog / Overview" },
        summary: {
          id: "summary",
          type: "box",
          onPress: { kind: "agent", name: "open_revenue" },
          children: ["summary-copy", "stat"],
        },
        "summary-copy": {
          id: "summary-copy",
          type: "text",
          value: "Revenue / Quarterly snapshot",
        },
        stat: { id: "stat", type: "stat", label: "ARR", value: "$1M", delta: "+5%" },
        button: { id: "button", type: "button", label: "Refresh", onPress: { name: "refresh" } },
        tabs: {
          id: "tabs",
          type: "tabs",
          items: [
            { label: "Home", to: "home" },
            { label: "Settings", to: "settings" },
          ],
        },
        nav: {
          id: "nav",
          type: "nav",
          items: [
            { label: "Customers", to: "customers" },
            { label: "Reports", to: "reports" },
          ],
        },
        table: {
          id: "table",
          type: "table",
          caption: "Pipeline",
          columns: [
            { key: "name", label: "Name" },
            { key: "value", label: "Value" },
          ],
          rows: [{ name: "ACME", value: 1200 }],
        },
        chart: {
          id: "chart",
          type: "chart",
          kind: "bar",
          title: "Trend",
          labels: ["Jan", "Feb"],
          series: [{ label: "Revenue", values: [1, 2] }],
        },
        metric: { id: "metric", type: "metric", label: "MRR", value: "$10k" },
        keyValue: {
          id: "keyValue",
          type: "keyValue",
          items: [
            { label: "Plan", value: "Pro" },
            { label: "Owner", value: "Ada" },
          ],
        },
        progress: { id: "progress", type: "progress", label: "Onboarding", value: 64 },
        list: {
          id: "list",
          type: "list",
          items: [{ title: "One" }, { title: "Two", body: "Second item" }],
        },
        form: {
          id: "form",
          type: "form",
          title: "Lead",
          children: ["input"],
        },
        input: { id: "input", type: "input", name: "q", placeholder: "Search" },
        filterBar: {
          id: "filterBar",
          type: "filterBar",
          filters: [{ name: "status", label: "Status", options: ["Open"] }],
        },
        empty: {
          id: "empty",
          type: "box",
          children: ["empty-copy", "empty-action"],
        },
        "empty-copy": {
          id: "empty-copy",
          type: "text",
          value: "No results / Try another query",
        },
        "empty-action": {
          id: "empty-action",
          type: "button",
          label: "Clear filters",
          onPress: { name: "clear_filters" },
        },
        loading: { id: "loading", type: "loading", label: "Loading customers" },
      },
    });

    expect(out).toEqual([
      "box",
      '  text: "Catalog / Overview"',
      "  box [→ open_revenue]",
      '    text: "Revenue / Quarterly snapshot"',
      "    stat: ARR = $1M (+5%)",
      '  button: "Refresh" [→ refresh]',
      "  tabs: 2 tabs",
      "  nav: 2 items",
      '  table: "Pipeline" (2 columns, 1 row)',
      '  chart(bar): "Trend" (1 series, 2 labels)',
      "  metric: MRR = $10k",
      "  keyValue: 2 items",
      "  progress: Onboarding 64%",
      "  list: 2 items",
      '  form: "Lead" (1 child)',
      "    input: q",
      "  filterBar: 1 filter",
      "  box",
      '    text: "No results / Try another query"',
      '    button: "Clear filters" [→ clear_filters]',
      '  loading: "Loading customers"',
    ]);
  });
});
