// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { FacetTree } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

const base: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["f"] },
    f: { id: "f", type: "field", name: "email", label: "Email" },
  },
};

const withAppear: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["f", "n"] },
    f: { id: "f", type: "field", name: "email", label: "Email" },
    n: { id: "n", type: "box", style: { appear: "fade" }, children: [] },
  },
};

describe("usesAppear flip", () => {
  it("preserves visitor-typed field value when first appear token arrives", () => {
    const { container, rerender } = render(<StageRenderer tree={base} onAction={() => {}} />);
    const input = container.querySelector("input")!;
    input.value = "typed-by-visitor";
    const before = input;
    rerender(<StageRenderer tree={withAppear} onAction={() => {}} />);
    const after = container.querySelector("input")!;
    console.log("same DOM node:", before === after, "value after:", JSON.stringify(after.value));
    expect(before === after).toBe(true);
    expect(after.value).toBe("typed-by-visitor");
  });
});
