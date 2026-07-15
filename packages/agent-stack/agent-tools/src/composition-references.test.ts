import { describe, expect, it } from "vitest";
import { validateComposition } from "@facet/core";
import { selectCompositionReferences } from "./composition-references.js";

function composition(name: string, description: string): unknown {
  return {
    name,
    metadata: {
      description,
      category: "marketing",
      useWhen: "A concise call to action is useful.",
      avoidWhen: "The page already has a primary action.",
      variants: ["compact"],
      tags: ["conversion"],
      repeatable: false,
      preferredParent: "section",
      composedOf: ["box", "text"],
      dataRequirements: ["A short title"],
      followUpEdits: ["Replace the example copy"],
    },
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["copy"] },
      copy: { id: "copy", type: "text", value: "Try Facet" },
    },
  };
}

describe("get_composition reference contract", () => {
  it("selects every valid reference when catalog is omitted without losing fields", () => {
    const raw = composition("hero", "A compact hero reference.");
    const expected = validateComposition(raw).composition;

    const selected = selectCompositionReferences([raw]);

    expect(expected).toBeDefined();
    expect(selected).toEqual([expected]);
    expect(JSON.parse(JSON.stringify(selected[0]))).toEqual(expected);
  });

  it("caps the shared prompt and lookup exposure snapshot deterministically", () => {
    const inputs = Array.from({ length: 129 }, (_, index) =>
      composition(`reference-${String(index).padStart(3, "0")}`, "x".repeat(200)),
    );

    const selected = selectCompositionReferences(inputs);

    expect(selected).toHaveLength(128);
    expect(selected[0]?.name).toBe("reference-000");
    expect(selected.at(-1)?.name).toBe("reference-127");
    expect(selected.some(({ name }) => name === "reference-128")).toBe(false);
  });

  it("applies all, allow, and empty exposure policies", () => {
    const hero = composition("hero", "Hero");
    const pricing = composition("pricing", "Pricing");

    expect(
      selectCompositionReferences([hero, pricing], {
        compositions: { mode: "all" },
      }).map(({ name }) => name),
    ).toEqual(["hero", "pricing"]);
    expect(
      selectCompositionReferences([hero, pricing], {
        compositions: { mode: "allow", names: ["pricing"] },
      }).map(({ name }) => name),
    ).toEqual(["pricing"]);
    expect(
      selectCompositionReferences([hero, pricing], {
        compositions: { mode: "allow", names: [] },
      }),
    ).toEqual([]);
  });

  it("fails closed for a supplied malformed catalog", () => {
    const inputs: readonly unknown[] = [
      null,
      "all",
      { compositions: { mode: "deny", names: ["hero"] } },
      { compositions: ["hero"] },
    ];

    for (const catalog of inputs) {
      expect(selectCompositionReferences([composition("hero", "Hero")], catalog)).toEqual([]);
    }
  });

  it("keeps the first valid duplicate and ignores malformed or hostile entries", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile ownKeys");
        },
      },
    );
    const malformedFirst = {
      name: "duplicate",
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
    };
    const firstValid = composition("duplicate", "First valid");
    const laterValid = composition("duplicate", "Later valid");

    expect(() =>
      selectCompositionReferences([hostile, malformedFirst, firstValid, laterValid]),
    ).not.toThrow();
    expect(
      selectCompositionReferences([hostile, malformedFirst, firstValid, laterValid]).map(
        ({ metadata }) => metadata.description,
      ),
    ).toEqual(["First valid"]);
  });

  it("returns a newly detached and deeply frozen snapshot", () => {
    const raw = composition("hero", "A compact hero reference.") as {
      metadata: { variants: string[] };
      nodes: { root: { children: string[] } };
    };

    const selected = selectCompositionReferences([raw]);
    const reference = selected[0];
    const separatelySelected = selectCompositionReferences([raw]);

    expect(reference).toBeDefined();
    expect(separatelySelected).not.toBe(selected);
    expect(separatelySelected[0]).not.toBe(reference);
    expect(reference).not.toBe(raw);
    expect(reference?.metadata).not.toBe(raw.metadata);
    expect(reference?.nodes).not.toBe(raw.nodes);
    expect(reference?.nodes["root"]).not.toBe(raw.nodes.root);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(reference)).toBe(true);
    expect(Object.isFrozen(reference?.metadata)).toBe(true);
    expect(Object.isFrozen(reference?.metadata.variants)).toBe(true);
    expect(Object.isFrozen(reference?.nodes)).toBe(true);
    expect(Object.isFrozen(reference?.nodes["root"])).toBe(true);
    expect(
      Object.isFrozen(
        (reference?.nodes["root"] as { readonly children?: readonly string[] } | undefined)
          ?.children,
      ),
    ).toBe(true);

    raw.metadata.variants.push("caller-mutation");
    raw.nodes.root.children.push("caller-child");
    expect(reference?.metadata.variants).toEqual(["compact"]);
    expect(
      (reference?.nodes["root"] as { readonly children?: readonly string[] } | undefined)?.children,
    ).toEqual(["copy"]);
  });
});
