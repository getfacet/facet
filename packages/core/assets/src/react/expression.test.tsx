// @vitest-environment jsdom

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as Expression from "./expression.js";

type MountProps = ComponentMountProps<ReactNode>["props"];
type Slots = ComponentMountProps<ReactNode>["slots"];

const THEME_VARS = Object.freeze({ "--facet-test-action": "rgb(10, 20, 30)" });
const EXPECTED_EXPORTS = [
  "ActionBar",
  "ActionGroup",
  "Button",
  "Navigation",
  "NavigationItem",
] as const;
const OUT_OF_FLOW_PROPERTIES = [
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "float",
] as const;

afterEach(cleanup);

function renderComponent(
  implementation: MountedComponent<ReactNode, ReactNode>,
  options: {
    readonly props?: MountProps;
    readonly children?: ReactNode;
    readonly slots?: Slots;
    readonly onAction?: (prop: string) => void;
  } = {},
): HTMLElement {
  const Component = implementation;
  const { container } = render(
    <Component
      props={options.props ?? {}}
      slots={options.slots ?? {}}
      themeVars={THEME_VARS}
      onAction={options.onAction ?? (() => undefined)}
    >
      {options.children ?? null}
    </Component>,
  );
  expect(container.childElementCount).toBe(1);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("Expected one HTMLElement root.");
  }
  return root;
}

function declarations(root: HTMLElement): readonly (readonly [string, string])[] {
  return [root, ...Array.from(root.querySelectorAll("*"))].flatMap((node) => {
    if (!(node instanceof HTMLElement)) return [];
    return Array.from(node.style).map((name) => [name, node.style.getPropertyValue(name)] as const);
  });
}

describe("trusted navigation and action React components", () => {
  it("exports exactly the locked navigation and action roster", () => {
    expect(Object.keys(Expression).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it("renders Navigation as a labelled nav from named slots", () => {
    const root = renderComponent(Expression.Navigation, {
      props: {
        label: "Workspace",
        orientation: "vertical",
        density: "compact",
        tone: "inverse",
      },
      children: <span data-testid="ignored">ignored</span>,
      slots: {
        brand: <span>Facet</span>,
        items: <button type="button">Overview</button>,
        actions: <button type="button">Account</button>,
      },
    });

    expect(root.tagName).toBe("NAV");
    expect(root.getAttribute("aria-label")).toBe("Workspace");
    expect(root.getAttribute("data-facet-navigation-orientation")).toBe("vertical");
    expect(root.getAttribute("data-facet-navigation-density")).toBe("compact");
    expect(root.getAttribute("data-facet-navigation-tone")).toBe("inverse");
    expect(root.style.flexDirection).toBe("column");
    expect(root.textContent).toBe("FacetOverviewAccount");
    expect(root.querySelector('[data-testid="ignored"]')).toBeNull();
    expect(root.querySelector('[data-facet-slot="brand"]')?.textContent).toBe("Facet");
    expect(root.querySelector('[data-facet-slot="items"]')?.textContent).toBe("Overview");
    expect(root.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Account");
  });

  it("renders ActionBar from context and actions slots", () => {
    const root = renderComponent(Expression.ActionBar, {
      children: "ignored",
      slots: {
        context: <span>2 selected</span>,
        actions: <button type="button">Archive</button>,
      },
    });

    expect(root.textContent).toBe("2 selectedArchive");
    expect(root.querySelector('[data-facet-slot="context"]')?.textContent).toBe("2 selected");
    expect(root.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Archive");
  });

  it("renders ActionGroup only from ordered children", () => {
    const root = renderComponent(Expression.ActionGroup, {
      children: <button type="button">Child action</button>,
      slots: { unused: <span>slot</span> },
    });

    expect(root.textContent).toBe("Child action");
    expect(root.querySelector("span")).toBeNull();
  });

  it("renders leaf interactions as non-submitting semantic buttons", () => {
    const button = renderComponent(Expression.Button, {
      props: { label: "Save", action: "agent:save" },
      children: "ignored",
      slots: { ignored: "ignored" },
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.textContent).toBe("Save");
    cleanup();

    const item = renderComponent(Expression.NavigationItem, {
      props: {
        label: "Overview",
        action: "nav:overview",
        mark: "O",
        meta: "4",
        active: true,
      },
      children: "ignored",
      slots: { ignored: "ignored" },
    });
    expect(item.tagName).toBe("BUTTON");
    expect(item.getAttribute("type")).toBe("button");
    expect(item.getAttribute("aria-current")).toBe("page");
    expect(item.textContent).toBe("OOverview4");
  });

  it("honors ActionGroup layout, alignment, density, tone, and title", () => {
    const root = renderComponent(Expression.ActionGroup, {
      props: {
        title: "Account actions",
        layout: "row",
        align: "end",
        density: "compact",
        tone: "accent",
      },
      children: <button type="button">Save</button>,
    });

    expect(root.getAttribute("data-facet-action-group-layout")).toBe("row");
    expect(root.getAttribute("data-facet-action-group-tone")).toBe("accent");
    expect(root.querySelector("h2")?.textContent).toBe("Account actions");
    const actions = root.querySelector<HTMLElement>('[data-facet-action-group="actions"]');
    expect(actions?.style.flexDirection).toBe("row");
    expect(actions?.style.justifyContent).toBe("flex-end");
    expect(actions?.style.gap).toContain("var(--facet-foundation-space-xs)");
  });

  it("honors ActionBar alignment and tone while retaining named slots", () => {
    const root = renderComponent(Expression.ActionBar, {
      props: { align: "between", tone: "inverse" },
      slots: { context: "2 selected", actions: "Archive" },
    });

    expect(root.getAttribute("data-facet-action-bar-align")).toBe("between");
    expect(root.getAttribute("data-facet-action-bar-tone")).toBe("inverse");
    expect(root.querySelector('[data-facet-slot="context"]')?.textContent).toBe("2 selected");
    expect(root.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Archive");
  });

  it("reports the declared action prop exactly once per activation", () => {
    const buttonAction = vi.fn<(prop: string) => void>();
    const button = renderComponent(Expression.Button, {
      props: { label: "Save", action: "agent:save" },
      onAction: buttonAction,
    });
    fireEvent.click(button);
    expect(buttonAction).toHaveBeenCalledTimes(1);
    expect(buttonAction).toHaveBeenCalledWith("action");
    cleanup();

    const navigationAction = vi.fn<(prop: string) => void>();
    const item = renderComponent(Expression.NavigationItem, {
      props: { label: "Overview", action: "nav:overview" },
      onAction: navigationAction,
    });
    fireEvent.click(item);
    expect(navigationAction).toHaveBeenCalledTimes(1);
    expect(navigationAction).toHaveBeenCalledWith("action");
  });

  it("uses responsive wrapping and stable control dimensions", () => {
    const navigation = renderComponent(Expression.Navigation, {
      slots: { items: "Items" },
    });
    expect(navigation.style.flexWrap).toBe("wrap");
    expect(navigation.style.maxWidth).toBe("100%");
    cleanup();

    const group = renderComponent(Expression.ActionGroup, {
      props: { layout: "row" },
      children: "Actions",
    });
    expect(
      group.querySelector<HTMLElement>('[data-facet-action-group="actions"]')?.style.flexWrap,
    ).toBe("wrap");
    expect(group.style.minHeight).toContain("var(--facet-");
    cleanup();

    const bar = renderComponent(Expression.ActionBar, { slots: { actions: "Actions" } });
    expect(bar.style.gridTemplateColumns).toContain("auto-fit");
    expect(bar.style.gridTemplateColumns).toContain("var(--facet-");
    cleanup();

    for (const implementation of [Expression.Button, Expression.NavigationItem]) {
      const control = renderComponent(implementation, { props: { label: "Action" } });
      expect(control.style.minHeight).toContain("var(--facet-");
      expect(control.style.boxSizing).toBe("border-box");
      expect(control.style.maxWidth).toBe("100%");
      expect(control.style.overflowWrap).toBe("anywhere");
      cleanup();
    }
  });

  it("contains long NavigationItem labels, marks, and metadata", () => {
    const item = renderComponent(Expression.NavigationItem, {
      props: {
        label: "Averylongnavigationlabelwithoutanaturalbreakpoint",
        mark: "Averylongmarkwithoutanaturalbreakpoint",
        meta: "Averylongstatuswithoutanaturalbreakpoint",
      },
    });
    const mark = item.querySelector<HTMLElement>('[data-facet-navigation-item="mark"]');
    const label = item.querySelector<HTMLElement>('[data-facet-navigation-item="label"]');
    const meta = item.querySelector<HTMLElement>('[data-facet-navigation-item="meta"]');

    expect(mark?.style.maxWidth).toContain("var(--facet-");
    expect(mark?.style.overflow).toBe("hidden");
    expect(label?.style.minWidth).toBe("0px");
    expect(label?.style.overflowWrap).toBe("anywhere");
    expect(meta?.style.maxWidth).toBe("40%");
    expect(meta?.style.overflow).toBe("hidden");
  });

  it("uses the spec defaults for navigation and action layout", () => {
    const navigation = renderComponent(Expression.Navigation, { slots: { items: "Items" } });
    expect(navigation.getAttribute("data-facet-navigation-orientation")).toBe("horizontal");
    expect(navigation.getAttribute("data-facet-navigation-density")).toBe("comfortable");
    expect(navigation.getAttribute("data-facet-navigation-tone")).toBe("neutral");
    expect(navigation.style.flexDirection).toBe("row");
    cleanup();

    const group = renderComponent(Expression.ActionGroup, { children: "Actions" });
    expect(group.getAttribute("data-facet-action-group-layout")).toBe("stack");
    expect(group.getAttribute("data-facet-action-group-tone")).toBe("neutral");
    expect(
      group.querySelector<HTMLElement>('[data-facet-action-group="actions"]')?.style.flexDirection,
    ).toBe("column");
    cleanup();

    const bar = renderComponent(Expression.ActionBar, { slots: { actions: "Actions" } });
    expect(bar.getAttribute("data-facet-action-bar-align")).toBe("start");
    expect(bar.getAttribute("data-facet-action-bar-tone")).toBe("neutral");
    cleanup();

    const button = renderComponent(Expression.Button, { props: { label: "Save" } });
    expect(button.style.background).toContain("--facet-recipe-button-secondary-bg");
  });

  it("keeps every root theme-mounted and flow-contained", () => {
    for (const implementation of Object.values(Expression)) {
      const root = renderComponent(implementation, {
        props: { label: "Action" },
        children: "Child",
        slots: { items: "Items", actions: "Actions" },
      });

      expect(root.style.getPropertyValue("--facet-test-action")).toBe(
        THEME_VARS["--facet-test-action"],
      );
      expect(
        declarations(root).filter(([name]) => OUT_OF_FLOW_PROPERTIES.includes(name as never)),
      ).toEqual([]);
      cleanup();
    }
  });
});
