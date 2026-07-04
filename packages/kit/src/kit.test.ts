import { describe, expect, it } from "vitest";
import { validateTree, type BoxNode, type FacetAction, type FacetTree } from "@facet/core";
import { button, card, fragment, heading, hero, page, row, text, type Block } from "./kit.js";

describe("@facet/kit", () => {
  it("a page composed of presets round-trips clean through validateTree", () => {
    const tree = page([
      hero({ title: "Welcome", subtitle: "sub", cta: { label: "Go", action: "go" } }),
      card([heading("Card"), text("body")]),
      row([text("a"), text("b")]),
    ]);
    const { issues } = validateTree(tree);
    expect(issues).toEqual([]); // every preset emits only valid token-styled bricks
    expect(tree.root).toBe("root");
  });

  it("button() emits a box carrying the onPress action", () => {
    const tree = page([button("Go", "act")]);
    const withAction = Object.values(tree.nodes).find(
      (node): node is BoxNode =>
        node.type === "box" && node.onPress?.kind === "agent" && node.onPress.name === "act",
    );
    expect(withAction).toBeDefined();
  });

  it("button emits an explicit kind agent onPress", () => {
    const tree = page([button("Go", "act")]);
    const pressable = Object.values(tree.nodes).find(
      (node): node is BoxNode => node.type === "box" && node.onPress !== undefined,
    );
    expect(pressable).toBeDefined();
    expect(pressable?.onPress).toEqual({ kind: "agent", name: "act" });
  });

  it("box accepts an optional onHold action", () => {
    const onPress: FacetAction = { kind: "agent", name: "press" };
    const onHold: FacetAction = { kind: "agent", name: "hold" };

    // with onHold: the emitted box carries it
    const withHold: Block = (b) => b.box({ pad: "md" }, [], onPress, onHold);
    const heldTree = page([withHold]);
    const held = Object.values(heldTree.nodes).find(
      (node): node is BoxNode => node.type === "box" && node.onHold !== undefined,
    );
    expect(held).toBeDefined();
    expect(held?.onHold).toEqual({ kind: "agent", name: "hold" });
    expect(held?.onPress).toEqual({ kind: "agent", name: "press" });

    // without onHold: byte-identical to today — no onHold key present at all
    const withoutHold: Block = (b) => b.box({ pad: "md" }, [], onPress);
    const plainTree = page([withoutHold]);
    const plain = Object.values(plainTree.nodes).find(
      (node): node is BoxNode => node.type === "box" && node.onPress !== undefined,
    );
    expect(plain).toBeDefined();
    expect(plain !== undefined && "onHold" in plain).toBe(false);
    expect(plain).toEqual({
      id: plain?.id,
      type: "box",
      style: { pad: "md" },
      children: [],
      onPress: { kind: "agent", name: "press" },
    });

    // presets' output is unchanged: nothing they emit carries onHold
    const presetTree = page([
      hero({ title: "T", subtitle: "S", cta: { label: "C", action: "c" } }),
      card([heading("H"), text("body")]),
      row([button("Go", "act")]),
    ]);
    expect(Object.values(presetTree.nodes).some((node) => "onHold" in node)).toBe(false);
    expect(validateTree(presetTree).issues).toEqual([]);
  });

  it("hero() includes the cta only when given", () => {
    const withCta = page([hero({ title: "T", subtitle: "S", cta: { label: "C", action: "c" } })]);
    const titleOnly = page([hero({ title: "T" })]);
    expect(Object.keys(withCta.nodes).length).toBeGreaterThan(Object.keys(titleOnly.nodes).length);
  });

  it("row() applies the pad option to its box", () => {
    const tree = page([row([text("a")], { pad: "lg" })]);
    const padded = Object.values(tree.nodes).find(
      (node): node is BoxNode =>
        node.type === "box" && node.style?.direction === "row" && node.style.pad === "lg",
    );
    expect(padded).toBeDefined();
  });

  it("assigns unique node ids", () => {
    const tree = page([card([text("a")]), card([text("b")]), row([text("c")])]);
    const ids = Object.keys(tree.nodes);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives the same preset used twice zero id collisions in one page()", () => {
    const optsA = { title: "T", subtitle: "S", cta: { label: "C", action: "c" } } as const;
    const tree = page([hero(optsA), hero(optsA)]);
    const ids = Object.keys(tree.nodes);
    expect(new Set(ids).size).toBe(ids.length); // one Builder, monotonic counter ⇒ distinct
  });

  it("keeps page() output byte-identical: root 'root' and unprefixed k1..kn ids", () => {
    const tree = page([hero({ title: "Hi", cta: { label: "Go", action: "go" } }), text("body")]);
    expect(tree.root).toBe("root");
    const generated = Object.keys(tree.nodes).filter((id) => id !== "root");
    // every non-root id is exactly `k<n>` (no prefix) and the set is k1..kn
    expect(generated.every((id) => /^k\d+$/.test(id))).toBe(true);
    const numbers = generated.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  it("grafts a preset under an explicit prefix without touching root", () => {
    const base = page([heading("Base")]);
    const fragA = fragment(hero({ title: "A" }), "a");
    const fragB = fragment(hero({ title: "B" }), "b");

    const aIds = Object.keys(fragA.nodes);
    const bIds = Object.keys(fragB.nodes);

    // every fragment id carries its prefix; none is the reserved "root"
    expect(aIds.every((id) => id.startsWith("a"))).toBe(true);
    expect(bIds.every((id) => id.startsWith("b"))).toBe(true);
    expect(aIds).not.toContain("root");
    expect(bIds).not.toContain("root");
    expect(fragA.root).not.toBe("root");
    expect(fragB.root).not.toBe("root");

    // disjoint across prefixes ⇒ safe to merge side by side
    expect(aIds.some((id) => bIds.includes(id))).toBe(false);

    // graft both fragments into the base tree's root; re-validate drops nothing
    const rootBox = base.nodes["root"] as BoxNode;
    const grafted: FacetTree = {
      root: "root",
      nodes: {
        ...base.nodes,
        ...fragA.nodes,
        ...fragB.nodes,
        root: { ...rootBox, children: [...rootBox.children, fragA.root, fragB.root] },
      },
    };
    const before = Object.keys(grafted.nodes).length;
    const { tree, issues } = validateTree(grafted);
    expect(issues).toEqual([]);
    expect(Object.keys(tree.nodes).length).toBe(before);
    expect(tree.root).toBe("root");
  });
});
