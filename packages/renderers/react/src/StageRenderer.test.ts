import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { brickRendererEntry } from "./brick-render-registry.js";
import { StageRenderer } from "./StageRenderer.js";
import * as stageRendererExports from "./StageRenderer.js";
import * as rendererSafeExports from "./renderer-safe.js";

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
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
const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({
  id,
  type: "box",
  children,
});

describe("StageRenderer module boundary", () => {
  it("contains no intrinsic renderer limit", () => {
    expect(rendererSafeExports).not.toHaveProperty("MAX_INTRINSIC_ITEMS");
  });

  it("keeps the exact runtime export surface", () => {
    expect(Object.keys(stageRendererExports).sort()).toEqual(["StageRenderer"]);
  });
});

describe("StageRenderer fail-safe boundary", () => {
  it("keeps valid siblings when nested style data is hostile", () => {
    const hostileState = new Proxy(
      { background: "danger" },
      {
        getOwnPropertyDescriptor() {
          throw new Error("nested style boom");
        },
      },
    );
    const hostileStyle = new Proxy(
      {
        preset: "missing",
        background: "accent",
        hover: hostileState,
        unknownTarget: { cssText: "position:absolute" },
      },
      {
        ownKeys() {
          throw new Error("style enumeration boom");
        },
      },
    );
    const raw = tree({
      root: box("root", ["hostile", "valid"]),
      hostile: {
        id: "hostile",
        type: "box",
        style: hostileStyle,
        children: ["hostile-copy"],
      } as unknown as FacetNode,
      "hostile-copy": text("hostile-copy", "Hostile style content survives"),
      valid: {
        id: "valid",
        type: "text",
        value: "Valid sibling survives",
        style: { color: "success" },
      },
    });

    expect(() => render(raw)).not.toThrow();
    const out = render(raw);
    expect(out).toContain("Hostile style content survives");
    expect(out).toContain("Valid sibling survives");
    expect(out).not.toContain("position:absolute");
  });

  it("renders nothing for null primitive and unresolved-root trees", () => {
    expect(render(null as unknown as FacetTree)).toBe("");
    expect(render("not a tree" as unknown as FacetTree)).toBe("");
    expect(render(42 as unknown as FacetTree)).toBe("");
    expect(render(tree({ orphan: text("orphan", "orphan") }, "missing"))).toBe("");
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

  it("skips retired unknown and prototype-name subtrees", () => {
    const retiredTypes = ["button", "tabs", "nav", "form", "constructor", "toString"];
    const nodes: Record<NodeId, FacetNode> = {
      root: box("root", [...retiredTypes, "valid"]),
      valid: text("valid", "Valid sibling survives"),
    };
    for (const type of retiredTypes) {
      nodes[type] = { id: type, type, children: [`${type}-child`] } as unknown as FacetNode;
      nodes[`${type}-child`] = text(`${type}-child`, `Hidden ${type} child`);
      expect(brickRendererEntry(type)).toBeUndefined();
    }

    const out = render(tree(nodes));
    expect(out).toContain("Valid sibling survives");
    expect(out.match(/<p/g)).toHaveLength(1);
    for (const type of retiredTypes) expect(out).not.toContain(`Hidden ${type} child`);
  });

  it("skips dangling null and scalar children", () => {
    const raw = {
      root: "root",
      nodes: {
        root: box("root", ["dangling", "null", "scalar", "valid"]),
        null: null,
        scalar: 42,
        valid: text("valid", "still here"),
      },
    } as unknown as FacetTree;

    expect(() => render(raw)).not.toThrow();
    const out = render(raw);
    expect(out).toContain("still here");
  });

  it("renders a box with a non-array children value as an empty safe box", () => {
    const broken = { id: "root", type: "box", children: "oops" } as unknown as FacetNode;
    const out = render(tree({ root: broken }));
    expect(out).toContain("<div");
    expect(out).not.toContain("oops");
  });

  it("skips a text node whose value is not renderable", () => {
    const badText = {
      id: "bad",
      type: "text",
      value: { nested: true },
    } as unknown as FacetNode;
    expect(render(tree({ root: box("root", ["bad"]), bad: badText }))).not.toContain("[object");
  });

  it("breaks direct and self cycles while retaining reachable content", () => {
    const direct = tree({
      root: box("root", ["child"]),
      child: box("child", ["root", "copy"]),
      copy: text("copy", "once"),
    });
    const self = tree({ root: box("root", ["root", "copy"]), copy: text("copy", "safe") });
    expect(render(direct)).toContain("once");
    expect(render(self)).toContain("safe");
  });

  it("truncates excessive depth and remains transition-safe", () => {
    const nodes: Record<NodeId, FacetNode> = {};
    for (let i = 0; i < 140; i += 1) {
      nodes[`n${String(i)}`] = box(`n${String(i)}`, [`n${String(i + 1)}`]);
    }
    nodes.n140 = text("n140", "too deep");
    const deep = tree(nodes, "n0");
    expect(() => render(deep)).not.toThrow();
    expect(render(deep)).not.toContain("too deep");
    expect(() => renderWithTransition(deep)).not.toThrow();
  });

  it("degrades a hostile active predicate to the base look", () => {
    const predicate = new Proxy(
      {},
      {
        has() {
          throw new Error("predicate boom");
        },
      },
    );
    const raw = tree({
      root: {
        id: "root",
        type: "box",
        activeWhen: predicate,
        style: {
          background: "surface",
          active: { background: "dangerSurface" },
        },
        children: ["copy"],
      } as unknown as FacetNode,
      copy: text("copy", "base survives"),
    });

    expect(() => render(raw)).not.toThrow();
    expect(render(raw)).toContain("background:#f8fafc");
  });
});

describe("StageRenderer central style resolution", () => {
  it("resolves Theme default then Preset then direct style", () => {
    const out = render(
      tree({
        root: {
          id: "root",
          type: "box",
          style: { preset: "panel", background: "successSurface" },
          children: ["heading"],
        },
        heading: {
          id: "heading",
          type: "text",
          value: "Resolved",
          style: { preset: "heading", color: "success" },
        },
      }),
    );

    expect(out).toContain("background:#dcfce7");
    expect(out).toContain("padding:16px");
    expect(out).toContain("font-size:36px");
    expect(out).toContain("color:#15803d");
  });

  it("uses default plus valid direct choices when a Preset is unknown", () => {
    const out = render(
      tree({
        root: box("root", ["copy"]),
        copy: {
          id: "copy",
          type: "text",
          value: "Fallback",
          style: { preset: "missing", color: "success" },
        } as unknown as FacetNode,
      }),
    );
    expect(out).toContain("Fallback");
    expect(out).toContain("color:#15803d");
  });

  it("ignores unknown targets and properties", () => {
    const raw = tree({
      root: {
        id: "root",
        type: "box",
        style: {
          color: "foreground",
          arbitraryTarget: { cssText: "position:fixed" },
        },
        children: [],
      } as unknown as FacetNode,
    });
    const out = render(raw);
    expect(out).toContain("color:#172033");
    expect(out).not.toContain("position:fixed");
  });

  it("applies style.active only when activeWhen matches the local view", () => {
    const activeTree = {
      root: "root",
      screens: { home: "root" },
      entry: "home",
      nodes: {
        root: {
          id: "root",
          type: "box",
          activeWhen: { screen: "home" },
          style: { background: "surface", active: { background: "dangerSurface" } },
          children: ["copy"],
        },
        copy: text("copy", "active"),
      },
    } as FacetTree;
    expect(render(activeTree)).toContain("background:#fee2e2");
  });

  it("renders a pressable box without changing its Brick identity", () => {
    const out = render(
      tree({
        root: {
          id: "root",
          type: "box",
          onPress: { kind: "agent", name: "save" },
          children: ["label"],
        },
        label: text("label", "Save"),
      }),
    );
    expect(out).toContain('role="button"');
    expect(out).toContain("Save");
  });
});

describe("StageRenderer tree traversal", () => {
  it("renders a duplicated sibling only once", () => {
    const out = render(tree({ root: box("root", ["child", "child"]), child: text("child", "x") }));
    expect(out.match(/>x<\/p>/g)).toHaveLength(1);
  });

  it("renders only the entry screen and respects literal hidden true", () => {
    const screened: FacetTree = {
      root: "fallback",
      screens: { home: "homeRoot", settings: "settingsRoot" },
      entry: "home",
      nodes: {
        fallback: text("fallback", "fallback"),
        homeRoot: box("homeRoot", ["home", "hidden"]),
        home: text("home", "Home"),
        hidden: { id: "hidden", type: "box", hidden: true, children: ["hiddenCopy"] },
        hiddenCopy: text("hiddenCopy", "Hidden"),
        settingsRoot: box("settingsRoot", ["settings"]),
        settings: text("settings", "Settings"),
      },
    };
    const out = render(screened);
    expect(out).toContain("Home");
    expect(out).not.toContain("Hidden");
    expect(out).not.toContain("Settings");
    expect(out).not.toContain("fallback");
  });

  it("keeps onRecord render-inert", () => {
    const value = tree({ root: box("root", ["copy"]), copy: text("copy", "same") });
    const without = renderToStaticMarkup(createElement(StageRenderer, { tree: value }));
    const withRecord = renderToStaticMarkup(
      createElement(StageRenderer, { tree: value, onRecord: () => {} }),
    );
    expect(withRecord).toBe(without);
  });
});

describe("StageRenderer enter animation", () => {
  it("maps the closed enterAnimation choice and emits one animation stylesheet", () => {
    const out = render(
      tree({
        root: box("root", ["fade", "slide"]),
        fade: { id: "fade", type: "box", style: { enterAnimation: "fade" }, children: [] },
        slide: { id: "slide", type: "box", style: { enterAnimation: "slide" }, children: [] },
      }),
    );
    expect(out).toMatch(/class="[^"]*\bfacet-appear-fade\b[^"]*"/);
    expect(out).toMatch(/class="[^"]*\bfacet-appear-slide\b[^"]*"/);
    expect(out.match(/@keyframes facet-appear-fade/g)).toHaveLength(1);
    expect(out.match(/@keyframes facet-appear-slide/g)).toHaveLength(1);
    // One centralized interaction-state sheet is unconditional; the second
    // sheet is the reachable enter-animation sheet under test.
    expect(out.match(/<style/g)).toHaveLength(2);
  });

  it("ignores an unknown raw choice and an unreachable animation", () => {
    const raw = {
      root: "root",
      nodes: {
        root: box("root", ["junk"]),
        junk: {
          id: "junk",
          type: "box",
          style: { enterAnimation: "explode" },
          children: [],
        },
        unreachable: {
          id: "unreachable",
          type: "box",
          style: { enterAnimation: "fade" },
          children: [],
        },
      },
    } as unknown as FacetTree;
    const out = render(raw);
    expect(out).not.toContain("facet-appear-");
    expect(out).not.toContain("@keyframes facet-appear");
    expect(out.match(/<style/g)).toHaveLength(1);
  });
});
