// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId, ViewSnapshot } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});
const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({ id, type: "box", children });
const mountClient = render;

// onViewSnapshot (WU-3, DC-001): the renderer publishes its live view snapshot
// read-only via the optional callback, sampled after commit. A navigate press
// updates `screen`; a toggle press updates `toggled` — both surface through the
// callback without lifting the renderer's private state. Needs the client
// render path (effects), so these use @testing-library/react, not the static
// string renderer above.
describe("StageRenderer onViewSnapshot (jsdom)", () => {
  afterEach(cleanup);

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

  const lastSnapshot = (onViewSnapshot: ReturnType<typeof vi.fn>): ViewSnapshot =>
    onViewSnapshot.mock.calls.at(-1)?.[0] as ViewSnapshot;

  it("publishes the updated screen after a navigate press", () => {
    const onViewSnapshot = vi.fn();
    mountClient(createElement(StageRenderer, { tree: screensTree(), onViewSnapshot }));

    // Fires once on mount with the initial (entry) snapshot.
    expect(onViewSnapshot).toHaveBeenCalled();
    onViewSnapshot.mockClear();

    fireEvent.click(screen.getByRole("button"));

    expect(onViewSnapshot).toHaveBeenCalled();
    expect(lastSnapshot(onViewSnapshot).screen).toBe("about");
  });

  it("publishes the updated toggled record after a toggle press", () => {
    const onViewSnapshot = vi.fn();
    mountClient(
      createElement(StageRenderer, {
        onViewSnapshot,
        tree: tree({
          root: box("root", ["btn", "panel"]),
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "panel" },
            children: [],
          },
          panel: box("panel", ["p"]),
          p: text("p", "panel content"),
        }),
      }),
    );
    onViewSnapshot.mockClear();

    fireEvent.click(screen.getByRole("button"));

    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ panel: "hidden" });
  });
});

// DC-005 structural fence: the only stage-write setters live inside handlePress.
// No ServerMessage/patch path may write view state, so `setCurrentScreen(` and
// `setVisibilityOverrides(` must appear ONLY within the handlePress body — read
// the source as text and prove no call site exists outside it.
describe("StageRenderer view-state setter fence (DC-005)", () => {
  it("setCurrentScreen/setVisibilityOverrides are called only within handlePress", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "StageRenderer.tsx"),
      "utf8",
    );
    const start = src.indexOf("const handlePress");
    const end = src.indexOf("const appearSeen", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const body = src.slice(start, end);
    const outside = src.slice(0, start) + src.slice(end);
    for (const setter of ["setCurrentScreen(", "setVisibilityOverrides("]) {
      expect(body).toContain(setter);
      expect(outside).not.toContain(setter);
    }
  });
});
