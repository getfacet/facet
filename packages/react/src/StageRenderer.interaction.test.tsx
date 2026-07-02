// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});

// renderToStaticMarkup (StageRenderer.test.ts) covers static output + fail-safe.
// These jsdom tests cover the INTERACTION path — clicks reaching onAction — which
// a string render can't exercise. This is the seam the action-vocabulary work builds on.
describe("StageRenderer interactions (jsdom)", () => {
  it("fires onAction with the box's action when a pressable box is clicked", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: {
            id: "root",
            type: "box",
            onPress: { name: "go", payload: { id: "7" } },
            children: ["t"],
          },
          t: { id: "t", type: "text", value: "press me" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ name: "go", payload: { id: "7" } });
  });

  it("does not expose a button for a non-pressable box", () => {
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["t"] },
          t: { id: "t", type: "text", value: "static" },
        })}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a field as an input (value capture is a planned feature)", () => {
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["f"] },
          f: { id: "f", type: "field", name: "email", input: "email", placeholder: "you@x.com" },
        })}
      />,
    );
    const input = screen.getByPlaceholderText("you@x.com") as HTMLInputElement;
    expect(input.name).toBe("email");
    expect(input.type).toBe("email");
    // NOTE: typing does NOT yet reach onAction — field-value transport is the
    // planned UI-IN work. When it lands, extend this to assert the captured value.
  });
});
