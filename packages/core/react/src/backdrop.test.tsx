// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup } from "@testing-library/react";
import { MAX_RENDER_NODES, type FacetNode, type FacetTree, type NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
}

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

const SAFE_SRC = "https://cdn.example.com/hero.jpg";
const media = (id: NodeId, src: string = SAFE_SRC): FacetNode =>
  ({ id, type: "media", kind: "image", src }) as FacetNode;
const box = (id: NodeId, extra: Partial<Record<string, unknown>> = {}): FacetNode =>
  ({ id, type: "box", children: [], ...extra }) as FacetNode;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// The renderer is the fail-safe boundary (invariant #2). Every case below reaches
// it WITHOUT passing validateTree (the raw live-patch path), so a malformed
// `backdrop` must degrade to "no layer" and NEVER throw or recurse.

// ── DC-001 hero renders ──────────────────────────────────────────────────────
describe("backdrop hero render (DC-001)", () => {
  it("paints the backdrop as a bg cover layer with flow children on top, scrim, display size + highlight", () => {
    const markup = render(
      tree({
        root: {
          id: "root",
          type: "box",
          backdrop: "bg",
          style: { minHeight: "screen", backdropScrim: "dark" },
          children: ["headline"],
        } as unknown as FacetNode,
        bg: media("bg"),
        headline: {
          id: "headline",
          type: "text",
          value: "Ship faster",
          style: { size: "5xl", highlight: "band" },
        } as unknown as FacetNode,
      }),
    );

    // The backdrop is painted through the SAFE media path as a real cover <img>.
    expect(markup).toContain(`src="${SAFE_SRC}"`);
    expect(markup).toContain("object-fit:cover");
    // The synthesized cover layer is the only absolutely-positioned element;
    // the host box is position:relative so the layer is contained.
    expect(markup).toContain("position:absolute");
    expect(markup).toContain("position:relative");
    // The readability scrim tint is painted over the backdrop layer.
    expect(markup).toContain("rgba(0, 0, 0, 0.5)");
    // The min-height display token resolved to its section-scale value.
    expect(markup).toContain("min-height:100svh");
    // The flow child renders ON TOP: the headline copy at display size with a
    // highlight band behind the run.
    expect(markup).toContain("Ship faster");
    expect(markup).toContain("font-size:80px");
    expect(markup).toContain("linear-gradient(transparent 55%, #fde68a 55%)");
  });

  it("swaps the subtree color map for scheme:dark (bounded, restored by a nested light island)", () => {
    const markup = render(
      tree({
        root: {
          id: "root",
          type: "box",
          style: { scheme: "dark" },
          children: ["dark-copy", "light-island"],
        } as unknown as FacetNode,
        "dark-copy": {
          id: "dark-copy",
          type: "text",
          value: "on dark",
          style: { color: "fg" },
        } as unknown as FacetNode,
        "light-island": {
          id: "light-island",
          type: "box",
          style: { scheme: "light" },
          children: ["light-copy"],
        } as unknown as FacetNode,
        "light-copy": {
          id: "light-copy",
          type: "text",
          value: "on light",
          style: { color: "fg" },
        } as unknown as FacetNode,
      }),
    );

    // scheme:dark flips the child color map: `fg` resolves to the dark palette.
    expect(markup).toContain("color:#f5f5f7");
    // A nested scheme:light island restores the light palette for its subtree.
    expect(markup).toContain("color:#1a1d23");
  });
});

// ── DC-003 fail-safe ─────────────────────────────────────────────────────────
describe("backdrop fail-safe (DC-003)", () => {
  it("paints NO layer and never throws for a dangling backdrop id", () => {
    let markup = "";
    expect(() => {
      markup = render(
        tree({
          root: { id: "root", type: "box", backdrop: "ghost", children: [] } as unknown as FacetNode,
        }),
      );
    }).not.toThrow();
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("position:absolute");
    // No backdrop resolved ⇒ no synthesized host wrapping.
    expect(markup).not.toContain("position:relative");
  });

  it("paints NO layer when the backdrop resolves to a non-media node", () => {
    const markup = render(
      tree({
        root: {
          id: "root",
          type: "box",
          backdrop: "not-media",
          children: [],
        } as unknown as FacetNode,
        "not-media": { id: "not-media", type: "text", value: "I am text" } as unknown as FacetNode,
      }),
    );
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("position:absolute");
  });

  it("paints NO layer when the resolved media has an unsafe src", () => {
    const markup = render(
      tree({
        root: {
          id: "root",
          type: "box",
          backdrop: "danger",
          children: [],
        } as unknown as FacetNode,
        danger: media("danger", "javascript:alert(1)"),
      }),
    );
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("javascript:alert(1)");
    expect(markup).not.toContain("position:absolute");
  });

  it("never recurses/throws for a self-cycle or a backdrop→box→backdrop loop", () => {
    // A box whose backdrop points at itself, and a mutual backdrop loop between
    // two boxes: `backdrop` resolves to a MEDIA node only (containers are never
    // recursed into), so neither paints a layer and neither can loop forever.
    let markup = "";
    expect(() => {
      markup = render(
        tree({
          root: { id: "root", type: "box", backdrop: "root", children: ["a"] } as unknown as FacetNode,
          a: { id: "a", type: "box", backdrop: "b", children: [] } as unknown as FacetNode,
          b: { id: "b", type: "box", backdrop: "a", children: [] } as unknown as FacetNode,
        }),
      );
    }).not.toThrow();
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("position:absolute");
  });

  it("counts the resolved backdrop against the render budget (cannot escape MAX_RENDER_NODES)", () => {
    // Each child box carries a backdrop pointing at one shared safe media node.
    // If backdrops did NOT spend budget, every box would paint one ⇒ `count`
    // backdrop <img>s. Because the resolved backdrop decrements the budget, the
    // render truncates well before `count`, proving it counts against the cap.
    const count = MAX_RENDER_NODES;
    const nodes: Record<NodeId, FacetNode> = {
      root: { id: "root", type: "box", children: [] } as unknown as FacetNode,
      shared: media("shared"),
    };
    const children: NodeId[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `b${String(i)}`;
      children.push(id);
      nodes[id] = { id, type: "box", backdrop: "shared", children: [] } as unknown as FacetNode;
    }
    nodes.root = { id: "root", type: "box", children } as unknown as FacetNode;

    let markup = "";
    expect(() => {
      markup = render(tree(nodes));
    }).not.toThrow();
    const imgs = count > 0 ? (markup.match(/<img/g) ?? []).length : 0;
    expect(imgs).toBeGreaterThan(0);
    expect(imgs).toBeLessThan(count);
  });
});

// ── DC-004 flow-only ─────────────────────────────────────────────────────────
describe("backdrop flow-only discipline (DC-004)", () => {
  it("synthesizes EXACTLY two layers and never puts position:absolute on a flow child; sticky stays in flow", () => {
    const markup = render(
      tree({
        root: {
          id: "root",
          type: "box",
          backdrop: "bg",
          style: { backdropScrim: "dark" },
          children: ["nav", "headline"],
        } as unknown as FacetNode,
        bg: media("bg"),
        nav: { id: "nav", type: "box", style: { sticky: true }, children: [] } as unknown as FacetNode,
        headline: { id: "headline", type: "text", value: "Ship faster" } as unknown as FacetNode,
      }),
    );

    // Exactly two renderer-synthesized layers (the cover media + the scrim),
    // both aria-hidden; the flow children are not.
    expect(count(markup, 'aria-hidden="true"')).toBe(2);
    // position:absolute is confined to the single synthesized cover layer.
    expect(count(markup, "position:absolute")).toBe(1);
    // The sticky flow child stays IN flow (position:sticky, never absolute).
    expect(markup).toContain("position:sticky");
  });
});

// ── DC-006 back-compat + node-consumption ────────────────────────────────────
describe("backdrop back-compat and node-consumption (DC-006)", () => {
  it("renders a box with no backdrop byte-identically (no host wrapping, no synthesized layer)", () => {
    const withField = render(
      tree({
        root: { id: "root", type: "box", children: ["copy"] } as unknown as FacetNode,
        copy: { id: "copy", type: "text", value: "plain" } as unknown as FacetNode,
      }),
    );
    // Pre-feature output: no relative host, no absolute layer, no aria-hidden.
    expect(withField).not.toContain("position:relative");
    expect(withField).not.toContain("position:absolute");
    expect(withField).not.toContain('aria-hidden="true"');
    expect(withField).toContain("plain");
  });

  it("renders an id present in BOTH backdrop and children in both places (no de-dupe)", () => {
    const markup = render(
      tree({
        root: {
          id: "root",
          type: "box",
          backdrop: "hero",
          children: ["hero"],
        } as unknown as FacetNode,
        hero: media("hero"),
      }),
    );
    // The same media id renders TWICE: once as the bg cover layer, once in flow.
    expect(count(markup, `src="${SAFE_SRC}"`)).toBe(2);
  });
});
