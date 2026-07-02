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
      children: ["agent-btn", "legacy-btn", "nav-btn", "toggle-btn", "menu"],
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
});
