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

  it("prints high-level nodes with labels and counts while walking section and card children", () => {
    const out = lines({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "section",
          eyebrow: "Catalog",
          title: "Overview",
          children: [
            "card",
            "button",
            "tabs",
            "table",
            "chart",
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
          body: "Quarterly snapshot",
          tone: "success",
          onPress: { kind: "agent", name: "open_revenue" },
          children: ["stat", "badge"],
        },
        stat: { id: "stat", type: "stat", label: "ARR", value: "$1M", delta: "+5%" },
        badge: { id: "badge", type: "badge", label: "Live", tone: "success" },
        button: { id: "button", type: "button", label: "Refresh", onPress: { name: "refresh" } },
        tabs: {
          id: "tabs",
          type: "tabs",
          items: [
            { label: "Home", to: "home" },
            { label: "Settings", to: "settings" },
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
        progress: { id: "progress", type: "progress", label: "Onboarding", value: 64 },
        alert: {
          id: "alert",
          type: "alert",
          title: "Heads up",
          body: "Check setup",
          tone: "warning",
        },
        list: {
          id: "list",
          type: "list",
          items: [{ title: "One" }, { title: "Two", body: "Second item" }],
        },
        divider: { id: "divider", type: "divider", label: "Next" },
      },
    });

    expect(out).toEqual([
      'section: "Catalog / Overview" (9 children)',
      '  card: "Revenue" (2 children) [→ open_revenue]',
      "    stat: ARR = $1M (+5%)",
      '    badge: "Live"',
      '  button: "Refresh" [→ refresh]',
      "  tabs: 2 tabs",
      '  table: "Pipeline" (2 columns, 1 row)',
      '  chart(bar): "Trend" (1 series, 2 labels)',
      "  progress: Onboarding 64%",
      '  alert: "Heads up" - Check setup',
      "  list: 2 items",
      '  divider: "Next"',
    ]);
  });
});
