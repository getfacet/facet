// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetTree, ViewSnapshot } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

const replayTree: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["rootText"] },
    rootText: { id: "rootText", type: "text", value: "plain root" },
    home: { id: "home", type: "box", children: ["homeText"] },
    homeText: { id: "homeText", type: "text", value: "home screen" },
    about: {
      id: "about",
      type: "box",
      children: ["aboutText", "toggle", "panel", "table", "goHome"],
    },
    aboutText: { id: "aboutText", type: "text", value: "about screen" },
    toggle: {
      id: "toggle",
      type: "box",
      onPress: { kind: "toggle", target: "panel" },
      children: ["toggleText"],
    },
    toggleText: { id: "toggleText", type: "text", value: "Toggle panel" },
    panel: { id: "panel", type: "box", hidden: true, children: ["panelText"] },
    panelText: { id: "panelText", type: "text", value: "panel content" },
    table: {
      id: "table",
      type: "table",
      columns: [{ key: "name", label: "Name", sortable: true }],
      rows: [{ name: "Bravo" }, { name: "Alpha" }],
    },
    goHome: {
      id: "goHome",
      type: "box",
      onPress: { kind: "navigate", to: "home" },
      children: ["goHomeText"],
    },
    goHomeText: { id: "goHomeText", type: "text", value: "Go home" },
  },
  screens: { home: "home", about: "about" },
  entry: "home",
};

const firstColumn = (): string[] =>
  Array.from(
    document.querySelectorAll("tbody tr"),
    (row) => row.querySelector("td")?.textContent ?? "",
  );

const hydratedView: ViewSnapshot = {
  screen: "about",
  toggled: { panel: "shown" },
  sort: { table: { column: "name", direction: "asc" } },
};

describe("StageRenderer initial replay view", () => {
  it("hydrates a sanitized initial view once from replay state", () => {
    const onViewSnapshot = vi.fn();
    render(
      <StageRenderer
        initialView={hydratedView}
        onViewSnapshot={onViewSnapshot}
        tree={replayTree}
      />,
    );

    expect(screen.getByText("about screen")).toBeTruthy();
    expect(screen.getByText("panel content")).toBeTruthy();
    expect(firstColumn()).toEqual(["Alpha", "Bravo"]);
    expect(onViewSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screen: "about",
        toggled: { panel: "shown" },
        sort: { table: { column: "name", direction: "asc" } },
      }),
    );
  });

  it("hydrates a sanitized initial view once while local actions remain owned", () => {
    const onAction = vi.fn();
    const onViewSnapshot = vi.fn();
    const rendered = render(
      <StageRenderer
        initialView={hydratedView}
        onAction={onAction}
        onViewSnapshot={onViewSnapshot}
        tree={replayTree}
      />,
    );

    rendered.rerender(
      <StageRenderer
        initialView={{
          screen: "home",
          toggled: { panel: "hidden" },
          sort: { table: { column: "name", direction: "desc" } },
        }}
        onAction={onAction}
        onViewSnapshot={onViewSnapshot}
        tree={replayTree}
      />,
    );

    expect(screen.getByText("about screen")).toBeTruthy();
    expect(screen.getByText("panel content")).toBeTruthy();
    expect(firstColumn()).toEqual(["Alpha", "Bravo"]);

    fireEvent.click(screen.getByRole("columnheader", { name: /Name/ }));
    expect(firstColumn()).toEqual(["Bravo", "Alpha"]);
    fireEvent.click(screen.getByText("Toggle panel"));
    expect(screen.queryByText("panel content")).toBeNull();
    fireEvent.click(screen.getByText("Go home"));
    expect(screen.getByText("home screen")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(onViewSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screen: "home",
        toggled: { panel: "hidden" },
        sort: { table: { column: "name", direction: "desc" } },
      }),
    );
  });

  it("hydrates a sanitized initial view once and drops malformed runtime data", () => {
    const malformed: Record<string, unknown> = {
      screen: 42,
      toggled: { panel: "sometimes" },
      sort: { table: { column: "name", direction: "sideways" } },
    };
    malformed["cycle"] = malformed;
    expect(() =>
      render(
        <StageRenderer initialView={malformed as unknown as ViewSnapshot} tree={replayTree} />,
      ),
    ).not.toThrow();
    expect(screen.getByText("home screen")).toBeTruthy();
    expect(screen.queryByText("panel content")).toBeNull();
  });
});
