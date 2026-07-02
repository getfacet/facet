import { describe, expect, it } from "vitest";
import { validateTree, type BoxNode } from "@facet/core";
import { button, card, heading, hero, page, row, text } from "./kit.js";

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
});
