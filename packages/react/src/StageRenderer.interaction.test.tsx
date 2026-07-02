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

/** A two-screen tree: entry "home" (with a navigate button) and "about". */
const screensTree = (): FacetTree => ({
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["rootText"] },
    rootText: { id: "rootText", type: "text", value: "plain root content" },
    home: { id: "home", type: "box", children: ["homeText", "goAbout"] },
    homeText: { id: "homeText", type: "text", value: "home content" },
    goAbout: {
      id: "goAbout",
      type: "box",
      onPress: { kind: "navigate", to: "about" },
      children: [],
    },
    about: { id: "about", type: "box", children: ["aboutText"] },
    aboutText: { id: "aboutText", type: "text", value: "about content" },
  },
  screens: { home: "home", about: "about" },
  entry: "home",
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
    // The renderer stamps the canonical kind on legacy bare {name} actions at emit time.
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "go", payload: { id: "7" } });
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

  it("renders a box with an unknown-kind onPress as non-pressable (never a button)", () => {
    const rootWithAlienPress = {
      id: "root",
      type: "box",
      onPress: { kind: "mystery", name: "x" },
      children: ["t"],
    } as unknown as FacetNode;
    render(
      <StageRenderer
        tree={tree({
          root: rootWithAlienPress,
          t: { id: "t", type: "text", value: "inert" },
        })}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("inert")).toBeTruthy();
  });
});

describe("StageRenderer screens + navigate (jsdom)", () => {
  it("navigate press switches the rendered screen without calling onAction", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={screensTree()} />);

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(screen.queryByText("plain root content")).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("navigate to an unknown screen no-ops (stays on the current screen, no emission)", () => {
    const onAction = vi.fn();
    const base = screensTree();
    const withDeadLink: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        goAbout: {
          id: "goAbout",
          type: "box",
          onPress: { kind: "navigate", to: "nowhere" },
          children: [],
        },
      },
    };
    render(<StageRenderer onAction={onAction} tree={withDeadLink} />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("falls back to entry when the current screen is deleted by a new tree", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // now on "about"
    expect(screen.getByText("about content")).toBeTruthy();

    const base = screensTree();
    const aboutDeleted: FacetTree = {
      root: base.root,
      nodes: {
        root: base.nodes["root"] as FacetNode,
        rootText: base.nodes["rootText"] as FacetNode,
        home: base.nodes["home"] as FacetNode,
        homeText: base.nodes["homeText"] as FacetNode,
        goAbout: base.nodes["goAbout"] as FacetNode,
      },
      screens: { home: "home" },
      entry: "home",
    };
    rerender(<StageRenderer onAction={onAction} tree={aboutDeleted} />);

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("falls back to the first live screen when the current screen AND entry are both dead", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // currentScreen = "about"

    const bothDead: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["rootText"] },
        rootText: { id: "rootText", type: "text", value: "plain root content" },
        c: { id: "c", type: "box", children: ["cText"] },
        cText: { id: "cText", type: "text", value: "third screen content" },
      },
      // "about" (the current screen) and the entry both point at dead nodes.
      screens: { about: "goneNode", zeta: "c" },
      entry: "about",
    };
    rerender(<StageRenderer onAction={onAction} tree={bothDead} />);

    expect(screen.getByText("third screen content")).toBeTruthy();
    expect(screen.queryByText("plain root content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("stays on a live current screen across a rerender with a patched tree (DC-008)", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // now on "about"

    const base = screensTree();
    const patched: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        about: { id: "about", type: "box", children: ["aboutText", "aboutExtra"] },
        aboutExtra: { id: "aboutExtra", type: "text", value: "fresh about line" },
      },
    };
    rerender(<StageRenderer onAction={onAction} tree={patched} />);

    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.getByText("fresh about line")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("StageRenderer toggle (jsdom)", () => {
  it("toggle hides then shows a visible panel across two clicks, browser-local", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "panel"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "panel" },
            children: [],
          },
          panel: { id: "panel", type: "box", children: ["p"] },
          p: { id: "p", type: "text", value: "panel content" },
        })}
      />,
    );

    expect(screen.getByText("panel content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("panel content")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("panel content")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("toggle shows then hides an initially-hidden (hidden: true) panel", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "menu"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "menu" },
            children: [],
          },
          menu: { id: "menu", type: "box", hidden: true, children: ["m"] },
          m: { id: "m", type: "text", value: "menu content" },
        })}
      />,
    );

    expect(screen.queryByText("menu content")).toBeNull(); // hidden on first paint
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("menu content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("menu content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("toggle on an unknown target no-ops (no crash, no emission)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "t"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "ghost" },
            children: [],
          },
          t: { id: "t", type: "text", value: "steady" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("steady")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });
});
