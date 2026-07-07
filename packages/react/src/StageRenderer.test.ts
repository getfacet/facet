import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { MOTION_CLASS_NAMES } from "./motion.js";

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
// walk — reachable nodes only); token-free trees stay byte-identical to today
// (no style element, no class attribute), and raw-path junk — including cyclic
// trees and null/scalar node VALUES in the nodes record — renders plain, never
// throws or hangs.
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

  it("keeps a token-free tree byte-identical to today (no style element, no class attribute)", () => {
    const plain = tree({
      root: { id: "root", type: "box", children: ["t", "f"] },
      t: text("t", "hello"),
      f: { id: "f", type: "field", name: "email", label: "Email" },
    });
    const out = render(plain);
    expect(out).not.toContain("<style");
    expect(out).not.toContain("class=");
    // The exact-markup pin for a plain box (same string the pre-appear renderer
    // emitted) — className={undefined} must add nothing.
    expect(render(tree({ root: { id: "root", type: "box", children: [] } }))).toBe(
      '<div style="display:flex;flex-direction:column;box-sizing:border-box"></div>',
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

  it("does not add hold-only CSS to press-only or plain boxes (byte-identical to today)", () => {
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
      '<div style="display:flex;flex-direction:column;box-sizing:border-box"></div>',
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
