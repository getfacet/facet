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
