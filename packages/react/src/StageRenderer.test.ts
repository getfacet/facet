import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
}

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({ id, type: "box", children });

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
      '<div style="display:flex;flex-direction:column;box-sizing:border-box"></div>',
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

  it("skips an image whose src was patched to a non-string", () => {
    const broken = { id: "i", type: "image", src: 42, alt: "x" } as unknown as FacetNode;
    const out = render(
      tree({ root: box("root", ["i", "a"]), i: broken, a: text("a", "still up") }),
    );
    expect(out).toContain("still up");
    expect(out).not.toContain("<img");
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

  it("drops an image with an unsafe URL scheme", () => {
    const out = render(
      tree({
        root: box("root", ["i"]),
        i: { id: "i", type: "image", src: "javascript:alert(1)", alt: "x" },
      }),
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
  });
});

describe("StageRenderer happy path", () => {
  it("renders all four bricks", () => {
    const out = render(
      tree({
        root: box("root", ["t", "i", "f"]),
        t: text("t", "hello"),
        i: { id: "i", type: "image", src: "https://example.com/a.png", alt: "pic" },
        f: { id: "f", type: "field", name: "email", input: "email", label: "Email" },
      }),
    );
    expect(out).toContain("hello");
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('name="email"');
    expect(out).toContain("Email");
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
